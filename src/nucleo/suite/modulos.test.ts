import { describe, expect, it } from "vitest";
import {
  MODULOS, PADRAO_DE_FABRICA, avisosDoEstado, bloquearComandoDeModuloDesligado, cascataAoDesligar, dependentesDe, desligadosDe, lerArquivoModulos, moduloDaSkill, moduloDoComando, modulosQuebrados,
  mudarModulo, normalizarPadraoGlobal, requisitosAoLigar, serializarModulos, type EstadoModulos, type ModuloId,
} from "./modulos";

const todos = (v: boolean): Record<ModuloId, boolean> => Object.fromEntries(MODULOS.map((m) => [m, v])) as Record<ModuloId, boolean>;
const com = (o: Partial<Record<ModuloId, boolean>>, base: EstadoModulos = PADRAO_DE_FABRICA): EstadoModulos => ({ ...base, ...o });

describe("padrões", () => {
  it("todos ligados, EXCETO o legadox (a maioria dos projetos não é legado)", () => {
    expect(desligadosDe(PADRAO_DE_FABRICA)).toEqual(["legadox"]);
    expect(PADRAO_DE_FABRICA.sprintx && PADRAO_DE_FABRICA.runx && PADRAO_DE_FABRICA.buildx).toBe(true);
    expect(modulosQuebrados(PADRAO_DE_FABRICA)).toEqual([]);
  });
  it("o padrão global é normalizado: lixo vira o de fábrica; o que o usuário escolheu (legadox ligado) vale", () => {
    expect(normalizarPadraoGlobal(null)).toEqual(PADRAO_DE_FABRICA);
    expect(normalizarPadraoGlobal("x")).toEqual(PADRAO_DE_FABRICA);
    expect(normalizarPadraoGlobal({ legadox: true, memox: false, inventado: false, runx: "sim" })).toEqual(com({ legadox: true, memox: false }));
    expect(normalizarPadraoGlobal([])).toEqual(PADRAO_DE_FABRICA);
  });
});

describe("arquivo .expxv/modulos.json (validação estrita, nunca lança)", () => {
  const valido = serializarModulos(com({ legadox: true, designx: false }));
  it("o que o app grava volta igual; texto estável com os nove, na ordem do catálogo", () => {
    const r = lerArquivoModulos(valido);
    expect(r).toEqual({ valido: true, estado: com({ legadox: true, designx: false }) });
    expect(Object.keys(JSON.parse(valido).modulos)).toEqual([...MODULOS]);
    expect(valido.endsWith("\n")).toBe(true);
    expect(lerArquivoModulos(null)).toBeNull();
  });
  it.each([
    ["JSON quebrado", "{ nao json"],
    ["não é objeto", "[1,2]"],
    ["número", "42"],
    ["versão diferente", JSON.stringify({ versao: 2, modulos: todos(true) })],
    ["campo extra no topo", JSON.stringify({ versao: 1, modulos: todos(true), extra: 1 })],
    ["sem 'modulos'", JSON.stringify({ versao: 1 })],
    ["módulo desconhecido", JSON.stringify({ versao: 1, modulos: { ...todos(true), inventado: true } })],
    ["módulo faltando", JSON.stringify({ versao: 1, modulos: Object.fromEntries(MODULOS.slice(1).map((m) => [m, true])) })],
    ["valor não booleano", JSON.stringify({ versao: 1, modulos: { ...todos(true), runx: "sim" } })],
    ["modulos é lista", JSON.stringify({ versao: 1, modulos: [] })],
    ["__proto__ malicioso", '{"versao":1,"modulos":{"__proto__":{"sprintx":false}}}'],
  ])("%s → inválido com aviso (vale o padrão)", (_n, texto) => {
    const r = lerArquivoModulos(texto);
    expect(r?.valido).toBe(false);
    expect(r !== null && !r.valido && r.aviso.length > 10).toBe(true);
  });
});

describe("dependências entre módulos (derivadas do que as skills declaram)", () => {
  it("quem exige o sprintx: as camadas e o buildx; o runx também aceita as camadas", () => {
    expect(dependentesDe("sprintx")).toEqual(["legadox", "stackx", "memox", "prodx", "buildx", "designx"]);
    expect(dependentesDe("prodx")).toEqual(["buildx"]);
    expect(dependentesDe("mergex")).toEqual(["buildx"]);
    expect(dependentesDe("legadox")).toEqual([]);
  });

  const TABELA_DESLIGAR: ReadonlyArray<[string, EstadoModulos, ModuloId, ModuloId[]]> = [
    ["desligar o runx sozinho não quebra ninguém (as camadas aceitam sprintx OU runx)", PADRAO_DE_FABRICA, "runx", []],
    ["desligar o legadox não quebra ninguém", com({ legadox: true }), "legadox", []],
    ["desligar o sprintx quebra o buildx (exige sprintx)", PADRAO_DE_FABRICA, "sprintx", ["buildx"]],
    ["desligar o prodx quebra o buildx", PADRAO_DE_FABRICA, "prodx", ["buildx"]],
    ["desligar o mergex quebra o buildx", PADRAO_DE_FABRICA, "mergex", ["buildx"]],
    ["sem o runx, desligar o sprintx quebra as camadas ligadas e o buildx, em cascata", com({ runx: false }), "sprintx", ["stackx", "memox", "prodx", "buildx", "designx"]],
  ];
  it.each(TABELA_DESLIGAR)("%s", (_n, e, m, cascata) => {
    expect(cascataAoDesligar(e, m)).toEqual(cascata);
    const r = mudarModulo(e, m, false);
    if (cascata.length === 0) expect(r).toEqual({ ok: true, estado: { ...e, [m]: false }, mudou: [m] });
    else expect(r).toEqual({ ok: false, precisa_confirmar: { tipo: "desligar_dependentes", modulos: cascata } });
  });

  it("NUNCA desliga em cascata sem confirmação; com confirmação desliga o módulo e os dependentes, e o estado fica coerente", () => {
    const sem = mudarModulo(PADRAO_DE_FABRICA, "sprintx", false);
    expect(sem.ok).toBe(false);
    const com2 = mudarModulo(PADRAO_DE_FABRICA, "sprintx", false, true);
    expect(com2.ok).toBe(true);
    if (!com2.ok) return;
    expect(com2.mudou).toEqual(["sprintx", "buildx"]);
    expect(com2.estado.sprintx || com2.estado.buildx).toBe(false);
    expect(modulosQuebrados(com2.estado)).toEqual([]);
  });

  const TABELA_LIGAR: ReadonlyArray<[string, EstadoModulos, ModuloId, ModuloId[]]> = [
    ["ligar o legadox com a base ligada: sem requisitos", PADRAO_DE_FABRICA, "legadox", []],
    ["ligar o buildx com o prodx desligado pede o prodx", com({ prodx: false, buildx: false }), "buildx", ["prodx"]],
    ["ligar o legadox sem sprintx nem runx pede o sprintx (primeiro do grupo)", com({ sprintx: false, runx: false, buildx: false, stackx: false, memox: false, prodx: false, designx: false }), "legadox", ["sprintx"]],
    ["ligar o buildx com tudo desligado pede sprintx, mergex e prodx", todos(false) as EstadoModulos, "buildx", ["sprintx", "mergex", "prodx"]],
  ];
  it.each(TABELA_LIGAR)("%s", (_n, e, m, reqs) => {
    expect(requisitosAoLigar(e, m)).toEqual(reqs);
  });

  it("ligar um módulo que exige outro desligado oferece ligar o requisito; com confirmação liga junto", () => {
    const e = todos(false) as EstadoModulos;
    const r = mudarModulo(e, "buildx", true);
    expect(r).toEqual({ ok: false, precisa_confirmar: { tipo: "ligar_requisitos", modulos: ["sprintx", "mergex", "prodx"] } });
    const ok = mudarModulo(e, "buildx", true, true);
    expect(ok.ok && ok.estado.buildx && ok.estado.sprintx && ok.estado.prodx && ok.estado.mergex).toBe(true);
    expect(ok.ok && modulosQuebrados(ok.estado)).toEqual([]);
  });

  it("mudar para o que já é não faz nada", () => {
    expect(mudarModulo(PADRAO_DE_FABRICA, "runx", true)).toEqual({ ok: true, estado: PADRAO_DE_FABRICA, mudou: [] });
  });

  it("avisos: requisito duro quebrado (arquivo editado à mão) e recomendação (stackx para o buildx)", () => {
    expect(avisosDoEstado(PADRAO_DE_FABRICA)).toEqual([]);
    const quebrado = com({ prodx: false });
    expect(avisosDoEstado(quebrado)).toEqual([{ modulo: "buildx", tipo: "exige", faltando: [["prodx"]] }]);
    expect(avisosDoEstado(com({ stackx: false }))).toEqual([{ modulo: "buildx", tipo: "recomenda", faltando: [["stackx"]] }]);
    expect(modulosQuebrados(quebrado)).toEqual(["buildx"]);
  });
});

describe("skill e comando → módulo; comando de módulo desligado é bloqueado", () => {
  it("mapeia pelo prefixo; comandos fixos do plugin não têm módulo", () => {
    expect(moduloDaSkill("sprintx-auditoria")).toBe("sprintx");
    expect(moduloDaSkill("buildx-retomar")).toBe("buildx");
    expect(moduloDaSkill("legadox")).toBe("legadox");
    expect(moduloDaSkill("onboarding")).toBeNull();
    expect(moduloDaSkill("mergex-revisar")).toBe("mergex");
    expect(moduloDoComando("/expx:runx-causa checkout falha")).toBe("runx");
    expect(moduloDoComando("/runx-causa x")).toBe("runx");
    expect(moduloDoComando("  /expx:legadox-raio T-1")).toBe("legadox");
    expect(moduloDoComando("npm test")).toBeNull();
    expect(moduloDoComando("/expx:onboarding .")).toBeNull();
  });
  it("módulo desligado: comando some e o motivo diz como ligar; outros comandos passam intactos", () => {
    const off = new Set<string>(["legadox"]);
    const bloq = bloquearComandoDeModuloDesligado({ comando: "/expx:legadox-raio T-1", motivo_bloqueio: null, extra: 1 }, off);
    expect(bloq).toMatchObject({ comando: "", extra: 1 });
    expect(bloq.motivo_bloqueio).toMatch(/legadox está desligado.*Módulos da suíte/);
    const ok = { comando: "/expx:runx-causa x", motivo_bloqueio: null };
    expect(bloquearComandoDeModuloDesligado(ok, off)).toBe(ok);
    const vazio = { comando: "", motivo_bloqueio: "Falta o argumento" };
    expect(bloquearComandoDeModuloDesligado(vazio, off)).toBe(vazio);
    expect(bloquearComandoDeModuloDesligado({ comando: "/expx:legadox-raio T-1", motivo_bloqueio: null }, new Set())).toMatchObject({ comando: "/expx:legadox-raio T-1" });
  });
});
