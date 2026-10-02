// Política de skills/MCP por Pane (Fase 7, T-07.18). PURA e determinística: sem E/S, sem relógio, sem Electron.
// Entrada: modo, papel, agente, Missão, CLI, o que foi pedido no `pane_spawn`, as políticas gravadas e os itens conhecidos do catálogo.
// Saída: `PoliticaResolvida` (lista ORDENADA de nomes normalizados). Regras:
//  - `livre` não tem filtro (`skills: null`), RF-05.44;
//  - `squad`/`agentico` são deny-by-default: sem política gravada, o Pane recebe só o mínimo do papel (skills embarcadas) e o piloto, o grupo do método;
//  - precedência `agente > missão > papel` (a mais específica GANHA); o mínimo embarcado do papel sempre entra;
//  - o perfil do membro de squad (`skills_permitidas`/`mcps_permitidos`) é o nível `agente` quando não há política gravada para o agente; quando há, a lista
//    do membro ESTREITA (interseção): nunca amplia o que a política gravada permitiu;
//  - `pedidas` (pane_spawn.skills) só ESTREITA (interseção); o que sobra de fora vai em `recusadas`;
//  - nome desconhecido do catálogo vai para `faltando` e NÃO entra na lista (o Pane ignora a skill ausente).
import type { CliCatalogo, NivelIsolamento, OrigemCatalogo, PoliticaResolvida, PoliticaSkills } from "../../compartilhado/catalogo";
import { PRODUTO } from "../produto";

export type ModoPolitica = "livre" | "squad" | "agentico";
export type PapelPolitica = "piloto" | "executor" | "explorador" | "revisor" | "nenhum";

/** Nível de isolamento por CLI (D-44): só o Claude Code bloqueia de verdade (gate por hook + `permissions.deny`). Confirmado pelo teste de contrato (T-07.25). */
export const NIVEL_POR_CLI: Readonly<Record<CliCatalogo, NivelIsolamento>> = {
  claude: "duro",
  codex: "parcial",
  opencode: "parcial",
  gemini: "parcial",
  portatil: "nenhum",
};

/** Nome canônico (minúsculo, sem `-_ .` e sem espaço) do último segmento: `plugin:Frontend_Design` e `frontend design` dão o mesmo. */
export function normalizarNomeSkill(bruto: string): string {
  const ultimo = bruto.includes(":") ? (bruto.split(":").pop() ?? "") : bruto;
  return ultimo.toLowerCase().replace(/[-_.\s]+/g, "");
}

const SUFIXOS_EMBARCADAS = ["guide", "mcp", "pilot", "builder", "scout", "reviewer", "evidence-before-done"] as const;
/** As skills embarcadas do produto (`ev-*`), já normalizadas; entregues por Pane em plugin efêmero (D-43). */
export const NOMES_EMBARCADAS: readonly string[] = SUFIXOS_EMBARCADAS.map((s) => normalizarNomeSkill(`${PRODUTO.prefixoSkill}${s}`)).sort();
/** nome normalizado -> nome de exibição (`ev-pilot`): as embarcadas não precisam estar no catálogo varrido (vão por Pane). */
export const EMBARCADAS_EXIBICAO: Readonly<Record<string, string>> = Object.fromEntries(SUFIXOS_EMBARCADAS.map((s) => [normalizarNomeSkill(`${PRODUTO.prefixoSkill}${s}`), `${PRODUTO.prefixoSkill}${s}`]));
const emb = (s: (typeof SUFIXOS_EMBARCADAS)[number]): string => normalizarNomeSkill(`${PRODUTO.prefixoSkill}${s}`);

const MINIMO_POR_PAPEL: Readonly<Record<Exclude<PapelPolitica, "nenhum">, readonly string[]>> = {
  piloto: [emb("pilot"), emb("guide"), emb("mcp")],
  explorador: [emb("scout"), emb("evidence-before-done")],
  executor: [emb("builder"), emb("evidence-before-done")],
  revisor: [emb("reviewer"), emb("evidence-before-done")],
};

export interface ItemSkillCatalogo {
  nome_normalizado: string;
  /** nome de exibição (vai para `Skill(<nome>)` no deny); ausente = o normalizado */
  nome?: string;
  origem: OrigemCatalogo;
  plugin: string | null;
}

export interface EntradaPolitica {
  modo: ModoPolitica;
  papel: PapelPolitica;
  agente_id: string | null;
  mission_id: string | null;
  cli: CliCatalogo;
  /** `pane_spawn.skills`; `null` = nada pedido */
  pedidas: readonly string[] | null;
  politicas: readonly PoliticaSkills[];
  skillsDoCatalogo: readonly ItemSkillCatalogo[];
  /** o workspace tem o método instalado (`.expx/expx-lock.json`) */
  metodoInstalado: boolean;
  /** a Missão tem origem diferente de `livre` (o piloto recebe `grupo:metodo` para disparar `/expx:*`) */
  missaoComMetodo?: boolean;
  membro?: { skills_permitidas: readonly string[]; mcps_permitidos: readonly string[] } | null;
}

export interface PoliticaResolvidaDetalhada extends PoliticaResolvida {
  /** `pedidas` que não cabem na política (viram `skill_not_allowed` no `pane_spawn`) */
  recusadas: string[];
}

function expandir(entradas: readonly string[], e: EntradaPolitica, faltando: Set<string>): Set<string> {
  const conhecidos = new Set(e.skillsDoCatalogo.map((i) => i.nome_normalizado));
  const embarcadas = new Set(NOMES_EMBARCADAS);
  const saida = new Set<string>();
  for (const bruta of entradas) {
    if (typeof bruta !== "string") continue;
    const nome = bruta.trim();
    if (nome === "") continue;
    if (nome.toLowerCase() === "grupo:metodo") {
      if (e.metodoInstalado) for (const i of e.skillsDoCatalogo) if (i.origem === "metodo") saida.add(i.nome_normalizado);
      continue;
    }
    if (nome.toLowerCase() === "grupo:embarcadas") {
      for (const n of NOMES_EMBARCADAS) saida.add(n);
      continue;
    }
    if (nome.toLowerCase().startsWith("grupo:plugin:")) {
      const alvo = normalizarNomeSkill(nome.slice("grupo:plugin:".length));
      for (const i of e.skillsDoCatalogo) if (i.plugin !== null && normalizarNomeSkill(i.plugin) === alvo) saida.add(i.nome_normalizado);
      continue;
    }
    const n = normalizarNomeSkill(nome);
    if (n === "") continue;
    if (embarcadas.has(n) || conhecidos.has(n)) saida.add(n);
    else faltando.add(nome.slice(0, 80));
  }
  return saida;
}

function maisEspecifica(e: EntradaPolitica): PoliticaSkills | null {
  const por = (tipo: PoliticaSkills["alvo_tipo"], valor: string | null): PoliticaSkills | null =>
    valor === null ? null : (e.politicas.find((p) => p.alvo_tipo === tipo && p.alvo_valor === valor) ?? null);
  return por("agente", e.agente_id) ?? por("missao", e.mission_id) ?? por("papel", e.papel);
}

const ordenar = (s: Iterable<string>): string[] => [...s].sort();
const isolamentoTodas = (): Record<CliCatalogo, NivelIsolamento> => ({ ...NIVEL_POR_CLI });

export function resolverPolitica(e: EntradaPolitica): PoliticaResolvidaDetalhada {
  const isolamento = isolamentoTodas();
  if (e.modo === "livre") {
    return { skills: null, faltando: [], mcp_do_usuario: "lista", servidores_mcp: [], isolamento, recusadas: [] };
  }
  const faltando = new Set<string>();
  const minimo = new Set<string>();
  if (e.papel !== "nenhum") {
    for (const n of MINIMO_POR_PAPEL[e.papel]) minimo.add(n);
    if (e.papel === "piloto" && e.metodoInstalado && e.missaoComMetodo !== false) {
      for (const i of e.skillsDoCatalogo) if (i.origem === "metodo") minimo.add(i.nome_normalizado);
    }
  }
  const gravada = maisEspecifica(e);
  const doMembro = e.membro != null && e.membro.skills_permitidas.length > 0 ? expandir(e.membro.skills_permitidas, e, faltando) : null;
  let permitidas: Set<string>;
  if (gravada !== null) {
    permitidas = expandir(gravada.skills, e, faltando);
    if (doMembro !== null) permitidas = new Set([...permitidas].filter((n) => doMembro.has(n))); // perfil do membro só estreita a política gravada
  } else if (doMembro !== null) {
    permitidas = doMembro; // sem política gravada para o agente: o perfil do membro É o nível agente
  } else {
    permitidas = new Set();
  }
  for (const n of minimo) permitidas.add(n);

  const recusadas: string[] = [];
  if (e.pedidas !== null) {
    const pedidas = new Set(e.pedidas.map(normalizarNomeSkill).filter((n) => n !== ""));
    for (const bruta of e.pedidas) if (!permitidas.has(normalizarNomeSkill(bruta)) && bruta.trim() !== "") recusadas.push(bruta.trim().slice(0, 80));
    permitidas = new Set([...permitidas].filter((n) => pedidas.has(n)));
    // o mínimo do papel (instruções do produto) nunca some por um pedido estreito
    for (const n of minimo) permitidas.add(n);
  }

  // MCP de usuário: padrão `nenhum`; a política gravada (agente > missão > papel) ou o perfil do membro abrem uma lista
  let mcp_do_usuario: "nenhum" | "lista" = "nenhum";
  let servidores = new Set<string>();
  if (gravada !== null && gravada.mcp_do_usuario === "lista") {
    mcp_do_usuario = "lista";
    servidores = new Set(gravada.servidores_mcp.map(normalizarNomeSkill));
  }
  if (e.membro != null && e.membro.mcps_permitidos.length > 0) {
    const doMembroMcp = new Set(e.membro.mcps_permitidos.map(normalizarNomeSkill));
    if (mcp_do_usuario === "lista") servidores = new Set([...servidores].filter((s) => doMembroMcp.has(s))); // só estreita
    else if (gravada === null) { mcp_do_usuario = "lista"; servidores = doMembroMcp; }
  }
  if (mcp_do_usuario === "lista" && servidores.size === 0) mcp_do_usuario = "nenhum";

  return { skills: ordenar(permitidas), faltando: ordenar(faltando), mcp_do_usuario, servidores_mcp: ordenar(servidores), isolamento, recusadas };
}

/**
 * Filtro do membro sobre os servidores da LOJA habilitados para o Pane (`mcps_permitidos`): devolve só os ids que o membro pode usar.
 * Lista vazia do membro = sem restrição declarada (a habilitação da Loja manda); com lista, é interseção (nunca amplia).
 */
export function filtrarServidoresDoMembro(habilitados: readonly string[], membro: { mcps_permitidos: readonly string[] } | null | undefined): string[] {
  if (membro == null || membro.mcps_permitidos.length === 0) return [...habilitados];
  const ok = new Set(membro.mcps_permitidos.map(normalizarNomeSkill));
  return habilitados.filter((id) => ok.has(normalizarNomeSkill(id)));
}
