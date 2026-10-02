import { describe, expect, it } from "vitest";
import { CANAIS_EVENTO, CANAIS_INVOKE, CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import { CANAIS_RELAY, CANAIS_RELAY_SENSIVEIS } from "../../compartilhado/relay";
import { VALIDADORES_RELAY, registrarIpcRelay } from "./relay";
import { criarRegistroIpc } from "./registro";

const canais = Object.keys(VALIDADORES_RELAY);
const v = (c: keyof typeof VALIDADORES_RELAY, x: unknown) => (VALIDADORES_RELAY[c] as (x: unknown) => { ok: boolean })(x).ok;

describe("canais relay:* (contrato)", () => {
  it("todo canal do contrato tem validador e todo validador está no contrato; o evento é do contrato de eventos", () => {
    const noContrato = (CANAIS_INVOKE as readonly string[]).filter((c) => c.startsWith("relay:"));
    expect([...noContrato].sort()).toEqual([...canais].sort());
    expect([...Object.values(CANAIS_RELAY)].filter((c) => c !== CANAIS_RELAY.evento).sort()).toEqual([...canais].sort());
    expect(CANAIS_EVENTO as readonly string[]).toContain(CANAIS_RELAY.evento);
  });
  it("pareamento e SAS são canais sensíveis (log sem payload); os do compartilhado batem com o registro", () => {
    for (const c of CANAIS_RELAY_SENSIVEIS) expect(CANAIS_SENSIVEIS as readonly string[]).toContain(c);
    expect([...CANAIS_SENSIVEIS].filter((c) => c.startsWith("relay:")).sort()).toEqual([...CANAIS_RELAY_SENSIVEIS].sort());
  });
  it("sem ligação responde erro genérico (sem citar nada); com campo extra recusa antes do manipulador", async () => {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const registro = criarRegistroIpc({ ipcMain: { handle: (c, f) => void handlers.set(c, f), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined }, autorizar: () => true });
    let chamadas = 0;
    registrarIpcRelay({ registro, ligacao: () => (chamadas++, null) });
    expect(registro.registrados().sort()).toEqual([...canais].sort());
    await expect(handlers.get("relay:parear_decidir")?.({}, { permitir: true, por: "voz" })).rejects.toThrow(/recusado/);
    expect(chamadas).toBe(0);
    await expect(handlers.get("relay:ligar")?.({}, undefined)).rejects.toThrow("falha ao executar a operação do relay");
  });
});

describe("validadores estritos", () => {
  it("config: só os campos editáveis; `experimental`/`habilitado` extra, URL sem wss, com credencial, IP ou local são recusados", () => {
    expect(v("relay:config_definir", { url: "wss://relay.exemplo.com", padding: true })).toBe(true);
    expect(v("relay:config_definir", {})).toBe(true);
    for (const x of [{ experimental: false }, { url: "ws://relay.exemplo.com" }, { url: "wss://u:p@relay.exemplo.com" }, { url: "wss://10.0.0.1" }, { url: "wss://localhost" }, { url: "wss://relay.exemplo.com/?x=1" }, { padding: "sim" }, { pwa_origem: "http://x.com" }, { habilitado: 1 }, null, "x"]) expect(v("relay:config_definir", x), JSON.stringify(x)).toBe(false);
  });
  it("ax28: `permissao_inicial` só aceita `leitura`", () => {
    expect(v("relay:parear_iniciar", { permissao_inicial: "leitura" })).toBe(true);
    for (const x of [{ permissao_inicial: "mensagem_direta" }, { permissao_inicial: "mensagem_confirmada" }, {}, { permissao_inicial: "leitura", extra: 1 }, undefined]) expect(v("relay:parear_iniciar", x), JSON.stringify(x)).toBe(false);
  });
  it("decidir, revogar e canais sem payload", () => {
    expect(v("relay:parear_decidir", { permitir: false })).toBe(true);
    expect(v("relay:parear_decidir", { permitir: "sim" })).toBe(false);
    expect(v("relay:revogar", { dispositivo_id: "dev_abcdef12" })).toBe(true);
    for (const x of [{ dispositivo_id: "../x" }, { dispositivo_id: "dev_a" }, { dispositivo_id: "dev_abcdef12", todos: true }, {}]) expect(v("relay:revogar", x)).toBe(false);
    for (const c of ["relay:estado", "relay:config_obter", "relay:ligar", "relay:desligar", "relay:parear_sas", "relay:dispositivos", "relay:panico"] as const) {
      expect(v(c, undefined)).toBe(true);
      expect(v(c, {})).toBe(false);
    }
  });
});
