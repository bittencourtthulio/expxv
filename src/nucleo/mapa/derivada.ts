import { basename } from "node:path";
import type { ConfigMapa, DadosAnaliseMapa, FaseProgressoMapa } from "../../compartilhado/mapa";
import type { Armazem } from "./armazem";
import { RESOLVEDORES_PADRAO } from "./analisador";
import { calcularCamadas, type CamadaManual } from "./analises/camadas";
import { analisarDados, definicoesDeTexto, type DefinicaoTabela } from "./analises/dados";
import { analisarPatrimonioDuplicacao } from "./derivada-duplicacao";
import { agregarEntradas, type ManifestoEntradas } from "./analises/entradas";
import { analisarExternas, type DependenciaDeclarada } from "./analises/externas";
import { calcularHotspots, type EntradaHotspot, type ParceiroAcoplamento } from "./analises/hotspots";
import { candidatosMortos, ROTULO_CANDIDATO } from "./analises/morto";
import { analisarPadroes, type ResultadoPadroes } from "./analises/padroes";
import { analisarTestes, resumoPorEstado } from "./analises/testes";
import type { ArquivoMapa } from "./analises/tipos";
import { zonasCandidatas } from "./analises/zonas";
import { resolverChamadas } from "./chamadas";
import { CAMINHOS_RELATORIO_CONHECIDOS, casarCaminhos, detectarFormato, lerCoberturaTexto, type CoberturaCasada } from "./cobertura";
import { criarLeitorConfinado, type LeitorConfinado } from "./confinado";
import { coletarHistoria } from "./git-historia";
import { ciclos as calcularCiclos, componentesFortes } from "./grafo/ciclos";
import { construirGrafo } from "./grafo/memoria";
import { niveisTopologicos } from "./grafo/camadas";
import { pageRank } from "./grafo/pagerank";
import { aplicarLocks, ehLock, lerLock, lerManifesto, type Lock, type Manifesto } from "./manifestos";
import { avaliarRegras, ehArquivoDeRegras, importarRegras, type ViolacaoFronteira } from "./regras-fronteira";
import { resolverTodos, type ArquivoParaResolver } from "./resolucao/comum";
import type { Aresta, Extracao, Linguagem } from "./tipos";
import { MAX_EVIDENCIAS } from "./tipos";

// Fase DERIVADA do mapa (T-17.21): tudo que depende do conjunto inteiro de arquivos já extraídos. Roda numa thread própria
// (`worker-derivada.ts`) para o main nunca passar de 50 ms; em testes roda no processo. Lê as extrações do armazém, resolve
// imports (manifestos/tsconfig/etc. por leitor CONFINADO e somente leitura) e chamadas, calcula entradas, dados, testes,
// história git, ciclos, camadas, PageRank, hotspots, candidatos a código morto, externas, zonas e dialetos, grava as arestas no
// armazém e deixa as análises prontas em `analise_cache` (formato de `DadosAnaliseMapa`) para as consultas serem O(leitura).
// Nunca executa código do projeto analisado, nunca abre arquivo de ambiente/chave, nunca usa a rede.

export const CHAVE_META_DERIVADA = "derivada_versao";
export const CHAVE_META_MANIFESTOS = "manifestos";
export const CHAVE_META_LOCKS = "locks";
const LIMITES = { ciclos: 200, noPorCiclo: 100, mortos: 2000, hotspots: 300, semTeste: 3000, entradas: 5000, tabelas: 1000, toques: 20, clones: 200, dsm: 200 } as const;
const MAX_TEXTO = 8_000_000;

export interface ContextoDerivado {
  arquivos: ArquivoMapa[];
  manifestos: Manifesto[];
  analises: DadosAnaliseMapa;
  violacoes_regras: ViolacaoFronteira[];
  cobertura: CoberturaCasada[];
  historia: "ok" | "parcial" | "indisponivel";
  avisos: string[];
  versao_mapa: number;
  padroes: ResultadoPadroes;
  /** Data de criação (ms epoch, do git) por caminho. */
  criado: ReadonlyMap<string, number>;
}

export interface OpcoesDerivada {
  /** Raiz absoluta do workspace (só para ler arquivos auxiliares e para o `git log`). */
  raiz: string;
  config: ConfigMapa;
  /** Caminhos relativos de manifestos e locks, vistos na varredura. */
  manifestos?: readonly string[];
  locks?: readonly string[];
  historia?: boolean;
  camadasManual?: readonly CamadaManual[];
  signal?: AbortSignal;
  progresso?: (fase: FaseProgressoMapa, feito: number, total: number) => void;
  agora?: Date;
  /** Substitui o leitor confinado (testes). */
  leitor?: LeitorConfinado;
  /** Observa o fim de cada etapa (nome, ms): diagnóstico de desempenho e de memória. */
  aoMarcar?: (nome: string, ms: number) => void;
  /** Chamado ao final com tudo o que foi calculado (pacote de contexto, perfil, inventário). */
  aoConcluir?: (ctx: ContextoDerivado) => void | Promise<void>;
}

export interface ResultadoDerivada {
  versao_mapa: number;
  arestas: { exata: number; heuristica: number };
  historia: "ok" | "parcial" | "indisponivel";
  nos_alterados: number;
  avisos: string[];
  cancelado: boolean;
  ms: Record<string, number>;
}

const cede = (): Promise<void> => new Promise((r) => setImmediate(r));

class Cancelado extends Error {}

function exigirAtivo(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new Cancelado();
}

const idDe = (id: string): string | null => {
  if (id.startsWith("arq:")) return id.slice(4);
  if (id.startsWith("sim:") || id.startsWith("ent:")) {
    const r = id.slice(4);
    const i = r.indexOf("#");
    return i < 0 ? r : r.slice(0, i);
  }
  return null;
};

function ordenarPorCaminho<T extends { caminho: string }>(l: T[]): T[] {
  return l.sort((a, b) => (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0));
}

export async function executarFaseDerivada(armazem: Armazem, op: OpcoesDerivada): Promise<ResultadoDerivada> {
  const ms: Record<string, number> = {};
  const marca = (nome: string, t0: number): void => {
    ms[nome] = Math.round((performance.now() - t0) * 10) / 10;
    op.aoMarcar?.(nome, ms[nome] as number);
  };
  const avisos: string[] = [];
  const progresso = (fase: FaseProgressoMapa, feito: number, total: number): void => op.progresso?.(fase, feito, total);
  const agora = op.agora ?? new Date();
  const banco = armazem.banco;
  const leitor = op.leitor ?? criarLeitorConfinado(op.raiz, { tetoBytes: MAX_TEXTO });
  try {
    // ---- 0. nós e arestas próprias dos arquivos gravados sem grafo (análises grandes: o main só gravou `arquivo`+`extracao`)
    let t0 = performance.now();
    await armazem.completarGrafos({ aoProgresso: (n) => progresso("resolvendo", n, 0) });
    exigirAtivo(op.signal);
    marca("completar_grafos", t0);

    // ---- 1. extrações do armazém --------------------------------------------------------------------------------------------
    t0 = performance.now();
    const total = Number(banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM extracao")?.n ?? 0);
    const arquivos: ArquivoMapa[] = [];
    const idPorCaminho = new Map<string, number>();
    const moduloPorCaminho = new Map<string, string>();
    // lê em PÁGINAS: o texto JSON de cada extração é transitório (só o objeto fica), o que segura o pico de memória em repositórios grandes
    let ultimoId = 0;
    for (;;) {
      const pagina = banco.consultar<{ id: number; caminho: string; modulo: string; json: string }>(
        "SELECT a.id, a.caminho, a.modulo, e.json AS json FROM arquivo a JOIN extracao e ON e.arquivo_id = a.id WHERE a.id > ? ORDER BY a.id LIMIT 250",
        [ultimoId],
      );
      if (pagina.length === 0) break;
      for (const l of pagina) {
        ultimoId = l.id;
        idPorCaminho.set(l.caminho, l.id);
        moduloPorCaminho.set(l.caminho, l.modulo);
        try {
          arquivos.push({ caminho: l.caminho, modulo: l.modulo, extracao: JSON.parse(l.json) as Extracao });
        } catch {
          avisos.push(`extração ilegível: ${l.caminho}`);
        }
      }
      progresso("resolvendo", arquivos.length, total);
      exigirAtivo(op.signal);
      await cede();
    }
    // ordem estável por caminho: as análises não dependem da ordem de inserção no banco
    arquivos.sort((x, y) => (x.caminho < y.caminho ? -1 : x.caminho > y.caminho ? 1 : 0));
    marca("carregar", t0);
    const porCaminho = new Map(arquivos.map((a) => [a.caminho, a]));
    // arquivos degradados (`outra`) não entram na resolução de imports nem nas chamadas
    const codigo = arquivos.filter((a) => a.extracao.linguagem !== "outra");

    // ---- 2. manifestos e locks (somente leitura, confinados) ----------------------------------------------------------------
    t0 = performance.now();
    const listaManifestos = op.manifestos ?? JSON.parse(armazem.lerMeta(CHAVE_META_MANIFESTOS) ?? "[]");
    const listaLocks = op.locks ?? JSON.parse(armazem.lerMeta(CHAVE_META_LOCKS) ?? "[]");
    const manifestos: Manifesto[] = [];
    const locks: Lock[] = [];
    const textosRegras: Array<{ caminho: string; texto: string }> = [];
    for (const c of listaManifestos as string[]) {
      const texto = leitor.ler(c);
      if (texto === null) continue;
      const m = lerManifesto(c, texto);
      if (m !== null) manifestos.push(m);
      if (ehArquivoDeRegras(c)) textosRegras.push({ caminho: c, texto });
    }
    for (const c of listaLocks as string[]) {
      if (!ehLock(c)) continue;
      const texto = leitor.ler(c);
      if (texto === null) continue;
      const l = lerLock(c, texto);
      if (l !== null) locks.push(l);
    }
    aplicarLocks(manifestos, locks);
    // regras de fronteira também vivem em arquivos que não são "manifesto" na varredura (.importlinter, deptrac.yaml...)
    const regrasEnt = importarRegras(textosRegras);
    avisos.push(...regrasEnt.avisos.slice(0, 5));
    marca("manifestos", t0);
    exigirAtivo(op.signal);

    // ---- 3. imports -----------------------------------------------------------------------------------------------------------
    t0 = performance.now();
    const mapaResolver = new Map<string, ArquivoParaResolver>(codigo.map((a) => [a.caminho, { caminho: a.caminho, linguagem: a.extracao.linguagem as Linguagem, extracao: a.extracao }]));
    const resolucao = resolverTodos(RESOLVEDORES_PADRAO, { arquivos: mapaResolver, manifestos, raiz: leitor.raiz, lerTexto: (c) => leitor.ler(c), existe: (c) => leitor.existe(c) });
    marca("imports", t0);
    progresso("resolvendo", arquivos.length, arquivos.length);
    await cede();
    exigirAtivo(op.signal);

    // ---- 4. chamadas ------------------------------------------------------------------------------------------------------------
    t0 = performance.now();
    let chamadas: ReturnType<typeof resolverChamadas> | null = resolverChamadas({ arquivos: mapaResolver, ligacoes: resolucao.ligacoes });
    marca("chamadas", t0);
    await cede();
    exigirAtivo(op.signal);

    // ---- 5. entradas, dados, testes ---------------------------------------------------------------------------------------------
    t0 = performance.now();
    const manifestosEntradas: ManifestoEntradas[] = manifestos
      .filter((m) => m.tipo === "package.json")
      .map((m) => {
        const bin: Record<string, string> = {};
        for (const b of m.bin) bin[basename(b).replace(/\.[^.]+$/, "")] = m.pasta === "" ? b : `${m.pasta}/${b}`;
        const scripts: Record<string, string> = {};
        for (const c of m.comandos) scripts[c.nome] = c.comando;
        const base: ManifestoEntradas = { caminho: m.arquivo, bin, scripts };
        if (m.main !== null) base.main = m.pasta === "" ? m.main : `${m.pasta}/${m.main}`;
        return base;
      });
    const entradasR = agregarEntradas(arquivos, { manifestos: manifestosEntradas });
    const definicoes: DefinicaoTabela[] = [];
    for (const a of arquivos) {
      if (a.extracao.linguagem === "outra" || /\.(sql|prisma)$/i.test(a.caminho) || /(^|\/)schema\.rb$/.test(a.caminho)) {
        if (!/\.(sql|prisma)$/i.test(a.caminho) && !/(^|\/)schema\.rb$/.test(a.caminho)) continue;
        const t = leitor.ler(a.caminho);
        if (t !== null) definicoes.push(...definicoesDeTexto(a.caminho, t));
      }
    }
    const dados = analisarDados(arquivos, { definicoes });
    const importaArestas = resolucao.arestas.filter((a) => a.para.startsWith("arq:"));
    // cobertura medida (relatórios conhecidos, somente leitura)
    const cobertura: CoberturaCasada[] = [];
    for (const rel of CAMINHOS_RELATORIO_CONHECIDOS) {
      const texto = leitor.ler(rel);
      if (texto === null) continue;
      const formato = detectarFormato(rel, texto);
      if (formato === null) continue;
      try {
        cobertura.push(...casarCaminhos(lerCoberturaTexto(formato, texto), arquivos.map((a) => a.caminho), leitor.raiz));
      } catch {
        avisos.push(`relatório de cobertura ilegível: ${rel}`);
      }
    }
    const testes = analisarTestes(arquivos, { importa: importaArestas.map((a) => ({ de: a.de, para: a.para, confianca: a.confianca, linha: a.linha })), ...(cobertura.length > 0 ? { cobertura } : {}) });
    marca("entradas_dados_testes", t0);
    await cede();
    exigirAtivo(op.signal);

    // ---- 6. gravação das arestas e nós -----------------------------------------------------------------------------------------
    t0 = performance.now();
    const arqId = (caminho: string | null | undefined): number | null => (caminho == null ? null : (idPorCaminho.get(caminho) ?? null));
    const evid = (ev: readonly string[] | undefined | null): string[] | null => (ev == null ? null : ev.slice(0, MAX_EVIDENCIAS));
    const nosExternos = new Map<string, { eco: string; nome: string }>();
    const registrarExterno = (id: string): void => {
      if (!id.startsWith("ext:") || nosExternos.has(id)) return;
      const r = id.slice(4);
      const i = r.indexOf(":");
      nosExternos.set(id, { eco: i < 0 ? "sistema" : r.slice(0, i), nome: i < 0 ? r : r.slice(i + 1) });
    };
    const arestasImporta: Aresta[] = resolucao.arestas.map((a) => {
      registrarExterno(a.para);
      return { tipo: a.tipo, de: a.de, para: a.para, confianca: a.confianca, peso: a.peso, candidatos: null, fonte: "regra", arquivo_id: arqId(idDe(a.de)), linha: a.linha, evidencias: [`${idDe(a.de)}:${a.linha}`] };
    });
    const arestasChamada: Aresta[] = (chamadas as ReturnType<typeof resolverChamadas>).arestas.map((a) => {
      registrarExterno(a.para);
      return { tipo: a.tipo, de: a.de, para: a.para, confianca: a.confianca, peso: a.peso, candidatos: a.candidatos, fonte: "regra", arquivo_id: arqId(a.arquivo), linha: a.linha, evidencias: evid(a.evidencias) };
    });
    const chamadasAmbiguasN = (chamadas as ReturnType<typeof resolverChamadas>).chamadas_ambiguas;
    const naoResolvidosN = resolucao.nao_resolvidos.length;
    const ignoradosN = resolucao.ignorados;
    chamadas = null; // libera o resultado intermediário (memória, P-244)
    const arestasAciona: Aresta[] = entradasR.arestas.map((a) => ({ ...a, arquivo_id: arqId(idDe(a.de)) }));
    const arestasDados: Aresta[] = dados.arestas.map((a) => ({ ...a, arquivo_id: arqId(idDe(a.de)) }));
    const arestasTesta: Aresta[] = testes.arestas.map((a) => ({ ...a, arquivo_id: arqId(idDe(a.de)) }));
    banco.transacao((tx) => {
      // nós externos, tabelas e entradas são recriados por completo (derivados do conjunto todo)
      tx.executar("DELETE FROM no WHERE tipo IN ('externo','tabela','entrada')");
      for (const [id, e] of nosExternos) tx.executar("INSERT OR REPLACE INTO no (id, tipo, subtipo, rotulo) VALUES (?,?,?,?)", [id, "externo", e.eco, e.nome]);
      for (const nome of dados.tabelas.keys()) tx.executar("INSERT OR REPLACE INTO no (id, tipo, subtipo, rotulo) VALUES (?,?,?,?)", [`tab:${nome}`, "tabela", null, nome]);
      for (const a of dados.arestas) if (!dados.tabelas.has(a.para.replace(/^tab:/, ""))) tx.executar("INSERT OR IGNORE INTO no (id, tipo, subtipo, rotulo) VALUES (?,?,?,?)", [a.para, "tabela", null, a.para.replace(/^tab:/, "")]);
      for (const e of entradasR.entradas) tx.executar("INSERT OR REPLACE INTO no (id, tipo, subtipo, rotulo, arquivo_id, linha_ini, linha_fim, exportado, atributos) VALUES (?,?,?,?,?,?,?,?,?)", [e.id, "entrada", e.subtipo, e.chave, arqId(e.caminho), e.linha, e.linha, null, JSON.stringify({ fw: e.framework, c: e.confianca })]);
    });
    armazem.substituirArestas({ tipos: ["importa", "reexporta"] }, arestasImporta);
    armazem.substituirArestas({ tipos: ["chama", "instancia", "referencia", "herda", "implementa"] }, arestasChamada);
    armazem.substituirArestas({ tipos: ["aciona"] }, arestasAciona);
    armazem.substituirArestas({ tipos: ["le_tabela", "escreve_tabela"] }, arestasDados);
    armazem.substituirArestas({ tipos: ["testa"] }, arestasTesta);
    marca("gravar_arestas", t0);
    await cede();
    exigirAtivo(op.signal);

    // ---- 7. história git ----------------------------------------------------------------------------------------------------------
    t0 = performance.now();
    let estadoHistoria: "ok" | "parcial" | "indisponivel" = (armazem.lerMeta("historia") as "ok" | "parcial" | "indisponivel" | null) ?? "indisponivel";
    if (op.historia === true) {
      progresso("historia", 0, 1);
      const h = await coletarHistoria({ raiz: leitor.raiz, janelaDias: op.config.historia_janela_dias, maxCommits: op.config.historia_max_commits, ...(op.signal !== undefined ? { signal: op.signal } : {}), agora });
      exigirAtivo(op.signal);
      estadoHistoria = h.estado;
      if (h.motivo !== null) avisos.push(`história git: ${h.motivo}`);
      banco.transacao((tx) => {
        tx.executar("UPDATE arquivo SET churn_total = NULL, churn_janela = NULL, autores_n = NULL, criado_git = NULL, ultima_alt = NULL, commits_correcao = NULL");
        const up = tx.preparar("UPDATE arquivo SET churn_total = ?, churn_janela = ?, autores_n = ?, criado_git = ?, ultima_alt = ?, commits_correcao = ? WHERE caminho = ?");
        for (const [c, x] of h.arquivos) up.executar([x.churn_total, x.churn_janela, x.autores_n, x.criado_git, x.ultima_alt, x.commits_correcao, c]);
        tx.executar("DELETE FROM acoplamento_temporal");
        const ins = tx.preparar("INSERT OR REPLACE INTO acoplamento_temporal (a, b, co_alteracoes, grau) VALUES (?,?,?,?)");
        for (const p of h.acoplamento) {
          const a = idPorCaminho.get(p.a);
          const b = idPorCaminho.get(p.b);
          if (a !== undefined && b !== undefined) ins.executar([a, b, p.co_alteracoes, p.grau]);
        }
      });
      progresso("historia", 1, 1);
    }
    marca("historia", t0);

    // ---- 8. grafo de arquivos: SCC, PageRank, camadas ----------------------------------------------------------------------
    t0 = performance.now();
    progresso("analises", 0, 8);
    const idsArquivos = arquivos.map((a) => `arq:${a.caminho}`);
    const gImp = construirGrafo(idsArquivos, arestasImporta.filter((a) => a.para.startsWith("arq:")), {});
    const scc = componentesFortes(gImp);
    const cicl = calcularCiclos(gImp, scc);
    const pr = pageRank(gImp);
    const niveis = niveisTopologicos(gImp, scc);
    const cicloDe = new Map<number, number>();
    cicl.forEach((c, i) => c.nos.forEach((n) => cicloDe.set(n, i + 1)));
    const importacoes = arestasImporta
      .filter((a) => a.para.startsWith("arq:"))
      .map((a) => ({ de: a.de.slice(4), para: a.para.slice(4), linha: a.linha }));
    const camadas = calcularCamadas({ arquivos: arquivos.map((a) => ({ caminho: a.caminho, modulo: moduloPorCaminho.get(a.caminho) ?? "." })), importacoes, regras: regrasEnt.regras, manuais: [...(op.camadasManual ?? [])] });
    const camadaDoModulo = new Map(camadas.modulos.map((m) => [m.modulo, m.camada]));
    const maxPr = pr.reduce((m, v) => (v > m ? v : m), 0) || 1;
    banco.transacao((tx) => {
      const up = tx.preparar("UPDATE arquivo SET camada = ?, ciclo_id = ?, pagerank = ? WHERE caminho = ?");
      for (let i = 0; i < arquivos.length; i++) {
        const c = (arquivos[i] as ArquivoMapa).caminho;
        const idx = gImp.indice(`arq:${c}`);
        up.executar([camadaDoModulo.get(moduloPorCaminho.get(c) ?? ".") ?? niveis.nivel[idx] ?? 0, cicloDe.get(idx) ?? null, idx < 0 ? 0 : (pr[idx] as number) / maxPr, c]);
      }
      // estado de teste por arquivo (convenção ou medido)
      const upt = tx.preparar("UPDATE arquivo SET cobertura_estado = ?, cobertura_pct = ?, cobertura_fonte = ? WHERE caminho = ?");
      for (const t of testes.arquivos) upt.executar([t.estado, t.pct, t.fonte, t.caminho]);
    });
    progresso("analises", 2, 8);
    const violacoesRegras = avaliarRegras(regrasEnt.regras, importacoes);
    await cede();
    exigirAtivo(op.signal);

    // ---- 9. análises derivadas (cache em formato de UI) -------------------------------------------------------------------
    const infoArq = banco.consultar<{ caminho: string; churn_janela: number | null; complexidade_max: number | null; autores_n: number | null; criado_git: string | null; ultima_alt: string | null; commits_correcao: number | null }>(
      "SELECT caminho, churn_janela, complexidade_max, autores_n, criado_git, ultima_alt, commits_correcao FROM arquivo",
    );
    const acopl: ParceiroAcoplamento[] = banco
      .consultar<{ a: string; b: string; co_alteracoes: number; grau: number }>("SELECT x.caminho AS a, y.caminho AS b, t.co_alteracoes, t.grau FROM acoplamento_temporal t JOIN arquivo x ON x.id = t.a JOIN arquivo y ON y.id = t.b")
      .map((l) => ({ a: l.a, b: l.b, co_alteracoes: Number(l.co_alteracoes), grau: Number(l.grau) }));
    const hot = calcularHotspots(infoArq.map((l): EntradaHotspot => ({ caminho: l.caminho, churn_janela: l.churn_janela, complexidade_max: l.complexidade_max, autores_n: l.autores_n, criado_git: l.criado_git, ultima_alt: l.ultima_alt, commits_correcao: l.commits_correcao })), acopl, agora);
    const idadeDias = new Map<string, number>();
    for (const l of infoArq) if (l.criado_git !== null) idadeDias.set(l.caminho, Math.max(0, Math.floor((agora.getTime() - Date.parse(l.criado_git)) / 86_400_000)));
    const caminhosEntrada = new Set(entradasR.entradas.map((e) => e.caminho));
    const handlers = new Set(entradasR.entradas.map((e) => e.handler).filter((h): h is string => h !== null));
    const apiPublica = new Set<string>();
    for (const m of manifestos) {
      const rel = (p: string): string => (m.pasta === "" ? p.replace(/^\.\//, "") : `${m.pasta}/${p.replace(/^\.\//, "")}`);
      if (m.main !== null) apiPublica.add(rel(m.main));
      for (const e of m.exports_alvos) apiPublica.add(rel(e));
      for (const b of m.bin) apiPublica.add(rel(b));
    }
    const arestasUso: Array<{ tipo: string; de: string; para: string; confianca: "exata" | "heuristica" }> = [...arestasImporta, ...arestasChamada, ...arestasAciona];
    const mortos = candidatosMortos({ arquivos: codigo, arestas: arestasUso, caminhosDeEntrada: caminhosEntrada, handlers, apiPublica, referenciadosPorConfig: new Set(), idadeDias });
    progresso("analises", 4, 8);

    const declaradas: DependenciaDeclarada[] = [];
    const locksMapa = new Map<string, string>();
    for (const m of manifestos) {
      for (const d of m.deps) {
        declaradas.push({ eco: d.eco, nome: d.nome, versao_declarada: d.versao, dev: d.dev, arquivo: m.arquivo, linha: d.linha });
        if (d.versao_lock !== null) locksMapa.set(`${d.eco}:${d.nome}`, d.versao_lock);
      }
    }
    const externas = analisarExternas({ declaradas, usados: [...nosExternos.keys()], locks: locksMapa, leitor });
    banco.transacao((tx) => {
      tx.executar("DELETE FROM externo");
      const ins = tx.preparar("INSERT OR REPLACE INTO externo (id, ecossistema, nome, versao, declarado, dev, licenca, licenca_fonte) VALUES (?,?,?,?,?,?,?,?)");
      for (const e of externas.externas) ins.executar([e.id, e.eco, e.nome, e.versao, e.declarado ? 1 : 0, e.dev ? 1 : 0, e.licenca, e.licenca_fonte]);
    });
    const zonas = zonasCandidatas({ arquivos: codigo, tabelas: [...dados.tabelas.keys()] });
    const criadoMs = new Map<string, number>();
    for (const l of infoArq) if (l.criado_git !== null) criadoMs.set(l.caminho, Date.parse(l.criado_git));
    const padroes = analisarPadroes(codigo, criadoMs);
    progresso("analises", 6, 8);

    let duplicacao: DadosAnaliseMapa["duplicacao"] = { habilitada: false, clones: [] };
    if (op.config.duplicacao) {
      duplicacao = { habilitada: true, clones: analisarPatrimonioDuplicacao(codigo, (c) => leitor.ler(c), LIMITES.clones) };
      await cede();
    }

    // ---- 10. montagem do cache de análises ---------------------------------------------------------------------------------------
    const nome = (g: typeof gImp, i: number): string => g.ids[i] as string;
    const ciclosUi = cicl.slice(0, LIMITES.ciclos).map((c, i) => ({
      id: i + 1,
      tamanho: c.tamanho,
      nos: c.nos.slice(0, LIMITES.noPorCiclo).map((n) => nome(gImp, n)),
      quebrar: c.quebrar.map((q) => ({ de: nome(gImp, q.de), para: nome(gImp, q.para), peso: q.peso })),
    }));
    const dsmModulos = camadas.dsm.modulos.length;
    let dsm = { modulos: camadas.dsm.modulos, celulas: camadas.dsm.celulas, truncado: false };
    if (dsmModulos > LIMITES.dsm) {
      // agrega por pasta de 1º nível
      const topo = (m: string): string => (m.includes("/") ? m.slice(0, m.indexOf("/")) : m);
      const nomes = [...new Set(camadas.dsm.modulos.map(topo))];
      const idx = new Map(nomes.map((n, i) => [n, i]));
      const cel = nomes.map(() => nomes.map(() => 0));
      camadas.dsm.modulos.forEach((mi, i) =>
        camadas.dsm.modulos.forEach((mj, j) => {
          const v = camadas.dsm.celulas[i]?.[j] ?? 0;
          if (v > 0) (cel[idx.get(topo(mi)) as number] as number[])[idx.get(topo(mj)) as number]! += v;
        }),
      );
      dsm = { modulos: nomes, celulas: cel, truncado: true };
    }
    const violacoesUi = [
      ...camadas.violacoes_candidatas.map((v) => ({ origem: v.origem, de_modulo: v.de_modulo, para_modulo: v.para_modulo, evidencias: v.evidencias.slice(0, 5), motivo: v.motivo })),
      ...violacoesRegras.slice(0, 500).map((v) => ({ origem: "regra" as const, de_modulo: v.de, para_modulo: v.para, evidencias: [v.evidencia], motivo: `viola regra de ${v.regra.fonte.arquivo}:${v.regra.fonte.linha}` })),
    ];
    const ordemTeste = { ausente: 0, parcial: 1, existente: 2, nao_aplicavel: 3 } as const;
    const semTesteItens = testes.arquivos
      .filter((t) => t.estado === "ausente" || t.estado === "parcial")
      .sort((x, y) => ordemTeste[x.estado] - ordemTeste[y.estado] || (x.caminho < y.caminho ? -1 : 1))
      .map((t) => ({ caminho: t.caminho, estado: t.estado as "ausente" | "parcial", fonte: t.fonte }));
    const porPastaTeste = new Map<string, { pasta: string; total: number; sem_teste: number }>();
    for (const t of testes.arquivos) {
      if (t.estado === "nao_aplicavel") continue;
      const pasta = t.caminho.includes("/") ? t.caminho.slice(0, t.caminho.lastIndexOf("/")) : ".";
      const e = porPastaTeste.get(pasta) ?? { pasta, total: 0, sem_teste: 0 };
      e.total++;
      if (t.estado === "ausente") e.sem_teste++;
      porPastaTeste.set(pasta, e);
    }
    const toquesPorTabela = new Map<string, DadosAnaliseMapa["dados"]["tabelas"][number]>();
    for (const [nomeT, t] of dados.tabelas) toquesPorTabela.set(nomeT, { nome: nomeT, definida_em: t.definidaEm.slice(0, 5).map((d) => `${d.caminho}:${d.linha}`), le_n: 0, escreve_n: 0, toques: [] });
    for (const a of dados.arestas) {
      const nomeT = a.para.replace(/^tab:/, "");
      const t = toquesPorTabela.get(nomeT) ?? { nome: nomeT, definida_em: [], le_n: 0, escreve_n: 0, toques: [] };
      toquesPorTabela.set(nomeT, t);
      const op2 = a.tipo === "escreve_tabela" ? "escreve" : "le";
      if (op2 === "le") t.le_n++;
      else t.escreve_n++;
      if (t.toques.length < LIMITES.toques) t.toques.push({ de: a.de, operacao: op2, confianca: a.confianca, evidencia: a.evidencias?.[0] ?? null });
    }
    const tabelasUi = [...toquesPorTabela.values()].sort((x, y) => y.le_n + y.escreve_n - (x.le_n + x.escreve_n) || (x.nome < y.nome ? -1 : 1));
    const analises: DadosAnaliseMapa = {
      ciclos: { ciclos: ciclosUi, total: cicl.length },
      camadas: {
        modulos: camadas.modulos.map((m) => ({ modulo: m.modulo, camada: m.camada, camada_manual: m.camada_manual, ca: m.ca, ce: m.ce, instabilidade: m.instabilidade, ciclo_id: m.ciclo_id, arquivos: m.arquivos })),
        ciclos: camadas.ciclos.map((c) => ({ id: c.id, modulos: c.modulos.slice(0, 50), quebrar: c.quebrar })),
        violacoes: violacoesUi,
        dsm,
        regras_importadas: regrasEnt.regras.length,
      },
      hotspots: {
        disponivel: hot.disponivel,
        itens: hot.hotspots.slice(0, LIMITES.hotspots).map((h) => ({ caminho: h.caminho, score: h.score, faixa: h.faixa, churn_janela: h.churn_janela, complexidade_max: h.complexidade_max, autores_n: h.autores_n, idade_dias: h.idade_dias, commits_correcao: h.commits_correcao, parceiros: h.parceiros })),
      },
      mortos: { itens: mortos.slice(0, LIMITES.mortos).map((m) => ({ id: m.id, tipo: m.tipo, caminho: m.caminho, linha: m.linha, confianca: m.confianca, motivos: m.motivos })), rotulo: ROTULO_CANDIDATO },
      sem_teste: { itens: semTesteItens.slice(0, LIMITES.semTeste), por_pasta: [...porPastaTeste.values()].sort((a, b) => b.sem_teste - a.sem_teste || (a.pasta < b.pasta ? -1 : 1)).slice(0, 500) },
      externas: { itens: externas.externas.map((e) => ({ id: e.id, ecossistema: e.eco, nome: e.nome, versao: e.versao, declarado: e.declarado, usado: e.usado, dev: e.dev, licenca: e.licenca, selo: e.selo })), aviso: externas.aviso },
      duplicacao,
      dialetos: {
        eixos: padroes.eixos.map((e) => {
          const dom = e.variantes[0];
          return {
            eixo: e.eixo,
            forca: e.forca.forca,
            destino: e.forca.destino,
            variantes: e.variantes.map((v) => ({ nome: v.nome, n: v.arquivos, recente: dom !== undefined && v !== dom && v.criado_medio !== null && dom.criado_medio !== null && v.criado_medio > dom.criado_medio })),
          };
        }),
      },
      zonas: { zonas: zonas.map((z) => ({ categoria: z.categoria, pastas: z.pastas.slice(0, 20), arquivos: z.arquivos.slice(0, 20), tabelas: z.tabelas.slice(0, 20), quem_valida: z.quem_valida })) },
      entradas: { itens: entradasR.entradas.slice(0, LIMITES.entradas).map((e) => ({ id: e.id, subtipo: e.subtipo, chave: e.chave, framework: e.framework, caminho: e.caminho, linha: e.linha, confianca: e.confianca })), por_categoria: entradasR.porCategoria },
      dados: { tabelas: tabelasUi.slice(0, LIMITES.tabelas) },
    };
    // grafo agregado por módulo (visão geral do mapa): módulos com peso, arestas agregadas exata/heurística
    const modulosGrafo = new Map<string, { id: string; arquivos: number; loc: number }>();
    for (const l of banco.consultar<{ modulo: string; n: number; loc: number | null }>("SELECT modulo, COUNT(*) AS n, SUM(loc) AS loc FROM arquivo GROUP BY modulo")) modulosGrafo.set(l.modulo, { id: l.modulo, arquivos: Number(l.n), loc: Number(l.loc ?? 0) });
    const parMod = new Map<string, { de: string; para: string; peso: number; exata: number }>();
    for (const a of importacoes) {
      const mo = moduloPorCaminho.get(a.de);
      const md = moduloPorCaminho.get(a.para);
      if (mo === undefined || md === undefined || mo === md) continue;
      const k2 = `${mo}\u0000${md}`;
      const e = parMod.get(k2) ?? { de: mo, para: md, peso: 0, exata: 0 };
      e.peso++;
      parMod.set(k2, e);
    }
    const exataPorPar = new Map<string, number>();
    for (const a of arestasImporta) {
      if (!a.para.startsWith("arq:") || a.confianca !== "exata") continue;
      const mo = moduloPorCaminho.get(a.de.slice(4));
      const md = moduloPorCaminho.get(a.para.slice(4));
      if (mo === undefined || md === undefined || mo === md) continue;
      const k2 = `${mo}\u0000${md}`;
      exataPorPar.set(k2, (exataPorPar.get(k2) ?? 0) + 1);
    }
    const grafoModulo = {
      modulos: [...modulosGrafo.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
      arestas: [...parMod.entries()].map(([k2, e]) => ({ de: e.de, para: e.para, peso: e.peso, exata: (exataPorPar.get(k2) ?? 0) > 0 })),
    };

    // ---- 11. versão do mapa e caches ---------------------------------------------------------------------------------------------
    // a versão sobe AQUI, junto com a gravação dos caches (durante o cálculo, os caches da versão anterior continuam valendo para a UI)
    let versao = 0;
    banco.transacao(() => {
      versao = armazem.incrementarVersao();
      for (const [chave, valor] of Object.entries(analises)) armazem.gravarAnaliseCache(`analise:${chave}`, valor);
      armazem.gravarAnaliseCache("grafo_modulo", grafoModulo);
      armazem.gravarAnaliseCache("tipos_teste", { estatisticas: testes.estatisticas, resumo: resumoPorEstado(testes.arquivos) });
      armazem.gravarAnaliseCache("padroes", { variaveis_de_ambiente: padroes.variaveis_de_ambiente, idioma_por_pasta: padroes.idioma_por_pasta });
      armazem.gravarAnaliseCache("resolucao", { nao_resolvidos: naoResolvidosN, chamadas_ambiguas: chamadasAmbiguasN, ignorados: ignoradosN });
      armazem.gravarMeta("historia", estadoHistoria);
      armazem.gravarMeta(CHAVE_META_DERIVADA, String(versao));
      armazem.gravarMeta("analisado_em", agora.toISOString());
      armazem.gravarMeta("estado", "pronto");
    });
    const cont = banco.consultar<{ confianca: string; n: number }>("SELECT confianca, COUNT(*) AS n FROM aresta WHERE tipo IN ('importa','reexporta') GROUP BY confianca");
    progresso("analises", 8, 8);
    try {
      banco.executar("PRAGMA wal_checkpoint(PASSIVE)"); // fora do thread do main: o WAL acumulado pelas gravações do main é consolidado aqui
    } catch {
      /* banco ocupado: o SQLite faz o checkpoint depois */
    }
    const ctx: ContextoDerivado = { arquivos: ordenarPorCaminho(arquivos), manifestos, analises, violacoes_regras: violacoesRegras, cobertura, historia: estadoHistoria, avisos, versao_mapa: versao, padroes, criado: criadoMs };
    if (op.aoConcluir !== undefined) await op.aoConcluir(ctx);
    return {
      versao_mapa: versao,
      arestas: { exata: Number(cont.find((c) => c.confianca === "exata")?.n ?? 0), heuristica: Number(cont.find((c) => c.confianca === "heuristica")?.n ?? 0) },
      historia: estadoHistoria,
      nos_alterados: arquivos.length,
      avisos,
      cancelado: false,
      ms,
    };
  } catch (e) {
    if (e instanceof Cancelado) return { versao_mapa: armazem.versaoMapa(), arestas: { exata: 0, heuristica: 0 }, historia: "indisponivel", nos_alterados: 0, avisos, cancelado: true, ms };
    throw e;
  }
}
