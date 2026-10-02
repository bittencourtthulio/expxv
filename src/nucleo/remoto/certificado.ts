// Certificado X.509 autoassinado mínimo (T-13.12): v3, ECDSA P-256 / SHA-256, SAN de IP (e DNS opcional), `basicConstraints` CA:FALSE, `keyUsage` digitalSignature, `extKeyUsage`
// serverAuth. DER montado à mão (sem dependência); a assinatura é `crypto.sign`. Par TLS EFÊMERO: gerado ao ligar o servidor e nunca persistido (a identidade que o dispositivo
// fixa é a de `identidade.ts`, na camada de aplicação). Validado pelo teste com `X509Certificate`.
import { X509Certificate, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isIP } from "node:net";
import { PRODUTO } from "../produto";

const len = (n: number): Buffer => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) bytes.unshift(x & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag: number, ...conteudo: Buffer[]): Buffer => {
  const c = Buffer.concat(conteudo);
  return Buffer.concat([Buffer.from([tag]), len(c.length), c]);
};
const seq = (...c: Buffer[]): Buffer => tlv(0x30, ...c);
const set = (...c: Buffer[]): Buffer => tlv(0x31, ...c);
const oid = (s: string): Buffer => {
  const p = s.split(".").map(Number);
  const out: number[] = [(p[0] as number) * 40 + (p[1] as number)];
  for (const x of p.slice(2)) {
    const grupo: number[] = [x & 0x7f];
    for (let v = x >> 7; v > 0; v >>= 7) grupo.unshift((v & 0x7f) | 0x80);
    out.push(...grupo);
  }
  return tlv(0x06, Buffer.from(out));
};
const inteiro = (b: Buffer): Buffer => {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  let v = b.subarray(i);
  if (((v[0] as number) & 0x80) !== 0) v = Buffer.concat([Buffer.from([0]), v]);
  return tlv(0x02, v);
};
const booleano = (v: boolean): Buffer => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const octetos = (b: Buffer): Buffer => tlv(0x04, b);
const bits = (b: Buffer, naoUsados = 0): Buffer => tlv(0x03, Buffer.from([naoUsados]), b);
const utf8 = (s: string): Buffer => tlv(0x0c, Buffer.from(s, "utf8"));
const tempo = (t: number): Buffer => {
  const d = new Date(t);
  const p = (n: number): string => String(n).padStart(2, "0");
  return tlv(0x17, Buffer.from(`${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`, "ascii"));
};
const ipBytes = (ip: string): Buffer => {
  if (isIP(ip) === 4) return Buffer.from(ip.split(".").map(Number));
  // IPv6 sem abreviação complexa: expande `::`
  const [a = "", b = ""] = ip.split("::");
  const esq = a === "" ? [] : a.split(":");
  const dir = b === "" ? [] : b.split(":");
  const meio = ip.includes("::") ? Array(8 - esq.length - dir.length).fill("0") : [];
  const bytes: number[] = [];
  for (const g of [...esq, ...meio, ...dir]) {
    const v = parseInt(g, 16);
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return Buffer.from(bytes);
};

export interface CertificadoGerado {
  certPem: string;
  keyPem: string;
  cert: X509Certificate;
}

export function gerarCertificadoAutoassinado(o: { ips: string[]; dns?: string[]; agora?: number; validade_dias?: number }): CertificadoGerado {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const agora = o.agora ?? Date.now();
  const algoritmo = seq(oid("1.2.840.10045.4.3.2")); // ecdsa-with-SHA256
  const nome = seq(set(seq(oid("2.5.4.3"), utf8(`${PRODUTO.id}-remoto`))));
  const san = seq(...o.ips.map((ip) => tlv(0x87, ipBytes(ip))), ...(o.dns ?? []).map((n) => tlv(0x82, Buffer.from(n, "ascii"))));
  const serial = randomBytes(16);
  serial[0] = (serial[0] as number) & 0x7f;
  const extensoes = seq(
    seq(oid("2.5.29.19"), booleano(true), octetos(seq(booleano(false)))), // basicConstraints CA:FALSE (critical)
    seq(oid("2.5.29.15"), booleano(true), octetos(bits(Buffer.from([0x80]), 7))), // keyUsage digitalSignature (critical)
    seq(oid("2.5.29.37"), octetos(seq(oid("1.3.6.1.5.5.7.3.1")))), // extKeyUsage serverAuth
    seq(oid("2.5.29.17"), octetos(san)), // subjectAltName
  );
  const tbs = seq(
    tlv(0xa0, inteiro(Buffer.from([2]))),
    inteiro(serial),
    algoritmo,
    nome,
    seq(tempo(agora - 3_600_000), tempo(agora + (o.validade_dias ?? 90) * 86_400_000)),
    nome,
    spki,
    tlv(0xa3, extensoes),
  );
  const assinatura = sign("sha256", tbs, privateKey); // DER
  const der = seq(tbs, algoritmo, bits(assinatura));
  const b64 = der.toString("base64").replace(/(.{64})/g, "$1\n");
  const certPem = `-----BEGIN CERTIFICATE-----\n${b64}${b64.endsWith("\n") ? "" : "\n"}-----END CERTIFICATE-----\n`;
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return { certPem, keyPem, cert: new X509Certificate(certPem) };
}
