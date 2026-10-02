// Verificação ESTÁTICA dos instaladores (T-21.08 macOS, T-21.09 Windows). Nada é instalado no sistema: o DMG é montado
// somente leitura num ponto temporário e desmontado SEMPRE (finally). Ferramentas externas são injetáveis por caminho
// (dublês nos testes). O hash nunca é pulado; sem `hdiutil` só a montagem é pulada.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdtempSync, realpathSync, readdirSync, readFileSync, rmSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { parse as parseYaml } from "yaml";

export const LIMITE_MB_PADRAO = 400;
export const ARQUITETURAS_MAC = ["arm64", "x86_64"];

/** Lê o nome do produto de `src/nucleo/produto.ts` sem executar TypeScript (única fonte, D-01). */
export function lerProduto(raiz) {
  const texto = readFileSync(join(raiz, "src", "nucleo", "produto.ts"), "utf8");
  const nome = /const NOME = "([^"]+)"/.exec(texto)?.[1];
  const id = /const ID = "([^"]+)"/.exec(texto)?.[1];
  const appIdModelo = /appId: `([^`]+)`/.exec(texto)?.[1];
  if (!nome || !id || !appIdModelo) throw new Error("produto.ts: não foi possível ler NOME, ID e appId");
  const idEnv = id.toUpperCase();
  return { nome, id, appId: appIdModelo.replace("${ID}", id), prefixoEnv: `${idEnv}_` };
}

export function lerVersao(raiz) {
  return JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")).version;
}

const mb = (n) => (n / 1024 / 1024).toFixed(1);

function item(id, ok, mensagem, extra = {}) {
  return { id, ok, mensagem, ...extra };
}
function pulado(id, motivo) {
  return { id, ok: true, pulado: true, mensagem: `pulado: ${motivo}` };
}

/** `ferramenta` existe? (ENOENT = não). */
export function ferramentaExiste(caminho) {
  const r = spawnSync(caminho, ["-h"], { stdio: "ignore", timeout: 10000 });
  return !(r.error && r.error.code === "ENOENT");
}

export function sha512Base64(arquivo) {
  return new Promise((ok, falha) => {
    const h = createHash("sha512");
    createReadStream(arquivo).on("data", (d) => h.update(d)).on("error", falha).on("end", () => ok(h.digest("base64")));
  });
}

/** Lê `latest*.yml` do electron-builder. */
export function lerLatest(arquivo) {
  const doc = parseYaml(readFileSync(arquivo, "utf8"));
  if (doc === null || typeof doc !== "object" || !Array.isArray(doc.files)) throw new Error(`${arquivo}: yml sem lista \`files\``);
  return { version: String(doc.version ?? ""), arquivos: doc.files.map((f) => ({ url: String(f.url), sha512: String(f.sha512), size: Number(f.size) })), path: doc.path, sha512: doc.sha512 };
}

/** Confere cada artefato listado contra o yml (hash e tamanho). Nunca é pulado. */
export async function conferirHashes(dir, yml, { exigir = [] } = {}) {
  const itens = [];
  let latest;
  try {
    latest = lerLatest(yml);
  } catch (e) {
    return { itens: [item("hash", false, `yml ilegível (${e.message})`)], latest: null };
  }
  for (const nome of exigir) {
    if (!latest.arquivos.some((a) => a.url === nome)) itens.push(item(`hash:${nome}`, false, `${nome} não está listado em ${yml.split("/").pop()}`));
  }
  for (const a of latest.arquivos) {
    const caminho = join(dir, a.url);
    if (!existsSync(caminho)) {
      itens.push(item(`hash:${a.url}`, false, `${a.url} listado no yml mas ausente em ${dir}`));
      continue;
    }
    const tamanho = statSync(caminho).size;
    if (tamanho !== a.size) {
      itens.push(item(`hash:${a.url}`, false, `${a.url}: tamanho ${tamanho} difere do yml (${a.size})`));
      continue;
    }
    const real = await sha512Base64(caminho);
    itens.push(real === a.sha512 ? item(`hash:${a.url}`, true, `${a.url}: sha512 confere`) : item(`hash:${a.url}`, false, `${a.url}: sha512 difere do yml`));
  }
  return { itens, latest };
}

/** `.blockmap` do electron-builder: gzip de JSON; a soma de `sizes` tem de ser o tamanho do arquivo. */
export function conferirBlockmap(arquivo, blockmap) {
  const id = `blockmap:${arquivo.split("/").pop()}`;
  if (!existsSync(blockmap)) return item(id, false, `${blockmap.split("/").pop()} ausente`);
  try {
    const j = JSON.parse(gunzipSync(readFileSync(blockmap)).toString("utf8"));
    const f = j.files?.[0];
    if (!f || !Array.isArray(f.sizes) || !Array.isArray(f.checksums) || f.sizes.length !== f.checksums.length) return item(id, false, "blockmap incoerente (sizes/checksums)");
    const soma = f.sizes.reduce((a, c) => a + c, 0);
    const tam = statSync(arquivo).size;
    return soma === tam ? item(id, true, "blockmap coerente com o arquivo") : item(id, false, `blockmap soma ${soma} bytes, arquivo tem ${tam}`);
  } catch (e) {
    return item(id, false, `blockmap ilegível (${e.message})`);
  }
}

/** Parser mínimo de plist XML (dict, array, string, true/false, integer, real). Não executa nada. */
export function parsePlistXml(texto) {
  const dec = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const corpo = texto.replace(/<\?xml[^>]*\?>/g, "").replace(/<!DOCTYPE[^>]*>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  const re = /<(\/?)([A-Za-z]+)\s*(\/?)>|([^<]+)/g;
  const toks = [];
  let m;
  while ((m = re.exec(corpo)) !== null) {
    if (m[4] !== undefined) {
      if (m[4].trim() !== "") toks.push({ t: "texto", v: m[4] });
    } else toks.push({ t: m[1] ? "fim" : m[3] ? "vazio" : "ini", n: m[2] });
  }
  let i = 0;
  const valor = () => {
    const tk = toks[i++];
    if (!tk) throw new Error("plist truncado");
    if (tk.t === "vazio") {
      if (tk.n === "true") return true;
      if (tk.n === "false") return false;
      return tk.n === "dict" ? {} : tk.n === "array" ? [] : "";
    }
    if (tk.n === "dict") {
      const o = {};
      while (toks[i] && !(toks[i].t === "fim" && toks[i].n === "dict")) {
        const k = toks[i++];
        if (k.n !== "key") throw new Error("plist: esperava <key>");
        const chave = toks[i].t === "texto" ? dec(toks[i++].v) : "";
        i++; // </key>
        o[chave] = valor();
      }
      i++;
      return o;
    }
    if (tk.n === "array") {
      const a = [];
      while (toks[i] && !(toks[i].t === "fim" && toks[i].n === "array")) a.push(valor());
      i++;
      return a;
    }
    let v = "";
    if (toks[i] && toks[i].t === "texto") v = dec(toks[i++].v);
    i++; // fecha
    if (tk.n === "integer" || tk.n === "real") return Number(v);
    return v;
  };
  while (toks[i] && toks[i].n !== "dict" && toks[i].n !== "array") i++;
  return valor();
}

/** Plist XML ou binário (este via `plutil -convert json`). */
export function lerPlist(arquivo, { plutil = "plutil" } = {}) {
  const buf = readFileSync(arquivo);
  if (buf.subarray(0, 6).toString("latin1") === "bplist") {
    const r = spawnSync(plutil, ["-convert", "json", "-o", "-", arquivo], { encoding: "utf8" });
    if (r.status !== 0) throw new Error("plist binário e `plutil` indisponível");
    return JSON.parse(r.stdout);
  }
  return parsePlistXml(buf.toString("utf8"));
}

export function conferirInfoPlist(plist, { appId, versao }) {
  const itens = [];
  const id = plist.CFBundleIdentifier;
  itens.push(id === appId ? item("plist:CFBundleIdentifier", true, `CFBundleIdentifier = ${id}`) : item("plist:CFBundleIdentifier", false, `CFBundleIdentifier "${id}" difere do appId do produto (${appId})`));
  const v = plist.CFBundleShortVersionString;
  itens.push(v === versao ? item("plist:versao", true, `versão ${v}`) : item("plist:versao", false, `versão "${v}" difere de package.json (${versao})`));
  itens.push(typeof plist.LSMinimumSystemVersion === "string" && plist.LSMinimumSystemVersion !== "" ? item("plist:LSMinimumSystemVersion", true, `LSMinimumSystemVersion = ${plist.LSMinimumSystemVersion}`) : item("plist:LSMinimumSystemVersion", false, "LSMinimumSystemVersion ausente"));
  itens.push(typeof plist.NSMicrophoneUsageDescription === "string" && plist.NSMicrophoneUsageDescription.trim() !== "" ? item("plist:NSMicrophoneUsageDescription", true, "NSMicrophoneUsageDescription presente") : item("plist:NSMicrophoneUsageDescription", false, "NSMicrophoneUsageDescription ausente"));
  return itens;
}

/** `lipo -archs <arquivo>` -> lista (ou null se falhar). */
export function arquiteturas(arquivo, lipo = "lipo") {
  const r = spawnSync(lipo, ["-archs", arquivo], { encoding: "utf8" });
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim().split(/\s+/).filter(Boolean);
}

function achar(pasta, pred, limite = 5000, saida = []) {
  let entradas;
  try {
    entradas = readdirSync(pasta, { withFileTypes: true });
  } catch {
    return saida;
  }
  for (const e of entradas) {
    const c = join(pasta, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) achar(c, pred, limite, saida);
    else if (pred(e.name, c)) saida.push(c);
    if (saida.length >= limite) break;
  }
  return saida;
}

/** Confere o `.app` já visível (montado ou fixture): plist, executável e node-pty universais. */
export function conferirApp(app, { appId, versao, ferramentas = {} }) {
  const itens = [];
  const lipo = ferramentas.lipo ?? "lipo";
  const plistCaminho = join(app, "Contents", "Info.plist");
  if (!existsSync(plistCaminho)) return [item("app:Info.plist", false, "Contents/Info.plist ausente")];
  let plist;
  try {
    plist = lerPlist(plistCaminho, { plutil: ferramentas.plutil ?? "plutil" });
  } catch (e) {
    return [item("app:Info.plist", false, `Info.plist inválido (${e.message})`)];
  }
  itens.push(...conferirInfoPlist(plist, { appId, versao }));
  const exe = join(app, "Contents", "MacOS", String(plist.CFBundleExecutable ?? ""));
  if (!plist.CFBundleExecutable || !existsSync(exe)) {
    itens.push(item("arch:executavel", false, "executável principal ausente"));
  } else {
    const a = arquiteturas(exe, lipo);
    const falta = a === null ? ARQUITETURAS_MAC : ARQUITETURAS_MAC.filter((x) => !a.includes(x));
    itens.push(falta.length === 0 ? item("arch:executavel", true, `executável: ${a.join(" ")}`) : item("arch:executavel", false, a === null ? "executável: lipo falhou" : `executável sem ${falta.join(", ")} (tem: ${a.join(" ")})`));
  }
  const pty = join(app, "Contents", "Resources", "app.asar.unpacked", "node_modules", "node-pty");
  const nativos = existsSync(pty) ? achar(pty, (n) => n.endsWith(".node")) : [];
  if (nativos.length === 0) {
    itens.push(item("arch:node-pty", false, "node-pty: nenhum .node em app.asar.unpacked"));
  } else {
    // os prebuilds do node-pty são finos (um por arquitetura): a UNIÃO precisa cobrir as duas.
    const todas = new Set();
    let ilegivel = null;
    for (const n of nativos) {
      const a = arquiteturas(n, lipo);
      if (a === null) ilegivel = n;
      else a.forEach((x) => todas.add(x));
    }
    const falta = ARQUITETURAS_MAC.filter((x) => !todas.has(x));
    itens.push(ilegivel ? item("arch:node-pty", false, `node-pty: lipo falhou em ${ilegivel.slice(app.length + 1)}`) : falta.length === 0 ? item("arch:node-pty", true, `node-pty: ${[...todas].join(" ")}`) : item("arch:node-pty", false, `node-pty sem ${falta.join(", ")} (tem: ${[...todas].join(" ") || "nenhuma"})`));
  }
  return itens;
}

/** Monta o DMG somente leitura, executa `fn(pontoDeMontagem)` e desmonta SEMPRE. */
export async function comDmgMontado(dmg, hdiutil, fn) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "instaladores-")));
  const montados = [];
  try {
    const r = spawnSync(hdiutil, ["attach", "-readonly", "-nobrowse", "-noverify", "-noautoopen", "-mountrandom", base, dmg], { encoding: "utf8", input: "Y\n", timeout: 120000 });
    for (const linha of (r.stdout ?? "").split("\n")) {
      const campos = linha.split("\t").map((c) => c.trim());
      const dev = campos[0]?.startsWith("/dev/") ? campos[0] : null;
      const mp = campos.find((c) => c.startsWith(base));
      if (mp) montados.push({ mp, dev });
      else if (dev && campos.length > 1 && linha.includes(base)) montados.push({ mp: null, dev });
    }
    if (r.error || r.status !== 0 || montados.length === 0) {
      return { erro: `DMG não monta (${(r.stderr ?? r.error?.message ?? "").trim().split("\n")[0] || `código ${r.status}`})` };
    }
    return { valor: await fn(montados[0].mp) };
  } finally {
    for (const { mp, dev } of montados) {
      let d = mp ? spawnSync(hdiutil, ["detach", mp, "-force"], { encoding: "utf8", timeout: 60000 }) : { status: 1 };
      if (d.status !== 0 && dev) d = spawnSync(hdiutil, ["detach", dev, "-force"], { encoding: "utf8", timeout: 60000 });
    }
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      /* ponto ainda ocupado: nunca apagar recursivamente um volume montado */
    }
  }
}

export function verificarZip(zip, unzip = "unzip") {
  const id = `zip:${zip.split("/").pop()}`;
  if (!ferramentaExiste(unzip)) return pulado(id, "`unzip` indisponível");
  const r = spawnSync(unzip, ["-tq", zip], { encoding: "utf8", timeout: 120000, maxBuffer: 1 << 24 });
  return r.status === 0 ? item(id, true, "unzip -t íntegro") : item(id, false, `ZIP corrompido (unzip -t código ${r.status})`);
}

function artefatos(dir, ext) {
  try {
    return readdirSync(dir).filter((n) => n.endsWith(ext)).sort();
  } catch {
    return [];
  }
}

function conferirTamanhos(dir, nomes, limiteMb) {
  return nomes.map((n) => {
    const t = statSync(join(dir, n)).size;
    return t <= limiteMb * 1024 * 1024 ? item(`tamanho:${n}`, true, `${n}: ${mb(t)} MB (teto ${limiteMb} MB)`) : item(`tamanho:${n}`, false, `${n}: ${mb(t)} MB excede o teto de ${limiteMb} MB`);
  });
}

/** Parte macOS: DMG + ZIP + latest-mac.yml. */
export async function verificarMac({ dir, produto, versao, ferramentas = {}, limiteMb = LIMITE_MB_PADRAO }) {
  const itens = [];
  const dmgs = artefatos(dir, ".dmg");
  const zips = artefatos(dir, ".zip");
  if (dmgs.length === 0) itens.push(item("artefato:dmg", false, `nenhum .dmg em ${dir}`));
  if (zips.length === 0) itens.push(item("artefato:zip", false, `nenhum .zip em ${dir}`));
  const yml = join(dir, "latest-mac.yml");
  if (!existsSync(yml)) itens.push(item("hash", false, "latest-mac.yml ausente"));
  else {
    const { itens: h, latest } = await conferirHashes(dir, yml, { exigir: [...dmgs, ...zips] });
    itens.push(...h);
    if (latest && latest.version !== versao) itens.push(item("yml:versao", false, `latest-mac.yml: versão ${latest.version} difere de package.json (${versao})`));
  }
  itens.push(...conferirTamanhos(dir, [...dmgs, ...zips], limiteMb));
  for (const z of zips) itens.push(verificarZip(join(dir, z), ferramentas.unzip ?? "unzip"));
  const hdiutil = ferramentas.hdiutil ?? "hdiutil";
  if (dmgs.length > 0) {
    if (!ferramentaExiste(hdiutil)) itens.push(pulado("dmg:montagem", "`hdiutil` indisponível (só a montagem é pulada; o hash foi conferido)"));
    else {
      const dmg = join(dir, dmgs[0]);
      const r = await comDmgMontado(dmg, hdiutil, (mp) => {
        const apps = readdirSync(mp).filter((n) => n.endsWith(".app"));
        if (apps.length === 0) return [item("dmg:app", false, "nenhum .app dentro do DMG")];
        return conferirApp(join(mp, apps[0]), { appId: produto.appId, versao, ferramentas });
      });
      itens.push(...(r.erro ? [item("dmg:montagem", false, r.erro)] : r.valor));
    }
  }
  return itens;
}

/** Cabeçalho PE: MZ, e_lfanew em 0x3C, assinatura `PE\0\0`. */
export function lerCabecalhoPE(arquivo) {
  const fd = openSync(arquivo, "r");
  try {
    const b = Buffer.alloc(1024);
    const n = readSync(fd, b, 0, 1024, 0);
    if (n < 64 || b[0] !== 0x4d || b[1] !== 0x5a) return { ok: false, motivo: "sem assinatura MZ" };
    const off = b.readUInt32LE(0x3c);
    if (off + 4 > n) return { ok: false, motivo: "e_lfanew fora do cabeçalho" };
    if (b.toString("latin1", off, off + 4) !== "PE\0\0") return { ok: false, motivo: "sem assinatura PE" };
    const opt = off + 24;
    const magic = b.readUInt16LE(opt);
    const dirs = opt + (magic === 0x20b ? 112 : 96);
    // diretório 4 = tabela de certificados (Authenticode): offset de ARQUIVO + tamanho
    const certTamanho = dirs + 4 * 8 + 4 + 4 <= n ? b.readUInt32LE(dirs + 4 * 8 + 4) : 0;
    return { ok: true, maquina: b.readUInt16LE(off + 4), x64: magic === 0x20b, assinado: certTamanho > 0 };
  } finally {
    closeSync(fd);
  }
}

/** Parte Windows (estática, vale em qualquer SO). */
export async function verificarWindows({ dir, produto, versao, limiteMb = LIMITE_MB_PADRAO }) {
  const itens = [];
  const setup = `${produto.nome}-Setup.exe`;
  const exe = join(dir, setup);
  const yml = join(dir, "latest.yml");
  if (!existsSync(exe)) {
    itens.push(item("artefato:setup", false, `${setup} ausente em ${dir} (nome derivado de produto.ts)`));
  } else {
    const t = statSync(exe).size;
    itens.push(t > 0 ? item("tamanho:setup", true, `${setup}: ${mb(t)} MB`) : item("tamanho:setup", false, `${setup} vazio`));
    itens.push(...conferirTamanhos(dir, [setup], limiteMb).filter((i) => !i.ok));
    const pe = lerCabecalhoPE(exe);
    itens.push(pe.ok ? item("pe:cabecalho", true, `${setup}: cabeçalho PE válido (${pe.x64 ? "x64" : "x86"}, ${pe.assinado ? "com" : "sem"} tabela de certificado)`, { assinado: pe.assinado }) : item("pe:cabecalho", false, `${setup}: cabeçalho PE inválido (${pe.motivo})`));
    itens.push(conferirBlockmap(exe, `${exe}.blockmap`));
  }
  if (!existsSync(yml)) itens.push(item("hash", false, "latest.yml ausente"));
  else {
    const { itens: h, latest } = await conferirHashes(dir, yml, { exigir: [setup] });
    itens.push(...h);
    if (latest && latest.version !== versao) itens.push(item("yml:versao", false, `latest.yml: versão ${latest.version} difere de package.json (${versao})`));
  }
  for (const [id, m] of [["instalacao-silenciosa", "instalação silenciosa (/S /D=) em diretório temporário"], ["test-pacote-instalado", "`test:pacote` sobre a pasta instalada"], ["desinstalacao", "desinstalação silenciosa e %APPDATA% do produto preservado"]]) {
    itens.push({ id: `ci-windows:${id}`, ok: true, pulado: true, mensagem: `[CI-Windows] ${m}` });
  }
  return itens;
}

export function resumo(itens) {
  const falhas = itens.filter((i) => !i.ok);
  return { ok: falhas.length === 0, falhas: falhas.map((f) => f.mensagem), total: itens.length, pulados: itens.filter((i) => i.pulado).length };
}
