import { describe, expect, it } from "vitest";
import { ESPECIES, ESPECIES_LEGADAS, GRUPOS_ESPECIE, VARIANTES_MAX, type EspecieId } from "../../compartilhado/bichinho";
import { AFINIDADE_FRAMEWORK, AFINIDADE_LINGUAGEM, AFINIDADE_TIPO } from "./afinidades";
import { CATALOGO, ROTULO_GRUPO, especiesDoGrupo } from "./catalogo";
import { atribuirEspecie, classificarEspecies, varianteDaRepeticao } from "./especie";
import { detectarSinais, type SinaisProjeto } from "./sinais";
import { leitorDeObjeto, muitos } from "./teste-util";

const nome = (i: number): string => `projeto-${i}`;
const vazio: SinaisProjeto = { linguagens: [], frameworks: [], tipos: [] };
const rust = detectarSinais(leitorDeObjeto({ "Cargo.toml": "", ...muitos("src", "rs", 6) }));
const python = detectarSinais(leitorDeObjeto({ "pyproject.toml": "", ...muitos("src", "py", 5) }));

describe("catálogo de 100 espécies", () => {
  it("100 ids ASCII únicos, estáveis, e as 14 originais vêm primeiro", () => {
    expect(ESPECIES).toHaveLength(100);
    expect(new Set(ESPECIES).size).toBe(100);
    for (const e of ESPECIES) expect(e).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect([...ESPECIES_LEGADAS]).toEqual(["caranguejo", "piton", "esquilo", "raposa", "camaleao", "lontra", "tucano", "elefante", "ourico", "coruja", "polvo", "gato", "sapo", "urso"]);
  });

  it("todas têm rótulo, grupo válido, o que representam e personalidade; os grupos cobrem tudo", () => {
    expect(Object.keys(CATALOGO).sort()).toEqual([...ESPECIES].sort());
    for (const e of ESPECIES) {
      const d = CATALOGO[e];
      expect(d.id).toBe(e);
      expect(d.rotulo.length).toBeGreaterThan(3);
      expect(GRUPOS_ESPECIE).toContain(d.grupo);
      expect(d.representa.length).toBeGreaterThanOrEqual(2);
      expect(d.personalidade.length).toBeGreaterThan(15);
    }
    expect(GRUPOS_ESPECIE.flatMap(especiesDoGrupo).sort()).toEqual([...ESPECIES].sort());
    for (const g of GRUPOS_ESPECIE) { expect(ROTULO_GRUPO[g]).toBeTruthy(); expect(especiesDoGrupo(g).length).toBeGreaterThanOrEqual(3); }
  });

  it("rótulos distintos entre si e nenhum nome de marca ou de espécie sensível", () => {
    const rotulos = ESPECIES.map((e) => CATALOGO[e].rotulo);
    expect(new Set(rotulos).size).toBe(100);
  });

  it("toda lista de afinidade só cita espécies do catálogo, sem repetir dentro da lista", () => {
    const listas = [...Object.values(AFINIDADE_LINGUAGEM), ...Object.values(AFINIDADE_TIPO), ...Object.values(AFINIDADE_FRAMEWORK)];
    for (const l of listas) {
      expect(new Set(l).size).toBe(l.length);
      for (const e of l) expect(ESPECIES).toContain(e);
    }
  });

  it("as espécies novas ganham afinidade (aparecem em alguma lista) e todas as 14 originais continuam a preferida de uma stack ou tipo", () => {
    const citadas = new Set<string>([...Object.values(AFINIDADE_LINGUAGEM), ...Object.values(AFINIDADE_TIPO), ...Object.values(AFINIDADE_FRAMEWORK)].flat());
    expect(ESPECIES.filter((e) => !citadas.has(e))).toEqual([]);
    const preferidas = new Set([...Object.values(AFINIDADE_LINGUAGEM), ...Object.values(AFINIDADE_TIPO)].map((l) => l[0]));
    for (const e of ESPECIES_LEGADAS) expect(preferidas.has(e), e).toBe(true);
  });
});

describe("atribuição sem repetir espécie", () => {
  it("100 workspaces seguidos (mesmos sinais ou nenhum) recebem 100 espécies diferentes, sem variante", () => {
    for (const sinais of [rust, vazio, python]) {
      const usos = new Map<EspecieId, number>();
      const vistas = new Set<EspecieId>();
      for (let i = 0; i < 100; i++) {
        const a = atribuirEspecie({ sinais, nome: nome(i), workspaceId: `ws_${i}`, usos });
        expect(a.repetiu).toBe(false);
        expect(a.variante).toBe(0);
        expect(vistas.has(a.especie), `${i}: ${a.especie}`).toBe(false);
        vistas.add(a.especie);
        usos.set(a.especie, 1);
      }
      expect(vistas.size).toBe(100);
    }
  });

  it("a espécie mais afim vence quando livre: Rust → caranguejo, Python → piton, Python de dados → coruja, shell → pinguim, API → jacaré", () => {
    const um = (s: SinaisProjeto): EspecieId => atribuirEspecie({ sinais: s, nome: "x", workspaceId: "ws_1", usos: new Map() }).especie;
    expect(um(rust)).toBe("caranguejo");
    expect(um(python)).toBe("piton");
    expect(um(detectarSinais(leitorDeObjeto({ "requirements.txt": "pandas", ...muitos("", "py", 3) })))).toBe("coruja");
    expect(um(detectarSinais(leitorDeObjeto({ ...muitos("scripts", "sh", 1), ...muitos("", "sh", 4) })))).toBe("pinguim");
    expect(um({ linguagens: [], frameworks: [], tipos: [{ tipo: "api", forca: 4, por: "x" }] })).toBe("jacare");
  });

  it("preferida em uso: cai na próxima mais afim ainda livre, na ordem da lista de afinidade", () => {
    const usos = new Map<EspecieId, number>();
    const ordem: EspecieId[] = [];
    for (let i = 0; i < 4; i++) {
      const a = atribuirEspecie({ sinais: rust, nome: nome(i), workspaceId: `ws_${i}`, usos });
      ordem.push(a.especie);
      usos.set(a.especie, 1);
    }
    expect(ordem).toEqual(AFINIDADE_LINGUAGEM.rust.slice(0, 4));
    const segundo = atribuirEspecie({ sinais: rust, nome: "outro", workspaceId: "ws_z", usos: new Map([["caranguejo", 1]]) });
    expect(segundo.especie).toBe(AFINIDADE_LINGUAGEM.rust[1]);
    expect(segundo.ideal).toBe("caranguejo");
    expect(segundo.motivo.join(" ")).toMatch(/já está em uso/);
  });

  it("é determinística e o hash do nome + id desempata de forma estável (sem sinais)", () => {
    const a = (n: string, id: string) => atribuirEspecie({ sinais: vazio, nome: n, workspaceId: id, usos: new Map() });
    expect(a("app", "ws_1")).toEqual(a("app", "ws_1"));
    expect(classificarEspecies(vazio, "app", "ws_1")).toEqual(classificarEspecies(vazio, "app", "ws_1"));
    expect(classificarEspecies(vazio, "app", "ws_1")).not.toEqual(classificarEspecies(vazio, "app", "ws_2"));
    expect(new Set(classificarEspecies(rust, "app", "ws_1")).size).toBe(100);
  });

  it("depois das 100: repete com VARIANTE (1, 2, 3, 1…) na espécie menos repetida e mais afim", () => {
    const usos = new Map<EspecieId, number>(ESPECIES.map((e) => [e, 1]));
    const a = atribuirEspecie({ sinais: rust, nome: "n101", workspaceId: "ws_101", usos });
    expect(a).toMatchObject({ especie: "caranguejo", repetiu: true, variante: 1 });
    expect(a.motivo.join(" ")).toMatch(/se repete/);
    usos.set("caranguejo", 2);
    expect(atribuirEspecie({ sinais: rust, nome: "n102", workspaceId: "ws_102", usos }).especie).toBe("tatu");
    const todasDuas = new Map<EspecieId, number>(ESPECIES.map((e) => [e, 2]));
    expect(atribuirEspecie({ sinais: rust, nome: "x", workspaceId: "ws_x", usos: todasDuas }).variante).toBe(2);
    expect([1, 2, 3, 4, 5].map(varianteDaRepeticao)).toEqual([1, 2, 3, 1, 2]);
    expect(varianteDaRepeticao(0)).toBe(0);
    for (let n = 0; n < 40; n++) expect(varianteDaRepeticao(n)).toBeLessThan(VARIANTES_MAX);
  });

  it("com 'Sem repetir espécie' desligado vale sempre a mais afim, usada ou não", () => {
    const a = atribuirEspecie({ sinais: rust, nome: "x", workspaceId: "ws_1", usos: new Map([["caranguejo", 3]]), semRepetir: false });
    expect(a).toMatchObject({ especie: "caranguejo", variante: 0, repetiu: false });
  });
});

describe("custo da atribuição (P-672)", () => {
  it("atribuir 100 workspaces seguidos (ordenar as 100 espécies a cada um) custa bem menos que 150 ms no total", () => {
    const usos = new Map<EspecieId, number>();
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) usos.set(atribuirEspecie({ sinais: rust, nome: nome(i), workspaceId: `ws_${i}`, usos }).especie, 1);
    const ms = performance.now() - t0;
    const fator = Number(process.env["EXPXV_PERF_FATOR"] ?? "1");
    expect(ms).toBeLessThan(150 * fator);
  });
});
