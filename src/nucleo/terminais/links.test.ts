import { describe, expect, it } from "vitest";
import { urlDeLinkPermitida } from "./links";

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
