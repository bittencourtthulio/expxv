import { describe, expect, it, vi } from "vitest";
import { CANAIS_INVOKE } from "../../compartilhado/ipc";
import { registrarIpcMetodo, GESTOS_METODO } from "./metodo";
import { registrarIpcMissoes } from "./missoes";
import { registrarIpcProvedores } from "./provedores";
import { registrarIpcWorkspaces } from "./workspaces";
import { CanalRecusadoErro, criarRegistroIpc, type IpcMainLike } from "./registro";

const WS = "ws_01J8ZXAMPLE0000000000000A1";
const MIS = "mis_01J8ZXAMPLE0000000000000A1";
const PANE = "pane_01J8ZXAMPLE000000000000A1";
const CONTA = "conta_01J8ZXAMPLE00000000000A1";

function ipcFalso() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = {
    handle: (c, l) => void handlers.set(c, l),
    on: () => undefined,
    removeHandler: (c) => void handlers.delete(c),
    removeAllListeners: () => undefined,
  };
  return { ipc, handlers };
}

function montar(autorizado = true) {
  const { ipc, handlers } = ipcFalso();
  const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => autorizado });
  const workspaces = {
    estado: vi.fn(async () => ({ atual: null, recentes: [] })),
    abrir: vi.fn(async () => null),
    definirAtual: vi.fn(async () => null),
    remover: vi.fn(async () => true),
    definirPermissao: vi.fn(async () => null),
    worktrees: vi.fn(async () => []),
  };
  const provedores = { listar: vi.fn(async () => []), diagnostico: vi.fn(async () => ({ texto: "{}" })) };
  const contas = { criar: vi.fn(() => ({ id: CONTA })), habilitar: vi.fn(() => null) };
  const missoes = {
    listar: vi.fn(async () => ({ itens: [], proximo: null })),
    criar: vi.fn(async () => ({ id: MIS })),
    detalhe: vi.fn(async () => null),
    encerrar: vi.fn(async () => null),
    abortar: vi.fn(async () => null),
  };
  const portoes = {
    estado: vi.fn(() => ({ mission_id: MIS, liberados: [], pendentes: ["direction", "content", "build", "qa"] })),
    liberar: vi.fn(() => ({ mission_id: MIS, liberados: ["build"], pendentes: ["direction", "content", "qa"] })),
  };
  const leitura = { estado: vi.fn(async () => null), rastro: vi.fn(async () => ({ eventos: [], proximo: 0 })) };
  const missao = {
    comandoSugeridoPara: vi.fn(async () => ({ comando: "", pane_separado: false, somente_humano: false, motivo_bloqueio: null })),
    disparar: vi.fn(async () => ({ ok: false, pane_id: null, comando: null, motivo: "x" })),
  };
  const aoMudar = vi.fn();
  registrarIpcWorkspaces({ registro, servico: workspaces as never, aoMudar });
  registrarIpcProvedores({ registro, servico: provedores as never, contas: contas as never });
  registrarIpcMissoes({ registro, servico: missoes as never, portoes: portoes as never });
  registrarIpcMetodo({ registro, leitura: leitura as never, missao: missao as never });
  const invocar = (canal: string, payload?: unknown) => (handlers.get(canal) as (e: unknown, p?: unknown) => unknown)({}, payload);
  return { registro, handlers, invocar, workspaces, provedores, contas, missoes, portoes, leitura, missao, aoMudar };
}

/** Um payload VÁLIDO por canal, para provar que o canal funciona e, depois, que rejeita campo a mais. */
const VALIDOS: Record<string, unknown> = {
  "workspaces:estado": undefined,
  "workspaces:abrir": { caminho: "/tmp/projeto" },
  "workspaces:definir_atual": { workspace_id: WS },
  "workspaces:remover": { workspace_id: WS },
  "workspaces:definir_permissao": { workspace_id: WS, permissao: "automatico" },
  "workspaces:worktrees": { workspace_id: WS },
  "provedores:listar": { forcar: true },
  "provedores:contas_criar": { provedor: "claude", rotulo: "Pessoal" },
  "provedores:contas_habilitar": { conta_id: CONTA, habilitada: false },
  "provedores:diagnostico": undefined,
  "missoes:listar": { workspace_id: WS, estado: null, depois: null },
  "missoes:criar": { workspace_id: WS, modo: "agentico", origem: "feature", titulo: "Cobrança", pedido: "cobrar por pix", clis: { piloto: "claude" } },
  "missoes:detalhe": { mission_id: MIS },
  "missoes:encerrar": { mission_id: MIS },
  "missoes:abortar": { mission_id: MIS },
  "missoes:portoes": { mission_id: MIS },
  "missoes:liberar_portao": { mission_id: MIS, portao: "build" },
  "metodo:estado": { workspace_id: WS },
  "metodo:rastro": { workspace_id: WS, trabalho_id: "cobranca-pix", depois: 0 },
  "metodo:comando_sugerido": { workspace_id: WS, trabalho_id: null, gesto: "nova_feature", argumento: "x" },
  "metodo:disparar": { workspace_id: WS, trabalho_id: "cobranca-pix", gesto: "retomar", argumento: null, pane_id: PANE },
};
const CANAIS_DE_DOMINIO = CANAIS_INVOKE.filter((c) => /^(workspaces|provedores|missoes|metodo):(?!openrouter_)/.test(c));

describe("canais de domínio: cobertura", () => {
  it("todos os canais workspaces:*, provedores:*, missoes:* e metodo:* do contrato estão registrados", () => {
    const { registro } = montar();
    expect(registro.registrados().filter((c) => /^(workspaces|provedores|missoes|metodo):(?!openrouter_)/.test(c))).toEqual([...CANAIS_DE_DOMINIO].sort());
    expect(Object.keys(VALIDOS).sort()).toEqual([...CANAIS_DE_DOMINIO].sort());
  });

  it("cada canal aceita o payload válido e chama o serviço", async () => {
    for (const canal of CANAIS_DE_DOMINIO) {
      const m = montar();
      await expect(m.invocar(canal, VALIDOS[canal])).resolves.not.toThrow();
    }
  });
});

describe("remetente e payload", () => {
  it("remetente não autorizado é recusado ANTES de qualquer serviço", async () => {
    const m = montar(false);
    for (const canal of CANAIS_DE_DOMINIO) {
      await expect(m.invocar(canal, VALIDOS[canal])).rejects.toBeInstanceOf(CanalRecusadoErro);
    }
    expect(m.workspaces.abrir).not.toHaveBeenCalled();
    expect(m.missoes.criar).not.toHaveBeenCalled();
    expect(m.portoes.liberar).not.toHaveBeenCalled();
    expect(m.missao.disparar).not.toHaveBeenCalled();
    expect(m.contas.criar).not.toHaveBeenCalled();
  });

  it("nenhum canal aceita cwd (nem caminho, worktree ou executável)", async () => {
    for (const canal of CANAIS_DE_DOMINIO) {
      const base = VALIDOS[canal];
      for (const intruso of ["cwd", "worktree", "executavel", "raiz"]) {
        const m = montar();
        const payload = base === undefined ? { [intruso]: "/etc" } : { ...(base as object), [intruso]: "/etc" };
        await expect(m.invocar(canal, payload), `${canal} + ${intruso}`).rejects.toBeInstanceOf(CanalRecusadoErro);
      }
    }
  });

  it("campo ausente, tipo errado e payload que não é objeto são recusados", async () => {
    const m = montar();
    for (const canal of CANAIS_DE_DOMINIO) {
      if (VALIDOS[canal] === undefined) {
        await expect(m.invocar(canal, { x: 1 })).rejects.toBeInstanceOf(CanalRecusadoErro);
        continue;
      }
      await expect(m.invocar(canal, {})).rejects.toBeInstanceOf(CanalRecusadoErro);
      await expect(m.invocar(canal, "texto")).rejects.toBeInstanceOf(CanalRecusadoErro);
      await expect(m.invocar(canal, null)).rejects.toBeInstanceOf(CanalRecusadoErro);
      await expect(m.invocar(canal, [VALIDOS[canal]])).rejects.toBeInstanceOf(CanalRecusadoErro);
    }
  });

  it("portões: portão desconhecido, id inválido e campo extra são recusados antes de liberar; payload válido libera", async () => {
    const m = montar();
    for (const ruim of ["ops", "", "BUILD", "build ", null, 1, ["build"]]) {
      await expect(m.invocar("missoes:liberar_portao", { mission_id: MIS, portao: ruim })).rejects.toBeInstanceOf(CanalRecusadoErro);
    }
    await expect(m.invocar("missoes:liberar_portao", { mission_id: WS, portao: "build" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("missoes:liberar_portao", { mission_id: MIS, portao: "build", todos: true })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("missoes:portoes", { mission_id: "../x" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    expect(m.portoes.liberar).not.toHaveBeenCalled();
    await expect(m.invocar("missoes:liberar_portao", { mission_id: MIS, portao: "build" })).resolves.toMatchObject({ liberados: ["build"] });
    expect(m.portoes.liberar).toHaveBeenCalledWith(MIS, "build");
    await expect(m.invocar("missoes:portoes", { mission_id: MIS })).resolves.toMatchObject({ pendentes: expect.arrayContaining(["qa"]) });
  });

  it("ids fora do formato (inclusive caminho disfarçado de id) são recusados", async () => {
    const m = montar();
    for (const ruim of ["../../etc", "ws_", "WS_01J8ZXAMPLE0000000000000A1", "/abs", "", `${WS}\0`, "mis_01J8ZXAMPLE0000000000000A1"]) {
      await expect(m.invocar("workspaces:remover", { workspace_id: ruim })).rejects.toBeInstanceOf(CanalRecusadoErro);
    }
    await expect(m.invocar("missoes:detalhe", { mission_id: WS })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("metodo:rastro", { workspace_id: WS, trabalho_id: "../../segredo", depois: 0 })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("metodo:rastro", { workspace_id: WS, trabalho_id: "a/b", depois: 0 })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("metodo:rastro", { workspace_id: WS, trabalho_id: "ok", depois: -1 })).rejects.toBeInstanceOf(CanalRecusadoErro);
  });

  it("enums fora do conjunto são recusados (permissão, modo, origem, estado, gesto, provedor, papel, CLI)", async () => {
    const m = montar();
    await expect(m.invocar("workspaces:definir_permissao", { workspace_id: WS, permissao: "root" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    const criar = VALIDOS["missoes:criar"] as Record<string, unknown>;
    await expect(m.invocar("missoes:criar", { ...criar, modo: "caos" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("missoes:criar", { ...criar, origem: "sonho" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("missoes:criar", { ...criar, clis: { chefe: "claude" } })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("missoes:criar", { ...criar, clis: { piloto: "rm -rf" } })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("missoes:criar", { ...criar, clis: { piloto: "claude", cwd: "/" } })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("missoes:criar", { ...criar, titulo: "" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("missoes:criar", { ...criar, titulo: "a\nb" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("missoes:criar", { ...criar, pedido: "x".repeat(8_001) })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("missoes:listar", { workspace_id: WS, estado: "meio-feita", depois: null })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("provedores:contas_criar", { provedor: "terminal", rotulo: "x" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("provedores:contas_criar", { provedor: "claude", rotulo: "a\u0000b" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.invocar("metodo:disparar", { ...(VALIDOS["metodo:disparar"] as object), gesto: "mergex_revisar" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    expect(GESTOS_METODO).not.toContain("mergex_revisar");
    expect(m.missoes.criar).not.toHaveBeenCalled();
    expect(m.portoes.liberar).not.toHaveBeenCalled();
    expect(m.missao.disparar).not.toHaveBeenCalled();
  });

  it("o serviço recebe um objeto RECONSTRUÍDO, não o que o renderer mandou", async () => {
    const m = montar();
    const entrada = { ...(VALIDOS["missoes:criar"] as object) };
    await m.invocar("missoes:criar", entrada);
    const recebido = (m.missoes.criar.mock.calls as unknown as unknown[][])[0]?.[0] as object;
    expect(recebido).toEqual(entrada);
    expect(recebido).not.toBe(entrada);
    const clis = (recebido as { clis: object }).clis;
    expect(clis).not.toBe((entrada as { clis: object }).clis);
  });
});

describe("efeitos dos canais", () => {
  it("workspaces:abrir com null pede o diálogo ao serviço (caminho null) e avisa a UI", async () => {
    const m = montar();
    await m.invocar("workspaces:abrir", { caminho: null });
    expect(m.workspaces.abrir).toHaveBeenCalledWith(null);
    expect(m.aoMudar).toHaveBeenCalledTimes(1);
    await m.invocar("workspaces:remover", { workspace_id: WS });
    await m.invocar("workspaces:definir_atual", { workspace_id: WS });
    await m.invocar("workspaces:definir_permissao", { workspace_id: WS, permissao: "seguro" });
    expect(m.aoMudar).toHaveBeenCalledTimes(4);
    await m.invocar("workspaces:estado");
    await m.invocar("workspaces:worktrees", { workspace_id: WS });
    expect(m.aoMudar).toHaveBeenCalledTimes(4); // leitura não avisa
  });

  it("missoes:listar repassa o cursor; criar/encerrar/abortar repassam só o id", async () => {
    const m = montar();
    await m.invocar("missoes:listar", { workspace_id: WS, estado: "executando", depois: MIS });
    expect(m.missoes.listar).toHaveBeenCalledWith(WS, "executando", MIS);
    await m.invocar("missoes:abortar", { mission_id: MIS });
    expect(m.missoes.abortar).toHaveBeenCalledWith(MIS);
    await m.invocar("missoes:encerrar", { mission_id: MIS });
    expect(m.missoes.encerrar).toHaveBeenCalledWith(MIS);
  });

  it("metodo:disparar e comando_sugerido passam o pedido validado ao serviço do método", async () => {
    const m = montar();
    await m.invocar("metodo:disparar", VALIDOS["metodo:disparar"]);
    expect(m.missao.disparar).toHaveBeenCalledWith(VALIDOS["metodo:disparar"]);
    await m.invocar("metodo:comando_sugerido", VALIDOS["metodo:comando_sugerido"]);
    expect(m.missao.comandoSugeridoPara).toHaveBeenCalledWith(VALIDOS["metodo:comando_sugerido"]);
    await m.invocar("metodo:rastro", VALIDOS["metodo:rastro"]);
    expect(m.leitura.rastro).toHaveBeenCalledWith(WS, "cobranca-pix", 0);
  });

  it("provedores: criar conta e habilitar passam só os campos do contrato", async () => {
    const m = montar();
    await m.invocar("provedores:contas_criar", VALIDOS["provedores:contas_criar"]);
    expect(m.contas.criar).toHaveBeenCalledWith("claude", "Pessoal");
    await m.invocar("provedores:contas_habilitar", VALIDOS["provedores:contas_habilitar"]);
    expect(m.contas.habilitar).toHaveBeenCalledWith(CONTA, false);
    await m.invocar("provedores:listar", { forcar: false });
    expect(m.provedores.listar).toHaveBeenCalledWith(false);
  });
});
