// T-09.17 · decisões: registro (banco real), paginação, retenção, recibo sem segredo e `explicar` em PT-BR.
import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../banco";
import { criarRepositorios } from "../banco/repos";
import type { Decisao } from "../../compartilhado/harness";
import { AGORA } from "../../../tests/fixtures/harness/construtores";
import { decisaoEntrada } from "../../../tests/fixtures/harness/rotas";
import { criarServicoDecisoes, explicar, explicarTroca, limitarRetencao, RETENCAO_PADRAO_DIAS } from "./decisoes";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
function novo(retencaoDias?: number) {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  const r = criarRepositorios(b);
  const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
  const svc = criarServicoDecisoes({ decisoes: r.decisao, trocas: r.trocaLog, agora: () => AGORA, ...(retencaoDias === undefined ? {} : { retencaoDias }) });
  return { b, r, ws, svc };
}
const iso = (diasAtras: number): string => new Date(AGORA - diasAtras * 86_400_000).toISOString();

describe("registro e consulta", () => {
  it("grava a decisão com recibo sanitizado e escolhida ∈ opcoes mesmo com texto com cara de segredo", () => {
    const { svc } = novo();
    const SEG = "sk-SENTINELA0123456789abcdef";
    const g = svc.registrar(decisaoEntrada({ opcoes: [`claude:${SEG}`, "codex:default"], escolhida: `claude:${SEG}`, escolha_regra: `claude:${SEG}`, recibo: `Mantido ${SEG} com Bearer abc.def.ghi-123456789 em /Users/fulano/x.` }));
    expect(g.id).toMatch(/^dec_/);
    expect(JSON.stringify(g)).not.toMatch(/SENTINELA0123456789abcdef|abc\.def\.ghi|fulano/);
    expect(g.opcoes).toContain(g.escolhida);
    expect(g.custo_usd).toBeNull();
  });
  it("lista paginada (cursor, limite entre 1 e 200) com totais; custo todo desconhecido = null", () => {
    const { svc, r } = novo();
    for (let i = 0; i < 7; i++) svc.registrar(decisaoEntrada({ proposito: i % 2 ? "troca" : "selecao_conta" }));
    const p1 = svc.listar({ limite: 3 });
    expect(p1.itens).toHaveLength(3);
    expect(p1.proximo).not.toBeNull();
    expect(p1.totais).toEqual({ consultas: 7, custo_usd: null, custo_desconhecido: 7 });
    const p2 = svc.listar({ limite: 3, cursor: p1.proximo! });
    const p3 = svc.listar({ limite: 3, cursor: p2.proximo! });
    expect(p3.itens).toHaveLength(1);
    expect(p3.proximo).toBeNull();
    expect(new Set([...p1.itens, ...p2.itens, ...p3.itens].map((d) => d.id)).size).toBe(7);
    expect(svc.listar({ limite: 0 }).itens).toHaveLength(1);
    expect(svc.listar({ proposito: "troca" }).itens).toHaveLength(3);
    expect(r.decisao.listar().itens).toHaveLength(7);
  });
  it("troca: recibo nasce de campos estruturados e a listagem filtra por workspace", () => {
    const { svc, ws } = novo();
    const t = svc.registrarTroca(
      { workspace_id: ws.id },
      {
        motivo: "consumo_alto", modo: "so_sugerir", tipo_troca: "outra_conta", status: "sugerida",
        de: { provedor: "claude", modelo: "opus", conta_id: "c1", faixa: "topo", used_pct: 91, janela: "five_hour" },
        para: { provedor: "claude", modelo: "opus", conta_id: "c2", faixa: "topo", used_pct: 12 }, limiar_troca_pct: 85,
      },
    );
    expect(t.recibo).toMatch(/Troca sugerida/);
    expect(t.recibo).toMatch(/só sugerir/i);
    expect(svc.listarTrocas({ workspace_id: ws.id }).itens).toHaveLength(1);
    expect(svc.listarTrocas({ workspace_id: "outro" }).itens).toHaveLength(0);
    expect(explicarTroca(t)).toMatch(/Troca sugerida \(so sugerir\)\. Origem: 91% usado; destino: 12% usado\./);
    expect(() => criarServicoDecisoes({ decisoes: novo().r.decisao, agora: () => AGORA }).registrarTroca({ workspace_id: "x" }, {} as never)).toThrow();
  });
});

describe("retenção configurável", () => {
  it("compacta o que passou da retenção em agregado por dia e preserva o recente; é idempotente", () => {
    const { svc, r } = novo(30);
    for (const [dias, n] of [[100, 3], [40, 2], [5, 4]] as const) for (let i = 0; i < n; i++) r.decisao.inserir(decisaoEntrada(), iso(dias));
    expect(svc.retencaoDias()).toBe(30);
    expect(svc.aplicarRetencao()).toBe(5);
    expect(svc.aplicarRetencao()).toBe(0);
    expect(svc.listar().itens).toHaveLength(4);
    expect(r.decisao.agregadoDoDia(iso(100).slice(0, 10))[0]).toMatchObject({ consultas: 3, custo_desconhecido: 3 });
  });
  it("definirRetencao limita a [7, 3650] e entra em vigor na próxima compactação", () => {
    const { svc, r } = novo();
    expect(svc.retencaoDias()).toBe(RETENCAO_PADRAO_DIAS);
    expect(svc.definirRetencao(1)).toBe(7);
    expect(svc.definirRetencao(99999)).toBe(3650);
    expect(limitarRetencao(Number.NaN)).toBe(RETENCAO_PADRAO_DIAS);
    svc.definirRetencao(10);
    r.decisao.inserir(decisaoEntrada(), iso(11));
    r.decisao.inserir(decisaoEntrada(), iso(9));
    expect(svc.aplicarRetencao()).toBe(1);
  });
});

describe("explicar (puro, PT-BR)", () => {
  const base = (sobre: Partial<Decisao> = {}): Decisao => ({ ...decisaoEntrada(), id: "dec_1", criado_em: iso(0), ...sobre });
  it("política: escolha, fonte, confiança, nada saiu da máquina e custo desconhecido", () => {
    const t = explicar(base());
    expect(t).toBe("Seleção de conta: escolheu «claude:opus» entre 2 opções, por a política do tipo de tarefa, com confiança de 90%. Nada saiu da máquina. Custo desconhecido. Recibo: Mantido claude/opus (c1): 10% usado, abaixo do gatilho de 85%. Confiança alta.");
  });
  it("decisor: divergência, probabilidades, host, latência, resumo enviado e custo conhecido", () => {
    const t = explicar(base({ proposito: "task_type", fonte: "decisor", divergiu: true, escolha_regra: "geral", escolhida: "claude:opus", probs: { "claude:opus": 0.7, "codex:default": 0.3 }, decisor: { modo: "jev_direto", host: "api.exemplo.com", modelo: "m1" }, latencia_ms: 812.4, resumo_enviado: "arrumar botão", custo_usd: 0.0012, custo_origem: "tabela" }));
    expect(t).toContain("Tipo de tarefa: escolheu");
    expect(t).toContain("por o decisor externo");
    expect(t).toContain("A regra determinística escolheria «geral», mas a decisão divergiu dela.");
    expect(t).toContain("Probabilidades: claude:opus 70%, codex:default 30%.");
    expect(t).toContain("Consultou o decisor m1 em api.exemplo.com (812 ms).");
    expect(t).toContain("Foi enviado ao decisor: «arrumar botão».");
    expect(t).toContain("Custo: US$ 0,0012 (estimado pela tabela de preços).");
    expect(t).not.toContain("Nada saiu da máquina");
  });
  it("custo nunca vira zero por omissão; custo pequeno mostra 6 casas; é determinística", () => {
    expect(explicar(base({ custo_usd: null, custo_origem: null }))).toContain("Custo desconhecido.");
    expect(explicar(base({ custo_usd: 0.000123, custo_origem: "resposta" }))).toContain("US$ 0,000123");
    expect(explicar(base())).toBe(explicar(base()));
  });
  it("uma opção só não diz 'entre'; fallback mostra a escolha da regra de reserva", () => {
    const t = explicar(base({ opcoes: ["a"], escolhida: "a", fonte: "fallback", escolha_regra: "b" }));
    expect(t).not.toContain(" entre ");
    expect(t).toContain("A regra de reserva escolheu «b».");
  });
});
