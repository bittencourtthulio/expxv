import { describe, expect, it } from "vitest";
import { CANAIS_INVOKE, CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import { VALIDADORES_JARVIS, registrarIpcJarvis, vAcaoTipada } from "./jarvis";
import { criarRegistroIpc } from "./registro";

const canais = Object.keys(VALIDADORES_JARVIS);
const v = (c: keyof typeof VALIDADORES_JARVIS, x: unknown) => (VALIDADORES_JARVIS[c] as (x: unknown) => { ok: boolean })(x).ok;

describe("canais jarvis:* e remoto:* (contrato)", () => {
  it("todo canal do contrato tem validador e todo validador está no contrato", () => {
    const noContrato = (CANAIS_INVOKE as readonly string[]).filter((c) => c.startsWith("jarvis:") || c.startsWith("remoto:"));
    expect([...noContrato].sort()).toEqual([...canais].sort());
  });
  it("texto de comando e confirmações de permissão são canais sensíveis (log sem payload)", () => {
    for (const c of ["jarvis:enviar", "jarvis:acao", "remoto:parear_confirmar_sas", "remoto:permissao_definir"]) expect(CANAIS_SENSIVEIS as readonly string[]).toContain(c);
  });
  it("registrar sem ligação responde erro genérico; com validador, campo extra é recusado antes do manipulador", async () => {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const registro = criarRegistroIpc({ ipcMain: { handle: (c, f) => void handlers.set(c, f), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined }, autorizar: () => true });
    let chamadas = 0;
    registrarIpcJarvis({ registro, ligacao: () => (chamadas++, null) });
    expect(registro.registrados().sort()).toEqual([...canais].sort());
    await expect(handlers.get("jarvis:enviar")?.({}, { texto: "oi", ator: "remoto" })).rejects.toThrow(/recusado/);
    expect(chamadas).toBe(0);
    await expect(handlers.get("jarvis:enviar")?.({}, { texto: "oi" })).rejects.toThrow("falha ao executar a operação do Jarvis");
  });
});

describe("validadores estritos", () => {
  it("ações tipadas: lista fechada, sem campo extra", () => {
    expect(vAcaoTipada({ acao: "status" }).ok).toBe(true);
    expect(vAcaoTipada({ acao: "enviar_prompt", destino: "maestro", squad: null, texto: "x" }).ok).toBe(true);
    for (const x of [{ acao: "pane_close" }, { acao: "status", x: 1 }, { acao: "enviar_prompt", destino: "piloto", squad: null, texto: "x" }, { acao: "aprovar_gate", gate_id: "a b", decisao: "aprovar" }, null, "status"]) expect(vAcaoTipada(x).ok, JSON.stringify(x)).toBe(false);
  });
  it("renderer não define ator, origem nem permissão no comando", () => {
    expect(v("jarvis:enviar", { texto: "status" })).toBe(true);
    expect(v("jarvis:enviar", { texto: "status", ator: "remoto" })).toBe(false);
    expect(v("jarvis:enviar", { texto: "" })).toBe(false);
    expect(v("jarvis:enviar", { texto: "x".repeat(4001) })).toBe(false);
    expect(v("jarvis:acao", { acao: { acao: "status" }, origem: "remoto_direto" })).toBe(false);
  });
  it("confirmação só com id `cnf_…` e booleano", () => {
    expect(v("jarvis:confirmar", { confirmacao_id: "cnf_abcdef123", aprovado: true })).toBe(true);
    for (const x of [{ confirmacao_id: "x", aprovado: true }, { confirmacao_id: "cnf_abcdef123", aprovado: "sim" }, { confirmacao_id: "cnf_abcdef123" }, { confirmacao_id: "cnf_abcdef123", aprovado: true, por: "voz" }]) expect(v("jarvis:confirmar", x)).toBe(false);
  });
  it("remoto: ligar exige transporte, interface e consentimento; interface não aceita texto livre", () => {
    expect(v("remoto:ligar", { transporte: "lan", interface: "auto", consentimento_versao: "remoto-v1" })).toBe(true);
    expect(v("remoto:ligar", { transporte: "lan", interface: "0.0.0.0; rm", consentimento_versao: "remoto-v1" })).toBe(false);
    expect(v("remoto:ligar", { transporte: "internet", interface: "auto", consentimento_versao: "remoto-v1" })).toBe(false);
    expect(v("remoto:ligar", { transporte: "lan", interface: "auto" })).toBe(false);
  });
  it("remoto: permissão, revogação e pareamento", () => {
    expect(v("remoto:parear_iniciar", { permissao: "leitura" })).toBe(true);
    expect(v("remoto:parear_iniciar", { permissao: "admin" })).toBe(false);
    expect(v("remoto:permissao_definir", { dispositivo_id: "dev_abcdef12", permissao: "mensagem_direta", confirmacao: "PERMITIR" })).toBe(true);
    expect(v("remoto:permissao_definir", { dispositivo_id: "../x", permissao: "leitura", confirmacao: null })).toBe(false);
    expect(v("remoto:revogar", { dispositivo_id: "dev_abcdef12" })).toBe(true);
    expect(v("remoto:parear_confirmar_sas", { igual: true, confirmacao_permissao: null })).toBe(true);
    expect(v("remoto:parear_confirmar_sas", { igual: "sim", confirmacao_permissao: null })).toBe(false);
    expect(v("remoto:config_gravar", { patch: { ocioso_min: 30, hosts_extras: ["meu-mac.ts.net"] } })).toBe(true);
    expect(v("remoto:config_gravar", { patch: { ocioso_min: 0 } })).toBe(false);
    expect(v("remoto:config_gravar", { patch: { hosts_extras: ["a b"] } })).toBe(false);
    expect(v("remoto:config_gravar", { patch: { token: "x" } })).toBe(false);
  });
  it("canais sem payload recusam payload", () => {
    for (const c of ["jarvis:estado", "remoto:estado", "remoto:desligar", "remoto:panico"] as const) {
      expect(v(c, undefined)).toBe(true);
      expect(v(c, { x: 1 })).toBe(false);
    }
  });
});
