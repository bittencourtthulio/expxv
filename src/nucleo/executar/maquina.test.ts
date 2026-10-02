import { describe, expect, it } from "vitest";
import { apresentarBotao, atalhosDeExecucao, estaAtiva, interpretarAtalhoExecutar, reduzir, type EventoMaquina } from "./maquina";
import { ESTADO_OCIOSO } from "./modelo";
import { formatarDuracao, traduzirSaida } from "./saida";

const T0 = 1_000_000;
const iniciar = (extra: Partial<Extract<EventoMaquina, { t: "iniciar" }>> = {}): EventoMaquina => ({ t: "iniciar", execucao_id: "exe_1", config_id: "dev", nome: "Rodar (dev)", tipo: "rodar", passos_total: 1, agora: T0, ...extra });
const A = atalhosDeExecucao(false);

describe("máquina de estados play/stop/restart", () => {
  it("ocioso → preparando → rodando → concluída/falhou/parada", () => {
    let e = ESTADO_OCIOSO("ws_1");
    e = reduzir(e, iniciar());
    expect(e).toMatchObject({ fase: "preparando", passo: 1, iniciado_em: T0 });
    e = reduzir(e, { t: "passo", passo: 1, sessao_id: "s1" });
    expect(e).toMatchObject({ fase: "rodando", sessao_id: "s1" });
    expect(estaAtiva(e)).toBe(true);
    const ok = reduzir(e, { t: "terminou", agora: T0 + 5, resultado: "sucesso", codigo: 0, sinal: null, mensagem: "ok" });
    expect(ok).toMatchObject({ fase: "concluida", codigo: 0, terminado_em: T0 + 5 });
    expect(reduzir(e, { t: "terminou", agora: T0, resultado: "falha", codigo: 1, sinal: null, mensagem: "x" }).fase).toBe("falhou");
    expect(reduzir(e, { t: "terminou", agora: T0, resultado: "parada", codigo: null, sinal: 15, mensagem: "x" }).fase).toBe("parada");
  });

  it("pré-passos: fica 'preparando' até o último passo", () => {
    let e = reduzir(ESTADO_OCIOSO("ws_1"), iniciar({ passos_total: 2 }));
    e = reduzir(e, { t: "passo", passo: 1, sessao_id: "s1" });
    expect(e).toMatchObject({ fase: "preparando", passo: 1 });
    e = reduzir(e, { t: "passo", passo: 2, sessao_id: "s2" });
    expect(e).toMatchObject({ fase: "rodando", passo: 2, sessao_id: "s2" });
  });

  it("parar só vale com execução ativa e bloqueia novos passos; terminar desfaz", () => {
    expect(reduzir(ESTADO_OCIOSO("ws_1"), { t: "parar" }).fase).toBe("ocioso");
    let e = reduzir(reduzir(ESTADO_OCIOSO("ws_1"), iniciar()), { t: "passo", passo: 1, sessao_id: "s1" });
    e = reduzir(e, { t: "parar" });
    expect(e.fase).toBe("parando");
    expect(reduzir(e, { t: "passo", passo: 1, sessao_id: "s9" })).toBe(e);
    expect(reduzir(e, { t: "terminou", agora: T0, resultado: "parada", codigo: null, sinal: 2, mensagem: "p" }).fase).toBe("parada");
  });

  it("iniciar durante uma execução ativa é ignorado (um por workspace)", () => {
    const e = reduzir(ESTADO_OCIOSO("ws_1"), iniciar());
    expect(reduzir(e, iniciar({ execucao_id: "exe_2" }))).toBe(e);
  });

  it("porta detectada fica; a segunda não troca a primeira", () => {
    let e = reduzir(ESTADO_OCIOSO("ws_1"), iniciar());
    e = reduzir(e, { t: "porta", porta: 5173, url: "http://localhost:5173/" });
    e = reduzir(e, { t: "porta", porta: 9999, url: "http://localhost:9999/" });
    expect(e).toMatchObject({ porta: 5173, url: "http://localhost:5173/" });
  });

  it("falha ao iniciar vira 'falhou' com a mensagem", () => {
    expect(reduzir(ESTADO_OCIOSO("ws_1"), { t: "falha_ao_iniciar", agora: T0, mensagem: "Programa não encontrado" })).toMatchObject({ fase: "falhou", mensagem: "Programa não encontrado" });
  });

  it("nova execução depois de terminar zera porta e código", () => {
    let e = reduzir(reduzir(ESTADO_OCIOSO("ws_1"), iniciar()), { t: "porta", porta: 1, url: "http://localhost:1/" });
    e = reduzir(e, { t: "terminou", agora: T0, resultado: "falha", codigo: 2, sinal: null, mensagem: "f" });
    e = reduzir(e, iniciar({ execucao_id: "exe_9" }));
    expect(e).toMatchObject({ fase: "preparando", porta: null, codigo: null, execucao_id: "exe_9" });
  });
});

describe("apresentação do botão (rótulo, tooltip, chip e aria)", () => {
  const rodando = (extra = {}) => ({ ...reduzir(reduzir(ESTADO_OCIOSO("ws_1"), iniciar()), { t: "passo", passo: 1, sessao_id: "s1" }), ...extra });

  it("ocioso: ▶ Executar com o nome da configuração padrão e o atalho", () => {
    const b = apresentarBotao(ESTADO_OCIOSO("ws_1"), "Rodar (dev)", T0, A);
    expect(b).toMatchObject({ acao: "executar", rotulo: "Executar", desabilitado: false, chip: null, tom: "neutro" });
    expect(b.tooltip).toBe("Executar Rodar (dev) (F5)");
    expect(b.aria).toBe("Executar Rodar (dev)");
  });

  it("rodando: vira ■ Parar com tempo e porta no chip e no tooltip", () => {
    const b = apresentarBotao(rodando({ porta: 5173 }), "Rodar (dev)", T0 + 42_000, A);
    expect(b).toMatchObject({ acao: "parar", rotulo: "Parar", tom: "ativo" });
    expect(b.chip).toBe("rodando há 00:42 · porta 5173");
    expect(b.tooltip).toContain("Parar (Shift+F5)");
    expect(b.tooltip).toContain("reiniciar (Ctrl+Shift+F5)");
    expect(b.aria).toContain("rodando há 00:42");
  });

  it("preparando mostra o passo", () => {
    const e = reduzir(ESTADO_OCIOSO("ws_1"), iniciar({ passos_total: 2 }));
    expect(apresentarBotao(e, null, T0, A).chip).toBe("preparando (passo 1/2)");
  });

  it("parando: desabilitado", () => {
    const b = apresentarBotao(reduzir(rodando(), { t: "parar" }), null, T0, A);
    expect(b).toMatchObject({ desabilitado: true, rotulo: "Parando…", chip: "parando…" });
  });

  it("saiu com erro: ▶ de novo, tom de erro, chip com o código e a mensagem no tooltip", () => {
    const e = reduzir(rodando(), { t: "terminou", agora: T0 + 1, resultado: "falha", codigo: 1, sinal: null, mensagem: "Build falhou (código 1): veja o painel Execução." });
    const b = apresentarBotao(e, "Build completo", T0 + 100, A);
    expect(b).toMatchObject({ acao: "executar", tom: "erro", chip: "saiu com código 1" });
    expect(b.tooltip).toContain("Build falhou");
  });

  it("concluída e parada", () => {
    expect(apresentarBotao(reduzir(rodando(), { t: "terminou", agora: T0, resultado: "sucesso", codigo: 0, sinal: null, mensagem: "ok" }), null, T0, A)).toMatchObject({ tom: "ok", chip: "concluído" });
    expect(apresentarBotao(reduzir(rodando(), { t: "terminou", agora: T0, resultado: "parada", codigo: null, sinal: 2, mensagem: "p" }), null, T0, A)).toMatchObject({ tom: "neutro", chip: "parado" });
  });

  it("no macOS o tooltip cita F5 e o equivalente com ⌘", () => {
    expect(apresentarBotao(ESTADO_OCIOSO("ws_1"), "x", T0, atalhosDeExecucao(true)).tooltip).toBe("Executar x (F5 ou ⌘R)");
  });
});

describe("atalhos", () => {
  const tecla = (key: string, m: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; code: string }> = {}) => ({ type: "keydown", key, code: m.code ?? "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...m });
  it.each([
    ["F5", {}, false, "alternar"],
    ["F5", { shiftKey: true }, false, "parar"],
    ["F5", { ctrlKey: true, shiftKey: true }, false, "reiniciar"],
    ["F5", { metaKey: true, shiftKey: true }, true, "reiniciar"],
    ["F5", {}, true, "alternar"],
    ["F5", { ctrlKey: true }, false, null],
    ["F5", { altKey: true }, false, null],
    ["r", { metaKey: true }, true, "alternar"],
    ["R", { metaKey: true, shiftKey: true }, true, "reiniciar"],
    [".", { metaKey: true }, true, "parar"],
    ["r", { metaKey: true }, false, null],
    ["r", { ctrlKey: true }, false, null],
    ["r", { ctrlKey: true }, true, null],
    ["c", { ctrlKey: true }, false, null],
  ] as const)("%s %j mac=%s → %s", (key, mod, mac, esperado) => {
    expect(interpretarAtalhoExecutar(tecla(key, mod), mac)).toBe(esperado);
  });
  it("ignora keyup", () => expect(interpretarAtalhoExecutar({ ...tecla("F5"), type: "keyup" }, false)).toBeNull());
});

describe("tradução de código de saída", () => {
  const s = (codigo: number | null, sinal: number | null = null, parado = false) => ({ codigo, sinal, parado_pelo_usuario: parado });
  it.each([
    ["build", s(0), "sucesso", "Build concluído com sucesso."],
    ["teste", s(0), "sucesso", "Testes passaram."],
    ["rodar", s(0), "sucesso", "Rodar terminou sem erros."],
    ["build", s(1), "falha", "Build falhou (código 1): veja o painel Execução."],
    ["teste", s(1), "falha", "Testes falharam (código 1): veja o painel Execução."],
    ["rodar", s(2), "falha", "Rodar saiu com código 2: veja o painel Execução."],
    ["rodar", s(127), "falha", "Comando não encontrado: confira se o programa está instalado e no PATH."],
    ["rodar", s(126), "falha", "Sem permissão para executar o comando."],
    ["rodar", s(130), "falha", "Rodar foi interrompido (Ctrl+C)."],
    ["rodar", s(null, 2), "falha", "Rodar foi interrompido (Ctrl+C)."],
    ["rodar", s(137), "falha", "Rodar foi encerrado à força (SIGKILL; pode ter faltado memória)."],
    ["rodar", s(143), "falha", "Rodar foi encerrado (SIGTERM)."],
    ["rodar", s(139), "falha", "Rodar travou (falha de segmentação)."],
    ["rodar", s(null, 6), "falha", "Rodar foi encerrado pelo sinal SIGABRT."],
    ["rodar", s(null), "falha", "Rodar saiu com sem código: veja o painel Execução."],
    ["rodar", s(143, 15, true), "parada", "Rodar foi parado."],
  ] as const)("%s %j", (tipo, saida, resultado, mensagem) => {
    expect(traduzirSaida(tipo, saida, "Rodar")).toEqual({ resultado, mensagem });
  });
  it("formatarDuracao", () => {
    expect(formatarDuracao(0)).toBe("00:00");
    expect(formatarDuracao(42_000)).toBe("00:42");
    expect(formatarDuracao(3_725_000)).toBe("01:02:05");
    expect(formatarDuracao(-5)).toBe("00:00");
  });
});
