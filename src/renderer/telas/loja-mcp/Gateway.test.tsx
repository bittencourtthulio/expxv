// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigGateway, EntradaAuditoriaGateway, FerramentaGateway } from "../../../compartilhado/catalogo";
import type { ApiAde } from "../../../compartilhado/ipc";
import { formatar, varrer } from "../../a11y/varredura";
import { criarStoreGateway } from "../../estado/gateway";
import { DialogoGateway, horaCurta, paneCurto, tamanho } from "./Gateway";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const CFG: ConfigGateway = { workspace_id: "w1", ativo: false, modo_superficie: "reduzido", max_ferramentas: 40, limite_por_min: 60, ocioso_s: 300, atualizado_em: null };
const FERR: FerramentaGateway[] = [
  { servidor_id: "git", nome: "git_status", descricao: "lê", habilitada: true, explicita: false, risco: "leitura" },
  { servidor_id: "git", nome: "git_push", descricao: "escreve", habilitada: false, explicita: true, risco: "escrita" },
];
const AUD: EntradaAuditoriaGateway[] = [{ id: "a1", em: "2026-10-01T12:00:00.000Z", workspace_id: "w1", pane_id: "pane_abcdefghijklmnop", papel: "executor", servidor_id: "git", ferramenta: "git_push", decisao: "negada_filtro", duracao_ms: null, bytes_entrada: 120, bytes_saida: null }];

function api(): ApiAde["gateway"] {
  return {
    estado: vi.fn().mockResolvedValue({ disponivel: true, panes_ativos: 2, servidores_conectados: 1, chamadas: 10, bloqueadas: 1, limitadas: 0 }),
    configLer: vi.fn().mockResolvedValue(CFG),
    configGravar: vi.fn(async (p) => ({ ...CFG, ...p, atualizado_em: "x" })),
    ferramentas: vi.fn().mockResolvedValue(FERR),
    filtroDefinir: vi.fn().mockResolvedValue({ ok: true }),
    auditoria: vi.fn().mockResolvedValue(AUD),
    revogarPane: vi.fn().mockResolvedValue({ ok: true }),
    assinar: vi.fn(() => () => undefined),
  };
}
async function montar(a = api(), ws: string | null = "w1") {
  const store = criarStoreGateway({ api: () => a, workspace: () => ws, atrasoMs: 5 });
  await act(async () => { render(<DialogoGateway store={store} workspaceId={ws} servidores={[{ id: "git", nome: "Git" }]} aoFechar={() => undefined} />); });
  await screen.findByTestId("estado-gateway");
  return { a, store };
}
const clicar = (el: HTMLElement) => act(async () => { fireEvent.click(el); });

describe("Gateway MCP (painel da Loja)", () => {
  it("nasce DESLIGADO (opt-in), mostra o estado e a auditoria só com metadados; sem violação de a11y", async () => {
    await montar();
    expect((screen.getByLabelText("Usar o Gateway neste workspace") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("estado-gateway").textContent).toContain("2 Pane(s)");
    expect(screen.getByText(/Desligado por padrão/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Chamadas auditadas" })).toBeTruthy();
    expect(document.body.textContent).toContain("negada (filtro)");
    expect(document.body.textContent).not.toMatch(/argumentos|resultado:/i);
    const a = varrer(document.body);
    expect(a.length === 0 ? "" : formatar(a)).toBe("");
  });

  it("ligar e gravar chama configGravar com o pedido completo", async () => {
    const { a } = await montar();
    await clicar(screen.getByLabelText("Usar o Gateway neste workspace"));
    await act(async () => { fireEvent.change(screen.getByLabelText("Superfície de ferramentas"), { target: { value: "busca" } }); });
    await clicar(screen.getByRole("button", { name: "Gravar configuração" }));
    await waitFor(() => expect(a.configGravar).toHaveBeenCalledWith({ workspace_id: "w1", ativo: true, modo_superficie: "busca", max_ferramentas: 40, limite_por_min: 60, ocioso_s: 300 }));
    expect(await screen.findByText("Configuração gravada.")).toBeTruthy();
  });

  it("valores fora da faixa desabilitam o gravar", async () => {
    await montar();
    await act(async () => { fireEvent.change(screen.getByLabelText(/Chamadas por minuto/), { target: { value: "9999" } }); });
    expect((screen.getByRole("button", { name: "Gravar configuração" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Valores fora da faixa.")).toBeTruthy();
  });

  it("filtro por papel: escolhe servidor, lista ferramentas e alterna uma (otimista, com regra explícita)", async () => {
    const { a } = await montar();
    await act(async () => { fireEvent.change(screen.getByLabelText("Servidor"), { target: { value: "git" } }); });
    const lista = await screen.findByRole("list", { name: "Ferramentas do servidor" });
    expect(a.ferramentas).toHaveBeenCalledWith({ workspace_id: "w1", servidor_id: "git", papel: "executor" });
    const push = within(lista).getByRole("checkbox", { name: /git_push/ }) as HTMLInputElement;
    expect(push.checked).toBe(false);
    await clicar(push);
    await waitFor(() => expect(a.filtroDefinir).toHaveBeenCalledWith({ workspace_id: "w1", servidor_id: "git", ferramenta: "git_push", papel: "executor", habilitada: true }));
    await act(async () => { fireEvent.change(screen.getByLabelText("Papel"), { target: { value: "revisor" } }); });
    await waitFor(() => expect(a.ferramentas).toHaveBeenLastCalledWith({ workspace_id: "w1", servidor_id: "git", papel: "revisor" }));
  });

  it("recusa do main reverte a alteração otimista e mostra erro", async () => {
    const a = api();
    a.filtroDefinir = vi.fn().mockResolvedValue({ ok: false });
    await montar(a);
    await act(async () => { fireEvent.change(screen.getByLabelText("Servidor"), { target: { value: "git" } }); });
    const push = (await screen.findByRole("checkbox", { name: /git_push/ })) as HTMLInputElement;
    await clicar(push);
    await waitFor(() => expect((screen.getByRole("checkbox", { name: /git_push/ }) as HTMLInputElement).checked).toBe(false));
    expect((await screen.findByRole("alert")).textContent).toContain("recusou");
  });

  it("revogar Pane chama a API para o Pane escolhido", async () => {
    const { a } = await montar();
    await act(async () => { fireEvent.change(screen.getByLabelText("Revogar acesso de um Pane"), { target: { value: "pane_abcdefghijklmnop" } }); });
    await clicar(screen.getByRole("button", { name: "Revogar" }));
    await waitFor(() => expect(a.revogarPane).toHaveBeenCalledWith("pane_abcdefghijklmnop"));
  });

  it("sem workspace: pede para abrir um projeto e não oferece configuração", async () => {
    await montar(api(), null);
    expect(screen.getByText(/Abra um projeto para configurar o Gateway/)).toBeTruthy();
    expect(screen.queryByLabelText("Usar o Gateway neste workspace")).toBeNull();
  });

  it("sem a API mostra indisponível", async () => {
    const store = criarStoreGateway({ api: () => undefined });
    await act(async () => { render(<DialogoGateway store={store} workspaceId={null} servidores={[]} aoFechar={() => undefined} />); });
    expect(await screen.findByText(/precisa do aplicativo desktop/)).toBeTruthy();
  });

  it("formatadores são tolerantes", () => {
    expect(horaCurta("lixo")).toBe("—");
    expect(paneCurto("curto")).toBe("curto");
    expect(tamanho(null)).toBe("—");
    expect(tamanho(2048)).toBe("2.0 KB");
  });
});
