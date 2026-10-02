// Fixtures da Fase 22: relógio falso, chaves ECDSA P-256 e handshake do relay dirigido à mão (sem rede).
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { VERSAO_PROTOCOLO_RELAY } from "../../../src/compartilhado/relay";
import { assinarProva, serializar, type Papel } from "../../../src/nucleo/relay/protocolo";
import { criarRoteador, type Acao, type DepsRoteador, type Roteador } from "../../../src/nucleo/relay/roteador";

export interface ParChave {
  pub: Buffer;
  priv: Buffer;
}
export function parChave(): ParChave {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { pub: publicKey.export({ type: "spki", format: "der" }) as Buffer, priv: privateKey.export({ type: "pkcs8", format: "der" }) as Buffer };
}
export const canalAleatorio = (): string => randomBytes(16).toString("hex");

export interface RelogioFalso {
  agora(): number;
  avancar(ms: number): void;
}
export function relogioFalso(t0 = Date.parse("2026-10-01T12:00:00Z")): RelogioFalso {
  let t = t0;
  return { agora: () => t, avancar: (ms) => void (t += ms) };
}

export function novoRoteador(extra: Partial<DepsRoteador> = {}): { r: Roteador; rel: RelogioFalso } {
  const rel = relogioFalso();
  return { r: criarRoteador({ relogio: rel, aleatorio: (n) => randomBytes(n), ...extra }), rel };
}

export const textos = (a: Acao[], para?: string): Array<Record<string, unknown>> =>
  a.filter((x): x is Extract<Acao, { k: "texto" }> => x.k === "texto" && (para === undefined || x.para === para)).map((x) => JSON.parse(x.texto) as Record<string, unknown>);
export const fechou = (a: Acao[], con: string): boolean => a.some((x) => x.k === "fechar" && x.con === con);

export interface OpcoesHandshake {
  papel: Papel;
  canal: string;
  par: ParChave;
  /** só host: SPKI do dispositivo permitido no slot do cliente. */
  cli?: Buffer;
  efemero?: boolean;
  ip?: string;
  /** troca a chave usada para assinar (prova com chave errada). */
  assinarCom?: ParChave;
  /** corrompe a assinatura. */
  truncar?: boolean;
  /** assina com papel trocado. */
  papelNaAssinatura?: Papel;
}
/** Conecta `con`, manda hello e prova. Devolve o que o relay respondeu em cada passo. */
export function handshake(r: Roteador, con: string, o: OpcoesHandshake): { desafio: Acao[]; fim: Acao[]; todas: Acao[] } {
  r.conectar(con, o.ip ?? "203.0.113.7");
  const nonce = randomBytes(16);
  const desafio = r.controle(con, serializar({ t: "hello", v: VERSAO_PROTOCOLO_RELAY, papel: o.papel, canal: o.canal, ts: 1, nonce: nonce.toString("base64") }));
  const d = textos(desafio, con)[0];
  if (d === undefined || d["t"] !== "desafio") return { desafio, fim: [], todas: desafio };
  const chave = (o.assinarCom ?? o.par).priv;
  let sig = assinarProva(chave, { desafio: Buffer.from(d["n"] as string, "base64"), nonceCliente: nonce, canal: o.canal, papel: o.papelNaAssinatura ?? o.papel, cli: o.papel === "host" ? o.cli : undefined, efemero: o.efemero });
  if (o.truncar === true) sig = sig.subarray(0, 63);
  const corpo: Record<string, unknown> = { t: "prova", pub: o.par.pub.toString("base64"), sig: Buffer.concat([sig, Buffer.alloc(64 - sig.length)]).toString("base64") };
  if (o.papel === "host" && o.cli !== undefined) corpo["cli"] = o.cli.toString("base64");
  if (o.papel === "host" && o.efemero === true) corpo["ef"] = 1;
  const fim = r.controle(con, JSON.stringify(corpo));
  return { desafio, fim, todas: [...desafio, ...fim] };
}
export const aceito = (a: Acao[], con: string): boolean => textos(a, con).some((t) => t["t"] === "ok");
