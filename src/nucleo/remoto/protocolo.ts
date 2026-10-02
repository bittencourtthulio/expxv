// Protocolo do controle remoto (T-13.13): pareamento por código de uso único (60 bits) + ECDH P-256 efêmero + PSK -> HKDF, SAS de 6 dígitos conferido no desktop,
// reconexão por ECDH efêmero com ASSINATURAS MÚTUAS (servidor com a identidade fixada pelo dispositivo; dispositivo com a chave registrada) e canal AES-256-GCM com
// contador monotônico por direção. SÓ primitivas padrão de `node:crypto` (sem criptografia própria). Tudo PURO/injetável (relógio e bytes), sem rede nem disco.
import {
  KeyObject,
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHash,
  createHmac,
  createPublicKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign as assinarEcdsa,
  timingSafeEqual,
  verify as verificarEcdsa,
} from "node:crypto";

export const CURVA = "prime256v1";
export const TTL_CODIGO_MS = 120_000;
export const MAX_ERRADAS = 5;
export const FRAME_MAX = 16 * 1024;
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 símbolos: 5 bits cada
export const TAMANHO_CODIGO = 12; // 12 x 5 = 60 bits

export interface RelogioRemoto {
  agora(): number;
}
export type Bytes = (n: number) => Buffer;

const sha256 = (...partes: Array<Buffer | string>): Buffer => {
  const h = createHash("sha256");
  for (const p of partes) h.update(p);
  return h.digest();
};
/** concatena com prefixo de comprimento (sem ambiguidade de fronteira entre campos). */
const lp = (...partes: Array<Buffer | string>): Buffer => Buffer.concat(partes.map((p) => {
  const b = typeof p === "string" ? Buffer.from(p, "utf8") : p;
  const t = Buffer.alloc(4);
  t.writeUInt32BE(b.length);
  return Buffer.concat([t, b]);
}));
const igual = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);
const b64 = (b: Buffer): string => b.toString("base64");
const deB64 = (s: unknown, max = 512): Buffer | null => {
  if (typeof s !== "string" || s.length === 0 || s.length > max * 2 || !/^[A-Za-z0-9+/=_-]+$/.test(s)) return null;
  const b = Buffer.from(s, "base64");
  return b.length > 0 && b.length <= max ? b : null;
};

// ------------------------------------------------------------------------ código
export function gerarCodigo(bytes: Bytes = randomBytes): string {
  const b = bytes(TAMANHO_CODIGO);
  let c = "";
  for (let i = 0; i < TAMANHO_CODIGO; i++) c += ALFABETO[(b[i] as number) & 31];
  return c;
}
export const normalizarCodigo = (t: string): string => t.trim().toUpperCase().replace(/[-\s]/g, "");
export const formatarCodigo = (c: string): string => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;

// ------------------------------------------------------------------------ ECDH
export interface ParEfemero {
  publica: Buffer;
  segredoCom(outraPublica: Buffer): Buffer | null;
}
export function novoParEfemero(): ParEfemero {
  const e = createECDH(CURVA);
  e.generateKeys();
  return {
    publica: e.getPublicKey(),
    segredoCom(outra) {
      try {
        return e.computeSecret(outra);
      } catch {
        return null; // ponto inválido/fora da curva
      }
    },
  };
}

// ------------------------------------------------------------------------ derivação do pareamento
export interface ChavesPareamento {
  conf: Buffer;
  sas: string;
  transcricao: Buffer;
}
export function transcricaoPareamento(epkC: Buffer, spk: Buffer, nonceC: Buffer, nonceS: Buffer): Buffer {
  return sha256(lp("par-v1", epkC, spk, nonceC, nonceS));
}
export function derivarPareamento(p: { ecdh: Buffer; codigo: string; epkC: Buffer; spk: Buffer; nonceC: Buffer; nonceS: Buffer }): ChavesPareamento {
  const transcricao = transcricaoPareamento(p.epkC, p.spk, p.nonceC, p.nonceS);
  const ikm = Buffer.concat([p.ecdh, sha256("psk", normalizarCodigo(p.codigo))]);
  const conf = Buffer.from(hkdfSync("sha256", ikm, transcricao, "xv/remoto/pareamento/conf", 32));
  const s = createHmac("sha256", conf).update(lp("sas", transcricao)).digest();
  const sas = String(s.readUInt32BE(0) % 1_000_000).padStart(6, "0");
  return { conf, sas, transcricao };
}
const macPar = (c: ChavesPareamento, rotulo: string, ...extra: Array<Buffer | string>): Buffer => createHmac("sha256", c.conf).update(lp(rotulo, c.transcricao, ...extra)).digest();
export const confServidor = (c: ChavesPareamento): Buffer => macPar(c, "srv");
export const confCliente = (c: ChavesPareamento, chavePublicaDispositivo: Buffer, nome: string): Buffer => macPar(c, "cli", sha256(chavePublicaDispositivo), nome);
export const macPareado = (c: ChavesPareamento, dispositivoId: string, identidadeSpki: Buffer): Buffer => macPar(c, "ok", dispositivoId, identidadeSpki);

// ------------------------------------------------------------------------ pareamento (lado servidor; máquina de estados)
export type EstadoPar = "fechado" | "aguardando_codigo" | "handshake" | "aguardando_desktop" | "pareado" | "negado";
export interface ResultadoInicioPar {
  hid: string;
  spk: string;
  nonce_s: string;
  conf_s: string;
}
export interface PedidoPareamentoDesktop {
  hid: string;
  nome: string;
  chave_publica: Buffer;
  sas: string;
}
export interface DepsPareamentoServidor {
  relogio: RelogioRemoto;
  bytes?: Bytes;
  ttl_ms?: number;
  max_erradas?: number;
  /** identidade do servidor (SPKI) que o dispositivo vai fixar; devolvida AUTENTICADA pelo MAC do pareamento. */
  identidadeSpki(): Buffer;
  aoErradas?(restantes: number): void;
  aoJanelaFechada?(motivo: "expirou" | "tentativas" | "pareado" | "negado" | "cancelado"): void;
  aoPedido?(p: PedidoPareamentoDesktop): void;
}
export interface PareamentoServidor {
  abrir(): { codigo: string; expira_em: number };
  inicio(corpo: unknown): ResultadoInicioPar | null;
  fim(corpo: unknown): { ok: true } | null;
  /** `null` = desconhecido/expirado (resposta uniforme). */
  status(hid: unknown): { estado: "aguardando" } | { estado: "negado" } | { estado: "pareado"; dispositivo_id: string; identidade: string; mac: string } | null;
  /** o DESKTOP decide. `igual=false` nega. Devolve o pedido (com a chave pública) para o chamador registrar o dispositivo. */
  decidir(hid: string, igual: boolean): PedidoPareamentoDesktop | null;
  /** o chamador registrou o dispositivo: publica o resultado ao cliente. */
  concluir(hid: string, dispositivo_id: string): void;
  cancelar(): void;
  estado(): EstadoPar;
  sasPendente(): string | null;
}

export function criarPareamentoServidor(deps: DepsPareamentoServidor): PareamentoServidor {
  const bytes = deps.bytes ?? randomBytes;
  const ttl = deps.ttl_ms ?? TTL_CODIGO_MS;
  const maxErradas = deps.max_erradas ?? MAX_ERRADAS;
  let estado: EstadoPar = "fechado";
  let codigoHash: Buffer | null = null;
  let codigo = "";
  let expira = 0;
  let erradas = 0;
  let hs: { hid: string; chaves: ChavesPareamento; ate: number } | null = null;
  let pedido: (PedidoPareamentoDesktop & { chaves: ChavesPareamento }) | null = null;
  let resultado: { hid: string; estado: "pareado" | "negado"; dispositivo_id?: string } | null = null;

  const fechar = (motivo: Parameters<NonNullable<DepsPareamentoServidor["aoJanelaFechada"]>>[0]): void => {
    codigoHash = null;
    codigo = "";
    hs = null;
    erradas = 0;
    estado = motivo === "pareado" ? "pareado" : motivo === "negado" ? "negado" : "fechado";
    deps.aoJanelaFechada?.(motivo);
  };
  const vivo = (): boolean => {
    if ((estado === "aguardando_codigo" || estado === "handshake") && deps.relogio.agora() >= expira) fechar("expirou");
    if (estado === "aguardando_desktop" && deps.relogio.agora() >= expira + 60_000) {
      pedido = null;
      fechar("expirou");
    }
    return estado === "aguardando_codigo" || estado === "handshake";
  };

  return {
    abrir() {
      if (estado !== "fechado" && estado !== "pareado" && estado !== "negado") fechar("cancelado");
      pedido = null;
      resultado = null;
      codigo = gerarCodigo(bytes);
      codigoHash = sha256("psk", codigo);
      expira = deps.relogio.agora() + ttl;
      erradas = 0;
      estado = "aguardando_codigo";
      return { codigo: formatarCodigo(codigo), expira_em: expira };
    },
    inicio(corpo) {
      if (!vivo() || codigoHash === null) return null;
      if (typeof corpo !== "object" || corpo === null) return null;
      const c = corpo as Record<string, unknown>;
      const epkC = deB64(c["epk"], 65);
      const nonceC = deB64(c["nonce"], 32);
      if (epkC === null || epkC.length !== 65 || nonceC === null || nonceC.length < 16) return null;
      const par = novoParEfemero();
      const ecdh = par.segredoCom(epkC);
      if (ecdh === null) return null;
      const nonceS = bytes(16);
      const chaves = derivarPareamento({ ecdh, codigo, epkC, spk: par.publica, nonceC, nonceS });
      const hid = `hs_${bytes(12).toString("base64url")}`;
      hs = { hid, chaves, ate: deps.relogio.agora() + 30_000 };
      estado = "handshake";
      return { hid, spk: b64(par.publica), nonce_s: b64(nonceS), conf_s: b64(confServidor(chaves)) };
    },
    fim(corpo) {
      if (!vivo() || hs === null || codigoHash === null) return null;
      if (typeof corpo !== "object" || corpo === null) return null;
      const c = corpo as Record<string, unknown>;
      if (c["hid"] !== hs.hid || deps.relogio.agora() > hs.ate) return null;
      const pk = deB64(c["chave_publica"], 200);
      const confC = deB64(c["conf"], 64);
      const nome = typeof c["nome"] === "string" ? c["nome"].replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").trim().slice(0, 40) : "";
      if (pk === null || confC === null || nome === "") return null;
      const esperado = confCliente(hs.chaves, pk, nome);
      if (!igual(esperado, confC)) {
        erradas++;
        const restantes = maxErradas - erradas;
        deps.aoErradas?.(Math.max(0, restantes));
        if (erradas >= maxErradas) fechar("tentativas");
        else {
          hs = null;
          estado = "aguardando_codigo";
        }
        return null;
      }
      // acertou: o código queima AGORA (uso único); só o desktop transforma isso em dispositivo
      const chaves = hs.chaves;
      const hid = hs.hid;
      codigoHash = null;
      codigo = "";
      hs = null;
      estado = "aguardando_desktop";
      pedido = { hid, nome, chave_publica: pk, sas: chaves.sas, chaves };
      expira = deps.relogio.agora();
      deps.aoPedido?.({ hid, nome, chave_publica: pk, sas: chaves.sas });
      return { ok: true };
    },
    status(hid) {
      vivo();
      if (typeof hid !== "string") return null;
      if (resultado !== null && resultado.hid === hid) {
        if (resultado.estado === "negado") return { estado: "negado" };
        const ident = deps.identidadeSpki();
        const chaves = pedido?.chaves;
        if (chaves === undefined || resultado.dispositivo_id === undefined) return null;
        return { estado: "pareado", dispositivo_id: resultado.dispositivo_id, identidade: b64(ident), mac: b64(macPareado(chaves, resultado.dispositivo_id, ident)) };
      }
      return pedido !== null && pedido.hid === hid && estado === "aguardando_desktop" ? { estado: "aguardando" } : null;
    },
    decidir(hid, ok) {
      if (pedido === null || pedido.hid !== hid || estado !== "aguardando_desktop") return null;
      const p = pedido;
      if (!ok) {
        resultado = { hid, estado: "negado" };
        pedido = null;
        fechar("negado");
        return null;
      }
      return { hid: p.hid, nome: p.nome, chave_publica: p.chave_publica, sas: p.sas };
    },
    concluir(hid, dispositivo_id) {
      if (pedido === null || pedido.hid !== hid) return;
      resultado = { hid, estado: "pareado", dispositivo_id };
      fechar("pareado");
    },
    cancelar() {
      if (estado !== "fechado" && estado !== "pareado" && estado !== "negado") {
        pedido = null;
        fechar("cancelado");
      }
    },
    estado: () => {
      vivo();
      return estado;
    },
    sasPendente: () => (estado === "aguardando_desktop" && pedido !== null ? pedido.sas : null),
  };
}

// ------------------------------------------------------------------------ chaves de longo prazo (ECDSA P-256) e sessão
export interface ParAssinatura {
  publicaSpki: Buffer;
  privadaPkcs8: Buffer;
}
export function novoParAssinatura(): ParAssinatura {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: CURVA });
  return { publicaSpki: publicKey.export({ type: "spki", format: "der" }) as Buffer, privadaPkcs8: privateKey.export({ type: "pkcs8", format: "der" }) as Buffer };
}
export function assinar(privadaPkcs8: Buffer, dados: Buffer): Buffer {
  return assinarEcdsa("sha256", dados, { key: Buffer.from(privadaPkcs8), format: "der", type: "pkcs8", dsaEncoding: "ieee-p1363" });
}
export function verificarAssinatura(publicaSpki: Buffer, dados: Buffer, assinatura: Buffer): boolean {
  try {
    const k: KeyObject = createPublicKey({ key: Buffer.from(publicaSpki), format: "der", type: "spki" });
    return verificarEcdsa("sha256", dados, { key: k, dsaEncoding: "ieee-p1363" }, assinatura);
  } catch {
    return false;
  }
}

export const JANELA_TS_MS = 60_000;
export const dadosAssinadosCliente = (dispositivoId: string, epk: Buffer, nonceC: Buffer, ts: number): Buffer => lp("sess-c-v1", dispositivoId, epk, nonceC, String(ts));
export const transcricaoSessao = (dispositivoId: string, epkC: Buffer, spk: Buffer, nonceC: Buffer, nonceS: Buffer, ts: number): Buffer => sha256(lp("sess-v1", dispositivoId, epkC, spk, nonceC, nonceS, String(ts)));
export function derivarSessao(ecdh: Buffer, transcricao: Buffer): { c2s: Buffer; s2c: Buffer } {
  const k = Buffer.from(hkdfSync("sha256", ecdh, transcricao, "xv/remoto/sessao", 64));
  return { c2s: k.subarray(0, 32), s2c: k.subarray(32, 64) };
}

export interface DepsSessaoServidor {
  relogio: RelogioRemoto;
  bytes?: Bytes;
  identidade: { assinar(dados: Buffer): Buffer };
  /** `null` = desconhecido, revogado ou expirado. */
  chaveDoDispositivo(id: string): Buffer | null;
  /** nonces já vistos (anti-replay do pedido de sessão), com varredura por tempo. */
  jaVisto?: (chave: string, ts: number) => boolean;
}
export interface SessaoNegociada {
  sid: string;
  dispositivo_id: string;
  canal: Canal;
  resposta: { sid: string; spk: string; nonce_s: string; sig_s: string };
}
const vistos = new Map<string, number>();
export function iniciarSessaoServidor(deps: DepsSessaoServidor, corpo: unknown): SessaoNegociada | null {
  if (typeof corpo !== "object" || corpo === null) return null;
  const c = corpo as Record<string, unknown>;
  const dispositivoId = c["dispositivo_id"];
  const ts = c["ts"];
  if (typeof dispositivoId !== "string" || !/^dev_[A-Za-z0-9_-]{6,40}$/.test(dispositivoId) || typeof ts !== "number" || !Number.isFinite(ts)) return null;
  const agora = deps.relogio.agora();
  if (Math.abs(agora - ts) > JANELA_TS_MS) return null;
  const epk = deB64(c["epk"], 65);
  const nonceC = deB64(c["nonce"], 32);
  const sig = deB64(c["sig"], 64);
  if (epk === null || epk.length !== 65 || nonceC === null || nonceC.length < 16 || sig === null) return null;
  const chave = deps.chaveDoDispositivo(dispositivoId);
  if (chave === null) return null;
  if (!verificarAssinatura(chave, dadosAssinadosCliente(dispositivoId, epk, nonceC, ts), sig)) return null;
  // anti-replay: o mesmo (dispositivo, nonce) só vale uma vez dentro da janela
  const k = `${dispositivoId}|${nonceC.toString("hex")}`;
  for (const [x, t] of vistos) if (agora - t > 2 * JANELA_TS_MS) vistos.delete(x);
  if (deps.jaVisto !== undefined ? deps.jaVisto(k, ts) : vistos.has(k)) return null;
  vistos.set(k, agora);
  const bytes = deps.bytes ?? randomBytes;
  const par = novoParEfemero();
  const ecdh = par.segredoCom(epk);
  if (ecdh === null) return null;
  const nonceS = bytes(16);
  const tr = transcricaoSessao(dispositivoId, epk, par.publica, nonceC, nonceS, ts);
  const chaves = derivarSessao(ecdh, tr);
  const sid = `ses_${bytes(16).toString("base64url")}`;
  const sigS = deps.identidade.assinar(tr);
  return { sid, dispositivo_id: dispositivoId, canal: criarCanal({ sid, envio: chaves.s2c, recebimento: chaves.c2s }), resposta: { sid, spk: b64(par.publica), nonce_s: b64(nonceS), sig_s: b64(sigS) } };
}
/** zera o conjunto de nonces vistos (testes). */
export const _limparVistos = (): void => vistos.clear();

// ------------------------------------------------------------------------ canal AES-256-GCM
export interface Quadro {
  v: 1;
  n: number;
  c: string;
}
export type ErroCanal = "quadro_invalido";
export interface Canal {
  sid: string;
  selar(mensagem: unknown): Quadro;
  /** `null` = quadro inválido (formato, contador repetido/menor, adulterado, grande demais): o chamador FECHA a sessão. */
  abrir(quadro: unknown): unknown | null;
  ultimoRecebido(): number;
}
const nonceDe = (n: number): Buffer => {
  const b = Buffer.alloc(12);
  b.writeBigUInt64BE(BigInt(n), 4);
  return b;
};
export function criarCanal(o: { sid: string; envio: Buffer; recebimento: Buffer }): Canal {
  let nEnvio = 0;
  let ultimo = 0;
  const aad = (n: number): Buffer => Buffer.from(`v1|${o.sid}|${n}`);
  return {
    sid: o.sid,
    selar(mensagem) {
      const n = ++nEnvio;
      const cif = createCipheriv("aes-256-gcm", o.envio, nonceDe(n));
      cif.setAAD(aad(n));
      const ct = Buffer.concat([cif.update(JSON.stringify(mensagem), "utf8"), cif.final(), cif.getAuthTag()]);
      return { v: 1, n, c: b64(ct) };
    },
    abrir(q) {
      if (typeof q !== "object" || q === null) return null;
      const { v, n, c } = q as Record<string, unknown>;
      if (v !== 1 || typeof n !== "number" || !Number.isSafeInteger(n) || n <= ultimo || typeof c !== "string" || c.length > FRAME_MAX * 2) return null;
      const buf = deB64(c, FRAME_MAX);
      if (buf === null || buf.length < 17) return null;
      try {
        const dec = createDecipheriv("aes-256-gcm", o.recebimento, nonceDe(n));
        dec.setAAD(aad(n));
        dec.setAuthTag(buf.subarray(buf.length - 16));
        const claro = Buffer.concat([dec.update(buf.subarray(0, buf.length - 16)), dec.final()]).toString("utf8");
        ultimo = n; // só avança com quadro AUTÊNTICO (um quadro falso não "queima" contadores)
        return JSON.parse(claro) as unknown;
      } catch {
        return null;
      }
    },
    ultimoRecebido: () => ultimo,
  };
}

export const _util = { lp, sha256, deB64, b64 };
