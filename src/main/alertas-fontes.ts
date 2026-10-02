// Fontes de alerta no main (Fase 20, T-20.09/T-20.10): converte os eventos de domínio do barramento nas entradas do núcleo (`Fontes`) e em alertas diretos. Nada aqui faz polling:
// cada fonte é uma assinatura do barramento. O tempo de trabalho avança com `pane.state_changed` (Pane `trabalhando`); tokens vêm do custo (F10), pontos da gestão ágil (F18).
// Eventos que ainda não existem no app (PR/checks do VCS) ficam `fonte_indisponivel` no catálogo (pendência registrada na auditoria da fase).
import type { EntradaAlerta } from "../compartilhado/alertas";
import type { EventoAgil } from "../compartilhado/agil";
import type { IndiceProjeto } from "../nucleo/metodo/tipos";
import type { Fontes, EventoTask, StatusTask } from "../nucleo/alertas/fontes";
import type { AcumuladorTempo } from "../nucleo/alertas/tempo";
import type { Banco } from "../nucleo/banco";
import type { Barramento } from "./barramento";

export interface DepsFontesMain {
  banco: Banco;
  barramento: Pick<Barramento, "assinar">;
  fontes: Fontes;
  tempo: Pick<AcumuladorTempo, "paneEncerrado">;
  emitir(e: EntradaAlerta): unknown;
  /** rótulo + provedor da conta (cota/troca). */
  conta(conta_id: string): { rotulo: string; provedor: string } | null;
  /** destino da troca (`troca_id` -> rótulo da conta nova). */
  destinoDaTroca(troca_id: string): string | null;
  /** índice do método (veredito de QA); `null` = workspace sem índice. */
  indiceMetodo(workspace_id: string): IndiceProjeto | null;
  aviso(m: string): void;
}

interface PayloadTask {
  task_id?: string;
  task_ref?: string;
  mission_id?: string;
  workspace_id?: string;
  estado?: string;
  pane_id?: string | null;
  motivo?: string | null;
}
const STATUS: Record<string, StatusTask> = { aberta: "pendente", reivindicada: "em_andamento", entregue: "concluida", validada: "concluida", descartada: "outro" };

const texto = (v: unknown, max = 200): string | null => (typeof v === "string" && v !== "" ? v.slice(0, max) : null);
const mapaEstadoPane = (e: string): string => (e === "trabalhando" || e === "aguardando" ? e : e === "encerrado" ? "encerrado" : "ocioso");

/** liga as assinaturas; devolve a função que as remove. Falha de uma fonte nunca derruba as outras (cada manipulador é isolado). */
export function ligarFontes(d: DepsFontesMain): () => void {
  const guardado = <T>(nome: string, f: (p: T) => void) => (p: T): void => {
    try {
      f(p);
    } catch (e) {
      d.aviso(`alertas: fonte ${nome} falhou (${e instanceof Error ? e.name : "erro"})`);
    }
  };
  const missao = (id: string): { titulo: string; workspace_id: string; trabalho_id: string | null } | undefined => d.banco.consultarUm<{ titulo: string; workspace_id: string; trabalho_id: string | null }>("SELECT titulo, workspace_id, trabalho_id FROM mission WHERE id = ?", [id]);
  const pane = (id: string): { cli: string | null; modelo: string | null; mission_id: string | null; workspace_id: string } | undefined => d.banco.consultarUm<{ cli: string | null; modelo: string | null; mission_id: string | null; workspace_id: string }>("SELECT cli, modelo, mission_id, workspace_id FROM pane WHERE id = ?", [id]);
  const qaVisto = new Map<string, string>();
  const qaSemeado = new Set<string>();
  const desligar: Array<() => void> = [];

  desligar.push(
    d.barramento.assinar<PayloadTask>("task.updated", guardado("task", (p) => {
      const ref = texto(p.task_ref, 40);
      const mid = texto(p.mission_id, 80);
      if (ref === null || mid === null) return;
      const m = missao(mid);
      if (m === undefined) return;
      const status = STATUS[p.estado ?? ""] ?? "outro";
      if (status === "outro" || status === "pendente") return;
      const cardTitulo = d.banco.consultarUm<{ titulo: string }>("SELECT titulo FROM task WHERE mission_id = ? AND task_ref = ?", [mid, ref])?.titulo ?? ref;
      const pn = p.pane_id === undefined || p.pane_id === null ? undefined : pane(p.pane_id);
      const ev: EventoTask = {
        workspace_id: m.workspace_id,
        trabalho_id: m.trabalho_id ?? mid,
        task_id: ref,
        titulo: cardTitulo,
        status,
        pane_id: p.pane_id ?? null,
        mission_id: mid,
        missao: m.titulo,
        cli: pn?.cli ?? null,
        modelo: pn?.modelo ?? null,
        motivo: texto(p.motivo, 120),
      };
      d.fontes.aoTask(ev);
    })),
  );

  desligar.push(
    d.barramento.assinar<{ pane_id?: string; estado?: string }>("pane.state_changed", guardado("pane", (p) => {
      const id = texto(p.pane_id, 80);
      const estado = texto(p.estado, 30);
      if (id === null || estado === null) return;
      const pn = pane(id);
      const m = pn?.mission_id == null ? undefined : missao(pn.mission_id);
      d.fontes.aoPane({ pane_id: id, estado: mapaEstadoPane(estado), cli: pn?.cli ?? null, mission_id: pn?.mission_id ?? null, missao: m?.titulo ?? null, workspace_id: pn?.workspace_id ?? null, pergunta: null });
    })),
  );

  desligar.push(d.barramento.assinar<{ pane_id?: string }>("pane.closed", guardado("pane_closed", (p) => void (typeof p.pane_id === "string" && d.tempo.paneEncerrado(p.pane_id)))));

  desligar.push(
    d.barramento.assinar<{ mission_id?: string; workspace_id?: string; estado?: string }>("mission.closed", guardado("missao", (p) => {
      const id = texto(p.mission_id, 80);
      if (id === null || (p.estado !== "concluida" && p.estado !== "falhou")) return; // "abortada" é gesto do usuário: sem alerta
      const m = missao(id);
      if (m === undefined) return;
      const total = d.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM task WHERE mission_id = ? AND estado <> 'descartada'", [id])?.n ?? 0;
      d.fontes.aoMissaoFechada({ workspace_id: m.workspace_id, mission_id: id, titulo: m.titulo, resultado: p.estado, tarefas_total: total });
    })),
  );

  // Maestro (F16): o pipeline pediu a sua atenção (etapa humana, confirmação, falha). A notificação nativa do Maestro continua como está; este alerta vai ao Centro (e a regras do usuário),
  // e o canal SO padrão NÃO inclui este tipo (sem notificação duplicada).
  desligar.push(
    d.barramento.assinar<{ pipeline_id?: string; motivo?: string; etapa_id?: string | null }>("maestro.notification", guardado("maestro", (p) => {
      const id = texto(p.pipeline_id, 80);
      if (id === null) return;
      const motivo = texto(p.motivo, 60) ?? "atenção";
      d.emitir({ tipo: "missao_aguardando_aprovacao", entidade_tipo: "pipeline", entidade_id: id, titulo: "O Maestro precisa de você", dados: { missao: motivo.replace(/_/g, " "), cli: "Maestro", espera_ms: 0 }, estado: `${motivo}:${texto(p.etapa_id, 40) ?? ""}` });
    })),
  );

  // cota (F9): nomes reais do barramento são `limit.reached`, `limit.high` e `account.switched`
  desligar.push(
    d.barramento.assinar<{ conta_id?: string; janela?: string; used_pct?: number }>("limit.reached", guardado("cota", (p) => {
      const c = typeof p.conta_id === "string" ? d.conta(p.conta_id) : null;
      d.emitir({ tipo: "cota_atingida", entidade_tipo: "conta", entidade_id: texto(p.conta_id, 80) ?? "?", titulo: `Cota atingida: ${c?.rotulo ?? "conta"}`, dados: { conta: c?.rotulo ?? null, provedor: c?.provedor ?? null, pct: 100, zera_em: null }, estado: `${p.janela ?? ""}` });
    })),
  );
  desligar.push(
    d.barramento.assinar<{ conta_id?: string; janela?: string; used_pct?: number }>("limit.high", guardado("consumo", (p) => {
      const c = typeof p.conta_id === "string" ? d.conta(p.conta_id) : null;
      const pct = typeof p.used_pct === "number" && Number.isFinite(p.used_pct) ? Math.round(p.used_pct) : null;
      d.emitir({ tipo: "limite_consumo", entidade_tipo: "conta", entidade_id: texto(p.conta_id, 80) ?? "?", titulo: `Consumo alto: ${c?.rotulo ?? "conta"}`, dados: { conta: c?.rotulo ?? null, provedor: c?.provedor ?? null, pct, zera_em: null }, estado: `${p.janela ?? ""}:${pct === null ? "" : Math.floor(pct / 5)}` });
    })),
  );
  desligar.push(
    d.barramento.assinar<{ troca_id?: string; workspace_id?: string }>("account.switched", guardado("troca", (p) => {
      const para = typeof p.troca_id === "string" ? d.destinoDaTroca(p.troca_id) : null;
      d.emitir({ tipo: "conta_trocada", workspace_id: texto(p.workspace_id, 80), entidade_tipo: "troca", entidade_id: texto(p.troca_id, 80) ?? "?", titulo: "Conta trocada por consumo", dados: { conta: null, provedor: null, para }, estado: "feita" });
    })),
  );

  // sprint (F18): o serviço ágil publica `sprint.iniciada|fechada|em_risco` com `EventoAgil`
  const sprint = (tipo: "sprint_iniciada" | "sprint_fechada" | "sprint_em_risco") => guardado<EventoAgil>(tipo, (ev) => {
    const dados = ev.dados as Record<string, unknown>;
    const resumo = (dados["resumo_fechamento"] ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const sp = ev.sprint_id === null ? undefined : d.banco.consultarUm<{ nome: string; capacidade_pontos: number | null; compromisso_pontos: number | null }>("SELECT nome, capacidade_pontos, compromisso_pontos FROM agil_sprint WHERE id = ?", [ev.sprint_id]);
    d.emitir({
      tipo,
      workspace_id: ev.workspace_id,
      entidade_tipo: "sprint",
      entidade_id: ev.sprint_id ?? "?",
      titulo: texto(sp?.nome, 80) ?? (tipo === "sprint_iniciada" ? "Sprint iniciada" : tipo === "sprint_fechada" ? "Sprint fechada" : "Sprint em risco"),
      dados: {
        sprint_nome: texto(sp?.nome, 80),
        capacidade_pts: num(sp?.capacidade_pontos),
        comprometido_pts: num(sp?.compromisso_pontos) ?? num(resumo["comprometido_pontos"]),
        entregues_pts: num(ev.pontos) ?? num(resumo["concluido_pontos"]),
        velocidade: num(resumo["velocidade"]),
        retrabalho: texto(resumo["retrabalho"], 20),
      },
      estado: tipo,
    });
  });
  desligar.push(d.barramento.assinar<EventoAgil>("sprint.iniciada", sprint("sprint_iniciada")));
  desligar.push(d.barramento.assinar<EventoAgil>("sprint.fechada", sprint("sprint_fechada")));
  desligar.push(d.barramento.assinar<EventoAgil>("sprint.em_risco", sprint("sprint_em_risco")));

  // relatório de sprint pronto (F19): o serviço publica `relatorio.pronto` no barramento ao terminar o pacote (nada de caminho de arquivo: o alerta aponta para a tela de relatórios)
  desligar.push(
    d.barramento.assinar<{ workspace_id?: string; sprint_id?: string; pacote_id?: string; versao?: number }>("relatorio.pronto", guardado("relatorio", (p) => {
      const pacote = texto(p.pacote_id, 80);
      if (pacote === null) return;
      const sp = typeof p.sprint_id === "string" ? d.banco.consultarUm<{ nome: string }>("SELECT nome FROM agil_sprint WHERE id = ?", [p.sprint_id]) : undefined;
      d.emitir({
        tipo: "relatorio_pronto",
        workspace_id: texto(p.workspace_id, 80),
        entidade_tipo: "relatorio",
        entidade_id: pacote,
        titulo: `Relatório pronto: ${texto(sp?.nome, 80) ?? "sprint"}`,
        dados: { tipo_relatorio: "sprint", formato: "HTML, MD e CSV", caminho: "aba Relatórios" },
        estado: `v${typeof p.versao === "number" ? p.versao : 1}`,
      });
    })),
  );

  // QA (método): veredito de `QA.md` no índice. A 1ª leitura de cada trabalho só registra a linha de base (nada é alertado pelo que já existia).
  desligar.push(
    d.barramento.assinar<{ workspace_id?: string }>("method.changed", guardado("qa", (p) => {
      const ws = texto(p.workspace_id, 80);
      if (ws === null) return;
      const indice = d.indiceMetodo(ws);
      if (indice === null) return;
      const primeira = !qaSemeado.has(ws);
      qaSemeado.add(ws);
      for (const t of indice.trabalhos) {
        const v = t.veredito_qa === "aprovado" || t.veredito_qa === "reprovado" ? t.veredito_qa : "";
        const k = `${ws}|${t.id}`;
        const antes = qaVisto.get(k) ?? "";
        qaVisto.set(k, v);
        if (primeira || v === "" || antes === v) continue; // 1ª leitura = linha de base; sem veredito ou sem mudança = nada
        d.fontes.aoQa({ workspace_id: ws, trabalho_id: t.id, task_id: t.id, veredito: v, achados: 0, rodada: 1, missao: null });
      }
    })),
  );

  return () => {
    for (const f of desligar.splice(0)) f();
  };
}
