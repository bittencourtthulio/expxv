// T-18.20: natureza do evento de retrabalho: defeito | escopo | ruido | pendente. Regras configuráveis (config.natureza). `pendente` entra só na faixa `ir_max`.
import type { NaturezaRetrabalho, RegrasNatureza } from "../../../compartilhado/agil";
import { normalizar } from "../util";

const PREFIXO = /^\s*([a-z]+)(?:\([^)]*\))?!?:/i;
const tem = (texto: string, palavras: readonly string[]): boolean =>
  palavras.some((p) => new RegExp(`(^|[^a-z0-9])${normalizar(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(texto));

/** mensagem de commit: prefixo convencional manda; senão palavras (ruído, defeito, escopo); ambíguo => pendente. */
export function naturezaDeCommit(mensagem: string, labels: readonly string[], r: RegrasNatureza): NaturezaRetrabalho {
  const m = PREFIXO.exec(mensagem);
  const prefixo = m?.[1]?.toLowerCase();
  if (prefixo) {
    if (r.prefixos_ruido.includes(prefixo)) return "ruido";
    if (r.prefixos_escopo.includes(prefixo)) return "escopo";
    if (r.prefixos_defeito.includes(prefixo)) return /typo|ortografia/i.test(mensagem) ? "ruido" : "defeito";
  }
  const t = normalizar(mensagem);
  if (tem(t, r.palavras_ruido)) return "ruido";
  const ls = labels.map((l) => l.toLowerCase());
  if (ls.some((l) => l === "bug" || l === "fix" || l === "bugfix")) return "defeito";
  if (ls.some((l) => l === "feature" || l === "enhancement" || l === "scope")) return "escopo";
  if (tem(t, r.palavras_escopo)) return "escopo";
  if (tem(t, r.palavras_defeito)) return "defeito";
  return "pendente";
}

/** achado de QA: severidade forte + categoria de defeito (ou sem categoria) => defeito; categoria de escopo/sugestão => escopo. */
export function naturezaDeAchadoQa(categoria: string | null): NaturezaRetrabalho {
  const c = (categoria ?? "").toLowerCase();
  if (["escopo", "requisito", "sugestao", "sugestão", "melhoria"].includes(c)) return "escopo";
  if (["estilo", "formatacao", "formatação", "docs", "doc"].includes(c)) return "ruido";
  return "defeito";
}

/** ocorrência runx (regressão): tipo bug => defeito; melhoria/feature => escopo. */
export function naturezaDeOcorrencia(tipo: string): NaturezaRetrabalho {
  const t = tipo.toLowerCase();
  if (t === "bug" || t === "regressao" || t === "regressão") return "defeito";
  if (["melhoria", "feature", "pedido", "mudanca", "mudança"].includes(t)) return "escopo";
  return "pendente";
}
