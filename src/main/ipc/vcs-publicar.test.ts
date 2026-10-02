import { describe, expect, it, vi } from "vitest";
import { CANAIS_INVOKE } from "../../compartilhado/ipc";
import { CanalRecusadoErro, criarRegistroIpc, type IpcMainLike } from "./registro";
import { registrarIpcVcsPublicar, VALIDADORES_VCS_PUBLICAR } from "./vcs-publicar";

const WS = "ws_01J8ZXAMPLE0000000000000A1";
const SES = "sessao_01J8ZXAMPLE0000000000000A1";
const CANAIS = CANAIS_INVOKE.filter((c) => c.startsWith("vcs:publicar_"));

const OPCOES = { criar_ramo: true, nome_ramo: "feat/algo", incluir_nao_rastreados: true, incluir_suite: false, mensagem: { modo: "agente", texto: null }, pr: null, confirmar_padrao: null };
const ENVIAR = { workspace_id: WS, tipo: "commit_push", opcoes: OPCOES, sessao_foco: SES, cli: "claude", modo_painel: "auto" };
const VALIDOS: Record<string, unknown> = {
  "vcs:publicar_estado": { workspace_id: WS, consultar_pr: false },
  "vcs:publicar_preparar_commit_push": { workspace_id: WS, sessao_foco: null },
  "vcs:publicar_preparar_pr": { workspace_id: WS, sessao_foco: SES },
  "vcs:publicar_enviar_instrucao": ENVIAR,
  "vcs:publicar_abrir_url": { workspace_id: WS, url: "https://github.com/dono/repo/pull/42" },
  "vcs:publicar_buscar_remoto": { workspace_id: WS, forcar: false },
  "vcs:publicar_preparar_atualizar": { workspace_id: WS, sessao_foco: SES },
  "vcs:publicar_atualizar": { workspace_id: WS },
  "vcs:publicar_pedir_merge": { workspace_id: WS, sessao_foco: null, cli: "claude", modo_painel: "auto" },
  "vcs:publicar_ignorar_suite": { workspace_id: WS },
};

function montar(autorizado = true) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => autorizado });
  const publicar = {
    estado: vi.fn(async () => ({ git: true }) as never),
    preparar: vi.fn(async () => ({}) as never),
    enviar: vi.fn(async () => ({ estado: "entregue" }) as never),
    abrirUrl: vi.fn(async () => true),
    buscarRemoto: vi.fn(async () => ({ buscou: false, atras: 0, erro: null })),
    prepararAtualizar: vi.fn(async () => ({}) as never),
    atualizar: vi.fn(async () => ({ estado: "ok", motivo: null, trouxe: 1, sugerir_commitar: false }) as never),
    pedirMerge: vi.fn(async () => ({ estado: "entregue" }) as never),
    ignorarSuite: vi.fn(async () => ({ estado: "ok", linhas: 1 }) as never),
  };
  registrarIpcVcsPublicar({ registro, publicar });
  const invocar = (canal: string, payload?: unknown) => (handlers.get(canal) as (e: unknown, p?: unknown) => unknown)({}, payload);
  return { registro, publicar, invocar };
}

describe("contrato vcs:publicar_* (Atualizar e suíte, D-692/D-693)", () => {
  it("buscar_remoto e pedir_merge: campos estritos (nenhum remoto, ramo, caminho nem comando do renderer)", async () => {
    const { invocar, publicar } = montar();
    for (const ruim of [{ workspace_id: WS }, { workspace_id: WS, forcar: "sim" }, { workspace_id: WS, forcar: true, remoto: "x" }]) await expect(invocar("vcs:publicar_buscar_remoto", ruim)).rejects.toThrow();
    for (const ruim of [{ workspace_id: WS, sessao_foco: null, cli: "../x", modo_painel: "auto" }, { workspace_id: WS, sessao_foco: null, cli: null, modo_painel: "forcar" }, { workspace_id: WS, sessao_foco: null, cli: null, modo_painel: "auto", ramo: "main" }]) await expect(invocar("vcs:publicar_pedir_merge", ruim)).rejects.toThrow();
    for (const ruim of [{ workspace_id: WS, modo: "rebase" }, { workspace_id: WS, caminho: "/x" }]) await expect(invocar("vcs:publicar_atualizar", ruim)).rejects.toThrow();
    for (const ruim of [{ workspace_id: WS, linhas: ["/x"] }, { workspace_id: WS, arquivo: ".gitignore" }]) await expect(invocar("vcs:publicar_ignorar_suite", ruim)).rejects.toThrow();
    expect(publicar.buscarRemoto).not.toHaveBeenCalled();
    expect(publicar.pedirMerge).not.toHaveBeenCalled();
    expect(publicar.atualizar).not.toHaveBeenCalled();
    expect(publicar.ignorarSuite).not.toHaveBeenCalled();
  });
  it("enviar_instrucao exige incluir_suite booleano", async () => {
    const { invocar } = montar();
    const { incluir_suite: _i, ...semSuite } = OPCOES;
    void _i;
    await expect(invocar("vcs:publicar_enviar_instrucao", { ...ENVIAR, opcoes: semSuite })).rejects.toThrow();
    await expect(invocar("vcs:publicar_enviar_instrucao", { ...ENVIAR, opcoes: { ...OPCOES, incluir_suite: "sim" } })).rejects.toThrow();
  });
});

describe("contrato vcs:publicar_*", () => {
  it("dez canais aditivos, cada um com validador e registrado (sem órfãos)", () => {
    const { registro } = montar();
    expect(CANAIS).toHaveLength(10);
    expect(Object.keys(VALIDADORES_VCS_PUBLICAR).sort()).toEqual([...CANAIS].sort());
    expect(registro.registrados().filter((c) => c.startsWith("vcs:publicar_"))).toEqual([...CANAIS].sort());
    expect(Object.keys(VALIDOS).sort()).toEqual([...CANAIS].sort());
  });

  it("aceita o payload válido e delega ao núcleo certo", async () => {
    const { invocar, publicar } = montar();
    for (const canal of CANAIS) await invocar(canal, VALIDOS[canal]);
    expect(publicar.estado).toHaveBeenCalledWith({ workspace_id: WS, consultar_pr: false });
    expect(publicar.preparar).toHaveBeenNthCalledWith(1, "commit_push", { workspace_id: WS, sessao_foco: null });
    expect(publicar.preparar).toHaveBeenNthCalledWith(2, "pr", { workspace_id: WS, sessao_foco: SES });
    expect(publicar.enviar).toHaveBeenCalledOnce();
    expect(publicar.abrirUrl).toHaveBeenCalledWith({ workspace_id: WS, url: "https://github.com/dono/repo/pull/42" });
    expect(publicar.buscarRemoto).toHaveBeenCalledWith({ workspace_id: WS, forcar: false });
    expect(publicar.prepararAtualizar).toHaveBeenCalledWith({ workspace_id: WS, sessao_foco: SES });
    expect(publicar.atualizar).toHaveBeenCalledWith({ workspace_id: WS });
    expect(publicar.pedirMerge).toHaveBeenCalledWith({ workspace_id: WS, sessao_foco: null, cli: "claude", modo_painel: "auto" });
    expect(publicar.ignorarSuite).toHaveBeenCalledWith({ workspace_id: WS });
  });

  it("recusa campos extras, ausentes e tipos errados em todos os canais (nenhum caminho, URL, cwd ou comando do renderer passa)", async () => {
    const { invocar, publicar } = montar();
    for (const canal of CANAIS) {
      const v = VALIDOS[canal] as Record<string, unknown>;
      for (const ruim of [undefined, null, "x", 1, [], {}, { ...v, cwd: "/tmp" }, { ...v, caminho: "/etc/passwd" }, { ...v, comando: "rm -rf" }, { ...v, remoto: "https://evil.io/x.git" }, { ...v, workspace_id: "../../x" }, { ...v, workspace_id: 3 }]) {
        await expect(invocar(canal, ruim), `${canal} ${JSON.stringify(ruim)}`).rejects.toThrow();
      }
    }
    expect(publicar.estado).not.toHaveBeenCalled();
    expect(publicar.enviar).not.toHaveBeenCalled();
    expect(publicar.abrirUrl).not.toHaveBeenCalled();
    for (const f of [publicar.buscarRemoto, publicar.prepararAtualizar, publicar.atualizar, publicar.pedirMerge, publicar.ignorarSuite]) expect(f).not.toHaveBeenCalled();
  });

  it("enviar_instrucao: nome de branch, base, revisores, textos, cli e sessão são validados campo a campo", async () => {
    const { invocar, publicar } = montar();
    const pr = { titulo: { modo: "agente", texto: null }, descricao: { modo: "agente", texto: null }, rascunho: false, base: "main", revisores: ["maria-dev"] };
    const ok = { ...ENVIAR, tipo: "pr", opcoes: { ...OPCOES, criar_ramo: false, nome_ramo: null, pr } };
    await expect(invocar("vcs:publicar_enviar_instrucao", ok)).resolves.toBeDefined();
    const ruins: Array<[string, unknown]> = [
      ["branch com ponto-e-vírgula", { ...ENVIAR, opcoes: { ...OPCOES, nome_ramo: "a; rm -rf ~" } }],
      ["branch com '..'", { ...ENVIAR, opcoes: { ...OPCOES, nome_ramo: "a..b" } }],
      ["branch começando com '-'", { ...ENVIAR, opcoes: { ...OPCOES, nome_ramo: "-f" } }],
      ["branch com espaço", { ...ENVIAR, opcoes: { ...OPCOES, nome_ramo: "a b" } }],
      ["branch longo", { ...ENVIAR, opcoes: { ...OPCOES, nome_ramo: "a".repeat(101) } }],
      ["base inválida", { ...ok, opcoes: { ...ok.opcoes, pr: { ...pr, base: "main; id" } } }],
      ["revisor inválido", { ...ok, opcoes: { ...ok.opcoes, pr: { ...pr, revisores: ["x --admin"] } } }],
      ["revisores demais", { ...ok, opcoes: { ...ok.opcoes, pr: { ...pr, revisores: Array.from({ length: 11 }, (_, i) => `u${i}`) } } }],
      ["mensagem longa", { ...ENVIAR, opcoes: { ...OPCOES, mensagem: { modo: "manual", texto: "x".repeat(301) } } }],
      ["mensagem com controle", { ...ENVIAR, opcoes: { ...OPCOES, mensagem: { modo: "manual", texto: "a\u0000b" } } }],
      ["modo desconhecido", { ...ENVIAR, opcoes: { ...OPCOES, mensagem: { modo: "shell", texto: null } } }],
      ["campo extra em opcoes", { ...ENVIAR, opcoes: { ...OPCOES, executar: "git push --force" } }],
      ["campo extra em pr", { ...ok, opcoes: { ...ok.opcoes, pr: { ...pr, flags: "--force" } } }],
      ["cli com caminho", { ...ENVIAR, cli: "/usr/bin/evil" }],
      ["cli com opção", { ...ENVIAR, cli: "claude --dangerously-skip-permissions" }],
      ["sessão inválida", { ...ENVIAR, sessao_foco: "../x" }],
      ["tipo desconhecido", { ...ENVIAR, tipo: "force_push" }],
      ["modo_painel desconhecido", { ...ENVIAR, modo_painel: "tudo" }],
      ["frase com símbolos", { ...ENVIAR, opcoes: { ...OPCOES, confirmar_padrao: "push na main; id" } }],
    ];
    for (const [nome, v] of ruins) await expect(invocar("vcs:publicar_enviar_instrucao", v), nome).rejects.toThrow();
    expect(publicar.enviar).toHaveBeenCalledTimes(1);
  });

  it("remetente não autorizado é recusado antes de qualquer coisa", async () => {
    const { invocar, publicar } = montar(false);
    for (const canal of CANAIS) await expect(invocar(canal, VALIDOS[canal])).rejects.toBeInstanceOf(CanalRecusadoErro);
    expect(publicar.enviar).not.toHaveBeenCalled();
  });

  it("erro do núcleo chega saneado: sem caminho absoluto nem credencial", async () => {
    const { invocar, publicar } = montar();
    publicar.enviar.mockRejectedValueOnce(new Error("falhou em /Users/maria/segredo/repo com https://u:ghp_abc123@github.com/x"));
    const e = (await Promise.resolve(invocar("vcs:publicar_enviar_instrucao", ENVIAR)).catch((x: unknown) => x)) as Error;
    expect(e.message).not.toContain("/Users/maria");
    expect(e.message).not.toContain("ghp_abc123");
  });
});
