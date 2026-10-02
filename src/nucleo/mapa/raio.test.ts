import { describe, expect, it } from "vitest";
import { calcularRaio, faixaDoRaio, arquivoDoId, type ArestaRaio, type ContextoRaio, type InfoArquivoRaio } from "./raio";
import { NOTA_RAIO } from "./tipos";

describe("faixaDoRaio (tabela)", () => {
  const base = { chamadores: 0, cobertura: "existente" as const, consumoAssincrono: false, zona: false, migracao: false, dadoHistorico: false };
  it.each([
    ["≤ 3 chamadores + cobertura existente → BAIXO", { chamadores: 3 }, "BAIXO"],
    ["0 chamadores → BAIXO", {}, "BAIXO"],
    ["4 chamadores → MEDIO", { chamadores: 4 }, "MEDIO"],
    ["15 chamadores → MEDIO", { chamadores: 15 }, "MEDIO"],
    ["16 chamadores → ALTO", { chamadores: 16 }, "ALTO"],
    ["cobertura parcial → MEDIO", { cobertura: "parcial" }, "MEDIO"],
    ["cobertura ausente → MEDIO", { cobertura: "ausente" }, "MEDIO"],
    ["cobertura desconhecida (na dúvida a maior) → MEDIO", { cobertura: "desconhecida" }, "MEDIO"],
    ["consumo por job → MEDIO", { consumoAssincrono: true }, "MEDIO"],
    ["migração → ALTO", { migracao: true }, "ALTO"],
    ["zona declarada → ALTO", { zona: true }, "ALTO"],
    ["dado histórico → ALTO", { dadoHistorico: true }, "ALTO"],
    ["pouco chamador mas zona → ALTO (disjuntivo)", { chamadores: 1, zona: true }, "ALTO"],
    ["MEDIO e ALTO juntos → ALTO", { chamadores: 5, migracao: true }, "ALTO"],
    ["BAIXO é conjuntivo: um critério falha e deixa de ser BAIXO", { chamadores: 2, consumoAssincrono: true }, "MEDIO"],
  ] as const)("%s", (_n, delta, esperado) => {
    expect(faixaDoRaio({ ...base, ...delta })).toBe(esperado);
  });
  it("limiares do PERFIL substituem os padrões", () => {
    expect(faixaDoRaio({ ...base, chamadores: 6 }, { chamadores_baixo_max: 5, chamadores_medio_max: 10 })).toBe("MEDIO");
    expect(faixaDoRaio({ ...base, chamadores: 11 }, { chamadores_baixo_max: 5, chamadores_medio_max: 10 })).toBe("ALTO");
  });
});

const imp = (de: string, para: string, confianca: "exata" | "heuristica" = "exata"): ArestaRaio => ({ tipo: "importa", de: `arq:${de}`, para: `arq:${para}`, confianca });
const info = (m: Record<string, InfoArquivoRaio> = {}): Map<string, InfoArquivoRaio> => new Map(Object.entries(m));
const OK: Partial<ContextoRaio> = { cobertura: new Map([["src/alvo.ts", { estado: "existente", fonte: "estimada" }]]), historia: "ok", dadoHistorico: false };
const callers = (n: number, prefixo = "src/c"): ArestaRaio[] => Array.from({ length: n }, (_, i) => imp(`${prefixo}${i}.ts`, "src/alvo.ts"));

describe("calcularRaio", () => {
  it("chamadores = arquivos distintos, sem teste e sem o alvo, e bate com a contagem manual", () => {
    const r = calcularRaio(
      { arquivos: ["src/alvo.ts"] },
      {
        ...OK,
        arestas: [
          imp("src/a.ts", "src/alvo.ts"),
          { tipo: "chama", de: "sim:src/a.ts#f", para: "sim:src/alvo.ts#g", confianca: "exata" }, // mesmo arquivo: não duplica
          { tipo: "chama", de: "sim:src/a.ts#h", para: "sim:src/alvo.ts#g", confianca: "exata" },
          imp("src/b.ts", "src/alvo.ts"),
          imp("src/alvo.test.ts", "src/alvo.ts"),
          imp("src/alvo.ts", "src/alvo.ts"),
        ],
        arquivos: info({ "src/alvo.test.ts": { e_teste: true } }),
      } as ContextoRaio,
    );
    expect(r.sinais[0]).toMatchObject({ id: 1, min: 2, max: 2 });
    expect(r.detalhes.chamadores_max).toEqual(["src/a.ts", "src/b.ts"]);
    expect(r.faixa).toBe("BAIXO");
    expect(r.nota).toBe(NOTA_RAIO);
    expect(r.sinais.every((s) => s.metodo.length > 0)).toBe(true);
  });

  it("um nível indireto acima; para em ponto de entrada", () => {
    const base: ContextoRaio = { ...OK, arestas: [imp("src/a.ts", "src/alvo.ts"), imp("src/x.ts", "src/a.ts"), imp("src/y.ts", "src/x.ts")], arquivos: info() } as ContextoRaio;
    expect(calcularRaio({ arquivos: ["src/alvo.ts"] }, base).detalhes.chamadores_max).toEqual(["src/a.ts", "src/x.ts"]); // y está a 2 níveis
    const comEntrada = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...base, entradas: [{ id: "ent:src/a.ts#GET /a", subtipo: "rota", chave: "GET /a", caminho: "src/a.ts" }] });
    expect(comEntrada.detalhes.chamadores_max).toEqual(["src/a.ts"]);
    expect(comEntrada.detalhes.rotas).toEqual(["GET /a (src/a.ts)"]);
    expect(comEntrada.detalhes.alcance_transitivo).toBe(3); // alcance transitivo ignora a parada
  });

  it("heurísticas elevam o máximo e a faixa usa o máximo", () => {
    const arestas = [...callers(3), imp("src/h1.ts", "src/alvo.ts", "heuristica"), imp("src/h2.ts", "src/alvo.ts", "heuristica")];
    const r = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, arestas, arquivos: info() } as ContextoRaio);
    expect(r.sinais[0]).toMatchObject({ min: 3, max: 5 });
    expect(r.faixa).toBe("MEDIO");
  });

  it("4–15 → MEDIO; > 15 → ALTO", () => {
    const m = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, arestas: callers(8), arquivos: info() } as ContextoRaio);
    expect(m.faixa).toBe("MEDIO");
    const a = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, arestas: callers(16), arquivos: info() } as ContextoRaio);
    expect(a.faixa).toBe("ALTO");
  });

  it("cobertura parcial/ausente → MEDIO; desconhecida vira pior caso", () => {
    const parcial = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, cobertura: new Map([["src/alvo.ts", { estado: "parcial", fonte: "estimada" }]]), arestas: callers(1), arquivos: info() } as ContextoRaio);
    expect(parcial.faixa).toBe("MEDIO");
    const desconhecida = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, cobertura: new Map(), arestas: callers(1), arquivos: info() } as ContextoRaio);
    expect(desconhecida.pior_caso.map((p) => p.sinal)).toContain(4);
  });

  it("consumo por job alcançável → MEDIO", () => {
    const r = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, arestas: callers(1), arquivos: info(), entradas: [{ id: "ent:src/c0.ts#cron:* * * * *", subtipo: "job", chave: "cron:* * * * *", caminho: "src/c0.ts" }] } as ContextoRaio);
    expect(r.faixa).toBe("MEDIO");
    expect(r.sinais[2]?.valor).toMatch(/job:cron/);
  });

  it("migração: o alvo é migração, ou toca tabela definida em migração do trabalho → ALTO", () => {
    const m = calcularRaio({ arquivos: ["db/migrate/001.rb"] }, { ...OK, cobertura: new Map([["db/migrate/001.rb", { estado: "existente", fonte: "estimada" }]]), arestas: [], arquivos: info({ "db/migrate/001.rb": { e_migracao: true } }) } as ContextoRaio);
    expect(m.faixa).toBe("ALTO");
    const t = calcularRaio(
      { arquivos: ["src/alvo.ts"] },
      { ...OK, arestas: [{ tipo: "le_tabela", de: "sim:src/alvo.ts#q", para: "tab:pedidos", confianca: "exata" }], arquivos: info(), tabelasDefinidasEm: new Map([["pedidos", ["db/migrate/002.rb"]]]), migracoesDoTrabalho: new Set(["db/migrate/002.rb"]) } as ContextoRaio,
    );
    expect(t.faixa).toBe("ALTO");
    expect(t.sinais[6]?.valor).toMatch(/pedidos/);
  });

  it("zona declarada → ALTO; só candidata → faixa não eleva, mas o pior caso sim", () => {
    const declarada = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, arestas: [], arquivos: info(), zonasDeclaradas: ["src"] } as ContextoRaio);
    expect(declarada.faixa).toBe("ALTO");
    expect(declarada.sinais[4]?.metodo).toBe("PERFIL.md §Zonas");
    const cand = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, arestas: [], arquivos: info(), zonasCandidatas: [{ categoria: "fiscal", pastas: ["src"], arquivos: [], tabelas: [] }] } as ContextoRaio);
    expect(cand.faixa).toBe("BAIXO");
    expect(cand.sinais[4]).toMatchObject({ pior_caso: true, valor: "fiscal (candidata)" });
    expect(cand.faixa_pior_caso).toBe("ALTO");
  });

  it("zona por tabela lida", () => {
    const r = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, arestas: [{ tipo: "le_tabela", de: "arq:src/alvo.ts", para: "tab:notas_fiscais", confianca: "exata" }], arquivos: info(), zonasDeclaradas: ["notas_fiscais"] } as ContextoRaio);
    expect(r.faixa).toBe("ALTO");
  });

  it("recurso dinâmico possível e chamadas ambíguas viram pior caso do sinal 1 e elevam a faixa de pior caso", () => {
    const r = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, arestas: callers(1), arquivos: info({ "src/c0.ts": { dinamico: true } }), chamadasAmbiguas: 2 } as ContextoRaio);
    expect(r.pior_caso.filter((p) => p.sinal === 1)).toHaveLength(2);
    expect(r.sinais[0]?.pior_caso).toBe(true);
    expect(r.faixa).toBe("BAIXO");
    expect(r.faixa_pior_caso).toBe("ALTO");
  });

  it("sem git: churn vira pior caso declarado", () => {
    const r = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, historia: "indisponivel", arestas: [], arquivos: info() } as ContextoRaio);
    expect(r.pior_caso.find((p) => p.sinal === 6)?.motivo).toMatch(/sem histórico git/);
    expect(r.sinais[5]).toMatchObject({ valor: "indisponível", pior_caso: true });
  });

  it("com história: churn, correções e datas no sinal 6", () => {
    const r = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, arestas: [], arquivos: info({ "src/alvo.ts": { churn_total: 12, churn_janela: 4, commits_correcao: 3, criado_git: "2020-01-01T00:00:00Z", ultima_alt: "2025-01-01T00:00:00Z" } }) } as ContextoRaio);
    expect(r.sinais[5]?.valor).toBe("12 alteração(ões) na janela coletada (4 recente(s)), 3 correção(ões); criado 2020-01-01T00:00:00Z, última 2025-01-01T00:00:00Z");
  });

  it("dado histórico (sinal 8): sempre pior caso até a pessoa responder; respondido 'não' tira o ALTO de pior caso", () => {
    const sem = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, dadoHistorico: null, arestas: [], arquivos: info() } as ContextoRaio);
    expect(sem.faixa).toBe("BAIXO");
    expect(sem.faixa_pior_caso).toBe("ALTO");
    expect(sem.pior_caso.map((p) => p.sinal)).toContain(8);
    const nao = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, dadoHistorico: false, arestas: [], arquivos: info() } as ContextoRaio);
    expect(nao.faixa_pior_caso).toBe("BAIXO");
    const sim = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, dadoHistorico: true, arestas: [], arquivos: info() } as ContextoRaio);
    expect(sim.faixa).toBe("ALTO");
  });

  it("símbolos restringem o primeiro nível aos chamadores dos símbolos", () => {
    const ctx = { ...OK, arquivos: info(), arestas: [{ tipo: "chama", de: "sim:src/a.ts#f", para: "sim:src/alvo.ts#g", confianca: "exata" }, { tipo: "chama", de: "sim:src/b.ts#f", para: "sim:src/alvo.ts#outro", confianca: "exata" }, imp("src/b.ts", "src/alvo.ts")] } as ContextoRaio;
    expect(calcularRaio({ arquivos: ["src/alvo.ts"], simbolos: ["src/alvo.ts#g"] }, ctx).detalhes.chamadores_max).toEqual(["src/a.ts"]);
    expect(calcularRaio({ arquivos: ["src/alvo.ts"] }, ctx).detalhes.chamadores_max).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("candidatos a costura: o arquivo por onde passam todos os caminhos entrada → alvo", () => {
    const ctx = {
      ...OK,
      arquivos: info(),
      arestas: [imp("src/e1.ts", "src/gargalo.ts"), imp("src/e2.ts", "src/gargalo.ts"), imp("src/gargalo.ts", "src/alvo.ts")],
      entradas: [{ id: "ent:src/e1.ts#GET /1", subtipo: "rota", chave: "GET /1", caminho: "src/e1.ts" }, { id: "ent:src/e2.ts#GET /2", subtipo: "rota", chave: "GET /2", caminho: "src/e2.ts" }],
    } as ContextoRaio;
    expect(calcularRaio({ arquivos: ["src/alvo.ts"] }, ctx).candidatos_costura).toEqual(["src/gargalo.ts"]);
  });

  it("saída é JSON puro e só com caminhos relativos", () => {
    const r = calcularRaio({ arquivos: ["src/alvo.ts"] }, { ...OK, arestas: callers(2), arquivos: info() } as ContextoRaio);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(JSON.stringify(r)).not.toMatch(/"\/(Users|home)/);
  });

  it("arquivoDoId", () => {
    expect(arquivoDoId("sim:src/a.ts#B.c")).toBe("src/a.ts");
    expect(arquivoDoId("ent:src/r.ts#GET /x")).toBe("src/r.ts");
    expect(arquivoDoId("arq:x.ts")).toBe("x.ts");
    expect(arquivoDoId("tab:x")).toBeNull();
    expect(arquivoDoId("ext:npm:x")).toBeNull();
  });
});
