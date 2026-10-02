import { describe, expect, it, vi } from "vitest";
import type { EventoTerminal, FerramentaDetectada, MetadadosSessao } from "../../compartilhado/terminais";
import { criarArmazem } from "../componentes/Terminal/armazem";
import { criarStoreTerminais } from "./terminais";

const meta = (sessao_id: string, estado: MetadadosSessao["estado"] = "executando"): MetadadosSessao => ({ sessao_id, ferramenta_id: "claude", estado, workspace_id: null, criada_em: "x", persistente: true });
const ferramenta = (nome = "Claude Code"): FerramentaDetectada => ({
  id: "claude", nome, descricao: "", instalado: true, executavel_id: "exe1", modo_lancamento: "direto", erro_codigo: null, versao: "1",
  recursos: { prompt_inicial: true, retomar: true, mcp: true, hook: true },
});
const ev = <T extends EventoTerminal["tipo"]>(tipo: T, sessao_id: string, sequencia: number, extra: object = {}) => ({ versao: 1, tipo, sessao_id, sequencia, ...extra }) as EventoTerminal;

function montar(recuperadas: MetadadosSessao[] = [], limite?: () => number) {
  let ouvirEvento: (e: EventoTerminal) => void = () => undefined;
  let ouvirFalha: (f: { sessao_id: string; codigo: string; mensagem: string }) => void = () => undefined;
  const api = {
    assinarEventos: vi.fn((cb) => { ouvirEvento = cb; return () => undefined; }),
    assinarFalhas: vi.fn((cb) => { ouvirFalha = cb; return () => undefined; }),
    recuperar: vi.fn().mockResolvedValue({ sessoes: recuperadas }),
    listarFerramentas: vi.fn().mockResolvedValue([ferramenta()]),
    abrir: vi.fn().mockResolvedValue({ versao: 1, sessao_id: "novo", estado: "iniciando" }),
    confirmarConsumo: vi.fn().mockResolvedValue(true),
    descartar: vi.fn().mockResolvedValue(true),
    interromper: vi.fn(),
  };
  const armazem = criarArmazem();
  const store = criarStoreTerminais({ api: () => api as never, armazem, ...(limite === undefined ? {} : { limite }) });
  return { api, armazem, store, emitir: (e: EventoTerminal) => ouvirEvento(e), falhar: (f: Parameters<typeof ouvirFalha>[0]) => ouvirFalha(f) };
}

describe("store de terminais: assinatura e recuperação", () => {
  it("faz UMA assinatura global mesmo com iniciar() repetido e só então marca recuperado", async () => {
    const { api, store } = montar([meta("a"), meta("b")]);
    expect(store.obter().recuperado).toBe(false);
    await Promise.all([store.iniciar(), store.iniciar()]);
    await store.iniciar();
    expect(api.assinarEventos).toHaveBeenCalledTimes(1);
    expect(api.recuperar).toHaveBeenCalledTimes(1);
    expect(store.obter().recuperado).toBe(true);
    expect(store.obter().sessoes.map((s) => [s.sessao_id, s.numero])).toEqual([["a", 1], ["b", 2]]);
  });

  it("replay da recuperação não duplica saída: sequência repetida é descartada e o armazém guarda uma vez", async () => {
    const { store, emitir, armazem } = montar([meta("a")]);
    await store.iniciar();
    emitir(ev("saida", "a", 1, { dados: "um " }));
    emitir(ev("saida", "a", 2, { dados: "dois" }));
    emitir(ev("saida", "a", 2, { dados: "dois" })); // o replay do daemon repete
    emitir(ev("saida", "a", 1, { dados: "um " }));
    expect(armazem.chunks("a")).toEqual(["um ", "dois"]);
  });

  it("sem API (fora do Electron) fica recuperado e indisponível, sem quebrar", async () => {
    const store = criarStoreTerminais({ api: () => undefined, armazem: criarArmazem() });
    await store.iniciar();
    expect(store.obter()).toMatchObject({ recuperado: true, disponivel: false });
  });

  it("falha na recuperação vira mensagem clara e libera a gravação do layout", async () => {
    const { api, store } = montar();
    api.recuperar.mockRejectedValue(new Error("daemon fora"));
    await store.iniciar();
    expect(store.obter().recuperado).toBe(true);
    expect(store.obter().erro).toContain("daemon fora");
  });
});

describe("store de terminais: consumo e eventos", () => {
  it("sem terminal montado o store confirma o consumo na hora (bytes UTF-8); com terminal, não", async () => {
    const { api, store, emitir, armazem } = montar([meta("a")]);
    await store.iniciar();
    emitir(ev("saida", "a", 1, { dados: "é" }));
    expect(api.confirmarConsumo).toHaveBeenCalledWith("a", 2);
    armazem.assinar("a", () => undefined);
    emitir(ev("saida", "a", 2, { dados: "xx" }));
    expect(api.confirmarConsumo).toHaveBeenCalledTimes(1); // quem confirma é o Terminal, depois do write
  });

  it("saída não notifica a UI (nenhum re-render por chunk)", async () => {
    const { store, emitir } = montar([meta("a")]);
    await store.iniciar();
    const ouvinte = vi.fn();
    store.assinar(ouvinte);
    for (let i = 1; i <= 100; i += 1) emitir(ev("saida", "a", i, { dados: "x" }));
    expect(ouvinte).not.toHaveBeenCalled();
  });

  it("atividade e estado atualizam a sessão; o contador só conta sessão executando e aguardando", async () => {
    const { store, emitir } = montar([meta("a"), meta("b")]);
    await store.iniciar();
    emitir(ev("atividade", "a", 1, { atividade: "aguardando" }));
    emitir(ev("atividade", "b", 1, { atividade: "aguardando" }));
    expect(store.obter().aguardando).toBe(2);
    emitir(ev("encerramento", "b", 2, { codigo: 0, sinal: null }));
    expect(store.obter().aguardando).toBe(1);
    expect(store.obter().sessoes.find((s) => s.sessao_id === "b")).toMatchObject({ estado: "encerrada", codigo_saida: 0 });
  });

  it("evento que chega antes do registro é aplicado quando a sessão é registrada", async () => {
    const { store, emitir, api } = montar();
    await store.iniciar();
    emitir(ev("atividade", "novo", 1, { atividade: "trabalhando" }));
    await store.abrir(ferramenta());
    expect(api.abrir).toHaveBeenCalledTimes(1);
    expect(store.obter().sessoes[0]).toMatchObject({ sessao_id: "novo", atividade: "trabalhando" });
  });
});

describe("store de terminais: abrir e fechar", () => {
  it("abrir devolve o id real, conta pendente durante a chamada e nunca reutiliza o número", async () => {
    const { api, store } = montar();
    await store.iniciar();
    let liberar: (v: unknown) => void = () => undefined;
    api.abrir.mockReturnValueOnce(new Promise((r) => { liberar = r; }));
    const p = store.abrir(ferramenta());
    expect(store.obter().pendentes).toBe(1);
    liberar({ versao: 1, sessao_id: "s1", estado: "iniciando" });
    expect(await p).toBe("s1");
    expect(store.obter().pendentes).toBe(0);
    store.fechar("s1");
    api.abrir.mockResolvedValueOnce({ versao: 1, sessao_id: "s2", estado: "iniciando" });
    await store.abrir(ferramenta());
    expect(store.obter().sessoes.map((s) => s.numero)).toEqual([2]);
  });

  it("erro ao abrir vira mensagem e não deixa pendente", async () => {
    const { api, store } = montar();
    api.abrir.mockRejectedValue(new Error("sem permissão"));
    expect(await store.abrir(ferramenta("Codex"))).toBeNull();
    expect(store.obter()).toMatchObject({ pendentes: 0 });
    expect(store.obter().erro).toContain("Codex");
    expect(store.obter().erro).toContain("sem permissão");
  });

  it("respeita o limite de 16 sessões por janela", async () => {
    const { api, store } = montar(Array.from({ length: 16 }, (_, i) => meta(`s${i}`)));
    await store.iniciar();
    expect(await store.abrir(ferramenta())).toBeNull();
    expect(api.abrir).not.toHaveBeenCalled();
    expect(store.obter().erro).toContain("16");
  });

  it("o limite vem da config (limite_paineis) e a mensagem diz o número e onde mudar", async () => {
    let limite = 2;
    const { api, store } = montar([meta("a"), meta("b")], () => limite);
    await store.iniciar();
    expect(await store.abrir(ferramenta())).toBeNull();
    expect(api.abrir).not.toHaveBeenCalled();
    expect(store.obter().erro).toContain("Limite de 2 sessões");
    expect(store.obter().erro).toContain("Configurações");
    limite = 3;
    expect(await store.abrir(ferramenta())).toBe("novo");
  });

  it("fechar descarta no main, limpa o armazém e ignora eventos atrasados da sessão", async () => {
    const { api, store, emitir, armazem } = montar([meta("a")]);
    await store.iniciar();
    emitir(ev("saida", "a", 1, { dados: "x" }));
    store.fechar("a");
    expect(api.descartar).toHaveBeenCalledWith("a");
    expect(armazem.chunks("a")).toEqual([]);
    emitir(ev("saida", "a", 2, { dados: "tarde" }));
    expect(armazem.chunks("a")).toEqual([]);
    expect(store.obter().sessoes).toEqual([]);
  });

  it("falhas do main ficam por sessão", async () => {
    const { store, falhar } = montar([meta("a")]);
    await store.iniciar();
    falhar({ sessao_id: "a", codigo: "x", mensagem: "o processo caiu" });
    expect(store.obter().falhas["a"]).toBe("o processo caiu");
  });

  it("carrega as ferramentas e guarda o erro quando a detecção falha", async () => {
    const { api, store } = montar();
    await store.carregarFerramentas();
    expect(store.obter().ferramentas).toHaveLength(1);
    expect(store.nomeDaFerramenta("claude")).toBe("Claude Code");
    api.listarFerramentas.mockRejectedValue(new Error("x"));
    await store.carregarFerramentas(true);
    expect(store.obter().erroFerramentas).toBe("x");
  });
});

describe("store de terminais: sessões externas e subagentes internos", () => {
  it("adota a sessão aberta pelo main (evento de sessão desconhecida dispara listarSessoes) marcando `externa`", async () => {
    vi.useFakeTimers();
    try {
      const { api, store, emitir } = montar([meta("a")]);
      (api as Record<string, unknown>)["listarSessoes"] = vi.fn().mockResolvedValue([meta("a"), meta("w1"), meta("morta", "encerrada")]);
      await store.iniciar();
      emitir(ev("estado", "w1", 1, { estado: "executando", erro_codigo: null, mensagem: null }));
      emitir(ev("estado", "w1", 2, { estado: "executando", erro_codigo: null, mensagem: null }));
      await vi.advanceTimersByTimeAsync(100);
      expect((api as unknown as { listarSessoes: ReturnType<typeof vi.fn> }).listarSessoes).toHaveBeenCalledTimes(1);
      const ids = store.obter().sessoes.map((s) => [s.sessao_id, s.externa === true]);
      expect(ids).toEqual([["a", false], ["w1", true]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("não sincroniza enquanto uma abertura do próprio renderer está pendente e sessão fechada não volta", async () => {
    const { api, store } = montar([]);
    (api as Record<string, unknown>)["listarSessoes"] = vi.fn().mockResolvedValue([meta("novo")]);
    await store.iniciar();
    const id = await store.abrir(ferramenta());
    store.fechar(id!);
    expect(await store.sincronizar()).toEqual([]);
  });

  it("`adotar` registra a sessão devolvida pelo main sem marcá-la externa", async () => {
    const { store } = montar([]);
    await store.iniciar();
    store.adotar({ sessao_id: "n1", ferramenta_id: "claude", estado: "executando" });
    expect(store.obter().sessoes.map((s) => [s.sessao_id, s.externa])).toEqual([["n1", undefined]]);
  });

  it("conta subagentes internos (total e ativos) sem criar sessão", async () => {
    const { store, emitir } = montar([meta("a")]);
    await store.iniciar();
    emitir(ev("subagente_iniciado", "a", 1, { subagente_id: "s1", rotulo: "x", descricao: null }));
    emitir(ev("subagente_iniciado", "a", 2, { subagente_id: "s2", rotulo: "y", descricao: null }));
    emitir(ev("subagente_iniciado", "a", 3, { subagente_id: "s2", rotulo: "y", descricao: null }));
    emitir(ev("subagente_concluido", "a", 4, { subagente_id: "s1" }));
    expect(store.obter().sessoes).toHaveLength(1);
    expect(store.obter().sessoes[0]!.subagentes).toEqual({ total: 2, ativos: 1 });
  });
});

describe("store de terminais: fechamento pedido pelo app (D-520)", () => {
  it("`fechada` tira a sessão da lista na hora, solta o armazém, NÃO chama o descartar do main (ele já descartou) e eventos tardios são ignorados", async () => {
    const { api, store, emitir, armazem } = montar([meta("a"), meta("w")]);
    await store.iniciar();
    emitir(ev("saida", "w", 1, { dados: "saída do worker" }));
    emitir(ev("fechada", "w", 2));
    expect(store.obter().sessoes.map((s) => s.sessao_id)).toEqual(["a"]);
    expect(armazem.chunks("w")).toEqual([]);
    expect(api.descartar).not.toHaveBeenCalled();
    // o fim do processo chega depois (SIGTERM → 143): nada reaparece
    emitir(ev("encerramento", "w", 3, { codigo: 143, sinal: null, solicitado: true }));
    emitir(ev("estado", "w", 4, { estado: "encerrada", erro_codigo: null, mensagem: null }));
    expect(store.obter().sessoes.map((s) => s.sessao_id)).toEqual(["a"]);
  });

  it("sessão fechada pelo app não volta pela sincronia de sessões externas", async () => {
    const { api, store, emitir } = montar([meta("a")]);
    (api as unknown as { listarSessoes: () => Promise<MetadadosSessao[]> }).listarSessoes = async () => [meta("a"), meta("w")];
    await store.iniciar();
    expect(await store.sincronizar()).toEqual(["w"]);
    emitir(ev("fechada", "w", 1));
    expect(await store.sincronizar()).toEqual([]);
    expect(store.obter().sessoes.map((s) => s.sessao_id)).toEqual(["a"]);
  });

  it("`encerramento` solicitado nunca guarda o código (143 do SIGTERM não é resultado da CLI); o não solicitado guarda", async () => {
    const { store, emitir } = montar([meta("a"), meta("b")]);
    await store.iniciar();
    emitir(ev("encerramento", "a", 1, { codigo: 143, sinal: null, solicitado: true }));
    emitir(ev("encerramento", "b", 1, { codigo: 2, sinal: null }));
    expect(store.obter().sessoes.find((s) => s.sessao_id === "a")?.codigo_saida).toBeNull();
    expect(store.obter().sessoes.find((s) => s.sessao_id === "b")?.codigo_saida).toBe(2);
  });
});

describe("D-570: workspace de origem das sessões (a tela nunca mistura workspaces)", () => {
  const doWs = (sessao_id: string, workspace_id: string | null): MetadadosSessao => ({ ...meta(sessao_id), workspace_id });

  it("a recuperação reanexa cada sessão ao workspace de origem (inclusive null = sem projeto)", async () => {
    const { store } = montar([doWs("a1", "A"), doWs("b1", "B"), doWs("n1", null)]);
    await store.iniciar();
    expect(store.obter().sessoes.map((s) => [s.sessao_id, s.workspace_id])).toEqual([["a1", "A"], ["b1", "B"], ["n1", null]]);
  });

  it("sessão aberta pela tela grava o workspace da tela; sem workspace grava null", async () => {
    const { store, api } = montar();
    await store.iniciar();
    api.abrir.mockResolvedValueOnce({ versao: 1, sessao_id: "novoA", estado: "iniciando" });
    await store.abrir(ferramenta(), { workspaceId: "A" });
    expect(api.abrir).toHaveBeenLastCalledWith(expect.objectContaining({ workspace_id: "A" }));
    api.abrir.mockResolvedValueOnce({ versao: 1, sessao_id: "novoN", estado: "iniciando" });
    await store.abrir(ferramenta());
    expect(api.abrir).toHaveBeenLastCalledWith(expect.objectContaining({ workspace_id: null }));
    expect(store.obter().sessoes.map((s) => [s.sessao_id, s.workspace_id])).toEqual([["novoA", "A"], ["novoN", null]]);
  });

  it("sessão aberta pelo main (worker) é adotada com o workspace dele, vinda de listarSessoes", async () => {
    const { store, api } = montar();
    (api as Record<string, unknown>)["listarSessoes"] = vi.fn().mockResolvedValue([doWs("w1", "B")]);
    await store.iniciar();
    const novas = await store.sincronizar();
    expect(novas).toEqual(["w1"]);
    expect(store.obter().sessoes[0]).toMatchObject({ sessao_id: "w1", workspace_id: "B", externa: true });
  });

  it("saída e estado de sessão de workspace oculto: a saída fica no armazém e confirma o consumo SEM notificar a interface", async () => {
    const { store, emitir, armazem, api } = montar([doWs("a1", "A"), doWs("b1", "B")]);
    await store.iniciar();
    const ouvinte = vi.fn();
    store.assinar(ouvinte);
    emitir(ev("saida", "b1", 1, { dados: "oculta" }));
    expect(armazem.chunks("b1")).toEqual(["oculta"]);
    expect(api.confirmarConsumo).toHaveBeenCalledWith("b1", 6);
    expect(ouvinte).not.toHaveBeenCalled(); // saída não re-renderiza ninguém
    emitir(ev("atividade", "b1", 2, { atividade: "aguardando" }));
    expect(store.obter().sessoes.find((s) => s.sessao_id === "b1")).toMatchObject({ workspace_id: "B", atividade: "aguardando" });
    expect(store.obter().aguardando).toBe(1); // o contador global segue contando (o seletor da tela recorta por workspace)
  });
});
