// Coletor de eventos (T-08.08): barramento → entradas de memória, COALESCIDO (uma transação por tique, P-37). Só coleta se o modo
// efetivo ≠ off. Ouvinte com erro nunca derruba o barramento. Nenhum evento da memória carrega `conteudo`.
import type { Banco } from "../banco";
import type { Scrubber } from "../cofre/scrubber";
import { resolverContextoDaMissao, resolverContextoDoPane, type OpcoesContexto } from "./contexto";
import type { Ciclo } from "./ciclo";
import { criarEscritor, type PedidoGravacao } from "./escrita";
import { conhecimentoNulo, EventoInvalidoErro, montarEvento, type PortaConhecimento, type ReferenciaConhecimento, type TipoEventoConhecimento } from "./eventos-conhecimento";
import { metricasNulas, type Metricas } from "./metricas";
import { eventoDoMetodo } from "./ponte-memox";
import type { ContextoMemoria, Importancia } from "./tipos";

export interface BarramentoColetor {
  assinar<T = unknown>(tipo: string, ouvinte: (payload: T) => void): () => void;
}

export interface DepsColetor extends OpcoesContexto {
  banco: Banco;
  barramento: BarramentoColetor;
  agora?: () => Date;
  porta?: PortaConhecimento;
  metricas?: Metricas;
  scrubber?: Pick<Scrubber, "scrub">;
  raizDoWorkspace?: (workspaceId: string) => string | undefined;
  /** onde o ciclo é acionado no `mission.closed` (opcional). */
  ciclo?: Pick<Ciclo, "aoFecharMissao">;
  /** agenda o flush do tique; padrão `setTimeout(fn, 25)` com unref. */
  agendar?: (fn: () => void) => void;
}

interface EventoParcial {
  tipo: TipoEventoConhecimento;
  chave_natural: string;
  titulo: string;
  referencias?: ReferenciaConhecimento[];
}

interface Item {
  ctx: ContextoMemoria;
  pedido: Omit<PedidoGravacao, "ctx" | "origem">;
  /** evento ao conhecimento (RAG), emitido DEPOIS de a entrada ser gravada. */
  evento?: EventoParcial;
}

/** orçamento de cada fatia de escrita do coletor (P-37: nenhuma tarefa > 50 ms). */
export const FLUSH_ORCAMENTO_MS = 15;

const agendarPadrao = (fn: () => void): void => {
  const t = setTimeout(fn, 25);
  if (typeof t === "object" && t !== null && "unref" in t) (t as { unref: () => void }).unref();
};

/** Texto do evento de fechamento (o mesmo na transação do `close_pane` e no coletor: o dedupe de 24 h junta os dois). */
export function textoDeFechamento(displayId: number | null, motivo: string, duracaoMs?: number): string {
  const dur = typeof duracaoMs === "number" ? ` após ${Math.round(duracaoMs / 60_000)} min` : "";
  return `Painel #${displayId ?? "?"} encerrado (${motivo.replace(/\s+/g, " ").trim().slice(0, 80) || "encerrado"})${dur}`;
}

const txt = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function ligarColetor(deps: DepsColetor) {
  const metricas = deps.metricas ?? metricasNulas;
  const escritor = criarEscritor({
    banco: deps.banco, ...(deps.agora ? { agora: deps.agora } : {}), ...(deps.porta ? { porta: deps.porta } : {}), metricas,
    ...(deps.scrubber ? { scrubber: deps.scrubber } : {}), ...(deps.raizDoWorkspace ? { raizDoWorkspace: deps.raizDoWorkspace } : {}),
  });
  const agendar = deps.agendar ?? agendarPadrao;
  const porta = deps.porta ?? conhecimentoNulo;
  const opContexto: OpcoesContexto = deps.cliTemMcp ? { cliTemMcp: deps.cliTemMcp } : {};
  let fila: Item[] = [];
  let agendado = false;
  let ativo = true;
  const stats = { transacoes: 0, eventos: 0, descartados: 0, erros: 0 };
  const vistosMetodo = new Set<string>();

  let paraConhecimento: Item[] = [];

  /** Depois do COMMIT: a memória nunca depende do RAG, então erro aqui é engolido. */
  function emitirAoConhecimento(itens: Item[]): void {
    for (const it of itens) {
      const ev = it.evento;
      if (!ev) continue;
      const raiz = deps.raizDoWorkspace?.(it.ctx.workspace_id);
      const base = {
        tipo: ev.tipo, workspace_id: it.ctx.workspace_id, chave_natural: ev.chave_natural, ocorrido_em: (deps.agora ?? (() => new Date()))().toISOString(),
        mission_id: it.ctx.mission_id, pane_id: it.ctx.pane_id, linhagem_id: it.ctx.linhagem_id, fonte: "sistema" as const, importancia: it.pedido.importancia ?? 3,
        titulo: ev.titulo, texto: it.pedido.conteudo, ...(raiz ? { raiz } : {}), ...(deps.scrubber ? { scrubber: deps.scrubber } : {}),
      };
      try {
        try {
          porta.registrar(montarEvento({ ...base, ...(ev.referencias ? { referencias: ev.referencias } : {}) }));
        } catch (e) {
          if (!(e instanceof EventoInvalidoErro)) throw e;
          porta.registrar(montarEvento(base)); // referência inválida (caminho absoluto) é descartada; o evento segue
        }
      } catch {
        /* nunca lança */
      }
    }
  }

  /** Uma fatia: grava o que couber em FLUSH_ORCAMENTO_MS numa ÚNICA transação; o resto volta a ser agendado (nenhuma tarefa > 50 ms no main). */
  function flush(): void {
    agendado = false;
    if (fila.length === 0) return;
    const t0 = performance.now();
    paraConhecimento = [];
    try {
      deps.banco.transacao(() => {
        let feitos = 0;
        while (fila.length > 0 && (feitos === 0 || performance.now() - t0 < FLUSH_ORCAMENTO_MS)) {
          feitos++;
          const it = fila.shift() as Item;
          try {
            const r = escritor.gravar({ ctx: it.ctx, origem: "coletor", ...it.pedido });
            if (r === null) stats.descartados++;
            else {
              stats.eventos++;
              paraConhecimento.push(it);
            }
          } catch {
            stats.erros++; // limite, desligado depois, etc.: nunca derruba o lote
          }
        }
      });
      stats.transacoes++;
      emitirAoConhecimento(paraConhecimento);
    } catch {
      stats.erros++;
    }
    paraConhecimento = [];
    if (fila.length > 0 && ativo && !agendado) {
      agendado = true;
      agendar(flush);
    }
  }

  function enfileirar(ctx: ContextoMemoria | null, pedido: Item["pedido"], evento?: EventoParcial): void {
    if (!ativo || ctx === null || ctx.modo === "off") return;
    fila.push({ ctx, pedido, ...(evento ? { evento } : {}) });
    if (!agendado) {
      agendado = true;
      agendar(flush);
    }
  }

  const seguro = <T>(fn: (p: T) => void) => (p: T): void => {
    try {
      fn(p);
    } catch {
      stats.erros++;
    }
  };
  const ctxPane = (paneId: unknown): ContextoMemoria | null => {
    if (typeof paneId !== "string") return null;
    try {
      return resolverContextoDoPane(deps.banco, paneId, opContexto);
    } catch {
      return null;
    }
  };
  const ctxMissao = (id: unknown): ContextoMemoria | null => (typeof id === "string" ? resolverContextoDaMissao(deps.banco, id) : null);

  const desinscrever: Array<() => void> = [
    deps.barramento.assinar<Record<string, unknown>>(
      "handoff.submitted",
      seguro((p) => {
        const h = deps.banco.consultarUm<{ resumo: string; status: string; task_ref: string; mission_id: string; relatorio_path: string | null }>(
          "SELECT h.resumo, h.status, h.relatorio_path, t.task_ref, t.mission_id FROM handoff h JOIN task t ON t.id = h.task_id WHERE h.id = ?",
          [p.handoff_id as string],
        );
        if (!h) return;
        const ctx = ctxPane(p.pane_id) ?? ctxMissao(h.mission_id);
        if (!ctx) return;
        enfileirar({ ...ctx, mission_id: h.mission_id }, {
          tipo: "handoff", escopo: "missao", fonte: "sistema", importancia: (h.status === "ok" ? 3 : 4) as Importancia,
          conteudo: `${h.task_ref} · ${h.status} · ${txt(h.resumo, 400)}`,
        }, {
          tipo: "handoff.submitted", chave_natural: String(p.handoff_id), titulo: `Handoff ${h.task_ref} (${h.status})`,
          referencias: [{ tipo: "handoff", id: String(p.handoff_id) }, { tipo: "task", id: h.task_ref }, ...(h.relatorio_path ? [{ tipo: "relatorio" as const, id: h.relatorio_path }] : [])],
        });
      }),
    ),
    deps.barramento.assinar<Record<string, unknown>>(
      "pane.closed",
      seguro((p) => {
        const ctx = ctxPane(p.pane_id);
        if (!ctx) return;
        const d = deps.banco.consultarUm<{ display_id: number; criado_em: string }>("SELECT display_id, criado_em FROM pane WHERE id = ?", [p.pane_id as string]);
        const motivo = txt(p.reason ?? p.motivo, 80) || "encerrado";
        enfileirar(ctx, { tipo: "evento", escopo: ctx.linhagem_id ? "pane" : "missao", fonte: "sistema", importancia: 2, conteudo: textoDeFechamento(d?.display_id ?? null, motivo, d && typeof p.duracao_ms === "number" ? p.duracao_ms : undefined) },
          { tipo: "pane.closed", chave_natural: `${String(p.pane_id)}|${motivo}`, titulo: `Painel #${d?.display_id ?? "?"} encerrado` });
      }),
    ),
    deps.barramento.assinar<Record<string, unknown>>(
      "task.updated",
      seguro((p) => {
        const estado = txt(p.estado, 20);
        if (estado !== "validada" && estado !== "descartada") return;
        let missao = typeof p.mission_id === "string" ? p.mission_id : null;
        let ref = txt(p.task_ref, 60);
        if ((!missao || !ref) && typeof p.task_id === "string") {
          const t = deps.banco.consultarUm<{ mission_id: string; task_ref: string }>("SELECT mission_id, task_ref FROM task WHERE id = ?", [p.task_id]);
          if (t) (missao = missao ?? t.mission_id), (ref = ref || t.task_ref);
        }
        const ctx = ctxMissao(missao);
        if (ctx) enfileirar(ctx, { tipo: "evento", escopo: "missao", fonte: "sistema", importancia: 2, conteudo: `Task ${ref || "?"} ${estado}` },
          { tipo: "task.updated", chave_natural: `${typeof p.task_id === "string" ? p.task_id : `${missao}|${ref}`}|${estado}`, titulo: `Task ${ref || "?"} ${estado}`, referencias: ref ? [{ tipo: "task", id: ref }] : [] });
      }),
    ),
    deps.barramento.assinar<Record<string, unknown>>(
      "method.changed",
      seguro((p) => {
        const ev = eventoDoMetodo(p);
        if (!ev || vistosMetodo.has(ev.chave)) return;
        const m = deps.banco.consultarUm<{ id: string }>("SELECT id FROM mission WHERE trabalho_id = ? AND estado NOT IN ('concluida','falhou','abortada') ORDER BY criado_em DESC LIMIT 1", [ev.trabalho_id]);
        const ctx = ctxMissao(m?.id);
        if (!ctx || ctx.modo === "off") return;
        vistosMetodo.add(ev.chave);
        if (vistosMetodo.size > 5000) vistosMetodo.clear();
        enfileirar(ctx, { tipo: "evento", escopo: "missao", fonte: "sistema", importancia: ev.importancia, conteudo: ev.texto },
          { tipo: "method.changed", chave_natural: ev.chave, titulo: ev.texto.slice(0, 100), referencias: [{ tipo: "trabalho", id: ev.trabalho_id }] });
      }),
    ),
    deps.barramento.assinar<Record<string, unknown>>(
      "mission.closed",
      seguro((p) => {
        if (typeof p.mission_id !== "string") return;
        for (let i = 0; i < 10_000 && fila.length > 0; i++) flush(); // o que ainda está na fila entra antes do aprendizado e da destilação
        const ctx = ctxMissao(p.mission_id);
        if (ctx === null || ctx.modo === "off") return;
        deps.ciclo?.aoFecharMissao(p.mission_id);
      }),
    ),
  ];

  return {
    /** entrega a fila INTEIRA agora, em quantas fatias for preciso (testes e encerramento). */
    drenar(): void {
      for (let i = 0; i < 10_000 && fila.length > 0; i++) flush();
    },
    parar(): void {
      ativo = false;
      for (const d of desinscrever) d();
      for (let i = 0; i < 10_000 && fila.length > 0; i++) flush();
    },
    estatisticas: () => ({ ...stats, pendentes: fila.length }),
  };
}
