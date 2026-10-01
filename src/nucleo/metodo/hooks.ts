// Modos dos hooks do método (T-04.08): lê `.expx/hooks.json` SOMENTE-LEITURA. O ADE nunca promove
// aviso → bloqueio (decisão humana guiada pelas violações do rastro). Arquivo ausente: valem os padrões
// de nascimento (segurança em `bloqueio`, método em `aviso`; `base/F-…` §3.2).
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export type ModoHook = "aviso" | "bloqueio" | "desligado";
export type TipoHook = "seguranca" | "metodo";

export interface HookInfo {
  nome: string;
  modo: ModoHook;
  tipo: TipoHook;
  /** `arquivo` = veio do hooks.json; `padrao` = modo de nascimento. */
  origem: "arquivo" | "padrao";
}

export interface EstadoHooks {
  /** o arquivo `.expx/hooks.json` existe? */
  presente: boolean;
  /** `arquivo` se ao menos um modo veio dele. */
  origem: "arquivo" | "padrao";
  hooks: HookInfo[];
  avisos: string[];
}

const SEGURANCA = ["segredo-no-commit", "sem-segredo", "git-perigoso", "branch-limpa", "zona-de-risco", "aprovacao-em-raio-alto", "designx-cartografa"];
const METODO = [
  "causa-antes-do-plano", "regressao-antes-do-fix", "task-so-fecha-verde", "escopo-da-ocorrencia", "sem-jargao-no-uso",
  "uma-ocorrencia-por-arvore", "task-reivindicada", "arvore-limpa-antes-da-suite", "escopo-da-task", "sem-placeholder-no-plano",
  "tdd-teste-antes", "commit-por-task", "arquivo-fora-do-plano", "pr-so-com-portao", "raio-antes-do-plano", "caracterizacao-antes",
  "orcamento-de-mudanca", "reversao-declarada", "sem-colateral", "aderencia", "sem-convencoes", "designx-audit", "designx-token-check",
];

export const HOOKS_DE_NASCIMENTO: ReadonlyArray<{ nome: string; modo: ModoHook; tipo: TipoHook }> = [
  ...SEGURANCA.map((nome) => ({ nome, modo: "bloqueio" as const, tipo: "seguranca" as const })),
  ...METODO.map((nome) => ({ nome, modo: "aviso" as const, tipo: "metodo" as const })),
];

const LIMITE_BYTES = 256 * 1024;
const MODOS: readonly string[] = ["aviso", "bloqueio", "desligado"];
const NOME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,80}$/;

const padroes = (): HookInfo[] => HOOKS_DE_NASCIMENTO.map((h) => ({ ...h, origem: "padrao" }));

function achatar(valor: Record<string, unknown>, prefixo: string, saida: Array<[string, unknown]>, avisos: string[], nivel = 0): void {
  for (const [chave, v] of Object.entries(valor)) {
    const nome = prefixo === "" ? chave : `${prefixo}/${chave}`;
    const agrupa = typeof v === "object" && v !== null && !Array.isArray(v) && !("modo" in (v as object)) && nivel < 2;
    if (agrupa) achatar(v as Record<string, unknown>, nome, saida, avisos, nivel + 1);
    else saida.push([nome, v]);
  }
}

/** Nunca lança nem escreve: problemas viram `avisos`. */
export async function lerHooks(raiz: string): Promise<EstadoHooks> {
  const caminho = join(raiz, ".expx", "hooks.json");
  let info;
  try {
    info = await stat(caminho);
  } catch {
    return { presente: false, origem: "padrao", hooks: padroes(), avisos: [] };
  }
  const falhou = (aviso: string): EstadoHooks => ({ presente: true, origem: "padrao", hooks: padroes(), avisos: [aviso] });
  if (!info.isFile()) return falhou("hooks.json não é um arquivo.");
  if (info.size > LIMITE_BYTES) return falhou("hooks.json grande demais: ignorado.");

  let bruto: unknown;
  try {
    bruto = JSON.parse((await readFile(caminho, "utf8")).replace(/^﻿/, ""));
  } catch {
    return falhou("hooks.json ilegível (JSON inválido): valem os padrões de nascimento.");
  }
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return falhou("hooks.json com formato inesperado: valem os padrões de nascimento.");
  const bloco = (bruto as Record<string, unknown>)["hooks"];
  if (bloco === undefined) return { presente: true, origem: "padrao", hooks: padroes(), avisos: [] };
  if (typeof bloco !== "object" || bloco === null || Array.isArray(bloco)) return falhou("hooks.json: o campo `hooks` tem formato inesperado.");

  const pares: Array<[string, unknown]> = [];
  const avisos: string[] = [];
  achatar(bloco as Record<string, unknown>, "", pares, avisos);

  const hooks = padroes();
  let doArquivo = false;
  for (const [nome, v] of pares) {
    if (!NOME.test(nome)) {
      avisos.push(`hook com nome inválido ignorado.`);
      continue;
    }
    const modo = typeof v === "string" ? v : typeof v === "object" && v !== null ? (v as { modo?: unknown }).modo : undefined;
    if (typeof modo !== "string" || !MODOS.includes(modo)) {
      avisos.push(`${nome}: modo inválido (use aviso, bloqueio ou desligado); vale o padrão.`);
      continue;
    }
    const tipoDeclarado = typeof v === "object" && v !== null ? (v as { tipo?: unknown }).tipo : undefined;
    const existente = hooks.find((h) => h.nome === nome);
    if (existente !== undefined) {
      existente.modo = modo as ModoHook;
      existente.origem = "arquivo";
      if (tipoDeclarado === "seguranca" || tipoDeclarado === "metodo") existente.tipo = tipoDeclarado;
    } else {
      hooks.push({ nome, modo: modo as ModoHook, tipo: tipoDeclarado === "seguranca" ? "seguranca" : "metodo", origem: "arquivo" });
    }
    doArquivo = true;
  }
  return { presente: true, origem: doArquivo ? "arquivo" : "padrao", hooks, avisos };
}
