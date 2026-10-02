import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { criarRedeOllama } from "./rede-ollama";

const servidores: Server[] = [];
afterEach(() => Promise.all(servidores.splice(0).map((s) => new Promise<void>((r) => s.close(() => r())))).then(() => undefined));

async function falso(): Promise<{ porta: number; pedidos: Array<{ metodo: string; url: string; corpo: string }> }> {
  const pedidos: Array<{ metodo: string; url: string; corpo: string }> = [];
  const s = createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      pedidos.push({ metodo: req.method ?? "", url: req.url ?? "", corpo });
      res.setHeader("content-type", "application/json");
      res.end(req.url?.startsWith("/api/tags") ? JSON.stringify({ models: [{ name: "nomic-embed-text:latest" }] }) : JSON.stringify({ embeddings: [[0.1, 0.2]] }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  servidores.push(s);
  return { porta: (s.address() as AddressInfo).port, pedidos };
}

describe("rede do Ollama (loopback dedicado)", () => {
  it("fala com o servidor local e devolve status e texto", async () => {
    const f = await falso();
    const rede = criarRedeOllama();
    const r = await rede({ url: `http://127.0.0.1:${f.porta}/api/tags`, metodo: "GET" });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.texto).models[0].name).toContain("nomic");
    const e = await rede({ url: `http://localhost:${f.porta}/api/embed`, metodo: "POST", corpo: JSON.stringify({ model: "x", input: ["a"] }) });
    expect(e.ok).toBe(true);
    expect(f.pedidos.at(-1)).toMatchObject({ metodo: "POST", url: "/api/embed" });
  });

  it("recusa host público, https, credencial, caminho fora de /api/ e método inesperado", async () => {
    const rede = criarRedeOllama();
    for (const url of ["http://example.com/api/tags", "https://127.0.0.1/api/tags", "http://u:p@127.0.0.1:11434/api/tags", "http://127.0.0.1:11434/admin", "http://192.168.0.5:11434/api/tags", "http://169.254.169.254/api/tags"]) {
      await expect(rede({ url, metodo: "GET" }), url).rejects.toThrow();
    }
    await expect(rede({ url: "http://127.0.0.1:11434/api/tags", metodo: "DELETE" as never })).rejects.toThrow();
  });
});
