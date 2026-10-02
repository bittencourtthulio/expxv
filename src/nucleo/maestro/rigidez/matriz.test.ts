import { describe, expect, it } from "vitest";
import { ETAPA_IDS, NIVEIS_RIGIDEZ } from "../../../compartilhado/maestro";
import { HOOKS_DE_NASCIMENTO } from "../../metodo/hooks";
import { NOME_NIVEL_RIGIDEZ } from "../../squads/rigor";
import { etapaDef, ETAPAS } from "../etapas/catalogo";
import { hooksDoNivel } from "./hooks";
import { celaDe, HOOKS_ENTREGA, HOOKS_ESCOPO, HOOKS_LEGADOX, HOOKS_PISO, HOOKS_PLANO, HOOKS_POR_NIVEL, HOOKS_QUALIDADE, MATRIZ_RIGIDEZ, PARAMETROS_POR_NIVEL, SEGURANCA, SOBRESCRITAS_POR_PIPELINE } from "./matriz";
import { NIVEIS } from "./niveis";

const SIMBOLO = { roda: "●", reduzida: "◐", reforco: "◆", omitida: "○", humano: "H", substituida: "R" } as const;

describe("níveis (D-222)", () => {
  it("nomes e padrão", () => {
    expect(NIVEIS_RIGIDEZ.map((n) => NIVEIS[n].nome)).toEqual(["Relâmpago", "Leve", "Padrão", "Rigoroso", "Total"]);
    for (const n of NIVEIS_RIGIDEZ) expect(NIVEIS[n].nome).toBe(NOME_NIVEL_RIGIDEZ[n]);
    for (const n of NIVEIS_RIGIDEZ) {
      expect(NIVEIS[n].ligado.length).toBeGreaterThan(5);
      expect(NIVEIS[n].desligado.length).toBeGreaterThan(5);
    }
  });
});

describe("matriz nível × etapa (exaustiva)", () => {
  it("toda etapa tem as 5 células e nenhuma etapa sobra", () => {
    expect(Object.keys(MATRIZ_RIGIDEZ).sort()).toEqual([...ETAPA_IDS].sort());
    for (const e of ETAPA_IDS) for (const n of NIVEIS_RIGIDEZ) expect(MATRIZ_RIGIDEZ[e][n], `${e} N${n}`).toBeDefined();
  });
  it("etapa de piso nunca é ○ nos níveis (onde ela se aplica)", () => {
    for (const e of ETAPAS.filter((x) => x.piso)) for (const n of NIVEIS_RIGIDEZ) expect(celaDe(e.id === "rapido.executar" ? "rapido" : "runx", e.id, n).modo, `${e.id} N${n}`).not.toBe("omitida");
  });
  it("humanas são H em todos os níveis; nenhuma etapa humana tem outra célula", () => {
    for (const e of ETAPAS.filter((x) => x.humano)) for (const n of NIVEIS_RIGIDEZ) expect(MATRIZ_RIGIDEZ[e.id][n].modo).toBe("humano");
  });
  it("o nível 4/5 nunca dispensa o que o nível 3 faz (monotonia do rigor)", () => {
    for (const e of ETAPA_IDS) {
      if (MATRIZ_RIGIDEZ[e][3].modo === "omitida" || MATRIZ_RIGIDEZ[e][3].modo === "substituida") continue;
      for (const n of [4, 5] as const) expect(["omitida", "substituida"], `${e} N${n}`).not.toContain(MATRIZ_RIGIDEZ[e][n].modo);
    }
  });
  it("só o nível 1 usa R (substituída pelo pipeline rápido) e só o 2 usa ⛓", () => {
    for (const e of ETAPA_IDS) for (const n of NIVEIS_RIGIDEZ) {
      const c = MATRIZ_RIGIDEZ[e][n];
      if (c.modo === "substituida") expect(n).toBe(1);
      if (c.agrupa === true) expect(n).toBe(2);
    }
  });
  it("só avaliadores têm 2 avaliações e só no nível 5", () => {
    for (const e of ETAPA_IDS) for (const n of NIVEIS_RIGIDEZ) {
      const c = MATRIZ_RIGIDEZ[e][n];
      if (c.avaliacoes !== undefined) {
        expect(n).toBe(5);
        expect(etapaDef(e)?.tipo).toBe("avaliador");
      }
    }
  });
  it("sobrescritas só citam etapas do catálogo e têm as 5 células", () => {
    for (const mapa of Object.values(SOBRESCRITAS_POR_PIPELINE)) for (const [e, linha] of Object.entries(mapa)) {
      expect(etapaDef(e)).not.toBeNull();
      expect(Object.keys(linha).sort()).toEqual(["1", "2", "3", "4", "5"]);
    }
  });
  it("snapshot da matriz (revisão humana obrigatória ao mudar)", () => {
    const linhas = ETAPA_IDS.map((e) => `${e.padEnd(22)} ${NIVEIS_RIGIDEZ.map((n) => SIMBOLO[MATRIZ_RIGIDEZ[e][n].modo] + (MATRIZ_RIGIDEZ[e][n].agrupa === true ? "⛓" : "")).join(" ")}`);
    expect(linhas.join("\n")).toMatchInlineSnapshot(`
      "memox.consultar        ○ ○ ● ● ◆
      prodx.p1               ● ● ● ● ●
      prodx.p0               ○ ○ ○ ○ ●
      prodx.p25              ○ ◐ ● ◆ ◆
      prodx.assinatura       H H H H H
      prodx.briefing         ● ● ● ● ●
      legadox.perfil         ● ● ● ● ●
      legadox.raio           ● ● ● ◆ ◆
      legadox.caracterizar   ○ ○ ● ● ●
      legadox.divida         ○ ○ ○ ● ●
      legadox.manual         ○ ○ ○ ● ●
      runx.e1                R ◐⛓ ● ◆ ◆
      runx.e2                R ◐⛓ ● ● ◆
      runx.e3                R ◐⛓ ● ◆ ◆
      runx.e4                ○ ◐ ● ◆ ◆
      runx.e5                ○ ○ ● ● ●
      sprintx.f1             R ◐⛓ ● ◆ ◆
      sprintx.f2             R ◐⛓ ● ◆ ◆
      sprintx.f3             R ◐⛓ ● ● ◆
      sprintx.f35            ○ ○ ○ ○ ●
      sprintx.f4             R ◐⛓ ● ● ●
      sprintx.f5             ○ ◐ ● ◆ ◆
      sprintx.f6             R ◐ ● ◆ ◆
      stackx.detectar        ● ● ● ● ●
      stackx.check           ○ ○ ○ ● ◆
      stackx.atualizar       ● ● ● ● ●
      designx.cartography    ● ● ● ● ●
      designx.audit          ○ ○ ○ ● ◆
      mergex.check           ○ ● ● ◆ ◆
      mergex.atencao         ○ ○ ● ◆ ◆
      mergex.qa              ○ ○ ● ● ●
      mergex.pr              ○ ● ● ● ●
      mergex.revisar         H H H H H
      buildx.condutor        ◐ ◐ ● ◆ ◆
      onboarding.executar    ● ● ● ● ●
      rapido.executar        ● ○ ○ ○ ○
      consulta.rag           ● ● ● ● ●"
    `);
  });
});

describe("parâmetros por nível (exaustivos)", () => {
  it("5 níveis, terminais 1/2/4/4/6, agrupamento só no 2, fechamento do trabalho a partir do 3", () => {
    expect(NIVEIS_RIGIDEZ.map((n) => PARAMETROS_POR_NIVEL[n].max_terminais)).toEqual([1, 2, 4, 4, 6]);
    expect(NIVEIS_RIGIDEZ.filter((n) => PARAMETROS_POR_NIVEL[n].agrupa_etapas)).toEqual([2]);
    expect(NIVEIS_RIGIDEZ.filter((n) => PARAMETROS_POR_NIVEL[n].fecha_trabalho)).toEqual([3, 4, 5]);
    expect(NIVEIS_RIGIDEZ.filter((n) => PARAMETROS_POR_NIVEL[n].reaproveita_terminal)).toEqual([2]);
  });
  it("densidade/forma (g4) e avaliador em outro provedor obrigatório nos níveis 4–5", () => {
    expect(NIVEIS_RIGIDEZ.map((n) => PARAMETROS_POR_NIVEL[n].densidade)).toEqual([null, "mvp", "padrao", "completo", "profundo"]);
    expect(NIVEIS_RIGIDEZ.map((n) => PARAMETROS_POR_NIVEL[n].forma)).toEqual([null, "autonomo", "entrevista", "entrevista", "entrevista"]);
    expect(NIVEIS_RIGIDEZ.map((n) => PARAMETROS_POR_NIVEL[n].avaliador_outro_provedor)).toEqual(["nao", "recomendado", "recomendado", "obrigatorio", "obrigatorio"]);
    expect(PARAMETROS_POR_NIVEL[1].pipeline_bug_feature).toBe("rapido");
    expect(NIVEIS_RIGIDEZ.map((n) => PARAMETROS_POR_NIVEL[n].qa_voltas_max)).toEqual([null, 1, 2, 3, 4]);
  });
});

describe("hooks por nível", () => {
  const nomes = new Set(HOOKS_DE_NASCIMENTO.map((h) => h.nome));
  const metodo = new Set(HOOKS_DE_NASCIMENTO.filter((h) => h.tipo === "metodo").map((h) => h.nome));
  it("todo nome existe em nucleo/metodo/hooks.ts e é do tipo método", () => {
    for (const g of [HOOKS_PISO, HOOKS_ESCOPO, HOOKS_PLANO, HOOKS_ENTREGA, HOOKS_QUALIDADE, HOOKS_LEGADOX]) for (const h of g) expect(metodo.has(h), h).toBe(true);
    for (const n of NIVEIS_RIGIDEZ) for (const h of Object.keys(HOOKS_POR_NIVEL[n])) expect(nomes.has(h), h).toBe(true);
  });
  it("SEGURANÇA cobre exatamente os hooks de segurança do método e nunca aparece em nenhum nível (I8)", () => {
    expect([...SEGURANCA].sort()).toEqual(HOOKS_DE_NASCIMENTO.filter((h) => h.tipo === "seguranca").map((h) => h.nome).sort());
    for (const n of NIVEIS_RIGIDEZ) for (const legado of [false, true]) for (const h of Object.keys(hooksDoNivel(n, { legado }))) expect(SEGURANCA as readonly string[]).not.toContain(h);
  });
  it("grupos disjuntos e todos os hooks de método estão em algum grupo", () => {
    const todos = [...HOOKS_PISO, ...HOOKS_ESCOPO, ...HOOKS_PLANO, ...HOOKS_ENTREGA, ...HOOKS_QUALIDADE];
    expect(new Set(todos).size).toBe(todos.length);
    expect([...metodo].sort()).toEqual([...todos].sort());
  });
  it("níveis (g5)", () => {
    expect(HOOKS_POR_NIVEL[3]).toEqual({});
    expect(HOOKS_POR_NIVEL[1]["task-so-fecha-verde"]).toBe("aviso");
    expect(HOOKS_POR_NIVEL[1]["escopo-da-task"]).toBe("desligado");
    expect(HOOKS_POR_NIVEL[2]["escopo-da-task"]).toBe("aviso");
    expect(HOOKS_POR_NIVEL[2]["uma-ocorrencia-por-arvore"]).toBe("desligado");
    expect(HOOKS_POR_NIVEL[2]["pr-so-com-portao"]).toBe("desligado");
    expect(HOOKS_POR_NIVEL[4]["task-so-fecha-verde"]).toBe("bloqueio");
    expect(HOOKS_POR_NIVEL[4]["escopo-da-ocorrencia"]).toBe("bloqueio");
    expect(HOOKS_POR_NIVEL[4]["task-reivindicada"]).toBe("aviso");
    expect(HOOKS_POR_NIVEL[4]["causa-antes-do-plano"]).toBe("bloqueio");
    expect(HOOKS_POR_NIVEL[4]["sem-colateral"]).toBe("aviso");
    expect(HOOKS_POR_NIVEL[4]["pr-so-com-portao"]).toBe("bloqueio");
    expect(HOOKS_POR_NIVEL[4]["commit-por-task"]).toBe("aviso");
    expect(HOOKS_POR_NIVEL[4]["tdd-teste-antes"]).toBe("bloqueio");
    expect(HOOKS_POR_NIVEL[4]["aderencia"]).toBe("aviso");
    expect(HOOKS_POR_NIVEL[5]["sem-colateral"]).toBe("bloqueio");
    expect(HOOKS_POR_NIVEL[5]["arquivo-fora-do-plano"]).toBe("bloqueio");
    expect(HOOKS_POR_NIVEL[5]["commit-por-task"]).toBe("aviso");
  });
  it("modo legado nos níveis 1–2 mantém o grupo do legadox em aviso", () => {
    for (const n of [1, 2] as const) {
      const m = hooksDoNivel(n, { legado: true });
      for (const h of HOOKS_LEGADOX) expect(m[h], `${h} N${n}`).toBe("aviso");
      expect(hooksDoNivel(n, { legado: false })["raio-antes-do-plano"]).toBe("desligado");
    }
    expect(hooksDoNivel(4, { legado: true })).toEqual(hooksDoNivel(4, { legado: false }));
  });
  it("só modos válidos", () => {
    for (const n of NIVEIS_RIGIDEZ) for (const m of Object.values(HOOKS_POR_NIVEL[n])) expect(["aviso", "bloqueio", "desligado"]).toContain(m);
  });
});
