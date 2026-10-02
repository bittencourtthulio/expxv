// T-25.04: catálogo versionado do decisor local (D-697). Fechado, sem campo livre; entrada sem checksum confirmado
// = `a_verificar` e o app RECUSA baixar (AP-14). Herda do catálogo da voz a disciplina de nomes seguros (A3).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  tipoArquivoCatalogoLaya,
  validarCatalogoLaya,
  type CatalogoLaya,
  modeloPorIdLaya,
  motivoNaoBaixavelLaya,
  nomeArquivoSeguroLaya,
  tamanhoBytesLaya,
  urlDoArquivoLaya,
} from "./catalogo";

const RAIZ = resolve(__dirname, "..", "..", "..");
const brutoReal = JSON.parse(readFileSync(join(RAIZ, "resources/laya/modelos.json"), "utf8")) as unknown;

/** catálogo sintético mínimo (mutável nos testes). */
function sintetico(): CatalogoLaya {
  const r = validarCatalogoLaya(brutoReal);
  expect(r.erros).toEqual([]);
  return r.catalogo as CatalogoLaya;
}
const clonar = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("catálogo laya: o REAL é válido e fechado (T-25.04)", () => {
  it("o catálogo do pacote valida sem erros, com 3 modelos e ids únicos", () => {
    const r = validarCatalogoLaya(brutoReal);
    expect(r.erros).toEqual([]);
    const ids = (r.catalogo as CatalogoLaya).modelos.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["laya-en", "laya-td", "laya-ml"]));
  });

  it("revisão por commit e hosts fixos; runtime pinado (D-696/D-697)", () => {
    const c = sintetico();
    expect(c.revisao).toMatch(/^[0-9a-f]{40}$/);
    expect(c.hosts_origem).toContain("huggingface.co");
    expect(c.hosts_arquivos).toEqual(["*.hf.co", "*.huggingface.co"]);
    expect(c.runtime).toBe("onnxruntime-node@1.30.0");
  });

  it("nenhum modelo é baixável hoje: os .onnx estão a_verificar (recusa sem_checksum, AP-14/D-697)", () => {
    const c = sintetico();
    for (const m of c.modelos) {
      expect(m.baixavel, m.id).toBe(false);
      expect(motivoNaoBaixavelLaya(m)).toMatch(/sem_checksum|onnx/);
    }
  });

  it("os arquivos pequenos têm sha256 confirmado (tokenizer/config) e tamanhos batem com a origem", () => {
    const c = sintetico();
    const en = modeloPorIdLaya(c, "laya-en")!;
    const tok = en.arquivos.find((a) => a.nome === "tokenizer.json")!;
    expect(tok.sha256).toBe("6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30");
    expect(tok.bytes).toBe(3_583_228);
    const rl = en.arquivos.find((a) => a.nome === "rl_agent_config.json")!;
    expect(rl.sha256).toBe("ae287b56bbcf5f8c4f4541ae9dfd00c914c4c48b940b8398c3058af37ba92bbd");
    const ml = modeloPorIdLaya(c, "laya-ml")!;
    const tokMl = ml.arquivos.find((a) => a.nome === "tokenizer.json")!;
    expect(tokMl.sha256).toBe("609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f");
    expect(tokMl.bytes).toBe(34_363_188);
  });

  it("URL do arquivo usa o commit fixado e o caminho de origem com subpasta", () => {
    const c = sintetico();
    const en = modeloPorIdLaya(c, "laya-en")!;
    const tok = en.arquivos.find((a) => a.nome === "tokenizer.json")!;
    expect(urlDoArquivoLaya(c, en, tok)).toBe(
      "https://huggingface.co/convaiinnovations/laya/resolve/55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/tokenizer/tokenizer.json",
    );
  });

  it("tamanho total do modelo é a soma dos arquivos (estimado enquanto .onnx não publica)", () => {
    const c = sintetico();
    const en = modeloPorIdLaya(c, "laya-en")!;
    expect(tamanhoBytesLaya(en)).toBe(en.arquivos.reduce((a, f) => a + f.bytes, 0));
    expect(en.tamanho_onnx_estimado).toBe(true);
  });
});

describe("catálogo laya: fechado, sem campo livre", () => {
  it("campo extra no topo, no modelo e no arquivo são recusados", () => {
    const bruto = clonar(brutoReal) as Record<string, unknown>;
    bruto["campo_livre"] = 1;
    expect(validarCatalogoLaya(bruto).erros.length).toBeGreaterThan(0);

    const bruto2 = clonar(brutoReal) as { modelos: Array<Record<string, unknown>> };
    bruto2.modelos[0]["campo_livre"] = 1;
    expect(validarCatalogoLaya(bruto2).erros.length).toBeGreaterThan(0);

    const bruto3 = clonar(brutoReal) as { modelos: Array<{ arquivos: Array<Record<string, unknown>> }> };
    bruto3.modelos[0].arquivos[0]["campo_livre"] = 1;
    expect(validarCatalogoLaya(bruto3).erros.length).toBeGreaterThan(0);
  });

  it("sha256 tem de ser hex64 exato ou a_verificar; bytes positivos; nome de arquivo seguro (A3)", () => {
    const bruto = clonar(brutoReal) as { modelos: Array<{ arquivos: Array<Record<string, unknown>> }> };
    bruto.modelos[0].arquivos[0]["sha256"] = "ABC";
    expect(validarCatalogoLaya(bruto).erros.length).toBeGreaterThan(0);

    const bruto2 = clonar(brutoReal) as { modelos: Array<{ arquivos: Array<Record<string, unknown>> }> };
    bruto2.modelos[0].arquivos[0]["bytes"] = -1;
    expect(validarCatalogoLaya(bruto2).erros.length).toBeGreaterThan(0);

    for (const nome of ["../fora.onnx", "a/b.onnx", "C:\\x.onnx", ".env", "con", "x.onnx.", ".part", ".integridade.json"])
      expect(nomeArquivoSeguroLaya(nome), nome).toBe(false);
    expect(nomeArquivoSeguroLaya("encoder.onnx")).toBe(true);
    expect(nomeArquivoSeguroLaya("tokenizer.json")).toBe(true);
  });

  it("com TODOS os sha256 presentes o modelo fica baixável; papel de arquivo é fechado", () => {
    const c = sintetico();
    const mutado = clonar(c);
    for (const m of mutado.modelos) {
      delete (m as Partial<typeof m>).baixavel; // campo computado: não existe na entrada
      m.arquivos = m.arquivos.map((a) => (a.sha256 === null ? { ...a, sha256: "0".repeat(64) } : a));
    }
    const revalidado = validarCatalogoLaya(mutado as unknown as Record<string, unknown>);
    expect(revalidado.erros).toEqual([]);
    for (const m of (revalidado.catalogo as CatalogoLaya).modelos) {
      expect(m.baixavel, m.id).toBe(true);
      expect(motivoNaoBaixavelLaya(m)).toBeNull();
      for (const a of m.arquivos) expect(tipoArquivoCatalogoLaya(a)).toBeTruthy();
    }
  });
});
