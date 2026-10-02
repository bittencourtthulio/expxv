// Anfitrião do conhecimento (T-15.12): o que roda DENTRO da worker thread. Abre o `conhecimento.db` UMA vez e hospeda um
// `ServicoConhecimento` por workspace, expondo a tabela de métodos do RPC. É puro (sem Electron, sem thread): o arquivo
// `src/main/conhecimento-worker.ts` só liga `parentPort` a ele, e os testes o usam em processo. O main NUNCA abre este banco.
//
// Regras: toda chamada devolve dado clonável; erro vira texto curto (o RPC sanitiza); trabalho pesado (backfill, reembute) roda em
// fatias de ≤ 20 ms cedendo o laço; nada sai à rede daqui (só pelo main, via `chamarMain`).
import type { Aprendizado, EstadoConhecimento, FonteResultado, RespostaBusca, RespostaContexto, TipoDocumento } from "../../../compartilhado/conhecimento";
import type { AlvoEsquecer, DetalheDocumento, FonteReindexar, Pagina } from "../../../compartilhado/conhecimento-api";
import { abrirBancoConhecimento, type BancoConhecimento } from "../banco";
import { MODELO_HASH_ID } from "../constantes";
import { criarProvedorOllama, type TransporteHttp } from "../embeddings/ollama";
import { reembutirFatia } from "../embeddings/reembutir";
import type { ProvedorEmbedding } from "../embeddings/provedor";
import { criarDiscoNode, type PortaDisco } from "../fontes/disco";
import { lerCodigo } from "../fontes/codigo";
import { lerDocs } from "../fontes/docs";
import { criarGitNode } from "../fontes/git-node";
import { lerCommits } from "../fontes/git";
import { listarSessoesClaude, listarSessoesCodex } from "../fontes/historico";
import { lerTranscricao } from "../fontes/transcricoes";
import { executarBackfill, type FaseBackfill } from "../ingestao/backfill";
import { proximoTrabalho } from "../ingestao/agendador";
import { PRIORIDADE } from "../ingestao/fila";
import type { FiltroRemocao } from "../repos";
import { criarServicoConhecimento, type PedidoBuscaServico, type PedidoContextoServico, type ServicoConhecimento } from "../servico";
import type { EntradaConhecimento } from "../tipos";
import { criarRagOnline } from "./rag-online";
import type { MetodoRpc } from "./rpc";

export type ChamarMain = (metodo: string, args: unknown[], sinal?: AbortSignal) => Promise<unknown>;

export interface DepsAnfitriao {
  caminhoBanco: string;
  /** pasta pessoal do usuário (transcrições das CLIs). `null` = fontes de transcrição desligadas. */
  home: string | null;
  codexHome?: string | null;
  /** chamadas ao main (rede). Ausente = nada de Ollama/backend online. */
  chamarMain?: ChamarMain;
  semFts?: boolean;
  /** injeções de teste */
  disco?: (raiz: string) => PortaDisco;
  agoraMs?: () => number;
  relogio?: () => string;
}

export interface AberturaWorkspace {
  workspace_id: string;
  nome: string;
  raiz: string;
  ativo: boolean;
}

export interface OpcoesPasso {
  ocioso: boolean;
  missaoFechada?: boolean;
}
export interface ResultadoPasso {
  trabalho: "fila" | "aquecer" | "reembutir" | "consolidar" | null;
  pendentes: number;
}
export interface OpcoesReindexar {
  indexar_codigo: boolean;
  indexar_transcricoes: boolean;
  /** ids de conversa das sessões iniciadas pelo app (Claude/Codex). */
  sessoes_do_app: string[];
}
export interface ProgressoWs {
  ativo: boolean;
  fase: string | null;
  pct: number | null;
  pendentes: number;
  reembutindo_pct: number | null;
}

interface EstadoWs {
  svc: ServicoConhecimento;
  nome: string;
  raiz: string;
  ativo: boolean;
  disco: PortaDisco;
  backfill: { ctl: AbortController; fase: FaseBackfill | null; feitos: number; ativo: boolean } | null;
  indiceCompleto: boolean;
  ultimaConsolidacao: number | null;
  reembutir: { provedor: ProvedorEmbedding; pct: number | null } | null;
}

const ORDEM_FASES: readonly FaseBackfill[] = ["docs", "commits", "codigo", "transcricoes"];
const FASES_DE: Readonly<Record<FonteReindexar, readonly FaseBackfill[]>> = {
  docs: ["docs"],
  git: ["commits"],
  codigo: ["codigo"],
  transcricoes: ["transcricoes"],
  tudo: ORDEM_FASES,
};
const MODELO_VALIDO = /^(?:hash-256-v1|ollama:[A-Za-z0-9._/@-]{1,80}(?::\d{1,5})?|onnx:[A-Za-z0-9._/@-]{1,80}(?::\d{1,5})?)$/;

const cederLaco = (): Promise<void> => new Promise((r) => setImmediate(r));

export interface Anfitriao {
  metodos: Readonly<Record<string, MetodoRpc>>;
  /** abre (ou reabre) o serviço de um workspace; idempotente. */
  abrir(a: AberturaWorkspace): ServicoConhecimento;
  servico(workspaceId: string): ServicoConhecimento | undefined;
  fechar(): void;
}

export function criarAnfitriaoConhecimento(d: DepsAnfitriao): Anfitriao {
  let aberto: BancoConhecimento | null = null;
  const banco = (): BancoConhecimento => (aberto ??= abrirBancoConhecimento(d.caminhoBanco, d.semFts === true ? { semFts: true } : {}));
  const spaces = new Map<string, EstadoWs>();
  const agoraMs = d.agoraMs ?? Date.now;

  const ragOnline = criarRagOnline({ exigir: (ws) => exigir(ws).svc, chamarMain: d.chamarMain });

  const exigir = (ws: unknown): EstadoWs => {
    const e = typeof ws === "string" ? spaces.get(ws) : undefined;
    if (e === undefined) throw new Error("workspace do conhecimento não aberto");
    return e;
  };

  function abrir(a: AberturaWorkspace): ServicoConhecimento {
    const existente = spaces.get(a.workspace_id);
    if (existente !== undefined) {
      existente.ativo = a.ativo;
      return existente.svc;
    }
    const b = banco();
    const estado: EstadoWs = {
      svc: undefined as unknown as ServicoConhecimento,
      nome: a.nome,
      raiz: a.raiz,
      ativo: a.ativo,
      disco: (d.disco ?? criarDiscoNode)(a.raiz),
      backfill: null,
      indiceCompleto: false,
      ultimaConsolidacao: null,
      reembutir: null,
    };
    estado.svc = criarServicoConhecimento({
      banco: b.banco,
      workspace_id: a.workspace_id,
      nomeWorkspace: a.nome,
      raiz: a.raiz,
      ativo: () => estado.ativo,
      fts5: b.fts5,
      aoGravar: (colecao, ids) => ragOnline.aoGravar(a.workspace_id, estado.svc)(colecao, ids),
      ...(d.relogio ? { relogio: d.relogio } : {}),
    });
    spaces.set(a.workspace_id, estado);
    return estado.svc;
  }

  // ---------------------------------------------------------------- Ollama (loopback; a chamada HTTP sai pelo main)
  const transporteOllama = (): TransporteHttp => async (p) => {
    if (d.chamarMain === undefined) throw new Error("rede indisponível");
    const r = (await d.chamarMain("rede.ollama", [{ url: p.url, metodo: p.metodo, ...(p.corpo === undefined ? {} : { corpo: p.corpo }) }], p.sinal)) as { ok: boolean; status: number; texto: string };
    return { ok: r.ok, status: r.status, json: async () => JSON.parse(r.texto) as unknown };
  };

  async function listarOllama(): Promise<string[]> {
    if (d.chamarMain === undefined) return [];
    try {
      return await criarProvedorOllama({ modelo: "x", dimensao: 1, transporte: transporteOllama() }).listarModelos();
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------- backfill (fatias; retomável por rag_fonte)
  function iniciarBackfill(e: EstadoWs, wsId: string, fonte: FonteReindexar, o: OpcoesReindexar): boolean {
    if (e.backfill?.ativo === true) return false;
    const fases = FASES_DE[fonte].filter((f) => (f !== "codigo" || o.indexar_codigo) && (f !== "transcricoes" || o.indexar_transcricoes));
    const ctl = new AbortController();
    const estado = { ctl, fase: null as FaseBackfill | null, feitos: 0, ativo: true };
    e.backfill = estado;
    const colecao_id = e.svc.colecaoId;
    const repos = e.svc.repos;
    const agora = (): string => (d.relogio ?? ((): string => new Date().toISOString()))();
    const somenteIds = new Set(o.sessoes_do_app);
    void (async () => {
      try {
        await executarBackfill({
          pipeline: e.svc.pipeline,
          colecao_id,
          fases,
          sinal: ctl.signal,
          fontes: {
            docs: () => lerDocs({ disco: e.disco, repos, colecao_id, agora }),
            commits: () => lerCommits({ git: criarGitNode(e.raiz), repos, colecao_id, workspace_id: wsId }),
            codigo: async function* () {
              const versionados = await e.disco.listarVersionados();
              yield* lerCodigo({ disco: e.disco, repos, colecao_id, versionados });
            },
            transcricoes: async function* () {
              if (d.home === null || somenteIds.size === 0) return;
              const base = { home: d.home, raiz: e.raiz, somenteIds, ...(d.codexHome ? { codexHome: d.codexHome } : {}) };
              for (const s of [...(await listarSessoesClaude(base)), ...(await listarSessoesCodex(base))]) {
                for (const en of lerTranscricao({ repos, colecao_id, workspace_id: wsId, sessao: s })) yield en;
              }
            },
          },
          progresso: (p) => {
            estado.fase = p.fase;
            estado.feitos = p.feitos;
          },
          ceder: cederLaco,
        });
      } catch {
        /* o backfill nunca derruba o worker: o que ficou será retomado */
      } finally {
        estado.ativo = false;
        estado.fase = null;
        // depois de carga em massa o FTS5 fica fragmentado: consolidar (roda `fts optimize`) na próxima janela ociosa
        e.ultimaConsolidacao = null;
        try {
          e.svc.consolidar(agoraMs());
          e.ultimaConsolidacao = agoraMs();
        } catch {
          /* fica para o agendador */
        }
      }
    })();
    return true;
  }

  const progresso = (e: EstadoWs): ProgressoWs => {
    const fila = e.svc.repos.fila.pendentes(e.svc.colecaoId);
    const b = e.backfill;
    const fase = b?.ativo === true ? (b.fase ?? "docs") : fila > 0 ? "fila" : null;
    return { ativo: e.ativo, fase, pct: null, pendentes: fila, reembutindo_pct: e.reembutir?.pct === undefined || e.reembutir === null ? null : e.reembutir.pct };
  };

  // ---------------------------------------------------------------- listagens (paginação por cursor numérico)
  const deslocamento = (c: unknown): number => {
    const n = typeof c === "string" ? Number(c) : 0;
    return Number.isInteger(n) && n >= 0 && n < 1_000_000 ? n : 0;
  };

  function listarDocumentos(e: EstadoWs, p: { tipo: TipoDocumento | null; mission_id: string | null; busca: string | null; depois: string | null; limite: number }): Pagina<FonteResultado> {
    const inicio = deslocamento(p.depois);
    const limite = Math.max(1, Math.min(p.limite, 200));
    const busca = p.busca?.trim().toLowerCase() ?? "";
    // `listar` aceita no máximo 200: buscamos em janelas crescentes (offset simulado) até cobrir `inicio + limite + 1`
    const todos = e.svc.repos.documento.listar(e.svc.colecaoId, { tipo: p.tipo, mission_id: p.mission_id, limite: 200 });
    const filtrados = busca === "" ? todos : todos.filter((m) => m.titulo.toLowerCase().includes(busca) || m.origem.toLowerCase().includes(busca));
    const fatia = filtrados.slice(inicio, inicio + limite);
    const mais = filtrados.length > inicio + limite;
    return {
      itens: fatia.map((m) => ({ documento_id: m.id, tipo: m.tipo, titulo: m.titulo, origem: m.origem, mission_id: m.mission_id, task_ref: m.task_ref, pane_id: m.pane_id, ocorrido_em: m.ocorrido_em })),
      proximo: mais ? String(inicio + limite) : null,
    };
  }

  function detalheDocumento(e: EstadoWs, id: string): DetalheDocumento | null {
    const m = e.svc.repos.documento.porId(id);
    if (m === undefined || m.colecao_id !== e.svc.colecaoId) return null; // id de outro workspace é inerte
    const chunks = e.svc.repos.documento.chunksDoDocumento(id).map((c: { id: string; texto: string }) => ({ id: c.id, trecho: c.texto.slice(0, 400) }));
    const ap = e.svc.repos.banco.consultarUm<{ id: string }>("SELECT id FROM rag_aprendizado WHERE documento_id = ?", [id]);
    const aprendizado = ap === undefined ? null : paraAprendizado(e, ap.id);
    const arestas = e.svc.repos.banco
      .consultar<{ origem_id: string; destino_id: string; tipo: string; peso: number }>("SELECT origem_id, destino_id, tipo, peso FROM rag_aresta WHERE documento_id = ? LIMIT 200", [id])
      .map((a) => ({ origem: a.origem_id, destino: a.destino_id, tipo: a.tipo, peso: a.peso }));
    return { fonte: { documento_id: m.id, tipo: m.tipo, titulo: m.titulo, origem: m.origem, mission_id: m.mission_id, task_ref: m.task_ref, pane_id: m.pane_id, ocorrido_em: m.ocorrido_em }, chunks, aprendizado, arestas };
  }

  function paraAprendizado(e: EstadoWs, id: string): Aprendizado | null {
    const a = e.svc.repos.aprendizado.obter(id);
    return a === undefined ? null : { id: a.id, tipo: a.tipo as Aprendizado["tipo"], titulo: a.titulo, texto: a.texto, fonte: a.fonte as Aprendizado["fonte"], estado: a.estado as Aprendizado["estado"], confianca: a.confianca, vezes_visto: a.vezes_visto, util: a.util, inutil: a.inutil, errado: a.errado, criado_em: a.criado_em };
  }

  function listarAprendizados(e: EstadoWs, p: { estado: string | null; tipo: string | null; busca: string | null; depois: string | null; limite: number }): Pagina<Aprendizado> {
    const inicio = deslocamento(p.depois);
    const limite = Math.max(1, Math.min(p.limite, 200));
    const busca = p.busca?.trim().toLowerCase() ?? "";
    const todos = e.svc.repos.aprendizado.listar(e.svc.colecaoId, { estado: p.estado, tipo: p.tipo, limite: 500 });
    const filtrados = busca === "" ? todos : todos.filter((a) => a.titulo.toLowerCase().includes(busca) || a.texto.toLowerCase().includes(busca));
    const fatia = filtrados.slice(inicio, inicio + limite);
    return {
      itens: fatia.map((a) => paraAprendizado(e, a.id)).filter((a): a is Aprendizado => a !== null),
      proximo: filtrados.length > inicio + limite ? String(inicio + limite) : null,
    };
  }

  // ---------------------------------------------------------------- um passo de trabalho de fundo (chamado pelo main quando ocioso)
  async function passo(e: EstadoWs, o: OpcoesPasso): Promise<ResultadoPasso> {
    if (!e.ativo) return { trabalho: null, pendentes: e.svc.repos.fila.pendentes(e.svc.colecaoId) };
    const trabalho = proximoTrabalho({
      filaPendente: e.svc.repos.fila.pendentes(e.svc.colecaoId),
      indiceCompleto: e.indiceCompleto,
      reembutindo: e.reembutir !== null,
      ultimaConsolidacaoMs: e.ultimaConsolidacao,
      agoraMs: agoraMs(),
      ocioso: o.ocioso,
      missaoFechada: o.missaoFechada === true,
    });
    if (trabalho === "fila") await e.svc.processarFila(20);
    else if (trabalho === "aquecer") e.indiceCompleto = e.svc.aquecer(20);
    else if (trabalho === "consolidar") {
      e.svc.consolidar(agoraMs());
      e.ultimaConsolidacao = agoraMs();
    } else if (trabalho === "reembutir" && e.reembutir !== null) {
      const r = await reembutirFatia({ repos: e.svc.repos, colecao_id: e.svc.colecaoId, provedor: e.reembutir.provedor, orcamentoMs: 20, medir: true });
      e.reembutir.pct = r.cobertura === null ? null : Math.round(r.cobertura * 100);
      if (r.trocou) {
        e.svc.registro.registrar(e.reembutir.provedor);
        e.reembutir = null;
        e.indiceCompleto = false;
      }
    }
    return { trabalho, pendentes: e.svc.repos.fila.pendentes(e.svc.colecaoId) };
  }

  // ---------------------------------------------------------------- modelos de embedding
  async function modelos(e: EstadoWs): Promise<{ ativo: string; modelos: Array<{ id: string; rotulo: string; dimensao: number; origem: "hash" | "ollama" | "onnx"; disponivel: boolean; motivo: string | null }>; ollama_url: string | null }> {
    const col = e.svc.repos.colecao.obter(e.svc.colecaoId);
    const nomes = await listarOllama();
    const lista: Array<{ id: string; rotulo: string; dimensao: number; origem: "hash" | "ollama" | "onnx"; disponivel: boolean; motivo: string | null }> = [
      { id: MODELO_HASH_ID, rotulo: "Lexical (piso local, sem download)", dimensao: 256, origem: "hash", disponivel: true, motivo: null },
    ];
    for (const n of nomes.filter((x) => /embed|bge|e5|minilm|gte|nomic|mxbai|arctic/i.test(x)).slice(0, 12)) {
      lista.push({ id: `ollama:${n.replace(/:latest$/, "")}:0`, rotulo: `Ollama · ${n}`, dimensao: 0, origem: "ollama", disponivel: true, motivo: "a dimensão é detectada no primeiro uso" });
    }
    lista.push({ id: "onnx:multilingual-e5-small:384", rotulo: "ONNX local · multilingual-e5-small (int8)", dimensao: 384, origem: "onnx", disponivel: false, motivo: "o runtime ONNX ainda não está instalado nesta versão (decisão D-82/P-50 registrada)" });
    return { ativo: col?.modelo_ativo ?? MODELO_HASH_ID, modelos: lista, ollama_url: nomes.length > 0 || d.chamarMain !== undefined ? "http://127.0.0.1:11434" : null };
  }

  async function definirModelo(e: EstadoWs, modelo: string): Promise<void> {
    if (!MODELO_VALIDO.test(modelo)) throw new Error("modelo inválido");
    const col = e.svc.repos.colecao.obter(e.svc.colecaoId);
    if (col === undefined || col.modelo_ativo === modelo) return;
    if (modelo === MODELO_HASH_ID) {
      const hash = e.svc.registro.obter(MODELO_HASH_ID);
      if (hash === undefined) throw new Error("piso lexical indisponível");
      e.reembutir = { provedor: hash, pct: 0 };
      return;
    }
    if (modelo.startsWith("onnx:")) throw new Error("o runtime ONNX ainda não está instalado");
    // ollama:<modelo>[:<dim>]: a dimensão real vem do primeiro vetor devolvido
    const nome = modelo.slice("ollama:".length).replace(/:\d+$/, "");
    const teste = criarProvedorOllama({ modelo: nome, dimensao: 1, transporte: transporteOllama() });
    if (!(await teste.disponivel())) throw new Error("o Ollama não tem esse modelo (ou não está rodando)");
    const resposta = (await d.chamarMain?.("rede.ollama", [{ url: "http://127.0.0.1:11434/api/embed", metodo: "POST", corpo: JSON.stringify({ model: nome, input: ["dimensão"] }) }])) as { ok: boolean; texto: string } | undefined;
    const dim = resposta?.ok ? ((JSON.parse(resposta.texto) as { embeddings?: number[][] }).embeddings?.[0]?.length ?? 0) : 0;
    if (dim <= 0 || dim > 4096) throw new Error("não foi possível detectar a dimensão do modelo");
    const provedor = criarProvedorOllama({ modelo: nome, dimensao: dim, transporte: transporteOllama() });
    e.svc.registro.registrar(provedor);
    e.reembutir = { provedor, pct: 0 };
  }

  // ---------------------------------------------------------------- tabela de métodos do RPC
  const m: Record<string, MetodoRpc> = {
    ...ragOnline.metodos,
    abrir: ([a]) => {
      abrir(a as AberturaWorkspace);
      return null;
    },
    ativar: ([ws, ativo]) => {
      exigir(ws).ativo = ativo === true;
      return null;
    },
    fechar: ([ws]) => {
      const e = typeof ws === "string" ? spaces.get(ws) : undefined;
      if (e !== undefined) {
        e.backfill?.ctl.abort();
        e.svc.fechar();
        spaces.delete(ws as string);
      }
      return null;
    },
    registrar: ([ws, entrada]) => {
      const dono = (entrada as { workspace_id?: unknown; evento?: { workspace_id?: unknown } }).workspace_id ?? (entrada as { evento?: { workspace_id?: unknown } }).evento?.workspace_id;
      if (typeof dono === "string" && dono !== ws) return null;
      exigir(ws).svc.registrarEntrada(entrada as EntradaConhecimento, PRIORIDADE.evento);
      return null;
    },
    registrarLote: ([ws, entradas]) => {
      const e = exigir(ws);
      if (!Array.isArray(entradas)) return 0;
      let n = 0;
      for (const en of entradas.slice(0, 1000)) {
        // entrada de OUTRO workspace nunca entra na coleção deste (o main roteia por `workspace_id`; aqui é a segunda trava)
        const dono = (en as { workspace_id?: unknown; evento?: { workspace_id?: unknown } }).workspace_id ?? (en as { evento?: { workspace_id?: unknown } }).evento?.workspace_id;
        if (typeof dono === "string" && dono !== ws) continue;
        e.svc.registrarEntrada(en as EntradaConhecimento, PRIORIDADE.evento);
        n++;
      }
      return n;
    },
    estado: ([ws, extra]) => {
      const e = exigir(ws);
      const base: EstadoConhecimento = e.svc.estado((extra as { tarefasDespachadas7d?: Array<{ mission_id: string; task_ref: string }> } | undefined) ?? {});
      const p = progresso(e);
      return { ...base, indexando: { pendentes: p.pendentes, fase: p.fase, pct: p.pct }, reembutindo_pct: p.reembutindo_pct };
    },
    progresso: ([ws]) => progresso(exigir(ws)),
    buscar: ([ws, p]): Promise<RespostaBusca> => exigir(ws).svc.buscar(p as PedidoBuscaServico),
    buscarHits: ([ws, p]) => exigir(ws).svc.buscarHits(p as { consulta: string; k?: number; origem?: "chat" | "ui" | "tool" | "injecao" | "hook"; prazoMs?: number }),
    contexto: ([ws, p]): Promise<RespostaContexto> => exigir(ws).svc.contexto(p as PedidoContextoServico),
    aprender: ([ws, p]) => exigir(ws).svc.aprender(p as Parameters<ServicoConhecimento["aprender"]>[0]),
    feedback: ([ws, p]) => exigir(ws).svc.feedback(p as Parameters<ServicoConhecimento["feedback"]>[0]),
    atualizarAprendizado: ([ws, id, acao, texto]) => exigir(ws).svc.atualizarAprendizado(String(id), acao as "ativar" | "arquivar" | "rejeitar" | "editar", typeof texto === "string" ? texto : undefined),
    listarAprendizados: ([ws, p]) => listarAprendizados(exigir(ws), p as Parameters<typeof listarAprendizados>[1]),
    esquecer: ([ws, alvo]) => exigir(ws).svc.esquecer(alvo as AlvoEsquecer & FiltroRemocao),
    purgar: ([ws, confirmacao]) => exigir(ws).svc.purgar(String(confirmacao)) ?? { removidos: -1 },
    subgrafo: ([ws, f]) => exigir(ws).svc.subgrafo(f as Parameters<ServicoConhecimento["subgrafo"]>[0]),
    detalheNo: ([ws, id]) => exigir(ws).svc.detalheNo(String(id)),
    gravarPosicoes: ([ws, p]) => ({ ok: exigir(ws).svc.gravarPosicoes(p as Array<{ id: string; x: number; y: number }>) >= 0 }),
    listarDocumentos: ([ws, p]) => listarDocumentos(exigir(ws), p as Parameters<typeof listarDocumentos>[1]),
    detalheDocumento: ([ws, id]) => detalheDocumento(exigir(ws), String(id)),
    consultouRecentemente: ([ws, missao, task]) => exigir(ws).svc.consultouRecentemente(String(missao), String(task)),
    passo: ([ws, o]) => passo(exigir(ws), o as OpcoesPasso),
    reindexar: ([ws, fonte, o]) => ({ enfileirado: iniciarBackfill(exigir(ws), ws as string, fonte as FonteReindexar, o as OpcoesReindexar) }),
    parar: ([ws]) => {
      exigir(ws).backfill?.ctl.abort();
      return null;
    },
    importarHistorico: async ([ws, cli, desdeMs]) => {
      const e = exigir(ws);
      if (d.home === null) return { enfileirado: false, sessoes: 0 };
      const base = { home: d.home, raiz: e.raiz, somenteIds: null, ...(typeof desdeMs === "number" ? { desdeMs } : {}), limite: 500, ...(d.codexHome ? { codexHome: d.codexHome } : {}) };
      const sessoes = cli === "claude" ? await listarSessoesClaude(base) : cli === "codex" ? await listarSessoesCodex(base) : [];
      let n = 0;
      for (const s of sessoes) {
        for (const en of lerTranscricao({ repos: e.svc.repos, colecao_id: e.svc.colecaoId, workspace_id: ws as string, sessao: s, consentimentoHistorico: true })) {
          e.svc.registrarEntrada(en, PRIORIDADE.backfill);
        }
        n++;
      }
      return { enfileirado: n > 0, sessoes: n };
    },
    modelos: ([ws]) => modelos(exigir(ws)),
    definirModelo: async ([ws, modelo]) => {
      await definirModelo(exigir(ws), String(modelo));
      return modelos(exigir(ws));
    },
    contagemConsultas: ([ws, desdeIso]) => {
      const e = exigir(ws);
      const n = e.svc.repos.banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM rag_consulta WHERE colecao_id = ? AND criado_em >= ?", [e.svc.colecaoId, String(desdeIso)]);
      return Number(n?.n ?? 0);
    },
    /** Aprendizados destilados por IA (P-56): candidatos já validados por esquema; entram como `sistema` (nascem `candidato`/`ativo` pela regra do núcleo). */
    registrarDestilados: async ([ws, candidatos, missionId]) => {
      const e = exigir(ws);
      let novos = 0;
      for (const c of (Array.isArray(candidatos) ? candidatos : []).slice(0, 7) as Array<{ tipo: "decisao" | "causa_raiz" | "armadilha" | "padrao" | "correcao" | "fato"; titulo: string; texto: string }>) {
        const r = await e.svc.aprender({ tipo: c.tipo, titulo: c.titulo, texto: c.texto, fonte: "sistema", mission_id: typeof missionId === "string" ? missionId : null, origem: "destilacao_ia" });
        if (r.status !== "merged") novos++;
      }
      return novos;
    },
    consultouMissao: ([ws, missao]) => {
      const e = exigir(ws);
      const desde = new Date(agoraMs() - 30 * 60_000).toISOString();
      return e.svc.repos.banco.consultarUm("SELECT 1 AS x FROM rag_consulta WHERE colecao_id = ? AND mission_id = ? AND criado_em >= ? LIMIT 1", [e.svc.colecaoId, String(missao), desde]) !== undefined;
    },
    colecaoId: ([ws]) => exigir(ws).svc.colecaoId,
  };

  return {
    metodos: m,
    abrir,
    servico: (ws) => spaces.get(ws)?.svc,
    fechar() {
      for (const e of spaces.values()) {
        e.backfill?.ctl.abort();
        try {
          e.svc.fechar();
        } catch {
          /* já fechado */
        }
      }
      spaces.clear();
      try {
        aberto?.banco.fechar();
      } catch {
        /* já fechado */
      }
      aberto = null;
    },
  };
}
