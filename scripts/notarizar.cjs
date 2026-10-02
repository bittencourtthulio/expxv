// afterSign do electron-builder (T-21.10, D-345): notariza o .app SÓ quando há credencial no ambiente.
// Sem credencial: não faz nada e NÃO toca a rede (este arquivo nem importa módulo de rede). Nunca imprime valores de variável (AU-08):
// só nomes e mensagens fixas; a saída das ferramentas passa por redação antes de ir ao log.
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { mkdtempSync, rmSync } = require("node:fs");

const CHAVES_API = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];
const CHAVES_ID = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];
const tem = (env, nome) => typeof env[nome] === "string" && env[nome].trim() !== "";

/** `api` | `apple_id` | null (sem credencial completa). */
function modoDeCredencial(env) {
  if (CHAVES_API.every((n) => tem(env, n))) return "api";
  if (CHAVES_ID.every((n) => tem(env, n))) return "apple_id";
  return null;
}

function redigir(texto, env) {
  let t = String(texto ?? "");
  for (const n of [...CHAVES_API, ...CHAVES_ID]) if (tem(env, n) && env[n].length >= 4) t = t.split(env[n]).join("***");
  return t;
}

/**
 * @param {{ electronPlatformName: string, appOutDir: string, packager: { appInfo: { productFilename: string } } }} contexto
 * @param {{ env?: Record<string,string|undefined>, executar?: (exe: string, args: string[]) => { status: number|null, stdout?: string, stderr?: string }, log?: (m: string) => void }} [dep]
 */
async function notarizar(contexto, dep = {}) {
  const env = dep.env ?? process.env;
  const log = dep.log ?? ((m) => console.log(m));
  const executar = dep.executar ?? ((exe, args) => spawnSync(exe, args, { encoding: "utf8", env, maxBuffer: 1 << 26 }));
  if (contexto.electronPlatformName !== "darwin") return { acao: "ignorada", motivo: "plataforma" };
  const modo = modoDeCredencial(env);
  if (modo === null) {
    log("notarização ignorada: sem credencial no ambiente (build sem assinatura real, R1)");
    return { acao: "ignorada", motivo: "sem_credencial" };
  }
  const app = join(contexto.appOutDir, `${contexto.packager.appInfo.productFilename}.app`);
  const pasta = mkdtempSync(join(tmpdir(), "notarizar-"));
  const zip = join(pasta, "app.zip");
  try {
    let r = executar("ditto", ["-c", "-k", "--keepParent", app, zip]);
    if (r.status !== 0) throw new Error("falha ao compactar o .app para a notarização");
    const credenciais = modo === "api" ? ["--key", env.APPLE_API_KEY, "--key-id", env.APPLE_API_KEY_ID, "--issuer", env.APPLE_API_ISSUER] : ["--apple-id", env.APPLE_ID, "--password", env.APPLE_APP_SPECIFIC_PASSWORD, "--team-id", env.APPLE_TEAM_ID];
    log(`notarizando (credencial: ${modo === "api" ? CHAVES_API.join("+") : CHAVES_ID.join("+")})`);
    r = executar("xcrun", ["notarytool", "submit", zip, ...credenciais, "--wait"]);
    if (r.status !== 0) throw new Error(`notarytool falhou: ${redigir(`${r.stdout ?? ""}${r.stderr ?? ""}`, env).trim().split("\n").slice(-3).join(" | ")}`);
    r = executar("xcrun", ["stapler", "staple", app]);
    if (r.status !== 0) throw new Error("stapler staple falhou");
    return { acao: "notarizada", modo };
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

exports.default = notarizar;
exports.notarizar = notarizar;
exports.modoDeCredencial = modoDeCredencial;
