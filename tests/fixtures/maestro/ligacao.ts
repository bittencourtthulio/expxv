// Mundo de teste da ligação do Maestro no main: banco SQLite real (memória), workspace em pasta temporária, Panes/método/harness falsos.
import { vi } from "vitest";
import { criarTmp, novoBanco } from "../dominio/ambiente";
import { ocorrencia } from "./mundo";
import type { EventoMaestro, EventoRigidez } from "../../../src/compartilhado/maestro";
import type { Trabalho } from "../../../src/nucleo/metodo/tipos";
import { criarServicoMaestro } from "../../../src/nucleo/maestro";
import type { PortasServico } from "../../../src/nucleo/maestro";
import { criarBarramento } from "../../../src/main/barramento";
import { ligarMaestro, type DependenciasMaestro, type LigacaoMaestro } from "../../../src/main/maestro";

export const TEXTO_BUG = "corrige, estou com um problema no login: o botão de entrar não funciona";
export const HARNESS_OK = {
  decisorLer: () => ({ habilitado: false, usar_para: { intencao: false } }) as never,
  decisorDeIntencao: vi.fn(() => null),
  resolvedor: {
    async resolverPerfilDeEtapa(_s: string, _e: string, _c: unknown, perfil: { cli?: string; modelo?: string | null; esforco?: string | null; faixa?: string } | null) {
      const cli = perfil?.cli === "auto" ? "opencode" : (perfil?.cli ?? "claude");
      return { ok: true, executor: { provider: cli, cli, model: perfil?.modelo ?? "m", effort: perfil?.esforco ?? null }, cli, conta_id: null, faixa: perfil?.faixa ?? "alto", recibo: "ok" };
    },
  },
};

export interface Mundo {
  l: LigacaoMaestro;
  ws: string;
  raiz: string;
  abertos: Array<{ cli: string; papel: string; prompt_inicial?: string; cwd?: string; workspace_id?: string; contexto?: Record<string, unknown> }>;
  barramento: ReturnType<typeof criarBarramento>;
  eventos: EventoMaestro[];
  rigidez: EventoRigidez[];
  notificacoes: string[];
  definirDisco(t: Trabalho | null): void;
  panePronto(id: string): void;
  criarServico: ReturnType<typeof vi.fn>;
  deps: DependenciasMaestro;
}
export function montar(banco?: ReturnType<typeof novoBanco>, o: Partial<DependenciasMaestro> = {}, existente?: { id: string }): Mundo {
  const { repos } = banco ?? novoBanco();
  const ws = existente === undefined ? repos.workspace.criar({ nome: "w", raiz: criarTmp("maestro-") }) : repos.workspace.exigir(existente.id);
  const raizReal = ws.raiz;
  const barramento = criarBarramento();
  const abertos: Mundo["abertos"] = [];
  let trabalho: Trabalho | null = null;
  const eventos: EventoMaestro[] = [];
  const rigidez: EventoRigidez[] = [];
  const notificacoes: string[] = [];
  const criarServico = vi.fn();
  const camadas = { convencoes: false, perfil_legado: false, design_system: false, produto: true, hooks: false, lock: false, memoria: false };
  const deps: DependenciasMaestro = {
    repos,
    workspaces: { exigir: (id) => repos.workspace.exigir(id), permissaoDe: () => "seguro" },
    panes: {
      async abrirPane(p) {
        abertos.push({ cli: p.cli, papel: p.papel ?? "nenhum", ...(p.prompt_inicial === undefined ? {} : { prompt_inicial: p.prompt_inicial }), ...(p.cwd === undefined ? {} : { cwd: p.cwd }), ...(p.workspace_id == null ? {} : { workspace_id: p.workspace_id }), ...(p.contexto === undefined ? {} : { contexto: p.contexto as Record<string, unknown> }) });
        const pane = repos.pane.criar({ workspace_id: ws.id, tipo: "cli", cli: p.cli, papel: p.papel ?? "nenhum", cwd: "." } as never);
        repos.pane.atualizar(pane.id, { estado: "trabalhando" });
        return { pane, sessao_id: `s${abertos.length}` };
      },
      async enviarComando() {},
      async encerrarPane(id: string) {
        return repos.pane.encerrar(id, "teste");
      },
    },
    metodo: {
      async garantir() {},
      estado: () => ({ camadas, trabalhos: trabalho === null ? [] : [trabalho] }),
      indices: async () => new Map(trabalho === null ? [] : [[raizReal, { raiz: raizReal, trabalhos: [trabalho], camadas } as never]]),
    },
    harness: () => HARNESS_OK as never,
    barramento,
    emitirRenderer: (canal, payload) => void (canal === "maestro:evento" ? eventos.push(payload as EventoMaestro) : rigidez.push(payload as EventoRigidez)),
    notificarNativa: (d) => void notificacoes.push(d.title),
    debounceMs: 5,
    tickMs: 600_000,
    // o criador real, só contando as chamadas (leveza: nada de serviço antes do primeiro uso)
    criarServico: (portas: PortasServico) => {
      criarServico();
      return criarServicoMaestro(portas);
    },
    ...o,
  };
  const l = ligarMaestro(deps);
  return {
    l, ws: ws.id, raiz: raizReal, abertos, barramento, eventos, rigidez, notificacoes, criarServico, deps,
    definirDisco: (t) => void (trabalho = t),
    panePronto: (id) => void repos.pane.atualizar(id, { estado: "pronto" }),
  };
}
export const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const pedirBug = (m: Mundo, texto = TEXTO_BUG) => m.l.pedir({ workspace_id: m.ws, texto, contexto: null, via: "paleta", nivel_pedido: null, executar_direto: null });
export const confirmar = (m: Mundo, id: string) => m.l.confirmar({ plano_id: id, nivel: null, etapas_desligadas: [], intencao: null, justificativa: null, confirmacao_digitada: null });
export const oc = (estagio: string, extra: Partial<Trabalho> = {}): Trabalho => ocorrencia(estagio, { ultima_atividade: new Date(Date.now() + 60_000).toISOString(), status: "em_andamento", titulo: "login", ...extra }) as unknown as Trabalho;
