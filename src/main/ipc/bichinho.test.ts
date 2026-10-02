// Canais `bichinho:*` (D-460…): contrato fechado (paridade com a lista de canais), validadores estritos e saneamento de erro. Sem Electron.
import { describe, expect, it } from "vitest";
import { CANAIS_EVENTO, CANAIS_INVOKE, CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import { ErroBichinho, type ServicoBichinho } from "../../nucleo/bichinho/servico";
import { VALIDADORES_BICHINHO, registrarIpcBichinho, sanearErroBichinho } from "./bichinho";
import { criarRegistroIpc, type IpcMainLike } from "./registro";

const WS = "ws_AAAAAAAAAAAA";
const canais = CANAIS_INVOKE.filter((c) => c.startsWith("bichinho:"));

function montar(falhaCom?: unknown) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain, autorizar: () => true });
  const chamadas: Array<{ metodo: string; args: unknown[] }> = [];
  const servico = new Proxy({}, {
    get: (_t, nome: string) => nome === "then" ? undefined : (...args: unknown[]) => { chamadas.push({ metodo: nome, args }); if (falhaCom !== undefined) throw falhaCom; return nome === "listar" ? [] : { ok: true }; },
  }) as unknown as ServicoBichinho;
  registrarIpcBichinho({ registro, servico });
  const chamar = (canal: string, payload: unknown): Promise<unknown> => Promise.resolve((handlers.get(canal) as (e: unknown, p: unknown) => unknown)({}, payload));
  return { handlers, chamar, chamadas };
}

const VALIDOS: Record<string, unknown> = {
  "bichinho:listar": { workspace_ids: [WS] },
  "bichinho:obter": { workspace_id: WS },
  "bichinho:trocar_especie": { workspace_id: WS, especie: "raposa" },
  "bichinho:renomear": { workspace_id: WS, apelido: "Fox" },
  "bichinho:atencao": { workspace_id: WS },
  "bichinho:usos": undefined,
};

describe("canais bichinho:*", () => {
  it("contrato: 6 canais de invocação e 1 evento; nenhum é sensível; todos têm validador e manipulador", () => {
    expect(canais.sort()).toEqual(Object.keys(VALIDOS).sort());
    expect(Object.keys(VALIDADORES_BICHINHO).sort()).toEqual(canais);
    expect(CANAIS_EVENTO).toContain("bichinho:mudou");
    for (const c of canais) expect(CANAIS_SENSIVEIS as readonly string[]).not.toContain(c);
    expect([...montar().handlers.keys()].sort()).toEqual(canais);
  });

  it("aceita entradas válidas e delega ao serviço com valores reconstruídos", async () => {
    const m = montar();
    for (const [canal, payload] of Object.entries(VALIDOS)) await m.chamar(canal, payload);
    expect(m.chamadas.map((c) => c.metodo)).toEqual(["listar", "obter", "trocarEspecie", "renomear", "atencao", "usos"]);
    expect(m.chamadas[2]!.args).toEqual([WS, "raposa"]);
  });

  it("aceita qualquer das 100 espécies do catálogo e recusa o que não é dele", async () => {
    const m = montar();
    for (const especie of ["capivara", "agua-viva", "porco-espinho", "louva-a-deus"]) await m.chamar("bichinho:trocar_especie", { workspace_id: WS, especie });
    expect(m.chamadas.map((c) => c.args[1])).toEqual(["capivara", "agua-viva", "porco-espinho", "louva-a-deus"]);
  });

  it("aceita null para voltar ao automático e para limpar o apelido", async () => {
    const m = montar();
    await m.chamar("bichinho:trocar_especie", { workspace_id: WS, especie: null });
    await m.chamar("bichinho:renomear", { workspace_id: WS, apelido: null });
    expect(m.chamadas.map((c) => c.args)).toEqual([[WS, null], [WS, null]]);
  });

  const INVALIDOS: Array<[string, unknown]> = [
    ["bichinho:obter", {}],
    ["bichinho:obter", { workspace_id: "../etc" }],
    ["bichinho:obter", { workspace_id: WS, extra: 1 }],
    ["bichinho:obter", { workspace_id: WS, cwd: "/tmp" }],
    ["bichinho:listar", { workspace_ids: "ws" }],
    ["bichinho:listar", { workspace_ids: Array.from({ length: 65 }, () => WS) }],
    ["bichinho:listar", { workspace_ids: ["x"] }],
    ["bichinho:trocar_especie", { workspace_id: WS, especie: "dragao" }],
    ["bichinho:trocar_especie", { workspace_id: WS }],
    ["bichinho:renomear", { workspace_id: WS, apelido: "" }],
    ["bichinho:renomear", { workspace_id: WS, apelido: "x".repeat(25) }],
    ["bichinho:renomear", { workspace_id: WS, apelido: 42 }],
    ["bichinho:atencao", null],
    ["bichinho:atencao", "ws"],
    ["bichinho:usos", { workspace_id: WS }],
  ];
  for (const [canal, payload] of INVALIDOS) {
    it(`recusa ${canal} com ${JSON.stringify(payload).slice(0, 50)}`, async () => {
      const m = montar();
      await expect(m.chamar(canal, payload)).rejects.toBeTruthy();
      expect(m.chamadas).toHaveLength(0);
    });
  }

  it("erro nominal atravessa; qualquer outro vira texto genérico (nunca caminho nem stack)", async () => {
    expect(sanearErroBichinho(new ErroBichinho("apelido_invalido", "O apelido precisa ser curto.")).message).toBe("O apelido precisa ser curto.");
    const generico = sanearErroBichinho(new Error("ENOENT /Users/fulano/segredo/.x"));
    expect(generico.message).not.toMatch(/Users|ENOENT/);
    const m = montar(new Error("boom /home/x"));
    await expect(m.chamar("bichinho:obter", { workspace_id: WS })).rejects.toThrow(/Não foi possível/);
  });
});
