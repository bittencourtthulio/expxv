// Canais `workspaces:adicionar_*` (D-600…): contrato fechado, validadores estritos (nenhum caminho vindo do renderer), saneamento de erro e autorização.
import { describe, expect, it } from "vitest";
import { CANAIS_EVENTO, CANAIS_INVOKE } from "../../compartilhado/ipc";
import { ErroAdicionarNucleo } from "../../nucleo/workspaces/adicionar/erros";
import type { ServicoAdicionar } from "../workspaces-adicionar";
import { criarRegistroIpc, type IpcMainLike } from "./registro";
import { VALIDADORES_ADICIONAR, registrarIpcAdicionar, sanearErroAdicionar } from "./workspaces-adicionar";

const TOKEN = "d_AbCdEfGhIjKl";
const canais = CANAIS_INVOKE.filter((c) => c.startsWith("workspaces:adicionar_"));
const CLONAR = { entrada: "https://github.com/dono/repo", permitir_local: false, destino_token: TOKEN, nome: "repo", branch: null, raso: false, submodulos: false, consentimento: true };
const NOVO = { nome: "app", destino_token: TOKEN, git: true, gitignore: true, commit_inicial: false, readme: true, template: "vazio", instalar_suite: false };
const VALIDOS: Record<string, unknown> = {
  "workspaces:adicionar_destino_padrao": undefined,
  "workspaces:adicionar_escolher_pasta": { lembrar: true },
  "workspaces:adicionar_avaliar_destino": { destino_token: TOKEN, nome: "repo" },
  "workspaces:adicionar_abrir_destino": { destino_token: TOKEN, nome: "repo" },
  "workspaces:adicionar_clonar_iniciar": CLONAR,
  "workspaces:adicionar_clonar_cancelar": { clone_id: "cl_AbCdEfGhIjKl" },
  "workspaces:adicionar_projetos_buscar": undefined,
  "workspaces:adicionar_projetos_cancelar": { busca_id: "bu_AbCdEfGhIjKl" },
  "workspaces:adicionar_projeto_achado": { achado_id: "ach_AbCdEfGhIjKl" },
  "workspaces:adicionar_gh_estado": { forcar: false },
  "workspaces:adicionar_repos_listar": { consentimento: true },
  "workspaces:adicionar_novo_criar": NOVO,
};

function montar(falhaCom?: unknown, autorizar = true) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain, autorizar: () => autorizar });
  const chamadas: Array<{ metodo: string; args: unknown[] }> = [];
  const servico = new Proxy({}, {
    get: (_t, nome: string) => nome === "then" ? undefined : (...args: unknown[]) => {
      chamadas.push({ metodo: nome, args });
      if (falhaCom !== undefined) throw falhaCom;
      return { ok: true };
    },
  }) as unknown as ServicoAdicionar;
  registrarIpcAdicionar({ registro, servico });
  const chamar = (canal: string, payload: unknown): Promise<unknown> => Promise.resolve((handlers.get(canal) as (e: unknown, p: unknown) => unknown)({}, payload));
  return { handlers, chamar, chamadas };
}

describe("contrato dos canais workspaces:adicionar_*", () => {
  it("12 canais invoke + 2 eventos, todos registrados com validador", () => {
    expect(canais).toHaveLength(12);
    expect(Object.keys(VALIDADORES_ADICIONAR).sort()).toEqual([...canais].sort());
    expect(CANAIS_EVENTO).toContain("workspaces:adicionar_progresso");
    expect(CANAIS_EVENTO).toContain("workspaces:adicionar_projetos_lote");
    const { handlers } = montar();
    expect([...handlers.keys()].filter((c) => c.startsWith("workspaces:adicionar_")).sort()).toEqual([...canais].sort());
  });

  it.each(canais)("%s aceita o payload válido e delega ao serviço", async (canal) => {
    const { chamar, chamadas } = montar();
    await chamar(canal, VALIDOS[canal]);
    expect(chamadas).toHaveLength(1);
  });

  it.each(canais)("%s recusa campo extra e tipo errado (nada chega ao serviço)", async (canal) => {
    const { chamar, chamadas } = montar();
    const v = VALIDOS[canal];
    const extra = v === undefined ? { caminho: "/etc" } : { ...(v as object), caminho: "/etc" };
    await expect(chamar(canal, extra)).rejects.toThrow();
    await expect(chamar(canal, "texto")).rejects.toThrow();
    expect(chamadas).toHaveLength(0);
  });

  it("NENHUM caminho de destino é aceito do renderer: só token opaco", async () => {
    const { chamar, chamadas } = montar();
    for (const ruim of ["/Users/x/projetos", "~/projetos", "../x", "d_", "d_ab", "C:\\x", "d_/etc/passwd", "ws_AAAAAAAAAAAA", `${TOKEN}\n`]) {
      await expect(chamar("workspaces:adicionar_clonar_iniciar", { ...CLONAR, destino_token: ruim }), ruim).rejects.toThrow();
      await expect(chamar("workspaces:adicionar_avaliar_destino", { destino_token: ruim, nome: "x" }), ruim).rejects.toThrow();
      await expect(chamar("workspaces:adicionar_novo_criar", { ...NOVO, destino_token: ruim }), ruim).rejects.toThrow();
    }
    expect(chamadas).toHaveLength(0);
  });

  it("campos do clone: booleanos de verdade, branch texto/null, URL limitada", async () => {
    const { chamar, chamadas } = montar();
    for (const ruim of [{ raso: "sim" }, { submodulos: 1 }, { consentimento: "true" }, { permitir_local: null }, { branch: 5 }, { entrada: "x".repeat(2501) }, { entrada: 5 }, { nome: "x".repeat(201) }]) {
      await expect(chamar("workspaces:adicionar_clonar_iniciar", { ...CLONAR, ...ruim })).rejects.toThrow();
    }
    expect(chamadas).toHaveLength(0);
    await chamar("workspaces:adicionar_clonar_iniciar", { ...CLONAR, branch: "feature/x" });
    expect(chamadas).toHaveLength(1);
  });

  it("a URL com credencial chega ao serviço como texto (a recusa é do serviço, no main) e o template é lista fechada", async () => {
    const { chamar, chamadas } = montar();
    await chamar("workspaces:adicionar_clonar_iniciar", { ...CLONAR, entrada: "https://u:p@x/y" });
    expect(chamadas).toHaveLength(1);
    await expect(chamar("workspaces:adicionar_novo_criar", { ...NOVO, template: "rust" })).rejects.toThrow();
    for (const t of ["vazio", "node", "python", "docs"]) await chamar("workspaces:adicionar_novo_criar", { ...NOVO, template: t });
  });

  it("ids: prefixo e formato exatos", async () => {
    const { chamar } = montar();
    await expect(chamar("workspaces:adicionar_clonar_cancelar", { clone_id: "bu_AbCdEfGhIjKl" })).rejects.toThrow();
    await expect(chamar("workspaces:adicionar_projetos_cancelar", { busca_id: "cl_AbCdEfGhIjKl" })).rejects.toThrow();
    await expect(chamar("workspaces:adicionar_projeto_achado", { achado_id: "/etc/passwd" })).rejects.toThrow();
  });

  it("remetente não autorizado é recusado antes do validador e do serviço", async () => {
    const { chamar, chamadas } = montar(undefined, false);
    for (const c of canais) await expect(chamar(c, VALIDOS[c])).rejects.toThrow();
    expect(chamadas).toHaveLength(0);
  });

  it("erro nominal atravessa como texto; erro desconhecido vira texto genérico (sem vazar detalhe)", async () => {
    const a = montar(new ErroAdicionarNucleo("destino_invalido", "A pasta de destino expirou."));
    await expect(a.chamar("workspaces:adicionar_destino_padrao", undefined)).rejects.toThrow("A pasta de destino expirou.");
    const b = montar(new Error("/Users/segredo/caminho interno"));
    const e = (await b.chamar("workspaces:adicionar_destino_padrao", undefined).catch((x: unknown) => x)) as Error;
    expect(e.message).not.toContain("segredo");
    expect(sanearErroAdicionar(new Error("x")).message).toBe("Não foi possível concluir a ação.");
  });
});
