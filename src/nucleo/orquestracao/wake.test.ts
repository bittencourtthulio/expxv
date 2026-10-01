import { describe, expect, it } from "vitest";
import type { EstadoPane } from "../dominio";
import { criarFilaWake, textoDoWake, type ItemWake } from "./wake";

const item = (n: number, p: Partial<ItemWake> = {}): ItemWake => ({
  destino_pane_id: "pane_p", origem_pane_id: "w1", task_id: `T-0${n}`, handoff_id: `h${n}`, status: "ok", resumo: `resumo ${n}`, relatorio_path: `r${n}.md`, ...p,
});

function montar(estadoInicial: EstadoPane | null = "pronto") {
  const enviados: Array<{ pane_id: string; texto: string }> = [];
  const eventos: Array<{ tipo: string; payload: unknown }> = [];
  let aceita = true;
  const fila = criarFilaWake({
    enviar: async (pane_id, texto) => { if (aceita) enviados.push({ pane_id, texto }); return aceita; },
    estado: () => estadoInicial,
    emitir: (tipo, payload) => eventos.push({ tipo, payload }),
  });
  return { fila, enviados, eventos, recusar: () => { aceita = false; }, aceitar: () => { aceita = true; } };
}

describe("fila de wake", () => {
  it("piloto ocioso: entrega logo, sem esperar 'silêncio'; enfileirar é síncrono", async () => {
    const { fila, enviados, eventos } = montar("pronto");
    fila.enfileirar(item(1));
    expect(enviados).toHaveLength(0); // síncrono: não bloqueou esperando a entrega
    await fila.ociosa();
    expect(enviados).toHaveLength(1);
    expect(enviados[0]?.texto).toContain("T-01");
    expect(eventos.map((e) => e.tipo)).toEqual(["wake.queued", "wake.delivered"]);
    expect(fila.pendentes()).toEqual([]);
  });

  it("piloto trabalhando: segura até o próximo ponto seguro (pronto)", async () => {
    const { fila, enviados } = montar(null);
    fila.aoMudarEstado("pane_p", "trabalhando");
    fila.enfileirar(item(1));
    await fila.ociosa();
    expect(enviados).toHaveLength(0);
    expect(fila.pendentes("pane_p")).toHaveLength(1);
    fila.aoMudarEstado("pane_p", "pronto");
    await fila.ociosa();
    expect(enviados).toHaveLength(1);
  });

  it("aguardando (pedido de aprovação) não é ponto seguro", async () => {
    const { fila, enviados } = montar(null);
    fila.aoMudarEstado("pane_p", "aguardando");
    fila.enfileirar(item(1));
    await fila.ociosa();
    await fila.sondar();
    expect(enviados).toHaveLength(0);
  });

  it("preserva a ordem de chegada, inclusive entre entregas", async () => {
    const { fila, enviados } = montar(null);
    fila.aoMudarEstado("pane_p", "trabalhando");
    fila.enfileirar(item(1));
    fila.enfileirar(item(2));
    fila.enfileirar(item(3));
    fila.aoMudarEstado("pane_p", "pronto");
    await fila.ociosa();
    const texto = enviados[0]?.texto ?? "";
    expect(texto.indexOf("T-01")).toBeLessThan(texto.indexOf("T-02"));
    expect(texto.indexOf("T-02")).toBeLessThan(texto.indexOf("T-03"));
    // depois da entrega o Pane está ocupado: o próximo item espera o próximo ocioso
    fila.enfileirar(item(4));
    await fila.ociosa();
    expect(enviados).toHaveLength(1);
    fila.aoMudarEstado("pane_p", "pronto");
    await fila.ociosa();
    expect(enviados).toHaveLength(2);
    expect(enviados[1]?.texto).toContain("T-04");
  });

  it("envio recusado mantém o item na fila para a próxima tentativa", async () => {
    const { fila, enviados, recusar, aceitar } = montar("pronto");
    recusar();
    fila.enfileirar(item(1));
    await fila.ociosa();
    expect(fila.pendentes()).toHaveLength(1);
    aceitar();
    await fila.sondar();
    expect(enviados).toHaveLength(1);
    expect(fila.pendentes()).toHaveLength(0);
  });

  it("2 cards no mesmo Pane viram 2 avisos distintos, sem somar nem fundir", async () => {
    const { fila } = montar(null);
    fila.aoMudarEstado("pane_p", "trabalhando");
    fila.enfileirar(item(1, { origem_pane_id: "w1" }));
    fila.enfileirar(item(2, { origem_pane_id: "w1" }));
    const pend = fila.pendentes("pane_p");
    expect(pend.map((p) => p.task_id)).toEqual(["T-01", "T-02"]);
    expect(new Set(pend.map((p) => p.handoff_id)).size).toBe(2);
    expect(textoDoWake(pend).split(" | ")).toHaveLength(2);
  });

  it("filas de destinos diferentes são independentes; Pane encerrado descarta a fila", async () => {
    const { fila, enviados } = montar(null);
    fila.aoMudarEstado("a", "pronto");
    fila.aoMudarEstado("b", "trabalhando");
    fila.enfileirar(item(1, { destino_pane_id: "a" }));
    fila.enfileirar(item(2, { destino_pane_id: "b" }));
    await fila.ociosa();
    expect(enviados.map((e) => e.pane_id)).toEqual(["a"]);
    fila.aoMudarEstado("b", "encerrado");
    expect(fila.pendentes("b")).toEqual([]);
  });
});

describe("fila de wake: persistência (AUD-05)", () => {
  it("o mesmo handoff enfileirado duas vezes (ainda na fila) é entregue UMA vez", async () => {
    const { fila, enviados } = montar("pronto");
    fila.enfileirar(item(1));
    fila.enfileirar(item(1));
    await fila.ociosa();
    expect(enviados).toHaveLength(1);
  });

  it("avisa o que foi entregue (para apagar o registro persistido) só depois do envio aceito", async () => {
    const entregues: string[] = [];
    let aceita = false;
    const fila = criarFilaWake({
      enviar: async () => aceita,
      estado: () => "pronto",
      aoEntregar: (itens) => void entregues.push(...itens.map((i) => i.handoff_id)),
    });
    fila.enfileirar(item(1));
    await fila.ociosa();
    expect(entregues).toEqual([]);
    aceita = true;
    await fila.sondar();
    expect(entregues).toEqual(["h1"]);
  });
});

