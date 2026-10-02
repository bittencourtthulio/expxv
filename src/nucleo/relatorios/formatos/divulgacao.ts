// Textos de divulgação (T-19.19): resumo para redes em 3 variantes com LIMITE rígido de caracteres, e-mail, novidades e notas para o GitHub. Tudo nasce como rascunho,
// sem link inventado (só a CTA da config, e só se for http(s) seguro), sem emoji por padrão, sem jargão (o pipeline confere com o lint do cliente). Nada é publicado aqui.
import { LIMITES_VARIANTE, type ConfigRelatorios, type FatosSprint, type VarianteDivulgacao } from "../../../compartilhado/relatorios";
import { limparLinha, urlSegura } from "../seguranca";
import { truncarPalavra } from "../util";
import { entradasChangelog } from "./changelog";

export const LIMITE_ASSUNTO = 60;
export const LIMITE_PREHEADER = 90;

/** hashtags seguras (`#Palavra`, até 5) e CTA (texto curto; URL só se http(s) seguro). */
export function adornos(cfg: Pick<ConfigRelatorios, "hashtags" | "cta">): { hashtags: string; cta: string | null } {
  const tags = cfg.hashtags.map((h) => h.replace(/^#+/, "")).filter((h) => /^[\p{L}\p{N}_]{1,30}$/u.test(h)).slice(0, 5).map((h) => `#${h}`);
  let cta = cfg.cta === null ? null : limparLinha(cfg.cta, undefined, 80);
  if (cta !== null && /[a-z][a-z0-9+.-]*:\/\//i.test(cta)) {
    const u = urlSegura(cta.match(/\S+:\/\/\S+/)?.[0] ?? "");
    if (u === null) cta = null;
  }
  return { hashtags: tags.join(" "), cta: cta === "" ? null : cta };
}

const frases = (f: FatosSprint): string[] => entradasChangelog(f).flatMap((s) => s.linhas.map((l) => l.texto));
const abertura = (f: FatosSprint): string => (f.sprint.versao_lancamento ? `Novidades da versão ${f.sprint.versao_lancamento}` : "Novidades");

/** cada variante cabe no limite; o corpo é cortado em fronteira de palavra ANTES de acrescentar CTA/hashtags, que só entram se couberem inteiras. */
export function resumoRedes(f: FatosSprint, cfg: Pick<ConfigRelatorios, "hashtags" | "cta">): Record<VarianteDivulgacao, string> {
  const fr = frases(f);
  const { hashtags, cta } = adornos(cfg);
  const out = {} as Record<VarianteDivulgacao, string>;
  for (const v of ["curta", "media", "longa"] as const) {
    const limite = LIMITES_VARIANTE[v];
    const n = v === "curta" ? 1 : v === "media" ? 3 : 8;
    const corpo = fr.length === 0 ? `${abertura(f)}: nesta etapa não houve mudanças visíveis.` : `${abertura(f)}:\n${fr.slice(0, n).map((x) => `• ${x}`).join("\n")}${fr.length > n ? `\n… e mais ${fr.length - n}.` : ""}`;
    const base = corpo.length <= limite ? corpo : truncarPalavra(corpo, limite);
    let texto = base;
    for (const e of [cta, hashtags]) if (e !== null && e.length > 0 && `${texto}\n\n${e}`.length <= limite) texto = `${texto}\n\n${e}`;
    out[v] = texto;
  }
  return out;
}

export function emailTxt(f: FatosSprint, cfg: Pick<ConfigRelatorios, "hashtags" | "cta">): { assunto: string; preheader: string; corpo: string; texto: string } {
  const fr = frases(f);
  const assunto = truncarPalavra(f.sprint.versao_lancamento ? `Novidades da versão ${f.sprint.versao_lancamento}` : "Novidades do sistema", LIMITE_ASSUNTO);
  const preheader = truncarPalavra(fr.length === 0 ? "Nesta etapa não houve mudanças visíveis." : (fr[0] as string), LIMITE_PREHEADER);
  const { cta } = adornos(cfg);
  const corpo = [fr.length === 0 ? "Nesta etapa não houve mudanças visíveis para você." : "Veja o que há de novo:", "", ...fr.map((x) => `- ${x}`), "", cta ?? ""].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { assunto, preheader, corpo, texto: `Assunto: ${assunto}\nPré-visualização: ${preheader}\n\n${corpo}\n` };
}
