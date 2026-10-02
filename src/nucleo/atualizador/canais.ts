// Canais `stable` e `beta` (Fase 21, T-21.13, D-342). O canal vive DENTRO do manifesto assinado (AU-06).
import type { CanalAtualizacao } from "../../compartilhado/atualizacao";
import { ehPreRelease, lerVersao } from "./versao";

/** Estável ⇒ versão sem pré-release. Beta pode carregar `beta.N` ou a estável promovida. */
export function versaoCombinaComCanal(versao: string, canal: CanalAtualizacao): boolean {
  const v = lerVersao(versao);
  if (v === null) return false;
  if (canal === "stable") return !ehPreRelease(v);
  return !ehPreRelease(v) || (v.pre[0] === "beta" && typeof v.pre[1] === "number" && v.pre.length === 2);
}

/** Caminho do manifesto no feed do build para o canal pedido (o feed tem um manifesto por canal). */
export function caminhoDoManifesto(canal: CanalAtualizacao, base = "/"): { manifesto: string; assinatura: string } {
  const prefixo = base.endsWith("/") ? base : `${base}/`;
  return { manifesto: `${prefixo}${canal}/manifesto.json`, assinatura: `${prefixo}${canal}/manifesto.json.sig` };
}

/** Beta só com consentimento explícito (AU-06). */
export function canalPermitido(canal: CanalAtualizacao, betaConsentido: boolean): boolean {
  return canal === "stable" || betaConsentido;
}
