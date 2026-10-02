import { describe, expect, it } from "vitest";
import type { EtapaExec, NivelRigidez } from "../../../compartilhado/maestro";
import { execDoPlano } from "../maquina";
import { criarPortaNivelRigidez, deveVoltarAoPadrao, lembreteAoConcluir, lembreteDeNivelBaixo, replanejarExecs, resolverNivel } from "./escopos";
import { EVIDENCIA_VAZIA, planoDeEtapas } from "./plano-de-etapas";

describe("resolverNivel: pedido > Missão > squad > workspace > 3", () => {
  const niveis = [null, 1, 5] as const;
  it("tabela de precedência (16 combinações com a ordem completa)", () => {
    let casos = 0;
    for (const pedido of [null, 1]) for (const missao of [null, 2]) for (const squad of [null, 4]) for (const workspace of [null, 5]) {
      const r = resolverNivel({ pedido, missao, squad, workspace });
      const esperado = pedido ?? missao ?? squad ?? workspace ?? 3;
      const origem = pedido !== null ? "pedido" : missao !== null ? "missao" : squad !== null ? "squad" : workspace !== null ? "workspace" : "padrao";
      expect(r.efetivo).toBe(esperado);
      expect(r.origem).toBe(origem);
      casos++;
    }
    expect(casos).toBe(16);
    void niveis;
  });
  it("sem nada ⇒ padrão 3; valor inválido é ignorado", () => {
    expect(resolverNivel({})).toMatchObject({ efetivo: 3, origem: "padrao" });
    expect(resolverNivel({ pedido: 9, missao: 0, workspace: 4 })).toMatchObject({ efetivo: 4, origem: "workspace" });
    expect(resolverNivel({ pedido: null, workspace: 2.5 })).toMatchObject({ efetivo: 3 });
  });
  it("P5: nível efetivo ≥ mínimo travado, salvo override registrado", () => {
    for (const base of [1, 2, 3, 4, 5] as const) for (const min of [1, 4] as const) {
      const r = resolverNivel({ workspace: base, minimo_travado: min });
      expect(r.efetivo).toBeGreaterThanOrEqual(min);
      expect(r.elevado_pela_trava).toBe(base < min);
      expect(r.minimo_travado).toBe(min);
    }
    expect(resolverNivel({ workspace: 2, minimo_travado: 4, motivo_trava: "raio ALTO" })).toMatchObject({ efetivo: 4, elevado_pela_trava: true, motivo_trava: "raio ALTO" });
    expect(resolverNivel({ pedido: 2, minimo_travado: 4, override_trava: true })).toMatchObject({ efetivo: 2, elevado_pela_trava: false });
  });
});

describe("PortaNivelRigidez (Fase 14)", () => {
  it("lê Missão > squad > workspace pelos leitores; falha ⇒ padrão", async () => {
    const porta = criarPortaNivelRigidez({ workspace: async () => 4, missao: async (id) => (id === "m1" ? 2 : null), squad: async (_w, s) => (s === "sq" ? 5 : null) });
    expect(await porta.efetivo({ workspace_id: "w", mission_id: "m1", squad_slug: "sq", membro_slug: null })).toBe(2);
    expect(await porta.efetivo({ workspace_id: "w", mission_id: null, squad_slug: "sq", membro_slug: null })).toBe(5);
    expect(await porta.efetivo({ workspace_id: "w", mission_id: null, squad_slug: null, membro_slug: null })).toBe(4);
    const quebrada = criarPortaNivelRigidez({ workspace: async () => { throw new Error("x"); }, missao: async () => null });
    expect(await quebrada.efetivo({ workspace_id: "w", mission_id: null, squad_slug: null, membro_slug: null })).toBe(3);
  });
});

const execsDe = (pipeline: "runx" | "sprintx", nivel: NivelRigidez): EtapaExec[] => planoDeEtapas(pipeline, nivel, { evidencia: EVIDENCIA_VAZIA }).map((e) => execDoPlano(e, nivel));
const marcar = (execs: EtapaExec[], estados: Record<string, EtapaExec["estado"]>): EtapaExec[] => execs.map((e) => ({ ...e, estado: estados[e.etapa_id] ?? e.estado }));
const ctxPlano = { evidencia: EVIDENCIA_VAZIA };
const AGORA = "2026-10-01T10:00:00.000Z";
const estados = (r: { execs: EtapaExec[] }) => Object.fromEntries(r.execs.map((e) => [e.etapa_id, e.estado]));

describe("replanejamento no meio do pipeline (CT-16.23)", () => {
  it("baixar de 3 para 2: a etapa em execução fica intacta; pendentes dispensadas viram pulada_nivel; concluídas ficam", () => {
    const antes = marcar(execsDe("runx", 3), { "memox.consultar": "concluida", "runx.e1": "concluida", "runx.e2": "executando" });
    const r = replanejarExecs(antes, "runx", 2, ctxPlano, AGORA);
    const s = estados(r);
    expect(s["runx.e1"]).toBe("concluida");
    expect(s["runx.e2"]).toBe("executando");
    expect(s["runx.e3"]).toBe("pendente");
    expect(s["mergex.atencao"]).toBe("pulada_nivel");
    expect(s["mergex.qa"]).toBe("pulada_nivel");
    expect(s["runx.e5"]).toBe("pulada_nivel");
    expect(r.puladas.sort()).toEqual(["mergex.atencao", "mergex.qa", "runx.e5"]);
    expect(r.execs.find((e) => e.etapa_id === "mergex.qa")?.detalhe).toBe("dispensada pelo novo nível");
  });
  it("subir de 3 para 5: ganha etapas novas à frente (f35) e não volta atrás (prodx.p0 já ficou para trás)", () => {
    const antes = marcar(execsDe("sprintx", 3), { "memox.consultar": "concluida", "sprintx.f1": "concluida", "sprintx.f2": "executando" });
    const r = replanejarExecs(antes, "sprintx", 5, ctxPlano, AGORA);
    const ids = r.execs.map((e) => e.etapa_id);
    expect(ids).toContain("sprintx.f35");
    expect(ids).not.toContain("prodx.p0");
    expect(r.adicionadas).toContain("sprintx.f35");
    expect(ids.indexOf("sprintx.f35")).toBeLessThan(ids.indexOf("sprintx.f4"));
    expect(ids.indexOf("sprintx.f35")).toBeGreaterThan(ids.indexOf("sprintx.f3"));
    expect(estados(r)["sprintx.f2"]).toBe("executando");
    expect(r.execs.map((e) => e.ordem)).toEqual(r.execs.map((_, i) => i + 1));
  });
  it("subir reativa etapa que o nível anterior dispensara, se ainda está à frente", () => {
    const n2 = execsDe("runx", 2);
    const r = replanejarExecs(marcar(n2, { "runx.e1": "executando" }), "runx", 3, ctxPlano, AGORA);
    expect(estados(r)["runx.e5"]).toBe("pendente");
    expect(estados(r)["mergex.atencao"]).toBe("pendente");
    expect(r.reativadas).toEqual(expect.arrayContaining(["mergex.atencao", "mergex.qa", "runx.e5"]));
  });
  it("etapas passadas não voltam, mesmo que o novo nível as peça", () => {
    const antes = marcar(execsDe("runx", 2), { "runx.e1": "concluida", "runx.e2": "concluida", "runx.e3": "concluida", "runx.e4": "executando", "mergex.check": "pendente" });
    const r = replanejarExecs(antes, "runx", 4, ctxPlano, AGORA);
    expect(estados(r)["runx.e1"]).toBe("concluida");
    expect(r.execs.filter((e) => e.etapa_id === "runx.e1")).toHaveLength(1);
  });
  it("é pura: não muta a entrada", () => {
    const antes = marcar(execsDe("runx", 3), { "runx.e1": "executando" });
    const copia = JSON.stringify(antes);
    replanejarExecs(antes, "runx", 2, ctxPlano, AGORA);
    expect(JSON.stringify(antes)).toBe(copia);
  });
  it("atualiza o nível das pendentes (`maestro_etapa_exec.nivel`) e deixa o das passadas", () => {
    const antes = marcar(execsDe("runx", 3), { "runx.e1": "concluida", "runx.e2": "executando" });
    const r = replanejarExecs(antes, "runx", 4, ctxPlano, AGORA);
    expect(r.execs.find((e) => e.etapa_id === "runx.e1")?.nivel).toBe(3);
    expect(r.execs.find((e) => e.etapa_id === "runx.e3")?.nivel).toBe(4);
    expect(r.execs.find((e) => e.etapa_id === "runx.e3")?.reforco).toContain("revisor-testes");
  });
});

describe("voltar ao padrão e lembretes", () => {
  it("só este pedido sempre volta; Missão só se marcada; workspace nunca", () => {
    expect(deveVoltarAoPadrao({ escopo: "pedido", voltar_ao_padrao: false })).toBe(true);
    expect(deveVoltarAoPadrao({ escopo: "missao", voltar_ao_padrao: true })).toBe(true);
    expect(deveVoltarAoPadrao({ escopo: "missao", voltar_ao_padrao: false })).toBe(false);
    expect(deveVoltarAoPadrao({ escopo: "workspace", voltar_ao_padrao: true })).toBe(false);
  });
  it("lembrete de ≥ 8 h em nível ≤ 2 e toast ao concluir em nível < 3", () => {
    const h = 3_600_000;
    expect(lembreteDeNivelBaixo(2, 0, 8 * h)).toBe(true);
    expect(lembreteDeNivelBaixo(2, 0, 8 * h - 1)).toBe(false);
    expect(lembreteDeNivelBaixo(3, 0, 20 * h)).toBe(false);
    expect(lembreteDeNivelBaixo(1, null, 20 * h)).toBe(false);
    expect(lembreteAoConcluir(2)).toBe(true);
    expect(lembreteAoConcluir(3)).toBe(false);
  });
});
