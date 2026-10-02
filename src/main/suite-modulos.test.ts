// Módulos da suíte no main (D-480): padrões, semeadura, arquivo validado, escrita SÓ em `.expxv/`, fallback nos dados do app, cascata com confirmação e o deny do Claude.
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { EventoModulosMudou } from "../compartilhado/suite";
import { criarManifesto, compararManifestos } from "../nucleo/suite/manifesto";
import { serializarModulos, PADRAO_DE_FABRICA } from "../nucleo/suite/modulos";
import { ErroSuite } from "./suite";
import { ARQUIVO_MODULOS, CHAVE_PADRAO_GLOBAL, criarServicoModulos, type ServicoModulos } from "./suite-modulos";

const FIX = resolve(__dirname, "../../tests/fixtures/suite/projetos");
const base = realpathSync(mkdtempSync(join(tmpdir(), "suite-modulos-")));
const protegidas: string[] = [];
afterEach(() => { for (const p of protegidas.splice(0)) { try { chmodSync(p, 0o755); } catch { /* ok */ } } });
afterAll(() => { for (const p of readdirSync(base)) { try { chmodSync(join(base, p), 0o755); } catch { /* ok */ } } rmSync(base, { recursive: true, force: true }); });
let n = 0;
const WS = "ws_AAAAAAAAAAAA";

function montar(o: { projeto?: string; prefs?: Record<string, unknown>; gravar?: (raiz: string, rel: string, texto: string) => Promise<unknown> } = {}) {
  n += 1;
  const dir = join(base, `m${n}`);
  const raiz = join(dir, "proj");
  mkdirSync(dir, { recursive: true });
  cpSync(join(FIX, o.projeto ?? "completa"), raiz, { recursive: true });
  const prefs: Record<string, unknown> = { ...(o.prefs ?? {}) };
  const eventos: EventoModulosMudou[] = [];
  const bus: Array<{ tipo: string; payload: unknown }> = [];
  const s: ServicoModulos = criarServicoModulos({
    pastaDados: join(dir, "dados"), raizDe: (id) => (id === WS ? raiz : null),
    preferencias: { obter: (k) => prefs[k] ?? null, definir: async (k, v) => { prefs[k] = v; } },
    emitir: (e) => eventos.push(e), barramento: { emitir: (tipo, payload) => bus.push({ tipo, payload }) },
    ...(o.gravar === undefined ? {} : { gravarNoProjeto: o.gravar }),
  });
  return { s, raiz, dir, prefs, eventos, bus, arquivo: join(raiz, ARQUIVO_MODULOS) };
}

describe("padrões", () => {
  it("sem arquivo e sem preferência: tudo ligado, exceto o legadox; NADA é escrito até alguém mudar algo", async () => {
    const m = montar();
    const antes = await criarManifesto(m.raiz);
    const e = m.s.estado(WS);
    expect(e.origem).toBe("padrao");
    expect(e.desligados).toEqual(["legadox"]);
    expect(e.modulos.map((x) => x.id)).toEqual(["sprintx", "runx", "legadox", "stackx", "mergex", "memox", "prodx", "buildx", "designx"]);
    expect(e.modulos.find((x) => x.id === "legadox")).toMatchObject({ ligado: false, padrao_desligado: true });
    expect(e.modulos.find((x) => x.id === "buildx")).toMatchObject({ exige: [["sprintx"], ["prodx"], ["mergex"]], recomenda: [["stackx"]] });
    expect(e.arquivo).toBe(".expxv/modulos.json");
    expect(m.s.desligados(WS)).toEqual(new Set(["legadox"]));
    expect(compararManifestos(antes.mapa, (await criarManifesto(m.raiz)).mapa)).toEqual({ criados: [], alterados: [], removidos: [], fora_do_esperado: [] });
    expect(existsSync(m.arquivo)).toBe(false);
  });

  it("a preferência global muda o padrão dos projetos sem arquivo (e é normalizada)", () => {
    const m = montar({ prefs: { [CHAVE_PADRAO_GLOBAL]: { legadox: true, memox: false, lixo: 1 } } });
    expect(m.s.desligados(WS)).toEqual(new Set(["memox"]));
    expect(m.s.padrao().modulos["legadox"]).toBe(true);
    expect(m.s.padrao().fabrica["legadox"]).toBe(false);
  });

  it("workspace desconhecido: estado lança erro nominal; desligados é vazio (nunca lança)", () => {
    const m = montar();
    expect(() => m.s.estado("ws_BBBBBBBBBBBB")).toThrow(ErroSuite);
    expect(m.s.desligados("ws_BBBBBBBBBBBB")).toEqual(new Set());
    expect(m.s.denyDoClaude("ws_BBBBBBBBBBBB")).toEqual([]);
  });
});

describe("escrita só em .expxv/ e por ação explícita", () => {
  it("ligar o legadox cria .expxv/modulos.json (versionável, relativo) e mais nada; o lock e as skills não são tocados", async () => {
    const m = montar();
    const antes = await criarManifesto(m.raiz);
    const r = await m.s.definir(WS, "legadox", true, false);
    expect(r.ok && r.mudou).toEqual(["legadox"]);
    expect(readFileSync(m.arquivo, "utf8")).toBe(serializarModulos({ ...PADRAO_DE_FABRICA, legadox: true }));
    const dif = compararManifestos(antes.mapa, (await criarManifesto(m.raiz)).mapa);
    expect(dif.criados).toEqual([]); // `.expxv` fica fora das pastas que o manifesto percorre; o que importa: nada em .claude/.expx/.opencode
    expect(dif.alterados).toEqual([]);
    expect(dif.removidos).toEqual([]);
    expect(readdirSync(join(m.raiz, ".expxv")).sort()).toEqual([".gitignore", "modulos.json"]);
    expect(readFileSync(join(m.raiz, ".expxv", ".gitignore"), "utf8")).toBe("*\n!modulos.json\n");
    expect(m.s.estado(WS).origem).toBe("arquivo");
    expect(m.eventos).toEqual([{ workspace_id: WS }]);
    expect(m.bus.map((b) => b.tipo)).toEqual(["suite.modulos_mudou"]);
  });

  it("mudar para o que já é não grava nem avisa", async () => {
    const m = montar();
    const r = await m.s.definir(WS, "runx", true, false);
    expect(r).toMatchObject({ ok: true, mudou: [] });
    expect(existsSync(m.arquivo)).toBe(false);
    expect(m.eventos).toEqual([]);
  });

  it("desligar o sprintx pede confirmação (cascata), NADA muda sem ela; com confirmação desliga junto o buildx", async () => {
    const m = montar();
    const sem = await m.s.definir(WS, "sprintx", false, false);
    expect(sem).toMatchObject({ ok: false, precisa_confirmar: { tipo: "desligar_dependentes", modulos: ["buildx"] } });
    expect(existsSync(m.arquivo)).toBe(false);
    const com = await m.s.definir(WS, "sprintx", false, true);
    expect(com).toMatchObject({ ok: true, mudou: ["sprintx", "buildx"] });
    expect(m.s.desligados(WS)).toEqual(new Set(["legadox", "sprintx", "buildx"]));
  });

  it("ligar o buildx quando o prodx está desligado oferece ligar o requisito", async () => {
    const m = montar();
    await m.s.definir(WS, "buildx", false, false);
    await m.s.definir(WS, "prodx", false, false);
    const r = await m.s.definir(WS, "buildx", true, false);
    expect(r).toMatchObject({ ok: false, precisa_confirmar: { tipo: "ligar_requisitos", modulos: ["prodx"] } });
    const ok = await m.s.definir(WS, "buildx", true, true);
    expect(ok).toMatchObject({ ok: true });
    expect(m.s.desligados(WS)).toEqual(new Set(["legadox"]));
  });

  it("módulo desconhecido é recusado", async () => {
    const m = montar();
    await expect(m.s.definir(WS, "inventado", true, false)).rejects.toThrow(ErroSuite);
  });

  it("restaurar volta ao padrão global (e grava)", async () => {
    const m = montar({ prefs: { [CHAVE_PADRAO_GLOBAL]: { designx: false } } });
    await m.s.definir(WS, "legadox", true, false);
    const e = await m.s.restaurar(WS);
    expect(e.desligados).toEqual(["legadox", "designx"]);
    expect(JSON.parse(readFileSync(m.arquivo, "utf8")).modulos.designx).toBe(false);
  });

  it("fim da instalação semeia o arquivo com o padrão global, e só se não houver arquivo", async () => {
    const m = montar({ prefs: { [CHAVE_PADRAO_GLOBAL]: { memox: false } } });
    await m.s.semear(WS);
    expect(JSON.parse(readFileSync(m.arquivo, "utf8")).modulos.memox).toBe(false);
    writeFileSync(m.arquivo, serializarModulos({ ...PADRAO_DE_FABRICA, designx: false }));
    await m.s.semear(WS);
    expect(JSON.parse(readFileSync(m.arquivo, "utf8")).modulos.designx).toBe(false);
    expect(JSON.parse(readFileSync(m.arquivo, "utf8")).modulos.memox).toBe(true); // não foi sobrescrito
  });
});

describe("versionável de verdade (git real)", () => {
  it("depois de gravar, o git NÃO ignora .expxv/modulos.json (a pasta do produto continua ignorando o resto)", async () => {
    const m = montar();
    execFileSync("git", ["init", "-q"], { cwd: m.raiz });
    await m.s.definir(WS, "legadox", true, false);
    await m.s.definir(WS, "legadox", false, false); // regrava: o .gitignore não duplica a linha
    expect(readFileSync(join(m.raiz, ".expxv", ".gitignore"), "utf8")).toBe("*\n!modulos.json\n");
    const ignorado = (rel: string): boolean => { try { execFileSync("git", ["check-ignore", "-q", rel], { cwd: m.raiz }); return true; } catch { return false; } };
    expect(ignorado(".expxv/modulos.json")).toBe(false);
    expect(ignorado(".expxv/executar.json")).toBe(true);
  });
});

describe("arquivo inválido: nunca lança, vale o padrão, não sobrescreve em silêncio", () => {
  const ruins = ["{ quebrado", '{"versao":1,"modulos":{"sprintx":"sim"}}', '{"versao":9,"modulos":{}}', "[]", '{"versao":1,"modulos":{"inventado":true}}'];
  it.each(ruins)("%s → padrão + aviso", (texto) => {
    const m = montar();
    mkdirSync(join(m.raiz, ".expxv"), { recursive: true });
    writeFileSync(m.arquivo, texto);
    const e = m.s.estado(WS);
    expect(e.origem).toBe("padrao");
    expect(e.avisos.length).toBeGreaterThan(0);
    expect(e.desligados).toEqual(["legadox"]);
    expect(m.s.desligados(WS)).toEqual(new Set(["legadox"]));
  });

  it("ao primeiro ajuste o arquivo ruim é guardado como .invalido antes de ser substituído; o semear não toca nele", async () => {
    const m = montar();
    mkdirSync(join(m.raiz, ".expxv"), { recursive: true });
    writeFileSync(m.arquivo, "{ quebrado");
    await m.s.semear(WS);
    expect(readFileSync(m.arquivo, "utf8")).toBe("{ quebrado");
    await m.s.definir(WS, "legadox", true, false);
    expect(readFileSync(`${m.arquivo}.invalido`, "utf8")).toBe("{ quebrado");
    expect(JSON.parse(readFileSync(m.arquivo, "utf8")).modulos.legadox).toBe(true);
  });

  it("arquivo editado à mão com requisito quebrado vira aviso claro (módulo ligado sem o que exige)", () => {
    const m = montar();
    mkdirSync(join(m.raiz, ".expxv"), { recursive: true });
    writeFileSync(m.arquivo, serializarModulos({ ...PADRAO_DE_FABRICA, prodx: false }));
    const e = m.s.estado(WS);
    expect(e.avisos.join(" ")).toMatch(/buildx está ligado mas precisa de prodx/);
  });
});

describe("pasta sem permissão de escrita: fallback nos dados do app", () => {
  it("o projeto não aceita escrita: grava em <dados>/suite/modulos/<ws>.json e a leitura segue de lá", async () => {
    const m = montar({ gravar: async () => { throw new Error("EACCES"); } });
    await m.s.definir(WS, "legadox", true, false);
    expect(existsSync(m.arquivo)).toBe(false);
    const doApp = join(m.dir, "dados", "suite", "modulos", `${WS}.json`);
    expect(JSON.parse(readFileSync(doApp, "utf8")).modulos.legadox).toBe(true);
    expect(m.s.estado(WS).origem).toBe("app");
    expect(m.s.desligados(WS)).toEqual(new Set());
  });
});

describe("gate por Pane no Claude", () => {
  it("o deny cobre a skill e os subcomandos dos módulos desligados, nas duas formas (projeto e plugin); nada para quem está ligado", () => {
    const m = montar();
    const deny = m.s.denyDoClaude(WS);
    expect(deny).toEqual(expect.arrayContaining(["Skill(legadox)", "Skill(expx:legadox)", "Skill(legadox-raio)", "Skill(expx:legadox-perfil)"]));
    expect(deny.some((d) => /runx|sprintx|buildx/.test(d))).toBe(false);
    expect(deny.every((d) => /^Skill\([a-z:-]+\)$/.test(d))).toBe(true);
  });
  it("tudo ligado: sem regras", async () => {
    const m = montar({ prefs: { [CHAVE_PADRAO_GLOBAL]: { legadox: true } } });
    expect(m.s.denyDoClaude(WS)).toEqual([]);
  });
});

describe("padrão global (preferência)", () => {
  it("grava, normaliza e recusa combinação incoerente", async () => {
    const m = montar();
    const r = await m.s.definirPadrao({ ...PADRAO_DE_FABRICA, legadox: true });
    expect(r.modulos["legadox"]).toBe(true);
    expect(m.prefs[CHAVE_PADRAO_GLOBAL]).toMatchObject({ legadox: true });
    expect(m.eventos).toEqual([{ workspace_id: null }]);
    await expect(m.s.definirPadrao({ ...PADRAO_DE_FABRICA, prodx: false })).rejects.toThrow(/buildx/);
  });
});
