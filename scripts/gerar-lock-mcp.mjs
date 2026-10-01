#!/usr/bin/env node
// Gera os locks e hashes do catálogo da Loja de MCPs (Fase 7B, T-07B.33). MANUAL: a execução real (rede, só
// leitura em npm/PyPI) só acontece com `--executar`, quando o dono mandar (P-131). Sem a flag é `--dry-run`:
// não faz rede, não escreve nada, só lista o que faria. Fora do `npm run verificar`.
//
// Para cada entrada npm/uvx CONFIRMADA do seed: consulta o registro (GET), confere a integridade do seed contra a
// do registro (divergiu ⇒ erro e nada é gerado para ela), gera `locks/<id>.package-lock.json` (npm) ou
// `locks/<id>.requirements.txt` com hashes (PyPI), preenche `lock_sha256` e escreve o relatório.
// Determinístico: rodar duas vezes dá os mesmos hashes e o mesmo relatório (sem datas, ordem por id).
//
// Uso: node scripts/gerar-lock-mcp.mjs [--executar] [--atualizar-seed] [--id <id>]... [--seed <arq>] [--locks <pasta>]
//        [--relatorio <arq>] [--seed-embarcado <arq>] [--registro-npm <url>] [--registro-pypi <url>]

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REGISTRO_NPM_PADRAO = "https://registry.npmjs.org";
export const REGISTRO_PYPI_PADRAO = "https://pypi.org";
const TIMEOUT_REDE_MS = 15000;

const sha256 = (texto) => createHash("sha256").update(texto).digest("hex");
const paraJson = (o) => `${JSON.stringify(o, null, 2)}\n`;

/** `@escopo/nome` → `@escopo%2Fnome` (formato do registro npm). */
export const nomeNpmNaUrl = (pacote) => pacote.replace("/", "%2F");

/** argv do `npm` que resolve o lock sem instalar nada e sem scripts (só lê o registro). */
export function argvNpmLock({ pacote, versao, registro, dir }) {
  return ["install", "--package-lock-only", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--save-exact",
    "--registry", registro, "--prefix", dir, `${pacote}@${versao}`];
}

/** argv do `uv` que compila os requisitos com hashes (só lê o índice). */
export function argvUvCompile({ entrada, saida, registro }) {
  return ["pip", "compile", "--generate-hashes", "--no-header", "--no-annotate", "--index-url", `${registro.replace(/\/$/, "")}/simple`, "--output-file", saida, entrada];
}

function rodar(exe, args, { cwd, env }) {
  return new Promise((ok, falha) => {
    const filho = spawn(exe, args, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let erro = "";
    filho.stderr.on("data", (d) => { if (erro.length < 4000) erro += d; });
    filho.on("error", (e) => falha(Object.assign(new Error(e.code === "ENOENT" ? `${exe} não encontrado` : e.message), { codigo: e.code === "ENOENT" ? "pre_requisito_ausente" : "falha" })));
    filho.on("close", (codigo) => (codigo === 0 ? ok() : falha(Object.assign(new Error(`${exe} saiu com código ${codigo}: ${erro.slice(0, 300)}`), { codigo: "falha" }))));
  });
}

/** Ambiente mínimo para npm/uv: nada herdado (sem NPM_TOKEN, sem configuração do usuário). */
function ambienteMinimoDe(tmp) {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmp, TMPDIR: tmp,
    npm_config_userconfig: join(tmp, ".npmrc-vazio"), npm_config_globalconfig: join(tmp, ".npmrc-global-vazio"),
    npm_config_cache: join(tmp, "cache-npm"), UV_CACHE_DIR: join(tmp, "cache-uv"), UV_NO_CONFIG: "1",
  };
}

/** Executor padrão do lock npm: `npm install --package-lock-only` numa pasta temporária. */
export async function executorNpmPadrao({ pacote, versao, registro, id }) {
  const tmp = mkdtempSync(join(tmpdir(), `lock-mcp-${id}-`));
  try {
    writeFileSync(join(tmp, "package.json"), paraJson({ name: `mcp-${id}`, version: "0.0.0", private: true }));
    writeFileSync(join(tmp, ".npmrc-vazio"), "");
    writeFileSync(join(tmp, ".npmrc-global-vazio"), "");
    await rodar("npm", argvNpmLock({ pacote, versao, registro, dir: tmp }), { cwd: tmp, env: ambienteMinimoDe(tmp) });
    return readFileSync(join(tmp, "package-lock.json"), "utf8");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Executor padrão do lock PyPI: `uv pip compile --generate-hashes`. */
export async function executorPythonPadrao({ pacote, versao, registro, id }) {
  const tmp = mkdtempSync(join(tmpdir(), `lock-mcp-${id}-`));
  try {
    const entrada = join(tmp, "requirements.in");
    const saida = join(tmp, "requirements.txt");
    writeFileSync(entrada, `${pacote}==${versao}\n`);
    await rodar("uv", argvUvCompile({ entrada, saida, registro }), { cwd: tmp, env: ambienteMinimoDe(tmp) });
    return readFileSync(saida, "utf8");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Normaliza o package-lock para ser reprodutível (nome raiz fixo). */
export function normalizarLockNpm(texto, id) {
  const lock = JSON.parse(texto);
  lock.name = `mcp-${id}`;
  if (lock.packages?.[""]) lock.packages[""].name = `mcp-${id}`;
  return paraJson(lock);
}

async function obterJson(fetchImpl, url) {
  const r = await fetchImpl(url, { method: "GET", headers: { accept: "application/json", "user-agent": "loja-mcp-gerar-lock" }, signal: AbortSignal.timeout(TIMEOUT_REDE_MS) });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} em ${url}`), { codigo: "registro_http" });
  return r.json();
}

const eInstalavelComLock = (e) => e.confirmado === true && e.classificacao !== "descartado" && (e.instalacao?.metodo === "npm" || e.instalacao?.metodo === "uvx");

/**
 * Núcleo do script (injetável para teste). `executar=false` (padrão) = dry-run: sem rede, sem escrita.
 * @param {object} o
 */
export async function gerarLocks(o) {
  const executar = o.executar === true;
  const fetchImpl = o.fetch ?? globalThis.fetch;
  const registroNpm = (o.registroNpm ?? REGISTRO_NPM_PADRAO).replace(/\/$/, "");
  const registroPypi = (o.registroPypi ?? REGISTRO_PYPI_PADRAO).replace(/\/$/, "");
  const executorNpm = o.executorNpm ?? executorNpmPadrao;
  const executorPython = o.executorPython ?? executorPythonPadrao;
  const seed = JSON.parse(readFileSync(o.seed, "utf8"));
  const ids = o.ids && o.ids.length > 0 ? new Set(o.ids) : null;
  const alvos = seed.entradas.filter((e) => eInstalavelComLock(e) && (!ids || ids.has(e.id))).sort((a, b) => a.id.localeCompare(b.id));
  const itens = [];

  for (const e of alvos) {
    const i = e.instalacao;
    const npm = i.metodo === "npm";
    const arquivo = npm ? `${e.id}.package-lock.json` : `${e.id}.requirements.txt`;
    const urlRegistro = npm ? `${registroNpm}/${nomeNpmNaUrl(i.pacote)}/${i.versao}` : `${registroPypi}/pypi/${i.pacote}/${i.versao}/json`;
    const base = { id: e.id, metodo: i.metodo, pacote: i.pacote, versao: i.versao, arquivo, url_registro: urlRegistro, lock_sha256: null, integridade: "nao_conferida" };
    if (!executar) { itens.push({ ...base, status: "dry_run", detalhe: `faria: GET ${urlRegistro}; gerar ${arquivo} com ${npm ? "npm install --package-lock-only --ignore-scripts" : "uv pip compile --generate-hashes"}` }); continue; }
    try {
      const meta = await obterJson(fetchImpl, urlRegistro);
      let integridadeOk;
      if (npm) integridadeOk = meta?.dist?.integrity === i.integridade;
      else integridadeOk = Array.isArray(meta?.urls) && meta.urls.some((u) => `sha256:${u?.digests?.sha256}` === i.integridade);
      if (!integridadeOk) { itens.push({ ...base, integridade: "divergente", status: "erro", detalhe: "integridade_divergente: a do seed difere da do registro; nada foi gerado" }); continue; }
      const bruto = npm ? await executorNpm({ pacote: i.pacote, versao: i.versao, registro: registroNpm, id: e.id }) : await executorPython({ pacote: i.pacote, versao: i.versao, registro: registroPypi, id: e.id });
      const texto = npm ? normalizarLockNpm(bruto, e.id) : (bruto.endsWith("\n") ? bruto : `${bruto}\n`);
      if (!npm && !/--hash=sha256:/.test(texto)) { itens.push({ ...base, integridade: "ok", status: "erro", detalhe: "requirements sem hashes" }); continue; }
      itens.push({ ...base, integridade: "ok", status: "gerado", detalhe: "ok", lock_sha256: sha256(texto), texto });
    } catch (erro) {
      itens.push({ ...base, status: "erro", detalhe: `${erro?.codigo ?? "falha"}: ${String(erro?.message ?? erro).slice(0, 200)}` });
    }
  }

  const relatorio = montarRelatorio(seed, itens, executar);
  let seedAtualizado = null;
  if (executar) {
    mkdirSync(o.locks, { recursive: true });
    for (const item of itens) if (item.status === "gerado") { writeFileSync(join(o.locks, item.arquivo), item.texto); }
    if (o.relatorio) { mkdirSync(dirname(o.relatorio), { recursive: true }); writeFileSync(o.relatorio, relatorio); }
    if (o.atualizarSeed) {
      seedAtualizado = JSON.parse(JSON.stringify(seed));
      for (const item of itens) {
        if (item.status !== "gerado") continue;
        seedAtualizado.entradas.find((x) => x.id === item.id).instalacao.lock_sha256 = item.lock_sha256;
      }
      const texto = paraJson(seedAtualizado);
      writeFileSync(o.seed, texto);
      if (o.seedEmbarcado) { mkdirSync(dirname(o.seedEmbarcado), { recursive: true }); writeFileSync(o.seedEmbarcado, texto); }
    }
  }
  return { executou: executar, itens: itens.map(({ texto, ...resto }) => resto), relatorio, seedAtualizado };
}

function montarRelatorio(seed, itens, executar) {
  const linhas = [
    "# Relatório de locks do catálogo de MCPs",
    "",
    `Seed: \`${seed.seed_versao ?? "?"}\` · modo: ${executar ? "execução (rede só de leitura em npm/PyPI)" : "dry-run (nada foi consultado nem gravado)"}.`,
    "",
    "| id | método | pacote@versão | integridade | status | lock_sha256 |",
    "|---|---|---|---|---|---|",
    ...itens.map((x) => `| ${x.id} | ${x.metodo} | ${x.pacote}@${x.versao} | ${x.integridade} | ${x.status === "erro" ? `erro: ${x.detalhe}` : x.status} | ${x.lock_sha256 ?? "—"} |`),
    "",
    `Total: ${itens.length} · gerados: ${itens.filter((x) => x.status === "gerado").length} · erros: ${itens.filter((x) => x.status === "erro").length}.`,
    "",
  ];
  return linhas.join("\n");
}

export function lerArgumentos(argv) {
  const o = { ids: [], executar: false, atualizarSeed: false, ajuda: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const valor = () => { const v = argv[++i]; if (v === undefined) throw new Error(`falta valor para ${a}`); return v; };
    if (a === "--executar") o.executar = true;
    else if (a === "--dry-run") o.executar = false;
    else if (a === "--atualizar-seed") o.atualizarSeed = true;
    else if (a === "--ajuda" || a === "-h") o.ajuda = true;
    else if (a === "--id") o.ids.push(valor());
    else if (a === "--seed") o.seed = resolve(valor());
    else if (a === "--locks") o.locks = resolve(valor());
    else if (a === "--relatorio") o.relatorio = resolve(valor());
    else if (a === "--seed-embarcado") o.seedEmbarcado = resolve(valor());
    else if (a === "--registro-npm") o.registroNpm = valor();
    else if (a === "--registro-pypi") o.registroPypi = valor();
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  o.seed ??= join(RAIZ, "docs", "ade", "base", "catalogo-mcps.seed.json");
  o.locks ??= join(RAIZ, "resources", "mcp", "locks");
  o.relatorio ??= join(RAIZ, "docs", "ade", "base", "catalogo-mcps.relatorio-lock.md");
  o.seedEmbarcado ??= join(RAIZ, "resources", "mcp", "catalogo-mcps.json");
  return o;
}

const AJUDA = `gerar-lock-mcp: gera locks e hashes do catálogo da Loja de MCPs.
  (padrão)           dry-run: lista o que faria, sem rede e sem escrever nada
  --executar         consulta npm/PyPI (só leitura) e grava locks e relatório
  --atualizar-seed   com --executar: grava lock_sha256 no seed e na cópia embarcada
  --id <id>          limita a um servidor (repetível)
  --seed/--locks/--relatorio/--seed-embarcado/--registro-npm/--registro-pypi  caminhos e registros alternativos
`;

async function principal() {
  const o = lerArgumentos(process.argv.slice(2));
  if (o.ajuda) { process.stdout.write(AJUDA); return; }
  if (!existsSync(o.seed)) throw new Error(`seed não encontrado: ${o.seed}`);
  const r = await gerarLocks(o);
  process.stdout.write(r.relatorio);
  if (r.itens.some((x) => x.status === "erro")) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); });
}
