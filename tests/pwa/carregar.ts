// Carrega os módulos JavaScript do PWA (pasta `pwa/`, fora de `src/`, sem tipos) como `any` tipado por interfaces locais. Só para testes.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const RAIZ = resolve(__dirname, "..", "..");
export async function carregar<T>(relativo: string): Promise<T> {
  return (await import(/* @vite-ignore */ pathToFileURL(resolve(RAIZ, relativo)).href)) as T;
}

export interface Cripto {
  concat(...p: Array<Uint8Array | string>): Uint8Array;
  lp(...p: Array<Uint8Array | string>): Uint8Array;
  paraB64(b: Uint8Array): string;
  deB64(s: string): Uint8Array;
  paraHex(b: Uint8Array): string;
  sha256(...p: Array<Uint8Array | string>): Promise<Uint8Array>;
  hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array | string, n: number): Promise<Uint8Array>;
  hmac(k: Uint8Array, d: Uint8Array): Promise<Uint8Array>;
  parEfemero(): Promise<{ publica: Uint8Array; segredoCom(o: Uint8Array): Promise<Uint8Array | null> }>;
  derivarPareamento(p: { ecdh: Uint8Array; codigo: string; epkC: Uint8Array; spk: Uint8Array; nonceC: Uint8Array; nonceS: Uint8Array }): Promise<{ conf: Uint8Array; sas: string; transcricao: Uint8Array }>;
  confServidor(c: { conf: Uint8Array; transcricao: Uint8Array }): Promise<Uint8Array>;
  confCliente(c: { conf: Uint8Array; transcricao: Uint8Array }, pub: Uint8Array, nome: string): Promise<Uint8Array>;
  macPareado(c: { conf: Uint8Array; transcricao: Uint8Array }, id: string, spki: Uint8Array): Promise<Uint8Array>;
  transcricaoSessao(id: string, epkC: Uint8Array, spk: Uint8Array, nC: Uint8Array, nS: Uint8Array, ts: number): Promise<Uint8Array>;
  derivarSessao(ecdh: Uint8Array, tr: Uint8Array): Promise<{ c2s: Uint8Array; s2c: Uint8Array }>;
  dadosAssinadosCliente(id: string, epk: Uint8Array, n: Uint8Array, ts: number): Uint8Array;
  criarCanal(o: { sid: string; envio: Uint8Array; recebimento: Uint8Array }): { selar(m: unknown): Promise<{ v: 1; n: number; c: string }>; abrir(q: unknown): Promise<unknown | null>; ultimoRecebido(): number };
  gerarChaveDispositivo(): Promise<{ privada: CryptoKey; publicaSpki: Uint8Array }>;
  assinar(k: CryptoKey, d: Uint8Array): Promise<Uint8Array>;
  verificar(spki: Uint8Array, d: Uint8Array, s: Uint8Array): Promise<boolean>;
  canalId(segredo: Uint8Array, epoca: number): Promise<string>;
  chaveEnvelope(segredo: Uint8Array, rotulo: string): Promise<Uint8Array>;
  selarEnvelope(k: Uint8Array, claro: Uint8Array, aad: Uint8Array | string): Promise<Uint8Array>;
  abrirEnvelope(k: Uint8Array, selado: Uint8Array, aad: Uint8Array | string): Promise<Uint8Array | null>;
}
export interface Padding {
  preencher(c: Uint8Array | null, aleatorio?: (n: number) => Uint8Array, tamanhoEnchimento?: number): Uint8Array;
  remover(q: Uint8Array): { tipo: "dado" | "enchimento"; conteudo: Uint8Array } | null;
  tamanhoDoBloco(n: number): number;
  MAX_CONTEUDO: number;
}
export interface Verificar {
  assinaturaValida(bytes: Uint8Array, sig: string, chaves: string[]): Promise<boolean>;
  lerManifesto(bytes: Uint8Array): { versao: number; arquivos: Record<string, { sha256: string; tamanho: number }> } | null;
  verificarManifesto(o: { manifestoBytes: Uint8Array; assinaturaB64: string; chaves: string[]; versaoInstalada: number }): Promise<{ ok: true } | { ok: false; motivo: string }>;
  baixarEVerificarShell(o: { buscar(c: string): Promise<Uint8Array | null>; chaves: string[]; versaoInstalada: number }): Promise<{ ok: true; versao: number; arquivos: Map<string, Uint8Array> } | { ok: false; motivo: string }>;
}
export interface Assinar {
  gerarParChaves(): { publicaB64: string; privadaPem: string };
  gerarManifesto(dir: string, versao: number): string;
  assinarManifesto(texto: string, pem: string): string;
  assinarDist(dir: string, versao: number, pem: string): { versao: number; publicaB64: string };
  carregarChavePrivada(nome: string, env?: Record<string, string | undefined>): string;
  publicaBrutaDe(pem: string): string;
}
export interface Build {
  construir(o: { destino: string; versao?: number; chavesPublicas?: string[]; privadaPem?: string | null; produto?: { nome: string; id: string } }): { destino: string; versao: number; assinado: boolean; arquivos: string[] };
  csp(o?: { connect?: string }): string;
  produtoDe(): { nome: string; id: string };
}
export const u8 = (b: Buffer): Uint8Array => new Uint8Array(b);
