import { describe, expect, it } from "vitest";
import { trab } from "../../../tests/fixtures/metodo/construtores";
import { INTENCOES, NIVEIS_RIGIDEZ, type Intencao, type NivelRigidez } from "../../compartilhado/maestro";
import type { SondaDeDisco } from "./etapas/conclusao";
import { classificarIntencao } from "./intencao/classificar";
import { PROPOSTA_EXPIRA_MIN, planejar, primeiraEtapaDoPlano, type ConfigDePlano, type EntradaDePlano } from "./planejar";
import { EVIDENCIA_VAZIA, type EvidenciaDoDisco } from "./rigidez/plano-de-etapas";

const AGORA = Date.parse("2026-10-01T12:00:00.000Z");
const cfg = (o: Partial<ConfigDePlano> = {}): ConfigDePlano => ({ id: "mpl_1", agora_ms: AGORA, evidencia: EVIDENCIA_VAZIA, ...o });
const ent = (intencao: Intencao, confianca = 0.9, extra: Partial<EntradaDePlano> = {}): EntradaDePlano => ({ intencao, confianca, candidatas: [{ intencao, confianca }], retomar: null, fonte: "regra", ...extra });
const ids = (p: ReturnType<typeof planejar>): string[] => p.etapas.filter((e) => e.estado_inicial !== "pulada_nivel" && e.estado_inicial !== "pulada_usuario").map((e) => e.etapa_id);
const sondaCom = (a: string[]): SondaDeDisco => ({ existe: (r) => a.includes(r), mtime: () => 1 });

describe("planejar: intenção → pipeline por nível", () => {
  const PIPE: Array<[Intencao, string]> = [["bug", "runx"], ["feature", "sprintx"], ["refatoracao", "sprintx_legadox"], ["pedido", "prodx"], ["projeto", "buildx"], ["entrega", "mergex"], ["duvida", "consulta"], ["historico", "consulta"], ["convencoes", "stackx"], ["design", "designx"], ["onboarding", "onboarding"]];
  it.each(PIPE)("%s ⇒ %s (nível 3)", (intencao, pipeline) => {
    const p = planejar(ent(intencao), 3, cfg());
    expect(p.pipeline_id).toBe(pipeline);
    expect(p.intencao).toBe(intencao);
    expect(p.etapas.length).toBeGreaterThan(0);
    expect(p.nivel).toBe(3);
  });
  it("nível 1 troca bug/feature/refatoração por `rapido`; os demais pipelines continuam", () => {
    for (const i of ["bug", "feature", "refatoracao"] as const) expect(planejar(ent(i), 1, cfg()).pipeline_id).toBe("rapido");
    expect(planejar(ent("pedido"), 1, cfg()).pipeline_id).toBe("prodx");
    expect(planejar(ent("entrega"), 1, cfg()).pipeline_id).toBe("mergex");
    expect(ids(planejar(ent("bug"), 1, cfg()))).toEqual(["rapido.executar"]);
  });
  it("refatoração no nível 1 mantém legadox.raio (legado) antes do rápido", () => {
    expect(ids(planejar(ent("refatoracao"), 1, cfg()))).toEqual(["legadox.raio", "rapido.executar"]);
  });
  it("tabela intenção × nível: o plano é o planoDeEtapas do pipeline/nível", () => {
    for (const i of ["bug", "feature", "refatoracao", "pedido", "projeto", "entrega"] as const) for (const n of NIVEIS_RIGIDEZ) {
      const p = planejar(ent(i), n, cfg());
      expect(p.etapas.length, `${i} N${n}`).toBeGreaterThan(0);
      expect(p.hooks_a_aplicar.length > 0).toBe(n !== 3);
    }
  });
  it("controle não abre terminal; consulta usa só consulta.rag", () => {
    expect(planejar(ent("controle"), 3, cfg())).toMatchObject({ pipeline_id: "controle", etapas: [] });
    expect(ids(planejar(ent("duvida"), 3, cfg()))).toEqual(["consulta.rag"]);
  });
  it("desconhecida NUNCA produz etapa executável: pergunta, com candidatas", () => {
    for (const n of NIVEIS_RIGIDEZ) {
      const c = classificarIntencao("melhora o carregamento da tela");
      const p = planejar({ intencao: "desconhecida", confianca: c.confianca, candidatas: [{ intencao: "bug", confianca: 0.3 }, { intencao: "feature", confianca: 0.2 }], retomar: null, fonte: "regra" }, n, cfg());
      expect(p.etapas).toEqual([]);
      expect(p.candidatas?.length).toBe(2);
      expect(p.executar_direto).toBe(false);
      expect(p.avisos.join(" ")).toMatch(/escolha uma das candidatas/);
    }
  });
  it("B10: revisar/mergear o PR ⇒ só a etapa humana, sem comando", () => {
    const p = planejar(ent("entrega", 0.9, { so_humano: true }), 3, cfg());
    expect(p.etapas).toHaveLength(1);
    expect(p.etapas[0]).toMatchObject({ etapa_id: "mergex.revisar", estado_inicial: "humano", comando: null, perfil: null });
    expect(p.etapas[0]?.motivo).toMatch(/o merge é seu/);
  });
  it("o plano expira em 30 min (configurável) e carrega id, confiança e fonte", () => {
    const p = planejar(ent("bug", 0.86, { fonte: "regra+decisor" }), 3, cfg());
    expect(p).toMatchObject({ id: "mpl_1", confianca: 0.86, fonte: "regra+decisor" });
    expect(Date.parse(p.expira_em) - AGORA).toBe(PROPOSTA_EXPIRA_MIN * 60_000);
    expect(Date.parse(planejar(ent("bug"), 3, cfg({ expira_min: 5 })).expira_em) - AGORA).toBe(5 * 60_000);
  });
  it("confiança média traz candidatas e aviso; alta não", () => {
    const m = planejar(ent("bug", 0.55, { candidatas: [{ intencao: "bug", confianca: 0.55 }, { intencao: "feature", confianca: 0.4 }] }), 3, cfg());
    expect(m.candidatas?.map((c) => c.intencao)).toEqual(["bug", "feature"]);
    expect(m.avisos.join(" ")).toMatch(/Confiança média/);
    expect(planejar(ent("bug", 0.9), 3, cfg()).candidatas).toBeUndefined();
  });
  it("nível avisa o que dispensou", () => {
    expect(planejar(ent("bug"), 2, cfg()).avisos.join(" ")).toMatch(/etapa\(s\) dispensada\(s\)/);
    expect(planejar(ent("bug"), 3, cfg()).avisos.join(" ")).not.toMatch(/dispensada/);
  });
  it("mergex.pr pede confirmação e o plano avisa", () => {
    const p = planejar(ent("bug"), 3, cfg({ permissao: "seguro" }));
    expect(p.avisos.join(" ")).toMatch(/push e o PR só saem com a sua confirmação/);
  });
  it("evidência de legado traz legadox.raio ao runx e hooks do modo legado nos níveis baixos", () => {
    const ev: EvidenciaDoDisco = { ...EVIDENCIA_VAZIA, legado: true };
    expect(ids(planejar(ent("bug"), 3, cfg({ evidencia: ev })))).toContain("legadox.raio");
    expect(planejar(ent("bug"), 2, cfg({ evidencia: ev })).hooks_a_aplicar.find((h) => h.nome === "raio-antes-do-plano")?.modo).toBe("aviso");
    expect(planejar(ent("bug"), 2, cfg()).hooks_a_aplicar.find((h) => h.nome === "raio-antes-do-plano")?.modo).toBe("desligado");
  });
  it("hooks a aplicar nunca incluem segurança", () => {
    for (const n of NIVEIS_RIGIDEZ) for (const h of planejar(ent("bug"), n, cfg()).hooks_a_aplicar) expect(["segredo-no-commit", "sem-segredo", "git-perigoso", "branch-limpa", "zona-de-risco", "aprovacao-em-raio-alto", "designx-cartografa"]).not.toContain(h.nome);
  });
});

describe("planejar: retomada pelo disco", () => {
  const oc = (estagio: string, o: Record<string, unknown> = {}) => trab({ tipo: "ocorrencia", ferramenta: "runx", id: "OC-2026-0142-x", pasta: "docs/manutencao/OC-2026-0142-x", estagio, ...o });
  it("pedido que cita OC-2026-0142 já em E3 ⇒ o plano começa no E3/E4", () => {
    const p = planejar(ent("bug", 0.9, { retomar: { tipo: "OC", id: "OC-2026-0142" } }), 3, cfg({ trabalho: { trabalho: oc("e3") } }));
    expect(ids(p)).toEqual(["runx.e3", "runx.e4", "mergex.check", "mergex.atencao", "mergex.qa", "mergex.pr", "runx.e5"]);
    expect(p.alvo).toEqual({ trabalho_id: "OC-2026-0142-x", retomada: true, estagio_atual: "e3" });
    expect(p.avisos.join(" ")).toMatch(/Retomando OC-2026-0142-x: o disco já mostra concluídas e1, e2/);
  });
  it("trabalho no começo ⇒ plano inteiro, sem etapas concluídas", () => {
    const p = planejar(ent("bug", 0.9, { retomar: { tipo: "OC", id: "OC-2026-0142" } }), 3, cfg({ trabalho: { trabalho: oc("e1") } }));
    expect(ids(p)[0]).toBe("memox.consultar");
    expect(p.alvo.retomada).toBe(true);
  });
  it("no QA ainda aberto ⇒ começa no e4; já em e5 ⇒ só o fechamento e a entrega que faltam", () => {
    expect(ids(planejar(ent("bug", 0.9, { retomar: { tipo: "OC", id: "x" } }), 3, cfg({ trabalho: { trabalho: oc("e4") } })))[0]).toBe("runx.e4");
  });
  it("o pipeline segue o tipo do trabalho citado (feature citada num pedido de bug ⇒ sprintx)", () => {
    const ft = trab({ tipo: "feature", ferramenta: "sprintx", id: "export-csv", pasta: "docs/sprintx/features/export-csv", estagio: "f4" });
    const p = planejar(ent("feature", 0.9, { retomar: { tipo: "slug", id: "export-csv" } }), 3, cfg({ trabalho: { trabalho: ft } }));
    expect(p.pipeline_id).toBe("sprintx");
    expect(ids(p).slice(0, 2)).toEqual(["sprintx.f4", "sprintx.f5"]);
  });
  it("sondas entram na conclusão (stackx/legadox)", () => {
    const ft = trab({ tipo: "feature", ferramenta: "sprintx", id: "x", pasta: "docs/x", estagio: "f1" });
    const p = planejar(ent("refatoracao", 0.9, { retomar: { tipo: "slug", id: "x" } }), 3, cfg({ trabalho: { trabalho: ft, sondas: sondaCom(["docs/legado/PERFIL.md"]) }, evidencia: { ...EVIDENCIA_VAZIA, legado: true, perfil_legado: true } }));
    expect(p.pipeline_id).toBe("sprintx_legadox");
  });
  it("referência que não está no índice: aviso e pipeline do início", () => {
    const p = planejar(ent("bug", 0.9, { retomar: { tipo: "OC", id: "OC-2026-9999" } }), 3, cfg());
    expect(p.alvo.retomada).toBe(false);
    expect(p.avisos.join(" ")).toMatch(/OC-2026-9999.*não achei/);
  });
  it("conflito: já há pipeline no alvo ⇒ aviso e nunca executar direto", () => {
    const p = planejar(ent("bug"), 3, cfg({ pipeline_ativo_no_alvo: true, executar_direto_permitido: true }));
    expect(p.avisos.join(" ")).toMatch(/Já há um pipeline em andamento/);
    expect(p.executar_direto).toBe(false);
  });
});

describe("planejar: trava e executar direto", () => {
  const trava = { minimo: 4 as NivelRigidez, motivo: "raio de impacto ALTO: o nível mínimo é Rigoroso (4)" };
  it("trava registrada no plano; nível abaixo do mínimo sem override avisa", () => {
    const p = planejar(ent("bug"), 2, cfg({ trava }));
    expect(p.trava).toEqual(trava);
    expect(p.avisos.join(" ")).toMatch(/Trava:/);
    expect(planejar(ent("bug"), 4, cfg({ trava })).avisos.join(" ")).not.toMatch(/Trava:/);
    expect(planejar(ent("bug"), 2, cfg({ trava, override_trava: true })).avisos.join(" ")).not.toMatch(/Trava:/);
  });
  const direto = (o: Partial<ConfigDePlano> = {}, e: Partial<EntradaDePlano> = {}, nivel: NivelRigidez = 3) => planejar(ent("bug", 0.9, e), nivel, cfg({ executar_direto_permitido: true, permissao: "automatico", ...o })).executar_direto;
  it("só com opt-in do workspace; por padrão o plano sempre aparece", () => {
    expect(planejar(ent("bug"), 3, cfg()).executar_direto).toBe(false);
    expect(direto()).toBe(true);
  });
  it("nunca com confiança < 0,70, trava ativa, canal remoto, etapa humana imediata ou intenção não acionável", () => {
    expect(direto({}, { confianca: 0.69 })).toBe(false);
    expect(direto({ trava })).toBe(false);
    expect(direto({ trava }, {}, 4)).toBe(true);
    expect(direto({ trava, override_trava: true }, {}, 2)).toBe(true);
    expect(direto({ via: "telegram" })).toBe(false);
    expect(direto({ via: "mcp" })).toBe(true);
    expect(planejar(ent("duvida", 0.9), 3, cfg({ executar_direto_permitido: true })).executar_direto).toBe(false);
    expect(planejar(ent("entrega", 0.9, { so_humano: true }), 3, cfg({ executar_direto_permitido: true })).executar_direto).toBe(false);
  });
  it("em `seguro` com mergex.pr no plano a execução direta não vale; em equilibrado/automatico sim", () => {
    expect(direto({ permissao: "seguro" })).toBe(false);
    expect(direto({ permissao: "automatico" })).toBe(true);
  });
  it("nível ≤ 2 em branch protegida sem confirmação prévia não vale", () => {
    expect(direto({ branch_protegida: true }, {}, 2)).toBe(false);
    expect(direto({ branch_protegida: true, confirmou_rigidez_baixa: true }, {}, 2)).toBe(true);
    expect(direto({ branch_protegida: true }, {}, 3)).toBe(true);
  });
});

describe("planejar: pureza e velocidade", () => {
  it("determinístico e sem mutar a configuração", () => {
    const c = cfg({ evidencia: { ...EVIDENCIA_VAZIA, legado: true } });
    const copia = JSON.stringify(c);
    expect(planejar(ent("bug"), 3, c)).toEqual(planejar(ent("bug"), 3, c));
    expect(JSON.stringify(c)).toBe(copia);
  });
  it("planejar ≤ 1 ms (média) em qualquer intenção × nível", () => {
    const t0 = performance.now();
    let n = 0;
    for (let r = 0; r < 20; r++) for (const i of INTENCOES) for (const nv of NIVEIS_RIGIDEZ) {
      planejar(ent(i), nv, cfg({ permissao: "equilibrado" }));
      n++;
    }
    expect((performance.now() - t0) / n).toBeLessThan(1);
  });
  it("primeiraEtapaDoPlano ignora as puladas", () => {
    expect(primeiraEtapaDoPlano(planejar(ent("bug"), 2, cfg()))?.etapa_id).toBe("runx.e1");
    expect(primeiraEtapaDoPlano(planejar(ent("controle"), 3, cfg()))).toBeNull();
  });
});
