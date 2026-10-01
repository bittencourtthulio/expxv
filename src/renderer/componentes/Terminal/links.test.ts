import { describe, expect, it } from "vitest";
import { urlNoTexto, urlDeLinkPermitida } from "./links";

describe("urlDeLinkPermitida", () => {
  it("aceita http e https e devolve a URL normalizada", () => {
    expect(urlDeLinkPermitida("https://exemplo.com/a?b=1#c")).toBe("https://exemplo.com/a?b=1#c");
    expect(urlDeLinkPermitida("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000/");
  });
  it("recusa outros esquemas, credenciais, controle e excesso", () => {
    for (const ruim of ["file:///etc/passwd", "javascript:alert(1)", "ftp://x.com", "https://u:s@x.com", "https://x.com/\u0007", "https://x.com/\n", "não é url", "", `https://x.com/${"a".repeat(2100)}`]) {
      expect(urlDeLinkPermitida(ruim)).toBeNull();
    }
  });
});

describe("urlNoTexto", () => {
  const texto = "veja (https://exemplo.com/a?b=1). e http://x.org/y, fim";
  it("acha a URL sob a coluna e tira a pontuação final", () => {
    expect(urlNoTexto(texto, texto.indexOf("exemplo"))).toBe("https://exemplo.com/a?b=1");
    expect(urlNoTexto(texto, texto.indexOf("http://") + 3)).toBe("http://x.org/y");
  });
  it("devolve null fora de qualquer URL", () => {
    expect(urlNoTexto(texto, 0)).toBeNull();
    expect(urlNoTexto(texto, texto.length - 1)).toBeNull();
    expect(urlNoTexto(texto, -1)).toBeNull();
  });
});

import { vi } from "vitest";
import { abrirLinkDoTerminal } from "./links";

describe("abrirLinkDoTerminal", () => {
  it("só abre com Cmd ou Ctrl e manda a URL normalizada ao main", () => {
    const abrirLink = vi.fn().mockResolvedValue(true);
    expect(abrirLinkDoTerminal({ abrirLink }, { metaKey: false, ctrlKey: false }, "https://a.com")).toBe(false);
    expect(abrirLinkDoTerminal({ abrirLink }, { metaKey: true, ctrlKey: false }, "https://a.com")).toBe(true);
    expect(abrirLinkDoTerminal({ abrirLink }, { metaKey: false, ctrlKey: true }, "http://b.com")).toBe(true);
    expect(abrirLink.mock.calls).toEqual([["https://a.com/"], ["http://b.com/"]]);
  });
  it("recusa esquema perigoso mesmo com Cmd", () => {
    const abrirLink = vi.fn().mockResolvedValue(true);
    expect(abrirLinkDoTerminal({ abrirLink }, { metaKey: true, ctrlKey: false }, "file:///etc/passwd")).toBe(false);
    expect(abrirLink).not.toHaveBeenCalled();
  });
});
