// Mundo falso do Maestro para testes: disco do método mutável, Panes, harness, persistência em memória, relógio, notificações.
// Nada de processo, rede nem Electron: o ServicoMaestro roda inteiro por portas.
import { trab } from "../metodo/construtores";
import type { EstadoPane, Papel } from "../../../src/nucleo/dominio/enums";
import type { EtapaId } from "../../../src/compartilhado/maestro";
import type { SondaDeDisco, TrabalhoParaMaestro } from "../../../src/nucleo/maestro/etapas/conclusao";
import type { ArgsAbrirPane } from "../../../src/nucleo/maestro/despachante";
import type { PortaHarnessDeEtapa } from "../../../src/nucleo/maestro/perfis/resolver";
import { CONFIG_MAESTRO_PADRAO, type ConfigMaestro } from "../../../src/nucleo/maestro/config";
import { criarPersistenciaEmMemoria, criarServicoMaestro, type ContextoDoMetodo, type NotificacaoMaestro, type PortasServico, type ServicoMaestro } from "../../../src/nucleo/maestro/servico";
import type { PortaArquivosHooks } from "../../../src/nucleo/maestro/rigidez/hooks";
import type { DecisorDeIntencao } from "../../../src/nucleo/maestro/decisor/cliente";

export interface PaneFalso {
  id: string;
  estado: EstadoPane;
  args: ArgsAbrirPane | null;
  comandos: string[];
  fechado: boolean;
}
export interface MundoFalso {
  t: { ms: number };
  disco: { trabalho: TrabalhoParaMaestro | null; sondas: Map<string, number>; evidencia: ContextoDoMetodo["evidencia"]; branch: string | null; ultimaMudanca: number | null; criarTrabalhoEm: number | null };
  panes: Map<string, PaneFalso>;
  arquivos: Map<string, string>;
  notificacoes: NotificacaoMaestro[];
  eventos: Array<{ tipo: string; pipeline_id: string | null; detalhe?: string | undefined }>;
  config: ConfigMaestro;
  niveis: { workspace: number | null; missao: Map<string, number> };
  hooksTexto: { existeExpx: boolean; conteudo: string | null; escritas: string[] };
  consultas: string[];
  aprendizados: string[];
  persistencia: ReturnType<typeof criarPersistenciaEmMemoria>;
  servico: ServicoMaestro;
  portas: PortasServico;
  /** abre um Pane falso (mesmo caminho do despachante) e devolve os que existem. */
  vivos(): PaneFalso[];
  doPipeline(id: string): PaneFalso[];
  avancarTempo(ms: number): void;
  /** o método (skill) escreve algo no disco. */
  escreverNoDisco(rel: string): void;
  /** troca o trabalho do disco (ex.: skill criou a OC / avançou o estágio). */
  definirTrabalho(t: TrabalhoParaMaestro | null): void;
  panePronto(id: string): void;
}

export const WS = "ws1";
export const sondaDe = (m: Map<string, number>): SondaDeDisco => ({ existe: (r) => m.has(r), mtime: (r) => m.get(r) ?? null });

export const ocorrencia = (estagio: string, o: Record<string, unknown> = {}): TrabalhoParaMaestro =>
  trab({ tipo: "ocorrencia", ferramenta: "runx", id: "OC-2026-0142-corrige-login", pasta: "docs/manutencao/OC-2026-0142-corrige-login", estagio, status: "em_andamento", veredito_qa: null, veredito_auditoria: null, ...o });
export const feature = (estagio: string, o: Record<string, unknown> = {}): TrabalhoParaMaestro =>
  trab({ tipo: "feature", ferramenta: "sprintx", id: "export-csv", pasta: "docs/sprintx/features/export-csv", estagio, status: "em_andamento", veredito_auditoria: null, ...o });
export const pedido = (o: Record<string, unknown> = {}): TrabalhoParaMaestro =>
  trab({ tipo: "pedido", ferramenta: "prodx", id: "PD-2026-0007", pasta: "docs/produto/pedidos/PD-2026-0007", estagio: "p3", status: "em_andamento", prodx: { veredito: null, assinado: false, briefing: false }, ...o });

export interface OpcoesMundo {
  config?: Partial<ConfigMaestro>;
  nivelWorkspace?: number | null;
  decisor?: DecisorDeIntencao | null;
  evidencia?: Partial<ContextoDoMetodo["evidencia"]>;
  branch?: string | null;
  comHooks?: boolean;
  comExpx?: boolean;
  hooksConteudo?: string | null;
  abrirPaneFalha?: boolean;
  harness?: PortaHarnessDeEtapa;
}

export function criarMundo(o: OpcoesMundo = {}): MundoFalso {
  const t = { ms: Date.parse("2026-10-01T12:00:00.000Z") };
  let contaId = 0;
  const m: MundoFalso = {
    t,
    disco: { trabalho: null, sondas: new Map(), evidencia: { legado: false, convencoes: false, design_system: false, produto: true, raio: null, ...(o.evidencia ?? {}) }, branch: o.branch ?? "feature/x", ultimaMudanca: null, criarTrabalhoEm: null },
    panes: new Map(),
    arquivos: new Map(),
    notificacoes: [],
    eventos: [],
    config: { ...CONFIG_MAESTRO_PADRAO, ...(o.config ?? {}) },
    niveis: { workspace: o.nivelWorkspace ?? null, missao: new Map() },
    hooksTexto: { existeExpx: o.comExpx ?? true, conteudo: o.hooksConteudo ?? null, escritas: [] },
    consultas: [],
    aprendizados: [],
    persistencia: criarPersistenciaEmMemoria(),
    servico: undefined as never,
    portas: undefined as never,
    vivos: () => [...m.panes.values()].filter((p) => !p.fechado),
    doPipeline: (id) => [...m.panes.values()].filter((p) => p.args?.pipeline_id === id),
    avancarTempo: (ms) => void (t.ms += ms),
    escreverNoDisco: (rel) => {
      m.disco.sondas.set(rel, t.ms);
      m.disco.ultimaMudanca = t.ms;
    },
    definirTrabalho: (tr) => {
      m.disco.trabalho = tr;
      m.disco.ultimaMudanca = t.ms;
    },
    panePronto: (id) => void ((m.panes.get(id) as PaneFalso).estado = "pronto"),
  };
  const harness: PortaHarnessDeEtapa =
    o.harness ??
    ({
      async resolverPerfilDeEtapa(_skill, _etapa, ctx, perfil) {
        const auto = perfil?.cli === "auto";
        const cli = auto ? (ctx.implementador_provedor === "claude" ? "opencode" : "claude") : (perfil?.cli ?? "claude");
        return { ok: true, executor: { provider: cli, cli, model: perfil?.modelo ?? `m-${perfil?.faixa ?? "alto"}`, effort: perfil?.esforco ?? null }, cli, conta_id: `conta-${cli}`, faixa: perfil?.faixa ?? "alto", recibo: "ok" };
      },
    } satisfies PortaHarnessDeEtapa);
  const hooksPorta: PortaArquivosHooks = {
    existeExpx: async () => m.hooksTexto.existeExpx,
    ler: async () => m.hooksTexto.conteudo,
    escreverAtomico: async (txt) => {
      m.hooksTexto.conteudo = txt;
      m.hooksTexto.escritas.push(txt);
    },
    gravarBackup: async (_txt, ts) => `backup/hooks-${ts}.json`,
  };
  m.portas = {
    relogio: { agora: () => t.ms },
    novoId: (p) => `${p}_${String(++contaId).padStart(4, "0")}`,
    persistencia: m.persistencia,
    metodo: {
      async contexto(_ws, p) {
        const tr = m.disco.trabalho !== null && (p.trabalho_id === null || m.disco.trabalho.id === p.trabalho_id) ? m.disco.trabalho : p.trabalho_id === null ? m.disco.trabalho : null;
        return { trabalho: tr, sondas: sondaDe(m.disco.sondas), evidencia: m.disco.evidencia, ultima_task_concluida_ms: null, ultima_mudanca_ms: m.disco.ultimaMudanca, branch: m.disco.branch };
      },
      slugsAbertos: async () => (m.disco.trabalho === null ? [] : [m.disco.trabalho.id]),
      acharTrabalho: async (_ws, ref) => (m.disco.trabalho !== null && (m.disco.trabalho.id.startsWith(ref.id) || ref.id === m.disco.trabalho.id) ? { trabalho: m.disco.trabalho, sondas: sondaDe(m.disco.sondas) } : null),
      descobrirTrabalho: async (_ws, _p, _desde) => m.disco.trabalho?.id ?? null,
    },
    niveis: { workspace: async () => m.niveis.workspace, missao: async (id) => m.niveis.missao.get(id) ?? null },
    config: () => m.config,
    despachante: {
      panes: {
        async abrirPane(a) {
          if (o.abrirPaneFalha === true) throw new Error("não abriu");
          const id = `pane${m.panes.size + 1}`;
          m.panes.set(id, { id, estado: "trabalhando", args: a, comandos: [a.prompt_inicial], fechado: false });
          return { pane_id: id };
        },
        async enviarComando(id, texto) {
          (m.panes.get(id) as PaneFalso).comandos.push(texto);
          (m.panes.get(id) as PaneFalso).estado = "trabalhando";
        },
        estado: (id) => m.panes.get(id)?.estado ?? null,
      },
      harness,
      fontes: () => ({}),
      arquivos: { gravar: async (rel, texto) => void m.arquivos.set(rel, texto) },
      cwdDoPipeline: (_p, tr) => (tr === null ? "/ws" : `/ws/${tr.pasta}`),
    },
    arquivos: {
      gravar: async (_ws, rel, texto) => void m.arquivos.set(rel, texto),
      ler: async (_ws, rel) => m.arquivos.get(rel) ?? null,
    },
    estadosDosPanes: (ids) => Object.fromEntries(ids.filter((i) => m.panes.has(i) && !(m.panes.get(i) as PaneFalso).fechado).map((i) => [i, { estado: (m.panes.get(i) as PaneFalso).estado }])),
    fecharPane: async (id) => void ((m.panes.get(id) as PaneFalso).fechado = true),
    consultar: async (_ws, etapa) => void m.consultas.push(etapa),
    aprender: async (p) => void m.aprendizados.push(p.id),
    notificar: (n) => void m.notificacoes.push(n),
    evento: (e) => void m.eventos.push(e),
    ...(o.comHooks === true ? { hooks: () => hooksPorta } : {}),
    ...(o.decisor !== undefined ? { decisor: o.decisor } : {}),
  };
  m.servico = criarServicoMaestro(m.portas);
  return m;
}

export const ultimo = <T>(l: readonly T[]): T => l[l.length - 1] as T;
export type { EtapaId, Papel };
