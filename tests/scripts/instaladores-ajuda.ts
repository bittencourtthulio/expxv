// Ajuda dos testes de instaladores/assinatura (T-21.08..T-21.11): fixtures sintéticas pequenas, sempre em diretório temporário.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { crc32, gzipSync } from "node:zlib";

export const RAIZ = resolve(__dirname, "..", "..");
export const DUPLES = join(RAIZ, "tests", "fixtures", "assinatura");
export const HDIUTIL_FALSO = join(RAIZ, "tests", "fixtures", "instaladores", "hdiutil-falso");
export const VERSAO: string = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")).version;

export function tmp(prefixo = "expxv-t-"): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefixo)));
}

export function escrever(caminho: string, conteudo: string | Buffer, modo?: number): string {
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
  if (modo) chmodSync(caminho, modo);
  return caminho;
}

/** Mach-O falso: magic 64-bit + linha `ARCHS:` (lida pelo `lipo` dublê) + marcador de assinatura. */
export function macho(caminho: string, arquiteturas: string, assinado = true): string {
  return escrever(caminho, Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.from(`\nARCHS: ${arquiteturas}\n${assinado ? "" : "NAO_ASSINADO\n"}`)]));
}

export interface OpcoesApp {
  appId?: string;
  versao?: string;
  arquiteturasExe?: string;
  pty?: string[];
  microfone?: boolean;
  plist?: string;
}

/** `.app` falso: Info.plist, executável e prebuilds do node-pty. */
export function criarApp(pasta: string, o: OpcoesApp = {}): string {
  const app = join(pasta, "ExpxV.app");
  let plist = readFileSync(join(RAIZ, "tests", "fixtures", "instaladores", o.plist ?? "plist-valido.plist"), "utf8").replace("__VERSAO__", o.versao ?? VERSAO);
  if (o.appId) plist = plist.replace("com.expx.expxv", o.appId);
  if (o.microfone === false) plist = plist.replace(/<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]*<\/string>/, "");
  escrever(join(app, "Contents", "Info.plist"), plist);
  macho(join(app, "Contents", "MacOS", "ExpxV"), o.arquiteturasExe ?? "arm64 x86_64");
  for (const a of o.pty ?? ["arm64", "x86_64"]) {
    macho(join(app, "Contents", "Resources", "app.asar.unpacked", "node_modules", "node-pty", "prebuilds", `darwin-${a}`, "pty.node"), a);
  }
  return app;
}

/** ZIP mínimo válido (um arquivo, sem compressão). */
export function zipValido(caminho: string, extra = 0): string {
  const nome = Buffer.from("a.txt");
  const dados = Buffer.concat([Buffer.from("conteudo"), randomBytes(extra)]);
  const crc = crc32(dados);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(10, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(dados.length, 18);
  local.writeUInt32LE(dados.length, 22);
  local.writeUInt16LE(nome.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(10, 4);
  central.writeUInt16LE(10, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(dados.length, 20);
  central.writeUInt32LE(dados.length, 24);
  central.writeUInt16LE(nome.length, 28);
  const inicioCentral = local.length + nome.length + dados.length;
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(1, 8);
  fim.writeUInt16LE(1, 10);
  fim.writeUInt32LE(central.length + nome.length, 12);
  fim.writeUInt32LE(inicioCentral, 16);
  return escrever(caminho, Buffer.concat([local, nome, dados, central, nome, fim]));
}

export const sha512 = (arq: string): string => createHash("sha512").update(readFileSync(arq)).digest("base64");

export function blockmap(arquivo: string, tamanhos?: number[]): string {
  const total = readFileSync(arquivo).length;
  const sizes = tamanhos ?? [total];
  const json = { version: "2", files: [{ name: "file", offset: 0, checksums: sizes.map(() => "AAAA"), sizes }] };
  return escrever(`${arquivo}.blockmap`, gzipSync(JSON.stringify(json)));
}

export function yml(pasta: string, nome: string, versao: string, arquivos: string[], adulterarHash?: string): string {
  const itens = arquivos.map((a) => `  - url: ${a}\n    sha512: ${a === adulterarHash ? "AAAA" + sha512(join(pasta, a)).slice(4) : sha512(join(pasta, a))}\n    size: ${readFileSync(join(pasta, a)).length}`).join("\n");
  return escrever(join(pasta, nome), `version: ${versao}\nfiles:\n${itens}\npath: ${arquivos[0]}\nsha512: ${sha512(join(pasta, arquivos[0] as string))}\nreleaseDate: '2026-10-01T00:00:00.000Z'\n`);
}

/** dist-app falso do macOS: DMG (bytes aleatórios), ZIP válido, blockmaps e latest-mac.yml com hashes reais. */
export function criarDistMac(pasta: string, o: { versao?: string; adulterar?: string } = {}): string {
  escrever(join(pasta, "ExpxV-universal.dmg"), randomBytes(4096));
  zipValido(join(pasta, "ExpxV-universal.zip"));
  yml(pasta, "latest-mac.yml", o.versao ?? VERSAO, ["ExpxV-universal.zip", "ExpxV-universal.dmg"], o.adulterar);
  return pasta;
}

/** PE falso: MZ, e_lfanew=0x80, `PE\0\0`, optional header PE32+ e (opcional) tabela de certificado. */
export function pe(caminho: string, o: { assinado?: boolean; tamanho?: number; invalido?: boolean } = {}): string {
  const b = Buffer.alloc(o.tamanho ?? 2048);
  if (o.invalido) {
    b.write("XX");
    return escrever(caminho, b);
  }
  b.write("MZ", 0, "latin1");
  b.writeUInt32LE(0x80, 0x3c);
  b.write("PE\0\0", 0x80, "latin1");
  b.writeUInt16LE(0x8664, 0x84);
  const opt = 0x80 + 24;
  b.writeUInt16LE(0x20b, opt);
  const dirs = opt + 112;
  if (o.assinado) {
    b.writeUInt32LE(0x600, dirs + 4 * 8);
    b.writeUInt32LE(0x200, dirs + 4 * 8 + 4);
  }
  return escrever(caminho, b);
}

/** dist-app falso do Windows. */
export function criarDistWin(pasta: string, o: { versao?: string; adulterar?: string; semBlockmap?: boolean; blockmapRuim?: boolean; peInvalido?: boolean; nome?: string } = {}): string {
  const nome = o.nome ?? "ExpxV-Setup.exe";
  const exe = pe(join(pasta, nome), { invalido: o.peInvalido === true, tamanho: 4096 });
  if (!o.semBlockmap) blockmap(exe, o.blockmapRuim ? [10, 20] : undefined);
  yml(pasta, "latest.yml", o.versao ?? VERSAO, [nome], o.adulterar);
  return pasta;
}

export function cli(script: string, args: string[], env: Record<string, string> = {}, base: NodeJS.ProcessEnv = process.env): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [join(RAIZ, script), ...args], { encoding: "utf8", env: { ...base, ...env }, timeout: 120000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Ambiente sem NENHUMA variável de assinatura (os testes não herdam credencial do dono). */
export function ambienteLimpo(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(e)) if (/^(CSC_|APPLE_|WIN_CSC_|AZURE_)/.test(k) || k.endsWith("MANIFESTO_CHAVE_PRIVADA")) delete e[k];
  return { ...e, ...extra };
}
