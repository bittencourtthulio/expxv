// Consentimento de rede: (1) allowlist de HOSTS consentidos (o dono consentiu: decisor, OpenRouter…) e
// (2) TOKENS de consentimento por chamada/host, emitidos SÓ por código disparado por ação do usuário (clique/IPC autorizado).
// Sem token válido para o host o cliente lança `consent_required` ANTES de abrir socket (regra "rede só por ação do usuário").
//  - `conceder(host)` → token de uso único e validade curta (clique).
//  - `conceder(host, { permanente: true })` → token do consentimento gravado (ex.: decisor ligado); vale até `revogar*`.
import { randomBytes } from "node:crypto";

export type TokenConsentimento = string;

export interface OpcoesToken {
  /** padrão 60 000 ms (ignorado se `permanente`). */
  validade_ms?: number;
  /** padrão 1 (ignorado se `permanente`). */
  usos?: number;
  permanente?: boolean;
}

export interface RegistroConsentimento {
  permitirHost(host: string): void;
  revogarHost(host: string): void;
  hostPermitido(host: string): boolean;
  hosts(): string[];
  conceder(host: string, op?: OpcoesToken): TokenConsentimento;
  /** valida e gasta um uso; `false` se ausente, expirado, esgotado, revogado ou de outro host. */
  consumir(token: unknown, host: string): boolean;
  /** só verifica (não gasta). */
  valido(token: unknown, host: string): boolean;
  revogar(token: TokenConsentimento): void;
}

export const normalizarHost = (h: string): string => h.trim().toLowerCase().replace(/\.$/, "");

interface Token {
  host: string;
  expira: number;
  usos: number;
}

export function criarRegistroConsentimento(op: { agora?: () => number } = {}): RegistroConsentimento {
  const agora = op.agora ?? Date.now;
  const permitidos = new Set<string>();
  const tokens = new Map<string, Token>();

  const vivo = (t: Token | undefined, host: string): t is Token => t !== undefined && t.host === normalizarHost(host) && t.usos > 0 && t.expira > agora();

  return {
    permitirHost: (h) => void permitidos.add(normalizarHost(h)),
    revogarHost(h) {
      const n = normalizarHost(h);
      permitidos.delete(n);
      for (const [k, t] of tokens) if (t.host === n) tokens.delete(k);
    },
    hostPermitido: (h) => permitidos.has(normalizarHost(h)),
    hosts: () => [...permitidos].sort(),
    conceder(host, o = {}) {
      const token = `ctk_${randomBytes(24).toString("base64url")}`;
      tokens.set(token, {
        host: normalizarHost(host),
        expira: o.permanente === true ? Number.POSITIVE_INFINITY : agora() + (o.validade_ms ?? 60_000),
        usos: o.permanente === true ? Number.POSITIVE_INFINITY : (o.usos ?? 1),
      });
      return token;
    },
    consumir(token, host) {
      if (typeof token !== "string") return false;
      const t = tokens.get(token);
      if (!vivo(t, host)) return false;
      t.usos -= 1;
      if (t.usos <= 0) tokens.delete(token);
      return true;
    },
    valido: (token, host) => typeof token === "string" && vivo(tokens.get(token), host),
    revogar: (token) => void tokens.delete(token),
  };
}
