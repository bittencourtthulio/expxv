import type { DetalheMissao, Pane } from "../../../compartilhado/dominio";
import { TITULO_MISSAO_AVULSA } from "../../../compartilhado/painel-livre";
import { missaoTerminal } from "../../estado/missoes";
import { folhas, podar, type NoPainel } from "./layout";

/** O que a UI sabe de um pane de Missão (a sessão do terminal é `sessao_pty_id` do pane). */
export interface InfoPane {
  sessaoId: string;
  /** id do Pane (harness: recibo, sugestão de troca e "mover"). */
  paneId?: string;
  /** número de exibição `#id` do pane (nunca reutilizado). */
  displayId: number;
  cli?: string | null;
  /** Fase 14: `<squad>.<membro>` do agente do Pane (`null`/ausente = Pane sem agente). */
  agenteId?: string | null;
  papel: Pane["papel"];
  ehPiloto: boolean;
  missaoId: string;
  missaoTitulo: string;
  /** workspace da Missão e se ela tem árvore própria (worktree/cópia): usados na decoração de versionamento. */
  workspaceId?: string;
  comArvore?: boolean;
  /** consumo; `undefined`/`null` = desconhecido (nunca vira 0). */
  tokens?: number | null;
  custo?: number | null;
  /** Pane de origem de um respawn (Fase 8: "brief carregado" vem do Pane restaurado). */
  respawnDe?: string | null;
  /** piloto reiniciado sem conteúdo persistido (aviso amarelo). */
  reiniciadoSemConteudo?: boolean;
  /** Pane da Missão avulsa que o app cria para o painel que orquestra (o piloto é o próprio painel livre; a grade equilibrada manda, sem "piloto à esquerda"). */
  avulsa?: boolean;
  /** nome curto da tarefa do worker (título do card do Pane). */
  tarefa?: string | null;
  /** prompt do pane, para "copiar prompt". */
  prompt?: string | null;
  /** D-520: o worker entregou um handoff com status `falhou` (o painel dele não fecha sozinho e, ao terminar, aparece como "Falhou"). */
  handoffFalhou?: boolean;
}

export type MapaMissao = Readonly<Record<string, InfoPane>>;
export const SEM_MISSAO: MapaMissao = Object.freeze({});

/** Panes das missões squad/agêntico → mapa por sessão do terminal. Pane sem sessão não tem terminal para mostrar. */
export function mapaDeDetalhes(detalhes: Readonly<Record<string, DetalheMissao | null>>): MapaMissao {
  const mapa: Record<string, InfoPane> = {};
  for (const d of Object.values(detalhes)) {
    if (d === null || d.mission.modo === "livre" || missaoTerminal(d.mission.estado)) continue;
    const avulsa = d.mission.modo === "agentico" && d.mission.titulo.startsWith(TITULO_MISSAO_AVULSA);
    for (const p of d.panes) {
      if (p.sessao_pty_id === null || p.mission_id !== d.mission.id) continue;
      mapa[p.sessao_pty_id] = {
        sessaoId: p.sessao_pty_id, paneId: p.id, displayId: p.display_id, cli: p.cli, agenteId: p.agente_id ?? null, papel: p.papel, ehPiloto: p.eh_piloto,
        missaoId: d.mission.id, missaoTitulo: d.mission.titulo, workspaceId: d.mission.workspace_id, comArvore: d.mission.worktree !== null,
        // sem sinal de "conteúdo persistido" no contrato: piloto com `respawn_de` é tratado como reiniciado sem conteúdo
        reiniciadoSemConteudo: p.eh_piloto && p.respawn_de !== null, respawnDe: p.respawn_de,
        ...(avulsa ? { avulsa: true, tarefa: d.tasks.find((t) => t.pane_id === p.id)?.titulo ?? null } : {}),
        ...((d.handoffs ?? []).some((h) => h.de_pane_id === p.id && h.status === "falhou") ? { handoffFalhou: true } : {}),
      };
    }
  }
  return mapa;
}

/** Aba de Missão: o piloto fica fora da árvore (fixo à esquerda) e o resto segue como grade binária. */
export function particionarMissao(arvore: NoPainel, mapa: MapaMissao): { piloto: string; workers: NoPainel | null } | null {
  const piloto = folhas(arvore).find((id) => mapa[id]?.ehPiloto === true);
  if (piloto === undefined || mapa[piloto]?.avulsa === true) return null;
  return { piloto, workers: podar(arvore, (id) => id !== piloto) };
}

/** `#id · CLI · papel · missão`; com agente (Fase 14), o rótulo do agente toma o lugar do papel. */
export const rotuloMissao = (i: InfoPane, nomeCli: string, rotuloAgente?: string): string => {
  // Missão avulsa: rótulo curto (cabeçalho compacto na grade): o painel que pediu e a tarefa de cada worker
  if (i.avulsa === true) return i.ehPiloto ? `#${i.displayId} · ${nomeCli} · orquestrando` : `#${i.displayId} · ${nomeCli} · ${i.tarefa ?? i.papel}`;
  return `#${i.displayId} · ${nomeCli} · ${rotuloAgente ?? i.papel} · ${i.missaoTitulo}`;
};

const fmtNumero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const fmtMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

/** "custo desconhecido" quando nada é conhecido; nunca "0" por falta de dado. */
export function formatarCusto(i: InfoPane): string {
  const partes: string[] = [];
  if (typeof i.tokens === "number") partes.push(i.tokens >= 1_000 ? `${fmtNumero.format(i.tokens / 1_000)} mil tokens` : `${i.tokens} tokens`);
  if (typeof i.custo === "number") partes.push(fmtMoeda.format(i.custo));
  return partes.length > 0 ? partes.join(" · ") : "custo desconhecido";
}
