// Motores de cifra do cofre (porta `MotorCofre`). Nenhum importa Electron: o `safeStorage` entra por injeção.
//  (a) `criarMotorSafeStorage`: cifra do SO (Keychain/DPAPI/libsecret). Recusa o backend `basic_text` do Linux (texto quase em claro).
//  (b) `criarMotorSenhaMestra` (P-29): arquivo cifrado com senha-mestra do usuário. scrypt deriva a chave-mestra UMA vez no
//      desbloqueio (fora do event loop); cada segredo usa sal próprio (HKDF) e nonce próprio (AES-256-GCM, contexto autenticado).
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { CofreErro } from "./erros";

export type TipoMotor = "safe_storage" | "senha_mestra";

export interface EstadoMotor {
  ok: boolean;
  bloqueado: boolean;
  motivo?: string;
}

export interface MotorCofre {
  readonly tipo: TipoMotor;
  estado(): EstadoMotor;
  /** `contexto` (id + nome da entrada) fica preso ao texto cifrado: trocar entradas de lugar no arquivo é detectado. Devolve base64. */
  cifrar(contexto: string, claro: string): string;
  /** lança `CofreErro` (`cofre_bloqueado`/`entrada_corrompida`) — sem pista do motivo. */
  decifrar(contexto: string, cifradoB64: string): string;
}

// ---------------------------------------------------------------- safeStorage

export interface PortaSafeStorage {
  disponivel(): boolean;
  /** Linux: `basic_text`, `gnome_libsecret`, `kwallet`…; macOS/Windows: `null`/nome do backend. */
  backend(): string | null;
  cifrar(texto: string): Uint8Array;
  decifrar(dados: Uint8Array): string;
}

export function criarMotorSafeStorage(porta: PortaSafeStorage): MotorCofre {
  const estado = (): EstadoMotor => {
    if (!porta.disponivel()) return { ok: false, bloqueado: false, motivo: "O cifrador do sistema não está disponível. Use a senha-mestra." };
    if (porta.backend() === "basic_text") {
      return { ok: false, bloqueado: false, motivo: "O sistema não tem chaveiro seguro (backend basic_text). Instale/ative o libsecret ou o KWallet, ou use a senha-mestra." };
    }
    return { ok: true, bloqueado: false };
  };
  const exigirPronto = (): void => {
    if (!estado().ok) throw new CofreErro("cofre_indisponivel");
  };
  return {
    tipo: "safe_storage",
    estado,
    cifrar(contexto, claro) {
      exigirPronto();
      return Buffer.from(porta.cifrar(JSON.stringify({ c: contexto, v: claro }))).toString("base64");
    },
    decifrar(contexto, cifradoB64) {
      exigirPronto();
      try {
        const p = JSON.parse(porta.decifrar(Buffer.from(cifradoB64, "base64"))) as { c?: unknown; v?: unknown };
        if (p.c !== contexto || typeof p.v !== "string") throw new Error("x");
        return p.v;
      } catch {
        throw new CofreErro("entrada_corrompida");
      }
    },
  };
}

// ---------------------------------------------------------------- senha-mestra

export interface ParametrosScrypt {
  N: number;
  r: number;
  p: number;
}
/** Padrão: ~32 MB e algumas dezenas de ms (uma vez por desbloqueio). Testes injetam custo baixo. */
export const SCRYPT_PADRAO: ParametrosScrypt = { N: 32768, r: 8, p: 1 };

/** Cabeçalho persistido no arquivo do cofre (sem segredo: sal público + verificador cifrado). */
export interface CabecalhoMestra {
  kdf: "scrypt";
  N: number;
  r: number;
  p: number;
  sal_b64: string;
  /** cifra de uma constante: se decifra, a senha está certa. */
  verificador_b64: string;
}

const VERIFICADOR_CLARO = "cofre-verificador-v1";
const INFO_HKDF = "cofre:segredo:v1";
const TAM_SAL = 16;
const TAM_NONCE = 12;
const TAM_TAG = 16;
export const SENHA_MIN = 8;
export const SENHA_MAX = 256;

function derivar(senha: string, sal: Buffer, p: ParametrosScrypt): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(senha.normalize("NFKC"), sal, 32, { N: p.N, r: p.r, p: p.p, maxmem: 256 * p.N * p.r + 8 * 1024 * 1024 }, (e, chave) => (e ? reject(e) : resolve(chave)));
  });
}

function selar(chave: Buffer, aad: string, claro: string): string {
  const sal = randomBytes(TAM_SAL);
  const nonce = randomBytes(TAM_NONCE);
  const chaveSegredo = Buffer.from(hkdfSync("sha256", chave, sal, INFO_HKDF, 32));
  const c = createCipheriv("aes-256-gcm", chaveSegredo, nonce, { authTagLength: TAM_TAG });
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(claro, "utf8"), c.final()]);
  chaveSegredo.fill(0);
  return Buffer.concat([sal, nonce, c.getAuthTag(), ct]).toString("base64");
}

function abrir(chave: Buffer, aad: string, b64: string): string {
  const b = Buffer.from(b64, "base64");
  if (b.length < TAM_SAL + TAM_NONCE + TAM_TAG) throw new Error("curto");
  const sal = b.subarray(0, TAM_SAL);
  const nonce = b.subarray(TAM_SAL, TAM_SAL + TAM_NONCE);
  const tag = b.subarray(TAM_SAL + TAM_NONCE, TAM_SAL + TAM_NONCE + TAM_TAG);
  const ct = b.subarray(TAM_SAL + TAM_NONCE + TAM_TAG);
  const chaveSegredo = Buffer.from(hkdfSync("sha256", chave, sal, INFO_HKDF, 32));
  try {
    const d = createDecipheriv("aes-256-gcm", chaveSegredo, nonce, { authTagLength: TAM_TAG });
    d.setAAD(Buffer.from(aad, "utf8"));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } finally {
    chaveSegredo.fill(0);
  }
}

export interface MotorSenhaMestra extends MotorCofre {
  readonly tipo: "senha_mestra";
  /** cabeçalho atual (`null` = senha-mestra ainda não definida). */
  cabecalho(): CabecalhoMestra | null;
  carregarCabecalho(c: CabecalhoMestra | null): void;
  /** Define a senha-mestra: gera cabeçalho novo e deixa o motor DESBLOQUEADO com a chave nova. */
  definir(senha: string): Promise<CabecalhoMestra>;
  /** `CofreErro("senha_incorreta")` genérico em qualquer falha. */
  desbloquear(senha: string): Promise<void>;
  bloquear(): void;
  desbloqueado(): boolean;
}

export function criarMotorSenhaMestra(opcoes: { scrypt?: ParametrosScrypt } = {}): MotorSenhaMestra {
  const params = opcoes.scrypt ?? SCRYPT_PADRAO;
  let cab: CabecalhoMestra | null = null;
  let chave: Buffer | null = null;

  const zerar = (): void => {
    chave?.fill(0);
    chave = null;
  };
  const validarSenha = (s: string): void => {
    if (typeof s !== "string" || s.length < SENHA_MIN || s.length > SENHA_MAX) throw new CofreErro("senha_mestra_invalida");
  };

  return {
    tipo: "senha_mestra",
    estado() {
      if (cab === null) return { ok: true, bloqueado: true, motivo: "senha_mestra_nao_definida" };
      return chave === null ? { ok: true, bloqueado: true } : { ok: true, bloqueado: false };
    },
    cabecalho: () => cab,
    carregarCabecalho(c) {
      cab = c;
      zerar();
    },
    desbloqueado: () => chave !== null,
    cifrar(contexto, claro) {
      if (chave === null) throw new CofreErro(cab === null ? "senha_mestra_nao_definida" : "cofre_bloqueado");
      return selar(chave, contexto, claro);
    },
    decifrar(contexto, cifradoB64) {
      if (chave === null) throw new CofreErro(cab === null ? "senha_mestra_nao_definida" : "cofre_bloqueado");
      try {
        return abrir(chave, contexto, cifradoB64);
      } catch {
        throw new CofreErro("entrada_corrompida");
      }
    },
    async definir(senha) {
      validarSenha(senha);
      const sal = randomBytes(TAM_SAL);
      const nova = await derivar(senha, sal, params);
      zerar();
      chave = nova;
      cab = { kdf: "scrypt", ...params, sal_b64: sal.toString("base64"), verificador_b64: selar(nova, "verificador", VERIFICADOR_CLARO) };
      return cab;
    },
    async desbloquear(senha) {
      if (cab === null) throw new CofreErro("senha_mestra_nao_definida");
      if (typeof senha !== "string" || senha.length > SENHA_MAX) throw new CofreErro("senha_incorreta");
      let candidata: Buffer;
      try {
        candidata = await derivar(senha, Buffer.from(cab.sal_b64, "base64"), { N: cab.N, r: cab.r, p: cab.p });
      } catch {
        throw new CofreErro("senha_incorreta");
      }
      try {
        const lido = abrir(candidata, "verificador", cab.verificador_b64);
        const a = Buffer.from(lido);
        const b = Buffer.from(VERIFICADOR_CLARO);
        if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("x");
      } catch {
        candidata.fill(0);
        throw new CofreErro("senha_incorreta");
      }
      zerar();
      chave = candidata;
    },
    bloquear: zerar,
  };
}
