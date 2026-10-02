// Configuração do relay lida do preferencias.json (D-29). Módulo LEVE (só o contrato compartilhado): o main o usa mesmo com o relay desligado, sem carregar o cliente nem o `ws-cliente` (P-160).
import { validarConfigRelayParcial, type ConfigRelay } from "../../compartilhado/relay";

const LOOPBACK_TESTE = /^ws:\/\/127\.0\.0\.1:\d{1,5}(?:\/[A-Za-z0-9._~\-/]*)?$/;

/**
 * Normaliza o que vem do preferencias.json: `habilitado` sempre false e `experimental` sempre true (invariantes: o relay nunca liga sozinho, AX-17/AX-34). A URL só vale `wss://`;
 * a ÚNICA exceção é `ws://127.0.0.1:<porta>` com NODE_ENV=test (e2e/loopback), a mesma regra do `ws-cliente`.
 */
export function lerConfigRelay(bruto: unknown, ambiente: string | undefined = process.env["NODE_ENV"]): ConfigRelay {
  const base: ConfigRelay = { url: "", habilitado: false, experimental: true, consentimento_versao: "", reconhecimento_experimental: false, padding: true, pwa_origem: "" };
  const o = typeof bruto === "object" && bruto !== null ? (bruto as Record<string, unknown>) : {};
  const urlTeste = ambiente === "test" && typeof o["url"] === "string" && LOOPBACK_TESTE.test(o["url"]) ? o["url"] : null;
  const v = validarConfigRelayParcial(Object.fromEntries(Object.entries(o).filter(([k]) => k !== "experimental" && k !== "habilitado" && !(urlTeste !== null && k === "url"))));
  return { ...base, ...(v.ok ? v.valor : {}), ...(urlTeste === null ? {} : { url: urlTeste }), habilitado: false, experimental: true };
}
