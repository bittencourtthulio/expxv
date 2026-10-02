import { describe, expect, it, vi } from "vitest";
import type { PedidoDispararComando, ResultadoDisparo } from "../../compartilhado/dominio";
import { criarStoreGeracao } from "./contexto-geracao";

const WS = "ws_AAAAAAAAAAAA";
const NADA = { convencoes: false, design_system: false, produto: false, memoria: false, perfil_legado: false };
const ok = (comando: string): ResultadoDisparo => ({ ok: true, pane_id: "pane_1", comando, motivo: null });

function criar(resp: (p: PedidoDispararComando) => ResultadoDisparo = (p) => ok(`/expx:${p.gesto}`)) {
  const disparar = vi.fn(async (p: PedidoDispararComando) => resp(p));
  return { store: criarStoreGeracao({ disparar }), disparar };
}

describe("geração do contexto: um por vez, esperando o arquivo", () => {
  it("dispara só o primeiro e só avança quando o arquivo aparece no índice", async () => {
    const { store, disparar } = criar();
    await store.iniciar(WS, ["convencoes", "produto", "memoria"]);
    expect(disparar).toHaveBeenCalledTimes(1);
    expect(disparar.mock.calls[0]?.[0]).toMatchObject({ workspace_id: WS, trabalho_id: null, gesto: "gerar_convencoes", argumento: null, pane_id: null });
    expect(store.obter()).toMatchObject({ fase: "rodando", atual: "convencoes", aguardando: true });

    await store.indiceMudou(WS, NADA); // nada novo: segue esperando
    expect(disparar).toHaveBeenCalledTimes(1);
    await store.indiceMudou(WS, { ...NADA, memoria: true }); // outra camada: não conta
    expect(disparar).toHaveBeenCalledTimes(1);

    await store.indiceMudou(WS, { ...NADA, convencoes: true });
    expect(disparar).toHaveBeenCalledTimes(2);
    expect(disparar.mock.calls[1]?.[0].gesto).toBe("gerar_produto");
    expect(store.obter().feitos).toEqual(["convencoes"]);

    await store.indiceMudou(WS, { ...NADA, convencoes: true, produto: true });
    await store.indiceMudou(WS, { ...NADA, convencoes: true, produto: true, memoria: true });
    expect(disparar.mock.calls.map((c) => c[0].gesto)).toEqual(["gerar_convencoes", "gerar_produto", "gerar_memoria"]);
    expect(store.obter()).toMatchObject({ fase: "concluida", atual: null, feitos: ["convencoes", "produto", "memoria"] });
  });

  it("'Gerar agora' é a mesma coisa com um item só", async () => {
    const { store, disparar } = criar();
    await store.iniciar(WS, ["design_system"]);
    await store.indiceMudou(WS, { ...NADA, design_system: true });
    expect(disparar).toHaveBeenCalledTimes(1);
    expect(store.obter().fase).toBe("concluida");
  });

  it("cancelar para a sequência: nada mais é disparado, nem se o arquivo aparecer depois", async () => {
    const { store, disparar } = criar();
    await store.iniciar(WS, ["convencoes", "produto"]);
    store.cancelar();
    expect(store.obter().fase).toBe("cancelada");
    await store.indiceMudou(WS, { ...NADA, convencoes: true });
    expect(disparar).toHaveBeenCalledTimes(1);
  });

  it("cancelar enquanto o main ainda abre o Pane descarta a resposta atrasada", async () => {
    let liberar: (r: ResultadoDisparo) => void = () => undefined;
    const disparar = vi.fn(() => new Promise<ResultadoDisparo>((res) => { liberar = res; }));
    const store = criarStoreGeracao({ disparar });
    const p = store.iniciar(WS, ["convencoes", "produto"]);
    store.cancelar();
    liberar(ok("/expx:stackx-detectar"));
    await p;
    expect(store.obter()).toMatchObject({ fase: "cancelada", aguardando: false });
  });

  it("pular segue para o próximo e registra o pulado; pular o último conclui", async () => {
    const { store, disparar } = criar();
    await store.iniciar(WS, ["convencoes", "produto"]);
    await store.pular();
    expect(store.obter().pulados).toEqual(["convencoes"]);
    expect(disparar.mock.calls[1]?.[0].gesto).toBe("gerar_produto");
    await store.pular();
    expect(store.obter()).toMatchObject({ fase: "concluida", pulados: ["convencoes", "produto"] });
  });

  it("recusa do main (módulo desligado, sem CLI, Pane ocupado) para a sequência com o motivo", async () => {
    const { store, disparar } = criar((p) => (p.gesto === "gerar_produto" ? { ok: false, pane_id: null, comando: null, motivo: "O módulo prodx está desligado." } : ok("/x")));
    await store.iniciar(WS, ["convencoes", "produto", "memoria"]);
    await store.indiceMudou(WS, { ...NADA, convencoes: true });
    expect(store.obter()).toMatchObject({ fase: "falhou", erro: "O módulo prodx está desligado.", atual: "produto" });
    await store.indiceMudou(WS, { ...NADA, convencoes: true, produto: true });
    expect(disparar).toHaveBeenCalledTimes(2);
  });

  it("exceção do canal vira falha legível; execução só começa se não há outra rodando; fechar volta a ociosa", async () => {
    const disparar = vi.fn(async () => { throw new Error("canal fora"); });
    const store = criarStoreGeracao({ disparar });
    await store.iniciar(WS, ["memoria"]);
    expect(store.obter()).toMatchObject({ fase: "falhou", erro: "canal fora" });
    store.fechar();
    expect(store.obter().fase).toBe("ociosa");

    const { store: s2, disparar: d2 } = criar();
    await s2.iniciar(WS, ["convencoes"]);
    await s2.iniciar(WS, ["produto"]);
    expect(d2).toHaveBeenCalledTimes(1);
    s2.fechar(); // rodando: não fecha
    expect(s2.obter().fase).toBe("rodando");
  });

  it("ignora índice de outro workspace e lista vazia", async () => {
    const { store, disparar } = criar();
    await store.iniciar(WS, []);
    expect(disparar).not.toHaveBeenCalled();
    await store.iniciar(WS, ["convencoes", "produto"]);
    await store.indiceMudou("ws_BBBBBBBBBBBB", { ...NADA, convencoes: true });
    expect(disparar).toHaveBeenCalledTimes(1);
  });
});

describe("D-610: ir ao Pane ao gerar contexto", () => {
  it("só o primeiro item da sequência leva ao terminal; os seguintes só atualizam a faixa", async () => {
    const { criarStoreGeracao } = await import("./contexto-geracao");
    const chamadas: boolean[] = [];
    const g = criarStoreGeracao({
      disparar: async () => ({ ok: true, pane_id: "p", comando: "/expx:x", motivo: null, estado: "entregue" }),
      aoEnviar: (_r, info) => { chamadas.push(info.primeiro); },
    });
    await g.iniciar("w1", ["convencoes", "produto"]);
    await g.indiceMudou("w1", { convencoes: true, produto: false, design_system: false, memoria: false, perfil_legado: false });
    expect(chamadas).toEqual([true, false]);
  });
});
