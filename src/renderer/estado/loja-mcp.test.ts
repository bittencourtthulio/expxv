import { describe, expect, it, vi } from "vitest";
import type { EventoLojaMcp } from "../../compartilhado/loja-mcp";
import { cartao, CARTOES_PADRAO, DIAGNOSTICO_OK, lojaMcpFalsa } from "../telas/loja-mcp/fabrica-teste";
import { criarStoreLojaMcp } from "./loja-mcp";

function montar(extra: Parameters<typeof lojaMcpFalsa>[0] = {}, ws: string | null = "w1") {
  let emitir: (e: EventoLojaMcp) => void = () => undefined;
  const api = lojaMcpFalsa(extra);
  api.listar = vi.fn(api.listar);
  api.habilitacoes = vi.fn(api.habilitacoes);
  api.diagnostico = vi.fn(api.diagnostico);
  api.assinar = vi.fn((cb) => { emitir = cb; return () => undefined; });
  const store = criarStoreLojaMcp({ api: () => api, workspace: () => ws, atrasoMs: 5 });
  return { api, store, emitir: (e: EventoLojaMcp) => emitir(e) };
}
const esperar = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe("store da Loja de MCPs", () => {
  it("nada acontece antes de iniciar; iniciar carrega uma vez, assina uma vez e traz o diagnóstico", async () => {
    const { api, store } = montar();
    expect(api.listar).not.toHaveBeenCalled();
    await store.iniciar();
    await store.iniciar();
    expect(api.listar).toHaveBeenCalledTimes(1);
    expect(api.assinar).toHaveBeenCalledTimes(1);
    await esperar();
    expect(store.obter().lista?.entradas).toHaveLength(CARTOES_PADRAO.length);
    expect(store.obter().diagnostico).toEqual(DIAGNOSTICO_OK);
    expect(store.obter().indice).not.toBeNull();
  });

  it("sem a API: indisponível, sem lançar", async () => {
    const store = criarStoreLojaMcp({ api: () => undefined });
    await store.iniciar();
    expect(store.obter().disponivel).toBe(false);
  });

  it("erro de carga vira mensagem saneada e permite tentar de novo", async () => {
    const { api, store } = montar();
    api.listar = vi.fn().mockRejectedValueOnce(new Error("falha em /Users/x/segredo")).mockImplementation(lojaMcpFalsa().listar);
    await store.iniciar();
    expect(store.obter().erro).toBe("Não foi possível concluir a operação.");
    await store.carregar();
    expect(store.obter().erro).toBeNull();
    expect(store.obter().lista).not.toBeNull();
  });

  it("filtros mudam sem nenhuma chamada IPC (busca local)", async () => {
    const { api, store } = montar();
    await store.iniciar();
    const antes = (api.listar as ReturnType<typeof vi.fn>).mock.calls.length;
    for (const t of ["p", "pl", "pla", "play"]) store.definirFiltros({ busca: t });
    store.definirFiltros({ gratuito: true });
    expect(store.obter().filtros.busca).toBe("play");
    expect((api.listar as ReturnType<typeof vi.fn>).mock.calls.length).toBe(antes);
    store.limparFiltros();
    expect(store.obter().filtros.busca).toBe("");
  });

  it("habilitados vêm de `habilitacoes` do workspace atual (deny-by-default)", async () => {
    const hab = { id: "h1", servidor_id: "context7", alvo_tipo: "workspace" as const, alvo_valor: "w1", habilitado: true, atualizado_em: "x", isolamento: { claude: "duro", codex: "parcial", opencode: "parcial", gemini: "nenhum" } as const };
    const { store } = montar({ habilitacoes: [hab, { ...hab, id: "h2", servidor_id: "deepwiki", habilitado: false }, { ...hab, id: "h3", servidor_id: "sentry", alvo_valor: "w2" }, { ...hab, id: "h4", servidor_id: "pago", alvo_tipo: "missao" }] });
    await store.iniciar();
    expect([...store.obter().habilitados]).toEqual(["context7"]);
  });

  it("sem workspace não consulta habilitações", async () => {
    const { api, store } = montar({}, null);
    await store.iniciar();
    expect(api.habilitacoes).not.toHaveBeenCalled();
  });

  it("evento de progresso NÃO notifica o estado global: só o assinante do id", async () => {
    const { store, emitir } = montar();
    await store.iniciar();
    const global = vi.fn();
    const doId = vi.fn();
    const outro = vi.fn();
    store.assinar(global);
    store.assinarId("context7", doId);
    store.assinarId("deepwiki", outro);
    emitir({ tipo: "progresso", instalacao_id: "inst_abc123", id: "context7", passo: 2, rotulo: "Baixando" });
    expect(global).not.toHaveBeenCalled();
    expect(doId).toHaveBeenCalledTimes(1);
    expect(outro).not.toHaveBeenCalled();
    expect(store.andamentoDe("context7")).toEqual({ instalacao_id: "inst_abc123", passo: 2, rotulo: "Baixando" });
    // evento idêntico não re-notifica e mantém o snapshot estável
    const snap = store.andamentoDe("context7");
    emitir({ tipo: "progresso", instalacao_id: "inst_abc123", id: "context7", passo: 2, rotulo: "Baixando" });
    expect(doId).toHaveBeenCalledTimes(1);
    expect(store.andamentoDe("context7")).toBe(snap);
  });

  it("evento de estado final limpa o andamento e recarrega a lista coalescido", async () => {
    const { api, store, emitir } = montar();
    await store.iniciar();
    store.marcarInicio(["context7"], "inst_abc123");
    expect(store.andamentoDe("context7")?.rotulo).toBe("Preparando");
    const chamadas = (api.listar as ReturnType<typeof vi.fn>).mock.calls.length;
    emitir({ tipo: "estado", id: "context7", estado: "instalado", erro_codigo: null });
    emitir({ tipo: "estado", id: "deepwiki", estado: "instalado", erro_codigo: null });
    emitir({ tipo: "saude", id: "context7", estado: "ok", n_ferramentas: 2, latencia_ms: 10 });
    expect(store.andamentoDe("context7")).toBeNull();
    await esperar();
    expect((api.listar as ReturnType<typeof vi.fn>).mock.calls.length).toBe(chamadas + 1);
  });

  it("estado 'instalando' não limpa o andamento", async () => {
    const { store, emitir } = montar();
    await store.iniciar();
    store.marcarInicio(["context7"], "inst_abc123");
    emitir({ tipo: "estado", id: "context7", estado: "instalando", erro_codigo: null });
    expect(store.andamentoDe("context7")).not.toBeNull();
  });

  it("a seleção some quando o item deixa de existir na lista recarregada", async () => {
    const { api, store } = montar();
    await store.iniciar();
    store.selecionar("duvida");
    api.listar = vi.fn().mockResolvedValue({ entradas: [cartao("outro")], seed_versao: "1", gerado_em: "x", somente_leitura: false, aviso: null });
    await store.carregar();
    expect(store.obter().selecionado).toBeNull();
  });
});
