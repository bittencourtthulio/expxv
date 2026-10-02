import { describe, expect, it } from "vitest";
import type { ProvedorRagDto } from "../../../compartilhado/rag";
import { PROVEDORES } from "./config";
import { listarProvedores } from "./provedores";

describe("descritores dos provedores para a UI", () => {
  const l: ProvedorRagDto[] = listarProvedores();
  it("um por provedor da 1ª onda, com id/nome/campos/capacidades e sem segredo no descritor", () => {
    expect(l.map((p) => p.id).sort()).toEqual([...PROVEDORES].sort());
    for (const p of l) {
      expect(p.nome.length).toBeGreaterThan(2);
      expect(p.campos.find((c) => c.chave === "url")).toMatchObject({ secreto: false, obrigatorio: true });
      expect(p.campos.some((c) => c.secreto)).toBe(true);
      expect(p.capacidades.loteMaximo).toBeGreaterThan(0);
      expect(JSON.stringify(p)).not.toMatch(/SENTINELA|eyJ/);
    }
  });
  it("campos específicos de cada provedor", () => {
    const chaves = (id: string): string[] => (l.find((p) => p.id === id) as ProvedorRagDto).campos.map((c) => c.chave);
    expect(chaves("qdrant")).toEqual(["url", "api_key"]);
    expect(chaves("supabase")).toEqual(["url", "service_key", "tabela"]);
    expect(chaves("upstash")).toEqual(expect.arrayContaining(["url", "token"]));
    expect(chaves("pinecone")).toEqual(expect.arrayContaining(["url", "api_key"]));
    expect(l.find((p) => p.id === "pinecone")?.campos[0]?.rotulo).toMatch(/host/i);
  });
  it("script de preparação só no Supabase; capacidades coerentes com os adaptadores", () => {
    expect(l.filter((p) => p.script_preparacao !== null).map((p) => p.id)).toEqual(["supabase"]);
    expect(l.find((p) => p.id === "supabase")?.script_preparacao).toContain("create extension if not exists vector");
    expect(l.find((p) => p.id === "upstash")?.capacidades).toMatchObject({ dimensaoMaxima: 1536, consistenciaEventual: true });
    expect(l.find((p) => p.id === "qdrant")?.capacidades).toMatchObject({ hibrido: true, dimensaoMaxima: null });
    expect(l.find((p) => p.id === "supabase")?.capacidades.dimensaoMaxima).toBe(2000);
  });
  it("é uma cópia: mutar o resultado não altera a próxima chamada", () => {
    (listarProvedores()[0] as ProvedorRagDto).nome = "x";
    expect(listarProvedores()[0]?.nome).not.toBe("x");
  });
});
