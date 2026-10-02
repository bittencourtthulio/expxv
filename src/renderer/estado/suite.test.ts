import { describe, expect, it, vi } from "vitest";
import { apresentarBotaoSuite, criarStoreSuite } from "./suite";
import { PLANO, WS, criarStoreFalso, estadoSuite, progresso } from "./suite-fixtures";
import type { EstadoSuite } from "../../compartilhado/suite";

describe("apresentarBotaoSuite (tabela)", () => {
  const T: ReadonlyArray<[string, EstadoSuite | null, boolean, string, "primario" | "discreto" | null]> = [
    ["sem estado: nada", null, false, "", null],
    ["ausente: Instalar em destaque", estadoSuite("ausente"), true, "Instalar suíte ExpxDev", "primario"],
    ["ausente dispensado: some do cabeçalho", estadoSuite("ausente", { dispensado: true }), false, "", null],
    ["incompleta dispensada: some do cabeçalho (card e Método seguem)", estadoSuite("incompleta", { dispensado: true }), false, "", null], ["incompleta: Reparar em destaque", estadoSuite("incompleta"), true, "Reparar suíte ExpxDev", "primario"],
    ["desatualizada: Atualizar discreto", estadoSuite("desatualizada"), true, "Atualizar suíte ExpxDev", "discreto"],
    ["desatualizada dispensada: some", estadoSuite("desatualizada", { dispensado: true }), false, "", null],
    ["completa: some", estadoSuite("completa"), false, "", null],
    ["indisponivel: sem botão (a razão aparece na tela Método)", estadoSuite("indisponivel"), false, "", null],
  ];
  it.each(T)("%s", (_n, e, visivel, rotulo, tom) => {
    const b = apresentarBotaoSuite(e, null);
    expect(b.visivel).toBe(visivel);
    expect(b.rotulo).toBe(rotulo);
    if (tom !== null) expect(b.tom).toBe(tom);
  });
  it("instalando: botão com o percentual, qualquer que seja o estado", () => {
    const b = apresentarBotaoSuite(estadoSuite("ausente", { instalando: true }), progresso("rodando", { percentual: 42 }));
    expect(b).toMatchObject({ visivel: true, instalando: true, rotulo: "Instalando… 42%", percentual: 42 });
  });
});

describe("store da suíte", () => {
  it("lazy: nada é pedido ao main até ligar; ligar busca o estado do workspace atual em ocioso", async () => {
    const m = criarStoreFalso();
    expect(m.api.estado).not.toHaveBeenCalled();
    m.store.ligar();
    await vi.waitFor(() => expect(m.api.estado).toHaveBeenCalledWith(WS));
    expect(m.store.obter().estados[WS]?.estado).toBe("ausente");
  });

  it("abrirModal só lê requisitos locais (nada de instalar sem o clique); instalar usa o modo do plano", async () => {
    const m = criarStoreFalso();
    m.store.ligar();
    m.store.abrirModal();
    await vi.waitFor(() => expect(m.store.obter().plano).not.toBeNull());
    expect(m.api.instalar).not.toHaveBeenCalled();
    await m.store.instalar();
    expect(m.api.instalar).toHaveBeenCalledWith(WS, "instalar");
  });

  it("não instala se o plano bloqueia", async () => {
    const m = criarStoreFalso();
    m.api.requisitos.mockResolvedValueOnce({ ...PLANO, pode_instalar: false });
    m.store.ligar();
    m.store.abrirModal();
    await vi.waitFor(() => expect(m.store.obter().plano).not.toBeNull());
    await m.store.instalar();
    expect(m.api.instalar).not.toHaveBeenCalled();
  });

  it("eventos: progresso do workspace atual alimenta o estado; o final recarrega o estado; progresso de outro workspace não aparece", async () => {
    const m = criarStoreFalso();
    m.store.ligar();
    m.emitir(progresso("rodando"));
    expect(m.store.obter().progresso?.percentual).toBe(25);
    m.emitir({ ...progresso("rodando"), workspace_id: "ws_BBBBBBBBBBBB", percentual: 90 });
    expect(m.store.obter().progresso?.percentual).toBe(25);
    m.api.estado.mockClear();
    m.emitir(progresso("concluida", { percentual: 100 }));
    await vi.waitFor(() => expect(m.api.estado).toHaveBeenCalled());
    m.emitir({ tipo: "estado", estado: estadoSuite("completa") });
    expect(m.store.obter().estados[WS]?.estado).toBe("completa");
  });

  it("cancelar pergunta antes; desistir volta; confirmar chama o main", async () => {
    const m = criarStoreFalso();
    m.store.ligar();
    m.store.pedirCancelar();
    expect(m.store.obter().confirmandoCancelar).toBe(true);
    m.store.desistirCancelar();
    expect(m.store.obter().confirmandoCancelar).toBe(false);
    await m.store.cancelar();
    expect(m.api.cancelar).toHaveBeenCalledWith(WS);
  });

  it("Agora não grava por workspace e fecha o modal; reativar não fecha", async () => {
    const m = criarStoreFalso();
    m.store.ligar();
    m.store.abrirModal();
    await m.store.dispensar(true);
    expect(m.api.dispensar).toHaveBeenCalledWith(WS, true);
    expect(m.store.obter().modal).toBe(false);
    expect(m.store.obter().estados[WS]?.dispensado).toBe(true);
  });

  it("tentar de novo volta ao primeiro passo; abrir o Método fecha o modal e navega", async () => {
    const m = criarStoreFalso();
    m.store.ligar();
    m.emitir(progresso("falhou"));
    m.store.tentarDeNovo();
    expect(m.store.obter().progresso).toBeNull();
    await vi.waitFor(() => expect(m.store.obter().plano).not.toBeNull());
    m.store.abrirModal();
    m.store.abrirMetodo();
    expect(m.metodo).toHaveBeenCalled();
    expect(m.store.obter().modal).toBe(false);
  });

  it("sem API (fora do Electron) o botão fica indisponível", () => {
    const store = criarStoreSuite({ api: () => undefined, workspaces: { obter: () => ({ atual: { id: WS } }) as never, assinar: () => () => undefined }, ocioso: (f) => f() });
    store.ligar();
    expect(store.obter().disponivel).toBe(false);
  });
});
