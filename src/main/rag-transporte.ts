// Ligação fina do transporte do RAG online ao `ClienteRede` do app (que é injetado: este arquivo não instancia nada de Electron nem abre
// socket). O consentimento por host vem do que o dono gravou (migração/modo); sem ele a chamada falha com `consent_required`.
import { criarTransporteRag, type OpcoesTransporteRag, type TransporteHttpRag } from "../nucleo/conhecimento/backend/transporte";
import type { ClienteRede } from "../nucleo/rede/cliente-http";
import type { RegistroConsentimento } from "../nucleo/rede/consentimento";

export interface DependenciasTransporteRagMain {
  rede: ClienteRede;
  consentimento: RegistroConsentimento;
  /** hosts dos consentimentos gravados (ex.: `config.consentimento.host` de cada workspace com RAG online). */
  hostsConsentidos: OpcoesTransporteRag["hostsConsentidos"];
}

export function criarTransporteRagDoApp(d: DependenciasTransporteRagMain, extra: Partial<Omit<OpcoesTransporteRag, keyof DependenciasTransporteRagMain>> = {}): TransporteHttpRag {
  return criarTransporteRag({ rede: d.rede, consentimento: d.consentimento, hostsConsentidos: d.hostsConsentidos, ...extra });
}

/** Ajuda para montar `hostsConsentidos` a partir das configs: só entra host com consentimento presente. */
export function hostsDeConsentimentos(lista: () => ReadonlyArray<{ consentimento: { host: string } | null } | null | undefined>): () => string[] {
  return () => lista().flatMap((c) => (c?.consentimento ? [c.consentimento.host] : []));
}
