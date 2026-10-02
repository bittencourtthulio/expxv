import type { NomeIcone } from "../../componentes/Icone";
// Lógica PURA da tela Catálogo (Fase 7): abas, badges por CLI, filtros/ordenação/agrupamento sobre o cache, motivos de somente leitura e
// mensagens nominais. Nada aqui toca `window.ade` nem o DOM. Descrição de item é dado de terceiro: sempre texto, nunca HTML.
import { criarIndice, type IndiceFuzzy } from "../../busca-fuzzy";
import { CLIS_CATALOGO, type CliCatalogo, type ItemCatalogo, type OrigemCatalogo, type TipoCatalogo, type NivelIsolamento } from "../../../compartilhado/catalogo";

export const ALTURA_LINHA = 36;
/** Teto de linhas no DOM da tabela (P-25). */
export const MAX_LINHAS_DOM = 80;

export const ABAS: ReadonlyArray<{ tipo: TipoCatalogo; rotulo: string; singular: string; icone: NomeIcone }> = [
  { tipo: "skill", rotulo: "Skills", singular: "skill", icone: "catalogo" },
  { tipo: "agent", rotulo: "Agentes", singular: "agente", icone: "squads" },
  { tipo: "command", rotulo: "Comandos", singular: "comando", icone: "terminais" },
  { tipo: "mcp_server", rotulo: "MCPs", singular: "servidor MCP", icone: "loja" },
  { tipo: "plugin", rotulo: "Plugins", singular: "plugin", icone: "provedores" },
  { tipo: "hook", rotulo: "Hooks", singular: "hook", icone: "harness" },
  { tipo: "rule", rotulo: "Regras", singular: "regra", icone: "relatorios" },
];

export const CLIS: ReadonlyArray<{ cli: CliCatalogo; rotulo: string; sigla: string }> = [
  { cli: "claude", rotulo: "Claude Code", sigla: "CC" },
  { cli: "codex", rotulo: "Codex", sigla: "CX" },
  { cli: "opencode", rotulo: "OpenCode", sigla: "OC" },
  { cli: "gemini", rotulo: "Gemini", sigla: "GM" },
  { cli: "portatil", rotulo: ".agents", sigla: "AG" },
];
export const rotuloCli = (c: CliCatalogo): string => CLIS.find((x) => x.cli === c)?.rotulo ?? c;

export const ROTULO_ORIGEM: Readonly<Record<OrigemCatalogo, string>> = { usuario: "seu", terceiro: "terceiro", embarcada: "embarcada", nativa: "nativa", metodo: "método" };
export const ORIGENS: readonly OrigemCatalogo[] = ["usuario", "terceiro", "embarcada", "nativa", "metodo"];

export type EstadoFiltro = "todos" | "presente" | "ausente" | "quebrado";
export interface FiltrosCatalogo {
  busca: string;
  clis: readonly CliCatalogo[];
  origem: OrigemCatalogo | "todas";
  estado: EstadoFiltro;
  soDivergentes: boolean;
  agrupar: boolean;
  ordem: "nome" | "origem";
}
export const FILTROS_VAZIOS: FiltrosCatalogo = { busca: "", clis: [], origem: "todas", estado: "todos", soDivergentes: false, agrupar: false, ordem: "nome" };
export const temFiltroAtivo = (f: FiltrosCatalogo): boolean =>
  f.busca.trim() !== "" || f.clis.length > 0 || f.origem !== "todas" || f.estado !== "todos" || f.soDivergentes;

/** Texto indexado pela busca fuzzy (uma vez por lista; a digitação nunca gera IPC). */
export const textoDoItem = (i: ItemCatalogo): string => `${i.nome} ${i.plugin ?? ""} ${i.autor ?? ""} ${ROTULO_ORIGEM[i.origem]} ${i.descricao ?? ""}`;
export const criarIndiceItens = (itens: readonly ItemCatalogo[]): IndiceFuzzy<ItemCatalogo> => criarIndice(itens, textoDoItem);

// ---- badges ----
export interface BadgeCli { cli: CliCatalogo; simbolo: "●" | "◐" | "○" | "!" | "·"; texto: string; tom: "ok" | "projeto" | "ausente" | "quebrado" | "nenhum" }
export function badgeDe(item: ItemCatalogo, cli: CliCatalogo): BadgeCli {
  const deste = item.instalacoes.filter((x) => x.cli === cli);
  if (deste.length === 0) return { cli, simbolo: "·", texto: "não instalada", tom: "nenhum" };
  const presentes = deste.filter((x) => x.estado === "presente");
  if (presentes.some((x) => x.escopo === "global")) return { cli, simbolo: "●", texto: "global", tom: "ok" };
  if (presentes.length > 0) return { cli, simbolo: "◐", texto: "projeto", tom: "projeto" };
  if (deste.some((x) => x.estado === "quebrado")) return { cli, simbolo: "!", texto: "quebrado", tom: "quebrado" };
  return { cli, simbolo: "○", texto: "ausente", tom: "ausente" };
}
const estadoDoItem = (i: ItemCatalogo, cli: CliCatalogo | null): Set<string> => {
  const s = new Set<string>();
  for (const x of i.instalacoes) if (cli === null || x.cli === cli) s.add(x.estado);
  return s;
};
export const quantosAusentes = (itens: readonly ItemCatalogo[]): number =>
  itens.filter((i) => i.instalacoes.length > 0 && i.instalacoes.every((x) => x.estado !== "presente")).length;
export const itemTemPresente = (i: ItemCatalogo): boolean => i.instalacoes.some((x) => x.estado === "presente");

// ---- filtro / ordenação ----
export function filtrarItens(itens: readonly ItemCatalogo[], f: FiltrosCatalogo, indice?: IndiceFuzzy<ItemCatalogo>): ItemCatalogo[] {
  let base: readonly ItemCatalogo[] = itens;
  const q = f.busca.trim();
  if (q !== "") base = (indice ?? criarIndiceItens(itens)).buscar(q, itens.length);
  const ehFiltrado = f.clis.length > 0 || f.origem !== "todas" || f.estado !== "todos" || f.soDivergentes;
  const passa = (i: ItemCatalogo): boolean => {
    if (f.origem !== "todas" && i.origem !== f.origem) return false;
    if (f.soDivergentes && i.variantes < 2) return false;
    if (f.clis.length > 0 && !i.instalacoes.some((x) => (f.clis as readonly string[]).includes(x.cli))) return false;
    if (f.estado !== "todos") {
      const alvos = f.clis.length > 0 ? f.clis : [null];
      if (!alvos.some((c) => estadoDoItem(i, c).has(f.estado))) return false;
    }
    return true;
  };
  const saida = ehFiltrado ? base.filter(passa) : [...base];
  if (q === "") {
    saida.sort(f.ordem === "origem" ? (a, b) => a.origem.localeCompare(b.origem) || a.nome_normalizado.localeCompare(b.nome_normalizado) : (a, b) => a.nome_normalizado.localeCompare(b.nome_normalizado));
  }
  return saida;
}

// ---- agrupamento (cabeçalho recolhível, virtualizado junto) ----
export type LinhaTabela =
  | { tipo: "grupo"; chave: string; rotulo: string; n: number; recolhido: boolean }
  | { tipo: "item"; chave: string; item: ItemCatalogo };
export const rotuloGrupo = (i: ItemCatalogo): string => i.plugin ?? i.autor ?? "Sem plugin";
export function montarLinhas(itens: readonly ItemCatalogo[], agrupar: boolean, recolhidos: ReadonlySet<string>): LinhaTabela[] {
  if (!agrupar) return itens.map((item) => ({ tipo: "item", chave: item.id, item }));
  const grupos = new Map<string, ItemCatalogo[]>();
  for (const i of itens) {
    const g = rotuloGrupo(i);
    const l = grupos.get(g);
    if (l === undefined) grupos.set(g, [i]); else l.push(i);
  }
  const ordem = [...grupos.keys()].sort((a, b) => (a === "Sem plugin" ? 1 : b === "Sem plugin" ? -1 : a.localeCompare(b)));
  const linhas: LinhaTabela[] = [];
  for (const g of ordem) {
    const l = grupos.get(g) as ItemCatalogo[];
    const rec = recolhidos.has(g);
    linhas.push({ tipo: "grupo", chave: `g:${g}`, rotulo: g, n: l.length, recolhido: rec });
    if (!rec) for (const item of l) linhas.push({ tipo: "item", chave: item.id, item });
  }
  return linhas;
}

// ---- somente leitura / ações permitidas ----
/** `null` = editável/gerenciável pelo app; senão, o motivo mostrado ao lado do botão desabilitado. */
export function motivoSomenteLeitura(i: ItemCatalogo): string | null {
  if (i.origem === "metodo") return "Gerenciado pelo método Expx: use expxdev update; o app não altera.";
  if (i.plugin !== null) return `Gerenciado pelo plugin ${i.plugin}: altere pelo gerenciador de plugins da CLI.`;
  if (i.origem === "terceiro") return "Item de terceiro: o app só lista; altere pelo gerenciador do autor.";
  if (i.origem === "nativa") return "Item nativo da CLI: o app só lista.";
  return null;
}
/** Instalar por symlink/cópia só vale para skills, agentes e comandos que sejam do usuário ou embarcados. */
export const TIPOS_INSTALAVEIS: readonly TipoCatalogo[] = ["skill", "agent", "command"];
export const podeInstalar = (i: ItemCatalogo): boolean => TIPOS_INSTALAVEIS.includes(i.tipo) && motivoInstalar(i) === null;
export function motivoInstalar(i: ItemCatalogo): string | null {
  if (!TIPOS_INSTALAVEIS.includes(i.tipo)) return "Este tipo só pode ser listado, não instalado.";
  if (i.origem === "metodo" || i.plugin !== null || i.origem === "terceiro") return motivoSomenteLeitura(i);
  return null;
}
/** CLIs onde o item ainda não existe presente (alvos de "Instalar em…"). */
export const clisSemItem = (i: ItemCatalogo): CliCatalogo[] =>
  CLIS_CATALOGO.filter((c) => !i.instalacoes.some((x) => x.cli === c && x.estado === "presente"));
/** Fonte da cópia: primeira CLI com instalação presente. */
export const fonteDoItem = (i: ItemCatalogo): CliCatalogo | null => i.instalacoes.find((x) => x.estado === "presente")?.cli ?? null;

// ---- mensagens ----
const CODIGOS: Readonly<Record<string, string>> = {
  conflito: "Já existe algo com esse nome na CLI de destino; nada foi sobrescrito.",
  ja_instalado: "Já estava instalado nessa CLI.",
  nome_invalido: "Nome inválido para instalação.",
  fonte_invalida: "A fonte não contém uma skill válida.",
  fora_das_raizes: "O caminho fica fora das pastas conhecidas das CLIs.",
  gerenciado_pelo_metodo: "Gerenciado pelo método Expx: o app não altera.",
  gerenciado_pelo_plugin: "Gerenciado por um plugin: altere pela CLI.",
  nao_criado_pelo_app: "O app não criou este item: use a lixeira.",
  confirmacao_necessaria: "Confirme a ação antes de continuar.",
  indisponivel: "Servidor indisponível ou não respondeu a tempo.",
};
export const mensagemDoCodigo = (c: string | null): string => (c === null ? "Não foi possível concluir." : (CODIGOS[c] ?? `Não foi possível concluir (${c}).`));
export function mensagemDoErro(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return m.trim() === "" ? "Não foi possível falar com o aplicativo." : m.slice(0, 200);
}
export const rotuloIsolamento = (n: NivelIsolamento): string => (n === "duro" ? "duro" : n === "parcial" ? "parcial" : "nenhum");
export const explicacaoIsolamento = (n: NivelIsolamento): string =>
  n === "duro" ? "Bloqueio imposto em código (inclusive em modo automático)." : n === "parcial" ? "Isolamento parcial: a lista vai como instrução e o gate de MCP vale; a CLI não bloqueia sozinha." : "Sem isolamento nesta CLI.";
/** Hash curto para a gaveta. */
export const hashCurto = (h: string | null): string => (h === null ? "—" : h.slice(0, 10));
export const ehItemDeMcp = (t: TipoCatalogo): boolean => t === "mcp_server";
export const ehSomenteLeituraDoTipo = (t: TipoCatalogo): boolean => t === "hook" || t === "rule" || t === "plugin";
/** Texto da linha "n ausentes". */
export const textoAusentes = (n: number): string => `${n} ${n === 1 ? "ausente" : "ausentes"}`;
export const textoContagem = (visiveis: number, total: number): string => (visiveis === total ? `${total}` : `${visiveis} de ${total}`);
/** Rótulo do filtro de estado (título do select quando o valor fecha curto). */
export const ROTULO_ESTADO: Readonly<Record<EstadoFiltro, string>> = { todos: "Qualquer estado", presente: "Presente", ausente: "Ausente", quebrado: "Quebrado" };
