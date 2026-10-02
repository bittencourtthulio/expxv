import { describe, expect, it } from "vitest";
import { trab } from "../../../../tests/fixtures/metodo/construtores";
import type { EtapaId } from "../../../compartilhado/maestro";
import { divergencias, etapaConcluida, indiceDoEstagio, proximaEtapa, SONDA_VAZIA, type ContextoConclusao, type ExecMinima, type SondaDeDisco, type TrabalhoParaMaestro } from "./conclusao";

const sondaCom = (arquivos: Record<string, number>): SondaDeDisco => ({ existe: (r) => r in arquivos, mtime: (r) => arquivos[r] ?? null });
const oc = (o: Record<string, unknown> = {}): TrabalhoParaMaestro => trab({ tipo: "ocorrencia", ferramenta: "runx", id: "OC-2026-0142-x", pasta: "docs/manutencao/OC-2026-0142-x", estagio: "e1", ...o });
const ft = (o: Record<string, unknown> = {}): TrabalhoParaMaestro => trab({ tipo: "feature", ferramenta: "sprintx", id: "export-csv", pasta: "docs/sprintx/features/export-csv", estagio: "f1", ...o });
const pd = (o: Record<string, unknown> = {}): TrabalhoParaMaestro => trab({ tipo: "pedido", ferramenta: "prodx", id: "PD-2026-0007", pasta: "docs/produto/pedidos/PD-2026-0007", estagio: "p3", ...o });
const pj = (o: Record<string, unknown> = {}): TrabalhoParaMaestro => trab({ tipo: "projeto", ferramenta: "buildx", id: "proj", pasta: "docs/projeto", estagio: "b1", ...o });

type Caso = [nome: string, etapa: EtapaId, trabalho: TrabalhoParaMaestro | null, ctx: ContextoConclusao, concluida: boolean, reprovada?: boolean];
const CASOS: Caso[] = [
  // runx
  ["e1 ainda em e1", "runx.e1", oc({ estagio: "e1" }), {}, false],
  ["e1 com estágio e2", "runx.e1", oc({ estagio: "e2" }), {}, true],
  ["e1 com estágio e4 (além)", "runx.e1", oc({ estagio: "e4" }), {}, true],
  ["e1 sem trabalho", "runx.e1", null, {}, false],
  ["e1 com trabalho de outro tipo", "runx.e1", ft({ estagio: "f6" }), {}, false],
  ["e1 com estágio desconhecido", "runx.e1", oc({ estagio: "zz" }), {}, false],
  ["e2 em e2", "runx.e2", oc({ estagio: "e2" }), {}, false],
  ["e2 em e3", "runx.e2", oc({ estagio: "e3" }), {}, true],
  ["e3 em e3", "runx.e3", oc({ estagio: "e3" }), {}, false],
  ["e3 em e4", "runx.e3", oc({ estagio: "e4" }), {}, true],
  ["e3 rodada 2 sem task nova", "runx.e3", oc({ estagio: "e4" }), { rodada: 2, desde_ms: 5000, ultima_task_concluida_ms: 1000 }, false],
  ["e3 rodada 2 com task nova", "runx.e3", oc({ estagio: "e4" }), { rodada: 2, desde_ms: 5000, ultima_task_concluida_ms: 6000 }, true],
  ["e4 sem veredito", "runx.e4", oc({ estagio: "e4", veredito_qa: null }), {}, false],
  ["e4 aprovado", "runx.e4", oc({ estagio: "e5", veredito_qa: "aprovado" }), {}, true],
  ["e4 reprovado", "runx.e4", oc({ estagio: "e4", veredito_qa: "reprovado" }), {}, true, true],
  ["e4 rodada 2 com QA velho", "runx.e4", oc({ veredito_qa: "reprovado" }), { rodada: 2, desde_ms: 9000, sondas: sondaCom({ "docs/manutencao/OC-2026-0142-x/QA.md": 1000 }) }, false],
  ["e4 rodada 2 com QA novo aprovado", "runx.e4", oc({ veredito_qa: "aprovado" }), { rodada: 2, desde_ms: 9000, sondas: sondaCom({ "docs/manutencao/OC-2026-0142-x/QA.md": 9500 }) }, true],
  ["e4 rodada 2 sem mtime conhecido", "runx.e4", oc({ veredito_qa: "aprovado" }), { rodada: 2, desde_ms: 9000 }, false],
  ["e5 em andamento", "runx.e5", oc({ status: "em_andamento" }), {}, false],
  ["e5 concluída", "runx.e5", oc({ status: "concluido" }), {}, true],
  // sprintx
  ["f1 em f1", "sprintx.f1", ft({ estagio: "f1" }), {}, false],
  ["f1 em f2", "sprintx.f1", ft({ estagio: "f2" }), {}, true],
  ["f2 em f3 sem pendências", "sprintx.f2", ft({ estagio: "f3" }), {}, true],
  ["f2 em f3 com decisões pendentes", "sprintx.f2", ft({ estagio: "f3", decisoes_pendentes: 2 }), {}, false],
  ["f2 em f2", "sprintx.f2", ft({ estagio: "f2" }), {}, false],
  ["f3 em f4", "sprintx.f3", ft({ estagio: "f4" }), {}, true],
  ["f3 em f3", "sprintx.f3", ft({ estagio: "f3" }), {}, false],
  ["f35 sem arquivo", "sprintx.f35", ft(), {}, false],
  ["f35 com arquivo", "sprintx.f35", ft(), { sondas: sondaCom({ "docs/sprintx/features/export-csv/00-ESTIMATIVA.md": 1 }) }, true],
  ["f4 em f5", "sprintx.f4", ft({ estagio: "f5" }), {}, true],
  ["f4 em f4", "sprintx.f4", ft({ estagio: "f4" }), {}, false],
  ["f5 SIM", "sprintx.f5", ft({ veredito_auditoria: "sim" }), {}, true],
  ["f5 NÃO", "sprintx.f5", ft({ veredito_auditoria: "nao" }), {}, true, true],
  ["f5 sem veredito", "sprintx.f5", ft({ veredito_auditoria: null }), {}, false],
  ["f5 rodada 2 com auditoria velha", "sprintx.f5", ft({ veredito_auditoria: "sim" }), { rodada: 2, desde_ms: 9000, sondas: sondaCom({ "docs/sprintx/features/export-csv/00-AUDITORIA.md": 10 }) }, false],
  ["f5 rodada 2 com auditoria nova", "sprintx.f5", ft({ veredito_auditoria: "sim" }), { rodada: 2, desde_ms: 9000, sondas: sondaCom({ "docs/sprintx/features/export-csv/00-AUDITORIA.md": 9100 }) }, true],
  ["f6 em andamento", "sprintx.f6", ft({ status: "em_andamento" }), {}, false],
  ["f6 concluída", "sprintx.f6", ft({ status: "concluido" }), {}, true],
  // prodx
  ["p1 sem PRODUTO.md", "prodx.p1", null, {}, false],
  ["p1 com PRODUTO.md", "prodx.p1", null, { sondas: sondaCom({ "docs/produto/PRODUTO.md": 1 }) }, true],
  ["p0 sem registro", "prodx.p0", null, {}, false],
  ["p0 com INDICE novo", "prodx.p0", null, { desde_ms: 100, sondas: sondaCom({ "docs/produto/pedidos/INDICE.md": 200 }) }, true],
  ["p0 com INDICE velho", "prodx.p0", null, { desde_ms: 300, sondas: sondaCom({ "docs/produto/pedidos/INDICE.md": 200 }) }, false],
  ["p0 com pedido no disco", "prodx.p0", pd(), {}, true],
  ["p25 sem veredito", "prodx.p25", pd({ prodx: { veredito: null, assinado: false, briefing: false } }), {}, false],
  ["p25 com veredito", "prodx.p25", pd({ prodx: { veredito: "fazer", assinado: false, briefing: false } }), {}, true],
  ["assinatura pendente", "prodx.assinatura", pd({ prodx: { veredito: "fazer", assinado: false, briefing: false } }), {}, false],
  ["assinatura feita", "prodx.assinatura", pd({ prodx: { veredito: "fazer", assinado: true, briefing: false } }), {}, true],
  ["briefing pendente", "prodx.briefing", pd({ prodx: { veredito: "fazer", assinado: true, briefing: false } }), {}, false],
  ["briefing feito", "prodx.briefing", pd({ prodx: { veredito: "fazer", assinado: true, briefing: true } }), {}, true],
  // buildx
  ["buildx em andamento", "buildx.condutor", pj({ status: "em_andamento" }), {}, false],
  ["buildx concluído", "buildx.condutor", pj({ status: "concluido" }), {}, true],
  // mergex
  ["check sem portão", "mergex.check", ft({ entrega: null }), {}, false],
  ["check pronto", "mergex.check", ft({ entrega: { estado: null, branch: null, portao: "pronto", pr_url: null, pr_estado: null, commits: 0, arquivo: "x" } }), {}, true],
  ["check bloqueado também conclui", "mergex.check", ft({ entrega: { estado: null, branch: null, portao: "bloqueado", pr_url: null, pr_estado: null, commits: 0, arquivo: "x" } }), {}, true],
  ["atencao sem arquivo", "mergex.atencao", ft(), {}, false],
  ["atencao com arquivo", "mergex.atencao", ft(), { sondas: sondaCom({ "docs/entregas/export-csv/ATENCAO.md": 1 }) }, true],
  ["atencao de ocorrência usa o OC-ID", "mergex.atencao", oc(), { sondas: sondaCom({ "docs/entregas/OC-2026-0142/ATENCAO.md": 1 }) }, true],
  ["qa sem pacote", "mergex.qa", ft(), {}, false],
  ["qa com pacote", "mergex.qa", ft(), { sondas: sondaCom({ "docs/entregas/export-csv/QA-PACOTE.md": 1 }) }, true],
  ["pr rascunho", "mergex.pr", ft({ entrega: { estado: "aberta", branch: "b", portao: "pronto", pr_url: null, pr_estado: "rascunho", commits: 1, arquivo: "x" } }), {}, true],
  ["pr aberto", "mergex.pr", ft({ entrega: { estado: "aberta", branch: "b", portao: "pronto", pr_url: "u", pr_estado: "aberto", commits: 1, arquivo: "x" } }), {}, true],
  ["pr só com PR.md e estado", "mergex.pr", ft({ entrega: { estado: "preparada", branch: "b", portao: "pronto", pr_url: null, pr_estado: null, commits: 1, arquivo: "x" } }), { sondas: sondaCom({ "docs/entregas/export-csv/PR.md": 1 }) }, true],
  ["pr sem nada", "mergex.pr", ft({ entrega: null }), {}, false],
  ["revisar nunca conclui sem merge", "mergex.revisar", ft({ entrega: { estado: "aberta", branch: "b", portao: "pronto", pr_url: "u", pr_estado: "aberto", commits: 1, arquivo: "x" } }), {}, false],
  ["revisar conclui só quando a pessoa mergeou", "mergex.revisar", ft({ entrega: { estado: "aberta", branch: "b", portao: "pronto", pr_url: "u", pr_estado: "merged", commits: 1, arquivo: "x" } }), {}, true],
  // legadox
  ["raio sem faixa", "legadox.raio", ft({ raio: null }), {}, false],
  ["raio com faixa", "legadox.raio", ft({ raio: { faixa: "medio", aprovado: false } }), {}, true],
  ["perfil legado", "legadox.perfil", null, { sondas: sondaCom({ "docs/legado/PERFIL.md": 1 }) }, true],
  ["caracterizar pendente", "legadox.caracterizar", ft(), {}, false],
  ["caracterizar gravada", "legadox.caracterizar", ft(), { sondas: sondaCom({ "docs/legado/caracterizacao/export-csv.md": 1 }) }, true],
  // stackx / designx / onboarding / rapido
  ["stackx detectar sem arquivo", "stackx.detectar", null, {}, false],
  ["stackx detectar com arquivo novo", "stackx.detectar", null, { desde_ms: 1, sondas: sondaCom({ "docs/stack/CONVENCOES.md": 5 }) }, true],
  ["stackx check sem Pane pronto", "stackx.check", null, { pane_pronto: false }, false],
  ["stackx check com Pane pronto (rastro)", "stackx.check", null, { pane_pronto: true }, true],
  ["designx audit com AUDIT novo", "designx.audit", null, { desde_ms: 1, sondas: sondaCom({ "docs/design-system/AUDIT.md": 5 }) }, true],
  ["rapido sem relatório", "rapido.executar", null, { pane_pronto: true, rapido_relatorio: null }, false],
  ["rapido com relatório mas Pane trabalhando", "rapido.executar", null, { pane_pronto: false, rapido_relatorio: { teste_criado: true, suite: "verde" } }, false],
  ["rapido com relatório e Pane pronto", "rapido.executar", null, { pane_pronto: true, rapido_relatorio: { teste_criado: true, suite: "verde" } }, true],
  // consulta: nunca pelo disco
  ["memox nunca conclui pelo disco", "memox.consultar", null, {}, false],
  ["consulta.rag nunca conclui pelo disco", "consulta.rag", null, {}, false],
];

describe("etapaConcluida: tabela de casos (estágio × artefatos × veredito)", () => {
  it(`cobre ≥ 60 casos`, () => expect(CASOS.length).toBeGreaterThanOrEqual(60));
  it.each(CASOS)("%s", (_nome, etapa, trabalho, ctx, concluida, reprovada = false) => {
    const r = etapaConcluida(etapa, trabalho, ctx);
    expect(r.concluida).toBe(concluida);
    expect(r.reprovada).toBe(reprovada);
    expect(r.motivo.length).toBeGreaterThan(0);
  });
  it("é pura: mesma entrada, mesma saída, e nunca lê conteúdo (a sonda só tem existe/mtime)", () => {
    const t = oc({ estagio: "e4" });
    expect(etapaConcluida("runx.e3", t)).toEqual(etapaConcluida("runx.e3", t));
    expect(Object.keys(SONDA_VAZIA).sort()).toEqual(["existe", "mtime"]);
  });
  it("YAML truncado/rejeição nunca lança: estágio ausente apenas não conclui", () => {
    expect(() => etapaConcluida("runx.e2", oc({ estagio: "" }))).not.toThrow();
    expect(etapaConcluida("runx.e2", oc({ estagio: "" })).concluida).toBe(false);
  });
  it("indiceDoEstagio ordena por tipo", () => {
    expect(indiceDoEstagio("ocorrencia", "e3")).toBe(2);
    expect(indiceDoEstagio("feature", "f35")).toBeLessThan(indiceDoEstagio("feature", "f4"));
    expect(indiceDoEstagio("pedido", "zz")).toBe(-1);
  });
});

const ex = (etapa_id: EtapaId, estado: ExecMinima["estado"], rodada = 1): ExecMinima => ({ etapa_id, estado, rodada });
describe("proximaEtapa", () => {
  it("pula finais e devolve a primeira pendente", () => {
    expect(proximaEtapa([ex("runx.e1", "concluida"), ex("runx.e2", "pulada_nivel"), ex("runx.e3", "pendente")])).toEqual({ tipo: "etapa", indice: 2 });
  });
  it("etapa em voo bloqueia a seguinte", () => {
    expect(proximaEtapa([ex("runx.e1", "concluida"), ex("runx.e2", "executando"), ex("runx.e3", "pendente")])).toEqual({ tipo: "em_voo", indice: 1 });
    for (const e of ["despachando", "aguardando_humano", "aguardando_usuario", "aguardando_confirmacao", "sem_progresso"] as const) expect(proximaEtapa([ex("runx.e1", e)]).tipo).toBe("em_voo");
  });
  it("QA reprovado ⇒ laço para runx.e3; auditoria NÃO ⇒ laço para sprintx.f3", () => {
    expect(proximaEtapa([ex("runx.e3", "concluida"), ex("runx.e4", "reprovada"), ex("runx.e5", "pendente")], { "runx.e4": "runx.e3" })).toEqual({ tipo: "laco", indice_reprovada: 1, de: "runx.e4", para: "runx.e3" });
    expect(proximaEtapa([ex("sprintx.f5", "reprovada")], { "sprintx.f5": "sprintx.f3" })).toMatchObject({ tipo: "laco", para: "sprintx.f3" });
  });
  it("laço já reaberto (tentativa da rodada seguinte existe) não reabre de novo", () => {
    const r = proximaEtapa([ex("runx.e4", "reprovada", 1), ex("runx.e3", "pendente", 2), ex("runx.e4", "pendente", 2)], { "runx.e4": "runx.e3" });
    expect(r).toEqual({ tipo: "etapa", indice: 1 });
  });
  it("tudo terminado ⇒ fim", () => {
    expect(proximaEtapa([ex("runx.e1", "concluida"), ex("runx.e2", "pulada_usuario")])).toEqual({ tipo: "fim" });
    expect(proximaEtapa([])).toEqual({ tipo: "fim" });
  });
});

describe("divergencias: a skill avançou sozinha na mesma sessão", () => {
  it("acha etapas posteriores que o disco já mostra concluídas", () => {
    const t = oc({ estagio: "e4" });
    const execs = [ex("runx.e1", "executando"), ex("runx.e2", "pendente"), ex("runx.e3", "pendente"), ex("runx.e4", "pendente")];
    expect(divergencias(execs, t).map((d) => d.etapa_id)).toEqual(["runx.e2", "runx.e3"]);
  });
  it("sem divergência quando o disco só mostra a etapa corrente", () => {
    expect(divergencias([ex("runx.e1", "executando"), ex("runx.e2", "pendente")], oc({ estagio: "e1" }))).toEqual([]);
  });
  it("ignora finais e reprovadas", () => {
    expect(divergencias([ex("runx.e1", "concluida"), ex("runx.e2", "concluida")], oc({ estagio: "e5" }))).toEqual([]);
  });
});

