import type { DetalheMissao, Pane } from "../../../compartilhado/dominio";
import { missaoTerminal } from "../../estado/missoes";
import { folhas, podar, type NoPainel } from "./layout";

/** O que a UI sabe de um pane de Missão (a sessão do terminal é `sessao_pty_id` do pane). */
export interface InfoPane {
  sessaoId: string;
  /** número de exibição `#id` do pane (nunca reutilizado). */
  displayId: number;
  cli?: string | null;
  papel: Pane["papel"];
  ehPiloto: boolean;
  missaoId: string;
  missaoTitulo: string;
  /** consumo; `undefined`/`null` = desconhecido (nunca vira 0). */
  tokens?: number | null;
  custo?: number | null;
  /** piloto reiniciado sem conteúdo persistido (aviso amarelo). */
  reiniciadoSemConteudo?: boolean;
  /** prompt do pane, para "copiar prompt". */
  prompt?: string | null;
}

export type MapaMissao = Readonly<Record<string, InfoPane>>;
export const SEM_MISSAO: MapaMissao = Object.freeze({});

/** Panes das missões squad/agêntico → mapa por sessão do terminal. Pane sem sessão não tem terminal para mostrar. */
export function mapaDeDetalhes(detalhes: Readonly<Record<string, DetalheMissao | null>>): MapaMissao {
  const mapa: Record<string, InfoPane> = {};
  for (const d of Object.values(detalhes)) {
    if (d === null || d.mission.modo === "livre" || missaoTerminal(d.mission.estado)) continue;
    for (const p of d.panes) {
      if (p.sessao_pty_id === null || p.mission_id !== d.mission.id) continue;
      mapa[p.sessao_pty_id] = {
        sessaoId: p.sessao_pty_id, displayId: p.display_id, cli: p.cli, papel: p.papel, ehPiloto: p.eh_piloto,
        missaoId: d.mission.id, missaoTitulo: d.mission.titulo,
        // sem sinal de "conteúdo persistido" no contrato: piloto com `respawn_de` é tratado como reiniciado sem conteúdo
        reiniciadoSemConteudo: p.eh_piloto && p.respawn_de !== null,
      };
    }
  }
  return mapa;
}

/** Aba de Missão: o piloto fica fora da árvore (fixo à esquerda) e o resto segue como grade binária. */
export function particionarMissao(arvore: NoPainel, mapa: MapaMissao): { piloto: string; workers: NoPainel | null } | null {
  const piloto = folhas(arvore).find((id) => mapa[id]?.ehPiloto === true);
  if (piloto === undefined) return null;
  return { piloto, workers: podar(arvore, (id) => id !== piloto) };
}

export const rotuloMissao = (i: InfoPane, nomeCli: string): string => `#${i.displayId} · ${nomeCli} · ${i.papel} · ${i.missaoTitulo}`;

const fmtNumero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const fmtMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

/** "custo desconhecido" quando nada é conhecido; nunca "0" por falta de dado. */
export function formatarCusto(i: InfoPane): string {
  const partes: string[] = [];
  if (typeof i.tokens === "number") partes.push(i.tokens >= 1_000 ? `${fmtNumero.format(i.tokens / 1_000)} mil tokens` : `${i.tokens} tokens`);
  if (typeof i.custo === "number") partes.push(fmtMoeda.format(i.custo));
  return partes.length > 0 ? partes.join(" · ") : "custo desconhecido";
}
