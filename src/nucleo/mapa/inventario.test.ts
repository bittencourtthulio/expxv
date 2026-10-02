import { describe, expect, it } from "vitest";
import type { ArquivoMapa } from "./analises/tipos";
import { compararInventarios, formaDoNomeDeTeste, montarInventarioStackx } from "./inventario";
import type { Manifesto } from "./manifestos";
import { VERSAO_EXTRATOR, type Extracao } from "./tipos";

function ext(p: Partial<Extracao> = {}): Extracao {
  return {
    versao_extrator: VERSAO_EXTRATOR, linguagem: "typescript", hash: "h", loc: 10, loc_codigo: 8, loc_comentario: 1, complexidade_total: 2, complexidade_max: 2, erros_parse: 0,
    e_teste: false, e_gerado: false, truncado: false, simbolos: [], imports: [], chamadas: [], herancas: [], entradas: [], dados: [], padroes: [], dinamicos: [], ...p,
  };
}
const arq = (caminho: string, p: Partial<Extracao> = {}): ArquivoMapa => ({ caminho, extracao: ext(p) });
const imp = (especificador: string, linha = 1): Extracao["imports"][number] => ({ especificador, tipo: "estatico", linha, so_tipo: false, nomes: [] });

describe("inventário do stackx (T-17.31)", () => {
  const arquivos: ArquivoMapa[] = [
    arq("src/a.ts"), arq("src/b.ts"), arq("src/c.ts"),
    arq("src/a.test.ts", { e_teste: true, imports: [imp("vitest", 1)], chamadas: [{ de: null, alvo: "mock", receptor: "vi", tipo: "chamada", linha: 4 }] }),
    arq("src/b.test.ts", { e_teste: true, imports: [imp("vitest", 2)] }),
    arq("tests/e2e/c.spec.ts", { e_teste: true, imports: [imp("@playwright/test", 1)] }),
    arq("src/cfg.ts", { padroes: [{ tipo: "env", nome: "DATABASE_URL", linha: 7 }, { tipo: "throw", nome: null, linha: 9 }] }),
  ];
  const manifesto = { arquivo: "package.json", tipo: "package.json", eco: "npm", pasta: "", nome: "x", deps: [], comandos: [{ nome: "test", comando: "vitest run", arquivo: "package.json", linha: 12 }], modulos: [], referencias: [], main: null, bin: [], exports_alvos: [], psr4: [{ prefixo: "App\\", pasta: "src", dev: false }], classmap: [], go_modulo: null, go_replaces: [], raizes_python: [], lacunas: [] } as unknown as Manifesto;
  const inv = montarInventarioStackx({ arquivos, manifestos: [manifesto], camadas: null });
  const por = (t: string) => inv.find((i) => i.topico === t);

  it("localização e forma do nome dos testes, com evidência arquivo:linha", () => {
    const loc = por("teste.localizacao");
    expect(loc?.contagens).toMatchObject({ "co-localizado com o código": 2, "pasta própria de testes": 1 });
    expect(loc?.forca).toBe("CONFLITO");
    expect(loc?.evidencia.length).toBeLessThanOrEqual(5);
    expect(loc?.evidencia.every((e) => /^[^:]+:\d+$/.test(e))).toBe(true);
    expect(por("teste.nome")?.contagens).toMatchObject({ "*.test.ts": 2, "*.spec.ts": 1 });
  });
  it("runner por imports, mock detectado, config só com NOME da variável", () => {
    expect(por("teste.runner")?.contagens).toMatchObject({ vitest: 2, playwright: 1 });
    expect(por("teste.apoio")?.contagens).toMatchObject({ mock: 1 });
    const cfg = por("config.leitura");
    expect(cfg?.fato).toContain("DATABASE_URL");
    expect(JSON.stringify(inv)).not.toMatch(/postgres:\/\//);
  });
  it("comandos declarados, aliases e camadas ausentes", () => {
    expect(por("comandos.declarados")?.evidencia).toEqual(["package.json:12"]);
    expect(por("comandos.declarados")?.forca).toBe("ÚNICO CASO");
    expect(por("import.aliases")?.contagens).toEqual({ aliases: 1 });
    expect(por("camadas.direcao")?.forca).toBe("AUSENTE");
  });
  it("formas de nome", () => {
    expect(formaDoNomeDeTeste("x/test_a.py")).toBe("test_*.py");
    expect(formaDoNomeDeTeste("x/a_test.go")).toBe("*_test.go");
    expect(formaDoNomeDeTeste("x/AServiceTest.java")).toBe("*Test.java");
  });
  it("determinístico e comparação entre inventários", () => {
    expect(montarInventarioStackx({ arquivos, manifestos: [manifesto], camadas: null })).toEqual(inv);
    expect(compararInventarios(inv, null).primeira_analise).toBe(true);
    const outro = inv.map((i) => (i.topico === "teste.nome" ? { ...i, fato: "mudou" } : i)).filter((i) => i.topico !== "import.aliases");
    const m = compararInventarios(outro, inv);
    expect(m.alterados.map((a) => a.topico)).toEqual(["teste.nome"]);
    expect(m.removidos).toEqual(["import.aliases"]);
  });
});
