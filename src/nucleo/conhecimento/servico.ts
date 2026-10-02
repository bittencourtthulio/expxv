// ServicoConhecimento (T-15.11, núcleo): fachada em processo, SEM Electron. Implementa `PortaConhecimento` (substitui o
// `conhecimentoNulo` da Fase 8): `registrar` só enfileira (síncrono, sem I/O pesado). O worker thread e o RPC com timeout ficam no
// main (pedido ao coordenador): esta fachada é o que o worker hospeda. Consulta nunca lança e sempre registra `rag_consulta`.
import type { EstadoConhecimento, EstadoConsulta, OrigemConsulta, RespostaBusca, RespostaContexto, ResultadoRag, TipoDocumento, ModoBusca, EscopoBusca, Aprendizado, ValorFeedback } from "../../compartilhado/conhecimento";
import type { EventoConhecimento, PortaConhecimento } from "../memoria/eventos-conhecimento";
import type { Banco } from "../banco/banco";
import { acaoHumana, registrarFeedback } from "./aprendizado/feedback";
import { consolidar } from "./aprendizado/consolidar";
import { registrarAprendizado } from "./aprendizado/dedupe";
import { Buscador, type HitBusca } from "./busca/buscador";
import { redigir } from "./chunking/comum";
import { TIMEOUT_CONSULTA_MS, TRECHO_MAX } from "./constantes";
import { derivarConsultaConhecimento } from "./contexto/consulta";
import { fonteDoHit } from "./contexto/montar-comum";
import { limitarOrcamento, montarContexto } from "./contexto/montar";
import { RegistroEmbeddings } from "./embeddings/registro";
import { ftsDisponivel } from "./fts";
import { subgrafo, detalheNo, type FiltroSubgrafo } from "./grafo/consultas";
import { gravarPosicoes } from "./grafo/posicoes";
import { drenar, enfileirar, PRIORIDADE } from "./ingestao/fila";
import { PipelineIngestao, type DepsPipeline } from "./ingestao/pipeline";
import { esquecer, purgar } from "./ingestao/tombstone";
import { GerenciadorIndices } from "./indice/gerenciador";
import { escolherEstrategia } from "./indice/seletor";
import { idLocal } from "./ids";
import { criarRepos, type ColecaoLinha, type FiltroRemocao, type Repos } from "./repos";
import { sanearFonte } from "./seguranca";
import { MODELO_HASH_ID, DIMENSAO_HASH } from "./constantes";
import type { EntradaConhecimento } from "./tipos";

export interface DepsServico {
  banco: Banco;
  workspace_id: string;
  nomeWorkspace: string;
  raiz: string;
  /** conhecimento ligado para este workspace? (`conhecimento_config.ativo && global`); lido a cada chamada. */
  ativo?: () => boolean;
  scrubber?: { scrub(t: string): string };
  registro?: RegistroEmbeddings;
  relogio?: () => string;
  agora?: () => number;
  arquivosConhecidos?: () => ReadonlySet<string> | null;
  memoxInstalado?: () => boolean;
  fts5?: boolean;
  opcoesIndice?: { sqlite_vec_ok?: boolean; memoria_max_bytes?: number };
  /** chunks novos gravados (replicação online); ver `DepsPipeline.aoGravar`. */
  aoGravar?: (colecao_id: string, chunkIds: readonly string[]) => void;
}

export interface PedidoBuscaServico {
  consulta: string;
  modo?: ModoBusca;
  tipos?: readonly TipoDocumento[] | null;
  desde?: string | null;
  limite?: number;
  escopo?: EscopoBusca;
  origem?: OrigemConsulta;
  mission_id?: string | null;
  task_ref?: string | null;
  pane_id?: string | null;
  arquivos?: readonly string[];
  prazoMs?: number;
}

export interface PedidoContextoServico {
  tarefa: string;
  arquivos?: readonly string[];
  orcamento_chars?: number;
  origem?: OrigemConsulta;
  mission_id?: string | null;
  task_ref?: string | null;
  pane_id?: string | null;
}

const CAMPOS_DE_TEXTO = ["titulo", "texto", "pergunta", "resposta", "usuario", "mensagem"] as const;

/** Redige só os campos de TEXTO livre (ids, SHAs e caminhos ficam como estão). Não muda o tipo nem os demais campos. */
export function redigirParaFila(en: EntradaConhecimento, scrubber?: { scrub(t: string): string }): EntradaConhecimento {
  const op = scrubber ? { scrubber } : {};
  const limpar = <T extends Record<string, unknown>>(o: T): T => {
    const c: Record<string, unknown> = { ...o };
    for (const k of CAMPOS_DE_TEXTO) if (typeof c[k] === "string") c[k] = redigir(c[k] as string, op);
    return c as T;
  };
  if (en.tipo === "evento") return { ...en, evento: limpar(en.evento as unknown as Record<string, unknown>) as unknown as typeof en.evento };
  return limpar(en as unknown as Record<string, unknown>) as unknown as EntradaConhecimento;
}

export class ServicoConhecimento implements PortaConhecimento {
  readonly repos: Repos;
  readonly registro: RegistroEmbeddings;
  readonly indices: GerenciadorIndices;
  readonly pipeline: PipelineIngestao;
  private readonly buscador: Buscador;
  private colecao: ColecaoLinha;
  private fechado = false;

  constructor(private readonly d: DepsServico) {
    const relogio = d.relogio ?? ((): string => new Date().toISOString());
    this.repos = criarRepos(d.banco, relogio);
    this.registro = d.registro ?? new RegistroEmbeddings();
    this.indices = new GerenciadorIndices(this.repos, d.opcoesIndice ?? {});
    this.colecao = this.repos.colecao.garantir({ escopo: "workspace", workspace_id: d.workspace_id, nome: d.nomeWorkspace, modelo: MODELO_HASH_ID, dimensao: DIMENSAO_HASH });
    const depsP: DepsPipeline = { repos: this.repos, registro: this.registro, indices: this.indices, raiz: d.raiz, ...(d.scrubber ? { scrubber: d.scrubber } : {}), ...(d.arquivosConhecidos ? { arquivosConhecidos: d.arquivosConhecidos } : {}), ...(d.aoGravar ? { aoGravar: d.aoGravar } : {}) };
    this.pipeline = new PipelineIngestao(depsP);
    this.buscador = new Buscador({ repos: this.repos, registro: this.registro, indices: this.indices, ...(d.agora ? { agora: d.agora } : {}) });
  }

  get colecaoId(): string {
    return this.colecao.id;
  }
  private ativo(): boolean {
    return !this.fechado && (this.d.ativo ? this.d.ativo() : true);
  }

  /** `PortaConhecimento`: só enfileira (síncrono). NUNCA lança, NUNCA espera. */
  registrar(evento: EventoConhecimento): void {
    this.registrarEntrada({ tipo: "evento", evento });
  }
  registrarEntrada(en: EntradaConhecimento, prioridade: number = PRIORIDADE.evento): void {
    if (!this.ativo()) return;
    try {
      // auditoria: o texto é REDIGIDO já na fila (a fila é persistente: segredo bruto ficaria no arquivo até a drenagem e depois em páginas livres)
      enfileirar(this.repos, redigirParaFila(en, this.d.scrubber), prioridade, this.colecao.id);
    } catch {
      /* RAG nunca derruba quem chama */
    }
  }

  /** Drena a fila em fatia (chamado pelo worker quando ocioso). */
  processarFila(orcamentoMs = 20): Promise<{ processados: number; restantes: number; falhas: number }> {
    return drenar({ repos: this.repos, pipeline: this.pipeline, colecao_id: this.colecao.id, orcamentoMs });
  }

  private registrarConsulta(p: { origem: OrigemConsulta; modo: string; consulta: string; estado: EstadoConsulta; n: number; ms: number; mission_id?: string | null | undefined; task_ref?: string | null | undefined; pane_id?: string | null | undefined; sinais?: unknown }): string {
    const id = idLocal("con");
    try {
      this.repos.consulta.registrar({
        id,
        colecao_id: this.colecao.id,
        workspace_id: this.d.workspace_id,
        mission_id: p.mission_id ?? null,
        task_ref: p.task_ref ?? null,
        pane_id: p.pane_id ?? null,
        origem: p.origem,
        modo: p.modo,
        consulta_redigida: redigir(p.consulta, this.d.scrubber ? { scrubber: this.d.scrubber } : {}).replace(/\s+/g, " ").slice(0, 200),
        estado: p.estado,
        n_resultados: p.n,
        latencia_ms: Math.round(p.ms),
        sinais_json: p.sinais === undefined ? null : JSON.stringify(p.sinais),
        criado_em: this.repos.relogio(),
      });
    } catch {
      /* registro de consulta é auxiliar */
    }
    return id;
  }

  private paraResultado(h: HitBusca): ResultadoRag {
    return { chunk_id: h.chunk.chunk_id, escore: Math.round(h.escore * 1e6) / 1e6, trecho: sanearFonte(h.chunk.texto, TRECHO_MAX), fonte: fonteDoHit(h), aprendizado_id: h.chunk.aprendizado_id, braco: h.braco };
  }

  /** Busca. Sempre devolve uma resposta utilizável e registra a consulta (conta como consultado mesmo vazia/lenta). */
  async buscar(p: PedidoBuscaServico): Promise<RespostaBusca> {
    const origem = p.origem ?? "ui";
    const t0 = (this.d.agora ?? (() => performance.now()))();
    if (!this.ativo()) {
      const id = this.registrarConsulta({ origem, modo: p.modo ?? "hibrido", consulta: p.consulta, estado: "desligado", n: 0, ms: 0, mission_id: p.mission_id, task_ref: p.task_ref, pane_id: p.pane_id });
      return { resultados: [], estado: "desligado", consulta_id: id, latencia_ms: 0, modelo: "", aviso: "conhecimento desligado" };
    }
    try {
      const r = await this.buscador.buscar({
        colecao_id: this.colecao.id,
        consulta: p.consulta,
        modo: p.modo ?? "hibrido",
        filtro: { tipos: p.tipos ?? null, desde: p.desde ?? null, mission_id: p.escopo === "missao" ? (p.mission_id ?? null) : null },
        k: p.limite ?? 8,
        mission_id: p.mission_id ?? null,
        ...(p.arquivos ? { arquivos: p.arquivos } : {}),
        ...(p.prazoMs !== undefined ? { prazoMs: p.prazoMs } : {}),
      });
      const resultados = r.hits.map((h) => this.paraResultado(h));
      const id = this.registrarConsulta({ origem, modo: p.modo ?? "hibrido", consulta: p.consulta, estado: r.estado, n: resultados.length, ms: r.latencia_ms, mission_id: p.mission_id, task_ref: p.task_ref, pane_id: p.pane_id });
      return { resultados, estado: r.estado, consulta_id: id, latencia_ms: Math.round(r.latencia_ms), modelo: r.modelo, aviso: r.aviso };
    } catch {
      const ms = (this.d.agora ?? (() => performance.now()))() - t0;
      const id = this.registrarConsulta({ origem, modo: p.modo ?? "hibrido", consulta: p.consulta, estado: "indisponivel", n: 0, ms, mission_id: p.mission_id, task_ref: p.task_ref, pane_id: p.pane_id });
      return { resultados: [], estado: "indisponivel", consulta_id: id, latencia_ms: Math.round(ms), modelo: "", aviso: "índice indisponível" };
    }
  }

  /**
   * Busca devolvendo os HITS completos (texto do chunk e proveniência) para o chat (`perguntar` precisa do texto inteiro para citar).
   * Mesma garantia: nunca lança, registra `rag_consulta(origem)`. O texto continua redigido (o pipeline redige antes de gravar).
   */
  async buscarHits(p: { consulta: string; k?: number; origem?: OrigemConsulta; prazoMs?: number }): Promise<{ hits: HitBusca[]; estado: EstadoConsulta; consulta_id: string }> {
    const origem = p.origem ?? "chat";
    const agora = this.d.agora ?? (() => performance.now());
    const t0 = agora();
    if (!this.ativo()) return { hits: [], estado: "desligado", consulta_id: this.registrarConsulta({ origem, modo: "hibrido", consulta: p.consulta, estado: "desligado", n: 0, ms: 0 }) };
    try {
      const r = await this.buscador.buscar({ colecao_id: this.colecao.id, consulta: p.consulta, modo: "hibrido", k: p.k ?? 12, ...(p.prazoMs !== undefined ? { prazoMs: p.prazoMs } : {}) });
      return { hits: r.hits, estado: r.estado, consulta_id: this.registrarConsulta({ origem, modo: "hibrido", consulta: p.consulta, estado: r.estado, n: r.hits.length, ms: r.latencia_ms }) };
    } catch {
      return { hits: [], estado: "indisponivel", consulta_id: this.registrarConsulta({ origem, modo: "hibrido", consulta: p.consulta, estado: "indisponivel", n: 0, ms: agora() - t0 }) };
    }
  }

  /** `rag_context`: a chamada que cumpre "consultar antes de implementar". ≤ 150 ms; nunca lança nem bloqueia a tarefa. */
  async contexto(p: PedidoContextoServico): Promise<RespostaContexto> {
    const origem = p.origem ?? "tool";
    const agora = this.d.agora ?? (() => performance.now());
    const t0 = agora();
    const geradoEm = (this.d.relogio ?? ((): string => new Date().toISOString()))();
    const vazio = (estado: EstadoConsulta, consulta_id: string, aviso?: string): RespostaContexto => ({
      markdown: aviso ? "" : "",
      sinais: { ja_existe: false, houve_correcao: false, decisoes_relacionadas: 0, fontes: [] },
      estado,
      consulta_id,
      latencia_ms: Math.round(agora() - t0),
    });
    if (!this.ativo()) return vazio("desligado", this.registrarConsulta({ origem, modo: "contexto", consulta: p.tarefa, estado: "desligado", n: 0, ms: 0, mission_id: p.mission_id, task_ref: p.task_ref, pane_id: p.pane_id }));
    try {
      const dv = derivarConsultaConhecimento(p.tarefa, p.arquivos ?? []);
      const r = await this.buscador.buscar({ colecao_id: this.colecao.id, consulta: dv.consulta, modo: "hibrido", k: 10, mission_id: p.mission_id ?? null, arquivos: dv.arquivos, prazoMs: TIMEOUT_CONSULTA_MS });
      const m = montarContexto({ hits: r.hits, consulta: dv.consulta, orcamentoChars: limitarOrcamento(p.orcamento_chars), geradoEm, memoxInstalado: this.d.memoxInstalado?.() === true });
      const estado: EstadoConsulta = r.estado === "ok" && m.citados.length === 0 ? "vazio" : r.estado;
      const id = this.registrarConsulta({ origem, modo: "contexto", consulta: dv.consulta, estado, n: m.citados.length, ms: agora() - t0, mission_id: p.mission_id, task_ref: p.task_ref, pane_id: p.pane_id, sinais: { ja_existe: m.sinais.ja_existe, houve_correcao: m.sinais.houve_correcao, decisoes: m.sinais.decisoes_relacionadas } });
      return { markdown: m.markdown, sinais: m.sinais, estado, consulta_id: id, latencia_ms: Math.round(agora() - t0) };
    } catch {
      return vazio("indisponivel", this.registrarConsulta({ origem, modo: "contexto", consulta: p.tarefa, estado: "indisponivel", n: 0, ms: agora() - t0, mission_id: p.mission_id, task_ref: p.task_ref, pane_id: p.pane_id }));
    }
  }

  /** `rag_learn`: aprendizado do agente nasce `candidato`; do usuário, `ativo`. */
  async aprender(p: { tipo: "decisao" | "causa_raiz" | "armadilha" | "padrao" | "correcao" | "fato"; titulo: string; texto: string; fonte: "agente" | "usuario" | "sistema"; arquivos?: string[]; pane_id?: string | null; mission_id?: string | null; task_ref?: string | null; cli?: string | null; origem?: string }): Promise<{ id: string; status: "candidate" | "active" | "merged" }> {
    const quando = this.repos.relogio();
    const r = registrarAprendizado(this.repos, this.colecao.id, { tipo: p.tipo, titulo: p.titulo, texto: p.texto, fonte: p.fonte, arquivos: p.arquivos, proveniencia: { mission_id: p.mission_id ?? undefined, task_ref: p.task_ref ?? undefined, pane_id: p.pane_id ?? undefined, cli: p.cli ?? undefined, origem: p.origem ?? "rag_learn", em: quando } }, { quando, ...(this.d.scrubber ? { scrubber: this.d.scrubber } : {}) });
    if (r.novo && r.documento) {
      const ing = await this.pipeline.ingerir(this.colecao.id, r.documento);
      if (ing.documento_id) this.repos.aprendizado.atualizar(r.id, { documento_id: ing.documento_id });
    }
    return { id: r.id, status: r.status };
  }

  feedback(p: { alvo_tipo: "chunk" | "documento" | "aprendizado"; alvo_id: string; valor: ValorFeedback; por: "agente" | "humano"; pane_id?: string | null; consulta_id?: string | null; nota?: string | null }): { ok: boolean } {
    if (!this.alvoDaColecao(p.alvo_tipo, p.alvo_id)) return { ok: false };
    const r = registrarFeedback(this.repos, { ...p, autor_ref: p.por === "humano" ? "humano" : (p.pane_id ?? "agente") }, this.repos.relogio());
    return { ok: r.registrado };
  }

  /** O alvo pertence a ESTA coleção? (ids de outro workspace são inertes: nunca leem nem alteram o dado dele.) */
  private alvoDaColecao(tipo: "chunk" | "documento" | "aprendizado", id: string): boolean {
    const b = this.repos.banco;
    const col = this.colecao.id;
    const l =
      tipo === "aprendizado"
        ? b.consultarUm("SELECT 1 AS x FROM rag_aprendizado WHERE id = ? AND colecao_id = ?", [id, col])
        : tipo === "documento"
          ? b.consultarUm("SELECT 1 AS x FROM rag_documento WHERE id = ? AND colecao_id = ?", [id, col])
          : b.consultarUm("SELECT 1 AS x FROM rag_chunk c JOIN rag_documento d ON d.id = c.documento_id WHERE c.id = ? AND d.colecao_id = ?", [id, col]);
    return l !== undefined;
  }

  atualizarAprendizado(id: string, acao: "ativar" | "arquivar" | "rejeitar" | "editar", texto?: string): Aprendizado | null {
    if (!this.alvoDaColecao("aprendizado", id)) return null;
    if (!acaoHumana(this.repos, id, acao, texto)) return null;
    const a = this.repos.aprendizado.obter(id);
    return a ? { id: a.id, tipo: a.tipo as Aprendizado["tipo"], titulo: a.titulo, texto: a.texto, fonte: a.fonte as Aprendizado["fonte"], estado: a.estado as Aprendizado["estado"], confianca: a.confianca, vezes_visto: a.vezes_visto, util: a.util, inutil: a.inutil, errado: a.errado, criado_em: a.criado_em } : null;
  }

  esquecer(filtro: FiltroRemocao): { removidos: number } {
    return esquecer(this.repos, this.indices, this.colecao.id, filtro);
  }
  purgar(confirmacao: string): { removidos: number } | null {
    return purgar(this.repos, this.indices, this.colecao.id, confirmacao, this.d.nomeWorkspace);
  }

  subgrafo(f: FiltroSubgrafo = {}): ReturnType<typeof subgrafo> {
    return subgrafo(this.repos, this.colecao.id, f);
  }
  detalheNo(id: string): ReturnType<typeof detalheNo> {
    const no = this.repos.grafo.no(id);
    return no === undefined || no.colecao_id !== this.colecao.id ? null : detalheNo(this.repos, id);
  }
  gravarPosicoes(p: ReadonlyArray<{ id: string; x: number; y: number }>): number {
    return gravarPosicoes(this.repos, p, this.colecao.id);
  }

  /** Consolidação periódica (≤ 1×/6 h): chamada pelo worker quando ocioso. */
  consolidar(agora: number = Date.now()): ReturnType<typeof consolidar> {
    const r = consolidar(this.repos, this.colecao.id, agora);
    this.indices.remover(this.colecao.id, r.chunks_removidos);
    return r;
  }

  /** A (Missão, task) consultou o RAG na janela? (regra de consulta obrigatória.) */
  consultouRecentemente(mission_id: string, task_ref: string, janelaMs = 30 * 60 * 1000, agoraMs: number = Date.now()): boolean {
    return this.repos.consulta.consultouDesde(mission_id, task_ref, new Date(agoraMs - janelaMs).toISOString(), this.colecao.id);
  }

  estado(p: { tarefasDespachadas7d?: ReadonlyArray<{ mission_id: string; task_ref: string }> } = {}): EstadoConhecimento {
    const c = this.repos.documento.contagens(this.colecao.id);
    const col = this.repos.colecao.obter(this.colecao.id) as ColecaoLinha;
    const tamanho = Number(this.d.banco.consultarUm<{ b: number }>("SELECT (SELECT page_count FROM pragma_page_count) * (SELECT page_size FROM pragma_page_size) AS b")?.b ?? 0);
    let cobertura: number | null = null;
    if (p.tarefasDespachadas7d && p.tarefasDespachadas7d.length > 0) {
      const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const ok = p.tarefasDespachadas7d.filter((t) => this.repos.consulta.consultouDesde(t.mission_id, t.task_ref, desde, this.colecao.id)).length;
      cobertura = Math.round((ok / p.tarefasDespachadas7d.length) * 100);
    }
    const est = escolherEstrategia({ n: c.chunks, dim: col.dimensao, ...(this.d.opcoesIndice ?? {}) });
    return {
      ativo: this.ativo(),
      chunks: c.chunks,
      documentos: c.documentos,
      aprendizados: this.repos.aprendizado.contagens(this.colecao.id),
      modelo: col.modelo_ativo,
      dimensao: col.dimensao,
      vetor_backend: est === "exato" ? "exato" : est === "sqlite_vec" ? "sqlite_vec" : "exato_int8",
      fts5: this.d.fts5 ?? ftsDisponivel(this.d.banco),
      tamanho_bytes: tamanho,
      indexando: { pendentes: this.repos.fila.pendentes(this.colecao.id), fase: null, pct: null },
      reembutindo_pct: null,
      cobertura_consulta_7d_pct: cobertura,
      backend: "local",
    };
  }

  /** Aquece o índice em RAM em segundo plano (fatias). */
  aquecer(orcamentoMs = 20): boolean {
    const col = this.repos.colecao.obter(this.colecao.id) as ColecaoLinha;
    return this.indices.aquecer(col.id, col.modelo_ativo, col.dimensao, orcamentoMs);
  }

  fechar(): void {
    this.fechado = true;
    this.indices.liberar();
  }
}

export function criarServicoConhecimento(d: DepsServico): ServicoConhecimento {
  return new ServicoConhecimento(d);
}
