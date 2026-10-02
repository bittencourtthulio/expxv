import { describe, expect, it, vi } from "vitest";
import { CANAIS_ENVIO, CANAIS_EVENTO, CANAIS_INVOKE, CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import { VALIDADORES_COFRE } from "./cofre";
import { CANAIS_HARNESS_ONDA_5, CANAIS_HARNESS_TROCA, VALIDADORES_HARNESS } from "./harness";
import { VALIDADORES_LIMITES } from "./limites";
import { VALIDADORES_OPENROUTER } from "./openrouter";
import { VALIDADORES_APP, registrarIpcApp } from "./app";
import { CanalRecusadoErro, canalSensivel, criarRegistroIpc } from "./registro";
import type { IpcMainLike } from "./registro";
import { vObjeto, vTexto } from "./validar";
import { criarMarcasPerf } from "../perf";
import type { Preferencias } from "../preferencias";

function ipcFalso() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ouvintes = new Map<string, (e: unknown, ...a: unknown[]) => void>();
  const ipc: IpcMainLike = {
    handle: (c, l) => void handlers.set(c, l),
    on: (c, l) => void ouvintes.set(c, l),
    removeHandler: (c) => void handlers.delete(c),
    removeAllListeners: (c) => void ouvintes.delete(c),
  };
  return { ipc, handlers, ouvintes };
}

describe("registro de IPC", () => {
  it("recusa payload inválido e remetente não autorizado ANTES do manipulador", async () => {
    const { ipc, handlers } = ipcFalso();
    let autorizado = true;
    const aoRecusar = vi.fn();
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => autorizado, aoRecusar });
    const manip = vi.fn(() => "ok");
    registro.invoke("app:config_ler", vObjeto({ chave: vTexto({ max: 5 }) }), manip as never);
    const h = handlers.get("app:config_ler")!;
    await expect(h({}, { chave: "abc" })).resolves.toBe("ok");
    await expect(h({}, { chave: "abcdefgh" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(h({}, { chave: "a", extra: 1 })).rejects.toBeInstanceOf(CanalRecusadoErro);
    autorizado = false;
    await expect(h({}, { chave: "abc" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    expect(manip).toHaveBeenCalledTimes(1);
    expect(aoRecusar).toHaveBeenCalledTimes(3);
  });

  it("canal fora do contrato ou duplicado não registra", () => {
    const { ipc } = ipcFalso();
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
    expect(() => registro.invoke("inexistente:canal" as never, vObjeto({}) as never, (() => 1) as never)).toThrow(/fora do contrato/);
    registro.invoke("app:perf", VALIDADORES_APP.perf, (() => ({ janelaVisivelMs: null, marcas: {} })) as never);
    expect(() => registro.invoke("app:perf", VALIDADORES_APP.perf, (() => ({}) as never) as never)).toThrow(/duplicado/);
  });

  it("canais de envio ignoram em silêncio payload inválido", () => {
    const { ipc, ouvintes } = ipcFalso();
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
    const manip = vi.fn();
    registro.envio("app:marca_perf", VALIDADORES_APP.marcaPerf, manip);
    ouvintes.get("app:marca_perf")!({}, { nome: "ok" });
    ouvintes.get("app:marca_perf")!({}, { nome: "ruim nome" });
    ouvintes.get("app:marca_perf")!({}, 42);
    expect(manip).toHaveBeenCalledTimes(1);
  });
});

describe("contrato: todo canal declarado tem validador e manipulador", () => {
  it("registrarIpcApp registra exatamente os canais do contrato", () => {
    const { ipc } = ipcFalso();
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
    const prefs: Preferencias = { lerSync: () => ({}), obter: () => null, definir: async () => undefined };
    registrarIpcApp({
      registro,
      versao: "0.0.0",
      preferencias: prefs,
      marcas: criarMarcasPerf(Date.now()),
      sistemaEscuro: () => true,
      aoMudarTema: () => undefined,
    });
    const doApp = [...CANAIS_INVOKE, ...CANAIS_ENVIO].filter((c) => c.startsWith("app:")).sort();
    expect(registro.registrados()).toEqual(doApp);
  });
});

describe("handlers app:*", () => {
  function montar() {
    const { ipc, handlers } = ipcFalso();
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
    const guardado = new Map<string, unknown>();
    const prefs: Preferencias = {
      lerSync: () => Object.fromEntries(guardado),
      obter: (c) => guardado.get(c) ?? null,
      definir: async (c, v) => void guardado.set(c, v),
    };
    const aoMudarTema = vi.fn();
    let escuro = true;
    registrarIpcApp({
      registro,
      versao: "9.9.9",
      preferencias: prefs,
      marcas: criarMarcasPerf(Date.now()),
      sistemaEscuro: () => escuro,
      aoMudarTema,
    });
    return { handlers, aoMudarTema, guardado, setEscuro: (v: boolean) => (escuro = v) };
  }

  it("tema: padrão segue o sistema; definir persiste, resolve e avisa", async () => {
    const { handlers, aoMudarTema, setEscuro } = montar();
    expect(await handlers.get("app:tema_ler")!({})).toEqual({ preferencia: "sistema", efetivo: "escuro" });
    setEscuro(false);
    expect(await handlers.get("app:tema_ler")!({})).toEqual({ preferencia: "sistema", efetivo: "claro" });
    const r = await handlers.get("app:tema_definir")!({}, { preferencia: "escuro" });
    expect(r).toEqual({ preferencia: "escuro", efetivo: "escuro" });
    expect(aoMudarTema).toHaveBeenCalledWith({ preferencia: "escuro", efetivo: "escuro" });
  });

  it("config: grava e lê; chaves reservadas são recusadas", async () => {
    const { handlers } = montar();
    await handlers.get("app:config_gravar")!({}, { chave: "scrollback", valor: 5000 });
    expect(await handlers.get("app:config_ler")!({}, { chave: "scrollback" })).toBe(5000);
    await expect(handlers.get("app:config_gravar")!({}, { chave: "tema_preferencia", valor: "x" })).rejects.toThrow(/reservada/);
    await expect(handlers.get("app:config_gravar")!({}, { chave: "Invalida!", valor: 1 })).rejects.toBeInstanceOf(CanalRecusadoErro);
  });

  it("versão e perf respondem", async () => {
    const { handlers } = montar();
    expect(await handlers.get("app:versao")!({})).toBe("9.9.9");
    expect(await handlers.get("app:perf")!({})).toMatchObject({ janelaVisivelMs: null });
  });
});

// ---- Fase 9 (T-09.01): contrato das famílias limites/harness/cofre/openrouter ----
const FAMILIAS_FASE_9 = /^(limites|harness|cofre|provedores:openrouter_)/;
const VALIDADORES_FASE_9: Record<string, unknown> = {
  ...VALIDADORES_LIMITES,
  ...VALIDADORES_HARNESS,
  ...VALIDADORES_COFRE,
  ...VALIDADORES_OPENROUTER,
};
/**
 * Canais do contrato que JÁ têm validador estrito mas ainda NÃO têm manipulador, com a task que o implementa.
 * Cada onda remove daqui os canais que passar a registrar (o teste abaixo falha se a lista mentir).
 */
export const CANAIS_SEM_MANIPULADOR_AINDA: Readonly<Record<string, string>> = {
  "limites:historico": "T-09.09",
  "limites:previsao": "T-09.09",
  "limites:eficiencia": "T-09.09",
  "limites:alertas": "T-09.09",
};
/**
 * Canais da Fase 9 que já ganharam manipulador registrado: limites (T-09.08, via `ligarLimites` no main); cofre (T-09.21/23, `registrarIpcCofre`)
 * e harness (T-09.14/15/24/25, `registrarIpcHarness`: política, equivalência, decisões, decisor, intenção e perfil) e OpenRouter (T-09.26,
 * `registrarIpcOpenRouter`); os de troca (T-09.20) entram em `CANAIS_HARNESS_TROCA`.
 */
const CANAIS_FASE_9_COM_MANIPULADOR: readonly string[] = [
  "limites:snapshot",
  "limites:atualizar",
  "limites:manual_definir",
  "limites:manual_limpar",
  ...CANAIS_HARNESS_ONDA_5,
  ...CANAIS_HARNESS_TROCA,
  "cofre:disponivel",
  "cofre:listar",
  "cofre:gravar",
  "cofre:apagar",
  "cofre:senha_mestra_definir",
  "cofre:desbloquear",
  "cofre:bloquear",
  ...Object.keys(VALIDADORES_OPENROUTER),
];

describe("contrato Fase 9: todo canal tem validador estrito", () => {
  const doContrato = [...CANAIS_INVOKE, ...CANAIS_ENVIO].filter((c) => FAMILIAS_FASE_9.test(c)).sort();

  it("cada canal do contrato das novas famílias tem validador, e nenhum validador é órfão", () => {
    expect(Object.keys(VALIDADORES_FASE_9).sort()).toEqual(doContrato);
    for (const canal of doContrato) expect(typeof VALIDADORES_FASE_9[canal], canal).toBe("function");
  });

  it("canal sem manipulador está na lista explícita com a fase que o implementa; a lista não mente", () => {
    for (const [canal, fase] of Object.entries(CANAIS_SEM_MANIPULADOR_AINDA)) {
      expect(doContrato, canal).toContain(canal);
      expect(fase, canal).toMatch(/^T-09\.\d{2}$/);
      expect(CANAIS_FASE_9_COM_MANIPULADOR, canal).not.toContain(canal);
    }
    const cobertos = new Set([...Object.keys(CANAIS_SEM_MANIPULADOR_AINDA), ...CANAIS_FASE_9_COM_MANIPULADOR]);
    expect([...cobertos].sort()).toEqual(doContrato);
  });

  it("eventos novos e canais sensíveis estão no contrato", () => {
    expect(CANAIS_EVENTO).toEqual(expect.arrayContaining(["limites:evento", "harness:evento"]));
    for (const c of CANAIS_SENSIVEIS) expect(CANAIS_INVOKE).toContain(c);
    expect([...CANAIS_SENSIVEIS].sort()).toEqual(
      ["bench:julgar", "bench:rerodar", "bench:rodar", "cofre:desbloquear", "cofre:gravar", "cofre:senha_mestra_definir", "executar:assistente_salvar", "executar:config_gravar", "harness:decisor_testar", "jarvis:acao", "jarvis:enviar", "loja_mcp:variavel_gravar", "provedores:openrouter_chave_gravar", "provedores:openrouter_testar", "rag:backend_configurar", "rag:backend_testar", "relay:parear_iniciar", "relay:parear_sas", "remoto:parear_confirmar_sas", "remoto:permissao_definir", "telegram:autorizado_config", "telegram:token_salvar", "telegram:token_testar", "voz:segredo_gravar"].sort(),
    );
  });
});

describe("canais sensíveis: o log do registro NUNCA imprime o payload (sentinela)", () => {
  const SENTINELA = "SENTINELA-SEGREDO-9f3a7c1d";

  function montar(logarPayload: boolean) {
    const { ipc, handlers } = ipcFalso();
    const linhas: string[] = [];
    const recusas: string[] = [];
    const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true, log: (l) => linhas.push(l), logarPayload, aoRecusar: (c, m) => recusas.push(`${c}:${m}`) });
    return { registro, handlers, linhas, recusas };
  }

  it("payload válido e inválido de canal sensível não vazam, mesmo com logarPayload ligado", async () => {
    const { registro, handlers, linhas, recusas } = montar(true);
    registro.invoke("cofre:gravar", VALIDADORES_COFRE["cofre:gravar"], (() => ({})) as never);
    const h = handlers.get("cofre:gravar")!;
    const base = { id: null, nome: "MINHA_CHAVE", escopo: "global", workspace_id: null, sensivel: true, valor: SENTINELA };
    await h({}, base);
    await expect(h({}, { ...base, [SENTINELA]: 1 })).rejects.toBeInstanceOf(CanalRecusadoErro); // nome de campo com segredo
    await expect(h({}, { ...base, nome: SENTINELA })).rejects.toBeInstanceOf(CanalRecusadoErro);
    const erro: unknown = await (h({}, { ...base, extra: SENTINELA }) as Promise<unknown>).catch((e: unknown) => e);
    expect((erro as Error).message).not.toContain(SENTINELA);
    expect(linhas.length).toBe(4);
    expect(linhas.join("\n")).not.toContain(SENTINELA);
    expect(linhas.join("\n")).not.toContain("MINHA_CHAVE");
    expect(recusas.join("\n")).not.toContain(SENTINELA);
    expect(linhas[0]).toContain("cofre:gravar ok");
    expect(linhas[0]).toContain("payload omitido");
  });

  it("todos os canais sensíveis do contrato são tratados como sensíveis pelo registro", () => {
    for (const c of CANAIS_SENSIVEIS) expect(canalSensivel(c), c).toBe(true);
    expect(canalSensivel("app:perf")).toBe(false);
    expect(canalSensivel("harness:decisor_gravar")).toBe(false);
  });

  it("canal comum só loga payload quando logarPayload está ligado (padrão: nunca)", async () => {
    const off = montar(false);
    off.registro.invoke("app:config_ler", vObjeto({ chave: vTexto({ max: 40 }) }), (() => 1) as never);
    await off.handlers.get("app:config_ler")!({}, { chave: "visivel" });
    expect(off.linhas[0]).toBe("ipc app:config_ler ok");
    const on = montar(true);
    on.registro.invoke("app:config_ler", vObjeto({ chave: vTexto({ max: 40 }) }), (() => 1) as never);
    await on.handlers.get("app:config_ler")!({}, { chave: "visivel" });
    expect(on.linhas[0]).toContain("visivel");
  });
});
