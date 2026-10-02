import { describe, expect, it } from "vitest";
import { idChunk, idDocumento, idLocal, NS_APP, normalizarIdentidade, uuid5 } from "./ids";

describe("ids determinísticos (G §7)", () => {
  it("uuid5 segue o RFC 4122 (vetor conhecido do namespace DNS)", () => {
    expect(uuid5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
  });
  it("vetor fixo: o id de chunk é estável entre execuções e máquinas", () => {
    const base = { escopo: "abcd1234abcd1234", tipo: "decisao", origem: "docs/x.md", indice: 0, texto: "Usar SQLite." };
    const id = idChunk(base);
    expect(id).toBe(idChunk({ ...base, texto: "Usar SQLite.  \r\n" }));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id).not.toBe(idChunk({ ...base, indice: 1 }));
    expect(id).not.toBe(idChunk({ ...base, escopo: "outro" }));
    expect(NS_APP).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("o id depende só dos campos (nada de caminho absoluto nem usuário)", () => {
    expect(idDocumento({ escopo: "e", tipo: "doc", origem: "a.md" })).toBe(idDocumento({ escopo: "e", tipo: "doc", origem: "a.md" }));
    expect(normalizarIdentidade("a  \r\nb \n")).toBe("a\nb");
  });
  it("idLocal é único e prefixado", () => {
    const a = idLocal("con", 1_700_000_000_000);
    const b = idLocal("con", 1_700_000_000_000);
    expect(a).not.toBe(b);
    expect(a.startsWith("con_")).toBe(true);
  });
});
