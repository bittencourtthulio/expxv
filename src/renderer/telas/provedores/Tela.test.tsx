// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProvedorInfo } from "../../../compartilhado/dominio";
import { criarStoreProvedores } from "../../estado/provedores";
import { TelaProvedores } from "./index";

const rec = { prompt_inicial: true, retomar: true, mcp: true, hook: true };
const claude: ProvedorInfo = { ferramenta: { id: "claude", nome: "Claude Code", descricao: "CLI", instalado: true, executavel_id: "e", modo_lancamento: "direto", erro_codigo: null, versao: "2.0.1", recursos: rec }, contas: [{ id: "c1", provedor: "claude", rotulo: "pessoal", config_dir_ref: null, habilitada: true, criado_em: "x", atualizado_em: "x" }] };
const codex: ProvedorInfo = { ferramenta: { id: "codex", nome: "Codex", descricao: "CLI", instalado: false, executavel_id: null, modo_lancamento: null, erro_codigo: "ausente", versao: null, recursos: rec }, contas: [] };
const aider: ProvedorInfo = { ferramenta: { ...codex.ferramenta, id: "aider", nome: "Aider", erro_codigo: "sem_permissao" }, contas: [] };
const qwen: ProvedorInfo = { ferramenta: { ...codex.ferramenta, id: "qwen", nome: "Qwen", erro_codigo: "nao_mapeado" }, contas: [] };

async function montar(lista = [claude, codex, aider, qwen]) {
  const api = {
    listar: vi.fn().mockResolvedValue(lista), criarConta: vi.fn().mockResolvedValue({ ...claude.contas[0]!, id: "c2", rotulo: "trabalho" }),
    habilitarConta: vi.fn().mockResolvedValue({ ...claude.contas[0]!, habilitada: false }), diagnostico: vi.fn().mockResolvedValue({ texto: "diag: ok" }),
  };
  const store = criarStoreProvedores({ api: () => api });
  await act(async () => { render(<TelaProvedores store={store} />); });
  return api;
}

describe("Tela de provedores", () => {
  it("mostra versão, estados e instrução de instalação quando falta", async () => {
    await montar();
    expect(screen.getByText("2.0.1")).toBeTruthy();
    expect(screen.getByText("Instalada")).toBeTruthy();
    expect(screen.getByText("Ausente")).toBeTruthy();
    expect(screen.getByText("Sem permissão")).toBeTruthy();
    expect(screen.getByText("Não mapeada")).toBeTruthy();
    expect(screen.getByText(/npm install -g @openai\/codex/)).toBeTruthy();
  });
  it("Atualizar força a detecção", async () => {
    const api = await montar();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Atualizar" })); });
    expect(api.listar).toHaveBeenLastCalledWith(true);
  });
  it("cria conta e habilita/desabilita", async () => {
    const api = await montar();
    fireEvent.change(screen.getByLabelText(/Rótulo da nova conta/), { target: { value: "trabalho" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Criar conta" })); });
    expect(api.criarConta).toHaveBeenCalledWith("claude", "trabalho");
    await act(async () => { fireEvent.click(screen.getAllByRole("switch")[0]!); });
    expect(api.habilitarConta).toHaveBeenCalledWith("c1", false);
  });
  it("diagnóstico copiável vai para a área de transferência", async () => {
    await montar();
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Diagnóstico" })); });
    expect((screen.getByLabelText("Diagnóstico") as HTMLTextAreaElement).value).toBe("diag: ok");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copiar" })); });
    expect(escrever).toHaveBeenCalledWith("diag: ok");
  });
  it("lista vazia mostra estado vazio explicativo", async () => {
    await montar([]);
    expect(screen.getByText("Nenhuma CLI detectada")).toBeTruthy();
  });
});
