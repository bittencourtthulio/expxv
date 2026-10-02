import { describe, expect, it } from "vitest";
import { NIVEIS_RIGIDEZ, PIPELINES_IDS, type EtapaDoPlano, type EtapaId, type NivelRigidez, type PipelineId } from "../../../compartilhado/maestro";
import { etapaDef, PIPELINES } from "../etapas/catalogo";
import { celaDe } from "./matriz";
import { EVIDENCIA_VAZIA, etapasDePisoAplicaveis, pipelineEfetivo, planoDeEtapas, type EvidenciaDoDisco, type FaixaRaio } from "./plano-de-etapas";

const ev = (o: Partial<EvidenciaDoDisco> = {}): EvidenciaDoDisco => ({ ...EVIDENCIA_VAZIA, ...o });
const ativas = (p: EtapaDoPlano[]): string[] => p.filter((e) => e.estado_inicial === "pendente" || e.estado_inicial === "confirmar" || e.estado_inicial === "humano").map((e) => e.etapa_id);
const puladas = (p: EtapaDoPlano[]): string[] => p.filter((e) => e.estado_inicial === "pulada_nivel").map((e) => e.etapa_id);
const plano = (pipe: PipelineId, n: NivelRigidez, e: Partial<EvidenciaDoDisco> = {}, extra: Record<string, unknown> = {}) => planoDeEtapas(pipe, n, { evidencia: ev(e), ...extra });

type Linha = [pipeline: PipelineId, nivel: NivelRigidez, evidencia: Partial<EvidenciaDoDisco>, ativas: string[], puladas?: string[]];
const GATE = ["mergex.check", "mergex.atencao", "mergex.qa", "mergex.pr"];
const TABELA: Linha[] = [
  // runx
  ["runx", 1, {}, ["rapido.executar"]],
  ["runx", 1, { legado: true }, ["legadox.raio", "rapido.executar"]],
  ["runx", 2, {}, ["runx.e1", "runx.e2", "runx.e3", "runx.e4", "mergex.check", "mergex.pr"], ["memox.consultar", "mergex.atencao", "mergex.qa", "runx.e5"]],
  ["runx", 2, { legado: true, raio: "baixo" }, ["legadox.raio", "runx.e1", "runx.e2", "runx.e3", "runx.e4", "mergex.check", "mergex.pr"]],
  ["runx", 3, {}, ["memox.consultar", "runx.e1", "runx.e2", "runx.e3", "runx.e4", ...GATE, "runx.e5"], []],
  ["runx", 3, { legado: true, raio: "medio" }, ["memox.consultar", "legadox.raio", "runx.e1", "runx.e2", "legadox.caracterizar", "runx.e3", "runx.e4", ...GATE, "runx.e5"]],
  ["runx", 3, { legado: true, raio: "baixo" }, ["memox.consultar", "legadox.raio", "runx.e1", "runx.e2", "runx.e3", "runx.e4", ...GATE, "runx.e5"]],
  ["runx", 3, { convencoes: true, design_system: true }, ["memox.consultar", "runx.e1", "runx.e2", "runx.e3", "runx.e4", ...GATE, "runx.e5"]],
  ["runx", 4, {}, ["memox.consultar", "runx.e1", "runx.e2", "runx.e3", "runx.e4", ...GATE, "runx.e5"]],
  ["runx", 4, { convencoes: true }, ["memox.consultar", "runx.e1", "runx.e2", "runx.e3", "stackx.check", "runx.e4", ...GATE, "runx.e5"]],
  ["runx", 4, { convencoes: true, design_system: true }, ["memox.consultar", "runx.e1", "runx.e2", "runx.e3", "stackx.check", "designx.audit", "runx.e4", ...GATE, "runx.e5"]],
  ["runx", 4, { design_system: true, toca_ui: false }, ["memox.consultar", "runx.e1", "runx.e2", "runx.e3", "runx.e4", ...GATE, "runx.e5"]],
  ["runx", 5, {}, ["memox.consultar", "prodx.p0", "runx.e1", "runx.e2", "runx.e3", "runx.e4", ...GATE, "runx.e5"]],
  ["runx", 5, { legado: true, raio: "alto", convencoes: true, design_system: true }, ["memox.consultar", "prodx.p0", "legadox.raio", "runx.e1", "runx.e2", "legadox.caracterizar", "runx.e3", "stackx.check", "designx.audit", "runx.e4", ...GATE, "runx.e5"]],
  // sprintx
  ["sprintx", 1, {}, ["rapido.executar"]],
  ["sprintx", 2, {}, ["sprintx.f1", "sprintx.f2", "sprintx.f3", "sprintx.f4", "sprintx.f5", "sprintx.f6", "mergex.check", "mergex.pr"], ["memox.consultar", "mergex.atencao", "mergex.qa"]],
  ["sprintx", 3, {}, ["memox.consultar", "sprintx.f1", "sprintx.f2", "sprintx.f3", "sprintx.f4", "sprintx.f5", "sprintx.f6", ...GATE]],
  ["sprintx", 3, { legado: true, raio: "alto" }, ["memox.consultar", "sprintx.f1", "sprintx.f2", "legadox.raio", "sprintx.f3", "sprintx.f4", "sprintx.f5", "legadox.caracterizar", "sprintx.f6", ...GATE]],
  ["sprintx", 4, {}, ["memox.consultar", "sprintx.f1", "sprintx.f2", "sprintx.f3", "sprintx.f4", "sprintx.f5", "sprintx.f6", ...GATE]],
  ["sprintx", 4, { convencoes: true, design_system: true }, ["memox.consultar", "sprintx.f1", "sprintx.f2", "sprintx.f3", "sprintx.f4", "sprintx.f5", "sprintx.f6", "stackx.check", "designx.audit", ...GATE]],
  ["sprintx", 5, {}, ["memox.consultar", "prodx.p0", "sprintx.f1", "sprintx.f2", "sprintx.f3", "sprintx.f35", "sprintx.f4", "sprintx.f5", "sprintx.f6", ...GATE]],
  // sprintx_legadox
  ["sprintx_legadox", 1, {}, ["legadox.raio", "rapido.executar"]],
  ["sprintx_legadox", 2, { perfil_legado: true }, ["sprintx.f1", "sprintx.f2", "legadox.raio", "sprintx.f3", "sprintx.f4", "sprintx.f5", "sprintx.f6", "mergex.check", "mergex.pr"], ["memox.consultar", "legadox.caracterizar", "mergex.atencao", "mergex.qa"]],
  ["sprintx_legadox", 2, {}, ["legadox.perfil", "sprintx.f1", "sprintx.f2", "legadox.raio", "sprintx.f3", "sprintx.f4", "sprintx.f5", "sprintx.f6", "mergex.check", "mergex.pr"]],
  ["sprintx_legadox", 3, { perfil_legado: true }, ["memox.consultar", "sprintx.f1", "sprintx.f2", "legadox.raio", "sprintx.f3", "sprintx.f4", "sprintx.f5", "legadox.caracterizar", "sprintx.f6", ...GATE]],
  ["sprintx_legadox", 4, { perfil_legado: true }, ["memox.consultar", "sprintx.f1", "sprintx.f2", "legadox.raio", "sprintx.f3", "sprintx.f4", "sprintx.f5", "legadox.caracterizar", "sprintx.f6", "legadox.manual", "legadox.divida", ...GATE]],
  ["sprintx_legadox", 5, { perfil_legado: true }, ["memox.consultar", "prodx.p0", "sprintx.f1", "sprintx.f2", "legadox.raio", "sprintx.f3", "sprintx.f35", "sprintx.f4", "sprintx.f5", "legadox.caracterizar", "sprintx.f6", "legadox.manual", "legadox.divida", ...GATE]],
  // prodx
  ["prodx", 1, {}, ["prodx.p0", "prodx.assinatura", "prodx.briefing"]],
  ["prodx", 2, {}, ["prodx.p0", "prodx.p25", "prodx.assinatura", "prodx.briefing"]],
  ["prodx", 3, { produto: false }, ["prodx.p1", "prodx.p0", "prodx.p25", "prodx.assinatura", "prodx.briefing"]],
  ["prodx", 4, {}, ["prodx.p0", "prodx.p25", "prodx.assinatura", "prodx.briefing"]],
  ["prodx", 5, {}, ["prodx.p0", "prodx.p25", "prodx.assinatura", "prodx.briefing"]],
  // buildx, mergex, stackx, designx, outros
  ...NIVEIS_RIGIDEZ.map((n): Linha => ["buildx", n, {}, ["buildx.condutor"]]),
  ["mergex", 1, {}, ["mergex.check", "mergex.pr", "mergex.revisar"]],
  ["mergex", 2, {}, ["mergex.check", "mergex.pr", "mergex.revisar"]],
  ["mergex", 3, {}, [...GATE, "mergex.revisar"]],
  ["mergex", 5, {}, [...GATE, "mergex.revisar"]],
  ["stackx", 1, {}, ["stackx.detectar"]],
  ["stackx", 3, {}, ["stackx.detectar"]],
  ["stackx", 4, {}, ["stackx.detectar", "stackx.check"]],
  ["stackx", 5, {}, ["stackx.detectar", "stackx.check"]],
  ["designx", 2, {}, ["designx.cartography"]],
  ["designx", 4, {}, ["designx.cartography", "designx.audit"]],
  ["designx", 5, {}, ["designx.cartography", "designx.audit"]],
  ...NIVEIS_RIGIDEZ.map((n): Linha => ["onboarding", n, {}, ["onboarding.executar"]]),
  ...NIVEIS_RIGIDEZ.map((n): Linha => ["consulta", n, {}, ["consulta.rag"]]),
  ...NIVEIS_RIGIDEZ.map((n): Linha => ["controle", n, {}, []]),
  ["rapido", 1, {}, ["rapido.executar"]],
  ["rapido", 3, {}, ["rapido.executar"]],
  ["rapido", 5, { legado: true }, ["legadox.raio", "rapido.executar"]],
];

describe("planoDeEtapas: tabela pipeline × nível × evidência (CT-16.20)", () => {
  it("tem ≥ 60 linhas", () => expect(TABELA.length).toBeGreaterThanOrEqual(60));
  it.each(TABELA)("%s N%i %j", (pipeline, nivel, evidencia, esperadasAtivas, esperadasPuladas) => {
    const p = plano(pipeline, nivel, evidencia);
    expect(ativas(p)).toEqual(esperadasAtivas);
    if (esperadasPuladas !== undefined) expect([...puladas(p)].sort()).toEqual([...esperadasPuladas].sort());
    expect(p.map((e) => e.ordem)).toEqual(p.map((_, i) => i + 1));
  });
});

describe("o nível 1 troca bug/feature/refatoração pelo pipeline rápido", () => {
  it("pipelineEfetivo", () => {
    for (const p of ["runx", "sprintx", "sprintx_legadox"] as const) expect(pipelineEfetivo(p, 1)).toBe("rapido");
    for (const p of ["runx", "sprintx", "sprintx_legadox"] as const) expect(pipelineEfetivo(p, 2)).toBe(p);
    expect(pipelineEfetivo("prodx", 1)).toBe("prodx");
    expect(pipelineEfetivo("mergex", 1)).toBe("mergex");
  });
  it("rapido só existe no nível 1 (nenhum outro pipeline do método o contém)", () => {
    for (const p of PIPELINES_IDS.filter((x) => x !== "rapido")) for (const n of NIVEIS_RIGIDEZ) if (!(n === 1 && ["runx", "sprintx", "sprintx_legadox"].includes(p))) expect(ativas(plano(p, n))).not.toContain("rapido.executar");
  });
});

describe("agrupamento ⛓, reforço, redução e confirmação", () => {
  it("nível 2 agrupa e1→e2→e3 do runx quando o perfil é o mesmo; e3 não agrupa com o avaliador", () => {
    const p = plano("runx", 2);
    expect(p.find((e) => e.etapa_id === "runx.e1")?.agrupa_com_anterior).toBe(false);
    expect(p.find((e) => e.etapa_id === "runx.e2")?.agrupa_com_anterior).toBe(true);
    expect(p.find((e) => e.etapa_id === "runx.e3")?.agrupa_com_anterior).toBe(true);
    expect(p.find((e) => e.etapa_id === "runx.e4")?.agrupa_com_anterior).toBe(false);
  });
  it("perfis diferentes impedem o agrupamento", () => {
    const p = plano("runx", 2, {}, { resumoPerfil: (e: EtapaId) => (e === "runx.e2" ? "claude·sonnet·medio" : "claude·opus·alto") });
    expect(p.find((e) => e.etapa_id === "runx.e2")?.agrupa_com_anterior).toBe(false);
    expect(p.find((e) => e.etapa_id === "runx.e3")?.agrupa_com_anterior).toBe(false);
  });
  it("f6 do sprintx nunca agrupa (vem depois do avaliador)", () => {
    expect(plano("sprintx", 2).find((e) => e.etapa_id === "sprintx.f6")?.agrupa_com_anterior).toBe(false);
  });
  it("só o nível 2 agrupa", () => {
    for (const n of [1, 3, 4, 5] as const) for (const pipe of PIPELINES_IDS) expect(plano(pipe, n).some((e) => e.agrupa_com_anterior), `${pipe} N${n}`).toBe(false);
  });
  it("redução e reforço carregam a instrução da célula", () => {
    const n2 = plano("sprintx", 2).find((e) => e.etapa_id === "sprintx.f2");
    expect(n2).toMatchObject({ reduz: true, reforco: null });
    expect(n2?.motivo).toContain("autonomo");
    const n4 = plano("sprintx", 4).find((e) => e.etapa_id === "sprintx.f5");
    expect(n4?.reforco).toContain("auditor-plano");
    expect(plano("sprintx", 3).every((e) => !e.reduz && e.reforco === null)).toBe(true);
  });
  it("nível 5: avaliador com 2 avaliações", () => {
    expect(plano("runx", 5).find((e) => e.etapa_id === "runx.e4")?.avaliacoes).toBe(2);
    expect(plano("sprintx", 5).find((e) => e.etapa_id === "sprintx.f5")?.avaliacoes).toBe(2);
    expect(plano("runx", 4).find((e) => e.etapa_id === "runx.e4")?.avaliacoes).toBeUndefined();
  });
  it("mergex.pr pede confirmação em seguro e equilibrado, não em automático", () => {
    for (const permissao of ["seguro", "equilibrado"] as const) expect(plano("runx", 3, {}, { permissao }).find((e) => e.etapa_id === "mergex.pr")?.estado_inicial).toBe("confirmar");
    expect(plano("runx", 3, {}, { permissao: "automatico" }).find((e) => e.etapa_id === "mergex.pr")?.estado_inicial).toBe("pendente");
    expect(plano("runx", 3).find((e) => e.etapa_id === "mergex.pr")?.estado_inicial).toBe("confirmar");
  });
  it("etapa com modo_execucao confirmar vira confirmar; briefing do prodx é sempre por clique", () => {
    expect(plano("runx", 3, {}, { modoExecucao: (e: EtapaId) => (e === "runx.e3" ? "confirmar" : null) }).find((e) => e.etapa_id === "runx.e3")?.estado_inicial).toBe("confirmar");
    expect(plano("prodx", 3, {}, { permissao: "automatico" }).find((e) => e.etapa_id === "prodx.briefing")?.estado_inicial).toBe("confirmar");
  });
  it("desligada na config pula etapa comum, nunca a de piso; desligada pelo usuário vira pulada_usuario", () => {
    const desl = plano("runx", 3, { legado: true }, { modoExecucao: (e: EtapaId) => (e === "runx.e5" || e === "legadox.raio" ? "desligada" : null) });
    expect(puladas(desl)).toContain("runx.e5");
    expect(ativas(desl)).toContain("legadox.raio");
    const user = plano("runx", 3, {}, { desligadas: new Set<EtapaId>(["runx.e5", "runx.e3"]) });
    expect(user.find((e) => e.etapa_id === "runx.e5")?.estado_inicial).toBe("pulada_usuario");
    expect(user.find((e) => e.etapa_id === "runx.e3")?.estado_inicial).toBe("pulada_usuario");
  });
  it("esqueleto do comando por CLI (placeholders; o comando real nasce no despacho)", () => {
    expect(plano("runx", 3).find((e) => e.etapa_id === "runx.e1")?.comando).toBe("/expx:runx-causa <pedido>");
    expect(plano("runx", 3, {}, { cli: () => "opencode" }).find((e) => e.etapa_id === "runx.e3")?.comando).toBe("/runx-fix <id>");
    expect(plano("runx", 3).find((e) => e.etapa_id === "memox.consultar")?.comando).toBeNull();
  });
  it("etapas humanas: sem comando e sem perfil", () => {
    for (const n of NIVEIS_RIGIDEZ) for (const e of plano("prodx", n).filter((x) => x.estado_inicial === "humano")) expect(e).toMatchObject({ comando: null, perfil: null });
    expect(plano("mergex", 3).find((e) => e.etapa_id === "mergex.revisar")?.motivo).toContain("o merge é seu");
  });
  it("é pura: mesma entrada ⇒ mesma saída e a entrada não muda", () => {
    const e = ev({ legado: true });
    const a = planoDeEtapas("runx", 3, { evidencia: e });
    expect(planoDeEtapas("runx", 3, { evidencia: e })).toEqual(a);
    expect(e).toEqual(ev({ legado: true }));
  });
});

// ---------------------------------------------------------------- propriedades P1..P4 sobre o produto cartesiano
const RAIOS: Array<FaixaRaio | null> = [null, "baixo", "medio", "alto"];
const BOOL = [false, true];
function* evidencias(): Generator<EvidenciaDoDisco> {
  for (const legado of BOOL) for (const convencoes of BOOL) for (const design_system of BOOL) for (const produto of BOOL) for (const raio of RAIOS) yield { legado, convencoes, design_system, produto, raio, perfil_legado: legado };
}
describe("propriedades (pipeline × nível × evidência do disco)", () => {
  it("P1: nenhuma etapa de piso aplicável é omitida (I10)", () => {
    for (const pipe of PIPELINES_IDS) for (const n of NIVEIS_RIGIDEZ) for (const e of evidencias()) {
      const p = planoDeEtapas(pipe, n, { evidencia: e });
      const presentes = new Set(ativas(p));
      for (const exigida of etapasDePisoAplicaveis(pipe, n, e)) expect(presentes.has(exigida), `${pipe} N${n} ${exigida}`).toBe(true);
    }
  });
  it("P1b: modo legado ⇒ legadox.raio presente em TODOS os níveis de runx/sprintx; prodx.p0 sempre no prodx; rapido.executar no nível 1", () => {
    for (const pipe of ["runx", "sprintx", "sprintx_legadox"] as const) for (const n of NIVEIS_RIGIDEZ) expect(ativas(plano(pipe, n, { legado: true })), `${pipe} N${n}`).toContain("legadox.raio");
    for (const n of NIVEIS_RIGIDEZ) expect(ativas(plano("prodx", n))).toContain("prodx.p0");
    for (const pipe of ["runx", "sprintx", "sprintx_legadox"] as const) expect(ativas(plano(pipe, 1))).toContain("rapido.executar");
    for (const n of NIVEIS_RIGIDEZ) expect(ativas(plano("sprintx_legadox", n))).toContain("legadox.raio");
  });
  it("P2: mergex.revisar e a assinatura nunca são despachados (só humanos, sem comando, sem perfil)", () => {
    for (const pipe of PIPELINES_IDS) for (const n of NIVEIS_RIGIDEZ) for (const e of evidencias()) for (const x of planoDeEtapas(pipe, n, { evidencia: e })) {
      if (x.etapa_id === "mergex.revisar" || x.etapa_id === "prodx.assinatura") {
        expect(x.estado_inicial).toBe("humano");
        expect(x.comando).toBeNull();
        expect(x.perfil).toBeNull();
      }
      if (etapaDef(x.etapa_id)?.humano) expect(x.estado_inicial).toBe("humano");
    }
  });
  it("P4: o nível 4/5 nunca omite o avaliador do nível 3; avaliador nunca é agrupado", () => {
    for (const pipe of PIPELINES_IDS) for (const e of evidencias()) {
      const n3 = new Set(ativas(planoDeEtapas(pipe, 3, { evidencia: e })).filter((id) => etapaDef(id)?.tipo === "avaliador"));
      for (const n of [4, 5] as const) {
        const p = planoDeEtapas(pipe, n, { evidencia: e });
        for (const id of n3) expect(ativas(p), `${pipe} N${n} ${id}`).toContain(id);
      }
    }
    for (const pipe of PIPELINES_IDS) for (const n of NIVEIS_RIGIDEZ) for (const x of plano(pipe, n)) if (etapaDef(x.etapa_id)?.tipo === "avaliador") expect(x.agrupa_com_anterior).toBe(false);
  });
  it("monotonia: do nível 3 ao 5 nenhuma etapa ativa some; ordem relativa preservada", () => {
    for (const pipe of ["runx", "sprintx", "sprintx_legadox", "prodx", "mergex"] as const) for (const e of evidencias()) {
      const a3 = ativas(planoDeEtapas(pipe, 3, { evidencia: e }));
      const a4 = ativas(planoDeEtapas(pipe, 4, { evidencia: e }));
      const a5 = ativas(planoDeEtapas(pipe, 5, { evidencia: e }));
      for (const id of a3) expect(a4).toContain(id);
      for (const id of a4) expect(a5).toContain(id);
      const ordem = PIPELINES[pipe].passos.map((s) => s.etapa as string);
      for (const lista of [a3, a4, a5]) expect(lista.map((id) => ordem.indexOf(id))).toEqual([...lista.map((id) => ordem.indexOf(id))].sort((a, b) => a - b));
    }
  });
  it("toda etapa listada existe no pipeline efetivo e `pulada_nivel` só lista o que o nível tirou do método padrão", () => {
    for (const pipe of PIPELINES_IDS) for (const n of NIVEIS_RIGIDEZ) for (const x of plano(pipe, n)) {
      const efetivo = pipelineEfetivo(pipe, n);
      expect(PIPELINES[efetivo].passos.some((s) => s.etapa === x.etapa_id)).toBe(true);
      if (x.estado_inicial === "pulada_nivel") expect(["omitida", "substituida"]).not.toContain(celaDe(efetivo, x.etapa_id, 3).modo);
    }
  });
  it("planoDeEtapas ≤ 5 ms (P-217) em qualquer combinação", () => {
    const t0 = performance.now();
    let n = 0;
    for (const e of evidencias()) for (const pipe of ["runx", "sprintx", "sprintx_legadox"] as const) for (const nv of NIVEIS_RIGIDEZ) {
      planoDeEtapas(pipe, nv, { evidencia: e });
      n++;
    }
    expect((performance.now() - t0) / n).toBeLessThan(5);
  });
});
