// Persistência de "Executar projeto": configurações do usuário em `<pasta do produto>/executar.json` do repositório (relativo, versionável) com
// fallback em dados do app quando a pasta não for gravável; confiança por hash e histórico em dados do app. NUNCA em `docs/**` (D-04).
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { LeitorProjeto } from "./detectar";
import { ARQUIVO_CONFIG_EXECUTAR, ARQUIVO_VAZIO, LIMITES_EXECUTAR, type ArquivoConfigExecutar, type EntradaHistoricoExecutar } from "./modelo";
import { lerArquivoConfig } from "./validacao";

const TETO_ARQUIVO = 1024 * 1024;
const dentro = (raiz: string, alvo: string): boolean => { const r = relative(raiz, alvo); return r === "" || (!r.startsWith("..") && !isAbsolute(r)); };

/** Leitor confinado: segue só o que resolve DENTRO da raiz real (symlink para fora é invisível). */
export function leitorDeDisco(raiz: string): LeitorProjeto {
  let raizReal: string;
  try { raizReal = realpathSync(raiz); } catch { raizReal = raiz; }
  const real = (rel: string): string | null => {
    if (isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) return null;
    try {
      const r = realpathSync(join(raizReal, rel));
      return dentro(raizReal, r) ? r : null;
    } catch { return null; }
  };
  return {
    ler(rel) {
      const r = real(rel);
      if (r === null) return null;
      try {
        const st = statSync(r);
        return st.isFile() && st.size <= TETO_ARQUIVO ? readFileSync(r, "utf8") : null;
      } catch { return null; }
    },
    existe(rel) {
      const r = real(rel);
      return r !== null && existsSync(r);
    },
    listar(rel) {
      const r = real(rel);
      if (r === null) return [];
      try { return readdirSync(r).slice(0, 2_000); } catch { return []; }
    },
  };
}

function gravarAtomico(caminho: string, texto: string): void {
  const tmp = `${caminho}.${process.pid}.tmp`;
  writeFileSync(tmp, texto, { mode: 0o600 });
  renameSync(tmp, caminho);
}
function lerJson(caminho: string): unknown {
  try {
    if (!existsSync(caminho) || statSync(caminho).size > TETO_ARQUIVO) return null;
    return JSON.parse(readFileSync(caminho, "utf8")) as unknown;
  } catch { return null; }
}

export interface LeituraConfig { arquivo: ArquivoConfigExecutar; onde: "arquivo" | "app" | "nenhum"; avisos: string[] }

export interface ArmazemExecutar {
  lerConfig(workspaceId: string, raiz: string): LeituraConfig;
  /** Grava no repositório (`<pasta do produto>/executar.json`); se não der, em dados do app. Devolve onde ficou. */
  gravarConfig(workspaceId: string, raiz: string, arquivo: ArquivoConfigExecutar): "arquivo" | "app";
  hashConfiado(workspaceId: string, configId: string): string | null;
  confiar(workspaceId: string, configId: string, hash: string): void;
  revogar(workspaceId: string, configId?: string): void;
  historico(workspaceId: string): EntradaHistoricoExecutar[];
  registrarHistorico(workspaceId: string, entrada: EntradaHistoricoExecutar): void;
}

export function criarArmazemExecutar(pastaDados: string): ArmazemExecutar {
  const pasta = join(pastaDados, "executar");
  const arqConfianca = join(pasta, "confianca.json");
  const arqHistorico = join(pasta, "historico.json");
  const arqApp = (ws: string): string => join(pasta, `config-${ws.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  const garantirPasta = (): void => { mkdirSync(pasta, { recursive: true, mode: 0o700 }); };

  const lerMapa = <T>(arq: string): Record<string, T> => {
    const v = lerJson(arq);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, T>) : {};
  };

  return {
    lerConfig(ws, raiz) {
      let raizReal = raiz;
      try { raizReal = realpathSync(raiz); } catch { /* raiz sumiu: cai no app */ }
      const alvo = join(raizReal, ARQUIVO_CONFIG_EXECUTAR);
      try {
        const real = realpathSync(alvo);
        if (dentro(raizReal, real) && statSync(real).isFile()) {
          const bruto = lerJson(real);
          const { arquivo, avisos } = lerArquivoConfig(bruto);
          return { arquivo, onde: "arquivo", avisos };
        }
      } catch { /* sem arquivo no repositório */ }
      if (existsSync(arqApp(ws))) {
        const { arquivo, avisos } = lerArquivoConfig(lerJson(arqApp(ws)));
        return { arquivo, onde: "app", avisos };
      }
      return { arquivo: ARQUIVO_VAZIO, onde: "nenhum", avisos: [] };
    },

    gravarConfig(ws, raiz, arquivo) {
      const texto = `${JSON.stringify({ versao: 1, padrao: arquivo.padrao, configuracoes: arquivo.configuracoes.map((c) => { const { origem, ...resto } = c; void origem; return resto; }) }, null, 2)}\n`;
      try {
        const raizReal = realpathSync(raiz);
        const dir = join(raizReal, dirname(ARQUIVO_CONFIG_EXECUTAR));
        if (existsSync(dir)) {
          // a pasta do produto como symlink para fora: recusa e cai no app
          if (lstatSync(dir).isSymbolicLink() || !dentro(raizReal, realpathSync(dir))) throw new Error("pasta do produto fora do workspace");
        } else mkdirSync(dir, { recursive: true });
        const alvo = join(raizReal, ARQUIVO_CONFIG_EXECUTAR);
        if (existsSync(alvo) && lstatSync(alvo).isSymbolicLink()) throw new Error("arquivo é symlink");
        writeFileSync(`${alvo}.${process.pid}.tmp`, texto);
        renameSync(`${alvo}.${process.pid}.tmp`, alvo);
        return "arquivo";
      } catch {
        garantirPasta();
        gravarAtomico(arqApp(ws), texto);
        return "app";
      }
    },

    hashConfiado(ws, configId) {
      const m = lerMapa<Record<string, string>>(arqConfianca)[ws];
      const h = m?.[configId];
      return typeof h === "string" ? h : null;
    },
    confiar(ws, configId, hash) {
      garantirPasta();
      const todo = lerMapa<Record<string, string>>(arqConfianca);
      todo[ws] = { ...(todo[ws] ?? {}), [configId]: hash };
      gravarAtomico(arqConfianca, JSON.stringify(todo));
    },
    revogar(ws, configId) {
      const todo = lerMapa<Record<string, string>>(arqConfianca);
      if (todo[ws] === undefined) return;
      if (configId === undefined) delete todo[ws];
      else delete todo[ws][configId];
      garantirPasta();
      gravarAtomico(arqConfianca, JSON.stringify(todo));
    },

    historico(ws) {
      const l = lerMapa<EntradaHistoricoExecutar[]>(arqHistorico)[ws];
      return Array.isArray(l) ? l.slice(0, LIMITES_EXECUTAR.historico) : [];
    },
    registrarHistorico(ws, entrada) {
      garantirPasta();
      const todo = lerMapa<EntradaHistoricoExecutar[]>(arqHistorico);
      todo[ws] = [entrada, ...(Array.isArray(todo[ws]) ? todo[ws] : [])].slice(0, LIMITES_EXECUTAR.historico);
      gravarAtomico(arqHistorico, JSON.stringify(todo));
    },
  };
}
