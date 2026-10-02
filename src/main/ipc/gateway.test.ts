import { describe, expect, it } from "vitest";
import { CANAIS_INVOKE } from "../../compartilhado/ipc";
import type { GatewayMain } from "../gateway";
import { VALIDADORES_GATEWAY, criarManipuladoresGateway, registrarIpcGateway } from "./gateway";
import type { RegistroIpc } from "./registro";

const v = (canal: keyof typeof VALIDADORES_GATEWAY, x: unknown) => (VALIDADORES_GATEWAY[canal] as (x: unknown) => { ok: boolean }) (x);
const WS = "ws_01J8ZXAMPLE0000000000000A1";

describe("canais gateway:* (validadores estritos)", () => {
  it("os 7 canais do contrato têm validador, e só eles", () => {
    const contrato = CANAIS_INVOKE.filter((c) => c.startsWith("gateway:")).sort();
    expect(Object.keys(VALIDADORES_GATEWAY).sort()).toEqual(contrato);
    expect(contrato).toHaveLength(7);
  });
  it("estado/config_ler/revogar_pane", () => {
    expect(v("gateway:estado", {}).ok).toBe(true);
    expect(v("gateway:estado", { x: 1 }).ok).toBe(false);
    expect(v("gateway:config_ler", { workspace_id: WS }).ok).toBe(true);
    expect(v("gateway:config_ler", { workspace_id: "../x" }).ok).toBe(false);
    expect(v("gateway:revogar_pane", { pane_id: "pane_01ABC" }).ok).toBe(true);
    expect(v("gateway:revogar_pane", { pane_id: "a/b" }).ok).toBe(false);
  });
  it("config_gravar: faixas fechadas, modo do conjunto, sem campo extra nem caminho", () => {
    const ok = { workspace_id: WS, ativo: true, modo_superficie: "busca", max_ferramentas: 40, limite_por_min: 60, ocioso_s: 300 };
    expect(v("gateway:config_gravar", ok).ok).toBe(true);
    for (const ruim of [{ max_ferramentas: 0 }, { max_ferramentas: 201 }, { limite_por_min: 601 }, { limite_por_min: 0 }, { ocioso_s: 29 }, { ocioso_s: 3601 }, { modo_superficie: "total" }, { ativo: "sim" }, { max_ferramentas: 1.5 }, { comando: "rm" }]) {
      expect(v("gateway:config_gravar", { ...ok, ...ruim }).ok, JSON.stringify(ruim)).toBe(false);
    }
  });
  it("ferramentas/filtro: id de servidor, papel e nome de ferramenta restritos", () => {
    expect(v("gateway:ferramentas", { workspace_id: WS, servidor_id: "github", papel: "executor" }).ok).toBe(true);
    expect(v("gateway:ferramentas", { workspace_id: WS, servidor_id: "Github!", papel: "executor" }).ok).toBe(false);
    expect(v("gateway:ferramentas", { workspace_id: WS, servidor_id: "github", papel: "nenhum" }).ok).toBe(false);
    const f = { workspace_id: WS, servidor_id: "github", ferramenta: "get_issue", papel: "revisor", habilitada: true };
    expect(v("gateway:filtro_definir", f).ok).toBe(true);
    expect(v("gateway:filtro_definir", { ...f, ferramenta: "a b" }).ok).toBe(false);
    expect(v("gateway:filtro_definir", { ...f, ferramenta: "../../x" }).ok).toBe(false);
    expect(v("gateway:filtro_definir", { ...f, habilitada: 1 }).ok).toBe(false);
  });
  it("auditoria: workspace nulo ou id; limite 1..200", () => {
    expect(v("gateway:auditoria", { workspace_id: null, limite: 50 }).ok).toBe(true);
    expect(v("gateway:auditoria", { workspace_id: WS, limite: 200 }).ok).toBe(true);
    expect(v("gateway:auditoria", { workspace_id: WS, limite: 201 }).ok).toBe(false);
    expect(v("gateway:auditoria", { workspace_id: WS, limite: 0 }).ok).toBe(false);
  });
});

describe("manipuladores e registro", () => {
  const falso = {
    estado: () => ({ disponivel: true, panes_ativos: 0, servidores_conectados: 0, chamadas: 0, bloqueadas: 0, limitadas: 0 }),
    configLer: (ws: string) => ({ workspace_id: ws }),
    revogarPane: () => ({ ok: true }),
    auditoria: () => { throw new Error("/Users/fulano/segredo/caminho"); },
  } as unknown as GatewayMain;
  it("delegam ao gateway; erro interno vira texto genérico (nunca caminho)", async () => {
    const m = criarManipuladoresGateway(() => falso);
    expect(await m["gateway:estado"]()).toMatchObject({ disponivel: true });
    expect(await m["gateway:config_ler"]({ workspace_id: WS })).toEqual({ workspace_id: WS });
    await expect(m["gateway:auditoria"]({ workspace_id: null, limite: 5 })).rejects.toThrow(/^falha ao executar a operação do gateway de MCPs$/);
  });
  it("registra os 7 canais sem criar o gateway (sob demanda)", () => {
    const registrados: string[] = [];
    const registro = { invoke: (c: string) => { registrados.push(c); } } as unknown as RegistroIpc;
    let criado = 0;
    registrarIpcGateway({ registro, gateway: () => { criado++; return falso; } });
    expect(registrados.sort()).toEqual(Object.keys(VALIDADORES_GATEWAY).sort());
    expect(criado).toBe(0);
  });
});
