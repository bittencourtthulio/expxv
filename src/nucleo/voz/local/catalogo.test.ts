import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostsDoConsentimento, modeloPorId, motivoNaoBaixavel, nomeArquivoSeguro, urlDoArquivo, validarCatalogo, type Catalogo } from "./catalogo";
import { carregarCatalogoDe } from "./catalogo-arquivo";

const PASTA = join(__dirname, "../../../../resources/voz");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bruto = (): Record<string, any> => JSON.parse(readFileSync(join(PASTA, "modelos.json"), "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validar = (mut: (c: Record<string, any>) => void): ReturnType<typeof validarCatalogo> => { const c = bruto(); mut(c); return validarCatalogo(c); };

describe("catálogo de voz local (resources/voz/modelos.json)", () => {
  it("o catálogo versionado é válido: Parakeet TDT v3 int8 é o único recomendado e tem PT-BR", () => {
    const r = carregarCatalogoDe(PASTA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rec = r.catalogo.modelos.filter((m) => m.recomendado);
    expect(rec.map((m) => m.id)).toEqual(["parakeet-tdt-0.6b-v3-int8"]);
    expect(rec[0]?.idiomas).toContain("pt");
    expect(rec[0]?.licenca.id).toBe("CC-BY-4.0");
    expect(r.catalogo.modelos.length).toBeGreaterThanOrEqual(3);
    for (const m of r.catalogo.modelos) {
      expect(motivoNaoBaixavel(m), m.id).toBeNull(); // todos os checksums foram conferidos contra a origem
      expect(m.tamanho_bytes).toBe(m.arquivos.reduce((s, a) => s + a.bytes, 0));
      expect(m.origem.caminho_base).toMatch(/\/resolve\/[0-9a-f]{40}\/$/); // revisão fixada por commit: o hash não muda por baixo
      expect(Object.keys(r.catalogo.amostras)).toContain(m.amostra);
    }
  });

  it("entrada sem checksum confirmado fica não baixável (a_verificar), nunca com hash inventado", () => {
    const r = validar((c) => { c["modelos"][1]["arquivos"][0]["sha256"] = "a_verificar"; });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = modeloPorId(r.catalogo, "whisper-small-int8");
    expect(m !== null && motivoNaoBaixavel(m)).toMatch(/Checksum ainda não confirmado/);
    expect(validar((c) => { c["modelos"][0]["arquivos"][0]["sha256"] = "ABC"; }).ok).toBe(false);
    expect(validar((c) => { c["modelos"][0]["arquivos"][0]["sha256"] = "G".repeat(64); }).ok).toBe(false);
    expect(validar((c) => { delete c["modelos"][0]["arquivos"][0]["sha256"]; }).ok).toBe(false);
  });

  it("nomes de arquivo que escapam da pasta (traversal/zip-slip), reservados e ocultos são recusados", () => {
    for (const ruim of ["../x", "a/b", "a\\b", "/etc/passwd", "C:x", "..", ".", ".integridade.json", "a..b", "con.txt", "NUL", "x\u0000y", "a b ", "a:b", "", "x".repeat(97), "-rf"]) {
      expect(nomeArquivoSeguro(ruim), JSON.stringify(ruim)).toBe(false);
      expect(validar((c) => { c["modelos"][0]["arquivos"][0]["nome"] = ruim; }).ok).toBe(false);
    }
    for (const bom of ["encoder.int8.onnx", "base-tokens.txt", "model_v2+int8.onnx"]) expect(nomeArquivoSeguro(bom)).toBe(true);
  });

  it("host fora da lista, IP literal, curinga de TLD, caminho com .. e esquema na origem são recusados", () => {
    expect(validar((c) => { c["modelos"][0]["origem"]["host"] = "evil.example"; }).ok).toBe(false);
    expect(validar((c) => { c["hosts_origem"] = ["10.0.0.1"]; }).ok).toBe(false);
    expect(validar((c) => { c["hosts_arquivos"] = ["*.com"]; }).ok).toBe(false);
    expect(validar((c) => { c["hosts_arquivos"] = ["*"]; }).ok).toBe(false);
    expect(validar((c) => { c["modelos"][0]["origem"]["caminho_base"] = "/a/../b/"; }).ok).toBe(false);
    expect(validar((c) => { c["modelos"][0]["origem"]["caminho_base"] = "https://evil.example/x/"; }).ok).toBe(false);
    expect(validar((c) => { c["modelos"][0]["origem"]["caminho_base"] = "/a/b"; }).ok).toBe(false);
  });

  it("id duplicado, mais de um recomendado, tamanho absurdo, família e licença inválidas são recusados", () => {
    expect(validar((c) => { c["modelos"][1]["id"] = c["modelos"][0]["id"]; }).ok).toBe(false);
    expect(validar((c) => { c["modelos"][1]["recomendado"] = true; }).ok).toBe(false);
    expect(validar((c) => { c["modelos"][0]["arquivos"][0]["bytes"] = 5 * 1024 ** 3; }).ok).toBe(false);
    expect(validar((c) => { c["modelos"][0]["familia"] = "pickle"; }).ok).toBe(false);
    expect(validar((c) => { c["modelos"][0]["licenca"]["url"] = "http://x.y/l"; }).ok).toBe(false);
    expect(validar((c) => { delete c["modelos"][0]["licenca"]; }).ok).toBe(false);
    expect(validar((c) => { c["versao"] = 2; }).ok).toBe(false);
    expect(validarCatalogo(null).ok).toBe(false);
    expect(validarCatalogo([]).ok).toBe(false);
  });

  it("URL e hosts do consentimento saem só do catálogo", () => {
    const r = carregarCatalogoDe(PASTA);
    if (!r.ok) throw new Error("catálogo");
    const c: Catalogo = r.catalogo;
    const m = modeloPorId(c, "parakeet-tdt-0.6b-v3-int8");
    expect(m).not.toBeNull();
    const u = urlDoArquivo(m!, m!.arquivos[0]!);
    expect(u.host).toBe("huggingface.co");
    expect(u.caminho).toMatch(/^\/csukuangfj\/.+\/resolve\/[0-9a-f]{40}\/encoder\.int8\.onnx$/);
    expect(hostsDoConsentimento(c, m!)).toEqual({ origem: "huggingface.co", arquivos: ["*.hf.co", "*.huggingface.co"] });
    expect(modeloPorId(c, "../../etc")).toBeNull();
    expect(modeloPorId(c, 42)).toBeNull();
  });

  it("arquivo ausente ou corrompido: falha fechada com motivo", () => {
    expect(carregarCatalogoDe(join(PASTA, "nao-existe")).ok).toBe(false);
  });
});
