import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { abrirBanco, type Banco, type Declaracao, type Valor } from "../banco/banco";
import type { DirecaoVizinhos, EstadoHistoria, EstadoMapa, MapaLeitura, OpcoesBusca, OpcoesVizinhos, ResumoMapa, Vizinho } from "./contrato";
import { lerVersao, migrar } from "./esquema";
import type { Aresta, Confianca, Extracao, FonteAresta, Linguagem, No, TipoAresta, TipoNo } from "./tipos";
import { MAX_EVIDENCIAS, SCHEMA_VERSION, TIPOS_NO } from "./tipos";
import { validarExtracao } from "./validacao";

// Armazém SQLite do mapa (T-17.04, D-163): UM arquivo por workspace, aberto com a mesma abstração `Banco` do
// núcleo (node:sqlite, WAL), mas SEM as migrations do banco principal. É cache reconstruível: banco corrompido
// ou de versão maior é RENOMEADO (`mapa.db.corrompido-<carimbo>`, com seus -wal/-shm) e recriado, nunca apagado
// em silêncio. Guarda nomes e posições; nunca o código-fonte.

/** `<userData>/mapas/<workspace_id>/mapa.db`. */
export function caminhoMapaDb(userData: string, workspaceId: string): string {
  return join(userData, "mapas", workspaceId, "mapa.db");
}

export interface ItemExtracao {
  /** Relativo à raiz, com `/`. */
  caminho: string;
  linguagem: Linguagem;
  hash: string;
  tamanho: number;
  mtime_ms: number;
  /** Pasta do arquivo; padrão = `dirname(caminho)` (`.` na raiz). */
  modulo?: string;
  degradado?: boolean;
  /**
   * Grava só `arquivo` + `extracao` e deixa os nós e as arestas próprias do arquivo para `completarGrafos` (na thread da fase derivada).
   * Usado nas análises grandes: o main não gasta CPU com milhares de INSERTs (P-12). O resultado final é o mesmo.
   */
  semGrafo?: boolean;
  extracao: Extracao;
}

export interface ResultadoLote {
  gravados: number;
  /** Mesmo hash e mesma versão do extrator: nada reescrito (upsert idempotente). */
  inalterados: number;
  /** Extração rejeitada pela validação. */
  invalidos: number;
}

export interface ArquivoRegistrado {
  id: number;
  caminho: string;
  hash: string;
  tamanho: number;
  mtime_ms: number;
  versao_extrator: number | null;
}

export interface AvisoArmazem {
  tipo: "recriado";
  motivo: "corrompido" | "versao_maior" | "origem_desconhecida";
  /** Caminho para onde o arquivo antigo foi movido. */
  arquivo_antigo: string;
}

export interface EscopoArestas {
  tipos: readonly TipoAresta[];
  /** Limita aos arestas cujo `arquivo_id` está na lista; ausente = todas do tipo. */
  arquivoIds?: readonly number[];
  fonte?: FonteAresta;
}

export interface ContagensArmazem {
  arquivos: number;
  nos: number;
  arestas: number;
  extracoes: number;
}

export interface Armazem extends MapaLeitura {
  readonly caminho: string;
  readonly aviso: AvisoArmazem | null;
  gravarLote(itens: readonly ItemExtracao[]): ResultadoLote;
  /** Igual a `gravarLote`, em transações pequenas, cedendo o event loop entre elas. */
  gravarEmFatias(itens: readonly ItemExtracao[], opcoes?: { fatia?: number; orcamentoMs?: number }): Promise<ResultadoLote>;
  lerHashes(): Map<string, ArquivoRegistrado>;
  /** Cria os nós e as arestas próprias dos arquivos gravados com `semGrafo` (idempotente: só quem não tem o nó `arq:`). Devolve quantos. */
  completarGrafos(opcoes?: { fatia?: number; aoProgresso?: (feito: number) => void }): Promise<number>;
  lerExtracao(caminho: string): Extracao | null;
  removerArquivos(caminhos: readonly string[]): { removidos: number; dependentes: string[] };
  substituirArestas(escopo: EscopoArestas, arestas: readonly Aresta[]): number;
  contagens(): ContagensArmazem;
  lerMeta(chave: string): string | null;
  gravarMeta(chave: string, valor: string): void;
  versaoMapa(): number;
  incrementarVersao(): number;
  lerAnaliseCache<T = unknown>(chave: string): T | null;
  gravarAnaliseCache(chave: string, valor: unknown): void;
  iniciarExecucao(tipo: string, total: number): number;
  finalizarExecucao(id: number, estado: string, extraidos: number, erros: number): void;
  limparOrfaos(): number;
  verificarIntegridade(): boolean;
  /** `wal_checkpoint(TRUNCATE)` + `VACUUM`. */
  compactar(): void;
  /** Remove todos os dados (mantém o esquema e o arquivo). */
  limpar(): void;
  /** "Apagar mapa": fecha e remove `mapa.db` (+ -wal/-shm). */
  apagar(): void;
  fechar(): void;
  /** Acesso ao banco para as análises (somente dentro de `src/nucleo/mapa`). */
  readonly banco: Banco;
}

export interface OpcoesArmazem {
  /** Caminho do `mapa.db` (ou `:memory:`). A pasta é criada. */
  caminho: string;
  busyTimeoutMs?: number;
  agora?: () => Date;
  /** Páginas do WAL que disparam o checkpoint automático (padrão 16 000 ≈ 64 MB; o worker da fase derivada usa o padrão do SQLite). */
  autocheckpointPaginas?: number;
}

const carimbo = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

function moverParaCorrompido(caminho: string, agora: Date): string {
  const base = `${caminho}.corrompido-${carimbo(agora)}`;
  let destino = base;
  for (let n = 2; existsSync(destino); n++) destino = `${base}-${n}`;
  if (existsSync(caminho)) renameSync(caminho, destino);
  for (const sufixo of ["-wal", "-shm"]) {
    if (existsSync(caminho + sufixo)) renameSync(caminho + sufixo, destino + sufixo);
  }
  return destino;
}

function abrirOuRecriar(opcoes: OpcoesArmazem): { banco: Banco; aviso: AvisoArmazem | null } {
  const { caminho } = opcoes;
  const agora = opcoes.agora ?? (() => new Date());
  const memoria = caminho === ":memory:" || caminho === "";
  if (!memoria) mkdirSync(dirname(caminho), { recursive: true });
  const abrir = (): Banco => abrirBanco(caminho, opcoes.busyTimeoutMs === undefined ? {} : { busyTimeoutMs: opcoes.busyTimeoutMs });
  let motivo: AvisoArmazem["motivo"] | null = null;
  let aberto: Banco | undefined;
  try {
    aberto = abrir();
    const r = migrar(aberto);
    if (r.estado !== "reconstruir") {
      aberto.consultarUm("SELECT COUNT(*) AS n FROM meta"); // sonda: arquivo que não é SQLite falha aqui ou na abertura
      return { banco: aberto, aviso: null };
    }
    motivo = r.versao_antes > SCHEMA_VERSION ? "versao_maior" : "origem_desconhecida";
  } catch {
    motivo = "corrompido";
  }
  try {
    aberto?.fechar();
  } catch {
    /* já inutilizável */
  }
  if (memoria) throw new Error("não foi possível abrir o banco do mapa em memória");
  const arquivoAntigo = moverParaCorrompido(caminho, agora());
  const banco = abrir();
  migrar(banco);
  return { banco, aviso: { tipo: "recriado", motivo: motivo ?? "corrompido", arquivo_antigo: arquivoAntigo } };
}

interface LinhaNo {
  id: string;
  tipo: string;
  subtipo: string | null;
  rotulo: string;
  arquivo_id: number | null;
  linha_ini: number | null;
  linha_fim: number | null;
  exportado: number | null;
  atributos: string | null;
}

function paraNo(l: LinhaNo): No {
  let atributos: Record<string, unknown> | null = null;
  if (l.atributos !== null) {
    try {
      atributos = JSON.parse(l.atributos) as Record<string, unknown>;
    } catch {
      atributos = null;
    }
  }
  return {
    id: l.id,
    tipo: l.tipo as TipoNo,
    subtipo: l.subtipo,
    rotulo: l.rotulo,
    arquivo_id: l.arquivo_id,
    linha_ini: l.linha_ini,
    linha_fim: l.linha_fim,
    exportado: l.exportado === null ? null : l.exportado === 1,
    atributos,
  };
}

interface LinhaAresta {
  id: number;
  tipo: string;
  de: string;
  para: string;
  confianca: string;
  peso: number;
  candidatos: number | null;
  fonte: string;
  arquivo_id: number | null;
  linha: number | null;
  evidencias: string | null;
}

function paraAresta(l: LinhaAresta): Aresta {
  let evidencias: string[] | null = null;
  if (l.evidencias !== null) {
    try {
      evidencias = JSON.parse(l.evidencias) as string[];
    } catch {
      evidencias = null;
    }
  }
  return {
    id: l.id,
    tipo: l.tipo as TipoAresta,
    de: l.de,
    para: l.para,
    confianca: l.confianca as Confianca,
    peso: l.peso,
    candidatos: l.candidatos,
    fonte: l.fonte as FonteAresta,
    arquivo_id: l.arquivo_id,
    linha: l.linha,
    evidencias,
  };
}

const esperar = (): Promise<void> => new Promise((r) => setImmediate(r));

const COLUNAS_NO = "id, tipo, subtipo, rotulo, arquivo_id, linha_ini, linha_fim, exportado, atributos";
const COLUNAS_ARESTA = "tipo, de, para, confianca, peso, candidatos, fonte, arquivo_id, linha, evidencias";
const MAX_LINHAS_POR_INSERT = 64;
const escaparLike = (t: string): string => t.replace(/[\\%_]/g, (c) => `\\${c}`);

function tipoDoId(id: string): TipoNo {
  const prefixo = id.slice(0, id.indexOf(":"));
  const mapa: Record<string, TipoNo> = { arq: "arquivo", mod: "modulo", sim: "simbolo", ent: "entrada", tab: "tabela", ext: "externo" };
  return mapa[prefixo] ?? "externo";
}

class ArmazemSqlite implements Armazem {
  readonly aviso: AvisoArmazem | null;
  readonly banco: Banco;
  private fechado = false;
  private readonly multilinha = new Map<string, Declaracao>();
  private readonly agora: () => Date;
  private readonly st: {
    arquivoPorCaminho: Declaracao<{ id: number; hash: string; tamanho: number; mtime_ms: number; versao_extrator: number | null }>;
    upsertArquivo: Declaracao<{ id: number }>;
    atualizarStat: Declaracao;
    apagarNos: Declaracao;
    apagarArestas: Declaracao;
    gravarExtracao: Declaracao;
    inserirNo: Declaracao;
    inserirNoSeNovo: Declaracao;
    inserirAresta: Declaracao;
    no: Declaracao<LinhaNo>;
  };

  constructor(opcoes: OpcoesArmazem) {
    const { banco, aviso } = abrirOuRecriar(opcoes);
    this.banco = banco;
    // cache reconstruível: o checkpoint do WAL (fsync de vários MB) sai do caminho das gravações do main (P-12) e roda no fim da fase derivada
    try {
      banco.executar(`PRAGMA wal_autocheckpoint = ${Math.max(100, Math.trunc(opcoes.autocheckpointPaginas ?? 16_000))}`);
    } catch {
      /* banco em memória ou sem WAL: segue com o padrão */
    }
    this.aviso = aviso;
    this.caminho = opcoes.caminho;
    this.agora = opcoes.agora ?? (() => new Date());
    this.st = {
      arquivoPorCaminho: banco.preparar("SELECT a.id, a.hash, a.tamanho, a.mtime_ms, e.versao_extrator FROM arquivo a LEFT JOIN extracao e ON e.arquivo_id = a.id WHERE a.caminho = ?"),
      upsertArquivo: banco.preparar(
        `INSERT INTO arquivo (caminho, linguagem, hash, tamanho, mtime_ms, loc, loc_codigo, loc_comentario, complexidade_total, complexidade_max, e_teste, e_gerado, erros_parse, degradado, modulo, analisado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(caminho) DO UPDATE SET linguagem=excluded.linguagem, hash=excluded.hash, tamanho=excluded.tamanho, mtime_ms=excluded.mtime_ms, loc=excluded.loc,
           loc_codigo=excluded.loc_codigo, loc_comentario=excluded.loc_comentario, complexidade_total=excluded.complexidade_total, complexidade_max=excluded.complexidade_max,
           e_teste=excluded.e_teste, e_gerado=excluded.e_gerado, erros_parse=excluded.erros_parse, degradado=excluded.degradado, modulo=excluded.modulo, analisado_em=excluded.analisado_em
         RETURNING id`,
      ),
      atualizarStat: banco.preparar("UPDATE arquivo SET tamanho = ?, mtime_ms = ? WHERE id = ?"),
      apagarNos: banco.preparar("DELETE FROM no WHERE arquivo_id = ?"),
      apagarArestas: banco.preparar("DELETE FROM aresta WHERE arquivo_id = ?"),
      gravarExtracao: banco.preparar("INSERT OR REPLACE INTO extracao (arquivo_id, versao_extrator, json) VALUES (?,?,?)"),
      inserirNo: banco.preparar("INSERT OR REPLACE INTO no (id, tipo, subtipo, rotulo, arquivo_id, linha_ini, linha_fim, exportado, atributos) VALUES (?,?,?,?,?,?,?,?,?)"),
      inserirNoSeNovo: banco.preparar("INSERT OR IGNORE INTO no (id, tipo, subtipo, rotulo, arquivo_id, linha_ini, linha_fim, exportado, atributos) VALUES (?,?,?,?,?,?,?,?,?)"),
      inserirAresta: banco.preparar("INSERT INTO aresta (tipo, de, para, confianca, peso, candidatos, fonte, arquivo_id, linha, evidencias) VALUES (?,?,?,?,?,?,?,?,?,?)"),
      no: banco.preparar<LinhaNo>("SELECT id, tipo, subtipo, rotulo, arquivo_id, linha_ini, linha_fim, exportado, atributos FROM no WHERE id = ?"),
    };
  }

  readonly caminho: string;

  // ---------------------------------------------------------------------------------------------
  // escrita

  gravarLote(itens: readonly ItemExtracao[]): ResultadoLote {
    const total: ResultadoLote = { gravados: 0, inalterados: 0, invalidos: 0 };
    this.banco.transacao(() => {
      for (const item of itens) {
        const r = this.gravarUm(item);
        total[r === "gravado" ? "gravados" : r === "inalterado" ? "inalterados" : "invalidos"]++;
      }
    });
    return total;
  }

  async gravarEmFatias(itens: readonly ItemExtracao[], opcoes: { fatia?: number; orcamentoMs?: number } = {}): Promise<ResultadoLote> {
    const total: ResultadoLote = { gravados: 0, inalterados: 0, invalidos: 0 };
    const somar = (r: ResultadoLote): void => {
      total.gravados += r.gravados;
      total.inalterados += r.inalterados;
      total.invalidos += r.invalidos;
    };
    if (opcoes.orcamentoMs !== undefined) {
      // fatias por TEMPO: cada transação grava arquivos até estourar o orçamento (no mínimo 1) e cede o event loop; sob carga as fatias encolhem sozinhas
      const orcamento = Math.max(1, opcoes.orcamentoMs);
      let i = 0;
      while (i < itens.length) {
        const inicio = performance.now();
        this.banco.transacao(() => {
          do {
            const r = this.gravarUm(itens[i] as ItemExtracao);
            total[r === "gravado" ? "gravados" : r === "inalterado" ? "inalterados" : "invalidos"]++;
            i++;
          } while (i < itens.length && performance.now() - inicio < orcamento);
        });
        if (i < itens.length) await esperar();
      }
      return total;
    }
    const fatia = Math.max(1, opcoes.fatia ?? 10);
    for (let i = 0; i < itens.length; i += fatia) {
      somar(this.gravarLote(itens.slice(i, i + fatia)));
      if (i + fatia < itens.length) await esperar();
    }
    return total;
  }

  private gravarUm(item: ItemExtracao): "gravado" | "inalterado" | "invalido" {
    let e: Extracao;
    try {
      e = validarExtracao(item.extracao);
    } catch {
      return "invalido";
    }
    const existente = this.st.arquivoPorCaminho.consultarUm([item.caminho]);
    if (existente !== undefined && existente.hash === item.hash && existente.versao_extrator === e.versao_extrator) {
      if (existente.tamanho !== item.tamanho || existente.mtime_ms !== Math.trunc(item.mtime_ms)) this.st.atualizarStat.executar([item.tamanho, Math.trunc(item.mtime_ms), existente.id]);
      return "inalterado";
    }
    const modulo = item.modulo ?? (item.caminho.includes("/") ? item.caminho.slice(0, item.caminho.lastIndexOf("/")) : ".");
    const linha = this.st.upsertArquivo.consultarUm([
      item.caminho,
      item.linguagem,
      item.hash,
      item.tamanho,
      Math.trunc(item.mtime_ms),
      e.loc,
      e.loc_codigo,
      e.loc_comentario,
      e.complexidade_total,
      e.complexidade_max,
      e.e_teste ? 1 : 0,
      e.e_gerado ? 1 : 0,
      e.erros_parse,
      item.degradado === true ? 1 : 0,
      modulo,
      this.agora().toISOString(),
    ]) as { id: number };
    const id = linha.id;
    if (existente !== undefined) {
      this.st.apagarNos.executar([id]);
      this.st.apagarArestas.executar([id]);
    }
    this.st.gravarExtracao.executar([id, e.versao_extrator, JSON.stringify(e)]);
    if (item.semGrafo !== true) this.inserirGrafoDoArquivo(id, item.caminho, e);
    return "gravado";
  }

  /** INSERT de várias linhas por instrução (menos idas e voltas ao SQLite); instruções preparadas em cache por nº de linhas. */
  private inserirLinhas(tabela: "no" | "aresta", linhas: Valor[][]): void {
    const colunas = tabela === "no" ? COLUNAS_NO : COLUNAS_ARESTA;
    const largura = tabela === "no" ? 9 : 10;
    for (let i = 0; i < linhas.length; i += MAX_LINHAS_POR_INSERT) {
      const fatia = linhas.slice(i, i + MAX_LINHAS_POR_INSERT);
      const chave = `${tabela}:${fatia.length}`;
      let st = this.multilinha.get(chave);
      if (st === undefined) {
        const marcas = `(${Array(largura).fill("?").join(",")})`;
        st = this.banco.preparar(`INSERT INTO ${tabela} (${colunas}) VALUES ${Array(fatia.length).fill(marcas).join(",")}`);
        this.multilinha.set(chave, st);
      }
      st.executar(fatia.flat());
    }
  }

  private inserirGrafoDoArquivo(id: number, caminho: string, e: Extracao): void {
    const arqId = `arq:${caminho}`;
    const base = caminho.slice(caminho.lastIndexOf("/") + 1);
    const nos: Valor[][] = [[arqId, "arquivo", e.linguagem, base, id, 1, e.loc, null, JSON.stringify({ loc: e.loc, cx: e.complexidade_max })]];
    const arestasFixas: Valor[][] = [];
    const porQualificado = new Map<string, string>();
    const porNome = new Map<string, string[]>();
    for (const s of e.simbolos) {
      const sid = `sim:${caminho}#${s.qualificado}`;
      porQualificado.set(s.qualificado, sid);
      const lista = porNome.get(s.nome);
      if (lista === undefined) porNome.set(s.nome, [sid]);
      else lista.push(sid);
      nos.push([
        sid,
        "simbolo",
        s.tipo,
        s.qualificado,
        id,
        s.linha,
        s.linha_fim,
        s.exportado ? 1 : 0,
        JSON.stringify({ v: s.visibilidade, cx: s.complexidade, a: s.assinatura, d: s.doc, dec: s.decoradores.length > 0 ? s.decoradores : undefined }),
      ]);
    }
    const chavesEntrada = new NomesUnicosLocal();
    for (const en of e.entradas) {
      const eid = `ent:${caminho}#${chavesEntrada.unico(en.chave)}`;
      nos.push([eid, "entrada", en.tipo, en.chave, id, en.linha, en.linha, null, JSON.stringify({ fw: en.framework, c: en.confianca })]);
      if (en.handler !== null) {
        const alvo = porQualificado.get(en.handler) ?? (porNome.get(en.handler)?.length === 1 ? porNome.get(en.handler)?.[0] : undefined);
        if (alvo !== undefined) arestasFixas.push(linhaAresta({ tipo: "aciona", de: eid, para: alvo, confianca: "exata", peso: 1, candidatos: null, fonte: "extracao", arquivo_id: id, linha: en.linha, evidencias: [`${caminho}:${en.linha}`] }));
      }
    }
    // acesso a dados: agrega por (origem, tabela, tipo de aresta)
    const agregados = new Map<string, Aresta>();
    for (const d of e.dados) {
      const tid = `tab:${d.tabela}`;
      this.st.inserirNoSeNovo.executar([tid, "tabela", null, d.tabela, null, null, null, null, null]);
      const de = d.de !== null && porQualificado.has(d.de) ? (porQualificado.get(d.de) as string) : arqId;
      const tipo: TipoAresta = d.operacao === "le" || d.operacao === "desconhecida" ? "le_tabela" : "escreve_tabela";
      const chave = `${tipo}|${de}|${tid}`;
      const existente = agregados.get(chave);
      const confianca: Confianca = d.confianca;
      const evid = `${caminho}:${d.linha}`;
      if (existente === undefined) {
        agregados.set(chave, { tipo, de, para: tid, confianca, peso: 1, candidatos: null, fonte: "extracao", arquivo_id: id, linha: d.linha, evidencias: [evid] });
      } else {
        existente.peso++;
        if (confianca === "exata") existente.confianca = "exata";
        if (existente.evidencias !== null && existente.evidencias.length < MAX_EVIDENCIAS) existente.evidencias.push(evid);
      }
    }
    for (const a of agregados.values()) arestasFixas.push(linhaAresta(a));
    this.inserirLinhas("no", nos);
    this.inserirLinhas("aresta", arestasFixas);
  }

  private inserirAresta(a: Aresta): void {
    this.st.inserirAresta.executar(linhaAresta(a));
  }

  async completarGrafos(opcoes: { fatia?: number; aoProgresso?: (feito: number) => void } = {}): Promise<number> {
    const fatia = Math.max(10, opcoes.fatia ?? 100);
    let feito = 0;
    let ultimo = 0;
    for (;;) {
      const pendentes = this.banco.consultar<{ id: number; caminho: string; json: string }>(
        "SELECT a.id, a.caminho, e.json AS json FROM arquivo a JOIN extracao e ON e.arquivo_id = a.id WHERE a.id > ? AND NOT EXISTS (SELECT 1 FROM no n WHERE n.id = 'arq:' || a.caminho) ORDER BY a.id LIMIT ?",
        [ultimo, fatia],
      );
      if (pendentes.length === 0) return feito;
      this.banco.transacao(() => {
        for (const p of pendentes) {
          ultimo = p.id;
          try {
            this.inserirGrafoDoArquivo(p.id, p.caminho, validarExtracao(p.json));
            feito++;
          } catch {
            /* extração inválida: o arquivo fica sem nós (já foi contado como inválido na gravação) */
          }
        }
      });
      opcoes.aoProgresso?.(feito);
      await esperar();
    }
  }

  removerArquivos(caminhos: readonly string[]): { removidos: number; dependentes: string[] } {
    const dependentes = new Set<string>();
    let removidos = 0;
    this.banco.transacao((tx) => {
      for (const caminho of caminhos) {
        const a = this.st.arquivoPorCaminho.consultarUm([caminho]);
        if (a === undefined) continue;
        for (const d of tx.consultar<{ caminho: string }>(
          `SELECT DISTINCT a2.caminho AS caminho FROM aresta e JOIN arquivo a2 ON a2.id = e.arquivo_id
           WHERE e.arquivo_id != ? AND e.para IN (SELECT id FROM no WHERE arquivo_id = ?)`,
          [a.id, a.id],
        )) {
          dependentes.add(d.caminho);
        }
        tx.executar("DELETE FROM aresta WHERE para IN (SELECT id FROM no WHERE arquivo_id = ?)", [a.id]);
        tx.executar("DELETE FROM acoplamento_temporal WHERE a = ? OR b = ?", [a.id, a.id]);
        tx.executar("DELETE FROM arquivo WHERE id = ?", [a.id]); // CASCADE: extracao, no, aresta do arquivo
        removidos++;
      }
    });
    for (const c of caminhos) dependentes.delete(c);
    return { removidos, dependentes: [...dependentes].sort() };
  }

  substituirArestas(escopo: EscopoArestas, arestas: readonly Aresta[]): number {
    if (escopo.tipos.length === 0) return 0;
    this.banco.transacao((tx) => {
      const marcasTipos = escopo.tipos.map(() => "?").join(",");
      const fonte = escopo.fonte;
      if (escopo.arquivoIds === undefined) {
        tx.executar(`DELETE FROM aresta WHERE tipo IN (${marcasTipos})${fonte !== undefined ? " AND fonte = ?" : ""}`, fonte !== undefined ? [...escopo.tipos, fonte] : [...escopo.tipos]);
      } else {
        for (let i = 0; i < escopo.arquivoIds.length; i += 500) {
          const ids = escopo.arquivoIds.slice(i, i + 500);
          tx.executar(`DELETE FROM aresta WHERE tipo IN (${marcasTipos}) AND arquivo_id IN (${ids.map(() => "?").join(",")})${fonte !== undefined ? " AND fonte = ?" : ""}`, [
            ...escopo.tipos,
            ...ids,
            ...(fonte !== undefined ? [fonte] : []),
          ]);
        }
      }
      for (const a of arestas) this.inserirAresta(a);
    });
    return arestas.length;
  }

  limparOrfaos(): number {
    let n = 0;
    this.banco.transacao((tx) => {
      n += tx.executar(
        `DELETE FROM no WHERE tipo IN ('tabela','externo') AND arquivo_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM aresta e WHERE e.para = no.id OR e.de = no.id)`,
        [], // com lista de parâmetros o `Banco` usa instrução preparada e informa `alteracoes`
      ).alteracoes;
    });
    return n;
  }

  // ---------------------------------------------------------------------------------------------
  // leitura

  lerHashes(): Map<string, ArquivoRegistrado> {
    const mapa = new Map<string, ArquivoRegistrado>();
    for (const l of this.banco.consultar<{ id: number; caminho: string; hash: string; tamanho: number; mtime_ms: number; versao_extrator: number | null }>(
      "SELECT a.id, a.caminho, a.hash, a.tamanho, a.mtime_ms, e.versao_extrator FROM arquivo a LEFT JOIN extracao e ON e.arquivo_id = a.id",
    )) {
      mapa.set(l.caminho, l);
    }
    return mapa;
  }

  lerExtracao(caminho: string): Extracao | null {
    const l = this.banco.consultarUm<{ json: string }>("SELECT e.json AS json FROM extracao e JOIN arquivo a ON a.id = e.arquivo_id WHERE a.caminho = ?", [caminho]);
    if (l === undefined) return null;
    try {
      return validarExtracao(l.json);
    } catch {
      return null;
    }
  }

  no(id: string): No | undefined {
    const l = this.st.no.consultarUm([id]);
    return l === undefined ? undefined : paraNo(l);
  }

  vizinhos(id: string, opcoes: OpcoesVizinhos = {}): Vizinho[] {
    const direcao: DirecaoVizinhos = opcoes.direcao ?? "saida";
    const limite = Math.min(Math.max(1, opcoes.limite ?? 200), 5000);
    const saida: Vizinho[] = [];
    const consultar = (lado: "de" | "para"): void => {
      const outro = lado === "de" ? "para" : "de";
      const tipos = opcoes.tipos !== undefined && opcoes.tipos.length > 0 ? ` AND e.tipo IN (${opcoes.tipos.map(() => "?").join(",")})` : "";
      const conf = opcoes.min_confianca === "exata" ? " AND e.confianca = 'exata'" : "";
      const linhas = this.banco.consultar<LinhaAresta & { n_id: string | null; n_tipo: string | null; n_subtipo: string | null; n_rotulo: string | null; n_arquivo_id: number | null; n_linha_ini: number | null; n_linha_fim: number | null; n_exportado: number | null; n_atributos: string | null }>(
        `SELECT e.*, n.id AS n_id, n.tipo AS n_tipo, n.subtipo AS n_subtipo, n.rotulo AS n_rotulo, n.arquivo_id AS n_arquivo_id, n.linha_ini AS n_linha_ini,
                n.linha_fim AS n_linha_fim, n.exportado AS n_exportado, n.atributos AS n_atributos
         FROM aresta e LEFT JOIN no n ON n.id = e.${outro}
         WHERE e.${lado} = ?${tipos}${conf} LIMIT ?`,
        [id, ...(opcoes.tipos ?? []), limite - saida.length],
      );
      for (const l of linhas) {
        const alvoId = outro === "de" ? l.de : l.para;
        const no: No =
          l.n_id !== null
            ? paraNo({ id: l.n_id, tipo: l.n_tipo as string, subtipo: l.n_subtipo, rotulo: l.n_rotulo as string, arquivo_id: l.n_arquivo_id, linha_ini: l.n_linha_ini, linha_fim: l.n_linha_fim, exportado: l.n_exportado, atributos: l.n_atributos })
            : { id: alvoId, tipo: tipoDoId(alvoId), subtipo: null, rotulo: alvoId.slice(alvoId.indexOf(":") + 1), arquivo_id: null, linha_ini: null, linha_fim: null, exportado: null, atributos: null };
        saida.push({ aresta: paraAresta(l), no });
      }
    };
    if (direcao === "saida" || direcao === "ambas") consultar("de");
    if ((direcao === "entrada" || direcao === "ambas") && saida.length < limite) consultar("para");
    return saida;
  }

  buscar(texto: string, opcoes: OpcoesBusca = {}): No[] {
    const t = texto.trim();
    if (t === "") return [];
    const limite = Math.min(Math.max(1, opcoes.limite ?? 50), 500);
    const tipos = (opcoes.tipos ?? []).filter((x) => (TIPOS_NO as readonly string[]).includes(x));
    const filtro = tipos.length > 0 ? ` AND +tipo IN (${tipos.map(() => "?").join(",")})` : "";
    const prefixo = `${escaparLike(t)}%`;
    const colunas = "id, tipo, subtipo, rotulo, arquivo_id, linha_ini, linha_fim, exportado, atributos";
    // 1ª fase: prefixo do nome, pelo índice (rápido). 2ª fase (varredura por trecho do nome ou do id) só se nada casou por
    // prefixo ou se `trecho: true` foi pedido: a varredura custa dezenas de ms em mapas grandes.
    const primeira = this.banco
      .consultar<LinhaNo>(`SELECT ${colunas} FROM no WHERE rotulo LIKE ? ESCAPE '\\'${filtro} ORDER BY length(rotulo), rotulo LIMIT ?`, [prefixo, ...tipos, limite])
      .map(paraNo);
    if (primeira.length >= limite || (primeira.length > 0 && opcoes.trecho !== true)) return primeira;
    const contem = `%${escaparLike(t)}%`;
    const segunda = this.banco
      .consultar<LinhaNo>(
        `SELECT ${colunas} FROM no WHERE (rotulo LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\') AND NOT (rotulo LIKE ? ESCAPE '\\')${filtro} ORDER BY length(rotulo), rotulo LIMIT ?`,
        [contem, contem, prefixo, ...tipos, limite - primeira.length],
      )
      .map(paraNo);
    return [...primeira, ...segunda];
  }

  contagens(): ContagensArmazem {
    const n = (sql: string): number => Number(this.banco.consultarUm<{ n: number }>(sql)?.n ?? 0);
    return { arquivos: n("SELECT COUNT(*) AS n FROM arquivo"), nos: n("SELECT COUNT(*) AS n FROM no"), arestas: n("SELECT COUNT(*) AS n FROM aresta"), extracoes: n("SELECT COUNT(*) AS n FROM extracao") };
  }

  resumo(): ResumoMapa {
    const c = this.contagens();
    const linguagens = this.banco
      .consultar<{ linguagem: Linguagem; arquivos: number; loc: number | null }>("SELECT linguagem, COUNT(*) AS arquivos, SUM(loc) AS loc FROM arquivo GROUP BY linguagem ORDER BY arquivos DESC, linguagem")
      .map((l) => ({ linguagem: l.linguagem, arquivos: Number(l.arquivos), loc: Number(l.loc ?? 0) }));
    const por = this.banco.consultar<{ confianca: string; n: number }>("SELECT confianca, COUNT(*) AS n FROM aresta WHERE tipo IN ('importa','reexporta') GROUP BY confianca");
    const exata = Number(por.find((p) => p.confianca === "exata")?.n ?? 0);
    const heuristica = Number(por.find((p) => p.confianca === "heuristica")?.n ?? 0);
    const estadoMeta = this.lerMeta("estado") as EstadoMapa | null;
    return {
      estado: c.arquivos === 0 ? "vazio" : (estadoMeta ?? "parcial"),
      versao_mapa: this.versaoMapa(),
      analisado_em: this.lerMeta("analisado_em"),
      arquivos: c.arquivos,
      linguagens,
      arestas: { exata, heuristica },
      historia: (this.lerMeta("historia") as EstadoHistoria | null) ?? "indisponivel",
      desatualizado: false,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // meta, cache, execução

  lerMeta(chave: string): string | null {
    return this.banco.consultarUm<{ valor: string }>("SELECT valor FROM meta WHERE chave = ?", [chave])?.valor ?? null;
  }

  gravarMeta(chave: string, valor: string): void {
    this.banco.executar("INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor", [chave, valor]);
  }

  versaoMapa(): number {
    return Number(this.lerMeta("versao_mapa") ?? 0);
  }

  incrementarVersao(): number {
    const v = this.versaoMapa() + 1;
    this.gravarMeta("versao_mapa", String(v));
    return v;
  }

  lerAnaliseCache<T = unknown>(chave: string): T | null {
    const l = this.banco.consultarUm<{ versao_mapa: number; json: string }>("SELECT versao_mapa, json FROM analise_cache WHERE chave = ?", [chave]);
    if (l === undefined || l.versao_mapa !== this.versaoMapa()) return null;
    try {
      return JSON.parse(l.json) as T;
    } catch {
      return null;
    }
  }

  gravarAnaliseCache(chave: string, valor: unknown): void {
    this.banco.executar("INSERT INTO analise_cache (chave, versao_mapa, json) VALUES (?,?,?) ON CONFLICT(chave) DO UPDATE SET versao_mapa = excluded.versao_mapa, json = excluded.json", [
      chave,
      this.versaoMapa(),
      JSON.stringify(valor),
    ]);
  }

  iniciarExecucao(tipo: string, total: number): number {
    return this.banco.executar("INSERT INTO execucao (tipo, iniciada_em, estado, arquivos_total, arquivos_extraidos, erros) VALUES (?,?,?,?,0,0)", [tipo, this.agora().toISOString(), "em_andamento", total]).ultimoId;
  }

  finalizarExecucao(id: number, estado: string, extraidos: number, erros: number): void {
    this.banco.executar("UPDATE execucao SET terminada_em = ?, estado = ?, arquivos_extraidos = ?, erros = ? WHERE id = ?", [this.agora().toISOString(), estado, extraidos, erros, id]);
  }

  // ---------------------------------------------------------------------------------------------
  // manutenção

  verificarIntegridade(): boolean {
    const l = this.banco.consultarUm<{ quick_check: string }>("PRAGMA quick_check(1)");
    return l?.quick_check === "ok";
  }

  compactar(): void {
    this.banco.executar("PRAGMA wal_checkpoint(TRUNCATE)");
    this.banco.executar("VACUUM");
  }

  limpar(): void {
    this.banco.transacao((tx) => {
      for (const t of ["aresta", "no", "extracao", "arquivo", "externo", "acoplamento_temporal", "regra_fronteira", "layout_cache", "analise_cache", "execucao", "meta"]) tx.executar(`DELETE FROM ${t}`);
    });
  }

  apagar(): void {
    this.fechar();
    if (this.caminho === ":memory:" || this.caminho === "") return;
    for (const sufixo of ["", "-wal", "-shm"]) rmSync(this.caminho + sufixo, { force: true });
  }

  fechar(): void {
    if (this.fechado) return;
    this.fechado = true;
    this.banco.fechar();
  }
}

function linhaAresta(a: Aresta): Valor[] {
  return [a.tipo, a.de, a.para, a.confianca, a.peso, a.candidatos, a.fonte, a.arquivo_id, a.linha, a.evidencias === null ? null : JSON.stringify(a.evidencias)];
}

class NomesUnicosLocal {
  private readonly vistos = new Map<string, number>();
  unico(chave: string): string {
    const n = (this.vistos.get(chave) ?? 0) + 1;
    this.vistos.set(chave, n);
    return n === 1 ? chave : `${chave}~${n}`;
  }
}

/** Abre (ou cria) o armazém. Banco corrompido ou de versão maior é renomeado e recriado; veja `aviso`. */
export function abrirArmazem(opcoes: OpcoesArmazem): Armazem {
  return new ArmazemSqlite(opcoes);
}

export { lerVersao };
