import { describe, expect, it } from "vitest";
import type { PoliticaSkills } from "../../compartilhado/catalogo";
import { NIVEL_POR_CLI, NOMES_EMBARCADAS, filtrarServidoresDoMembro, normalizarNomeSkill, resolverPolitica, type EntradaPolitica, type ItemSkillCatalogo } from "./politica";

const CAT: ItemSkillCatalogo[] = [
  { nome_normalizado: "frontenddesign", nome: "frontend-design", origem: "terceiro", plugin: "fd" },
  { nome_normalizado: "sprintx", nome: "sprintx", origem: "metodo", plugin: null },
  { nome_normalizado: "runx", nome: "runx", origem: "metodo", plugin: null },
  { nome_normalizado: "pdf", nome: "pdf", origem: "usuario", plugin: null },
  { nome_normalizado: "xlsx", nome: "xlsx", origem: "usuario", plugin: "docs" },
  { nome_normalizado: "docx", nome: "docx", origem: "usuario", plugin: "docs" },
];
const base = (extra: Partial<EntradaPolitica> = {}): EntradaPolitica => ({
  modo: "squad", papel: "executor", agente_id: null, mission_id: "mis_1", cli: "claude", pedidas: null, politicas: [], skillsDoCatalogo: CAT, metodoInstalado: true, ...extra,
});
const pol = (alvo_tipo: PoliticaSkills["alvo_tipo"], alvo_valor: string, skills: string[], extra: Partial<PoliticaSkills> = {}): PoliticaSkills => ({
  id: `p_${alvo_tipo}_${alvo_valor}`, workspace_id: "ws", alvo_tipo, alvo_valor, skills, mcp_do_usuario: "nenhum", servidores_mcp: [], atualizado_em: "2026-10-01T00:00:00.000Z", ...extra,
});
const MIN_EXEC = ["evbuilder", "evevidencebeforedone"];

describe("normalizarNomeSkill", () => {
  it.each([
    ["frontend-design", "frontenddesign"], ["Frontend_Design", "frontenddesign"], ["frontend design", "frontenddesign"],
    ["plugin:Frontend.Design", "frontenddesign"], ["expx:sprintx", "sprintx"], ["", ""],
  ])("%s", (a, b) => expect(normalizarNomeSkill(a)).toBe(b));
});

describe("resolverPolitica", () => {
  it("livre: sem filtro (skills null), todos os níveis por CLI", () => {
    const r = resolverPolitica(base({ modo: "livre", papel: "nenhum" }));
    expect(r.skills).toBeNull();
    expect(r.isolamento).toEqual(NIVEL_POR_CLI);
  });
  it("deny-by-default: sem política, só o mínimo do papel", () => {
    expect(resolverPolitica(base()).skills).toEqual(MIN_EXEC);
    expect(resolverPolitica(base({ papel: "explorador" })).skills).toEqual(["evevidencebeforedone", "evscout"]);
    expect(resolverPolitica(base({ papel: "revisor" })).skills).toEqual(["evevidencebeforedone", "evreviewer"]);
  });
  it("piloto: ev-pilot/guide/mcp + grupo do método quando o método está instalado", () => {
    expect(resolverPolitica(base({ papel: "piloto" })).skills).toEqual(["evguide", "evmcp", "evpilot", "runx", "sprintx"]);
    expect(resolverPolitica(base({ papel: "piloto", metodoInstalado: false })).skills).toEqual(["evguide", "evmcp", "evpilot"]);
    expect(resolverPolitica(base({ papel: "piloto", missaoComMetodo: false })).skills).toEqual(["evguide", "evmcp", "evpilot"]);
  });
  it("política gravada soma ao mínimo; nome inexistente vai para faltando", () => {
    const r = resolverPolitica(base({ politicas: [pol("papel", "executor", ["pdf", "Frontend_Design", "nao-existe"])] }));
    expect(r.skills).toEqual([...MIN_EXEC, "frontenddesign", "pdf"].sort());
    expect(r.faltando).toEqual(["nao-existe"]);
  });
  it("grupos: metodo, embarcadas, plugin:<nome>", () => {
    const r = resolverPolitica(base({ politicas: [pol("papel", "executor", ["grupo:metodo", "grupo:plugin:docs"])] }));
    expect(r.skills).toEqual(expect.arrayContaining(["sprintx", "runx", "xlsx", "docx"]));
    expect(r.skills).not.toContain("pdf");
    expect(resolverPolitica(base({ politicas: [pol("papel", "executor", ["grupo:embarcadas"])] })).skills).toEqual([...NOMES_EMBARCADAS]);
    expect(resolverPolitica(base({ metodoInstalado: false, politicas: [pol("papel", "executor", ["grupo:metodo"])] })).skills).toEqual(MIN_EXEC);
  });
  it("precedência agente > missão > papel (a mais específica ganha, o mínimo sempre entra)", () => {
    const politicas = [pol("papel", "executor", ["pdf"]), pol("missao", "mis_1", ["xlsx"]), pol("agente", "ag_1", ["docx"])];
    expect(resolverPolitica(base({ politicas, agente_id: "ag_1" })).skills).toEqual([...MIN_EXEC, "docx"].sort());
    expect(resolverPolitica(base({ politicas })).skills).toEqual([...MIN_EXEC, "xlsx"].sort());
    expect(resolverPolitica(base({ politicas: [politicas[0] as PoliticaSkills] })).skills).toEqual([...MIN_EXEC, "pdf"].sort());
  });
  it("pedidas só ESTREITA; o excedente vira recusadas", () => {
    const politicas = [pol("papel", "executor", ["pdf", "xlsx"])];
    const r = resolverPolitica(base({ politicas, pedidas: ["pdf", "docx"] }));
    expect(r.skills).toEqual([...MIN_EXEC, "pdf"].sort());
    expect(r.recusadas).toEqual(["docx"]);
  });
  it("membro de squad: sem política gravada o perfil é o nível agente", () => {
    const r = resolverPolitica(base({ agente_id: "ag_1", membro: { skills_permitidas: ["pdf", "frontend-design"], mcps_permitidos: [] } }));
    expect(r.skills).toEqual([...MIN_EXEC, "frontenddesign", "pdf"].sort());
  });
  it("membro de squad: com política gravada a lista do membro só ESTREITA (nunca amplia)", () => {
    const politicas = [pol("agente", "ag_1", ["pdf", "xlsx"])];
    const r = resolverPolitica(base({ politicas, agente_id: "ag_1", membro: { skills_permitidas: ["xlsx", "docx"], mcps_permitidos: [] } }));
    expect(r.skills).toEqual([...MIN_EXEC, "xlsx"].sort());
  });
  it("membro com lista vazia não restringe nem amplia", () => {
    expect(resolverPolitica(base({ agente_id: "ag_1", membro: { skills_permitidas: [], mcps_permitidos: [] } })).skills).toEqual(MIN_EXEC);
  });
  it("MCP de usuário: padrão nenhum; política em lista; membro estreita e pode abrir sem política", () => {
    expect(resolverPolitica(base()).mcp_do_usuario).toBe("nenhum");
    const abre = resolverPolitica(base({ politicas: [pol("papel", "executor", [], { mcp_do_usuario: "lista", servidores_mcp: ["github", "slack"] })] }));
    expect(abre).toMatchObject({ mcp_do_usuario: "lista", servidores_mcp: ["github", "slack"] });
    const estreito = resolverPolitica(base({ agente_id: "a", membro: { skills_permitidas: [], mcps_permitidos: ["slack", "outro"] }, politicas: [pol("papel", "executor", [], { mcp_do_usuario: "lista", servidores_mcp: ["github", "slack"] })] }));
    expect(estreito.servidores_mcp).toEqual(["slack"]);
    expect(resolverPolitica(base({ agente_id: "a", membro: { skills_permitidas: [], mcps_permitidos: ["github"] } }))).toMatchObject({ mcp_do_usuario: "lista", servidores_mcp: ["github"] });
    // lista vazia não abre nada
    expect(resolverPolitica(base({ politicas: [pol("papel", "executor", [], { mcp_do_usuario: "lista", servidores_mcp: [] })] })).mcp_do_usuario).toBe("nenhum");
  });
  it("determinístico e ordenado; 200 skills em ≤ 25 ms", () => {
    const grande = Array.from({ length: 200 }, (_, i) => ({ nome_normalizado: `skill${String(i).padStart(3, "0")}`, origem: "usuario" as const, plugin: null }));
    const entrada = base({ skillsDoCatalogo: grande, politicas: [pol("papel", "executor", [...grande].reverse().map((g) => g.nome_normalizado))] });
    const t = performance.now();
    const a = resolverPolitica(entrada);
    expect(performance.now() - t).toBeLessThan(25);
    expect(a.skills).toEqual(resolverPolitica(entrada).skills);
    expect(a.skills).toEqual([...(a.skills as string[])].sort());
  });
  it("propriedade: resultado ⊆ política gravada ∪ mínimo (nenhuma skill de fora entra)", () => {
    for (let i = 0; i < 100; i++) {
      const escolha = CAT.filter(() => Math.random() < 0.5).map((c) => c.nome_normalizado);
      const r = resolverPolitica(base({ politicas: [pol("papel", "executor", escolha)] })).skills as string[];
      for (const s of r) expect([...escolha, ...MIN_EXEC]).toContain(s);
    }
  });
  it("entradas hostis (não-string, vazio) não quebram", () => {
    expect(() => resolverPolitica(base({ politicas: [pol("papel", "executor", [null as never, 3 as never, "  ", "ok"])] }))).not.toThrow();
  });
});

describe("filtrarServidoresDoMembro", () => {
  it("sem lista: a habilitação da Loja manda; com lista: interseção", () => {
    expect(filtrarServidoresDoMembro(["a", "b"], null)).toEqual(["a", "b"]);
    expect(filtrarServidoresDoMembro(["a", "b"], { mcps_permitidos: [] })).toEqual(["a", "b"]);
    expect(filtrarServidoresDoMembro(["a", "b"], { mcps_permitidos: ["b", "z"] })).toEqual(["b"]);
  });
});
