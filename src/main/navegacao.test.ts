import { describe, expect, it, vi } from "vitest";
import { decidirAbertura, urlDocumentoPrincipalPermitida, urlExternaSegura, urlPermitida } from "./navegacao";
import { cabecalhosDoRenderer, caminhoDoRecurso, CONTEUDO_CSP, SCHEME, urlDoApp } from "./scheme";

const RAIZ = "/app/dist/renderer";

describe("urlPermitida / documento principal", () => {
  it("aceita só o scheme próprio no host app", () => {
    expect(urlPermitida(urlDoApp())).toBe(true);
    expect(urlPermitida(`${SCHEME}://outro/index.html`)).toBe(false);
    expect(urlPermitida("https://example.com")).toBe(false);
    expect(urlPermitida("file:///etc/passwd")).toBe(false);
    expect(urlPermitida("isso nao e url")).toBe(false);
  });

  it("frame principal só em / ou /index.html sem query nem hash", () => {
    expect(urlDocumentoPrincipalPermitida(`${SCHEME}://app/`)).toBe(true);
    expect(urlDocumentoPrincipalPermitida(urlDoApp())).toBe(true);
    expect(urlDocumentoPrincipalPermitida(`${SCHEME}://app/index.html?x=1`)).toBe(false);
    expect(urlDocumentoPrincipalPermitida(`${SCHEME}://app/index.html#a`)).toBe(false);
    expect(urlDocumentoPrincipalPermitida(`${SCHEME}://app/outro.html`)).toBe(false);
  });
});

describe("urlExternaSegura / decidirAbertura", () => {
  it("só http/https sem credenciais, sem controle e até 2048", () => {
    expect(urlExternaSegura("https://example.com/a?b=1")).toBe(true);
    expect(urlExternaSegura("http://example.com")).toBe(true);
    expect(urlExternaSegura("javascript:alert(1)")).toBe(false);
    expect(urlExternaSegura("file:///etc/passwd")).toBe(false);
    expect(urlExternaSegura("https://u:p@example.com")).toBe(false);
    expect(urlExternaSegura("https://example.com/\u0007")).toBe(false);
    expect(urlExternaSegura(`https://example.com/${"a".repeat(2100)}`)).toBe(false);
  });

  it("interno = allow; externo seguro abre no navegador e nega; resto nega sem abrir", () => {
    const abrir = vi.fn();
    expect(decidirAbertura(urlDoApp(), abrir)).toBe("allow");
    expect(decidirAbertura("https://example.com", abrir)).toBe("deny");
    expect(abrir).toHaveBeenCalledWith("https://example.com");
    abrir.mockClear();
    expect(decidirAbertura("javascript:alert(1)", abrir)).toBe("deny");
    expect(abrir).not.toHaveBeenCalled();
  });
});

describe("caminhoDoRecurso", () => {
  it("serve arquivos dentro da raiz, com extensão conhecida", () => {
    expect(caminhoDoRecurso(`${SCHEME}://app/index.html`, RAIZ)?.replace(/\\/g, "/")).toBe(`${RAIZ}/index.html`);
    expect(caminhoDoRecurso(`${SCHEME}://app/`, RAIZ)?.replace(/\\/g, "/")).toBe(`${RAIZ}/index.html`);
    expect(caminhoDoRecurso(`${SCHEME}://app/assets/a.js`, RAIZ)?.replace(/\\/g, "/")).toBe(`${RAIZ}/assets/a.js`);
  });

  it("recusa traversal, host errado, extensão desconhecida e caracteres perigosos", () => {
    expect(caminhoDoRecurso(`${SCHEME}://app/../../etc/passwd`, RAIZ)).toBeNull();
    expect(caminhoDoRecurso(`${SCHEME}://app/%2e%2e/%2e%2e/etc/passwd`, RAIZ)).toBeNull();
    expect(caminhoDoRecurso(`${SCHEME}://app/a/..%2f..%2fsecreto.js`, RAIZ)).toBeNull();
    expect(caminhoDoRecurso(`${SCHEME}://outro/index.html`, RAIZ)).toBeNull();
    expect(caminhoDoRecurso(`${SCHEME}://app/script.sh`, RAIZ)).toBeNull();
    expect(caminhoDoRecurso(`${SCHEME}://app/a%00.js`, RAIZ)).toBeNull();
    expect(caminhoDoRecurso(`${SCHEME}://app/a%5Cb.js`, RAIZ)).toBeNull();
    expect(caminhoDoRecurso("https://app/index.html", RAIZ)).toBeNull();
    expect(caminhoDoRecurso("lixo", RAIZ)).toBeNull();
  });
});

describe("cabeçalhos do renderer", () => {
  it("aplicam CSP restritiva sem script inline nem remoto", () => {
    const c = cabecalhosDoRenderer();
    expect(c["Content-Security-Policy"]).toBe(CONTEUDO_CSP);
    expect(CONTEUDO_CSP).toContain("script-src 'self'");
    expect(CONTEUDO_CSP).not.toMatch(/script-src[^;]*unsafe/);
    expect(CONTEUDO_CSP).toContain("object-src 'none'");
    expect(c["X-Content-Type-Options"]).toBe("nosniff");
  });
});
