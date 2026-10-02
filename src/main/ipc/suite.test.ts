// Canais `suite:*` (D-470…): contrato fechado, validadores estritos (nenhum caminho/versão/registro vindo do renderer), saneamento de erro e autorização.
import { describe, expect, it } from "vitest";
import { CANAIS_EVENTO, CANAIS_INVOKE } from "../../compartilhado/ipc";
import { ErroSuite, type ServicoSuite } from "../suite";
import type { ServicoModulos } from "../suite-modulos";
import { VALIDADORES_SUITE, registrarIpcSuite, sanearErroSuite } from "./suite";
import { criarRegistroIpc, type IpcMainLike } from "./registro";

const WS = "ws_AAAAAAAAAAAA";
const canais = CANAIS_INVOKE.filter((c) => c.startsWith("suite:"));
const NOVE = { sprintx: true, runx: true, legadox: false, stackx: true, mergex: true, memox: true, prodx: true, buildx: true, designx: true };
/** canais que levam `workspace_id` */
const VALIDOS: Record<string, unknown> = {
  "suite:estado": { workspace_id: WS },
  "suite:requisitos": { workspace_id: WS },
  "suite:instalar": { workspace_id: WS, modo: "instalar" },
  "suite:cancelar": { workspace_id: WS },
  "suite:dispensar": { workspace_id: WS, dispensar: true },
  "suite:modulos_estado": { workspace_id: WS },
  "suite:modulos_definir": { workspace_id: WS, modulo: "legadox", ligado: true, confirmar_cascata: false },
  "suite:modulos_restaurar": { workspace_id: WS },
};
/** canais globais (sem workspace) */
const GLOBAIS: Record<string, unknown> = {
  "suite:modulos_padrao": {},
  "suite:modulos_padrao_definir": { modulos: NOVE },
};
const TODOS: Record<string, unknown> = { ...VALIDOS, ...GLOBAIS };

function montar(falhaCom?: unknown, autorizar = true) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain, autorizar: () => autorizar });
  const chamadas: Array<{ metodo: string; args: unknown[] }> = [];
  const servico = new Proxy({}, {
    get: (_t, nome: string) => nome === "then" ? undefined : (...args: unknown[]) => {
      chamadas.push({ metodo: nome, args });
      if (falhaCom !== undefined) throw falhaCom;
      return nome === "cancelar" ? true : { instalacao_id: "suite_x" };
    },
  }) as unknown as ServicoSuite;
  const modulos = new Proxy({}, {
    get: (_t, nome: string) => nome === "then" ? undefined : (...args: unknown[]) => { chamadas.push({ metodo: `modulos.${nome}`, args }); if (falhaCom !== undefined) throw falhaCom; return { ok: true }; },
  }) as unknown as ServicoModulos;
  registrarIpcSuite({ registro, servico, modulos });
  const chamar = (canal: string, payload: unknown): Promise<unknown> => Promise.resolve((handlers.get(canal) as (e: unknown, p: unknown) => unknown)({}, payload));
  return { handlers, chamar, chamadas };
}

describe("canais suite:*", () => {
  it("o contrato tem exatamente 10 canais de invoke e os eventos suite:progresso e suite:modulos_mudou, todos com validador e manipulador", () => {
    expect([...canais].sort()).toEqual(Object.keys(TODOS).sort());
    expect(Object.keys(VALIDADORES_SUITE).sort()).toEqual(Object.keys(TODOS).sort());
    expect([...montar().handlers.keys()].filter((c) => c.startsWith("suite:")).sort()).toEqual(Object.keys(TODOS).sort());
    expect(CANAIS_EVENTO).toContain("suite:progresso");
    expect(CANAIS_EVENTO).toContain("suite:modulos_mudou");
  });

  it.each(Object.entries(TODOS))("%s aceita o payload válido", (canal, payload) => {
    expect((VALIDADORES_SUITE as Record<string, (v: unknown) => { ok: boolean }>)[canal]!(payload).ok).toBe(true);
  });

  it.each(Object.entries(VALIDOS))("%s recusa campo extra (caminho, versão, registro, args), workspace inválido e payload torto", (canal, payload) => {
    const v = (VALIDADORES_SUITE as Record<string, (v: unknown) => { ok: boolean }>)[canal]!;
    const p = payload as Record<string, unknown>;
    for (const extra of [{ cwd: "/tmp" }, { caminho: "/etc" }, { raiz: "/x" }, { versao: "latest" }, { registro: "https://x" }, { argumentos: ["--x"] }, { comando: "rm -rf /" }]) expect(v({ ...p, ...extra }).ok, JSON.stringify(extra)).toBe(false);
    expect(v({ ...p, workspace_id: "../etc" }).ok).toBe(false);
    expect(v({ ...p, workspace_id: 1 }).ok).toBe(false);
    expect(v(null).ok).toBe(false);
    expect(v("x").ok).toBe(false);
    const { workspace_id: _w, ...sem } = p;
    void _w;
    expect(v(sem).ok).toBe(false);
  });

  it("módulos: nome na lista fechada dos nove, booleanos estritos, nenhum caminho; padrão global com exatamente os nove", () => {
    const v = VALIDADORES_SUITE["suite:modulos_definir"];
    for (const ok of ["sprintx", "runx", "legadox", "stackx", "mergex", "memox", "prodx", "buildx", "designx"]) expect(v({ workspace_id: WS, modulo: ok, ligado: false, confirmar_cascata: true }).ok, ok).toBe(true);
    for (const ruim of ["", "onboarding", "../x", "Legadox", "legadox ", 1, null]) expect(v({ workspace_id: WS, modulo: ruim, ligado: true, confirmar_cascata: false }).ok, String(ruim)).toBe(false);
    expect(v({ workspace_id: WS, modulo: "runx", ligado: "sim", confirmar_cascata: false }).ok).toBe(false);
    expect(v({ workspace_id: WS, modulo: "runx", ligado: true }).ok).toBe(false);
    const p = VALIDADORES_SUITE["suite:modulos_padrao_definir"];
    expect(p({ modulos: NOVE }).ok).toBe(true);
    const { designx: _d, ...faltando } = NOVE;
    void _d;
    for (const ruim of [{ modulos: faltando }, { modulos: { ...NOVE, extra: true } }, { modulos: { ...NOVE, runx: "sim" } }, { modulos: [] }, { modulos: NOVE, extra: 1 }, {}, null, { modulos: { ...NOVE, __proto__: { x: 1 } }, x: 1 }]) expect(p(ruim).ok, JSON.stringify(ruim)).toBe(false);
    expect(VALIDADORES_SUITE["suite:modulos_padrao"]({ qualquer: 1 }).ok).toBe(false);
  });

  it("modo é lista fechada; dispensar é booleano", () => {
    const v = VALIDADORES_SUITE["suite:instalar"];
    for (const ok of ["instalar", "reparar", "atualizar"]) expect(v({ workspace_id: WS, modo: ok }).ok).toBe(true);
    for (const ruim of ["", "remover", "INSTALAR", "instalar; rm", 1, null]) expect(v({ workspace_id: WS, modo: ruim }).ok, String(ruim)).toBe(false);
    expect(VALIDADORES_SUITE["suite:dispensar"]({ workspace_id: WS, dispensar: "sim" }).ok).toBe(false);
  });

  it("delega ao serviço com os argumentos certos", async () => {
    const m = montar();
    for (const [c, p] of Object.entries(TODOS)) await m.chamar(c, p);
    expect(m.chamadas.map((c) => c.metodo)).toEqual(["estado", "requisitos", "instalar", "cancelar", "dispensar", "modulos.estado", "modulos.definir", "modulos.restaurar", "modulos.padrao", "modulos.definirPadrao"]);
    expect(m.chamadas[2]!.args).toEqual([WS, "instalar"]);
    expect(m.chamadas[4]!.args).toEqual([WS, true]);
  });

  it("erro nominal atravessa; qualquer outro vira texto genérico", async () => {
    await expect(montar(new ErroSuite("Já há uma instalação em andamento neste projeto.")).chamar("suite:instalar", VALIDOS["suite:instalar"])).rejects.toThrow("Já há uma instalação");
    const e = await montar(new Error("ENOENT /Users/fulano/x")).chamar("suite:estado", { workspace_id: WS }).catch((x: unknown) => x as Error);
    expect((e as Error).message).toBe("Não foi possível concluir a ação da suíte ExpxDev.");
    expect(sanearErroSuite("texto").message).not.toContain("texto");
  });

  it("recusa remetente não autorizado antes do manipulador", async () => {
    const m = montar(undefined, false);
    await expect(m.chamar("suite:instalar", VALIDOS["suite:instalar"])).rejects.toThrow();
    expect(m.chamadas).toEqual([]);
  });
});
