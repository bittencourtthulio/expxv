// Consultas e gates da ENTRADA remota (Fase 20, T-20.31): `/status`, `/tarefas`, `/atrasadas`, `/missoes`, `/consumo`, `/aprovacoes`. SÓ dos workspaces recebidos (o núcleo
// já filtra pela allowlist do usuário), sempre leitura e sempre redigido pelo núcleo na saída. Gates: só os portões de intake da Missão (direction/content/build/qa), que a
// pessoa liberaria no desktop; assinatura do prodx, raio ALTO, merge e `mergex-revisar` NÃO são gates deste adaptador (D-21).
import type { DadosTarefa } from "../nucleo/alertas/metricas";
import type { Banco } from "../nucleo/banco";
import type { ReferenciaTask } from "../nucleo/alertas/portas";
import { PORTOES_MISSAO, type PortaoMissao } from "../compartilhado/dominio";
import type { ServicoPortoes } from "../nucleo/orquestracao/portoes";
import { lerPortoes } from "../nucleo/orquestracao/portoes";
import type { RepoConfig } from "../nucleo/banco/repos/config";
import type { GatePendente, LinhaTarefaConsulta, PortaConsulta, PortaGates } from "../nucleo/telegram/portas-entrada";

const ESTADOS_ATIVOS = ["intake", "planejando", "executando", "revisando"] as const;
const marcas = (n: number): string => Array.from({ length: n }, () => "?").join(",");

export interface DepsConsultaTelegram {
  banco: Banco;
  nomeWorkspace(workspace_id: string): string | null;
  /** números da task (tempo de trabalho, tokens, SP, atraso/limite) — a MESMA conta dos alertas. */
  dadosDaTask(ref: ReferenciaTask): Pick<DadosTarefa, "tempo_trabalho_ms" | "tokens" | "story_points" | "atraso_ms" | "limite_ms">;
  cotaGeralPct(): number | null;
  criticosNaoLidos(): number;
  consumo?(): Promise<Array<{ conta: string; provedor: string; pct: number | null }>>;
}

interface LinhaTask {
  task_ref: string;
  titulo: string;
  workspace_id: string;
  trabalho_id: string | null;
  mission_id: string;
  papel: string | null;
}

export function criarConsultaTelegram(d: DepsConsultaTelegram): PortaConsulta {
  const tasks = (workspaces: string[], estado: "reivindicada" | "aberta", limite: number): LinhaTask[] => {
    if (workspaces.length === 0) return [];
    return d.banco.consultar<LinhaTask>(
      `SELECT t.task_ref AS task_ref, t.titulo AS titulo, m.workspace_id AS workspace_id, m.trabalho_id AS trabalho_id, t.mission_id AS mission_id, t.papel AS papel
         FROM task t JOIN mission m ON m.id = t.mission_id
        WHERE t.estado = ? AND m.workspace_id IN (${marcas(workspaces.length)}) AND m.estado IN (${marcas(ESTADOS_ATIVOS.length)})
        ORDER BY t.atualizado_em DESC LIMIT ?`,
      [estado, ...workspaces, ...ESTADOS_ATIVOS, Math.max(1, Math.min(limite, 50))],
    );
  };
  const linha = (t: LinhaTask): LinhaTarefaConsulta => {
    const x = d.dadosDaTask({ workspace_id: t.workspace_id, trabalho_id: t.trabalho_id ?? t.mission_id, task_id: t.task_ref });
    return { task_id: t.task_ref, titulo: t.titulo, story_points: x.story_points ?? null, tempo_trabalho_ms: x.tempo_trabalho_ms ?? null, tokens: x.tokens ?? null, atraso_ms: x.atraso_ms ?? null, limite_ms: x.limite_ms ?? null, quem: t.papel };
  };
  return {
    async missoesAtivas(workspaces) {
      if (workspaces.length === 0) return [];
      const ms = d.banco.consultar<{ id: string; titulo: string; workspace_id: string }>(
        `SELECT id, titulo, workspace_id FROM mission WHERE workspace_id IN (${marcas(workspaces.length)}) AND estado IN (${marcas(ESTADOS_ATIVOS.length)}) ORDER BY atualizado_em DESC LIMIT 10`,
        [...workspaces, ...ESTADOS_ATIVOS],
      );
      return ms.map((m) => {
        const c = d.banco.consultar<{ estado: string; n: number }>("SELECT estado, COUNT(*) AS n FROM pane WHERE mission_id = ? AND estado <> 'encerrado' GROUP BY estado", [m.id]);
        const n = (e: string): number => c.find((x) => x.estado === e)?.n ?? 0;
        return { id: m.id, titulo: m.titulo, workspace_id: m.workspace_id, panes_trabalhando: n("trabalhando"), panes_aguardando: n("aguardando") };
      });
    },
    async tarefasEmAndamento(workspaces, limite) {
      return tasks(workspaces, "reivindicada", limite).map(linha);
    },
    async proximasTarefas(workspaces, limite) {
      return tasks(workspaces, "aberta", limite).map(linha);
    },
    async atrasadas(workspaces) {
      return tasks(workspaces, "reivindicada", 50)
        .map(linha)
        .filter((l) => typeof l.atraso_ms === "number" && l.atraso_ms > 0)
        .slice(0, 10);
    },
    cotaGeralPct: () => d.cotaGeralPct(),
    ...(d.consumo === undefined ? {} : { consumo: () => (d.consumo as NonNullable<DepsConsultaTelegram["consumo"]>)() }),
    alertasCriticosNaoLidos: () => d.criticosNaoLidos(),
    nomeWorkspace: (id) => d.nomeWorkspace(id),
  };
}

const ROTULO_PORTAO: Record<PortaoMissao, string> = { direction: "direção", content: "conteúdo", build: "construção", qa: "QA" };

export interface DepsGatesTelegram {
  banco: Banco;
  config: Pick<RepoConfig, "obter">;
  portoes: ServicoPortoes;
}

/** Portões de intake pendentes das Missões ativas dos workspaces recebidos. Id do gate = `<mission_id>:<portao>`; o app (nunca o usuário) escolhe o gate. */
export function criarGatesTelegram(d: DepsGatesTelegram): PortaGates {
  return {
    async pendentes(workspaces) {
      if (workspaces.length === 0) return [];
      const ms = d.banco.consultar<{ id: string; titulo: string; workspace_id: string }>(
        `SELECT id, titulo, workspace_id FROM mission WHERE workspace_id IN (${marcas(workspaces.length)}) AND estado IN (${marcas(ESTADOS_ATIVOS.length)}) ORDER BY atualizado_em DESC LIMIT 10`,
        [...workspaces, ...ESTADOS_ATIVOS],
      );
      const saida: GatePendente[] = [];
      for (const m of ms) {
        const liberados = lerPortoes(d.config, m.id);
        for (const p of PORTOES_MISSAO) {
          if (liberados.includes(p)) continue;
          saida.push({ id: `${m.id}:${p}`, titulo: `Portão de ${ROTULO_PORTAO[p]} da Missão ${m.titulo}`, workspace_id: m.workspace_id, exige_humano: false });
          if (saida.length >= 8) return saida;
        }
      }
      return saida;
    },
    async decidir(id, decisao) {
      const [mission_id, portao] = id.split(":");
      if (mission_id === undefined || portao === undefined || !(PORTOES_MISSAO as readonly string[]).includes(portao)) return { ok: false, motivo: "gate_invalido" };
      // recusar = manter o portão fechado (nada a gravar); só `aprovar` libera, e o registro de domínio guarda `por: usuario`
      if (decisao === "recusar") return { ok: true };
      try {
        const r = d.portoes.liberar(mission_id, portao as PortaoMissao);
        return r === null ? { ok: false, motivo: "missao_inexistente" } : { ok: true };
      } catch {
        return { ok: false, motivo: "missao_encerrada" };
      }
    },
  };
}
