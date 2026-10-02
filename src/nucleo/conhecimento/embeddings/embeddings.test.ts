import { describe, expect, it } from "vitest";
import { abrirBancoConhecimento } from "../banco";
import { criarRepos } from "../repos";
import { criarProvedorHash, embutirHash } from "./hash";
import { criarProvedorOllama, OllamaForaDoLoopbackErro, validarUrlLoopback, type TransporteHttp } from "./ollama";
import { criarProvedorOnnx } from "./onnx";
import { normalizarL2, type ProvedorEmbedding } from "./provedor";
import { reembutirFatia } from "./reembutir";
import { RegistroEmbeddings } from "./registro";

const cos = (a: Float32Array, b: Float32Array): number => a.reduce((s, x, i) => s + x * (b[i] as number), 0);

describe("hash-256-v1", () => {
  it("determinístico bit a bit, L2-normalizado, 256 d", async () => {
    const p = criarProvedorHash();
    const [a] = await p.embutir(["exportar relatório em CSV"]);
    const [b] = await p.embutir(["exportar relatório em CSV"]);
    expect(Buffer.from((a as Float32Array).buffer).equals(Buffer.from((b as Float32Array).buffer))).toBe(true);
    expect(a?.length).toBe(256);
    expect(Math.abs(cos(a as Float32Array, a as Float32Array) - 1)).toBeLessThan(1e-5);
    expect(p.id).toBe("hash-256-v1");
    expect(p.qualidade).toBe(0.5);
  });
  it("pares lexicalmente próximos têm cosseno maior que os não relacionados (30 pares)", () => {
    const topicos = ["exportar relatório csv pedidos", "autenticação login senha usuário", "migração banco dados tabela coluna", "interface botão cor tema escuro", "cache redis expiração chave ttl", "teste unitário mock stub asserção", "deploy servidor docker imagem container", "logs erro stack exceção trace", "pagamento cartão boleto cobrança fatura", "email envio fila template assunto"];
    let ok = 0;
    let n = 0;
    topicos.forEach((t, i) => {
      const v = embutirHash(t);
      const parafrase = embutirHash(`${t.split(" ").slice(0, 3).join(" ")} novo`);
      for (const j of [(i + 3) % 10, (i + 5) % 10, (i + 7) % 10]) {
        n++;
        if (cos(v, parafrase) > cos(v, embutirHash(topicos[j] as string))) ok++;
      }
    });
    expect(ok).toBe(n);
  });
  it("P-74: ≤ 1 ms por chunk de 1 200 caracteres", () => {
    const t = "implementação da rotina exportarCsv para pedidos ".repeat(25).slice(0, 1200);
    embutirHash(t);
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) embutirHash(t);
    expect((performance.now() - t0) / 200).toBeLessThan(1 * Number(process.env.EXPXV_PERF_FATOR ?? 1) + 1);
  });
});

describe("Ollama no loopback", () => {
  const ok: TransporteHttp = async (p) => ({ ok: true, status: 200, json: async () => (p.url.endsWith("/api/tags") ? { models: [{ name: "nomic-embed-text:latest" }] } : { embeddings: (JSON.parse(p.corpo ?? "{}") as { input: string[] }).input.map(() => [3, 4, 0]) }) });
  it("recusa host que não seja loopback (nada sai da máquina)", () => {
    for (const u of ["https://api.exemplo.com", "http://192.168.0.5:11434", "http://u:p@127.0.0.1", "ftp://127.0.0.1", "lixo"]) expect(() => validarUrlLoopback(u)).toThrow(OllamaForaDoLoopbackErro);
    expect(validarUrlLoopback("http://127.0.0.1:11434").hostname).toBe("127.0.0.1");
    expect(() => criarProvedorOllama({ url: "https://evil.com", modelo: "m", dimensao: 3, transporte: ok })).toThrow(OllamaForaDoLoopbackErro);
  });
  it("detecta o modelo, embute em lotes e normaliza", async () => {
    const p = criarProvedorOllama({ modelo: "nomic-embed-text", dimensao: 3, transporte: ok });
    expect(await p.disponivel()).toBe(true);
    const v = await p.embutir(["a", "b"]);
    expect(v[0]?.[0]).toBeCloseTo(0.6, 5);
    expect(p.id).toBe("ollama:nomic-embed-text:3");
    expect(await criarProvedorOllama({ modelo: "outro", dimensao: 3, transporte: ok }).disponivel()).toBe(false);
  });
  it("dimensão errada ou servidor fora: erro/indisponível, sem lançar em disponivel()", async () => {
    const ruim: TransporteHttp = async () => ({ ok: true, status: 200, json: async () => ({ embeddings: [[1, 2]] }) });
    await expect(criarProvedorOllama({ modelo: "m", dimensao: 3, transporte: ruim }).embutir(["x"])).rejects.toThrow(/dimensão/);
    const fora: TransporteHttp = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await criarProvedorOllama({ modelo: "m", dimensao: 3, transporte: fora }).disponivel()).toBe(false);
  });
});

describe("ONNX com runtime falso e registro", () => {
  const runtime = { pronto: async () => true, embutir: async (t: string[]) => t.map((x) => [x.length, 1, 0, 0]) };
  it("adaptador normaliza e confere dimensão", async () => {
    const p = criarProvedorOnnx({ nome: "e5-small", dimensao: 4, runtime });
    expect(p.id).toBe("onnx:e5-small:4");
    const [v] = await p.embutir(["abc"]);
    expect(Math.abs(cos(v as Float32Array, v as Float32Array) - 1)).toBeLessThan(1e-5);
    await expect(criarProvedorOnnx({ nome: "x", dimensao: 3, runtime }).embutir(["a"])).rejects.toThrow(/dimensão/);
    expect(await criarProvedorOnnx({ nome: "x", dimensao: 4, runtime: { ...runtime, pronto: async () => false } }).disponivel()).toBe(false);
  });
  it("registro: modelo ativo fora do ar cai no piso com degradado; hash nunca degrada", async () => {
    const reg = new RegistroEmbeddings();
    reg.registrar(criarProvedorOnnx({ nome: "e5-small", dimensao: 4, runtime: { ...runtime, pronto: async () => false } }));
    expect((await reg.escolher("onnx:e5-small:4")).degradado).toBe(true);
    expect((await reg.escolher("onnx:e5-small:4")).provedor.id).toBe("hash-256-v1");
    expect((await reg.escolher("hash-256-v1")).degradado).toBe(false);
    expect((await reg.escolher("inexistente")).provedor.id).toBe("hash-256-v1");
    reg.remover("hash-256-v1");
    expect(reg.ids()).toContain("hash-256-v1");
  });
  it("normalizarL2 de zero é zero", () => expect([...normalizarL2([0, 0])]).toEqual([0, 0]));
});

describe("reembutir em segundo plano (AC-15.14)", () => {
  const novoModelo: ProvedorEmbedding = { id: "fake:m:8", dimensao: 8, qualidade: 1, local: true, disponivel: async () => true, embutir: async (ts) => ts.map((t) => normalizarL2(Array.from({ length: 8 }, (_, i) => (t.charCodeAt(i % t.length) % 7) + 1))) };
  it("fatias; modelo_ativo só muda a 100% e a consulta segue no anterior até lá", async () => {
    const { banco } = abrirBancoConhecimento(":memory:");
    const r = criarRepos(banco, () => "2026-09-01T10:00:00.000Z");
    const col = r.colecao.garantir({ escopo: "workspace", workspace_id: "w", nome: "n", modelo: "hash-256-v1", dimensao: 256 });
    const T = "2026-09-01T10:00:00.000Z";
    for (let i = 0; i < 10; i++) r.documento.gravar({ id: `d${i}`, colecao_id: col.id, tipo: "doc", origem: `a${i}.md`, titulo: "t", hash_conteudo: `h${i}`, fonte: "sistema", mission_id: null, task_ref: null, pane_id: null, cli: null, modelo_autor: null, autor: null, importancia: 3, expira_em: null, ocorrido_em: T }, [{ id: `c${i}`, ordem: 0, texto: `texto numero ${i}`, titulos: "", termos: "", hash: `x${i}` }]);
    const f1 = await reembutirFatia({ repos: r, colecao_id: col.id, provedor: novoModelo, lote: 4, orcamentoMs: 0 });
    expect(f1.feitos).toBe(4);
    expect(f1.cobertura).toBeCloseTo(0.4);
    expect((await reembutirFatia({ repos: r, colecao_id: col.id, provedor: novoModelo, lote: 1, orcamentoMs: 0, medir: false })).cobertura).toBeNull();
    expect(f1.trocou).toBe(false);
    expect(r.colecao.obter(col.id)?.modelo_ativo).toBe("hash-256-v1");
    const f2 = await reembutirFatia({ repos: r, colecao_id: col.id, provedor: novoModelo, lote: 4, orcamentoMs: 0 });
    expect(f2.cobertura).toBeCloseTo(0.9, 1);
    const f3 = await reembutirFatia({ repos: r, colecao_id: col.id, provedor: novoModelo, lote: 4, orcamentoMs: 0 });
    expect(f3).toMatchObject({ cobertura: 1, trocou: true, restantes: 0 });
    expect(r.colecao.obter(col.id)).toMatchObject({ modelo_ativo: "fake:m:8", dimensao: 8 });
    banco.fechar();
  });
});
