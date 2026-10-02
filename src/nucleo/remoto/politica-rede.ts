// Política de rede do servidor remoto (T-13.15, PURA): IP privado, Host exato, Origin mesmo-origem, limites de taxa/conexões/tamanho e bloqueio de IP após
// pareamentos falhos. Sem I/O: o servidor consulta estas funções a cada requisição. Padrão fechado: o que não é reconhecido é recusado.
import { isIP } from "node:net";

export const LIMITES = {
  corpo_max: 16 * 1024,
  conexoes_max: 4,
  /** rotas SEM autenticação (pareamento, abrir sessão): 30/min por IP. */
  req_por_min_ip: 30,
  /** `/v1/canal` (já autenticado por sessão cifrada): teto de rede mais folgado; o limite fino é por dispositivo. */
  req_canal_por_min_ip: 240,
  falhas_pareamento_bloqueio: 5,
  bloqueio_ms: 600_000,
  req_por_min_dispositivo: 120,
} as const;

/** IPv4 mapeado em IPv6 (`::ffff:a.b.c.d`) vira o IPv4; zona (`%en0`) é removida. */
export function normalizarIp(ip: string): string {
  const semZona = ip.split("%")[0] ?? ip;
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(semZona);
  return (m?.[1] ?? semZona).toLowerCase();
}
const octetos = (ip: string): number[] | null => {
  if (isIP(ip) !== 4) return null;
  return ip.split(".").map(Number);
};
export const ehLoopback = (ip: string): boolean => {
  const n = normalizarIp(ip);
  const o = octetos(n);
  return o !== null ? o[0] === 127 : n === "::1";
};
/** 10/8, 172.16/12, 192.168/16 (+ 100.64/10 só com opt-in para Tailscale/CGNAT) e fc00::/7, fe80::/10 em IPv6. */
export function ipPrivado(ip: string, op: { cgnat?: boolean } = {}): boolean {
  const n = normalizarIp(ip);
  const o = octetos(n);
  if (o !== null) {
    if (o[0] === 10) return true;
    if (o[0] === 172 && (o[1] as number) >= 16 && (o[1] as number) <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (op.cgnat === true && o[0] === 100 && (o[1] as number) >= 64 && (o[1] as number) <= 127) return true;
    return false;
  }
  if (isIP(n) === 6) return /^f[cd][0-9a-f]{2}:/.test(n) || /^fe[89ab][0-9a-f]:/.test(n);
  return false;
}
/** nunca `0.0.0.0`/`::`: o bind é sempre num IP específico (privado, ou loopback no modo de túnel/teste). */
export function ipDeBindPermitido(ip: string, transporte: "lan" | "loopback", op: { cgnat?: boolean } = {}): boolean {
  if (isIP(ip) === 0) return false;
  const n = normalizarIp(ip);
  if (n === "0.0.0.0" || n === "::" || n === "::0") return false;
  return transporte === "loopback" ? ehLoopback(n) : ipPrivado(n, op);
}
/** o par remoto de uma conexão: loopback só vale no modo `loopback`; no `lan` só rede privada. */
export function origemPermitida(ipRemoto: string | undefined, transporte: "lan" | "loopback", op: { cgnat?: boolean } = {}): boolean {
  if (ipRemoto === undefined || ipRemoto === "") return false;
  return transporte === "loopback" ? ehLoopback(ipRemoto) : ipPrivado(ipRemoto, op);
}

/** `Host` exatamente `endereco:porta` (ou um nome extra configurado pelo usuário, com a mesma porta); nunca curinga. */
export function hostPermitido(host: string | undefined, o: { endereco: string; porta: number; extras?: readonly string[]; transporte: "lan" | "loopback" }): boolean {
  if (host === undefined || host.length === 0 || host.length > 255) return false;
  const h = host.toLowerCase();
  const aceitos = new Set<string>([`${o.endereco.toLowerCase()}:${o.porta}`]);
  if (o.transporte === "loopback") aceitos.add(`localhost:${o.porta}`);
  for (const e of o.extras ?? []) {
    const x = e.toLowerCase().trim();
    if (x !== "") aceitos.add(x.includes(":") && !x.startsWith("[") && isIP(x) !== 6 ? x : `${x}:${o.porta}`);
  }
  return aceitos.has(h);
}
/** Origin ausente (cliente nativo) passa; presente só se for a própria origem do servidor. Qualquer outra (página de terceiro) é recusada (CSRF). */
export function origemDoNavegadorPermitida(origin: string | undefined, o: { endereco: string; porta: number; extras?: readonly string[]; transporte: "lan" | "loopback" }): boolean {
  if (origin === undefined) return true;
  if (origin === "null") return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.pathname !== "/" || u.search !== "" || u.hash !== "" || u.username !== "" || u.password !== "") return false;
  return hostPermitido(u.host, o);
}

export interface RelogioRede {
  agora(): number;
}
/** janela deslizante simples (sem timers): guarda só os instantes dentro de 1 minuto por chave. */
export function criarLimiteJanela(relogio: RelogioRede, max: number, janela_ms = 60_000) {
  const mapa = new Map<string, number[]>();
  return {
    tentar(chave: string): boolean {
      const t = relogio.agora();
      const lista = (mapa.get(chave) ?? []).filter((x) => t - x < janela_ms);
      if (lista.length >= max) {
        mapa.set(chave, lista);
        return false;
      }
      lista.push(t);
      mapa.set(chave, lista);
      if (mapa.size > 2000) for (const [k, v] of mapa) if (v.every((x) => t - x >= janela_ms)) mapa.delete(k);
      return true;
    },
    esquecer: (chave: string): void => void mapa.delete(chave),
    limpar: (): void => mapa.clear(),
  };
}

/** bloqueio do IP após N falhas de pareamento (10 min). */
export function criarBloqueioIp(relogio: RelogioRede, falhas = LIMITES.falhas_pareamento_bloqueio, bloqueio_ms = LIMITES.bloqueio_ms) {
  const contagem = new Map<string, { n: number; ate: number }>();
  return {
    registrarFalha(ip: string): boolean {
      const k = normalizarIp(ip);
      const e = contagem.get(k) ?? { n: 0, ate: 0 };
      e.n++;
      if (e.n >= falhas) {
        e.ate = relogio.agora() + bloqueio_ms;
        e.n = 0;
      }
      contagem.set(k, e);
      return e.ate > relogio.agora();
    },
    bloqueado(ip: string): boolean {
      const e = contagem.get(normalizarIp(ip));
      return e !== undefined && e.ate > relogio.agora();
    },
    limpar: (): void => contagem.clear(),
  };
}
