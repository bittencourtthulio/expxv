// Perfis de build e configuração derivada do electron-builder (T-21.03, D-340/D-342/D-344).
// Perfis: local (padrão; idêntico ao electron-builder.yml, sem assinar) | ci | release | com-atualizacao | perf.
// NENHUMA variável de credencial é lida aqui (D-345): o builder/os scripts de assinatura leem do ambiente do CI do dono.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { PERFIS } from "./distribuicao.mjs";

const RAIZ_PADRAO = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

/** A linha de exclusão do updater e das dependências exclusivas dele (D-24): só o perfil com-atualizacao a remove. */
export const PADRAO_EXCLUSAO_UPDATER = /^!node_modules\/\{electron-updater,/;
export const ARQUIVO_DISTRIBUICAO_NO_PACOTE = "build/distribuicao.json";

/** Fuses por perfil (D-344). `runAsNode` permanece LIGADO: o daemon de PTY, os hooks e o MCP rodam com ELECTRON_RUN_AS_NODE. */
export const FUSES = Object.freeze({
  release: Object.freeze({ runAsNode: true, enableNodeCliInspectArguments: false }),
  perf: Object.freeze({ runAsNode: true, enableNodeCliInspectArguments: true }),
});

export function carregarBase(raiz = RAIZ_PADRAO) {
  return parse(readFileSync(join(raiz, "electron-builder.yml"), "utf8"));
}

function temUpdaterNoPackageJson(raiz) {
  try {
    const pkg = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
    return Boolean(pkg.dependencies?.["electron-updater"] ?? pkg.optionalDependencies?.["electron-updater"]);
  } catch {
    return false;
  }
}

/**
 * Deriva a configuração do perfil sem mutar a base.
 * @param {Record<string, any>} base objeto lido de electron-builder.yml
 * @param {string} perfil
 * @param {{ raiz?: string, distribuicao?: any, temUpdater?: boolean }} [opcoes]
 * @returns {{ config: Record<string, any>, avisos: string[] }}
 */
export function configParaPerfil(base, perfil = "local", opcoes = {}) {
  if (!PERFIS.includes(perfil)) throw new Error(`perfil de build desconhecido: ${String(perfil).slice(0, 30)}`);
  const raiz = opcoes.raiz ?? RAIZ_PADRAO;
  const config = structuredClone(base);
  const avisos = [];
  if (perfil === "local" || perfil === "ci") return { config, avisos };

  if (perfil === "release") {
    config.mac = { ...config.mac, hardenedRuntime: true };
    config.electronFuses = { ...FUSES.release };
    if (existsSync(join(raiz, "scripts", "notarizar.cjs"))) config.afterSign = "scripts/notarizar.cjs";
    return { config, avisos };
  }
  if (perfil === "perf") {
    config.electronFuses = { ...FUSES.perf };
    return { config, avisos };
  }
  // com-atualizacao: remove SÓ a exclusão do updater (e das dependências exclusivas dele) e leva o manifesto de build.
  const tem = opcoes.temUpdater ?? temUpdaterNoPackageJson(raiz);
  if (!tem) throw new Error("perfil com-atualizacao exige `electron-updater` em optionalDependencies do package.json (versão exata, custo medido: D-NN); falha fechada");
  const antes = config.files.length;
  config.files = config.files.filter((p) => !(typeof p === "string" && PADRAO_EXCLUSAO_UPDATER.test(p)));
  if (config.files.length === antes) throw new Error("exclusão do electron-updater não encontrada em files: (electron-builder.yml mudou?)");
  config.files.push(ARQUIVO_DISTRIBUICAO_NO_PACOTE);
  if (opcoes.distribuicao && opcoes.distribuicao.atualizacao?.habilitada !== true) avisos.push("com-atualizacao com atualizacao.habilitada=false: a dependência entra no pacote, mas o app não a carrega (duas chaves, D-342)");
  return { config, avisos };
}

/** Grava a configuração derivada FORA da árvore (os caminhos relativos do builder valem contra o cwd/projectDir). */
export function gravarConfigDerivada(config, perfil, pasta = join(tmpdir(), "builder-perfis")) {
  mkdirSync(pasta, { recursive: true });
  const destino = join(pasta, `electron-builder.${perfil}.${process.pid}.yml`);
  writeFileSync(destino, stringify(config), { mode: 0o600 });
  return destino;
}
