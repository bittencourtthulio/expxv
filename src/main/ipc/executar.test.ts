// Canais `executar:*` (D-430…): contrato fechado, validadores estritos, o renderer NUNCA envia cwd/caminho/URL, `origem` nunca vem de fora,
// sensibilidade do canal com comando e saneamento de erro. Sem Electron: o serviço é um espião.
import { describe, expect, it } from "vitest";
import { CANAIS_INVOKE, CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import { ErroExecutar, type ServicoExecutar } from "../executar";
import { VALIDADORES_EXECUTAR, registrarIpcExecutar, sanearErroExecutar } from "./executar";
import { canalSensivel, criarRegistroIpc, type IpcMainLike } from "./registro";

const WS = "ws_AAAAAAAAAAAA";
const HASH = "a".repeat(40);
// os canais `executar:assistente_*` (D-582…) têm contrato e teste próprios (executar-assistente-ipc.test.ts)
const canais = CANAIS_INVOKE.filter((c) => c.startsWith("executar:") && !c.startsWith("executar:assistente_"));

const CONFIG = {
  id: "dev", nome: "Rodar", tipo: "rodar", executavel: "npm", argumentos: ["run", "dev"], cwd: ".", ambiente: {}, pre_passos: [], porta: null, url: null,
  abrir_navegador: false, reiniciar_ao_salvar: false, grupo: null, shell: null,
};

function montar(falhaCom?: unknown) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const linhas: string[] = [];
  const registro = criarRegistroIpc({ ipcMain, autorizar: () => true, log: (l) => linhas.push(l), logarPayload: true });
  const chamadas: Array<{ metodo: string; args: unknown[] }> = [];
  const servico = new Proxy({}, {
    get: (_t, nome: string) => nome === "then" ? undefined : (...args: unknown[]) => {
      chamadas.push({ metodo: nome, args });
      if (falhaCom !== undefined) throw falhaCom;
      return nome === "parar" || nome === "abrirUrl" ? true : { ok: true };
    },
  }) as unknown as ServicoExecutar;
  registrarIpcExecutar({ registro, servico });
  const chamar = (canal: string, payload: unknown): Promise<unknown> => Promise.resolve((handlers.get(canal) as (e: unknown, p: unknown) => unknown)({}, payload));
  return { handlers, chamar, chamadas, linhas };
}

const VALIDOS: Record<string, unknown> = {
  "executar:listar": { workspace_id: WS },
  "executar:estado": { workspace_id: WS },
  "executar:iniciar": { workspace_id: WS, config_id: "dev", confirmar_hash: HASH },
  "executar:parar": { workspace_id: WS, config_id: "dev" },
  "executar:reiniciar": { workspace_id: WS },
  "executar:config_gravar": { workspace_id: WS, config: CONFIG, confirmou_shell: false },
  "executar:config_remover": { workspace_id: WS, config_id: "dev" },
  "executar:definir_padrao": { workspace_id: WS, config_id: "dev" },
  "executar:revogar_confianca": { workspace_id: WS },
  "executar:historico": { workspace_id: WS },
  "executar:abrir_url": { workspace_id: WS },
};

describe("canais executar:*", () => {
  it("o contrato tem exatamente estes 11 canais, todos com validador e manipulador", () => {
    expect([...canais].sort()).toEqual(Object.keys(VALIDOS).sort());
    expect(Object.keys(VALIDADORES_EXECUTAR).sort()).toEqual(Object.keys(VALIDOS).sort());
    expect([...montar().handlers.keys()].filter((c) => c.startsWith("executar:")).sort()).toEqual(Object.keys(VALIDOS).sort());
  });

  it.each(Object.entries(VALIDOS))("%s aceita o payload válido", (canal, payload) => {
    const r = (VALIDADORES_EXECUTAR as Record<string, (v: unknown) => { ok: boolean }>)[canal]!(payload);
    expect(r.ok).toBe(true);
  });

  it.each(Object.entries(VALIDOS))("%s recusa campo extra, workspace inválido e cwd/caminho/url do renderer", (canal, payload) => {
    const v = (VALIDADORES_EXECUTAR as Record<string, (v: unknown) => { ok: boolean }>)[canal]!;
    const p = payload as Record<string, unknown>;
    expect(v({ ...p, cwd: "/tmp" }).ok).toBe(false);
    expect(v({ ...p, caminho: "/bin/sh" }).ok).toBe(false);
    expect(v({ ...p, url: "http://localhost" }).ok).toBe(false);
    expect(v({ ...p, workspace_id: "../etc" }).ok).toBe(false);
    expect(v({ ...p, workspace_id: 1 }).ok).toBe(false);
    expect(v(null).ok).toBe(false);
    expect(v("x").ok).toBe(false);
    const { workspace_id: _w, ...sem } = p;
    void _w;
    expect(v(sem).ok).toBe(false);
  });

  it("hash de confirmação precisa ser sha hexadecimal de 40; id de configuração é slug", () => {
    const v = VALIDADORES_EXECUTAR["executar:iniciar"];
    for (const ruim of ["x", "A".repeat(40), "a".repeat(39), `${"a".repeat(39)}g`, "a".repeat(41)]) expect(v({ workspace_id: WS, confirmar_hash: ruim }).ok, ruim).toBe(false);
    for (const ruim of ["Dev", "../x", "a b", "-x", "", "x".repeat(41)]) expect(v({ workspace_id: WS, config_id: ruim }).ok, ruim).toBe(false);
  });

  it("config_gravar: a configuração é revalidada (executável absoluto, cwd com .., segredo no ambiente, shell com argumentos) e `origem` nunca vem de fora", () => {
    const v = VALIDADORES_EXECUTAR["executar:config_gravar"];
    const com = (o: Record<string, unknown>) => v({ workspace_id: WS, config: { ...CONFIG, ...o }, confirmou_shell: false });
    expect(com({}).ok).toBe(true);
    expect(com({ origem: "detectada" }).ok).toBe(false);
    expect(com({ executavel: "/usr/bin/curl" }).ok).toBe(false);
    expect(com({ executavel: "npm run dev" }).ok).toBe(false);
    expect(com({ cwd: "../fora" }).ok).toBe(false);
    expect(com({ ambiente: { API_KEY: "valor" } }).ok).toBe(false);
    expect(com({ ambiente: { API_KEY: "{{vault:X}}" } }).ok).toBe(true);
    expect(com({ shell: "a && b", argumentos: ["x"] }).ok).toBe(false);
    expect(com({ url: "http://exemplo.com" }).ok).toBe(false);
    expect(v({ workspace_id: WS, config: CONFIG }).ok).toBe(false); // sem confirmou_shell
    expect(v({ workspace_id: WS, config: CONFIG, confirmou_shell: "sim" }).ok).toBe(false);
    const r = com({});
    expect(r.ok && "origem" in (r as unknown as { valor: { config: object } }).valor.config).toBe(false);
  });

  it("só `executar:config_gravar` (comando e ambiente no payload) é sensível; o log nunca o imprime", async () => {
    expect(CANAIS_SENSIVEIS.filter((c) => c.startsWith("executar:") && !c.startsWith("executar:assistente_"))).toEqual(["executar:config_gravar"]);
    expect(canalSensivel("executar:config_gravar")).toBe(true);
    expect(canalSensivel("executar:iniciar")).toBe(false);
    const m = montar();
    await m.chamar("executar:config_gravar", { workspace_id: WS, config: { ...CONFIG, argumentos: ["--senha=hunter2"] }, confirmou_shell: false });
    await m.chamar("executar:iniciar", { workspace_id: WS });
    const tudo = m.linhas.join("\n");
    expect(tudo).not.toContain("hunter2");
    expect(tudo).toContain("executar:config_gravar");
  });

  it("delega ao serviço com os argumentos certos (e carimba origem=usuario)", async () => {
    const m = montar();
    await m.chamar("executar:iniciar", VALIDOS["executar:iniciar"]);
    await m.chamar("executar:parar", VALIDOS["executar:parar"]);
    await m.chamar("executar:reiniciar", VALIDOS["executar:reiniciar"]);
    await m.chamar("executar:config_gravar", VALIDOS["executar:config_gravar"]);
    await m.chamar("executar:config_remover", VALIDOS["executar:config_remover"]);
    await m.chamar("executar:definir_padrao", VALIDOS["executar:definir_padrao"]);
    await m.chamar("executar:revogar_confianca", VALIDOS["executar:revogar_confianca"]);
    await m.chamar("executar:abrir_url", VALIDOS["executar:abrir_url"]);
    expect(m.chamadas.map((c) => c.metodo)).toEqual(["iniciar", "parar", "reiniciar", "gravarConfig", "removerConfig", "definirPadrao", "revogarConfianca", "abrirUrl"]);
    expect(m.chamadas[0]!.args).toEqual([WS, { config_id: "dev", confirmar_hash: HASH }]);
    expect(m.chamadas[3]!.args[1]).toMatchObject({ id: "dev", origem: "usuario" });
    expect(m.chamadas[3]!.args[2]).toBe(false);
  });

  it("erro nominal atravessa; qualquer outro vira texto genérico (sem stack nem caminho de máquina)", async () => {
    await expect(montar(new ErroExecutar("Já há uma execução em andamento (Rodar).")).chamar("executar:iniciar", { workspace_id: WS })).rejects.toThrow("Já há uma execução em andamento (Rodar).");
    const e = await montar(new Error("ENOENT: /Users/fulano/segredo/arquivo")).chamar("executar:iniciar", { workspace_id: WS }).catch((x: unknown) => x as Error);
    expect((e as Error).message).toBe("Não foi possível concluir a ação de execução.");
    expect(sanearErroExecutar("texto").message).not.toContain("texto");
  });

  it("recusa remetente não autorizado antes do manipulador", async () => {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
    const registro = criarRegistroIpc({ ipcMain, autorizar: () => false });
    let chamado = false;
    registrarIpcExecutar({ registro, servico: new Proxy({}, { get: () => () => { chamado = true; return {}; } }) as unknown as ServicoExecutar });
    await expect(Promise.resolve(handlers.get("executar:iniciar")!({}, { workspace_id: WS }))).rejects.toThrow();
    expect(chamado).toBe(false);
  });
});
