import { SK_ANT, TOKEN_BOT } from "../../../tests/fixtures/alertas/sentinelas";
import { describe, expect, it } from "vitest";
import { barramentoFalso, idSeq, relogioFalso } from "../../../tests/fixtures/alertas/ajudas";
import { criarEmissor } from "./emissor";
import { criarRepoAlertasMemoria } from "./memoria";
import { criarServicoLeitura } from "./servico-leitura";

function montar(extra: Partial<Parameters<typeof criarEmissor>[0]> = {}) {
  const relogio = relogioFalso();
  const repo = criarRepoAlertasMemoria();
  const barramento = barramentoFalso();
  const emissor = criarEmissor({ repo, barramento, relogio, novoId: idSeq("a"), ...extra });
  return { relogio, repo, barramento, emissor };
}
const ev = (n: number) => ({ tipo: "tarefa_concluida" as const, entidade_tipo: "task", entidade_id: `T-${n}`, titulo: `Tarefa ${n}`, estado: "concluida" });

describe("emissor (T-20.05)", () => {
  it("persiste, redige o título e publica alert.created sem coalescer", () => {
    const { emissor, repo, barramento } = montar();
    const a = emissor.emitir({ ...ev(1), titulo: "ver /Users/ana/x token " + TOKEN_BOT, dados: { pergunta: "senha " + SK_ANT, link: "http://inseguro" } });
    expect(a?.titulo).not.toMatch(/Users|123456789:AAE/);
    expect(repo.obter(a?.id as string)?.dados.pergunta).not.toMatch(/sk-ant/);
    expect(a?.dados.link).toBeNull();
    expect(barramento.eventos.map((e) => e.tipo)).toEqual(["alert.created"]);
    expect(JSON.stringify(barramento.eventos[0]?.payload)).not.toContain("Tarefa"); // sem texto no evento
  });
  it("rajada de 500 eventos iguais => 1 alerta com contagem 500", () => {
    const { emissor, repo, barramento } = montar();
    for (let i = 0; i < 500; i++) emissor.emitir(ev(1));
    const p = repo.listar({ limite: 100 });
    expect(p.itens).toHaveLength(1);
    expect(p.itens[0]?.contagem).toBe(500);
    expect(barramento.eventos.filter((e) => e.tipo === "alert.created")).toHaveLength(1);
  });
  it("depois da janela de 10 min, o mesmo evento vira novo alerta; lido também reabre", () => {
    const { emissor, repo, relogio } = montar();
    const a = emissor.emitir(ev(1));
    relogio.avancar(11 * 60_000);
    expect(emissor.emitir(ev(1))?.id).not.toBe(a?.id);
    const b = emissor.emitir(ev(2));
    repo.marcarLido([b?.id as string], new Date(relogio.agora()).toISOString());
    expect(emissor.emitir(ev(2))?.id).not.toBe(b?.id);
  });
  it("flood: 100 alertas distintos do mesmo tipo => <= 31 linhas, contador preservado (nada se perde)", () => {
    const { emissor, repo } = montar();
    for (let i = 0; i < 100; i++) emissor.emitir(ev(i));
    const todos = repo.listar({ limite: 100 }).itens;
    expect(todos.length).toBeLessThanOrEqual(31);
    const resumo = todos.find((a) => a.dedupe_chave.startsWith("flood|"));
    expect(resumo?.contagem).toBe(70);
    expect(emissor.suprimidos()).toBe(70);
    expect(resumo?.titulo).toContain("70 alertas suprimidos");
  });
  it("esfriou: depois de 1 min volta a criar", () => {
    const { emissor, repo, relogio } = montar();
    for (let i = 0; i < 40; i++) emissor.emitir(ev(i));
    relogio.avancar(61_000);
    const a = emissor.emitir(ev(999));
    expect(a?.dedupe_chave).not.toMatch(/^flood/);
    expect(repo.obter(a?.id as string)).not.toBeNull();
  });
  it("falha do repositório não derruba o chamador (erro isolado e limitado a 1/min)", () => {
    const erros: string[] = [];
    const repo = { ...criarRepoAlertasMemoria(), inserir: () => { throw new Error("disco cheio"); } };
    const e = criarEmissor({ repo, barramento: barramentoFalso(), relogio: relogioFalso(), aoErro: (c) => erros.push(c) });
    expect(e.emitir(ev(1))).toBeNull();
    expect(e.emitir(ev(2))).toBeNull();
    expect(erros).toEqual(["persistencia"]);
  });
  it("falha do barramento e do avaliador também ficam isoladas", () => {
    const erros: string[] = [];
    const e = criarEmissor({ repo: criarRepoAlertasMemoria(), barramento: { emitir() { throw new Error("x"); } }, relogio: relogioFalso(), aoErro: (c) => erros.push(c), aoCriar() { throw new Error("y"); } });
    expect(e.emitir(ev(1))).not.toBeNull();
    expect(erros.length).toBeGreaterThan(0);
  });
  it("P-140: emitir é síncrono e rápido (<= 5 ms por alerta em média)", () => {
    const { emissor } = montar({ floodPorMin: 100000 });
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) emissor.emitir(ev(i));
    expect((performance.now() - t0) / 1000).toBeLessThan(5);
  });
});

describe("serviço de leitura", () => {
  it("lido e silenciar são idempotentes; contagem e paginação", () => {
    const { emissor, repo, barramento } = montar({ floodPorMin: 1000 });
    const ids = Array.from({ length: 120 }, (_, i) => emissor.emitir({ ...ev(i), ...(i === 0 ? { severidade: "critico" as const } : {}) })?.id as string);
    const s = criarServicoLeitura({ repo, barramento });
    expect(s.contar()).toEqual({ nao_lidos: 120, criticos: 1 });
    expect(s.marcarLido(ids.slice(0, 10))).toBe(10);
    expect(s.marcarLido(ids.slice(0, 10))).toBe(0);
    expect(s.contar().nao_lidos).toBe(110);
    const p1 = s.listar({ estado: "nao_lidos", limite: 100 });
    expect(p1.itens).toHaveLength(100);
    const p2 = s.listar({ estado: "nao_lidos", depois_id: p1.proximo, limite: 100 });
    expect(p2.itens).toHaveLength(10);
    expect(s.marcarTodosLidos()).toBe(110);
    expect(s.contar().nao_lidos).toBe(0);
    expect(s.silenciar({ tipo: "tarefa_concluida" }, "2030-01-01T00:00:00Z")).toBe(true);
    expect(s.listar({ estado: "silenciados" }).itens.length).toBeGreaterThan(0);
  });
});
