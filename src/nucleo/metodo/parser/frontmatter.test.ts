import { describe, expect, it } from "vitest";
import { extrairFrontmatter, removerBom } from "./frontmatter";

describe("extrairFrontmatter", () => {
  it("lê YAML válido e separa o corpo", () => {
    const r = extrairFrontmatter("---\nexpx_schema: 1\nkind: tasks\n---\n# Titulo\n");
    expect(r.motivo).toBe("ok");
    expect(r.dados).toEqual({ expx_schema: 1, kind: "tasks" });
    expect(r.corpo).toBe("# Titulo\n");
  });

  it("aceita chave extra sem reclamar", () => {
    const r = extrairFrontmatter("---\nexpx_schema: 1\nkind: tasks\nchave_do_futuro: {a: 1}\n---\n");
    expect(r.dados?.chave_do_futuro).toEqual({ a: 1 });
  });

  it("tolera BOM e CRLF", () => {
    const r = extrairFrontmatter("﻿---\r\nexpx_schema: 1\r\nkind: sprint\r\n---\r\ncorpo\r\n");
    expect(r.dados).toEqual({ expx_schema: 1, kind: "sprint" });
    expect(r.corpo).toContain("corpo");
    expect(removerBom("﻿abc")).toBe("abc");
  });

  it("YAML truncado (sem fechamento) devolve null sem lançar", () => {
    const r = extrairFrontmatter("---\nexpx_schema: 1\nkind: tasks\ntasks:\n  - id: T-01.01\n    titulo: Task tr");
    expect(r.dados).toBeNull();
    expect(r.motivo).toBe("truncado");
  });

  it("YAML inválido devolve null com motivo yaml_invalido", () => {
    const r = extrairFrontmatter("---\nchave: [abre\n outra: : :\n---\ncorpo");
    expect(r.dados).toBeNull();
    expect(r.motivo).toBe("yaml_invalido");
  });

  it("sem frontmatter devolve null e o texto inteiro como corpo", () => {
    const r = extrairFrontmatter("# So markdown\n\nVEREDITO: SIM\n");
    expect(r.dados).toBeNull();
    expect(r.motivo).toBe("sem_frontmatter");
    expect(r.corpo).toContain("VEREDITO: SIM");
  });

  it("frontmatter que não é objeto (lista ou escalar) é rejeitado", () => {
    expect(extrairFrontmatter("---\n- a\n- b\n---\n").dados).toBeNull();
    expect(extrairFrontmatter("---\nsoutexto\n---\n").dados).toBeNull();
  });

  it("frontmatter vazio é objeto vazio, não erro", () => {
    expect(extrairFrontmatter("---\n---\ncorpo").dados).toEqual({});
  });

  it("nunca lança para entrada estranha", () => {
    for (const x of ["", "---", "---\n", "\0\0\0", "---\n" + "a: ".repeat(10), undefined as unknown as string, null as unknown as string, 42 as unknown as string]) {
      expect(() => extrairFrontmatter(x)).not.toThrow();
    }
  });

  it("um segundo bloco --- no corpo não vira frontmatter", () => {
    const r = extrairFrontmatter("---\nkind: tasks\n---\ncorpo\n---\nkind: outro\n---\n");
    expect(r.dados).toEqual({ kind: "tasks" });
  });
});
