// T-21.24: auditoria de dependências (licenças, registro, SBOM CycloneDX 1.5 e `npm audit` informativo). Sem rede por padrão; o executor do audit é injetável.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const LICENCAS_PERMITIDAS = Object.freeze([
  "MIT", "MIT-0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "MPL-2.0",
  "BlueOak-1.0.0", "CC0-1.0", "Unlicense", "Python-2.0", "CC-BY-4.0",
]);
/**
 * Exceções de licença, por `nome@versão`, SÓ para dependência de DESENVOLVIMENTO (não vai no pacote). WTFPL é permissiva, mas sem texto jurídico padrão:
 * aceita apenas onde nada é redistribuído (D-380). Exceção para dependência de produção é sempre achado.
 */
export const EXCECOES_LICENCA_DEV = Object.freeze({
  "truncate-utf8-bytes@1.0.2": "WTFPL; só de build (electron-builder → sanitize-filename), não entra no pacote",
});
export const ARQUIVO_BASE = "scripts/lib/dependencias-registradas.json";
export const ARQUIVO_DECISOES = "docs/ade/01-DECISOES.md";

/** Nome do pacote a partir do caminho do lock (`node_modules/a/node_modules/@s/b` => `@s/b`). */
export function nomeDoCaminho(caminho) {
  const i = caminho.lastIndexOf("node_modules/");
  return i < 0 ? caminho : caminho.slice(i + "node_modules/".length);
}

/** Lista pacotes do lock (v2/v3), sem a raiz. */
export function pacotesDoLock(lock) {
  const saida = [];
  for (const [caminho, p] of Object.entries(lock?.packages ?? {})) {
    if (caminho === "") continue;
    saida.push({ caminho, nome: p.name ?? nomeDoCaminho(caminho), versao: p.version ?? "0.0.0", licenca: licencaDe(p), integridade: p.integrity ?? null, dev: p.dev === true, link: p.link === true });
  }
  return saida.sort((a, b) => (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0));
}

function licencaDe(p) {
  const l = p.license;
  if (typeof l === "string") return l;
  if (l && typeof l === "object" && typeof l.type === "string") return l.type;
  if (Array.isArray(l)) return l.map((x) => (typeof x === "string" ? x : x?.type)).filter(Boolean).join(" OR ") || null;
  return null;
}

/** Uma expressão SPDX é aceita se, com `OR`, ao menos uma alternativa for permitida; com `AND`, todas. */
export function licencaPermitida(expr, permitidas = LICENCAS_PERMITIDAS) {
  if (typeof expr !== "string" || !expr.trim()) return false;
  const ok = new Set(permitidas);
  const avaliar = (t) => {
    const ors = splitNivel(t, "OR");
    if (ors.length > 1) return ors.some(avaliar);
    const ands = splitNivel(t, "AND");
    if (ands.length > 1) return ands.every(avaliar);
    t = t.trim();
    if (t.startsWith("(") && t.endsWith(")")) return avaliar(t.slice(1, -1));
    return ok.has(t.replace(/\+$/, ""));
  };
  return avaliar(expr);
}
function splitNivel(t, op) {
  const partes = [];
  let prof = 0, atual = "";
  for (const tok of t.split(/(\s+|\(|\))/)) {
    if (tok === "(") prof++;
    else if (tok === ")") prof--;
    if (prof === 0 && tok === op) { partes.push(atual); atual = ""; continue; }
    atual += tok;
  }
  partes.push(atual);
  return partes.length > 1 ? partes : [t];
}

/** Pacotes (não `link`) com licença ausente ou fora da lista. */
export function auditarLicencas(lock, permitidas = LICENCAS_PERMITIDAS) {
  return pacotesDoLock(lock)
    .filter((p) => !p.link && !licencaPermitida(p.licenca, permitidas) && !(p.dev === true && `${p.nome}@${p.versao}` in EXCECOES_LICENCA_DEV))
    .map((p) => ({ pacote: p.nome, versao: p.versao, caminho: p.caminho, licenca: p.licenca ?? "(ausente)" }));
}

/** Dependências diretas do package.json fora da base e sem citação em 01-DECISOES.md. */
export function auditarRegistro(pkg, base, textoDecisoes) {
  const registradas = new Set(base?.dependencias ?? []);
  const nomes = nomesDiretos(pkg);
  return nomes.filter((n) => !registradas.has(n) && !(textoDecisoes ?? "").includes(n)).map((pacote) => ({ pacote }));
}
export function nomesDiretos(pkg) {
  return [...new Set([...Object.keys(pkg?.dependencies ?? {}), ...Object.keys(pkg?.devDependencies ?? {}), ...Object.keys(pkg?.optionalDependencies ?? {})])].sort();
}
export function gerarBase(pkg) {
  return { versao: 1, dependencias: nomesDiretos(pkg) };
}

const purl = (nome, versao) => `pkg:npm/${nome.startsWith("@") ? `%40${nome.slice(1)}` : nome}@${versao}`;

/** SBOM CycloneDX 1.5 determinístico (sem data nem UUID aleatório) a partir do lock. */
export function gerarSbom(lock, { nome = "app", versao = "0.0.0" } = {}) {
  const pacotes = pacotesDoLock(lock);
  const raiz = lock?.packages?.[""] ?? {};
  const componentes = pacotes.map((p) => {
    const c = { type: "library", "bom-ref": `${p.caminho}@${p.versao}`, name: p.nome, version: p.versao, purl: purl(p.nome, p.versao), scope: p.dev ? "optional" : "required" };
    if (p.licenca) c.licenses = [{ expression: p.licenca }];
    if (p.integridade) {
      const m = /^(sha512|sha384|sha256|sha1)-(.+)$/.exec(p.integridade);
      if (m) c.hashes = [{ alg: { sha512: "SHA-512", sha384: "SHA-384", sha256: "SHA-256", sha1: "SHA-1" }[m[1]], content: Buffer.from(m[2], "base64").toString("hex") }];
    }
    return c;
  });
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: { component: { type: "application", "bom-ref": "raiz", name: raiz.name ?? nome, version: raiz.version ?? versao } },
    components: componentes,
  };
}

/** Confere o SBOM: estrutura mínima e componentes == pacotes do lock. */
export function validarSbom(sbom, lock) {
  const erros = [];
  if (sbom?.bomFormat !== "CycloneDX") erros.push("bomFormat deve ser CycloneDX");
  if (sbom?.specVersion !== "1.5") erros.push("specVersion deve ser 1.5");
  if (!Array.isArray(sbom?.components)) return [...erros, "components ausente"];
  const refs = sbom.components.map((c) => c["bom-ref"]);
  if (new Set(refs).size !== refs.length) erros.push("bom-ref duplicado");
  const esperado = pacotesDoLock(lock).map((p) => `${p.caminho}@${p.versao}`).sort();
  const obtido = [...refs].sort();
  if (esperado.length !== obtido.length || esperado.some((e, i) => e !== obtido[i])) erros.push(`componentes (${obtido.length}) diferem dos pacotes do lock (${esperado.length})`);
  return erros;
}

/** `npm audit` informativo: nunca "ok" sem resposta real. `executor()` devolve `{ codigo, saida, erro? }`. */
export function resumirAudit(resultado) {
  const naoExecutado = (motivo) => ({ estado: "não executado", motivo });
  if (!resultado || resultado.erro) return naoExecutado(String(resultado?.erro ?? "sem resultado"));
  let json;
  try { json = JSON.parse(resultado.saida ?? ""); } catch { return naoExecutado("saída inválida do npm audit"); }
  if (json?.error || !json?.metadata?.vulnerabilities) return naoExecutado(json?.error?.summary ?? "sem metadados de vulnerabilidade");
  const v = json.metadata.vulnerabilities;
  const total = ["info", "low", "moderate", "high", "critical"].reduce((s, k) => s + (v[k] ?? 0), 0);
  return { estado: total === 0 ? "ok" : "vulnerabilidades", vulnerabilidades: v, total };
}
export function executarAudit(executor) {
  let r;
  try { r = executor(); } catch (e) { r = { erro: e instanceof Error ? e.message : String(e) }; }
  return resumirAudit(r);
}

/** Orquestra tudo para uma raiz. Não grava nada. */
export function auditar(raiz, { executorAudit = null, permitidas = LICENCAS_PERMITIDAS } = {}) {
  const lock = JSON.parse(readFileSync(join(raiz, "package-lock.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
  const arqBase = join(raiz, ARQUIVO_BASE);
  const arqDec = join(raiz, ARQUIVO_DECISOES);
  const base = existsSync(arqBase) ? JSON.parse(readFileSync(arqBase, "utf8")) : { dependencias: [] };
  const decisoes = existsSync(arqDec) ? readFileSync(arqDec, "utf8") : "";
  const sbom = gerarSbom(lock, { nome: pkg.name, versao: pkg.version });
  return {
    pacotes: pacotesDoLock(lock).length,
    licencasForaDaLista: auditarLicencas(lock, permitidas),
    semRegistro: auditarRegistro(pkg, base, decisoes),
    sbom,
    errosSbom: validarSbom(sbom, lock),
    audit: executorAudit ? executarAudit(executorAudit) : { estado: "não executado", motivo: "desligado" },
  };
}

export function falhas(r) {
  return [
    ...r.licencasForaDaLista.map((x) => `licença fora da lista: ${x.pacote}@${x.versao} (${x.licenca})`),
    ...r.semRegistro.map((x) => `dependência sem registro em ${ARQUIVO_DECISOES}: ${x.pacote}`),
    ...r.errosSbom.map((e) => `SBOM inválido: ${e}`),
  ];
}
