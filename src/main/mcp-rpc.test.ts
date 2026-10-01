import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { ErroMcp, violacaoDeRegra } from "../nucleo/mcp/erros";
import { atenderChamadas, criarChamador } from "./mcp-rpc";

const canais: MessageChannel[] = [];
afterEach(() => { while (canais.length) { const c = canais.pop(); c?.port1.close(); c?.port2.close(); } });

function par() {
  const c = new MessageChannel();
  canais.push(c);
  return c;
}

describe("chamadas entre threads do MCP", () => {
  it("devolve o valor (inclusive undefined como null) e repassa os argumentos", async () => {
    const c = par();
    atenderChamadas(c.port1, { soma: (a: number, b: number) => a + b, nada: () => undefined, assincrono: async (x: string) => `oi ${x}` });
    const ch = criarChamador(c.port2);
    expect(await ch.chamar("soma", 2, 3)).toBe(5);
    expect(await ch.chamar("nada")).toBeNull();
    expect(await ch.chamar("assincrono", "mundo")).toBe("oi mundo");
  });

  it("ErroMcp atravessa com code e subcode; erro comum vira falha genérica sem detalhe", async () => {
    const c = par();
    atenderChamadas(c.port1, {
      regra: () => { throw violacaoDeRegra("limit_reached", "limite"); },
      interno: () => { throw new Error("segredo /Users/fulano/x"); },
      rejeita: async () => { throw new ErroMcp("not_found", "nada"); },
    });
    const ch = criarChamador(c.port2);
    const e1 = await ch.chamar("regra").catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(ErroMcp);
    expect(e1).toMatchObject({ code: "rule_violation", subcode: "limit_reached", message: "limite" });
    const e2 = await ch.chamar("interno").catch((e: unknown) => e);
    expect(e2).not.toBeInstanceOf(ErroMcp);
    expect((e2 as Error).message).toBe("falha interna");
    expect(await ch.chamar("rejeita").catch((e: unknown) => e)).toMatchObject({ code: "not_found" });
  });

  it("método desconhecido (inclusive de protótipo) é recusado; chamadas concorrentes não se misturam", async () => {
    const c = par();
    atenderChamadas(c.port1, { eco: async (x: number) => { await new Promise((r) => setTimeout(r, 20 - x * 5)); return x; } });
    const ch = criarChamador(c.port2);
    await expect(ch.chamar("nao_existe")).rejects.toThrow();
    await expect(ch.chamar("toString")).rejects.toThrow();
    expect(await Promise.all([ch.chamar("eco", 1), ch.chamar("eco", 2), ch.chamar("eco", 3)])).toEqual([1, 2, 3]);
  });

  it("argumento não clonável rejeita sem travar", async () => {
    const c = par();
    atenderChamadas(c.port1, { x: () => 1 });
    await expect(criarChamador(c.port2).chamar("x", () => 1)).rejects.toThrow();
  });
});
