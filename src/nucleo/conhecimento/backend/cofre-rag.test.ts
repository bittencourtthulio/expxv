import { describe, expect, it } from "vitest";
import type { EntradaCofre, EstadoCofre, PedidoGravarCofre } from "../../../compartilhado/harness";
import { CofreErro } from "../../cofre";
import { campoDoSegredo, criarCofreRag, CofreRagIndisponivelErro, lerSegredosRag, nomeSecretoValido, type CofreParaRag } from "./cofre-rag";
import { guardarSegredos, nomeSegredo } from "./config";

function cofreFalso(estado: Partial<EstadoCofre> = {}): CofreParaRag & { valores: Map<string, string>; guardadas: PedidoGravarCofre[] } {
  const valores = new Map<string, string>();
  const entradas: EntradaCofre[] = [];
  const guardadas: PedidoGravarCofre[] = [];
  return {
    valores,
    guardadas,
    estado: async () => ({ ok: true, backend: "safe_storage", bloqueado: false, ...estado }),
    guardar: async (p) => {
      guardadas.push(p);
      valores.set(p.nome, p.valor);
      let e = entradas.find((x) => x.nome === p.nome);
      if (!e) {
        e = { id: `cof_${entradas.length}abcdefghij`, nome: p.nome, escopo: p.escopo, workspace_id: p.workspace_id, sensivel: p.sensivel, criado_em: "t", ultimo_uso_em: null } as unknown as EntradaCofre;
        entradas.push(e);
      }
      return e;
    },
    existe: async (n) => valores.has(n),
    obter: async (n) => {
      const v = valores.get(n);
      if (v === undefined) throw new CofreErro("entrada_inexistente", n);
      return v;
    },
    listar: async () => entradas.filter((e) => valores.has(e.nome)),
    apagar: async (id) => {
      const e = entradas.find((x) => x.id === id);
      if (!e) return false;
      valores.delete(e.nome);
      return true;
    },
  };
}

describe("cofre do RAG online (PortaCofreRag sobre o cofre do SO)", () => {
  it("guarda como entrada global sensível com nome RAG_<PROVEDOR>_<CAMPO>; obter/existe/apagar", async () => {
    const c = cofreFalso();
    const porta = criarCofreRag(c);
    const r = await guardarSegredos(porta, "qdrant", { api_key: "abcdefghijklmnop1234" });
    expect(r).toEqual({ ids: ["RAG_QDRANT_API_KEY"], mascarado: { api_key: "••••1234" } });
    expect(c.guardadas[0]).toMatchObject({ id: null, nome: "RAG_QDRANT_API_KEY", escopo: "global", workspace_id: null, sensivel: true });
    expect(await porta.existe("RAG_QDRANT_API_KEY")).toBe(true);
    expect(await porta.obter("RAG_QDRANT_API_KEY")).toBe("abcdefghijklmnop1234");
    expect(await porta.obter("RAG_QDRANT_OUTRO")).toBeNull();
    await porta.apagar("RAG_QDRANT_API_KEY");
    expect(await porta.existe("RAG_QDRANT_API_KEY")).toBe(false);
    await porta.apagar("RAG_QDRANT_API_KEY"); // idempotente
  });
  it("só enxerga nomes RAG_*: não lê nem apaga outras chaves do cofre", async () => {
    const c = cofreFalso();
    c.valores.set("OPENROUTER_KEY_X", "segredo-de-outro-modulo");
    const porta = criarCofreRag(c);
    for (const f of [() => porta.obter("OPENROUTER_KEY_X"), () => porta.existe("OPENROUTER_KEY_X"), () => porta.apagar("OPENROUTER_KEY_X"), () => porta.guardar("minusculo", "valor-qualquer"), () => porta.guardar("RAG_", "x")]) {
      await expect(f()).rejects.toBeInstanceOf(CofreRagIndisponivelErro);
    }
    expect(c.valores.get("OPENROUTER_KEY_X")).toBe("segredo-de-outro-modulo");
    expect(nomeSecretoValido(nomeSegredo("pinecone", "api key"))).toBe(true);
  });
  it("RECUSA guardar no Linux com backend basic_text (erro claro, nada gravado)", async () => {
    const c = cofreFalso();
    const porta = criarCofreRag(c, { plataforma: "linux", backendSafeStorage: () => "basic_text" });
    await expect(porta.guardar("RAG_QDRANT_API_KEY", "valor-secreto-123")).rejects.toThrow(/basic_text/);
    expect(c.guardadas).toHaveLength(0);
    // libsecret é aceito; macOS ignora o backend
    await criarCofreRag(c, { plataforma: "linux", backendSafeStorage: () => "gnome_libsecret" }).guardar("RAG_QDRANT_API_KEY", "valor-secreto-123");
    await criarCofreRag(c, { plataforma: "darwin", backendSafeStorage: () => "basic_text" }).guardar("RAG_QDRANT_API_KEY", "valor-secreto-123");
    expect(c.guardadas).toHaveLength(2);
  });
  it("cofre indisponível ou bloqueado recusa guardar, sem vazar o valor", async () => {
    const indisp = cofreFalso({ ok: false, backend: "indisponivel", motivo: "O sistema não tem chaveiro seguro (backend basic_text)." });
    await expect(criarCofreRag(indisp).guardar("RAG_QDRANT_API_KEY", "valor-secreto-123")).rejects.toThrow(/basic_text/);
    const trancado = cofreFalso({ bloqueado: true, backend: "senha_mestra" });
    const e = await criarCofreRag(trancado).guardar("RAG_QDRANT_API_KEY", "valor-secreto-123").catch((x: Error) => x);
    expect((e as Error).message).toMatch(/bloqueado/);
    expect((e as Error).message).not.toContain("valor-secreto-123");
    expect(trancado.guardadas).toHaveLength(0);
  });
  it("abre o cofre sob demanda (função assíncrona) e lê os segredos da config só no main", async () => {
    const c = cofreFalso();
    let aberturas = 0;
    const porta = criarCofreRag(async () => (aberturas++, c));
    expect(aberturas).toBe(0);
    await guardarSegredos(porta, "supabase", { service_key: "chave-service-0001", tabela: "meu_rag" });
    const segredos = await lerSegredosRag(porta, "supabase", ["RAG_SUPABASE_SERVICE_KEY", "RAG_SUPABASE_TABELA", "RAG_QDRANT_API_KEY"]);
    expect(segredos).toEqual({ service_key: "chave-service-0001", tabela: "meu_rag" });
    expect(campoDoSegredo("supabase", "RAG_SUPABASE_SERVICE_KEY")).toBe("service_key");
    expect(campoDoSegredo("supabase", "RAG_QDRANT_API_KEY")).toBeNull();
    expect(aberturas).toBeGreaterThan(0);
  });
});
