import { describe, expect, it } from "vitest";
import type { ItemCatalogo, PoliticaSkills } from "../../compartilhado/catalogo";
import { avaliarSaude } from "./saude";

const niveis = { claude: "duro", codex: "parcial", opencode: "parcial", gemini: "parcial", portatil: "nenhum" } as const;
const item = (o: Partial<ItemCatalogo>): ItemCatalogo => ({ id: "cat_1", tipo: "skill", nome: "a", nome_normalizado: "a", plugin: null, autor: null, origem: "usuario", descricao: "d", papel_sugerido: null, instalacoes: [{ cli: "claude", escopo: "global", workspace_id: null, base: "home", caminho_rel: "x", metodo: "nativo", estado: "presente", habilitada: true, criado_pelo_app: false, hash_conteudo: "h", detalhe: {} }], variantes: 1, editavel: true, atualizado_em: "t", ...o });
const pol = (skills: string[]): PoliticaSkills => ({ id: "p", workspace_id: "w", alvo_tipo: "papel", alvo_valor: "executor", skills, mcp_do_usuario: "nenhum", servidores_mcp: [], atualizado_em: "t" });

describe("saúde", () => {
  const base = { mcpVerificados: new Set<string>(), niveis, clisEmUso: [] as never[] };
  it("máquina limpa sem política: nenhum erro", () => {
    expect(avaliarSaude({ ...base, politicas: [], itens: [item({})], skillsPresentes: new Set(["a"]) })).toEqual([]);
  });
  it("skill inexistente na política = erro (grupos são ignorados)", () => {
    const r = avaliarSaude({ ...base, politicas: [pol(["a", "fantasma", "grupo:metodo"])], itens: [], skillsPresentes: new Set(["a"]) });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ nivel: "erro", codigo: "skill_inexistente", item: "fantasma" });
  });
  it("descrição vazia, symlink quebrado, variantes, MCP não verificado e isolamento parcial", () => {
    const r = avaliarSaude({
      ...base, politicas: [], skillsPresentes: new Set(), clisEmUso: ["codex", "claude"],
      itens: [item({ descricao: null }), item({ id: "cat_2", nome: "q", instalacoes: [{ ...item({}).instalacoes[0]!, estado: "quebrado" }] }), item({ id: "cat_3", nome: "v", variantes: 3 }), item({ id: "cat_4", tipo: "mcp_server", nome: "m" })],
    });
    expect(r.map((x) => x.codigo).sort()).toEqual(["descricao_vazia", "isolamento_parcial", "mcp_nao_verificado", "symlink_quebrado", "variantes_divergentes"]);
    expect(r.find((x) => x.codigo === "isolamento_parcial")?.item).toBe("codex");
  });
});
