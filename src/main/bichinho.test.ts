import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventoBichinhoMudou } from "../compartilhado/bichinho";
import { abrirBanco, type Banco } from "../nucleo/banco/banco";
import { migrar } from "../nucleo/banco/migrar";
import { criarBarramento } from "./barramento";
import { contarLinhas, criarBichinhoMain, leitorDeDisco, type DepsBichinhoMain } from "./bichinho";
import type { LeitorTokensGrok } from "../nucleo/bichinho/tokens-grok";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const limpar: Array<() => void> = [];
afterEach(() => limpar.splice(0).forEach((f) => f()));
const TS = "2026-10-01T12:00:00.000Z";
const WS = "ws_AAAAAAAAAA";
const ARQ_AMBIENTE = [".", "env"].join("");

describe("leitorDeDisco (confinado à raiz)", () => {
  it("lê só arquivo regular pequeno, nunca ambiente/segredo, nunca symlink, nunca fora da raiz", () => {
    const raiz = mkdtempSync(join(tmpdir(), "bich-"));
    const fora = mkdtempSync(join(tmpdir(), "bich-fora-"));
    limpar.push(() => rmSync(raiz, { recursive: true, force: true }), () => rmSync(fora, { recursive: true, force: true }));
    writeFileSync(join(raiz, "package.json"), "{}");
    writeFileSync(join(raiz, ARQ_AMBIENTE), "SEGREDO=1");
    writeFileSync(join(raiz, `${ARQ_AMBIENTE}.local`), "SEGREDO=2");
    writeFileSync(join(fora, "alvo.txt"), "fora");
    symlinkSync(join(fora, "alvo.txt"), join(raiz, "ligacao.txt"));
    mkdirSync(join(raiz, "src"));
    writeFileSync(join(raiz, "src", "a.rs"), "");
    writeFileSync(join(raiz, "grande.json"), "x".repeat(200 * 1024));
    const l = leitorDeDisco(raiz);
    expect(l.ler("package.json")).toBe("{}");
    expect(l.ler(ARQ_AMBIENTE)).toBeNull();
    expect(l.ler(`${ARQ_AMBIENTE}.local`)).toBeNull();
    expect(l.ler("ligacao.txt")).toBeNull();
    expect(l.ler("../alvo.txt")).toBeNull();
    expect(l.ler("/etc/passwd")).toBeNull();
    expect(l.ler("grande.json")).toBeNull();
    expect(l.listar("")).not.toContain(ARQ_AMBIENTE);
    expect(l.listar("")).not.toContain("ligacao.txt");
    expect(l.listar("")).toEqual(expect.arrayContaining(["package.json", "src"]));
    expect(l.listar("src")).toEqual(["a.rs"]);
    expect(l.listar("../")).toEqual([]);
    expect(l.existe("src")).toBe(true);
    expect(l.existe("nao-existe")).toBe(false);
  });
});

describe("criarBichinhoMain: eventos do barramento → humor por workspace", () => {
  function montar() {
    const banco: Banco = abrirBanco(":memory:");
    limpar.push(() => banco.fechar());
    migrar(banco);
    banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES (?,'app','/nao/existe',?,?)", [WS, TS, TS]);
    banco.executar("INSERT INTO pane (id,workspace_id,display_id,tipo,papel,eh_piloto,estado,criado_em,atualizado_em) VALUES ('pane_AAAAAAAAAA',?,1,'cli','nenhum',0,'iniciando',?,?)", [WS, TS, TS]);
    const barramento = criarBarramento();
    const enviados: EventoBichinhoMudou[] = [];
    const b = criarBichinhoMain({ banco, barramento, enviar: (e) => enviados.push(e), atrasoEmitirMs: 5 });
    limpar.push(() => b.encerrar());
    return { banco, barramento, enviados, b };
  }

  it("pane.state_changed → trabalhando/aguardando; mission.closed → comemorando; run.failed → preocupado", async () => {
    const { barramento, enviados, b } = montar();
    await b.servico.obter(WS);
    barramento.emitir("pane.state_changed", { pane_id: "pane_AAAAAAAAAA", estado: "trabalhando" });
    await esperar(40);
    expect(enviados.at(-1)?.visao.humor).toBe("trabalhando");
    barramento.emitir("pane.state_changed", { pane_id: "pane_AAAAAAAAAA", estado: "aguardando" });
    await esperar(40);
    expect(enviados.at(-1)?.visao.humor).toBe("aguardando");
    barramento.emitir("pane.state_changed", { pane_id: "pane_AAAAAAAAAA", estado: "encerrado" });
    barramento.emitir("mission.closed", { mission_id: "mis_x", workspace_id: WS, estado: "concluida" });
    await esperar(40);
    expect(enviados.at(-1)?.visao.humor).toBe("comemorando");
    barramento.emitir("run.failed", { workspace_id: WS, mensagem: "x" });
    await esperar(40);
    expect(enviados.at(-1)?.visao.humor).toBe("preocupado");
  });

  it("task.updated entregue/validada recalcula o ovo; o ovo choca com 4 tarefas e 150 mil tokens e o evento carrega nasceu (uma vez)", async () => {
    const { banco, barramento, enviados, b } = montar();
    banco.executar("INSERT INTO mission (id,workspace_id,modo,origem,titulo,estado,criado_em,atualizado_em) VALUES ('mi_A',?,'livre','livre','t','executando',?,?)", [WS, TS, TS]);
    banco.executar("INSERT INTO custo_agregado (escopo,chave,dia,modelo,atribuicao,tokens_entrada,tokens_saida) VALUES ('workspace',?,'2026-10-01','m','card',200000,0)", [WS]);
    const v0 = await b.servico.obter(WS);
    expect(v0).toMatchObject({ estagio: "ovo", ovo: { tarefas: 0, meta_tarefas: 4 } });
    for (let i = 0; i < 4; i++) banco.executar("INSERT INTO task (id,mission_id,task_ref,titulo,papel,estado,criado_em,atualizado_em) VALUES (?,'mi_A',?,'t','nenhum','entregue',?,?)", [`ta_${i}`, `T-${i}`, TS, TS]);
    barramento.emitir("task.updated", { workspace_id: WS, estado: "reivindicada" }); // não conta como marco
    await esperar(30);
    expect(enviados.filter((e) => e.nasceu === true)).toHaveLength(0);
    barramento.emitir("task.updated", { workspace_id: WS, estado: "entregue" });
    await esperar(5_200);
    const nasceu = enviados.filter((e) => e.nasceu === true);
    expect(nasceu).toHaveLength(1);
    expect(nasceu[0]).toMatchObject({ estagio_novo: true, visao: { estagio: "filhote", ovo: null } });
  }, 15_000);

  it("ignora eventos de Pane desconhecido, workspace inexistente e payload malformado (sem lançar)", async () => {
    const { barramento, enviados, b } = montar();
    await b.servico.obter(WS);
    const antes = enviados.length;
    barramento.emitir("pane.state_changed", { pane_id: "pane_ZZZZZZZZZZ", estado: "trabalhando" });
    barramento.emitir("pane.state_changed", { pane_id: 42, estado: {} });
    barramento.emitir("mission.closed", null);
    barramento.emitir("run.failed", { workspace_id: "ws_NAOEXISTE1" });
    barramento.emitir("limit.high", { used_pct: "alto" });
    await esperar(30);
    expect(enviados.length).toBe(antes);
  });

  it("cota ≥ 85% (limit.high) deixa o bichinho doente; alerta crítico preocupa", async () => {
    const { barramento, enviados, b } = montar();
    await b.servico.obter(WS);
    barramento.emitir("limit.high", { conta_id: "c", janela: "five_hour", used_pct: 91 });
    await esperar(40);
    expect(enviados.at(-1)?.visao.doente).toBe(true);
    barramento.emitir("alert.created", { alert_id: "a", tipo: "x", severidade: "critico", workspace_id: WS });
    await esperar(40);
    expect(enviados.at(-1)?.visao.humor).toBe("preocupado");
  });

  it("o serviço nascido depois semeia o humor com os Panes que já trabalhavam", async () => {
    const banco: Banco = abrirBanco(":memory:");
    limpar.push(() => banco.fechar());
    migrar(banco);
    banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES (?,'app','/nao/existe',?,?)", [WS, TS, TS]);
    banco.executar("INSERT INTO pane (id,workspace_id,display_id,tipo,papel,eh_piloto,estado,criado_em,atualizado_em) VALUES ('pane_BBBBBBBBBB',?,1,'cli','nenhum',0,'trabalhando',?,?)", [WS, TS, TS]);
    const b = criarBichinhoMain({ banco, barramento: criarBarramento(), enviar: () => undefined });
    limpar.push(() => b.encerrar());
    expect((await b.servico.obter(WS)).humor).toBe("trabalhando");
  });
});

describe("pulso do PTY: CLI sem adaptador (Grok) reage só pela saída e pelos tokens lidos", () => {
  function montarPulso(extra: Partial<DepsBichinhoMain> = {}) {
    const banco: Banco = abrirBanco(":memory:");
    limpar.push(() => banco.fechar());
    migrar(banco);
    banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES (?,'app','/p/app',?,?)", [WS, TS, TS]);
    const barramento = criarBarramento();
    const enviados: EventoBichinhoMudou[] = [];
    const timersGrok: Array<{ fn: () => void; vivo: boolean }> = [];
    const b = criarBichinhoMain({
      banco, barramento, enviar: (e) => enviados.push(e), atrasoEmitirMs: 5,
      agendar: (fn) => { const t = { fn, vivo: true }; timersGrok.push(t); return { cancelar: () => { t.vivo = false; } }; },
      ...extra,
    });
    limpar.push(() => b.encerrar());
    return { banco, barramento, enviados, b, timersGrok };
  }
  const saida = (n: number): string => "x".repeat(n);

  it("a preferência de meta do ovo (2 a 6) chega ao serviço", async () => {
    const banco: Banco = abrirBanco(":memory:");
    limpar.push(() => banco.fechar());
    migrar(banco);
    banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES (?,'app','/nao/existe',?,?)", [WS, TS, TS]);
    const b = criarBichinhoMain({ banco, barramento: criarBarramento(), enviar: () => undefined, prefs: () => ({ metaOvo: 6, semRepetir: true }) });
    limpar.push(() => b.encerrar());
    expect((await b.servico.obter(WS)).ovo?.meta_tarefas).toBe(6);
  });

  it("contarLinhas conta quebras sem copiar o texto", () => {
    expect(contarLinhas("")).toBe(0);
    expect(contarLinhas("a\nb\nc")).toBe(2);
    expect(contarLinhas("\n\n\n")).toBe(3);
  });

  it("sessão do Grok que só emite saída (sem Pane trabalhando, sem adaptador) deixa o bichinho trabalhando", async () => {
    const { b, enviados } = montarPulso();
    await b.servico.obter(WS);
    for (let i = 0; i < 6; i++) { b.pulso.aoSaida({ sessao_id: "ses1", workspace_id: WS, ferramenta_id: "grok", dados: saida(1_200) }); await esperar(80); }
    await esperar(300);
    const v = enviados.at(-1)!.visao;
    expect(v.humor).toBe("trabalhando");
    expect(v.esforco.nivel).toBeGreaterThanOrEqual(2);
    expect(v.esforco.origem).toBe("estimado");
  });

  it("sessão sem workspace, workspace desconhecido e encerramento não lançam nem deixam esforço", async () => {
    const { b, enviados } = montarPulso();
    await b.servico.obter(WS);
    b.pulso.aoSaida({ sessao_id: "s", workspace_id: null, ferramenta_id: "terminal", dados: "abc" });
    b.pulso.aoSaida({ sessao_id: "s", workspace_id: "ws_ZZZZZZZZZZ", ferramenta_id: "grok", dados: "abc" });
    b.pulso.aoEntrada({ workspace_id: null });
    b.pulso.aoSessaoEncerrada({ sessao_id: "s", workspace_id: WS });
    await esperar(350);
    expect(enviados.at(-1)?.visao.esforco.nivel ?? 0).toBe(0);
  });

  it("Grok: relê usage.json depois da saída, só contagens, e o consumo vira tokens/min medidos", async () => {
    const chamadas: string[] = [];
    const leitor: LeitorTokensGrok = { delta: async (cwd) => { chamadas.push(cwd); return 4_200; }, esquecer: () => undefined };
    const { b, enviados, timersGrok } = montarPulso({ leitorGrok: leitor });
    await b.servico.obter(WS);
    b.pulso.aoSaida({ sessao_id: "g", workspace_id: WS, ferramenta_id: "grok", dados: "oi\n" });
    expect(timersGrok.filter((t) => t.vivo)).toHaveLength(1);
    b.pulso.aoSaida({ sessao_id: "g", workspace_id: WS, ferramenta_id: "grok", dados: "mais\n" });
    expect(timersGrok.filter((t) => t.vivo)).toHaveLength(1);
    timersGrok[0]!.fn();
    await esperar(400);
    expect(chamadas).toEqual(["/p/app"]);
    expect(enviados.at(-1)?.visao.esforco).toMatchObject({ origem: "medido", tokens_por_min: 4_200, nivel: 3 });
  });

  it("outras CLIs não acionam o leitor do Grok", async () => {
    const leitor: LeitorTokensGrok = { delta: async () => { throw new Error("não deveria ler"); }, esquecer: () => undefined };
    const { b, timersGrok } = montarPulso({ leitorGrok: leitor });
    await b.servico.obter(WS);
    b.pulso.aoSaida({ sessao_id: "c", workspace_id: WS, ferramenta_id: "claude", dados: "oi" });
    expect(timersGrok).toHaveLength(0);
  });

  it("cost.updated do workspace transforma o delta do custo persistido em tokens/min (Claude/Codex/OpenCode)", async () => {
    const { b, banco, barramento, enviados } = montarPulso();
    banco.executar("INSERT INTO custo_agregado (escopo,chave,dia,modelo,atribuicao,tokens_entrada,tokens_saida) VALUES ('workspace',?,'2026-10-01','m','card',1000,100)", [WS]);
    await b.servico.obter(WS);
    banco.executar("INSERT INTO custo_agregado (escopo,chave,dia,modelo,atribuicao,tokens_entrada,tokens_saida) VALUES ('workspace',?,'2026-10-02','m','card',5000,500)", [WS]);
    barramento.emitir("cost.updated", { escopos: [{ escopo: "workspace", chave: WS }, { escopo: "pane", chave: "x" }] });
    await esperar(400);
    expect(enviados.at(-1)?.visao.esforco).toMatchObject({ origem: "medido", tokens_por_min: 5_500, nivel: 3 });
  });

  it("encerrar cancela os timers do Grok", async () => {
    const { b, timersGrok } = montarPulso();
    await b.servico.obter(WS);
    b.pulso.aoSaida({ sessao_id: "g", workspace_id: WS, ferramenta_id: "grok", dados: "oi" });
    b.encerrar();
    expect(timersGrok.filter((t) => t.vivo)).toHaveLength(0);
  });
});
