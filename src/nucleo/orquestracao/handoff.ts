/**
 * Serviço de handoff (T-03.03). ORDEM OBRIGATÓRIA: relatório gravado e legível → banco → wake
 * enfileirado. Falha em qualquer etapa interrompe as seguintes (nunca há wake sem handoff persistido,
 * nem handoff persistido sem relatório). O Pane do worker é fechado pelo sistema ao concluir, depois
 * que a resposta da tool já voltou ao worker.
 */
import { readFile, realpath, stat } from "node:fs/promises";
import { relative } from "node:path";
import type { Papel, StatusHandoff } from "../dominio";
import { RESUMO_HANDOFF_MAX } from "../dominio";
import { ErroMcp, argumentoInvalido, violacaoDeRegra } from "../mcp/erros";
import type { HandoffRegistrado, PedidoHandoff, PortaHandoff } from "../mcp/portas";
import { PAPEIS_WORKER } from "./regras";
import { caminhoRelatorio, gravarNaPastaDoProduto, resolverDentroReal } from "./pasta";
import type { FilaWake } from "./wake";

/** O que o banco precisa gravar: o handoff e o vínculo com a task, na mesma transação. */
export interface PersistenciaHandoff {
  /** Lança `ErroMcp` (not_found/unauthorized) se a task não existe ou não é do escopo do Pane. */
  gravar(d: {
    workspace_id: string;
    mission_id: string | null;
    de_pane_id: string;
    task_id: string;
    resumo: string;
    relatorio_path: string;
    status: StatusHandoff;
    artefatos: string[];
  }): Promise<{ handoff_id: string; para_pane_id: string | null; task_ref: string | null }>;
  doPane(pane_id: string): Promise<HandoffRegistrado | null>;
  temRevisorOk(mission_id: string): Promise<boolean>;
}

export interface DepsServicoHandoff {
  raiz(workspace_id: string, mission_id: string | null): Promise<string>;
  persistencia: PersistenciaHandoff;
  fila: Pick<FilaWake, "enfileirar">;
  /** Fecha o Pane do worker; o serviço chama via `agendar`, nunca dentro da resposta da tool. */
  fecharPane?(pane_id: string, motivo: string): Promise<unknown>;
  /** padrão: setTimeout com `atrasoFechamentoMs` */
  agendar?(fn: () => void, ms: number): void;
  atrasoFechamentoMs?: number;
  emitir?(tipo: string, payload: unknown): void;
}

export interface ServicoHandoff extends PortaHandoff {
  /** Stop hook esgotou as tentativas: grava relatório-stub, handoff `falhou`, wake ao piloto e fecha o Pane. */
  registrarFalha(d: { workspace_id: string; mission_id: string | null; pane_id: string; papel: Papel; task_id: string; task_ref: string | null; motivo: string }): Promise<{ handoff_id: string }>;
  /** O relatório do handoff existe, é legível e não está vazio? (stop hook 2) */
  relatorioLegivel(workspace_id: string, mission_id: string | null, relatorio_path: string | null): Promise<boolean>;
}

/** Relatório de handoff: Markdown de até 2 MiB (AUD-22; antes aceitava qualquer arquivo do worktree e o lia inteiro). */
export const RELATORIO_MAX_BYTES = 2 * 1024 * 1024;

/** Devolve o caminho relativo à raiz se o relatório existe, é um `.md` legível, de tamanho razoável e com conteúdo; senão `null`. */
async function validarRelatorio(raiz: string, caminho: string): Promise<string | null> {
  if (!/\.(md|markdown)$/i.test(caminho)) return null;
  const real = await resolverDentroReal(raiz, caminho);
  if (real === null) return null;
  try {
    const info = await stat(real);
    if (!info.isFile() || info.size === 0 || info.size > RELATORIO_MAX_BYTES) return null;
    const conteudo = await readFile(real, "utf8");
    if (conteudo.trim() === "") return null;
    const raizReal = await realpath(raiz);
    return relative(raizReal, real).split("\\").join("/");
  } catch {
    return null;
  }
}

export function criarServicoHandoff(deps: DepsServicoHandoff): ServicoHandoff {
  const agendar = deps.agendar ?? ((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    t.unref();
  });
  const atraso = deps.atrasoFechamentoMs ?? 1500;

  function fecharDepois(pane_id: string, papel: Papel, status: StatusHandoff): void {
    if (deps.fecharPane === undefined || !PAPEIS_WORKER.includes(papel)) return;
    agendar(() => {
      void Promise.resolve(deps.fecharPane?.(pane_id, status === "falhou" ? "handoff_failed" : "handoff_done")).catch(() => undefined);
    }, atraso);
  }

  async function concluir(p: PedidoHandoff, relatorioRel: string, task_ref: string | null): Promise<{ handoff_id: string }> {
    // etapa 2: banco
    const gravado = await deps.persistencia.gravar({
      workspace_id: p.workspace_id,
      mission_id: p.mission_id,
      de_pane_id: p.pane_id,
      task_id: p.task_id,
      resumo: p.resumo,
      relatorio_path: relatorioRel,
      status: p.status,
      artefatos: p.artefatos,
    });
    deps.emitir?.("handoff.submitted", { handoff_id: gravado.handoff_id, task_id: p.task_id, pane_id: p.pane_id, status: p.status });
    // etapa 3: wake (só chega aqui com o handoff persistido)
    if (gravado.para_pane_id !== null) {
      deps.fila.enfileirar({
        destino_pane_id: gravado.para_pane_id,
        origem_pane_id: p.pane_id,
        task_id: gravado.task_ref ?? task_ref ?? p.task_id,
        handoff_id: gravado.handoff_id,
        status: p.status,
        resumo: p.resumo,
        relatorio_path: relatorioRel,
      });
    }
    fecharDepois(p.pane_id, p.papel, p.status);
    return { handoff_id: gravado.handoff_id };
  }

  return {
    async registrar(p) {
      if ([...p.resumo].length > RESUMO_HANDOFF_MAX) {
        throw argumentoInvalido(`O resumo tem mais de ${RESUMO_HANDOFF_MAX} caracteres.`, "summary_too_long");
      }
      // etapa 1: relatório gravado e legível
      const raiz = await deps.raiz(p.workspace_id, p.mission_id);
      const relatorioRel = await validarRelatorio(raiz, p.relatorio_path);
      if (relatorioRel === null) {
        throw violacaoDeRegra("handoff_missing", "O relatório não existe, não é legível ou está vazio. Grave-o antes do handoff.");
      }
      return concluir(p, relatorioRel, null);
    },

    async registrarFalha(d) {
      if (d.mission_id === null) throw new ErroMcp("not_found", "Pane fora de Missão não tem handoff de falha.");
      const raiz = await deps.raiz(d.workspace_id, d.mission_id);
      const nome = d.task_ref ?? d.task_id;
      const rel = caminhoRelatorio(d.mission_id, nome.replace(/[^A-Za-z0-9._-]/g, "_"));
      await gravarNaPastaDoProduto(raiz, rel, `# Falha do worker\n\nCard: ${nome}\n\n${d.motivo}\n`);
      return concluir(
        { workspace_id: d.workspace_id, mission_id: d.mission_id, pane_id: d.pane_id, papel: d.papel, task_id: d.task_id, resumo: d.motivo.slice(0, RESUMO_HANDOFF_MAX), relatorio_path: rel, artefatos: [], status: "falhou" },
        rel.split("\\").join("/"),
        d.task_ref,
      );
    },

    async relatorioLegivel(workspace_id, mission_id, relatorio_path) {
      if (relatorio_path === null) return false;
      const raiz = await deps.raiz(workspace_id, mission_id);
      return (await validarRelatorio(raiz, relatorio_path)) !== null;
    },

    doPane: (pane_id) => deps.persistencia.doPane(pane_id),
    temRevisorOk: (mission_id) => deps.persistencia.temRevisorOk(mission_id),
  };
}
