// Validação da URL do backend online: HTTPS obrigatório (http só loopback/rede privada, com aviso) e sem credencial embutida.
import { isIP } from "node:net";

export interface ResultadoUrl {
  ok: boolean;
  host: string | null;
  origem: string | null;
  aviso: string | null;
  erro: string | null;
}

function privado(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "::1") return true;
  if (isIP(h) === 4) {
    const [a, b] = h.split(".").map(Number) as [number, number];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIP(h) === 6) return /^(?:fc|fd|fe80)/i.test(h);
  return false;
}

export function validarUrlBackend(bruta: string): ResultadoUrl {
  const falha = (erro: string): ResultadoUrl => ({ ok: false, host: null, origem: null, aviso: null, erro });
  if (typeof bruta !== "string" || bruta.length === 0 || bruta.length > 500) return falha("URL vazia ou longa demais.");
  let u: URL;
  try {
    u = new URL(bruta.trim());
  } catch {
    return falha("URL inválida.");
  }
  if (u.username !== "" || u.password !== "") return falha("A URL não pode conter usuário nem senha; use os campos próprios (guardados no cofre).");
  if (u.protocol !== "https:" && u.protocol !== "http:") return falha("Só http(s) é aceito.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (u.protocol === "http:") {
    if (!privado(host)) return falha("HTTPS é obrigatório fora de loopback e de rede privada.");
    return { ok: true, host, origem: u.origin, aviso: "Conexão sem TLS: use só em loopback ou rede privada confiável.", erro: null };
  }
  return { ok: true, host, origem: u.origin, aviso: null, erro: null };
}
