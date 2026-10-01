// Onboarding do projeto (T-04.08): detecta `.expx/`, `expx-lock.json` (versões e `harness`), as camadas
// instaladas (pelos arquivos que cada skill grava) e diz o que falta, com o comando de cada camada.
// Tudo SOMENTE-LEITURA: o ADE mostra o comando; quem o roda (num Pane) é a pessoa.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { prefixoDoHarness, type Harness } from "./comandos";
import { lerHooks, type EstadoHooks } from "./hooks";
import type { IndiceProjeto } from "./tipos";

export interface SkillDoLock {
  nome: string;
  commit: string | null;
  resolvido_em: string | null;
}

export interface EstadoLock {
  presente: boolean;
  /** JSON válido com o formato esperado? */
  legivel: boolean;
  versao_lock: number | null;
  versao_cli: string | null;
  harness: string[];
  skills: SkillDoLock[];
}

export type IdCamada = "convencoes" | "perfil_legado" | "design_system" | "produto" | "memoria";

export interface CamadaInstalacao {
  id: IdCamada;
  nome: string;
  /** skill que cria a camada (sem prefixo). */
  skill: string;
  instalada: boolean;
  arquivo: string;
  /** texto a digitar, já com o prefixo do harness padrão. */
  comando: string;
}

export interface ItemFaltando {
  camada: IdCamada | "lock" | "hooks";
  nome: string;
  comando: string;
  /** `hooks.json` é opcional: ausente vale o padrão de nascimento. */
  obrigatorio: boolean;
}

export interface EstadoInstalacao {
  /** a pasta `.expx/` existe? */
  tem_expx: boolean;
  lock: EstadoLock;
  camadas: CamadaInstalacao[];
  hooks: EstadoHooks;
  faltando: ItemFaltando[];
  alertas: string[];
  /** harness dos comandos sugeridos (o do lock; `claude` se o lock não diz). */
  harness_padrao: Harness;
  comando_onboarding: string;
}

/** Versão do lock que este ADE entende. */
export const LOCK_SUPORTADO = 1;

const CAMADAS: ReadonlyArray<{ id: IdCamada; nome: string; skill: string; arquivo: string }> = [
  { id: "convencoes", nome: "Convenções do repositório (stackx)", skill: "stackx-detectar", arquivo: "docs/stack/CONVENCOES.md" },
  { id: "perfil_legado", nome: "Perfil do legado (legadox)", skill: "legadox-perfil", arquivo: "docs/legado/PERFIL.md" },
  { id: "design_system", nome: "Design system (designx)", skill: "designx-cartography", arquivo: "docs/design-system/DESIGN-SYSTEM.md" },
  { id: "produto", nome: "Contexto de produto (prodx)", skill: "prodx-produto", arquivo: "docs/produto/PRODUTO.md" },
  { id: "memoria", nome: "Índice de memória (memox)", skill: "memox-indexar", arquivo: ".expx/memoria/indice.json" },
];

const LIMITE_LOCK = 2 * 1024 * 1024;

async function existe(caminho: string, tipo: "arquivo" | "pasta"): Promise<boolean> {
  try {
    const s = await stat(caminho);
    return tipo === "pasta" ? s.isDirectory() : s.isFile();
  } catch {
    return false;
  }
}

const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const texto = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v.slice(0, 200) : null);

export async function lerLockDoProjeto(raiz: string): Promise<{ lock: EstadoLock; alertas: string[] }> {
  const vazio: EstadoLock = { presente: false, legivel: false, versao_lock: null, versao_cli: null, harness: [], skills: [] };
  const caminho = join(raiz, ".expx", "expx-lock.json");
  let info;
  try {
    info = await stat(caminho);
  } catch {
    return { lock: vazio, alertas: [] };
  }
  const ilegivel = (): { lock: EstadoLock; alertas: string[] } => ({
    lock: { ...vazio, presente: true },
    alertas: ["expx-lock.json ilegível: não foi possível ler as versões instaladas."],
  });
  if (!info.isFile() || info.size > LIMITE_LOCK) return ilegivel();
  let bruto: unknown;
  try {
    bruto = JSON.parse((await readFile(caminho, "utf8")).replace(/^﻿/, ""));
  } catch {
    return ilegivel();
  }
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return ilegivel();
  const o = bruto as Record<string, unknown>;
  // o lock real usa `lock_version`; o contrato descreve `expx_lock`: aceita os dois
  const versao = numero(o["lock_version"]) ?? numero(o["expx_lock"]);
  const harness = Array.isArray(o["harness"]) ? o["harness"].filter((h): h is string => typeof h === "string").slice(0, 10) : [];
  const skills: SkillDoLock[] = [];
  const bloco = o["skills"];
  if (typeof bloco === "object" && bloco !== null && !Array.isArray(bloco)) {
    for (const [nome, v] of Object.entries(bloco as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const s = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
      skills.push({ nome: nome.slice(0, 60), commit: texto(s["commit"]), resolvido_em: texto(s["resolvido_em"]) });
    }
  }
  const alertas: string[] = [];
  if (versao !== null && versao > LOCK_SUPORTADO) {
    alertas.push(`O expx-lock.json é de uma versão mais nova (${versao}) que a suportada pelo ADE (${LOCK_SUPORTADO}): atualize o ADE para ler tudo.`);
  }
  return { lock: { presente: true, legivel: true, versao_lock: versao, versao_cli: texto(o["cli_version"]), harness, skills }, alertas };
}

/** Alerta de `expx_schema` maior que o suportado, a partir do índice já lido (`rejeicoes`). */
export function alertasDeSchema(indice: Pick<IndiceProjeto, "rejeicoes">): string[] {
  const n = indice.rejeicoes.filter((r) => r.motivo === "schema_maior").length;
  if (n === 0) return [];
  return [`${n} ${n === 1 ? "arquivo usa" : "arquivos usam"} um expx_schema mais novo que o suportado pelo ADE: atualize o ADE; esses arquivos foram ignorados.`];
}

/** Nunca lança nem escreve. */
export async function lerInstalacao(raiz: string): Promise<EstadoInstalacao> {
  const [temExpx, { lock, alertas }, hooks, presentes] = await Promise.all([
    existe(join(raiz, ".expx"), "pasta"),
    lerLockDoProjeto(raiz),
    lerHooks(raiz),
    Promise.all(CAMADAS.map((c) => existe(join(raiz, ...c.arquivo.split("/")), "arquivo"))),
  ]);
  const harness_padrao: Harness = lock.harness.includes("claude") || !lock.harness.includes("opencode") ? "claude" : "opencode";
  const prefixo = prefixoDoHarness(harness_padrao);
  const comando_onboarding = `${prefixo}onboarding`;

  const camadas: CamadaInstalacao[] = CAMADAS.map((c, i) => ({
    id: c.id, nome: c.nome, skill: c.skill, arquivo: c.arquivo, instalada: presentes[i] === true, comando: `${prefixo}${c.skill}`,
  }));

  const faltando: ItemFaltando[] = [];
  if (!lock.presente) faltando.push({ camada: "lock", nome: "Método Expx instalado (.expx/expx-lock.json)", comando: "npx expxdev init", obrigatorio: true });
  for (const c of camadas) if (!c.instalada) faltando.push({ camada: c.id, nome: c.nome, comando: c.comando, obrigatorio: true });
  if (!hooks.presente) faltando.push({ camada: "hooks", nome: "Modos dos hooks (.expx/hooks.json): valem os padrões de nascimento", comando: comando_onboarding, obrigatorio: false });

  const avisos = [...alertas, ...hooks.avisos];
  if (!temExpx) avisos.unshift("Esta pasta ainda não tem .expx/: o método não está instalado aqui.");
  return { tem_expx: temExpx, lock, camadas, hooks, faltando, alertas: avisos, harness_padrao, comando_onboarding };
}
