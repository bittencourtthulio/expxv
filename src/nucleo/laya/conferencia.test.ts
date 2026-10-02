// T-25.04: conferência do catálogo contra a API do host (função PURA — o script `scripts/conferir-laya.mjs` só busca os
// metadados e baixa arquivos ≤ 5 MB para hash de não-LFS; pesos NUNCA são baixados por agente).
import { describe, expect, it } from "vitest";
import { conferirCatalogoLaya, type IrmaoApiOrigem } from "./conferencia";
import { validarCatalogoLaya, type CatalogoLaya } from "./catalogo";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const RAIZ = resolve(__dirname, "..", "..", "..");
const brutoReal = JSON.parse(readFileSync(join(RAIZ, "resources/laya/modelos.json"), "utf8")) as unknown;
const catalogo = (validarCatalogoLaya(brutoReal).catalogo ?? undefined) as CatalogoLaya;

const apiBase: IrmaoApiOrigem[] = [
  { rfilename: "tokenizer/tokenizer.json", size: 3_583_228 },
  { rfilename: "rl_agent_config.json", size: 745 },
  { rfilename: "typed-decisions/tokenizer/tokenizer.json", size: 3_583_228 },
  { rfilename: "typed-decisions/rl_agent_config.json", size: 847 },
  { rfilename: "multilingual/tokenizer/tokenizer.json", size: 34_363_188, lfs: { sha256: "609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f", size: 34_363_188 } },
  { rfilename: "multilingual/rl_agent_config.json", size: 472 },
];

describe("conferência do catálogo laya (T-25.04)", () => {
  it("com a API de hoje: zero divergências (os .onnx não publicados ficam a_verificar sem reclamar)", () => {
    const r = conferirCatalogoLaya(catalogo, apiBase);
    expect(r.divergencias).toEqual([]);
    expect(r.arquivosParaHashLocal).toEqual(expect.arrayContaining(["tokenizer/tokenizer.json", "rl_agent_config.json"]));
    // o tokenizer multilíngue é LFS: o hash da API já confirma, não precisa baixar
    expect(r.arquivosParaHashLocal).not.toContain("multilingual/tokenizer/tokenizer.json");
  });

  it("tamanho divergente na origem é divergência", () => {
    const api = structuredClone(apiBase);
    api[0].size = 9_999;
    expect(conferirCatalogoLaya(catalogo, api).divergencias.join("\n")).toMatch(/tamanho/);
  });

  it("sha256 LFS divergente é divergência", () => {
    const api = structuredClone(apiBase) as Array<IrmaoApiOrigem & { lfs?: { sha256: string; size: number } }>;
    api[4].lfs = { sha256: "f".repeat(64), size: 34_363_188 };
    expect(conferirCatalogoLaya(catalogo, api).divergencias.join("\n")).toMatch(/sha256/);
  });

  it("quando a origem PUBLICAR um arquivo que está a_verificar, a conferência avisa para atualizar o catálogo (AP-14)", () => {
    const api = structuredClone(apiBase) as Array<IrmaoApiOrigem & { lfs?: { sha256: string; size: number } }>;
    api.push({ rfilename: "encoder.onnx", size: 423_000_000, lfs: { sha256: "a".repeat(64), size: 423_000_000 } });
    const r = conferirCatalogoLaya(catalogo, api);
    expect(r.divergencias.join("\n")).toMatch(/checksum_publicado_nao_catalogado/);
  });

  it("arquivo do catálogo ausente na origem é divergência", () => {
    const api = apiBase.filter((a) => a.rfilename !== "rl_agent_config.json");
    expect(conferirCatalogoLaya(catalogo, api).divergencias.join("\n")).toMatch(/arquivo_ausente_na_origem/);
  });
});
