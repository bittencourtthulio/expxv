// Porta REAL de `board:delegar_card` (Fase 10, T-10.19): liga o `delegarCard` (núcleo) à infraestrutura do main. NADA aqui escreve em `docs/**`: o briefing vai para a pasta do produto da
// Missão (pasta do produto, `missoes/<missão>/`), a linha de `task` entra no banco com a referência EXPLÍCITA do card (`PedidoSpawn.task_ref`) e o Pane abre pelo roteador da Fase 9
// (`task_type: implementar`, papel executor, origem usuário). Sem roteador disponível a delegação fica `unavailable` (nunca escolhe CLI no escuro). A delegação NÃO contorna as
// regras do board (WIP, Missão squad/agêntico com worktree, card pronto e ainda não delegado: tudo conferido em `delegarCard`) nem o limite de workers da Missão.
import { resolve } from "node:path";
import type { Banco } from "../nucleo/banco/banco";
import type { RepoTask } from "../nucleo/banco/repos/task";
import { ErroBoard, type MissaoParaDelegar, type PortaDelegar } from "../nucleo/board";
import { ErroMcp } from "../nucleo/mcp/erros";
import type { PedidoSpawn, PortaRag, PortaRota, RotaDoSpawn } from "../nucleo/mcp/portas";
import { caminhoBriefing, gravarNaPastaDoProduto } from "../nucleo/orquestracao/pasta";
import { MAX_PANES_PARALELOS, verificarConsultaRag } from "../nucleo/orquestracao/regras";

export interface DepsPortaDelegar {
  banco: Banco;
  task: RepoTask;
  /** raiz do workspace (só o main a conhece). */
  raizDoWorkspace(workspaceId: string): string;
  /** `PortaPanes.spawn` da orquestração; `null` enquanto ela não iniciou. */
  spawn(): ((p: PedidoSpawn) => Promise<{ pane_id: string }>) | null;
  /** roteador da Fase 9; `null` = sem harness (a delegação não escolhe CLI sozinha). */
  rota(): PortaRota | null;
  maxPanesParalelos?: number;
  /** Fase 15: porta do RAG (leitura preguiçosa) para a regra de consulta obrigatória na passagem `aberta → reivindicada`; `null`/ausente = permitir. */
  rag?(): Pick<PortaRag, "ativo" | "politica" | "consultouRecentemente"> | null;
  /** aviso de uma linha da regra de consulta (modo `aviso`). */
  avisar?(mensagem: string): void;
}

interface LinhaMissao {
  id: string;
  workspace_id: string;
  modo: "livre" | "squad" | "agentico";
  estado: string;
  trabalho_id: string | null;
  worktree: string | null;
}

const normalizar = (p: string): string => p.split("\\").join("/");

export function criarPortaDelegar(d: DepsPortaDelegar): PortaDelegar {
  const max = d.maxPanesParalelos ?? MAX_PANES_PARALELOS;
  const linha = (missionId: string): LinhaMissao | undefined => d.banco.consultarUm<LinhaMissao>("SELECT id, workspace_id, modo, estado, trabalho_id, worktree FROM mission WHERE id = ?", [missionId]);
  const raizDaMissao = (m: LinhaMissao): string => (m.worktree !== null ? resolve(d.raizDoWorkspace(m.workspace_id), m.worktree) : d.raizDoWorkspace(m.workspace_id));

  return {
    missao(missionId): MissaoParaDelegar | null {
      const m = linha(missionId);
      if (m === undefined) return null;
      return { id: m.id, workspace_id: m.workspace_id, modo: m.modo, estado: m.estado, trabalho_id: m.trabalho_id, tem_worktree: m.worktree !== null };
    },

    criarTask(t) {
      const m = linha(t.mission_id);
      if (m === undefined) throw new ErroBoard("not_found", "Missão não encontrada", "mission_not_found");
      return { id: d.task.criar({ mission_id: t.mission_id, task_ref: t.task_ref, titulo: t.titulo, papel: "executor", briefing_path: t.briefing_path }).id };
    },

    async gravarBriefing(b) {
      const m = linha(b.mission_id);
      if (m === undefined) throw new ErroBoard("not_found", "Missão não encontrada", "mission_not_found");
      const rel = normalizar(caminhoBriefing(b.mission_id, b.task_ref));
      await gravarNaPastaDoProduto(raizDaMissao(m), rel, b.markdown);
      return rel;
    },

    async abrirWorker(w) {
      const spawn = d.spawn();
      const rota = d.rota();
      if (spawn === null || rota === null) throw new ErroBoard("unavailable", "a delegação de cards ainda não está disponível neste build", "no_router");
      // limite de workers vivos da Missão (o mesmo do `pane_spawn`): delegar não o contorna
      const vivos = d.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM pane WHERE mission_id = ? AND eh_piloto = 0 AND estado <> 'encerrado'", [w.mission_id])?.n ?? 0;
      if (vivos >= max) throw new ErroBoard("rule_violation", `limite de workers da Missão atingido (${vivos}/${max})`, "limit_reached");
      const piloto = d.banco.consultarUm<{ id: string }>("SELECT id FROM pane WHERE mission_id = ? AND eh_piloto = 1 ORDER BY criado_em LIMIT 1", [w.mission_id])?.id ?? "";
      const r = await rota.rotear({ workspace_id: w.workspace_id, mission_id: w.mission_id, pedido_por_pane_id: piloto, papel: "executor", agente_id: null, task_type: "implementar", descricao: null, faixa: null });
      if (!r.ok) {
        if (r.erro === "no_capacity" || r.erro === "no_compatible_cli") throw new ErroBoard("rule_violation", r.mensagem, "limit_reached");
        throw new ErroBoard("unavailable", r.mensagem, "route_failed");
      }
      // Fase 15 (DEC-4 d): consulta obrigatória ao RAG antes de a task ser reivindicada (aviso por padrão; bloqueio opcional; RAG fora nunca bloqueia)
      try {
        const v = await verificarConsultaRag({ rag: d.rag?.() ?? null, workspace_id: w.workspace_id, mission_id: w.mission_id, task_ref: w.task_ref, papel: "executor" });
        if (v.aviso !== undefined) d.avisar?.(v.aviso);
      } catch (e) {
        if (e instanceof ErroMcp && e.subcode === "rag_consult_required") throw new ErroBoard("rule_violation", e.message, "rag_consult_required");
        throw e;
      }
      const { ok: _ok, ...rotaOk } = r;
      void _ok;
      const escolhida: RotaDoSpawn = rotaOk;
      const { pane_id } = await spawn({
        workspace_id: w.workspace_id,
        mission_id: w.mission_id,
        pedido_por_pane_id: piloto,
        provedor: escolhida.provedor,
        ...(escolhida.provedor === "openrouter" ? { cli: escolhida.cli } : {}),
        modelo: escolhida.modelo,
        conta_id: escolhida.conta_id,
        papel: "executor",
        agente_id: null,
        briefing_path: w.briefing_path,
        cwd: null,
        task_ref: w.task_ref,
      });
      try {
        await rota.gravar(pane_id, escolhida, null);
      } catch {
        /* sem a marca da rota só a troca automática por consumo deixa de enxergar o Pane */
      }
      return { pane_id, recibo: [...escolhida.recibo].slice(0, 240).join("") };
    },

    descartarTask(taskId) {
      // task sem Pane nem handoff some (senão o índice `ux_task_ref` travaria o card para sempre); com Pane/handoff só é descartada
      const t = d.task.obter(taskId);
      if (t === undefined) return;
      if (t.pane_id === null && t.handoff_id === null && (t.estado === "aberta" || t.estado === "descartada")) d.banco.executar("DELETE FROM task WHERE id = ?", [taskId]);
      else if (t.estado !== "descartada" && t.estado !== "validada") d.task.mudarEstado(taskId, "descartada");
    },
  };
}
