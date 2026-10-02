// T-18.09: itens e épicos. Item `origem='metodo'` é ESPELHO: título/descrição/critérios/estado vêm do disco (D-04) e só os campos ÁGEIS são editáveis.
// Descartar exige motivo. `resumo_cliente` (Fase 19) é sempre de origem humana.
import type { EpicoAgil, ItemAgil, Moscow, OrigemItem } from "../../../compartilhado/agil";
import { invalido, naoEncontrado, regraViolada } from "../erros";
import type { BancoAgil } from "../repos";
import { isoDe, truncar, type GeradorId, type Relogio } from "../util";

export interface DepsBacklog { banco: BancoAgil; relogio: Relogio; id: GeradorId }
const CAMPOS_AGEIS = ["epico_id", "valor", "urgencia", "reducao_risco", "moscow", "dono_membro_id", "par_membro_id", "visibilidade_cliente", "resumo_cliente", "changelog_tipo"] as const;
const CAMPOS_LIVRES = ["titulo", "descricao", "criterios"] as const;
const MOSCOW = new Set(["must", "should", "could", "wont"]);
const CHANGELOG = new Set(["added", "changed", "deprecated", "removed", "fixed", "security"]);

export interface NovoItem { workspace_id: string; origem?: Exclude<OrigemItem, "metodo">; titulo: string; descricao?: string | null; criterios?: string[]; epico_id?: string | null; origem_ref?: Record<string, unknown> | null }
export type EdicaoItem = Partial<Pick<ItemAgil, (typeof CAMPOS_AGEIS)[number] | (typeof CAMPOS_LIVRES)[number]>>;

function validarNota(n: unknown, campo: string): void {
  if (n !== null && n !== undefined && (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 10)) throw invalido(`${campo} deve ser inteiro de 1 a 10`);
}

export function criarItem(d: DepsBacklog, n: NovoItem): ItemAgil {
  const titulo = n.titulo.trim();
  if (!titulo) throw invalido("título obrigatório");
  if (n.epico_id && !d.banco.epicos.get(n.epico_id)) throw naoEncontrado(`épico ${n.epico_id}`);
  const agora = isoDe(d.relogio());
  const ordem = d.banco.itens.valores().reduce((m, i) => Math.max(m, i.ordem), 0) + 1024;
  const item: ItemAgil = {
    id: d.id("it"), workspace_id: n.workspace_id, origem: n.origem ?? "ade", trabalho_id: null, task_ref: null, epico_id: n.epico_id ?? null, titulo: truncar(titulo, 300),
    descricao: n.descricao ?? null, criterios: (n.criterios ?? []).slice(0, 10).map((c) => truncar(c, 300)), estado_ade: "backlog", valor: null, urgencia: null, reducao_risco: null,
    moscow: null, ordem, dono_membro_id: null, par_membro_id: null, visibilidade_cliente: "auto", resumo_cliente: null, resumo_cliente_origem: null, changelog_tipo: null,
    origem_ref: n.origem_ref ?? null, descartado_motivo: null, orfao: false, criado_em: agora, atualizado_em: agora,
  };
  d.banco.itens.set(item.id, item);
  return item;
}

export function atualizarItem(d: DepsBacklog, id: string, e: EdicaoItem): ItemAgil {
  const it = d.banco.itens.get(id);
  if (!it) throw naoEncontrado(`item ${id}`);
  if (it.estado_ade === "descartado") throw regraViolada("item descartado não pode ser editado");
  const chaves = Object.keys(e);
  if (it.origem === "metodo") {
    const proibidos = chaves.filter((k) => !(CAMPOS_AGEIS as readonly string[]).includes(k));
    if (proibidos.length > 0) throw regraViolada(`item espelho do método: só campos ágeis são editáveis (recusado: ${proibidos.join(", ")})`);
  }
  const permitidos = new Set<string>([...CAMPOS_AGEIS, ...CAMPOS_LIVRES]);
  const desconhecido = chaves.filter((k) => !permitidos.has(k));
  if (desconhecido.length > 0) throw invalido(`campo desconhecido: ${desconhecido.join(", ")}`);
  validarNota(e.valor, "valor"); validarNota(e.urgencia, "urgencia"); validarNota(e.reducao_risco, "reducao_risco");
  if (e.moscow !== undefined && e.moscow !== null && !MOSCOW.has(e.moscow as Moscow)) throw invalido("moscow inválido");
  if (e.changelog_tipo !== undefined && e.changelog_tipo !== null && !CHANGELOG.has(e.changelog_tipo)) throw invalido("changelog_tipo inválido");
  if (e.titulo !== undefined && !e.titulo.trim()) throw invalido("título obrigatório");
  if (e.epico_id && !d.banco.epicos.get(e.epico_id)) throw naoEncontrado(`épico ${e.epico_id}`);
  const novo: ItemAgil = { ...it, ...e, atualizado_em: isoDe(d.relogio()) } as ItemAgil;
  if (e.resumo_cliente !== undefined) { novo.resumo_cliente = e.resumo_cliente ? truncar(e.resumo_cliente, 2000) : null; novo.resumo_cliente_origem = e.resumo_cliente ? "humano" : null; }
  d.banco.itens.set(id, novo);
  return novo;
}

export function descartarItem(d: DepsBacklog, id: string, motivo: string): ItemAgil {
  const it = d.banco.itens.get(id);
  if (!it) throw naoEncontrado(`item ${id}`);
  if (motivo.trim().length < 3) throw invalido("descartar exige motivo");
  const novo = { ...it, estado_ade: "descartado" as const, descartado_motivo: truncar(motivo.trim(), 300), atualizado_em: isoDe(d.relogio()) };
  d.banco.itens.set(id, novo);
  return novo;
}

export function gravarEpico(d: DepsBacklog, e: { id?: string; workspace_id: string; titulo: string; descricao?: string | null; estado?: EpicoAgil["estado"] }): EpicoAgil {
  if (!e.titulo.trim()) throw invalido("título do épico obrigatório");
  const agora = isoDe(d.relogio());
  const ant = e.id ? d.banco.epicos.get(e.id) : undefined;
  if (e.id && !ant) throw naoEncontrado(`épico ${e.id}`);
  const epico: EpicoAgil = {
    id: ant?.id ?? d.id("epi"), workspace_id: e.workspace_id, titulo: truncar(e.titulo.trim(), 200), descricao: e.descricao ?? ant?.descricao ?? null,
    estado: e.estado ?? ant?.estado ?? "aberto", ordem: ant?.ordem ?? d.banco.epicos.valores().length + 1, criado_em: ant?.criado_em ?? agora, atualizado_em: agora,
  };
  d.banco.epicos.set(epico.id, epico);
  return epico;
}

/** apagar épico: os itens ficam, sem épico. */
export function apagarEpico(d: DepsBacklog, id: string): void {
  if (!d.banco.epicos.get(id)) throw naoEncontrado(`épico ${id}`);
  d.banco.transacao(() => {
    for (const it of d.banco.itens.valores()) if (it.epico_id === id) d.banco.itens.set(it.id, { ...it, epico_id: null });
    d.banco.epicos.delete(id);
  });
}
