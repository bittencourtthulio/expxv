// T-18.23: marcação manual, confirmação e auditoria. SÓ humano (agente recebe `human_only`). Motivo >= 5 caracteres. O que o humano decide persiste ao reprocessar
// (a detecção automática nunca reabre evento descartado nem desfaz natureza/confirmação humana).
import type { EventoRetrabalho, NaturezaRetrabalho } from "../../../compartilhado/agil";
import { apenasHumano, invalido, naoEncontrado } from "../erros";
import type { BancoAgil } from "../repos";
import { isoDe, redigirSegredos, type GeradorId, type Relogio } from "../util";
import type { EventoDetectado } from "./detectores";

export interface DepsMarcar { banco: BancoAgil; relogio: Relogio; id: GeradorId }
const NATUREZAS: readonly NaturezaRetrabalho[] = ["defeito", "escopo", "ruido", "pendente"];

/** grava as detecções novas (por `chave_dedupe`); as que já existem ficam INTACTAS (decisão humana e `ativo` preservados). */
export function registrarDeteccoes(d: DepsMarcar, detectados: readonly EventoDetectado[], itemDe: (trabalho: string, ref: string) => string | null = () => null): { novos: EventoRetrabalho[]; existentes: number } {
  const porChave = new Map<string, EventoRetrabalho>();
  for (const e of d.banco.eventosRetrabalho.valores()) porChave.set(`${e.workspace_id}|${e.chave_dedupe}`, e);
  const novos: EventoRetrabalho[] = [];
  d.banco.transacao(() => {
    for (const x of detectados) {
      if (porChave.has(`${x.workspace_id}|${x.chave_dedupe}`)) continue;
      const e: EventoRetrabalho = { ...x, id: d.id("rtb"), item_id: x.task_ref ? itemDe(x.trabalho_id, x.task_ref) : null, detectado_em: isoDe(d.relogio()), confirmado_por: x.natureza === "pendente" ? null : "automatico", motivo: null, ativo: true };
      d.banco.eventosRetrabalho.set(e.id, e);
      porChave.set(`${e.workspace_id}|${e.chave_dedupe}`, e);
      novos.push(e);
    }
  });
  return { novos, existentes: detectados.length - novos.length };
}

export type AcaoRetrabalho = "marcar_retrabalho" | "marcar_primeira" | "confirmar" | "descartar" | "natureza";
export interface PedidoMarcar { workspace_id: string; trabalho_id: string; task_ref: string; acao: AcaoRetrabalho; evento_id?: string; natureza?: NaturezaRetrabalho; motivo: string; ator: "humano" | "agente" }

export function marcarRetrabalho(d: DepsMarcar, p: PedidoMarcar): EventoRetrabalho {
  if (p.ator !== "humano") throw apenasHumano(`retrabalho.${p.acao}`);
  const motivo = p.motivo.trim();
  if (motivo.length < 5) throw invalido("motivo deve ter ao menos 5 caracteres");
  const agora = isoDe(d.relogio());
  const audit = (alvo: string): void => {
    const seq = d.banco.auditoria.valores().length + 1;
    d.banco.auditoria.set(String(seq), { seq, acao: `retrabalho.${p.acao}`, ator: "humano", workspace_id: p.workspace_id, alvo, motivo: redigirSegredos(motivo), quando: agora });
  };
  return d.banco.transacao(() => {
    if (p.acao === "marcar_retrabalho" || p.acao === "marcar_primeira") {
      const id = d.id("rtb");
      const e: EventoRetrabalho = {
        id, workspace_id: p.workspace_id, trabalho_id: p.trabalho_id, task_ref: p.task_ref, item_id: null, fonte: "manual", forca: "forte",
        natureza: p.acao === "marcar_retrabalho" ? "defeito" : "ruido", evidencia: { situacao: p.acao === "marcar_retrabalho" ? "retrabalho" : "primeira" },
        chave_dedupe: `manual:${p.trabalho_id}:${p.task_ref}:${id}`, ocorrido_em: agora, detectado_em: agora, confirmado_por: "humano", motivo: redigirSegredos(motivo), ativo: true,
      };
      d.banco.eventosRetrabalho.set(id, e);
      audit(`${p.trabalho_id}/${p.task_ref}`);
      return e;
    }
    const alvo = p.evento_id ? d.banco.eventosRetrabalho.get(p.evento_id) : undefined;
    if (!alvo || alvo.workspace_id !== p.workspace_id || alvo.trabalho_id !== p.trabalho_id) throw naoEncontrado(`evento ${p.evento_id ?? "(sem id)"}`);
    let novo: EventoRetrabalho;
    if (p.acao === "confirmar") novo = { ...alvo, ativo: true, confirmado_por: "humano", natureza: alvo.natureza === "pendente" ? (p.natureza ?? "defeito") : alvo.natureza, motivo: redigirSegredos(motivo) };
    else if (p.acao === "descartar") novo = { ...alvo, ativo: false, confirmado_por: "humano", motivo: redigirSegredos(motivo) };
    else {
      if (!p.natureza || !NATUREZAS.includes(p.natureza)) throw invalido("natureza inválida");
      novo = { ...alvo, natureza: p.natureza, confirmado_por: "humano", motivo: redigirSegredos(motivo) };
    }
    d.banco.eventosRetrabalho.set(novo.id, novo);
    audit(novo.id);
    return novo;
  });
}
