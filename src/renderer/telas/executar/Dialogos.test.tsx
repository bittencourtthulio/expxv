// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigExecucaoIpc, ItemConfigExecucao, ListaExecucao } from "../../../compartilhado/executar";
import { criarStoreExecutar } from "../../estado/executar";
import Dialogos, { paraConfig } from "./Dialogos";

afterEach(cleanup);

const WS = "ws_AAAAAAAAAAAA";
const item = (id: string, nome: string, extra: Partial<ItemConfigExecucao> = {}): ItemConfigExecucao => ({
  id, nome, tipo: "rodar", executavel: "npm", argumentos: ["run", id], cwd: ".", ambiente: {}, pre_passos: [], porta: null, url: null, abrir_navegador: false, reiniciar_ao_salvar: false, grupo: null, shell: null,
  origem: "detectada", padrao: false, confiavel: false, comando: `npm run ${id}`, ...extra,
});
const lista = (itens: ItemConfigExecucao[], armazenamento: ListaExecucao["armazenamento"] = "nenhum"): ListaExecucao => ({ workspace_id: WS, configuracoes: itens, padrao_id: itens.find((i) => i.padrao)?.id ?? null, armazenamento, vazio: itens.length === 0 });

async function abrir(l: ListaExecucao, modo: "editar" | "novo" = "editar") {
  const api = {
    listar: vi.fn(async () => l),
    gravarConfig: vi.fn(async (_ws: string, c: ConfigExecucaoIpc) => lista([...l.configuracoes, { ...item(c.id, c.nome), ...c, origem: "usuario" as const, comando: "x" }], "arquivo")),
    removerConfig: vi.fn(async () => lista([])),
    definirPadrao: vi.fn(async () => l),
    revogarConfianca: vi.fn(async () => l),
    estado: vi.fn(), assinar: vi.fn(() => () => undefined),
  };
  const store = criarStoreExecutar({ api: () => api as never, workspaces: { obter: () => ({ atual: { id: WS } }) as never, assinar: () => () => undefined }, ocioso: () => undefined });
  store.ligar();
  store.abrirEditor(modo);
  render(<Dialogos store={store} />);
  await screen.findByRole("dialog");
  return { api, store };
}

describe("paraConfig (rascunho → contrato)", () => {
  const base = { id: "", novo: true, nome: "Meu app", tipo: "rodar" as const, executavel: "npm", argumentos: "run dev -- --host", cwd: ".", ambiente: "", prePassos: "", porta: "", url: "", abrirNavegador: false, reiniciarAoSalvar: false, grupo: "", usarShell: false, shell: "", confirmouShell: false };
  it("divide argumentos, ambiente e pré-passos; gera id sem colisão", () => {
    const r = paraConfig({ ...base, ambiente: "A=1\nB=2", prePassos: "npm ci\nnpm run build -- --prod", porta: "3000" }, new Set(["meu-app"]));
    expect(r.ok && r.config).toMatchObject({
      id: "meu-app-2", nome: "Meu app", executavel: "npm", argumentos: ["run", "dev", "--", "--host"], ambiente: { A: "1", B: "2" }, porta: 3000, shell: null,
      pre_passos: [{ executavel: "npm", argumentos: ["ci"] }, { executavel: "npm", argumentos: ["run", "build", "--", "--prod"] }],
    });
  });
  it.each([
    [{ argumentos: "a 'b" }, /Argumentos: aspas/],
    [{ ambiente: "ruim" }, /Ambiente, linha 1/],
    [{ prePassos: "a 'b" }, /Pré-passo 1/],
    [{ porta: "abc" }, /Porta/],
    [{ porta: "70000" }, /Porta/],
    [{ executavel: "  " }, /programa/],
    [{ usarShell: true, shell: " " }, /linha de comando/],
  ])("erro de edição %j", (extra, esperado) => {
    const r = paraConfig({ ...base, ...extra }, new Set());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(esperado);
  });
  it("com shell, executável e argumentos vão vazios e a linha vai no campo shell", () => {
    const r = paraConfig({ ...base, usarShell: true, shell: "make && ./app" }, new Set());
    expect(r.ok && r.config).toMatchObject({ executavel: "", argumentos: [], shell: "make && ./app" });
  });
  it("configuração existente mantém o id", () => {
    const r = paraConfig({ ...base, id: "dev", novo: false }, new Set(["dev"]));
    expect(r.ok && r.config.id).toBe("dev");
  });
});

describe("editor de configurações", () => {
  it("lista as configurações (padrão, procedência e confiança), seleciona a padrão e mostra o comando que será executado", async () => {
    await abrir(lista([item("dev", "Rodar (dev)", { padrao: true, confiavel: true }), item("build", "Build completo", { tipo: "build" })], "arquivo"));
    const nav = screen.getByRole("navigation", { name: "Configurações do projeto" });
    expect(within(nav).getByText("padrão · detectada · confiável")).toBeTruthy();
    expect(within(nav).getByText(/Salvas em/).textContent).toContain("/executar.json");
    await waitFor(() => expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Rodar (dev)"));
    expect(screen.getByLabelText("Comando que será executado").textContent).toBe("npm run dev");
    fireEvent.click(within(nav).getByRole("button", { name: /Build completo/ }));
    expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Build completo");
  });

  it("assistente (nada detectado): parte de um modelo, valida e grava com origem do usuário", async () => {
    const m = await abrir(lista([]), "novo");
    expect(screen.getByRole("heading").textContent).toBe("Configurar execução do projeto");
    fireEvent.change(screen.getByLabelText("Começar de um modelo"), { target: { value: "Go: go run ." } });
    expect((screen.getByLabelText("Programa") as HTMLInputElement).value).toBe("go");
    expect((screen.getByLabelText("Argumentos") as HTMLInputElement).value).toBe("run .");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(m.api.gravarConfig).toHaveBeenCalledTimes(1));
    const [ws, config, confirmou] = m.api.gravarConfig.mock.calls[0] as unknown as [string, ConfigExecucaoIpc, boolean];
    expect(ws).toBe(WS);
    expect(config).toMatchObject({ id: "go-run", nome: "go run .", executavel: "go", argumentos: ["run", "."], cwd: ".", shell: null, porta: null });
    expect(confirmou).toBe(false);
    expect("origem" in config).toBe(false);
  });

  it("erro de edição aparece como alerta e não grava; erro do main (validação estrita) também", async () => {
    const m = await abrir(lista([]), "novo");
    fireEvent.change(screen.getByLabelText("Argumentos"), { target: { value: "a 'b" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/aspas abertas/);
    expect(m.api.gravarConfig).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Argumentos"), { target: { value: "run dev" } });
    m.api.gravarConfig.mockRejectedValueOnce(new Error("cwd: caminho deve ser relativo à raiz do workspace"));
    fireEvent.change(screen.getByLabelText("Pasta de execução (relativa)"), { target: { value: "/etc" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("caminho deve ser relativo"));
  });

  it("usar shell exige marcar a confirmação do comando exato antes de gravar", async () => {
    const m = await abrir(lista([]), "novo");
    fireEvent.click(screen.getByLabelText(/Usar shell/));
    fireEvent.change(screen.getByLabelText(/Linha de comando/), { target: { value: "make build && ./app" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("confirmação");
    expect(m.api.gravarConfig).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/Entendo que esta linha roda em um shell/));
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(m.api.gravarConfig).toHaveBeenCalledTimes(1));
    const [, config, confirmou] = m.api.gravarConfig.mock.calls[0] as unknown as [string, ConfigExecucaoIpc, boolean];
    expect(config).toMatchObject({ shell: "make build && ./app", executavel: "", argumentos: [] });
    expect(confirmou).toBe(true);
    expect(screen.getByLabelText("Comando que será executado").textContent).toBe("[shell] make build && ./app");
  });

  it("segredo no ambiente é lembrado como referência do cofre; ações da configuração do usuário (excluir, revogar, padrão)", async () => {
    const m = await abrir(lista([item("dev", "Rodar (dev)", { padrao: false, origem: "usuario", confiavel: true, ambiente: { API_KEY: "{{vault:CHAVE}}" } })]));
    await waitFor(() => expect((screen.getByLabelText(/Variáveis de ambiente/) as HTMLTextAreaElement).value).toBe("API_KEY={{vault:CHAVE}}"));
    fireEvent.click(screen.getByRole("button", { name: "Revogar confiança" }));
    await waitFor(() => expect(m.api.revogarConfianca).toHaveBeenCalledWith(WS, "dev"));
    fireEvent.click(screen.getByRole("button", { name: "Definir como padrão" }));
    await waitFor(() => expect(m.api.definirPadrao).toHaveBeenCalledWith(WS, "dev"));
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(m.api.removerConfig).toHaveBeenCalledWith(WS, "dev"));
  });

  it("configuração detectada não tem 'Excluir'; pasta não gravável avisa que fica nos dados do app", async () => {
    await abrir(lista([item("dev", "Rodar (dev)", { padrao: true })], "app"));
    await waitFor(() => expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Rodar (dev)"));
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();
    expect(screen.getByText(/nos dados do app/)).toBeTruthy();
  });

  it("Fechar e Esc fecham o diálogo", async () => {
    const m = await abrir(lista([item("dev", "Rodar (dev)", { padrao: true })]));
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(m.store.obter().editor).toBe(false);
  });

  it("prechecagem (D-581): mostra o aviso da configuração e adiciona o pré-passo sugerido SÓ no clique", async () => {
    await abrir(lista([item("dev", "desktop · Rodar (dev)", { padrao: true, cwd: "desktop", avisos: [{ codigo: "sem_node_modules", mensagem: "A pasta de desktop ainda não tem node_modules. Rode \"npm install\" primeiro.", pre_passo: { executavel: "npm", argumentos: ["install"] } }, { codigo: "sem_docker", mensagem: "O Docker não foi encontrado nesta máquina.", pre_passo: null }] })]));
    const grupo = await screen.findByRole("group", { name: "Avisos antes de executar" });
    expect(grupo.textContent).toMatch(/ainda não tem node_modules/);
    expect(grupo.textContent).toMatch(/Docker não foi encontrado/);
    expect((screen.getByLabelText(/Pré-passos/) as HTMLTextAreaElement).value).toBe("");
    const botoes = within(grupo).getAllByRole("button");
    expect(botoes).toHaveLength(1); // só o aviso com pré-passo sugerido tem botão
    fireEvent.click(botoes[0]!);
    expect((screen.getByLabelText(/Pré-passos/) as HTMLTextAreaElement).value).toBe("npm install");
    expect(screen.getByLabelText("Comando que será executado").textContent).toBe("npm install\nnpm run dev");
    expect(within(grupo).queryByRole("button")).toBeNull(); // já adicionado: o botão some
  });

  it("sem aviso, não há bloco de prechecagem", async () => {
    await abrir(lista([item("dev", "Rodar (dev)", { padrao: true })]));
    await waitFor(() => expect((screen.getByLabelText("Nome") as HTMLInputElement).value).toBe("Rodar (dev)"));
    expect(screen.queryByRole("group", { name: "Avisos antes de executar" })).toBeNull();
  });
});
