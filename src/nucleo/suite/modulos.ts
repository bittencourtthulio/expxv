// Módulos da suíte ExpxDev (D-480…): ligar/desligar cada skill POR PROJETO, só no que o APP oferece e dispara. O lock `.expx/expx-lock.json` e as skills instaladas NUNCA
// são tocados (D-04): "desligado" é uma decisão do app, guardada em `modulos.json` na pasta do produto do repositório (ou nos dados do app se a pasta não for gravável).
// Puro: padrões, validação estrita do arquivo, dependências entre módulos e mapa skill → módulo. Sem disco, sem Electron.
import { SKILLS_DA_SUITE } from "./catalogo";

export type ModuloId = "sprintx" | "runx" | "legadox" | "stackx" | "mergex" | "memox" | "prodx" | "buildx" | "designx";
export const MODULOS: readonly ModuloId[] = SKILLS_DA_SUITE as readonly ModuloId[];
export type EstadoModulos = Readonly<Record<ModuloId, boolean>>;

export const VERSAO_ARQUIVO_MODULOS = 1;
/** Relativo à raiz do workspace; mora na pasta do produto (nunca em `docs/**`): ver `ARQUIVO_MODULOS` em `main/suite-modulos.ts`. */
export const NOME_ARQUIVO_MODULOS = "modulos.json";

/** Padrão de fábrica: todos ligados, EXCETO o legadox (a maioria dos projetos não é legado). */
export const PADRAO_DE_FABRICA: EstadoModulos = {
  sprintx: true, runx: true, legadox: false, stackx: true, mergex: true, memox: true, prodx: true, buildx: true, designx: true,
};

export const ehModulo = (v: unknown): v is ModuloId => typeof v === "string" && (MODULOS as readonly string[]).includes(v);

// ---------------------------------------------------------------- dependências
export interface RequisitosDoModulo {
  /** grupos de "um destes": o módulo só funciona se, em CADA grupo, ao menos um módulo estiver ligado */
  exige: readonly (readonly ModuloId[])[];
  /** o módulo funciona sem, mas perde parte do valor (aviso, nunca bloqueio) */
  recomenda: readonly (readonly ModuloId[])[];
  /** de onde sai a regra (para a UI e para o doc) */
  fonte: string;
}

const CAMADA = "O catálogo do expxdev marca esta skill como camada: sozinha não faz nada, precisa do sprintx ou do runx junto.";

/**
 * Derivado do que as próprias skills e o CLI declaram: `catalogo.js` do expxdev 0.9.0 (`camada: true` em legadox, stackx, memox, prodx e designx; o designx diz
 * "requer uma skill de método instalada (sprintx ou runx)"); `buildx/references/integracao/{sprintx,prodx,mergex,stackx}.md` (o buildx "não roda" sem sprintx, prodx e
 * mergex; sem stackx registra premissa e segue); o mergex entrega o que o sprintx/runx produzem. Ver docs/ade/base/F-metodo-expxdev.md §1.
 */
export const REQUISITOS_DE_MODULO: Readonly<Record<ModuloId, RequisitosDoModulo>> = {
  sprintx: { exige: [], recomenda: [], fonte: "Base do método: planeja e executa features." },
  runx: { exige: [], recomenda: [], fonte: "Base do método: ocorrências de manutenção." },
  mergex: { exige: [], recomenda: [["sprintx", "runx"]], fonte: "Entrega o trabalho que o sprintx ou o runx produzem; sem eles não há o que entregar." },
  legadox: { exige: [["sprintx", "runx"]], recomenda: [], fonte: CAMADA },
  stackx: { exige: [["sprintx", "runx"]], recomenda: [], fonte: CAMADA },
  memox: { exige: [["sprintx", "runx"]], recomenda: [], fonte: CAMADA },
  prodx: { exige: [["sprintx", "runx"]], recomenda: [], fonte: CAMADA },
  designx: { exige: [["sprintx", "runx"]], recomenda: [], fonte: "Requer uma skill de método instalada (sprintx ou runx), segundo o próprio designx." },
  buildx: { exige: [["sprintx"], ["prodx"], ["mergex"]], recomenda: [["stackx"]], fonte: "O buildx não roda sem sprintx, prodx e mergex (integracao/*.md); sem o stackx ele registra a premissa e segue." },
};

/** Quem exige este módulo (diretamente, em algum grupo). */
export const dependentesDe = (m: ModuloId): ModuloId[] => MODULOS.filter((x) => REQUISITOS_DE_MODULO[x].exige.some((g) => g.includes(m)));

const grupoAtendido = (g: readonly ModuloId[], e: EstadoModulos): boolean => g.some((x) => e[x]);
/** Módulos LIGADOS cujos requisitos duros não estão atendidos (estado incoerente). */
export const modulosQuebrados = (e: EstadoModulos): ModuloId[] => MODULOS.filter((m) => e[m] && !REQUISITOS_DE_MODULO[m].exige.every((g) => grupoAtendido(g, e)));

export interface AvisoDeModulo {
  modulo: ModuloId;
  tipo: "exige" | "recomenda";
  /** grupos sem nenhum módulo ligado */
  faltando: ModuloId[][];
}
/** Avisos do estado atual: requisito duro quebrado (módulo ligado que não vai funcionar) e recomendação não atendida. */
export function avisosDoEstado(e: EstadoModulos): AvisoDeModulo[] {
  const out: AvisoDeModulo[] = [];
  for (const m of MODULOS) {
    if (!e[m]) continue;
    const r = REQUISITOS_DE_MODULO[m];
    const duros = r.exige.filter((g) => !grupoAtendido(g, e)).map((g) => [...g]);
    if (duros.length > 0) out.push({ modulo: m, tipo: "exige", faltando: duros });
    const suaves = r.recomenda.filter((g) => !grupoAtendido(g, e)).map((g) => [...g]);
    if (suaves.length > 0) out.push({ modulo: m, tipo: "recomenda", faltando: suaves });
  }
  return out;
}

export type ResultadoMudanca =
  | { ok: true; estado: EstadoModulos; mudou: ModuloId[] }
  | { ok: false; precisa_confirmar: { tipo: "desligar_dependentes" | "ligar_requisitos"; modulos: ModuloId[] } };

/** Desligando `m`: quem ficaria sem requisito (em cascata). Ordem estável (a do catálogo). */
export function cascataAoDesligar(e: EstadoModulos, m: ModuloId): ModuloId[] {
  const novo: Record<ModuloId, boolean> = { ...e, [m]: false };
  const cascata = new Set<ModuloId>();
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const x of modulosQuebrados(novo)) {
      if (x === m) continue;
      novo[x] = false;
      cascata.add(x);
      mudou = true;
    }
  }
  return MODULOS.filter((x) => cascata.has(x));
}

/** Ligando `m`: os requisitos duros desligados que precisam ligar junto (o primeiro de cada grupo; em cascata). */
export function requisitosAoLigar(e: EstadoModulos, m: ModuloId): ModuloId[] {
  const novo: Record<ModuloId, boolean> = { ...e, [m]: true };
  const ligar = new Set<ModuloId>();
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const x of MODULOS) {
      if (!novo[x]) continue;
      for (const g of REQUISITOS_DE_MODULO[x].exige) {
        if (grupoAtendido(g, novo)) continue;
        const escolhido = g[0] as ModuloId;
        novo[escolhido] = true;
        ligar.add(escolhido);
        mudou = true;
      }
    }
  }
  return MODULOS.filter((x) => ligar.has(x));
}

/**
 * Liga/desliga um módulo. NUNCA em cascata sem confirmação: se desligar deixaria outro módulo ligado sem requisito (ou ligar exige um requisito desligado), devolve
 * `precisa_confirmar` com a lista; com `confirmar: true` aplica junto (desliga os dependentes / liga os requisitos).
 */
export function mudarModulo(e: EstadoModulos, m: ModuloId, ligado: boolean, confirmar = false): ResultadoMudanca {
  if (e[m] === ligado) return { ok: true, estado: e, mudou: [] };
  const novo: Record<ModuloId, boolean> = { ...e, [m]: ligado };
  const mudou: ModuloId[] = [m];
  if (!ligado) {
    const cascata = cascataAoDesligar(e, m);
    if (cascata.length > 0) {
      if (!confirmar) return { ok: false, precisa_confirmar: { tipo: "desligar_dependentes", modulos: cascata } };
      for (const x of cascata) { novo[x] = false; mudou.push(x); }
    }
  } else {
    const reqs = requisitosAoLigar(e, m);
    if (reqs.length > 0) {
      if (!confirmar) return { ok: false, precisa_confirmar: { tipo: "ligar_requisitos", modulos: reqs } };
      for (const x of reqs) { novo[x] = true; mudou.push(x); }
    }
  }
  return { ok: true, estado: novo, mudou };
}

// ---------------------------------------------------------------- arquivo (validação estrita)
export interface ArquivoModulos {
  versao: 1;
  modulos: Record<ModuloId, boolean>;
}

export type LeituraArquivo =
  | { valido: true; estado: EstadoModulos }
  | { valido: false; aviso: string };

/**
 * Valida o texto do arquivo SEM lançar: exatamente `{ versao: 1, modulos: { <os nove>: boolean } }`, sem chave sobrando nem faltando. Qualquer desvio (JSON ruim,
 * chave desconhecida, valor que não é booleano, versão diferente) → `valido: false` com um aviso curto: o chamador usa o padrão e NÃO sobrescreve em silêncio.
 */
export function lerArquivoModulos(texto: string | null): LeituraArquivo | null {
  if (texto === null) return null;
  let bruto: unknown;
  try { bruto = JSON.parse(texto.replace(/^﻿/, "")); } catch { return { valido: false, aviso: "O arquivo de módulos não é um JSON válido; vale o padrão até você ajustar um módulo." }; }
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return { valido: false, aviso: "O arquivo de módulos não tem o formato esperado; vale o padrão." };
  const o = bruto as Record<string, unknown>;
  const chaves = Object.keys(o);
  if (chaves.length !== 2 || !chaves.includes("versao") || !chaves.includes("modulos")) return { valido: false, aviso: "O arquivo de módulos tem campos a mais ou a menos; vale o padrão." };
  if (o["versao"] !== VERSAO_ARQUIVO_MODULOS) return { valido: false, aviso: "O arquivo de módulos é de outra versão; vale o padrão." };
  const m = o["modulos"];
  if (typeof m !== "object" || m === null || Array.isArray(m)) return { valido: false, aviso: "O arquivo de módulos não tem a lista de módulos; vale o padrão." };
  const mm = m as Record<string, unknown>;
  const nomes = Object.keys(mm);
  if (nomes.length !== MODULOS.length || nomes.some((n) => !ehModulo(n))) return { valido: false, aviso: "O arquivo de módulos cita módulos desconhecidos ou deixa algum de fora; vale o padrão." };
  const estado = {} as Record<ModuloId, boolean>;
  for (const id of MODULOS) {
    const v = mm[id];
    if (typeof v !== "boolean") return { valido: false, aviso: `No arquivo de módulos, “${id}” precisa ser verdadeiro ou falso; vale o padrão.` };
    estado[id] = v;
  }
  return { valido: true, estado };
}

/** Texto do arquivo (estável: ordem do catálogo, indentado, termina em quebra de linha). */
export function serializarModulos(e: EstadoModulos): string {
  const modulos = {} as Record<ModuloId, boolean>;
  for (const id of MODULOS) modulos[id] = e[id];
  return `${JSON.stringify({ versao: VERSAO_ARQUIVO_MODULOS, modulos }, null, 2)}\n`;
}

/**
 * Valida o padrão GLOBAL (preferência): objeto parcial de booleanos; o que faltar ou vier torto cai no padrão de fábrica (legadox desligado). Nunca lança.
 */
export function normalizarPadraoGlobal(v: unknown): EstadoModulos {
  const saida: Record<ModuloId, boolean> = { ...PADRAO_DE_FABRICA };
  if (typeof v !== "object" || v === null || Array.isArray(v)) return saida;
  const o = v as Record<string, unknown>;
  for (const id of MODULOS) if (typeof o[id] === "boolean") saida[id] = o[id] as boolean;
  return saida;
}

// ---------------------------------------------------------------- skill → módulo
/** `sprintx-auditoria` → `sprintx`; `buildx-retomar` → `buildx`; `onboarding` (comando fixo do plugin) → `null`. */
export function moduloDaSkill(skill: string): ModuloId | null {
  const base = skill.split("-")[0] ?? skill;
  return ehModulo(base) ? base : null;
}

/** Texto digitado no Pane (`/expx:runx-causa x` ou `/runx-causa x`) → módulo, ou `null` se não é comando de módulo. */
export function moduloDoComando(texto: string): ModuloId | null {
  const m = /^\/(?:expx:)?([a-z][a-z0-9-]{0,40})(?:\s|$)/.exec(texto.trimStart());
  return m === null ? null : moduloDaSkill(m[1] as string);
}

export const desligadosDe = (e: EstadoModulos): ModuloId[] => MODULOS.filter((m) => !e[m]);

export const MENSAGEM_DESLIGADO = (m: string): string => `O módulo ${m} está desligado neste projeto: ligue em Método › Módulos da suíte para usá-lo.`;

/** Aplica o estado a um comando já montado: módulo desligado → comando vazio e motivo claro. Não mexe em comando de outro módulo nem em comando sem módulo. */
export function bloquearComandoDeModuloDesligado<T extends { comando: string; motivo_bloqueio: string | null }>(c: T, desligados: ReadonlySet<string>): T {
  if (c.comando === "" || desligados.size === 0) return c;
  const m = moduloDoComando(c.comando);
  if (m === null || !desligados.has(m)) return c;
  return { ...c, comando: "", motivo_bloqueio: MENSAGEM_DESLIGADO(m) };
}

// ---------------------------------------------------------------- gate por Pane (Claude Code)
/**
 * Comandos/skills de cada módulo (a skill raiz e os subcomandos do plugin `expx`, de docs/ade/base/F-metodo-expxdev.md §5.4). Enumerados, sem curinga: a doc do
 * Claude Code só confirma a regra `Skill(<nome>)` exata (e é a mesma que o gate do catálogo da Fase 7 usa).
 */
export const SUBCOMANDOS_DO_MODULO: Readonly<Record<ModuloId, readonly string[]>> = {
  sprintx: ["sprintx-base", "sprintx-descoberta", "sprintx-sprints", "sprintx-estimar", "sprintx-orquestrador", "sprintx-auditoria", "sprintx-executar"],
  runx: ["runx-causa", "runx-plano", "runx-fix", "runx-qa", "runx-relatar"],
  legadox: ["legadox-perfil", "legadox-raio", "legadox-caracterizar", "legadox-divida", "legadox-manual"],
  stackx: ["stackx-detectar", "stackx-check", "stackx-atualizar", "stackx-migracao"],
  mergex: ["mergex-abrir", "mergex-check", "mergex-atencao", "mergex-qa", "mergex-pr", "mergex-revisar"],
  memox: ["memox-indexar", "memox-arquivo", "memox-modulo", "memox-buscar"],
  prodx: ["prodx-produto", "prodx-triar", "prodx-avaliar", "prodx-existe", "prodx-briefing"],
  buildx: ["buildx-mapa", "buildx-retomar", "buildx-status"],
  designx: ["designx-cartography", "designx-audit", "designx-status"],
};

/** Regras `permissions.deny` para os módulos desligados: `Skill(<nome>)` da skill e dos subcomandos, na forma do projeto (`.claude/skills`) e do plugin (`expx:<nome>`). */
export function denyDeModulos(desligados: ReadonlySet<string> | readonly string[]): string[] {
  const set = new Set(desligados);
  const saida: string[] = [];
  for (const m of MODULOS) {
    if (!set.has(m)) continue;
    for (const nome of [m, ...SUBCOMANDOS_DO_MODULO[m]]) saida.push(`Skill(${nome})`, `Skill(expx:${nome})`);
  }
  return saida;
}

/** O desligado vale por CLI: só o Claude Code aceita um `--settings` por Pane com `permissions.deny`; nas outras o app nega só do lado dele. */
export const ISOLAMENTO_POR_CLI: ReadonlyArray<{ cli: string; nome: string; efeito: "negado" | "parcial"; texto: string }> = [
  { cli: "claude", nome: "Claude Code", efeito: "negado", texto: "Nos Panes abertos pelo app, a skill desligada é negada ao modelo (regra de permissão por Pane; seu arquivo de configuração não é tocado). Um comando /expx: digitado à mão pode ainda abri-la." },
  { cli: "codex", nome: "Codex", efeito: "parcial", texto: "Desligado no app; esta CLI ainda enxerga a skill." },
  { cli: "opencode", nome: "OpenCode", efeito: "parcial", texto: "Desligado no app; esta CLI ainda enxerga a skill." },
  { cli: "outras", nome: "Gemini, Grok e outras", efeito: "parcial", texto: "Desligado no app; estas CLIs ainda enxergam a skill." },
];

// ---------------------------------------------------------------- gesto do Método → módulo
/** Qual módulo um gesto do Método usa (para esconder o botão de módulo desligado). `tipo` só importa em `retomar`. */
export function moduloDoGesto(gesto: string, tipo: string | null): ModuloId | null {
  switch (gesto) {
    case "nova_feature": case "auditar": return "sprintx";
    case "nova_ocorrencia": case "qa": return "runx";
    case "pedido_cru": return "prodx";
    case "projeto": return "buildx";
    case "gerar_convencoes": return "stackx";
    case "gerar_produto": return "prodx";
    case "gerar_memoria": return "memox";
    case "gerar_design_system": return "designx";
    case "gerar_perfil_legado": return "legadox";
    case "entrega_check": case "entrega_atencao": case "entrega_qa": case "entrega_pr": return "mergex";
    case "retomar": return tipo === "feature" ? "sprintx" : tipo === "ocorrencia" ? "runx" : tipo === "projeto" ? "buildx" : tipo === "pedido" ? "prodx" : null;
    default: return null;
  }
}
