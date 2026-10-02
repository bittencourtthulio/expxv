// T-16.17 · Travas de segurança da rigidez (D-225). PURO. Raio ALTO ⇒ nível mínimo 4; branch protegida/produção ⇒ baixar para ≤ 2 exige confirmação digitada;
// override de trava só com justificativa ≥ 20 caracteres (registrada); canal remoto (Telegram/issue) só SOBE e nunca sobrescreve trava (D-223).
import { VIAS_REMOTAS, type NivelRigidez, type ViaMaestro } from "../../../compartilhado/maestro";

export const JUSTIFICATIVA_MIN = 20;
export const NIVEL_MINIMO_RAIO_ALTO: NivelRigidez = 4;
export const BRANCHES_PROTEGIDAS_PADRAO: readonly string[] = ["main", "master", "develop", "release/*", "prod*", "production", "hotfix/*"];
export const FRASE_DE_CONFIRMACAO = "baixar";

export type TipoTrava = "raio_alto" | "branch_protegida" | "producao";

export interface ContextoTrava {
  raio_faixa: string | null;
  branch: string | null;
  branches_protegidas: readonly string[];
  producao: boolean;
}

/** Glob simples (`*` = qualquer sequência, sem `/` implícito); sem regex do usuário. */
export function branchProtegida(branch: string | null, padroes: readonly string[]): boolean {
  if (branch === null || branch.trim() === "") return false;
  const b = branch.trim();
  return padroes.some((p) => {
    const re = new RegExp(`^${p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    return re.test(b);
  });
}

export function nivelMinimoTravado(ctx: Pick<ContextoTrava, "raio_faixa">): { minimo: NivelRigidez; motivo: string | null; trava: "raio_alto" | null } {
  if (ctx.raio_faixa !== null && ctx.raio_faixa.toLowerCase() === "alto") {
    return { minimo: NIVEL_MINIMO_RAIO_ALTO, motivo: "raio de impacto ALTO: o nível mínimo é Rigoroso (4)", trava: "raio_alto" };
  }
  return { minimo: 1, motivo: null, trava: null };
}

/** Baixar para ≤ 2 (ou iniciar ≤ 2) com o alvo em branch protegida/produção exige confirmação própria. */
export function exigeConfirmacao(ctx: ContextoTrava, para: NivelRigidez): { exige: boolean; trava: "branch_protegida" | "producao" | null; frase: string } {
  if (para > 2) return { exige: false, trava: null, frase: FRASE_DE_CONFIRMACAO };
  if (ctx.producao) return { exige: true, trava: "producao", frase: FRASE_DE_CONFIRMACAO };
  if (branchProtegida(ctx.branch, ctx.branches_protegidas)) return { exige: true, trava: "branch_protegida", frase: FRASE_DE_CONFIRMACAO };
  return { exige: false, trava: null, frase: FRASE_DE_CONFIRMACAO };
}

export type ErroMudanca = "abaixo_do_minimo" | "confirmacao_necessaria" | "canal_remoto_nao_baixa" | "canal_remoto_nao_sobrescreve_trava";
export interface EntradaLogRigidez {
  de: NivelRigidez | null;
  para: NivelRigidez;
  por: "usuario" | "sistema";
  trava: TipoTrava | null;
  justificativa: string | null;
}
export type ResultadoMudanca = { ok: true; log: EntradaLogRigidez } | { ok: false; erro: ErroMudanca; mensagem: string };

export interface PedidoMudanca {
  via: ViaMaestro | "ui";
  de: NivelRigidez | null;
  para: NivelRigidez;
  ctx: ContextoTrava;
  justificativa?: string | null;
  /** o usuário digitou a frase de confirmação (`baixar`). */
  confirmacao_digitada?: string | null;
}

/** Decide uma mudança de nível: trava de raio, confirmação de branch protegida/produção e regras do canal remoto. */
export function avaliarMudancaDeNivel(p: PedidoMudanca): ResultadoMudanca {
  const remoto = p.via !== "ui" && VIAS_REMOTAS.includes(p.via);
  const baixa = p.de !== null && p.para < p.de;
  if (remoto && baixa) return { ok: false, erro: "canal_remoto_nao_baixa", mensagem: "Pedido remoto só pode subir a rigidez." };
  const min = nivelMinimoTravado(p.ctx);
  let trava: TipoTrava | null = null;
  let justificativa: string | null = null;
  if (p.para < min.minimo) {
    if (remoto) return { ok: false, erro: "canal_remoto_nao_sobrescreve_trava", mensagem: "Pedido remoto nunca sobrescreve trava de segurança." };
    const j = (p.justificativa ?? "").trim();
    if (j.length < JUSTIFICATIVA_MIN) return { ok: false, erro: "abaixo_do_minimo", mensagem: `${min.motivo ?? "nível abaixo do mínimo travado"}; para seguir, justifique em ao menos ${JUSTIFICATIVA_MIN} caracteres.` };
    trava = "raio_alto";
    justificativa = j;
  }
  const c = exigeConfirmacao(p.ctx, p.para);
  if (c.exige) {
    if (remoto) return { ok: false, erro: "canal_remoto_nao_sobrescreve_trava", mensagem: "Pedido remoto nunca baixa a rigidez em branch protegida ou produção." };
    if ((p.confirmacao_digitada ?? "").trim().toLowerCase() !== c.frase) return { ok: false, erro: "confirmacao_necessaria", mensagem: `Alvo em ${c.trava === "producao" ? "produção" : "branch protegida"}: digite "${c.frase}" para confirmar a rigidez baixa.` };
    trava ??= c.trava;
  }
  return { ok: true, log: { de: p.de, para: p.para, por: "usuario", trava, justificativa } };
}
