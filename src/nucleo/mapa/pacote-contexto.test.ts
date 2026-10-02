import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_MAPA_PADRAO, type RaioMapaIpc, type ResumoMapaIpc } from "../../compartilhado/mapa";
import type { ArquivoMapa } from "./analises/tipos";
import { carimboDe, estimarTokens, gerarPacote, gravarPacote, lerInventarioAnterior, montarResumoMd, nomeRaio, podarPacotes, type ConteudoPacote, type EntradaPacote } from "./pacote-contexto";
import { montarPerfilProvisorio, NOTA_PERFIL } from "./perfil-provisorio";
import { VERSAO_EXTRATOR, type Extracao } from "./tipos";

const pastas: string[] = [];
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});
const tmp = (): string => {
  const p = mkdtempSync(join(tmpdir(), "mapa-pac-"));
  pastas.push(p);
  return p;
};

const resumo = (n: number): ResumoMapaIpc => ({
  estado: "pronto", versao_mapa: 4, analisado_em: "2026-10-01T10:00:00Z", arquivos: n, nos: n * 6, linguagens: [{ linguagem: "typescript", arquivos: n, loc: n * 80 }],
  arestas: { exata: n * 3, heuristica: n }, historia: "ok", ferramentas: { ctags: false, scc: false, dot: false }, desatualizado: false, alterados_n: 0, degradadas: 0,
  analisando: false, progresso: null, configuracao: { ...CONFIG_MAPA_PADRAO }, aviso: null, pacote: { carimbo: null, caminho: null }, estimativa_arquivos: null,
});

function ext(p: Partial<Extracao> = {}): Extracao {
  return {
    versao_extrator: VERSAO_EXTRATOR, linguagem: "typescript", hash: "h", loc: 10, loc_codigo: 8, loc_comentario: 1, complexidade_total: 2, complexidade_max: 2, erros_parse: 0,
    e_teste: false, e_gerado: false, truncado: false, simbolos: [], imports: [], chamadas: [], herancas: [], entradas: [], dados: [], padroes: [], dinamicos: [], ...p,
  };
}

function entrada(n = 5000): EntradaPacote {
  const arquivos: ArquivoMapa[] = Array.from({ length: Math.min(n, 800) }, (_, i) => ({ caminho: `src/m${i % 40}/f${i}${i % 9 === 0 ? ".test" : ""}.ts`, extracao: ext({ e_teste: i % 9 === 0 }) }));
  return {
    resumo: resumo(n),
    inventario: { arquivos, manifestos: [] },
    importantes: Array.from({ length: n }, (_, i) => ({ caminho: `src/m${i % 40}/f${i}.ts`, linguagem: "typescript", loc: 80, pagerank: 1 / (i + 1), camada: i % 5, ciclo_id: i % 50 === 0 ? 1 : null, modulo: `src/m${i % 40}` })),
    dados: {
      entradas: { por_categoria: { rota: 600, cli: 5 }, itens: Array.from({ length: 800 }, (_, i) => ({ id: `ent:src/r${i}.ts#GET /r${i}`, subtipo: "rota", chave: `GET /r${i}`, framework: "express", caminho: `src/r${i}.ts`, linha: i + 1, confianca: "exata" as const })) },
      camadas: { modulos: [], ciclos: [], violacoes: Array.from({ length: 300 }, (_, i) => ({ origem: "inferida" as const, de_modulo: `src/m${i}`, para_modulo: `src/n${i}`, evidencias: [`src/m${i}/a.ts:3`], motivo: "ciclo" })), dsm: { modulos: [], celulas: [], truncado: false }, regras_importadas: 0 },
      ciclos: { total: 40, ciclos: Array.from({ length: 40 }, (_, i) => ({ id: i, tamanho: 3, nos: [`arq:a${i}.ts`, `arq:b${i}.ts`, `arq:c${i}.ts`], quebrar: [] })) },
      sem_teste: { itens: [], por_pasta: Array.from({ length: 200 }, (_, i) => ({ pasta: `src/m${i}`, total: 20, sem_teste: 5 })) },
      dialetos: { eixos: [{ eixo: "erro", forca: "CONFLITO", destino: "conflito", variantes: [] }] },
      zonas: { zonas: [{ categoria: "financeiro", pastas: ["src/pagamento"], arquivos: [], tabelas: [], quem_valida: "NÃO DETERMINADO" }] },
      mortos: { rotulo: "candidato", itens: Array.from({ length: 300 }, (_, i) => ({ id: `arq:z${i}.ts`, tipo: "arquivo" as const, caminho: `z${i}.ts`, linha: null, confianca: "baixa" as const, motivos: ["sem importadores"] })) },
      hotspots: { disponivel: true, itens: Array.from({ length: 50 }, (_, i) => ({ caminho: `src/h${i}.ts`, score: 1 - i / 100, faixa: "quente" as const, churn_janela: 9, complexidade_max: 30, autores_n: 3, idade_dias: 400, commits_correcao: 2, parceiros: [] })) },
    },
    externas: { aviso: "informativo", itens: Array.from({ length: 200 }, (_, i) => ({ id: `ext:npm:p${i}`, ecossistema: "npm", nome: `p${i}`, versao: "1.0.0", declarado: true, usado: true, dev: false, licenca: "MIT", selo: null })) },
    dados_acesso: { tabelas: Array.from({ length: 200 }, (_, i) => ({ nome: `t${i}`, definida_em: [], le_n: 3, escreve_n: 1, toques: [] })) },
  };
}

function raioGrande(): RaioMapaIpc {
  return {
    arquivos: Array.from({ length: 50 }, (_, i) => `src/a${i}.ts`), sinais: [], faixa: "MEDIO", faixa_pior_caso: "ALTO", pior_caso: Array.from({ length: 40 }, (_, i) => ({ sinal: 8, motivo: `motivo longo ${i} `.repeat(10) })),
    candidatos_costura: Array.from({ length: 200 }, (_, i) => `sim:src/x${i}.ts#f`), nota: "provisório", chamadores: Array.from({ length: 400 }, (_, i) => `src/c/${"d".repeat(40)}${i}.ts`), alcance_transitivo: 400,
  };
}

function arvore(raiz: string, rel = ""): string[] {
  const out: string[] = [];
  for (const n of readdirSync(join(raiz, rel)).sort()) {
    const p = rel === "" ? n : `${rel}/${n}`;
    out.push(p);
    if (lstatSync(join(raiz, p)).isDirectory()) out.push(...arvore(raiz, p));
  }
  return out;
}

describe("RESUMO.md (P-247)", () => {
  it("cabe em 6 000 tokens num projeto grande e é determinístico", () => {
    const e = entrada();
    const a = montarResumoMd(e);
    expect(estimarTokens(a)).toBeLessThanOrEqual(6000);
    expect(montarResumoMd(e)).toBe(a);
    expect(a).toContain("## Confiança e limites");
    expect(a).toContain("## Como usar");
  });
  it("orçamento pequeno corta por fatores e ainda respeita o limite", () => {
    expect(estimarTokens(montarResumoMd(entrada(), { orcamentoTokens: 300 }))).toBeLessThanOrEqual(300);
  });
});

describe("pacote em disco (T-17.31)", () => {
  it("grava atômico, só em .expxv/mapa/, sem caminho absoluto, e docs/ fica idêntico", () => {
    const raiz = tmp();
    mkdirSync(join(raiz, "docs", "stack"), { recursive: true });
    writeFileSync(join(raiz, "docs", "stack", "CONVENCOES.md"), "x");
    writeFileSync(join(raiz, "app.ts"), "export {}");
    const antes = arvore(raiz);
    const t = performance.now();
    const r = gerarPacote({ raiz, carimbo: "20261001T100000Z", entrada: entrada(), raio: { trabalho_id: "OC-2026-0001/../x", raio: raioGrande() } });
    expect(performance.now() - t).toBeLessThan(2000);
    expect(r.pasta_rel).toBe(".expxv/mapa/20261001T100000Z");
    const depois = arvore(raiz);
    expect(depois.filter((x) => !antes.includes(x)).every((x) => x.startsWith(".expxv"))).toBe(true);
    expect(depois.filter((x) => x.startsWith("docs"))).toEqual(antes.filter((x) => x.startsWith("docs")));
    expect(readFileSync(join(raiz, ".expxv", ".gitignore"), "utf8")).toBe("*\n");
    const pasta = join(raiz, ".expxv", "mapa", "20261001T100000Z");
    expect(readdirSync(pasta).sort()).toEqual(["RESUMO.md", "arquivos.jsonl", "entradas.json", "inventario-stackx.json", "mudancas-desde-ultimo.json", "perfil-provisorio.json", nomeRaio("OC-2026-0001/../x")].sort());
    for (const f of readdirSync(pasta)) expect(readFileSync(join(pasta, f), "utf8").includes(raiz), f).toBe(false);
    expect(estimarTokens(readFileSync(join(pasta, nomeRaio("OC-2026-0001/../x")), "utf8"))).toBeLessThanOrEqual(2000);
    expect(readdirSync(join(raiz, ".expxv", "mapa")).some((n) => n.startsWith(".tmp"))).toBe(false);
  });

  it("mantém só 3 pacotes e compara com o anterior", () => {
    const raiz = tmp();
    for (const c of ["20261001T000001Z", "20261001T000002Z", "20261001T000003Z", "20261001T000004Z", "20261001T000005Z"]) gerarPacote({ raiz, carimbo: c, entrada: entrada(50) });
    expect(readdirSync(join(raiz, ".expxv", "mapa")).sort()).toEqual(["20261001T000003Z", "20261001T000004Z", "20261001T000005Z"]);
    expect(lerInventarioAnterior(raiz)?.carimbo).toBe("20261001T000005Z");
    const m = JSON.parse(readFileSync(join(raiz, ".expxv", "mapa", "20261001T000005Z", "mudancas-desde-ultimo.json"), "utf8")) as { primeira_analise: boolean };
    expect(m.primeira_analise).toBe(false);
  });

  it("a poda nunca toca o que não é carimbo", () => {
    const raiz = tmp();
    const base = join(raiz, ".expxv", "mapa");
    mkdirSync(join(base, "camadas-manual"), { recursive: true });
    for (const c of ["20260101T000000Z", "20260102T000000Z", "20260103T000000Z", "20260104T000000Z"]) mkdirSync(join(base, c));
    podarPacotes(base);
    expect(existsSync(join(base, "camadas-manual"))).toBe(true);
    expect(readdirSync(base).filter((n) => /^\d/.test(n))).toHaveLength(3);
  });

  it("recusa raiz relativa, carimbo e `..`, conteúdo com a raiz", () => {
    const raiz = tmp();
    const c: ConteudoPacote = { resumo_md: "x", inventario: [], perfil: {}, entradas: {}, arquivos_jsonl: "", mudancas: { primeira_analise: true, novos: [], removidos: [], alterados: [] } };
    expect(() => gravarPacote({ raiz: "relativa", carimbo: "20261001T100000Z", conteudo: c })).toThrow();
    expect(() => gravarPacote({ raiz, carimbo: "../../etc", conteudo: c })).toThrow(/carimbo/);
    expect(() => gravarPacote({ raiz: `${raiz}/../x`, carimbo: "20261001T100000Z", conteudo: c })).toThrow();
    expect(() => gravarPacote({ raiz, carimbo: "20261001T100000Z", conteudo: { ...c, resumo_md: `vazou ${raiz}/a.ts` } })).toThrow(/absoluto/);
    expect(existsSync(join(raiz, ".expxv", "mapa", "20261001T100000Z"))).toBe(false);
  });

  it("carimbo no formato e perfil sem código", () => {
    expect(carimboDe(new Date("2026-10-01T10:20:30.456Z"))).toBe("20261001T102030Z");
    const p = montarPerfilProvisorio({ ...entrada(10), agora: new Date("2026-10-01T00:00:00Z") });
    expect(p.nota).toBe(NOTA_PERFIL);
    expect(p.divida).toEqual({ ciclos: 40, candidatos_mortos: 300, hotspots_quentes: 50 });
    expect(p.dialetos_conflitantes).toEqual([{ eixo: "erro", forca: "CONFLITO" }]);
    expect(p.zonas_candidatas[0]?.quem_valida).toBe("NÃO DETERMINADO");
  });
});
