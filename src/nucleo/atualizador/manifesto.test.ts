import { describe, expect, it } from "vitest";
import { lerManifesto, limparNotas } from "./manifesto";
import { manifestoBase } from "../../../tests/fixtures/atualizacao/manifestos";

const ler = (m: unknown) => lerManifesto(JSON.stringify(m));
const com = (alt: (m: Record<string, any>) => void) => {
  const m = manifestoBase() as unknown as Record<string, any>;
  alt(m);
  return m;
};

describe("manifesto estrito (T-21.13)", () => {
  it("aceita o manifesto bem formado e devolve só os campos conhecidos", () => {
    const r = ler(manifestoBase());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifesto.artefatos).toHaveLength(2);
  });

  it.each([
    ["campo extra", (m: any) => (m.extra = 1)],
    ["esquema 2", (m: any) => (m.esquema = 2)],
    ["versao inválida", (m: any) => (m.versao = "1.x")],
    ["canal desconhecido", (m: any) => (m.canal = "nightly")],
    ["beta.N em stable", (m: any) => (m.versao = "1.1.0-beta.1")],
    ["data inválida", (m: any) => (m.publicado_em = "ontem")],
    ["validade antes da publicação", (m: any) => (m.valido_ate = "2026-01-01T00:00:00.000Z")],
    ["validade de 5 anos", (m: any) => (m.valido_ate = "2031-09-30T12:00:00.000Z")],
    ["staging 101", (m: any) => (m.staging = 101)],
    ["staging fracionário", (m: any) => (m.staging = 10.5)],
    ["notas não texto", (m: any) => (m.notas = { html: "<b>" })],
    ["sem artefatos", (m: any) => (m.artefatos = [])],
    ["artefato com URL absoluta", (m: any) => (m.artefatos[0].url_relativa = "https://evil.test/a.dmg")],
    ["artefato com ..", (m: any) => (m.artefatos[0].url_relativa = "stable/../../etc/passwd")],
    ["artefato com barra inicial", (m: any) => (m.artefatos[0].url_relativa = "/stable/a.dmg")],
    ["artefato com query", (m: any) => (m.artefatos[0].url_relativa = "a.dmg?x=1")],
    ["artefato com credencial", (m: any) => (m.artefatos[0].url_relativa = "u:p@host/a.dmg")],
    ["sha512 curto", (m: any) => (m.artefatos[0].sha512 = "abc")],
    ["sha512 maiúsculo", (m: any) => (m.artefatos[0].sha512 = "A".repeat(128))],
    ["tamanho zero", (m: any) => (m.artefatos[0].tamanho = 0)],
    ["tamanho gigante", (m: any) => (m.artefatos[0].tamanho = 10 ** 12)],
    ["artefato repetido", (m: any) => m.artefatos.push({ ...m.artefatos[0] })],
    ["plataforma linux", (m: any) => (m.artefatos[0].plataforma = "linux")],
    ["campo extra no artefato", (m: any) => (m.artefatos[0].cmd = "rm")],
    ["versao_minima maior", (m: any) => (m.versao_minima = "9.0.0")],
    ["chaves_revogadas malformadas", (m: any) => (m.chaves_revogadas = ["x"])],
    ["nao_assinado false", (m: any) => (m.nao_assinado = false)],
  ])("recusa: %s", (_n, alt) => {
    expect(ler(com(alt as (m: Record<string, any>) => void)).ok).toBe(false);
  });

  it("recusa JSON inválido, vazio, array e acima do limite", () => {
    expect(lerManifesto("{").ok).toBe(false);
    expect(lerManifesto("").ok).toBe(false);
    expect(lerManifesto("[]").ok).toBe(false);
    expect(lerManifesto("null").ok).toBe(false);
    expect(lerManifesto(" ".repeat(300 * 1024)).ok).toBe(false);
  });

  it("notas: caracteres de controle saem, texto e quebra de linha ficam (a UI usa textContent: AU-15)", () => {
    expect(limparNotas("a\u0000b\u0007c\nd\te")).toBe("abc\nd\te");
    const r = ler(manifestoBase({ notas: "<script>alert(1)</script>\u0000" }));
    expect(r.ok && r.manifesto.notas).toBe("<script>alert(1)</script>");
  });
});
