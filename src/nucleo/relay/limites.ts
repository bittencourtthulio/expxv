// Limites do relay (T-22.07): token buckets por IP/canal/global, contagem de conexões. PURO, relógio injetado, só memória. Rejeitar custa O(1) (P-163: flood ≤ 1 ms).
export interface RelogioRelay {
  agora(): number;
}
export interface Balde {
  tentar(n?: number): boolean;
  /** só para teste/inspeção: fichas atuais. */
  fichas(): number;
}
export function criarBalde(relogio: RelogioRelay, capacidade: number, porSegundo: number): Balde {
  let fichas = capacidade;
  let ultimo = relogio.agora();
  const recarregar = (): void => {
    const t = relogio.agora();
    if (t > ultimo) fichas = Math.min(capacidade, fichas + ((t - ultimo) / 1000) * porSegundo);
    ultimo = t;
  };
  return {
    tentar(n = 1) {
      recarregar();
      if (fichas < n) return false;
      fichas -= n;
      return true;
    },
    fichas() {
      recarregar();
      return fichas;
    },
  };
}

/**
 * Chave de limite por origem: IPv6 vira o prefixo /64 (quem tem um /64 tem 2^64 endereços e escaparia de qualquer cota por endereço: A-05), IPv4 mapeado em IPv6 vira o IPv4, a zona
 * (`%eth0`) sai. Texto que não é endereço fica como está. PURA.
 */
export function chaveDeIp(ip: string): string {
  const semZona = ip.split("%")[0] ?? ip;
  const mapeado = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(semZona);
  if (mapeado !== null) return mapeado[1] as string;
  if (!semZona.includes(":")) return semZona;
  const [cabeca = "", cauda = ""] = semZona.split("::");
  const a = cabeca === "" ? [] : cabeca.split(":");
  const b = cauda === "" ? [] : cauda.split(":");
  const grupos = semZona.includes("::") ? [...a, ...Array<string>(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  if (grupos.length !== 8 || grupos.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return semZona;
  return `${grupos.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

export interface ConfigLimites {
  maxConexoes: number;
  maxConexoesPorIp: number;
  maxCanais: number;
  /** tentativas de conexão (hello) por IP: capacidade e reposição por segundo. */
  helloPorIp: { capacidade: number; porSegundo: number };
  /** mensagens por IP (inclui as de controle antes da autenticação). */
  msgPorIp: { capacidade: number; porSegundo: number };
  quadrosPorCanal: { capacidade: number; porSegundo: number };
  bytesPorCanal: { capacidade: number; porSegundo: number };
}
export const LIMITES_PADRAO: ConfigLimites = Object.freeze({
  maxConexoes: 10_000,
  maxConexoesPorIp: 32,
  maxCanais: 5_000,
  helloPorIp: { capacidade: 20, porSegundo: 20 / 60 },
  msgPorIp: { capacidade: 400, porSegundo: 200 },
  quadrosPorCanal: { capacidade: 200, porSegundo: 100 },
  bytesPorCanal: { capacidade: 1024 * 1024, porSegundo: 512 * 1024 },
});

export interface Limites {
  config: ConfigLimites;
  /** nova conexão de `ip`: false = limite global/por IP estourado. */
  admitir(ip: string): boolean;
  liberar(ip: string): void;
  hello(ip: string): boolean;
  mensagem(ip: string): boolean;
  canalNovo(totalCanais: number): boolean;
  quadro(canal: string, bytes: number): boolean;
  esquecerCanal(canal: string): void;
  totalConexoes(): number;
  ipsRastreados(): number;
  /** remove baldes de IPs sem conexão e já cheios (evita crescimento sem fim). */
  varrer(): void;
}
export function criarLimites(relogio: RelogioRelay, parcial: Partial<ConfigLimites> = {}): Limites {
  const config: ConfigLimites = { ...LIMITES_PADRAO, ...parcial };
  const conexoes = new Map<string, number>();
  const helloIp = new Map<string, Balde>();
  const msgIp = new Map<string, Balde>();
  const quadros = new Map<string, Balde>();
  const bytes = new Map<string, Balde>();
  let total = 0;
  const balde = (m: Map<string, Balde>, k: string, c: { capacidade: number; porSegundo: number }): Balde => {
    let b = m.get(k);
    if (b === undefined) {
      b = criarBalde(relogio, c.capacidade, c.porSegundo);
      m.set(k, b);
    }
    return b;
  };
  return {
    config,
    admitir(ip) {
      if (total >= config.maxConexoes) return false;
      const n = conexoes.get(ip) ?? 0;
      if (n >= config.maxConexoesPorIp) return false;
      conexoes.set(ip, n + 1);
      total++;
      return true;
    },
    liberar(ip) {
      const n = conexoes.get(ip) ?? 0;
      if (n <= 1) conexoes.delete(ip);
      else conexoes.set(ip, n - 1);
      if (n > 0) total--;
    },
    hello: (ip) => balde(helloIp, ip, config.helloPorIp).tentar(),
    mensagem: (ip) => balde(msgIp, ip, config.msgPorIp).tentar(),
    canalNovo: (t) => t < config.maxCanais,
    quadro(canal, n) {
      return balde(quadros, canal, config.quadrosPorCanal).tentar() && balde(bytes, canal, config.bytesPorCanal).tentar(Math.max(1, n));
    },
    esquecerCanal(canal) {
      quadros.delete(canal);
      bytes.delete(canal);
    },
    totalConexoes: () => total,
    ipsRastreados: () => helloIp.size + msgIp.size,
    varrer() {
      for (const m of [helloIp, msgIp]) for (const [ip, b] of m) if (!conexoes.has(ip) && b.fichas() >= (m === helloIp ? config.helloPorIp : config.msgPorIp).capacidade) m.delete(ip);
    },
  };
}
