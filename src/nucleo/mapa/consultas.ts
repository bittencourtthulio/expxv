import type {
  ArestaGrafoMapa,
  ConfiancaIpc,
  DadosAnaliseMapa,
  DirecaoVizinhosIpc,
  FiltroGrafoMapa,
  FluxoMapaIpc,
  GrafoMapaIpc,
  NivelGrafo,
  NoDetalheMapa,
  NoFluxoMapa,
  NoGrafoMapa,
  ParametrosAnaliseMapa,
  PerfilProvisorioMapa,
  RaioMapaIpc,
  ResultadoAnaliseMapa,
  ResultadoBuscaMapa,
  ResumoMapaIpc,
  TipoAnaliseMapa,
  TipoArestaIpc,
  TipoNoIpc,
  VizinhoMapa,
  VizinhosMapaIpc,
} from "../../compartilhado/mapa";
import { LIMITE_BUSCA_MAX, LIMITE_GRAFO_MAX, LIMITE_RAIO_ARQUIVOS, LIMITE_VIZINHOS_MAX, TIPOS_ANALISE_MAPA } from "../../compartilhado/mapa";
import type { Armazem } from "./armazem";
import { fluxo as calcularFluxo, type ArestaFluxoEntrada } from "./analises/entradas";
import { caminhoRelativoSeguro } from "./confinado";
import { arquivoDoId, calcularRaio, type ArestaRaio, type InfoArquivoRaio } from "./raio";
import { ehArquivoSensivel } from "./sensiveis";
import { NOTA_RAIO, VERSAO_EXTRATOR, limiaresPadrao, type Extracao, type TipoAresta, type TipoNo } from "./tipos";

// Consultas do mapa (T-17.33): tudo que o IPC `mapa:*`, o MCP e a exportação leem. Só LEITURA sobre o armazém já analisado e o
// `analise_cache` preenchido pela fase derivada; nenhuma consulta varre o conjunto inteiro por pedido (P-246: ≤ 50 ms p95 com
// 5 000 arquivos). Respostas têm tetos duros e carregam `truncado`. Caminhos de entrada são relativos à raiz e validados.

const USO_ARQUIVO: readonly TipoAresta[] = ["importa", "reexporta"];
const USO_SIMBOLO: readonly TipoAresta[] = ["chama", "instancia", "herda", "implementa", "referencia"];
const USO_RAIO = ["importa", "reexporta", "chama", "instancia", "herda", "implementa", "referencia", "aciona"];
const LIMITE_FLUXO_NOS = 300;
const CHUNK = 400;
const MAX_NOS_RAIO = 4000;
const MAX_NIVEIS_RAIO = 8;

export class ErroConsulta extends Error {
  constructor(
    readonly codigo: "argumento_invalido" | "nao_encontrado" | "mapa_nao_pronto",
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroConsulta";
  }
}

const baseNome = (c: string): string => c.slice(c.lastIndexOf("/") + 1);
const limitar = (v: number | undefined, padrao: number, max: number): number => Math.min(Math.max(1, Math.trunc(v ?? padrao)), max);

function validarIdNo(id: unknown): string {
  if (typeof id !== "string" || id.length === 0 || id.length > 600 || id.includes("\0")) throw new ErroConsulta("argumento_invalido", "id de nó inválido");
  const m = /^(arq|mod|sim|ent|tab|ext):/.exec(id);
  if (m === null) throw new ErroConsulta("argumento_invalido", "id de nó inválido");
  if (m[1] === "arq" || m[1] === "sim" || m[1] === "ent") {
    const c = arquivoDoId(id);
    if (c === null || caminhoRelativoSeguro(c) === null) throw new ErroConsulta("argumento_invalido", "caminho do nó inválido");
    if (ehArquivoSensivel(c)) throw new ErroConsulta("argumento_invalido", "arquivo não permitido");
  }
  return id;
}

/** Valida caminho relativo vindo de fora (renderer, MCP): nunca absoluto, nunca `..`, nunca arquivo de ambiente/chave. */
export function validarCaminhoRelativo(c: unknown): string {
  const r = caminhoRelativoSeguro(c);
  if (r === null || ehArquivoSensivel(r)) throw new ErroConsulta("argumento_invalido", "caminho deve ser relativo à raiz do workspace");
  return r;
}

function tipoDe(id: string): TipoNoIpc {
  const p = id.slice(0, id.indexOf(":"));
  return ({ arq: "arquivo", mod: "modulo", sim: "simbolo", ent: "entrada", tab: "tabela", ext: "externo" } as Record<string, TipoNoIpc>)[p] ?? "externo";
}

export interface ResumoBase {
  estado: ResumoMapaIpc["estado"];
  versao_mapa: number;
  analisado_em: string | null;
  arquivos: number;
  nos: number;
  linguagens: ResumoMapaIpc["linguagens"];
  arestas: ResumoMapaIpc["arestas"];
  historia: ResumoMapaIpc["historia"];
  degradadas: number;
}

export function resumoBase(a: Armazem): ResumoBase {
  const r = a.resumo();
  const degradadas = Number(a.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM arquivo WHERE degradado = 1")?.n ?? 0);
  return { estado: r.estado, versao_mapa: r.versao_mapa, analisado_em: r.analisado_em, arquivos: r.arquivos, nos: a.contagens().nos, linguagens: r.linguagens.map((l) => ({ linguagem: l.linguagem, arquivos: l.arquivos, loc: l.loc })), arestas: r.arestas, historia: r.historia, degradadas };
}

function vazioDe<T extends TipoAnaliseMapa>(tipo: T): DadosAnaliseMapa[T] {
  const v: DadosAnaliseMapa = {
    ciclos: { ciclos: [], total: 0 },
    camadas: { modulos: [], ciclos: [], violacoes: [], dsm: { modulos: [], celulas: [], truncado: false }, regras_importadas: 0 },
    hotspots: { disponivel: false, itens: [] },
    mortos: { itens: [], rotulo: "candidato a código morto (verificar antes de qualquer remoção)" },
    sem_teste: { itens: [], por_pasta: [] },
    externas: { itens: [], aviso: "" },
    duplicacao: { habilitada: false, clones: [] },
    dialetos: { eixos: [] },
    zonas: { zonas: [] },
    entradas: { itens: [], por_categoria: {} },
    dados: { tabelas: [] },
  };
  return v[tipo];
}

interface LinhaArquivo {
  id: number;
  caminho: string;
  linguagem: string;
  modulo: string;
  loc: number | null;
  camada: number | null;
  ciclo_id: number | null;
  pagerank: number | null;
}

export class Consultas {
  constructor(private readonly a: Armazem) {}

  private pronto(): void {
    if (this.a.contagens().arquivos === 0) throw new ErroConsulta("mapa_nao_pronto", "o mapa ainda não foi analisado");
  }

  versao(): number {
    return this.a.versaoMapa();
  }

  // ---------------------------------------------------------------------------------------------
  // grafo

  grafo(nivel: NivelGrafo, filtro: FiltroGrafoMapa = {}, limiteBruto?: number): GrafoMapaIpc {
    this.pronto();
    const limite = limitar(limiteBruto, 5000, LIMITE_GRAFO_MAX);
    const versao = this.a.versaoMapa();
    if (nivel === "modulo") return this.grafoModulo(filtro, limite, versao);
    if (nivel === "arquivo") return this.grafoArquivo(filtro, limite, versao);
    return this.grafoSimbolo(filtro, limite, versao);
  }

  private grafoModulo(f: FiltroGrafoMapa, limite: number, versao: number): GrafoMapaIpc {
    const cache = this.a.lerAnaliseCache<{ modulos: Array<{ id: string; arquivos: number; loc: number }>; arestas: Array<{ de: string; para: string; peso: number; exata: boolean }> }>("grafo_modulo");
    const camadas = this.a.lerAnaliseCache<DadosAnaliseMapa["camadas"]>("analise:camadas");
    const porModulo = new Map((camadas?.modulos ?? []).map((m) => [m.modulo, m]));
    if (cache === null) return { nivel: "modulo", nos: [], arestas: [], truncado: false, total_nos: 0, total_arestas: 0, versao_mapa: versao };
    const pasta = f.pasta === undefined ? null : validarCaminhoRelativo(f.pasta);
    let mods = cache.modulos.filter((m) => pasta === null || m.id === pasta || m.id.startsWith(`${pasta}/`));
    if (f.camada !== undefined) mods = mods.filter((m) => porModulo.get(m.id)?.camada === f.camada);
    if (f.so_ciclos === true) mods = mods.filter((m) => porModulo.get(m.id)?.ciclo_id != null);
    const total = mods.length;
    mods = [...mods].sort((x, y) => y.loc - x.loc || (x.id < y.id ? -1 : 1)).slice(0, limite);
    const idx = new Map(mods.map((m, i) => [m.id, i]));
    const nos: NoGrafoMapa[] = mods.map((m) => {
      const c = porModulo.get(m.id);
      const no: NoGrafoMapa = { id: `mod:${m.id}`, r: m.id === "." ? "." : baseNome(m.id), t: "modulo", g: m.id, w: m.loc > 0 ? m.loc : m.arquivos };
      if (c?.ciclo_id != null) no.c = c.ciclo_id;
      if (c !== undefined) no.k = c.camada;
      return no;
    });
    const arestas: ArestaGrafoMapa[] = [];
    let totalArestas = 0;
    for (const e of cache.arestas) {
      const de = idx.get(e.de);
      const para = idx.get(e.para);
      if (de === undefined || para === undefined) continue;
      if (f.min_confianca === "exata" && !e.exata) continue;
      totalArestas++;
      arestas.push([de, para, "importa", e.exata ? 1 : 0, e.peso]);
    }
    return { nivel: "modulo", nos, arestas, truncado: total > limite, total_nos: total, total_arestas: totalArestas, versao_mapa: versao };
  }

  private grafoArquivo(f: FiltroGrafoMapa, limite: number, versao: number): GrafoMapaIpc {
    const onde: string[] = ["a.degradado = 0"];
    const par: Array<string | number> = [];
    if (f.linguagens !== undefined && f.linguagens.length > 0) {
      onde.push(`a.linguagem IN (${f.linguagens.map(() => "?").join(",")})`);
      par.push(...f.linguagens.slice(0, 20));
    }
    if (f.pasta !== undefined) {
      const p = validarCaminhoRelativo(f.pasta);
      onde.push("(a.modulo = ? OR a.modulo LIKE ? ESCAPE '\\')");
      par.push(p, `${p.replace(/[\\%_]/g, "\\$&")}/%`);
    }
    if (f.camada !== undefined) {
      onde.push("a.camada = ?");
      par.push(f.camada);
    }
    if (f.so_ciclos === true) onde.push("a.ciclo_id IS NOT NULL");
    const filtroSql = onde.join(" AND ");
    const total = Number(this.a.banco.consultarUm<{ n: number }>(`SELECT COUNT(*) AS n FROM arquivo a WHERE ${filtroSql}`, par)?.n ?? 0);
    const linhas = this.a.banco.consultar<LinhaArquivo>(`SELECT a.id, a.caminho, a.linguagem, a.modulo, a.loc, a.camada, a.ciclo_id, a.pagerank FROM arquivo a WHERE ${filtroSql} ORDER BY a.pagerank DESC, a.id LIMIT ?`, [...par, limite]);
    const idx = new Map<string, number>();
    const nos: NoGrafoMapa[] = linhas.map((l, i) => {
      idx.set(`arq:${l.caminho}`, i);
      const no: NoGrafoMapa = { id: `arq:${l.caminho}`, r: baseNome(l.caminho), t: "arquivo", g: l.modulo, w: l.loc ?? 1, l: l.linguagem };
      if (l.ciclo_id !== null) no.c = l.ciclo_id;
      if (l.camada !== null) no.k = l.camada;
      if (l.pagerank !== null) no.p = Math.round(l.pagerank * 1000) / 1000;
      return no;
    });
    const tipos = (f.tipos_aresta?.filter((t) => USO_ARQUIVO.includes(t) || t === "testa") ?? USO_ARQUIVO).slice(0, 4);
    const sqlConf = f.min_confianca === "exata" ? " AND confianca = 'exata'" : "";
    const rows = this.a.banco.consultar<{ de: string; para: string; tipo: TipoArestaIpc; confianca: string; peso: number }>(
      `SELECT de, para, tipo, confianca, peso FROM aresta WHERE tipo IN (${(tipos.length > 0 ? tipos : USO_ARQUIVO).map(() => "?").join(",")})${sqlConf}`,
      [...(tipos.length > 0 ? tipos : USO_ARQUIVO)],
    );
    const arestas: ArestaGrafoMapa[] = [];
    for (const e of rows) {
      const de = idx.get(e.de);
      const para = idx.get(e.para);
      if (de === undefined || para === undefined) continue;
      arestas.push([de, para, e.tipo, e.confianca === "exata" ? 1 : 0, e.peso]);
    }
    return { nivel: "arquivo", nos, arestas, truncado: total > limite, total_nos: total, total_arestas: arestas.length, versao_mapa: versao };
  }

  private grafoSimbolo(f: FiltroGrafoMapa, limite: number, versao: number): GrafoMapaIpc {
    const onde: string[] = ["n.tipo = 'simbolo'"];
    const par: Array<string | number> = [];
    if (f.pasta !== undefined) {
      const p = validarCaminhoRelativo(f.pasta);
      onde.push("(a.caminho = ? OR a.modulo = ? OR a.modulo LIKE ? ESCAPE '\\')");
      par.push(p, p, `${p.replace(/[\\%_]/g, "\\$&")}/%`);
    }
    if (f.linguagens !== undefined && f.linguagens.length > 0) {
      onde.push(`a.linguagem IN (${f.linguagens.map(() => "?").join(",")})`);
      par.push(...f.linguagens.slice(0, 20));
    }
    const filtroSql = onde.join(" AND ");
    const total = Number(this.a.banco.consultarUm<{ n: number }>(`SELECT COUNT(*) AS n FROM no n JOIN arquivo a ON a.id = n.arquivo_id WHERE ${filtroSql}`, par)?.n ?? 0);
    const linhas = this.a.banco.consultar<{ id: string; rotulo: string; subtipo: string | null; modulo: string; linguagem: string; ini: number | null; fim: number | null; ciclo_id: number | null }>(
      `SELECT n.id, n.rotulo, n.subtipo, a.modulo, a.linguagem, n.linha_ini AS ini, n.linha_fim AS fim, a.ciclo_id FROM no n JOIN arquivo a ON a.id = n.arquivo_id WHERE ${filtroSql} ORDER BY n.exportado DESC, a.pagerank DESC, n.id LIMIT ?`,
      [...par, limite],
    );
    const idx = new Map<string, number>();
    const nos: NoGrafoMapa[] = linhas.map((l, i) => {
      idx.set(l.id, i);
      const no: NoGrafoMapa = { id: l.id, r: l.rotulo, t: "simbolo", g: l.modulo, w: Math.max(1, (l.fim ?? 1) - (l.ini ?? 1) + 1), l: l.linguagem };
      if (l.ciclo_id !== null) no.c = l.ciclo_id;
      return no;
    });
    const arestas: ArestaGrafoMapa[] = [];
    const tipos = (f.tipos_aresta?.filter((t) => USO_SIMBOLO.includes(t)) ?? USO_SIMBOLO).slice(0, 5);
    const ids = [...idx.keys()];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const parte = ids.slice(i, i + CHUNK);
      const rows = this.a.banco.consultar<{ de: string; para: string; tipo: TipoArestaIpc; confianca: string; peso: number }>(
        `SELECT de, para, tipo, confianca, peso FROM aresta WHERE de IN (${parte.map(() => "?").join(",")}) AND tipo IN (${tipos.map(() => "?").join(",")})${f.min_confianca === "exata" ? " AND confianca = 'exata'" : ""}`,
        [...parte, ...tipos],
      );
      for (const e of rows) {
        const de = idx.get(e.de);
        const para = idx.get(e.para);
        if (de === undefined || para === undefined) continue;
        arestas.push([de, para, e.tipo, e.confianca === "exata" ? 1 : 0, e.peso]);
      }
    }
    return { nivel: "simbolo", nos, arestas, truncado: total > limite, total_nos: total, total_arestas: arestas.length, versao_mapa: versao };
  }

  // ---------------------------------------------------------------------------------------------
  // vizinhos e nó

  private noGrafoDe(id: string, rotulo: string, tipo: TipoNoIpc, caminho: string | null): NoGrafoMapa {
    let g = ".";
    if (caminho !== null) g = caminho.includes("/") ? caminho.slice(0, caminho.lastIndexOf("/")) : ".";
    else if (tipo === "tabela") g = "(dados)";
    else if (tipo === "externo") g = "(externas)";
    return { id, r: rotulo, t: tipo, g, w: 1 };
  }

  vizinhos(noId: string, direcao: DirecaoVizinhosIpc = "ambas", profundidade = 1, limite = 200): VizinhosMapaIpc {
    const id = validarIdNo(noId);
    this.pronto();
    const prof = limitar(profundidade, 1, 3);
    const lim = limitar(limite, 200, LIMITE_VIZINHOS_MAX);
    const idx = new Map<string, number>();
    const nos: NoGrafoMapa[] = [];
    const arestas: ArestaGrafoMapa[] = [];
    const garantir = (nid: string, rotulo: string, tipo: TipoNoIpc): number => {
      let i = idx.get(nid);
      if (i === undefined) {
        i = nos.length;
        idx.set(nid, i);
        nos.push(this.noGrafoDe(nid, rotulo, tipo, arquivoDoId(nid)));
      }
      return i;
    };
    const origem = this.a.no(id);
    if (origem === undefined) throw new ErroConsulta("nao_encontrado", "nó não encontrado");
    garantir(id, origem.rotulo, origem.tipo);
    let fronteira = [id];
    let truncado = false;
    const vistas = new Set<string>();
    for (let nivel = 0; nivel < prof && fronteira.length > 0; nivel++) {
      const proxima: string[] = [];
      for (const n of fronteira) {
        for (const v of this.a.vizinhos(n, { direcao, limite: lim })) {
          const chave = `${v.aresta.de}|${v.aresta.para}|${v.aresta.tipo}`;
          if (vistas.has(chave)) continue;
          if (nos.length >= lim) {
            truncado = true;
            break;
          }
          vistas.add(chave);
          const outro = v.aresta.de === n ? v.aresta.para : v.aresta.de;
          const fresco = !idx.has(outro);
          const di = garantir(v.aresta.de, v.aresta.de === outro ? v.no.rotulo : (this.a.no(v.aresta.de)?.rotulo ?? v.aresta.de.slice(v.aresta.de.indexOf(":") + 1)), tipoDe(v.aresta.de));
          const pi = garantir(v.aresta.para, v.aresta.para === outro ? v.no.rotulo : (this.a.no(v.aresta.para)?.rotulo ?? v.aresta.para.slice(v.aresta.para.indexOf(":") + 1)), tipoDe(v.aresta.para));
          arestas.push([di, pi, v.aresta.tipo as TipoArestaIpc, v.aresta.confianca === "exata" ? 1 : 0, v.aresta.peso]);
          if (fresco) proxima.push(outro);
        }
      }
      fronteira = proxima;
    }
    return { origem: id, nos, arestas, truncado };
  }

  no(noId: string): NoDetalheMapa | null {
    const id = validarIdNo(noId);
    const n = this.a.no(id);
    if (n === undefined) return null;
    const caminho = arquivoDoId(id);
    let arquivo: NoDetalheMapa["arquivo"] = null;
    if (caminho !== null) {
      const l = this.a.banco.consultarUm<{
        linguagem: string; loc: number | null; loc_codigo: number | null; complexidade_max: number | null; complexidade_total: number | null; e_teste: number; e_gerado: number; degradado: number; modulo: string;
        camada: number | null; ciclo_id: number | null; pagerank: number | null; churn_total: number | null; churn_janela: number | null; autores_n: number | null; criado_git: string | null;
        ultima_alt: string | null; commits_correcao: number | null; cobertura_estado: string | null;
      }>(
        "SELECT linguagem, loc, loc_codigo, complexidade_max, complexidade_total, e_teste, e_gerado, degradado, modulo, camada, ciclo_id, pagerank, churn_total, churn_janela, autores_n, criado_git, ultima_alt, commits_correcao, cobertura_estado FROM arquivo WHERE caminho = ?",
        [caminho],
      );
      if (l !== undefined) arquivo = { ...l, e_teste: l.e_teste === 1, e_gerado: l.e_gerado === 1, degradado: l.degradado === 1 };
    }
    const mapa = (v: { aresta: { de: string; para: string; tipo: string; confianca: string; peso: number; evidencias: string[] | null; linha: number | null; arquivo_id: number | null }; no: { id: string; rotulo: string; tipo: string } }, lado: "de" | "para"): VizinhoMapa => {
      const outroId = lado === "de" ? v.aresta.para : v.aresta.de;
      const arq = arquivoDoId(outroId);
      return { id: outroId, rotulo: v.no.rotulo, tipo: v.no.tipo as TipoNoIpc, aresta: v.aresta.tipo as TipoArestaIpc, confianca: v.aresta.confianca as ConfiancaIpc, peso: v.aresta.peso, evidencia: v.aresta.evidencias?.[0] ?? (arq !== null && v.aresta.linha !== null ? `${arq}:${v.aresta.linha}` : null) };
    };
    const tiposUso = [...USO_ARQUIVO, ...USO_SIMBOLO, "aciona"] as TipoAresta[];
    const chamadores = this.a.vizinhos(id, { direcao: "entrada", tipos: tiposUso, limite: 50 }).map((v) => mapa(v, "para"));
    const chamados = this.a.vizinhos(id, { direcao: "saida", tipos: [...tiposUso, "le_tabela", "escreve_tabela"] as TipoAresta[], limite: 50 }).map((v) => mapa(v, "de"));
    const contar = (coluna: "de" | "para"): number => Number(this.a.banco.consultarUm<{ n: number }>(`SELECT COUNT(*) AS n FROM aresta WHERE ${coluna} = ? AND tipo IN (${tiposUso.map(() => "?").join(",")})`, [id, ...tiposUso])?.n ?? 0);
    return {
      id: n.id,
      tipo: n.tipo,
      subtipo: n.subtipo,
      rotulo: n.rotulo,
      caminho,
      linha_ini: n.linha_ini,
      linha_fim: n.linha_fim,
      exportado: n.exportado,
      atributos: n.atributos,
      arquivo,
      chamadores,
      chamados,
      chamadores_total: contar("para"),
      chamados_total: contar("de"),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // fluxo

  fluxo(entradaId: string, profundidade = 6, minConfianca?: ConfiancaIpc): FluxoMapaIpc {
    const id = validarIdNo(entradaId);
    this.pronto();
    const prof = limitar(profundidade, 6, 10);
    if (this.a.no(id) === undefined) throw new ErroConsulta("nao_encontrado", "entrada não encontrada");
    const arestas = this.coletarSaida(id, prof, minConfianca === "exata");
    const r = calcularFluxo(arestas, id, { profundidade: prof, maxNos: LIMITE_FLUXO_NOS, ...(minConfianca !== undefined ? { minConfianca } : {}) });
    const ids = r.nos.map((n) => n.id);
    const rotulos = new Map<string, { rotulo: string; tipo: string; linha: number | null }>();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const parte = ids.slice(i, i + CHUNK);
      for (const l of this.a.banco.consultar<{ id: string; rotulo: string; tipo: string; linha_ini: number | null }>(`SELECT id, rotulo, tipo, linha_ini FROM no WHERE id IN (${parte.map(() => "?").join(",")})`, parte)) rotulos.set(l.id, { rotulo: l.rotulo, tipo: l.tipo, linha: l.linha_ini });
    }
    const nos: NoFluxoMapa[] = r.nos.map((n) => {
      const info = rotulos.get(n.id);
      return { id: n.id, rotulo: info?.rotulo ?? n.id.slice(n.id.indexOf(":") + 1), tipo: (info?.tipo as TipoNoIpc | undefined) ?? tipoDe(n.id), nivel: n.nivel, tracejado: n.tracejado, externo: n.externo, em_ciclo: n.em_ciclo, tabelas: n.tabelas, caminho: arquivoDoId(n.id), linha: info?.linha ?? null };
    });
    return { raiz: r.raiz, nos, arestas: r.arestas.map((e) => [e.de, e.para, e.tipo as TipoArestaIpc, e.confianca === "exata" ? 1 : 0, e.retorno ? 1 : 0]), tabelas: r.tabelas, externos: r.externos, truncado: r.truncado };
  }

  /** Arestas de saída (aciona/chama/instancia/tabelas) até a profundidade, por consultas em fatias sobre o índice `aresta_de`. */
  private coletarSaida(raiz: string, profundidade: number, soExatas: boolean): ArestaFluxoEntrada[] {
    const tipos = ["aciona", "chama", "instancia", "le_tabela", "escreve_tabela"];
    const saida: ArestaFluxoEntrada[] = [];
    const vistos = new Set<string>([raiz]);
    let fronteira = [raiz];
    for (let nivel = 0; nivel <= profundidade && fronteira.length > 0 && vistos.size <= LIMITE_FLUXO_NOS * 3; nivel++) {
      const proxima: string[] = [];
      for (let i = 0; i < fronteira.length; i += CHUNK) {
        const parte = fronteira.slice(i, i + CHUNK);
        const rows = this.a.banco.consultar<{ de: string; para: string; tipo: string; confianca: string }>(
          `SELECT de, para, tipo, confianca FROM aresta WHERE de IN (${parte.map(() => "?").join(",")}) AND tipo IN (${tipos.map(() => "?").join(",")})${soExatas ? " AND confianca = 'exata'" : ""}`,
          [...parte, ...tipos],
        );
        for (const e of rows) {
          saida.push({ tipo: e.tipo, de: e.de, para: e.para, confianca: e.confianca as ConfiancaIpc });
          if (!vistos.has(e.para) && !e.para.startsWith("ext:") && !e.para.startsWith("tab:")) {
            vistos.add(e.para);
            proxima.push(e.para);
          }
        }
      }
      fronteira = proxima;
    }
    return saida;
  }

  // ---------------------------------------------------------------------------------------------
  // análises

  analise<T extends TipoAnaliseMapa>(tipo: T, p: ParametrosAnaliseMapa = {}): ResultadoAnaliseMapa<T> {
    if (!(TIPOS_ANALISE_MAPA as readonly string[]).includes(tipo)) throw new ErroConsulta("argumento_invalido", "tipo de análise inválido");
    const versao = this.a.versaoMapa();
    const cache = this.a.lerAnaliseCache<DadosAnaliseMapa[T]>(`analise:${tipo}`);
    let dados = cache ?? vazioDe(tipo);
    let truncado = false;
    const limite = p.limite === undefined ? undefined : limitar(p.limite, 100, 5000);
    const pasta = p.pasta === undefined ? null : validarCaminhoRelativo(p.pasta);
    const noPrefixo = (c: string): boolean => pasta === null || c === pasta || c.startsWith(`${pasta}/`);
    const cortar = <X>(l: X[]): X[] => {
      if (limite !== undefined && l.length > limite) {
        truncado = true;
        return l.slice(0, limite);
      }
      return l;
    };
    switch (tipo) {
      case "hotspots": {
        const d = dados as DadosAnaliseMapa["hotspots"];
        dados = { disponivel: d.disponivel, itens: cortar(d.itens.filter((h) => noPrefixo(h.caminho))) } as DadosAnaliseMapa[T];
        break;
      }
      case "mortos": {
        const d = dados as DadosAnaliseMapa["mortos"];
        dados = { ...d, itens: cortar(d.itens.filter((m) => noPrefixo(m.caminho))) } as DadosAnaliseMapa[T];
        break;
      }
      case "sem_teste": {
        const d = dados as DadosAnaliseMapa["sem_teste"];
        dados = { itens: cortar(d.itens.filter((m) => noPrefixo(m.caminho))), por_pasta: d.por_pasta.filter((x) => noPrefixo(x.pasta)) } as DadosAnaliseMapa[T];
        break;
      }
      case "entradas": {
        const d = dados as DadosAnaliseMapa["entradas"];
        dados = { itens: cortar(d.itens.filter((e) => noPrefixo(e.caminho))), por_categoria: d.por_categoria } as DadosAnaliseMapa[T];
        break;
      }
      case "dados": {
        const d = dados as DadosAnaliseMapa["dados"];
        const alvo = p.tabela === undefined ? null : p.tabela.toLowerCase().replace(/^tab:/, "");
        dados = { tabelas: cortar(d.tabelas.filter((t) => alvo === null || t.nome === alvo)) } as DadosAnaliseMapa[T];
        break;
      }
      case "ciclos": {
        const d = dados as DadosAnaliseMapa["ciclos"];
        dados = { ciclos: cortar(d.ciclos), total: d.total } as DadosAnaliseMapa[T];
        break;
      }
      case "externas": {
        const d = dados as DadosAnaliseMapa["externas"];
        dados = { ...d, itens: cortar(d.itens) } as DadosAnaliseMapa[T];
        break;
      }
      case "duplicacao": {
        const d = dados as DadosAnaliseMapa["duplicacao"];
        dados = { ...d, clones: cortar(d.clones) } as DadosAnaliseMapa[T];
        break;
      }
      default:
        break;
    }
    return { tipo, versao_mapa: versao, truncado, dados };
  }

  perfil(): PerfilProvisorioMapa {
    const p = this.a.lerAnaliseCache<PerfilProvisorioMapa>("saida:perfil");
    if (p === null) throw new ErroConsulta("mapa_nao_pronto", "perfil indisponível: analise o projeto primeiro");
    return p;
  }

  // ---------------------------------------------------------------------------------------------
  // busca

  buscar(texto: string, tipos?: readonly TipoNoIpc[], limite?: number): ResultadoBuscaMapa[] {
    if (typeof texto !== "string" || texto.trim() === "" || texto.length > 200) return [];
    const lim = limitar(limite, 20, LIMITE_BUSCA_MAX);
    const ns = this.a.buscar(texto, { limite: lim, ...(tipos !== undefined && tipos.length > 0 ? { tipos: tipos as readonly TipoNo[] } : {}) });
    return ns.map((n) => {
      const caminho = arquivoDoId(n.id);
      return { id: n.id, rotulo: n.rotulo, tipo: n.tipo, subtipo: n.subtipo, caminho, linha: n.linha_ini };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // raio

  raio(arquivosBruto: readonly string[], simbolos?: readonly string[]): RaioMapaIpc {
    this.pronto();
    if (!Array.isArray(arquivosBruto) || arquivosBruto.length === 0 || arquivosBruto.length > LIMITE_RAIO_ARQUIVOS) throw new ErroConsulta("argumento_invalido", `informe de 1 a ${LIMITE_RAIO_ARQUIVOS} arquivos`);
    const alvos = [...new Set(arquivosBruto.map((c) => validarCaminhoRelativo(c)))];
    const simb = (simbolos ?? []).slice(0, LIMITE_RAIO_ARQUIVOS).map((s) => {
      if (typeof s !== "string" || s.length > 600 || s.includes("\0")) throw new ErroConsulta("argumento_invalido", "símbolo inválido");
      return s;
    });
    const db = this.a.banco;
    const ids: Array<{ id: number; caminho: string }> = [];
    for (const c of alvos) {
      const l = db.consultarUm<{ id: number }>("SELECT id FROM arquivo WHERE caminho = ?", [c]);
      if (l === undefined) throw new ErroConsulta("nao_encontrado", `arquivo não está no mapa: ${c}`);
      ids.push({ id: l.id, caminho: c });
    }
    // nós do alvo (arquivo + símbolos + entradas) e arestas de saída para tabelas
    const nosAlvo = new Set<string>(alvos.map((c) => `arq:${c}`));
    for (const { id } of ids) for (const l of db.consultar<{ id: string }>("SELECT id FROM no WHERE arquivo_id = ?", [id])) nosAlvo.add(l.id);
    const arestas: ArestaRaio[] = [];
    const vistosAresta = new Set<string>();
    const empurrar = (e: { de: string; para: string; tipo: string; confianca: string }): void => {
      const k = `${e.de}|${e.para}|${e.tipo}`;
      if (vistosAresta.has(k)) return;
      vistosAresta.add(k);
      arestas.push({ tipo: e.tipo, de: e.de, para: e.para, confianca: e.confianca as "exata" | "heuristica" });
    };
    const saidaAlvo = [...nosAlvo];
    for (let i = 0; i < saidaAlvo.length; i += CHUNK) {
      const parte = saidaAlvo.slice(i, i + CHUNK);
      for (const e of db.consultar<{ de: string; para: string; tipo: string; confianca: string }>(`SELECT de, para, tipo, confianca FROM aresta WHERE de IN (${parte.map(() => "?").join(",")}) AND tipo IN ('le_tabela','escreve_tabela')`, parte)) empurrar(e);
    }
    // fecho para cima (quem usa o alvo), em níveis, com tetos
    let fronteira = [...nosAlvo];
    const alcancados = new Set<string>(fronteira);
    const arquivosVistos = new Set<string>(alvos);
    for (let nivel = 0; nivel < MAX_NIVEIS_RAIO && fronteira.length > 0 && alcancados.size < MAX_NOS_RAIO; nivel++) {
      const proxima: string[] = [];
      for (let i = 0; i < fronteira.length; i += CHUNK) {
        const parte = fronteira.slice(i, i + CHUNK);
        const rows = db.consultar<{ de: string; para: string; tipo: string; confianca: string }>(`SELECT de, para, tipo, confianca FROM aresta WHERE para IN (${parte.map(() => "?").join(",")}) AND tipo IN (${USO_RAIO.map(() => "?").join(",")})`, [...parte, ...USO_RAIO]);
        for (const e of rows) {
          empurrar(e);
          const f = arquivoDoId(e.de);
          if (f !== null) arquivosVistos.add(f);
          if (!alcancados.has(e.de) && alcancados.size < MAX_NOS_RAIO) {
            alcancados.add(e.de);
            // sobe pelo ARQUIVO do chamador também (símbolo e arquivo são nós distintos no grafo)
            proxima.push(e.de);
            if (f !== null && !alcancados.has(`arq:${f}`)) {
              alcancados.add(`arq:${f}`);
              proxima.push(`arq:${f}`);
            }
          }
        }
      }
      fronteira = proxima;
    }
    // informações dos arquivos envolvidos
    const arquivosInfo = new Map<string, InfoArquivoRaio>();
    const lista = [...arquivosVistos];
    for (let i = 0; i < lista.length; i += CHUNK) {
      const parte = lista.slice(i, i + CHUNK);
      for (const l of db.consultar<{ caminho: string; e_teste: number; e_migracao: number; churn_total: number | null; churn_janela: number | null; commits_correcao: number | null; criado_git: string | null; ultima_alt: string | null }>(
        `SELECT caminho, e_teste, e_migracao, churn_total, churn_janela, commits_correcao, criado_git, ultima_alt FROM arquivo WHERE caminho IN (${parte.map(() => "?").join(",")})`,
        parte,
      )) {
        arquivosInfo.set(l.caminho, { e_teste: l.e_teste === 1, e_migracao: l.e_migracao === 1, churn_total: l.churn_total, churn_janela: l.churn_janela, commits_correcao: l.commits_correcao, criado_git: l.criado_git, ultima_alt: l.ultima_alt });
      }
    }
    // recursos dinâmicos nos alvos (reflexão, eval…): o grafo não os vê
    for (const { caminho } of ids) {
      const j = db.consultarUm<{ json: string }>("SELECT e.json AS json FROM extracao e JOIN arquivo a ON a.id = e.arquivo_id WHERE a.caminho = ?", [caminho]);
      if (j === undefined) continue;
      try {
        const e = JSON.parse(j.json) as Pick<Extracao, "dinamicos">;
        const info = arquivosInfo.get(caminho) ?? {};
        arquivosInfo.set(caminho, { ...info, dinamico: Array.isArray(e.dinamicos) && e.dinamicos.length > 0 });
      } catch {
        /* extração ilegível: ignora */
      }
    }
    const cobertura = new Map<string, { estado: "existente" | "parcial" | "ausente" | "nao_aplicavel"; fonte: "estimada" | "medida" }>();
    for (const { caminho } of ids) {
      const l = db.consultarUm<{ cobertura_estado: string | null; cobertura_fonte: string | null }>("SELECT cobertura_estado, cobertura_fonte FROM arquivo WHERE caminho = ?", [caminho]);
      if (l?.cobertura_estado != null) cobertura.set(caminho, { estado: l.cobertura_estado as "existente", fonte: (l.cobertura_fonte as "estimada" | "medida" | null) ?? "estimada" });
    }
    const entradasIds = [...alcancados].filter((x) => x.startsWith("ent:"));
    const entradas: Array<{ id: string; subtipo: "main" | "rota" | "cli" | "job" | "handler" | "fila" | "webhook" | "evento"; chave: string; caminho: string }> = [];
    for (let i = 0; i < entradasIds.length; i += CHUNK) {
      const parte = entradasIds.slice(i, i + CHUNK);
      for (const l of db.consultar<{ id: string; subtipo: string; rotulo: string }>(`SELECT id, subtipo, rotulo FROM no WHERE id IN (${parte.map(() => "?").join(",")})`, parte)) {
        const caminho = arquivoDoId(l.id);
        if (caminho !== null) entradas.push({ id: l.id, subtipo: l.subtipo as "rota", chave: l.rotulo, caminho });
      }
    }
    const zonas = this.a.lerAnaliseCache<DadosAnaliseMapa["zonas"]>("analise:zonas")?.zonas ?? [];
    const dados = this.a.lerAnaliseCache<DadosAnaliseMapa["dados"]>("analise:dados");
    const definidaEm = new Map<string, string[]>();
    for (const t of dados?.tabelas ?? []) definidaEm.set(t.nome, t.definida_em.map((d) => d.replace(/:\d+$/, "")));
    const resolucao = this.a.lerAnaliseCache<{ chamadas_ambiguas: number }>("resolucao");
    const historia = (this.a.lerMeta("historia") as "ok" | "parcial" | "indisponivel" | null) ?? "indisponivel";
    const r = calcularRaio(
      { arquivos: alvos, simbolos: simb },
      { arestas, arquivos: arquivosInfo, entradas, cobertura, zonasCandidatas: zonas.map((z) => ({ categoria: z.categoria as "financeiro", pastas: z.pastas, arquivos: z.arquivos, tabelas: z.tabelas })), historia, tabelasDefinidasEm: definidaEm, chamadasAmbiguas: resolucao?.chamadas_ambiguas ?? 0, versaoExtrator: VERSAO_EXTRATOR },
      limiaresPadrao,
    );
    return {
      arquivos: r.arquivos,
      sinais: r.sinais.map((s) => ({ id: s.id, nome: s.nome, min: s.min, max: s.max, valor: s.valor, metodo: s.metodo, pior_caso: s.pior_caso })),
      faixa: r.faixa,
      faixa_pior_caso: r.faixa_pior_caso,
      pior_caso: r.pior_caso,
      candidatos_costura: r.candidatos_costura,
      nota: r.nota ?? NOTA_RAIO,
      chamadores: r.detalhes.chamadores_max.slice(0, 200),
      alcance_transitivo: r.detalhes.alcance_transitivo,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // layout (cache de posições)

  layoutLer(chave: string): { nivel: string; posicoes: number[] } | null {
    if (!/^[A-Za-z0-9._:|-]{1,120}$/.test(chave)) throw new ErroConsulta("argumento_invalido", "chave de layout inválida");
    const l = this.a.banco.consultarUm<{ nivel: string; posicoes: Uint8Array | null }>("SELECT nivel, posicoes FROM layout_cache WHERE chave = ?", [chave]);
    if (l === undefined || l.posicoes === null) return null;
    const bytes = l.posicoes;
    const f = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength - (bytes.byteLength % 4)));
    return { nivel: l.nivel, posicoes: Array.from(f) };
  }

  layoutGravar(chave: string, nivel: string, posicoes: readonly number[]): void {
    if (!/^[A-Za-z0-9._:|-]{1,120}$/.test(chave)) throw new ErroConsulta("argumento_invalido", "chave de layout inválida");
    if (!["modulo", "arquivo", "simbolo", "fluxo"].includes(nivel)) throw new ErroConsulta("argumento_invalido", "nível de layout inválido");
    if (!Array.isArray(posicoes) || posicoes.length > 2 * LIMITE_GRAFO_MAX || posicoes.some((n) => typeof n !== "number" || !Number.isFinite(n))) throw new ErroConsulta("argumento_invalido", "posições inválidas");
    const f = Float32Array.from(posicoes);
    this.a.banco.executar("INSERT INTO layout_cache (chave, nivel, posicoes, criado_em) VALUES (?,?,?,?) ON CONFLICT(chave) DO UPDATE SET nivel = excluded.nivel, posicoes = excluded.posicoes, criado_em = excluded.criado_em", [chave, nivel, new Uint8Array(f.buffer), new Date().toISOString()]);
    // o cache de layout é pequeno e descartável: mantém só os 20 mais recentes
    this.a.banco.executar("DELETE FROM layout_cache WHERE chave NOT IN (SELECT chave FROM layout_cache ORDER BY criado_em DESC LIMIT 20)");
  }
}
