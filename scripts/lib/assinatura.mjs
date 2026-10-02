// Assinatura, notarização e verificação de binários (T-21.10, T-21.11; AU-08, AU-20, AU-21; D-345).
// Regras: só NOMES de variável aparecem em qualquer saída; valores jamais; ferramentas externas por caminho injetável.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { arquiteturas, lerCabecalhoPE, parsePlistXml } from "./instaladores.mjs";

/** Capacidades de assinatura. Cada capacidade é satisfeita por UMA das alternativas (todas as variáveis dela presentes). */
export function capacidades(prefixoEnv) {
  return [
    { id: "mac-assinatura", nome: "macOS: assinatura (Developer ID)", alternativas: [["CSC_LINK", "CSC_KEY_PASSWORD"]] },
    { id: "mac-notarizacao", nome: "macOS: notarização", alternativas: [["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"], ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]] },
    { id: "win-assinatura", nome: "Windows: assinatura (certificado ou Azure Trusted Signing)", alternativas: [["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"], ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"]] },
    { id: "manifesto", nome: "Manifesto de atualização: chave privada", alternativas: [[`${prefixoEnv}MANIFESTO_CHAVE_PRIVADA`]] },
  ];
}

const presente = (env, nome) => typeof env[nome] === "string" && env[nome].trim() !== "";

/** Avalia o ambiente. Nunca devolve valores. */
export function avaliarAmbiente(env, prefixoEnv) {
  const linhas = [];
  const faltando = [];
  for (const c of capacidades(prefixoEnv)) {
    c.alternativas.forEach((alt, i) => {
      for (const v of alt) linhas.push({ capacidade: c.alternativas.length > 1 ? `${c.nome} [alternativa ${i + 1}]` : c.nome, variavel: v, presente: presente(env, v) });
    });
    const ok = c.alternativas.some((alt) => alt.every((v) => presente(env, v)));
    if (!ok) {
      // cita a alternativa mais completa (menos nomes faltando)
      const melhor = [...c.alternativas].sort((a, b) => a.filter((v) => !presente(env, v)).length - b.filter((v) => !presente(env, v)).length)[0];
      faltando.push({ capacidade: c.nome, variaveis: melhor.filter((v) => !presente(env, v)) });
    }
  }
  return { linhas, faltando, satisfeito: faltando.length === 0 };
}

export function tabela(linhas) {
  const l1 = Math.max(10, ...linhas.map((l) => l.capacidade.length));
  const l2 = Math.max(8, ...linhas.map((l) => l.variavel.length));
  const f = (a, b, c) => `${a.padEnd(l1)}  ${b.padEnd(l2)}  ${c}`;
  return [f("capacidade", "variável", "presente?"), f("-".repeat(l1), "-".repeat(l2), "---------"), ...linhas.map((l) => f(l.capacidade, l.variavel, l.presente ? "sim" : "não"))].join("\n");
}

/** Variáveis cujo VALOR jamais pode vazar (AU-08). */
export const VARIAVEIS_SECRETAS = ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID", "WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"];

/** Troca por `***` qualquer valor de variável sensível (inclui `AZURE_*` e `*MANIFESTO_CHAVE_PRIVADA`) que apareça no texto. */
export function redigir(texto, env = process.env) {
  let t = String(texto ?? "");
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== "string" || v.length < 4) continue;
    if (VARIAVEIS_SECRETAS.includes(k) || k.startsWith("AZURE_") || k.endsWith("MANIFESTO_CHAVE_PRIVADA")) t = t.split(v).join("***");
  }
  return t;
}

// ---------- binários ----------

const MACHO = new Set(["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"]);

/** `macho` | `pe` | null, lendo só o início do arquivo (magic). */
export function tipoBinario(arquivo) {
  let fd;
  try {
    fd = openSync(arquivo, "r");
    const b = Buffer.alloc(1024);
    const n = readSync(fd, b, 0, 1024, 0);
    if (n < 4) return null;
    const hex = b.subarray(0, 4).toString("hex");
    if (MACHO.has(hex)) {
      // `cafebabe` também é classe Java: em fat o nº de arquiteturas é pequeno
      if (hex === "cafebabe" && n >= 8 && b.readUInt32BE(4) > 30) return null;
      return "macho";
    }
    if (b[0] === 0x4d && b[1] === 0x5a && n >= 64) {
      const off = b.readUInt32LE(0x3c);
      if (off + 4 <= n && b.toString("latin1", off, off + 4) === "PE\0\0") return "pe";
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Todos os Mach-O e PE sob `raiz` (sem seguir symlink; inclui app.asar.unpacked). */
export function listarBinarios(raiz) {
  const saida = [];
  const andar = (pasta) => {
    let es;
    try {
      es = readdirSync(pasta, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of es) {
      const c = join(pasta, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) andar(c);
      else if (e.isFile()) {
        const t = tipoBinario(c);
        if (t) saida.push({ caminho: c, relativo: relative(raiz, c), tipo: t });
      }
    }
  };
  andar(raiz);
  return saida.sort((a, b) => a.relativo.localeCompare(b.relativo));
}

function rodar(exe, args, opcoes = {}) {
  const r = spawnSync(exe, args, { encoding: "utf8", maxBuffer: 1 << 26, timeout: 120000, ...opcoes });
  return { status: r.error ? -1 : r.status, saida: `${r.stdout ?? ""}${r.stderr ?? ""}`, stdout: r.stdout ?? "", ausente: r.error?.code === "ENOENT" };
}

/** Assinatura REAL (identidade com TeamIdentifier). Ad hoc e "não assinado" contam como não assinado. */
export function assinaturaMac(alvo, codesign = "codesign") {
  const r = rodar(codesign, ["-dv", "--verbose=2", alvo]);
  if (r.ausente) return { assinado: false, motivo: "codesign indisponível", ferramentaAusente: true };
  if (r.status !== 0 || /not signed at all/i.test(r.saida)) return { assinado: false, motivo: "não assinado" };
  if (/Signature=adhoc/i.test(r.saida)) return { assinado: false, motivo: "assinatura ad hoc" };
  const team = /TeamIdentifier=(\S+)/.exec(r.saida)?.[1];
  if (!team || team === "not") return { assinado: false, motivo: "sem TeamIdentifier" };
  return { assinado: true, motivo: "assinado" };
}

export function esperadoValido(e) {
  return e === "assinado" || e === "nao_assinado";
}

/**
 * Percorre todo binário do pacote. `esperado`: `assinado` exige assinatura real em todos (aponta os que faltam por caminho);
 * `nao_assinado` exige que nenhum tenha (o pacote local sai sem assinatura real: R1).
 */
export function verificarNativos({ raiz, esperado, ferramentas = {} }) {
  const lipo = ferramentas.lipo ?? "lipo";
  const codesign = ferramentas.codesign ?? "codesign";
  const binarios = listarBinarios(raiz).map((b) => {
    if (b.tipo === "pe") {
      const pe = lerCabecalhoPE(b.caminho);
      return { caminho: b.relativo, tipo: "pe", arquiteturas: pe.ok ? [pe.x64 ? "x64" : "x86"] : [], assinado: pe.ok && pe.assinado === true, detalhe: pe.ok ? (pe.assinado ? "tabela de certificado presente (Authenticode completo: [CI-Windows])" : "sem tabela de certificado") : pe.motivo };
    }
    const a = arquiteturas(b.caminho, lipo);
    const s = assinaturaMac(b.caminho, codesign);
    return { caminho: b.relativo, tipo: "macho", arquiteturas: a ?? [], assinado: s.assinado, detalhe: s.motivo, ...(a === null || a.length === 0 ? { arquiteturaIlegivel: true } : {}) };
  });
  const problemas = [];
  for (const b of binarios) {
    if (b.arquiteturaIlegivel && b.tipo === "macho") problemas.push(`${b.caminho}: arquitetura ilegível`);
    if (esperado === "assinado" && !b.assinado) problemas.push(`${b.caminho}: sem assinatura real (${b.detalhe})`);
    if (esperado === "nao_assinado" && b.assinado) problemas.push(`${b.caminho}: está assinado, mas o esperado era não assinado`);
  }
  const nAssinados = binarios.filter((b) => b.assinado).length;
  return {
    esperado,
    ok: problemas.length === 0 && binarios.length > 0,
    total: binarios.length,
    assinados: nAssinados,
    nao_assinados: binarios.length - nAssinados,
    nota: nAssinados === 0 ? "sem assinatura real: R1" : undefined,
    problemas: binarios.length === 0 ? [`nenhum binário encontrado em ${raiz}`] : problemas,
    binarios,
  };
}

/** Acha `<Nome>.app` em dist-app (mac-universal, mac-arm64, mac...). */
export function localizarApp(raiz, nome) {
  const base = join(raiz, "dist-app");
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base)) {
    const c = join(base, d, `${nome}.app`);
    if (d.startsWith("mac") && existsSync(c) && statSync(c).isDirectory()) return c;
  }
  return null;
}

/** Entitlements (chaves verdadeiras) de um plist XML (arquivo do repo ou saída de `codesign -d --entitlements :-`). */
export function chavesDeEntitlements(texto) {
  const i = texto.indexOf("<?xml") >= 0 ? texto.indexOf("<?xml") : texto.indexOf("<plist");
  if (i < 0) return [];
  const d = parsePlistXml(texto.slice(i));
  return Object.entries(d ?? {}).filter(([, v]) => v === true).map(([k]) => k).sort();
}

/** Verifica o `.app` inteiro: codesign --verify --deep --strict, spctl, stapler, entitlements. */
export function verificarAssinaturaApp({ app, esperado, ferramentas = {}, entitlementsEsperados = [] }) {
  const codesign = ferramentas.codesign ?? "codesign";
  const spctl = ferramentas.spctl ?? "spctl";
  const xcrun = ferramentas.xcrun ?? "xcrun";
  const real = assinaturaMac(app, codesign);
  const verify = rodar(codesign, ["--verify", "--deep", "--strict", "--verbose=2", app]);
  const gk = rodar(spctl, ["--assess", "--type", "execute", "--verbose", app]);
  const stapler = rodar(xcrun, ["stapler", "validate", app]);
  const ent = rodar(codesign, ["-d", "--entitlements", ":-", app]);
  const chaves = ent.status === 0 ? chavesDeEntitlements(ent.stdout || ent.saida) : [];
  const checks = [
    { id: "assinatura-real", ok: real.assinado, mensagem: real.assinado ? "assinatura real presente" : `sem assinatura real: R1 (${real.motivo})` },
    { id: "codesign-verify", ok: verify.status === 0, mensagem: `codesign --verify --deep --strict: ${verify.status === 0 ? "ok" : "falhou"}` },
    { id: "spctl", ok: gk.status === 0, mensagem: `spctl --assess: ${gk.status === 0 ? "aceito" : "recusado"}` },
    { id: "stapler", ok: stapler.status === 0, mensagem: `stapler validate: ${stapler.status === 0 ? "ok" : "sem ticket de notarização"}` },
  ];
  const faltam = entitlementsEsperados.filter((k) => !chaves.includes(k));
  const sobram = chaves.filter((k) => !entitlementsEsperados.includes(k));
  checks.push({ id: "entitlements", ok: ent.status === 0 && faltam.length === 0 && sobram.length === 0, mensagem: ent.status !== 0 ? "entitlements ilegíveis (app sem assinatura)" : faltam.length || sobram.length ? `entitlements divergem (faltam: ${faltam.join(", ") || "-"}; extras: ${sobram.join(", ") || "-"})` : "entitlements conferem com build/entitlements.mac.plist", chaves });
  let problemas;
  if (esperado === "assinado") problemas = checks.filter((c) => !c.ok).map((c) => c.mensagem);
  else problemas = real.assinado ? ["o pacote está assinado, mas o esperado era não assinado"] : [];
  return { esperado, ok: problemas.length === 0, nota: real.assinado ? undefined : "sem assinatura real: R1", problemas, checks };
}
