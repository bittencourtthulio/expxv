// Lógica PURA da tool MCP `alert_raise` (T-20.15): o registro no catálogo MCP (`mcp/catalogo.ts`/`portas.ts`) é do coordenador; ele só chama
// `executar` com o contexto vindo do TOKEN (D-13: `pane_id`/`mission_id` nunca vêm dos argumentos). Limites: <= 3/hora/Pane (`rate_limited`),
// título <= 80, detalhe <= 280, texto REDIGIDO, só `role=piloto` (ou worker se o workspace habilitar), classe `escrita_leve`, gera `agente_mensagem`
// (que NÃO vai a canal externo por padrão: o curinga das regras o exclui, AB-12).
import type { EntradaAlerta, Severidade } from "../../compartilhado/alertas";
import type { Emissor } from "./emissor";
import type { Relogio } from "./portas";
import { relogioReal } from "./portas";
import { redigirParaCanal } from "./texto";

export type KindAlerta = "info" | "attention" | "blocked" | "done";
export class ErroAlertRaise extends Error {
  constructor(readonly codigo: "invalid_args" | "rate_limited" | "forbidden") {
    super(codigo);
    this.name = "ErroAlertRaise";
  }
}
export interface ContextoAlertRaise {
  pane_id: string;
  mission_id: string | null;
  workspace_id: string | null;
  role: "piloto" | "worker";
  /** o workspace habilitou workers a levantar alertas? */
  worker_habilitado?: boolean;
}
const SEV: Record<KindAlerta, Severidade> = { info: "info", attention: "aviso", blocked: "aviso", done: "sucesso" };
const MAX_POR_HORA = 3;
/** teto GLOBAL por hora (respawnar painéis não contorna o limite por Pane) e poda do mapa de contagem. */
const MAX_GLOBAL_POR_HORA = 30;

export function criarAlertRaise(deps: { emissor: Pick<Emissor, "emitir">; relogio?: Relogio; scrub?: (t: string) => string }): { executar(args: unknown, ctx: ContextoAlertRaise): { alert_id: string; queued: boolean } } {
  const relogio = deps.relogio ?? relogioReal;
  const porPane = new Map<string, number[]>();
  let global: number[] = [];
  const opc = deps.scrub === undefined ? {} : { scrub: deps.scrub };
  return {
    executar(args, ctx) {
      if (ctx.role !== "piloto" && ctx.worker_habilitado !== true) throw new ErroAlertRaise("forbidden");
      const a = args as { kind?: unknown; title?: unknown; detail?: unknown; task_id?: unknown } | null;
      if (typeof a !== "object" || a === null) throw new ErroAlertRaise("invalid_args");
      const campos = Object.keys(a);
      if (campos.some((k) => !["kind", "title", "detail", "task_id"].includes(k))) throw new ErroAlertRaise("invalid_args");
      if (typeof a.kind !== "string" || !(a.kind in SEV)) throw new ErroAlertRaise("invalid_args");
      if (typeof a.title !== "string" || a.title.trim() === "" || a.title.length > 80) throw new ErroAlertRaise("invalid_args");
      if (a.detail !== undefined && (typeof a.detail !== "string" || a.detail.length > 280)) throw new ErroAlertRaise("invalid_args");
      if (a.task_id !== undefined && (typeof a.task_id !== "string" || !/^[A-Za-z0-9._-]{1,40}$/.test(a.task_id))) throw new ErroAlertRaise("invalid_args");
      const t = relogio.agora();
      global = global.filter((x) => t - x < 3_600_000);
      if (global.length >= MAX_GLOBAL_POR_HORA) throw new ErroAlertRaise("rate_limited");
      if (porPane.size > 500) for (const [k, v] of porPane) if (v.every((x) => t - x >= 3_600_000)) porPane.delete(k);
      const lista = (porPane.get(ctx.pane_id) ?? []).filter((x) => t - x < 3_600_000);
      if (lista.length >= MAX_POR_HORA) {
        porPane.set(ctx.pane_id, lista);
        throw new ErroAlertRaise("rate_limited");
      }
      lista.push(t);
      global.push(t);
      porPane.set(ctx.pane_id, lista);
      const e: EntradaAlerta = {
        tipo: "agente_mensagem",
        severidade: SEV[a.kind as KindAlerta],
        workspace_id: ctx.workspace_id,
        mission_id: ctx.mission_id,
        entidade_tipo: "pane",
        entidade_id: ctx.pane_id,
        titulo: redigirParaCanal(a.title, { ...opc, max: 80 }),
        dados: { detalhe: a.detail === undefined ? null : redigirParaCanal(a.detail as string, { ...opc, max: 280 }), task_id: (a.task_id as string | undefined) ?? null, cli: null },
        estado: `${a.kind}:${t}`,
      };
      const r = deps.emissor.emitir(e);
      return { alert_id: r?.id ?? "", queued: r !== null };
    },
  };
}
