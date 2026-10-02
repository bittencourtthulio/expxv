// Canais `executar:assistente_*` (D-582…): contrato fechado, validadores estritos (nenhum caminho vindo do renderer), `origem` nunca vem de fora, canal de salvar
// sensível (o log nunca imprime o payload) e saneamento de erro. Sem Electron: o serviço é um espião.
import { describe, expect, it } from "vitest";
import { CANAIS_EVENTO, CANAIS_INVOKE, CANAIS_SENSIVEIS } from "../compartilhado/ipc";
import { ErroExecutar } from "./executar";
import type { ServicoAssistente } from "./executar-assistente";
import { registrarIpcAssistente, sanearErroAssistente, VALIDADORES_ASSISTENTE } from "./executar-assistente-ipc";
import { canalSensivel, criarRegistroIpc, type IpcMainLike } from "./ipc/registro";

const WS = "ws_AAAAAAAAAAAA";
const HASH = "b".repeat(40);
const ID = `ass_${"c".repeat(20)}`;
const canais = CANAIS_INVOKE.filter((c) => c.startsWith("executar:assistente_"));
const CONFIG = {
  id: "dev", nome: "Rodar", tipo: "rodar", executavel: "npm", argumentos: ["run", "dev"], cwd: "desktop", ambiente: {}, pre_passos: [], porta: null, url: null,
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
      return nome === "cancelar" ? true : nome === "propor" ? { assistente_id: ID } : { ok: true };
    },
  }) as unknown as ServicoAssistente;
  registrarIpcAssistente({ registro, servico });
  const chamar = (canal: string, payload: unknown): Promise<unknown> => Promise.resolve((handlers.get(canal) as (e: unknown, p: unknown) => unknown)({}, payload));
  return { handlers, chamar, chamadas, linhas };
}

const VALIDOS: Record<string, unknown> = {
  "executar:assistente_previa": { workspace_id: WS },
  "executar:assistente_propor": { workspace_id: WS, cli: "claude", dossie_hash: HASH, consentimento: true },
  "executar:assistente_cancelar": { workspace_id: WS },
  "executar:assistente_salvar": { workspace_id: WS, assistente_id: ID, configs: [CONFIG], padrao_id: "dev" },
};
const validar = (canal: string, v: unknown): { ok: boolean; erro?: string } => (VALIDADORES_ASSISTENTE as unknown as Record<string, (x: unknown) => { ok: boolean; erro?: string }>)[canal]!(v);

describe("canais executar:assistente_*", () => {
  it("contrato: exatamente 4 canais invoke + 1 evento, todos com validador e manipulador", () => {
    expect([...canais].sort()).toEqual(Object.keys(VALIDOS).sort());
    expect(Object.keys(VALIDADORES_ASSISTENTE).sort()).toEqual(Object.keys(VALIDOS).sort());
    expect([...montar().handlers.keys()].sort()).toEqual(Object.keys(VALIDOS).sort());
    expect(CANAIS_EVENTO).toContain("executar:assistente_evento");
  });

  it.each(Object.entries(VALIDOS))("%s aceita o payload válido", (canal, payload) => {
    expect(validar(canal, payload).ok).toBe(true);
  });
  it("previa aceita a CLI opcional; padrao_id nulo vale", () => {
    expect(validar("executar:assistente_previa", { workspace_id: WS, cli: "codex" }).ok).toBe(true);
    expect(validar("executar:assistente_salvar", { ...(VALIDOS["executar:assistente_salvar"] as object), padrao_id: null }).ok).toBe(true);
  });

  const RUINS: Array<[string, string, unknown]> = [
    ["previa: id de workspace ruim", "executar:assistente_previa", { workspace_id: "../etc" }],
    ["previa: CLI fora da lista (gemini)", "executar:assistente_previa", { workspace_id: WS, cli: "gemini" }],
    ["previa: CLI com caminho", "executar:assistente_previa", { workspace_id: WS, cli: "/usr/bin/claude" }],
    ["previa: caminho vindo do renderer", "executar:assistente_previa", { workspace_id: WS, caminho: "/Users/x/proj" }],
    ["previa: cwd vindo do renderer", "executar:assistente_previa", { workspace_id: WS, cwd: "." }],
    ["previa: sem payload", "executar:assistente_previa", undefined],
    ["propor: sem consentimento (campo ausente)", "executar:assistente_propor", { workspace_id: WS, cli: "claude", dossie_hash: HASH }],
    ["propor: consentimento não booleano", "executar:assistente_propor", { workspace_id: WS, cli: "claude", dossie_hash: HASH, consentimento: "sim" }],
    ["propor: hash curto", "executar:assistente_propor", { workspace_id: WS, cli: "claude", dossie_hash: "abc", consentimento: true }],
    ["propor: hash com maiúscula/shell", "executar:assistente_propor", { workspace_id: WS, cli: "claude", dossie_hash: `${"A".repeat(39)};`, consentimento: true }],
    ["propor: CLI ausente", "executar:assistente_propor", { workspace_id: WS, dossie_hash: HASH, consentimento: true }],
    ["propor: dossiê vindo do renderer", "executar:assistente_propor", { workspace_id: WS, cli: "claude", dossie_hash: HASH, consentimento: true, dossie: "texto" }],
    ["propor: prompt vindo do renderer", "executar:assistente_propor", { workspace_id: WS, cli: "claude", dossie_hash: HASH, consentimento: true, prompt: "faça x" }],
    ["propor: modelo/argumentos livres da CLI", "executar:assistente_propor", { workspace_id: WS, cli: "claude", dossie_hash: HASH, consentimento: true, argumentos: ["--dangerously-skip-permissions"] }],
    ["cancelar: campo extra", "executar:assistente_cancelar", { workspace_id: WS, id: "x" }],
    ["salvar: id da proposta ruim", "executar:assistente_salvar", { workspace_id: WS, assistente_id: "ass_x", configs: [CONFIG], padrao_id: null }],
    ["salvar: configs não é lista", "executar:assistente_salvar", { workspace_id: WS, assistente_id: ID, configs: CONFIG, padrao_id: null }],
    ["salvar: configuração com origem", "executar:assistente_salvar", { workspace_id: WS, assistente_id: ID, configs: [{ ...CONFIG, origem: "detectada" }], padrao_id: null }],
    ["salvar: configuração com campo desconhecido", "executar:assistente_salvar", { workspace_id: WS, assistente_id: ID, configs: [{ ...CONFIG, extra: 1 }], padrao_id: null }],
    ["salvar: cwd com ..", "executar:assistente_salvar", { workspace_id: WS, assistente_id: ID, configs: [{ ...CONFIG, cwd: "../fora" }], padrao_id: null }],
    ["salvar: cwd absoluto", "executar:assistente_salvar", { workspace_id: WS, assistente_id: ID, configs: [{ ...CONFIG, cwd: "/etc" }], padrao_id: null }],
    ["salvar: executável absoluto", "executar:assistente_salvar", { workspace_id: WS, assistente_id: ID, configs: [{ ...CONFIG, executavel: "/bin/sh" }], padrao_id: null }],
    ["salvar: segredo em ambiente", "executar:assistente_salvar", { workspace_id: WS, assistente_id: ID, configs: [{ ...CONFIG, ambiente: { API_KEY: "valor" } }], padrao_id: null }],
    ["salvar: URL externa", "executar:assistente_salvar", { workspace_id: WS, assistente_id: ID, configs: [{ ...CONFIG, url: "https://evil.example/" }], padrao_id: null }],
    ["salvar: mais de 12 configurações", "executar:assistente_salvar", { workspace_id: WS, assistente_id: ID, configs: Array.from({ length: 13 }, (_, i) => ({ ...CONFIG, id: `c${i}` })), padrao_id: null }],
    ["salvar: padrao_id com formato ruim", "executar:assistente_salvar", { workspace_id: WS, assistente_id: ID, configs: [CONFIG], padrao_id: "../x" }],
    ["salvar: padrao_id ausente", "executar:assistente_salvar", { workspace_id: WS, assistente_id: ID, configs: [CONFIG] }],
  ];
  it.each(RUINS)("recusa: %s", (_n, canal, payload) => {
    expect(validar(canal, payload).ok).toBe(false);
  });

  it("manipuladores delegam ao serviço com os campos validados (sem repassar nada a mais)", async () => {
    const m = montar();
    expect(await m.chamar("executar:assistente_previa", { workspace_id: WS, cli: "codex" })).toEqual({ ok: true });
    expect(await m.chamar("executar:assistente_propor", VALIDOS["executar:assistente_propor"])).toEqual({ assistente_id: ID });
    expect(await m.chamar("executar:assistente_cancelar", { workspace_id: WS })).toEqual({ ok: true });
    await m.chamar("executar:assistente_salvar", VALIDOS["executar:assistente_salvar"]);
    expect(m.chamadas.map((c) => c.metodo)).toEqual(["previa", "propor", "cancelar", "salvar"]);
    expect(m.chamadas[1]!.args).toEqual([WS, { cli: "claude", dossie_hash: HASH, consentimento: true }]);
    expect((m.chamadas[3]!.args[1] as { configs: unknown[] }).configs).toHaveLength(1);
  });

  it("payload inválido nem chega ao serviço", async () => {
    const m = montar();
    await expect(m.chamar("executar:assistente_propor", { workspace_id: WS, cli: "claude", dossie_hash: HASH, consentimento: true, caminho: "/x" })).rejects.toThrow();
    expect(m.chamadas).toEqual([]);
  });

  it("só `executar:assistente_salvar` (comandos no payload) é sensível; o log nunca o imprime", async () => {
    expect(CANAIS_SENSIVEIS.filter((c) => c.startsWith("executar:assistente_"))).toEqual(["executar:assistente_salvar"]);
    expect(canalSensivel("executar:assistente_salvar")).toBe(true);
    expect(canalSensivel("executar:assistente_propor")).toBe(false);
    const m = montar();
    await m.chamar("executar:assistente_salvar", { workspace_id: WS, assistente_id: ID, configs: [{ ...CONFIG, argumentos: ["--senha=hunter2"] }], padrao_id: null });
    await m.chamar("executar:assistente_propor", VALIDOS["executar:assistente_propor"]);
    const tudo = m.linhas.join("\n");
    expect(tudo).not.toContain("hunter2");
    expect(tudo).toContain("executar:assistente_propor");
  });

  it("erro nominal atravessa como texto; qualquer outro vira texto genérico (sem caminho nem stack)", async () => {
    expect(sanearErroAssistente(new ErroExecutar("Já há um assistente trabalhando neste projeto.")).message).toBe("Já há um assistente trabalhando neste projeto.");
    const generico = sanearErroAssistente(new Error("ENOENT /Users/fulano/segredo/x.json"));
    expect(generico.message).not.toMatch(/fulano|ENOENT/);
    const m = montar(new Error("/Users/fulano/x quebrou"));
    await expect(m.chamar("executar:assistente_cancelar", { workspace_id: WS })).rejects.toThrow("Não foi possível concluir a ação do assistente");
    const m2 = montar(new ErroExecutar("O projeto mudou depois da prévia."));
    await expect(m2.chamar("executar:assistente_propor", VALIDOS["executar:assistente_propor"])).rejects.toThrow("O projeto mudou");
  });
});
