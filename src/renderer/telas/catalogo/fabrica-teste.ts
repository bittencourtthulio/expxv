// Fábricas de teste da tela Catálogo (sem Electron): itens, instalações e uma `window.ade.catalogo` falsa.
import type { CliCatalogo, DetalheCatalogo, InstalacaoCatalogo, ItemCatalogo, OrigemCatalogo, TipoCatalogo } from "../../../compartilhado/catalogo";
import type { ApiAde } from "../../../compartilhado/ipc";

export function inst(cli: CliCatalogo, o: Partial<InstalacaoCatalogo> = {}): InstalacaoCatalogo {
  return { cli, escopo: "global", workspace_id: null, base: "home", caminho_rel: `.${cli}/skills/x`, metodo: "nativo", estado: "presente", habilitada: true, criado_pelo_app: false, hash_conteudo: "abcdef0123456789", detalhe: {}, ...o };
}
export function item(nome: string, o: Partial<ItemCatalogo> = {}): ItemCatalogo {
  return {
    id: `cat_${nome}`, tipo: "skill", nome, nome_normalizado: nome.toLowerCase().replace(/[-_ .]/g, ""), plugin: null, autor: null, origem: "usuario", descricao: `Descrição de ${nome}`,
    papel_sugerido: null, instalacoes: [inst("claude")], variantes: 1, editavel: true, atualizado_em: "2026-10-01T00:00:00.000Z", ...o,
  };
}
export const muitos = (n: number, tipo: TipoCatalogo = "skill"): ItemCatalogo[] =>
  Array.from({ length: n }, (_, i) => item(`skill-${String(i).padStart(5, "0")}`, { tipo, instalacoes: [inst(i % 2 === 0 ? "claude" : "codex"), ...(i % 3 === 0 ? [inst("opencode", { estado: "ausente" })] : [])], plugin: i % 10 === 0 ? `plugin-${i % 7}` : null, origem: (["usuario", "terceiro", "nativa"] as OrigemCatalogo[])[i % 3] as OrigemCatalogo }));

export const ITENS_PADRAO: ItemCatalogo[] = [
  item("frontend-design", { instalacoes: [inst("claude"), inst("codex", { metodo: "symlink", criado_pelo_app: true })] }),
  item("sprintx", { origem: "metodo", editavel: false, instalacoes: [inst("claude", { escopo: "projeto", workspace_id: "w1", base: "workspace" })] }),
  item("antiga", { instalacoes: [inst("claude", { estado: "ausente" })] }),
  item("de-plugin", { origem: "terceiro", plugin: "meu-plugin", editavel: false }),
  item("divergente", { variantes: 2, instalacoes: [inst("claude"), inst("codex", { hash_conteudo: "ffff" })] }),
];

export type ApiCatalogoFalsa = ApiAde["catalogo"];
export interface OpcoesFalsa { itens?: ItemCatalogo[]; porTipo?: Partial<Record<TipoCatalogo, ItemCatalogo[]>> }

export function catalogoFalso(o: OpcoesFalsa = {}): ApiCatalogoFalsa {
  const itens = o.itens ?? ITENS_PADRAO;
  return {
    varrer: async () => ({ varredura_id: "v1" }),
    listar: async ({ tipo }) => ({ itens: o.porTipo?.[tipo] ?? (tipo === "skill" ? itens : []), truncado: false, ultima_varredura_em: "2026-10-01T00:00:00.000Z" }),
    detalhe: async (id) => { const i = itens.find((x) => x.id === id); return i === undefined ? null : ({ ...i, ferramentas: [] } satisfies DetalheCatalogo); },
    instalar: async () => ({ estado: "instalado", caminho_rel: ".codex/skills/x", codigo: null }),
    desinstalar: async () => ({ ok: true, codigo: null }),
    limparAusentes: async () => ({ removidos: 1 }),
    removerDoCatalogo: async () => ({ ok: true }),
    revelar: async () => true,
    verificarMcp: async () => ({ estado: "ok", ferramentas: 3, erro: null }),
    politicaLer: async () => [],
    politicaGravar: async (p) => ({ id: "pol_1", workspace_id: p.workspace_id, alvo_tipo: p.alvo_tipo, alvo_valor: p.alvo_valor, skills: p.skills, mcp_do_usuario: p.mcp_do_usuario, servidores_mcp: p.servidores_mcp, atualizado_em: "x" }),
    politicaPrevia: async () => ({ skills: ["ev-builder"], faltando: ["inexistente"], mcp_do_usuario: "nenhum", servidores_mcp: [], isolamento: { claude: "duro", codex: "parcial", opencode: "parcial", gemini: "parcial", portatil: "parcial" } }),
    saude: async () => [],
    embarcadasEstado: async () => [{ nome: "ev-guide", versao_pacote: "1.0.0", descricao: "Como o app funciona", clis: [{ cli: "claude", instalada: false, versao: null, editada: false, opt_out: false }, { cli: "codex", instalada: true, versao: "1.0.0", editada: true, opt_out: false }] }],
    embarcadasInstalar: async () => ({ instaladas: ["ev-guide"], preservadas_editadas: [] }),
    embarcadasOptOut: async () => ({ ok: true }),
    assinar: () => () => undefined,
  };
}
