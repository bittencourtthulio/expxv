// T-22.12: revogação em dois níveis e pânico, com dependências falsas (cada camada provada sozinha; o `servico.test.ts` prova o conjunto com relay real).
import { describe, expect, it } from "vitest";
import { nomeSegredoCanal } from "./pareamento-relay";
import { criarRevogacao, type PortaClienteRevogavel } from "./revogacao";

function montar(ids: string[] = ["dev_a", "dev_b"]) {
  const chamadas: string[] = [];
  const cliente = (id: string): PortaClienteRevogavel => ({ desregistrar: () => void chamadas.push(`desregistrar:${id}`), fechar: () => void chamadas.push(`fechar:${id}`) });
  const clientes = new Map(ids.map((id) => [id, cliente(id)]));
  let efemero: PortaClienteRevogavel | null = cliente("efemero");
  const r = criarRevogacao({
    clientes,
    efemero: () => efemero,
    cancelarPareamento: () => void chamadas.push("cancelar_pareamento"),
    apagarSegredo: async (n) => void chamadas.push(`apagar:${n}`),
    marcarRevogado: (id) => void chamadas.push(`marcar:${id}`),
    evento: (t, id) => void chamadas.push(`evento:${t}:${id ?? "-"}`),
    revogarTodosNoHost: async () => void chamadas.push("host_revoga_todos"),
    dispositivosComCanal: () => ids,
    aoMudar: () => void chamadas.push("mudou"),
  });
  return { r, chamadas, clientes, esquecerEfemero: () => void (efemero = null) };
}

describe("revogação (nível 2: otimização) e pânico", () => {
  it("revogar UM dispositivo: desregistra só o canal dele, marca, apaga o segredo dele, registra o evento e não toca nos outros", () => {
    const { r, chamadas, clientes } = montar();
    r.aoRevogado("dev_a");
    expect(chamadas).toEqual(expect.arrayContaining(["desregistrar:dev_a", "marcar:dev_a", `apagar:${nomeSegredoCanal("dev_a")}`, "evento:revogado:dev_a", "mudou"]));
    expect(chamadas.some((c) => c.includes("dev_b") || c === "cancelar_pareamento" || c === "host_revoga_todos")).toBe(false);
    expect(clientes.has("dev_a")).toBe(false);
    expect(clientes.has("dev_b")).toBe(true);
  });
  it("revogar dispositivo SEM canal ativo (relay desligado) ainda marca, apaga o segredo e registra (A-08)", () => {
    const { r, chamadas } = montar([]);
    r.aoRevogado("dev_z");
    expect(chamadas).toEqual(expect.arrayContaining(["marcar:dev_z", `apagar:${nomeSegredoCanal("dev_z")}`, "evento:revogado:dev_z"]));
    expect(chamadas.some((c) => c.startsWith("desregistrar"))).toBe(false);
  });
  it("ax16_panico_zero_sockets: fecha TODOS os sockets (inclusive o efêmero) ANTES da parte autoritativa, cancela o pareamento, revoga no host, apaga os segredos e registra o evento", async () => {
    const { r, chamadas, clientes } = montar();
    await r.panico();
    const pos = (x: string): number => chamadas.indexOf(x);
    for (const x of ["desregistrar:dev_a", "desregistrar:dev_b", "desregistrar:efemero", "cancelar_pareamento", "host_revoga_todos", `apagar:${nomeSegredoCanal("dev_a")}`, `apagar:${nomeSegredoCanal("dev_b")}`, "marcar:dev_a", "marcar:dev_b", "evento:panico:-"]) expect(pos(x), x).toBeGreaterThanOrEqual(0);
    // sockets primeiro (orçamento «0 sockets ≤ 1 s»), depois a revogação no host e os segredos
    for (const s of ["desregistrar:dev_a", "desregistrar:dev_b", "desregistrar:efemero"]) expect(pos(s)).toBeLessThan(pos("host_revoga_todos"));
    expect(clientes.size).toBe(0);
    expect(pos("host_revoga_todos")).toBeLessThan(pos(`apagar:${nomeSegredoCanal("dev_a")}`));
  });
  it("pânico não depende de a revogação do host ter dado certo: se ela falhar, sockets fechados e segredos apagados do mesmo jeito", async () => {
    const chamadas: string[] = [];
    const r = criarRevogacao({
      clientes: new Map([["dev_a", { desregistrar: () => void chamadas.push("desreg"), fechar: () => undefined }]]),
      efemero: () => null,
      cancelarPareamento: () => undefined,
      apagarSegredo: async (n) => void chamadas.push(`apagar:${n}`),
      marcarRevogado: () => undefined,
      evento: (t) => void chamadas.push(`evento:${t}`),
      revogarTodosNoHost: async () => {
        throw new Error("host indisponível");
      },
      dispositivosComCanal: () => ["dev_a"],
      aoMudar: () => undefined,
    });
    await r.panico();
    expect(chamadas).toEqual(["desreg", `apagar:${nomeSegredoCanal("dev_a")}`, "evento:panico"]);
  });
  it("cliente que lança ao desregistrar ainda é fechado e nada escapa", async () => {
    const chamadas: string[] = [];
    const r = criarRevogacao({
      clientes: new Map([["dev_a", { desregistrar: () => { throw new Error("socket morto"); }, fechar: () => void chamadas.push("fechar") }]]),
      efemero: () => null,
      cancelarPareamento: () => undefined,
      apagarSegredo: async () => undefined,
      marcarRevogado: () => undefined,
      evento: () => undefined,
      revogarTodosNoHost: async () => undefined,
      dispositivosComCanal: () => [],
      aoMudar: () => undefined,
    });
    await expect(r.panico()).resolves.toBeUndefined();
    expect(chamadas).toEqual(["fechar"]);
  });
});
