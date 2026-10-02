// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instalar, remover } from "../../a11y/ade-falso";
import { cofreFalso, harnessFalso, decisor } from "../../a11y/ade-falso-harness";
import { storeLimites } from "../../estado/limites";
import { storeProvedores } from "../../estado/provedores";
import { storeWorkspaces } from "../../estado/workspaces";
import { TelaHarness } from "./index";

beforeEach(async () => {
  instalar();
  await storeWorkspaces.iniciar();
  await storeProvedores.carregar(true);
  await storeLimites.iniciar();
  await storeLimites.atualizar();
});
afterEach(() => { cleanup(); remover(); try { localStorage.clear(); } catch { /* sem storage */ } });

async function montar(h: Record<string, unknown> = {}, c: Record<string, unknown> = {}, aba?: Parameters<typeof TelaHarness>[0]["abaInicial"]) {
  const api = { ...harnessFalso(), ...h };
  const cofre = { ...cofreFalso(), ...c };
  await act(async () => { render(<TelaHarness api={api as never} apiCofre={cofre as never} {...(aba !== undefined ? { abaInicial: aba } : {})} />); });
  return { api, cofre };
}
const aba = async (nome: string) => { await act(async () => { fireEvent.click(screen.getByRole("tab", { name: nome })); }); };

describe("Harness: casca e Política", () => {
  it("uma linha de controles com abas, escopo, nível, modo de troca e limiar", async () => {
    await montar();
    const barra = screen.getByRole("toolbar", { name: "Controles do harness" });
    expect(within(screen.getByRole("tablist", { name: "Seções do harness" })).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Política", "Equivalência", "Contas e limites", "Decisões", "Cofre"]);
    expect(within(barra).getByLabelText("Modo de troca")).toBeTruthy();
    expect(within(barra).getByLabelText("Limiar de troca em porcentagem")).toBeTruthy();
  });
  it("modo de troca por workspace grava via gravarConfig (padrão do workspace = null)", async () => {
    const gravarConfig = vi.fn().mockImplementation(async (c: object) => ({ ...c, atualizado_em: "y" }));
    await montar({ gravarConfig });
    await waitFor(() => expect((screen.getByLabelText("Modo de troca") as HTMLSelectElement).disabled).toBe(false));
    await act(async () => { fireEvent.change(screen.getByLabelText("Modo de troca"), { target: { value: "automatico" } }); });
    expect(gravarConfig).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: "w1", modo_troca: "automatico" }));
    expect((gravarConfig.mock.calls[0]![0] as { atualizado_em?: string }).atualizado_em).toBeUndefined();
  });
  it("limiar fora de 50..99 é recusado com o motivo e não grava", async () => {
    const gravarConfig = vi.fn();
    await montar({ gravarConfig });
    await waitFor(() => expect((screen.getByLabelText("Limiar de troca em porcentagem") as HTMLInputElement).disabled).toBe(false));
    const campo = screen.getByLabelText("Limiar de troca em porcentagem");
    fireEvent.change(campo, { target: { value: "120" } });
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter" }); });
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join()).toMatch(/entre 50 e 99/);
    expect(gravarConfig).not.toHaveBeenCalled();
    fireEvent.change(campo, { target: { value: "90" } });
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter" }); });
    expect(gravarConfig).toHaveBeenCalledWith(expect.objectContaining({ limiar_troca_pct: 90 }));
  });
  it("política agrupada por categoria; executor desativado fica destacado e BLOQUEIA salvar com o motivo", async () => {
    const gravarPolitica = vi.fn();
    await montar({ gravarPolitica });
    const lista = await screen.findByRole("list", { name: "Política de roteamento" });
    expect(lista.textContent).toContain("Código");
    expect(lista.textContent).toContain("Revisão");
    const linhaRuim = within(lista).getByLabelText("Auditar, com problema");
    expect(linhaRuim.getAttribute("title")).toMatch(/desativado/);
    await act(async () => { fireEvent.click(within(lista).getByRole("button", { name: "Editar Auditar" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/Não é possível salvar.*aider.*desativado/);
    expect((screen.getByRole("button", { name: "Salvar Auditar" }) as HTMLButtonElement).disabled).toBe(true);
    // troca para um provedor ativo e salva
    await act(async () => { fireEvent.change(screen.getByLabelText("Provedor de Auditar"), { target: { value: "claude" } }); });
    expect(screen.getByRole("alert").textContent).toMatch(/Fallback 1.*codex.*desativado/);
    await act(async () => { fireEvent.change(screen.getByLabelText("Fallback de Auditar"), { target: { value: "claude" } }); });
    expect((screen.getByRole("button", { name: "Salvar Auditar" }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar Auditar" })); });
    expect(gravarPolitica).toHaveBeenCalledWith(expect.objectContaining({ task_type: "auditar", executor: expect.objectContaining({ provider: "claude" }) }));
  });
  it("teclado: Enter edita a linha, Esc cancela", async () => {
    await montar();
    const lista = await screen.findByRole("list", { name: "Política de roteamento" });
    const linha = within(lista).getByLabelText("Correção de bug");
    linha.focus();
    await act(async () => { fireEvent.keyDown(linha, { key: "Enter" }); });
    expect(screen.getByLabelText("Modelo de Correção de bug")).toBeTruthy();
    await act(async () => { fireEvent.keyDown(screen.getByLabelText("Modelo de Correção de bug"), { key: "Escape" }); });
    expect(screen.queryByLabelText("Modelo de Correção de bug")).toBeNull();
  });
  it("novo tipo valida e cria sem reiniciar", async () => {
    const gravarTaskType = vi.fn().mockResolvedValue({});
    await montar({ gravarTaskType });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Novo tipo de tarefa" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Criar tipo" })); });
    expect(screen.getByRole("alert").textContent).toMatch(/identificador/i);
    const dlg = screen.getByRole("dialog", { name: "Novo tipo de tarefa" });
    const campos = within(dlg).getAllByRole("textbox");
    fireEvent.change(campos[0]!, { target: { value: "migracao" } });
    fireEvent.change(campos[1]!, { target: { value: "codigo" } });
    fireEvent.change(campos[2]!, { target: { value: "Migração" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Criar tipo" })); });
    expect(gravarTaskType).toHaveBeenCalledWith({ slug: "migracao", categoria: "codigo", rotulo: "Migração", descricao: null });
  });
  it("restaurar semente pede confirmação própria (nunca window.confirm)", async () => {
    const confirmar = vi.spyOn(window, "confirm");
    const restaurarSemente = vi.fn().mockResolvedValue([]);
    await montar({ restaurarSemente });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Restaurar semente" })); });
    expect(restaurarSemente).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Restaurar" })); });
    expect(restaurarSemente).toHaveBeenCalledWith(null);
    expect(confirmar).not.toHaveBeenCalled();
  });
  it("sem canal de política: estado indisponível explicativo", async () => {
    await montar({ listarPoliticas: undefined });
    expect(await screen.findByText("Política indisponível")).toBeTruthy();
  });
});

describe("Harness: Equivalência", () => {
  it("grade provedor × faixa, selo padrão/alterado, aviso P-31 e grava só a diferença", async () => {
    const gravarEquivalencia = vi.fn().mockResolvedValue({});
    await montar({ gravarEquivalencia }, {}, "equivalencia");
    expect((await screen.findByRole("note")).textContent).toMatch(/equivalentes em qualidade e custo/);
    expect(screen.getAllByText("padrão").length).toBeGreaterThan(0);
    const celula = screen.getByLabelText("codex, faixa topo");
    fireEvent.change(celula, { target: { value: "gpt-6@high" } });
    await act(async () => { fireEvent.keyDown(celula, { key: "Enter" }); });
    expect(gravarEquivalencia).toHaveBeenCalledWith({ codex: { topo: [{ modelo: "gpt-6", esforco: "high" }] } });
  });
  it("valor inválido é recusado com o motivo e não grava", async () => {
    const gravarEquivalencia = vi.fn();
    await montar({ gravarEquivalencia }, {}, "equivalencia");
    const celula = await screen.findByLabelText("claude, faixa topo");
    fireEvent.change(celula, { target: { value: "modelo ruim!" } });
    await act(async () => { fireEvent.keyDown(celula, { key: "Enter" }); });
    expect(screen.getByRole("alert").textContent).toMatch(/Modelo inválido/);
    expect(gravarEquivalencia).not.toHaveBeenCalled();
  });
});

describe("Harness: Contas e limites", () => {
  it("aviso de termos fixo, config de troca por workspace e contas com 'sem dado'", async () => {
    const gravarConfig = vi.fn().mockImplementation(async (c: object) => c);
    await montar({ gravarConfig }, {}, "contas");
    expect((await screen.findAllByRole("note"))[0]!.textContent).toMatch(/nunca lê credenciais.*termos de cada provedor/);
    const sel = await screen.findByLabelText("Faixa mínima na troca");
    await act(async () => { fireEvent.change(sel, { target: { value: "descer_1" } }); });
    expect(gravarConfig).toHaveBeenCalledWith(expect.objectContaining({ faixa_minima_troca: "descer_1" }));
    expect(screen.getByLabelText("Conta pessoal")).toBeTruthy();
  });
  it("papel desconhecido e teto inválido são recusados", async () => {
    const gravarContaConfig = vi.fn();
    await montar({ gravarContaConfig }, {}, "contas");
    await screen.findByLabelText("Conta pessoal");
    fireEvent.change(screen.getByLabelText("Papéis reservados de pessoal"), { target: { value: "chefe" } });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Salvar" })[0]!); });
    expect(screen.getAllByRole("alert")[0]!.textContent).toMatch(/Papel desconhecido/);
    fireEvent.change(screen.getByLabelText("Papéis reservados de pessoal"), { target: { value: "piloto" } });
    fireEvent.change(screen.getByLabelText("Teto de tokens 5 horas de pessoal"), { target: { value: "-3" } });
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Salvar" })[0]!); });
    expect(screen.getAllByRole("alert")[0]!.textContent).toMatch(/inteiros positivos/);
    expect(gravarContaConfig).not.toHaveBeenCalled();
  });
});

describe("Harness: Decisões e consentimento", () => {
  it("decisor vem desligado; ligar exige consentimento marcado; chave vai ao cofre e some do DOM", async () => {
    const gravarDecisor = vi.fn().mockResolvedValue(decisor);
    const gravar = vi.fn().mockResolvedValue({});
    const { cofre } = await montar({ gravarDecisor }, { gravar, listar: vi.fn().mockResolvedValue([]) }, "decisoes");
    const sw = await screen.findByRole("switch", { name: "Decisor externo" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    await act(async () => { fireEvent.click(sw); });
    const dlg = screen.getByRole("dialog", { name: "Ligar o decisor externo" });
    expect(dlg.textContent).toMatch(/Nunca saem: código-fonte/);
    const ligar = within(dlg).getByRole("button", { name: "Ligar decisor" }) as HTMLButtonElement;
    expect(ligar.disabled).toBe(true);
    fireEvent.change(within(dlg).getByPlaceholderText("https://api.exemplo.com/v1"), { target: { value: "http://x.com" } });
    expect(within(dlg).getByRole("alert").textContent).toMatch(/https/);
    fireEvent.change(within(dlg).getByPlaceholderText("https://api.exemplo.com/v1"), { target: { value: "https://api.exemplo.com/v1" } });
    const chave = dlg.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(chave, { target: { value: "SEGREDO-123" } });
    fireEvent.click(within(dlg).getByRole("checkbox", { name: /Li o que sai da máquina/ }));
    expect(ligar.disabled).toBe(false);
    await act(async () => { fireEvent.click(ligar); });
    expect(gravar).toHaveBeenCalledWith(expect.objectContaining({ nome: "DECISOR_CHAVE", valor: "SEGREDO-123", sensivel: true }));
    expect(gravarDecisor).toHaveBeenCalledWith(expect.objectContaining({ habilitado: true, chave_ref: "DECISOR_CHAVE", consentimento: { host: "api.exemplo.com", modo: "jev_direto" } }));
    expect(JSON.stringify(gravarDecisor.mock.calls)).not.toContain("SEGREDO-123");
    expect(document.body.innerHTML).not.toContain("SEGREDO-123");
    void cofre;
  });
  it("'testar sem salvar' não grava no cofre", async () => {
    const testarDecisor = vi.fn().mockResolvedValue({ ok: true, latencia_ms: 12 });
    const gravar = vi.fn();
    await montar({ testarDecisor }, { gravar }, "decisoes");
    await act(async () => { fireEvent.click(await screen.findByRole("switch", { name: "Decisor externo" })); });
    const dlg = screen.getByRole("dialog");
    fireEvent.change(within(dlg).getByPlaceholderText("https://api.exemplo.com/v1"), { target: { value: "https://api.exemplo.com/v1" } });
    await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Testar sem salvar" })); });
    expect(testarDecisor).toHaveBeenCalled();
    expect(gravar).not.toHaveBeenCalled();
    expect(within(dlg).getByRole("status").textContent).toMatch(/Conexão ok/);
  });
  it("desligar apaga o consentimento", async () => {
    const gravarDecisor = vi.fn().mockResolvedValue(decisor);
    const ligado = { ...decisor, habilitado: true, consentimento: { host: "a.com", modo: "jev_direto" as const, em: "x" } };
    await montar({ lerDecisor: async () => ligado, gravarDecisor }, {}, "decisoes");
    await act(async () => { fireEvent.click(await screen.findByRole("switch", { name: "Decisor externo" })); });
    expect(gravarDecisor).toHaveBeenCalledWith(expect.objectContaining({ habilitado: false, consentimento: null }));
  });
  it("custo null renderiza 'custo desconhecido', nunca US$ 0,00", async () => {
    await montar({}, {}, "decisoes");
    const lista = await screen.findByRole("list", { name: "Decisões recentes" });
    expect(lista.textContent).toContain("custo desconhecido");
    expect(lista.textContent).toContain("conta cl·1 reseta antes");
    expect(document.body.textContent).not.toMatch(/US\$\s?0,00/);
  });
  it("5 000 decisões: só as linhas visíveis existem no DOM", async () => {
    const muitas = Array.from({ length: 5000 }, (_, i) => ({ id: `d${i}`, criado_em: "2026-10-01T10:00:00Z", proposito: "selecao_conta", pane_id: null, tipo: "choice", fonte: "regra", confianca: null, divergiu: false, custo_usd: null, custo_origem: null, recibo: `r${i}` }));
    await montar({ listarDecisoes: async () => ({ itens: muitas, proximo: null, totais: { consultas: 5000, custo_usd: null, custo_desconhecido: 5000 } }) }, {}, "decisoes");
    const lista = await screen.findByRole("list", { name: "Decisões recentes" });
    expect(within(lista).getAllByRole("listitem").length).toBeLessThan(60);
    expect(screen.getByText(/5000 consultas/)).toBeTruthy();
  });
});

describe("Harness: Cofre", () => {
  it("lista só metadados com valor mascarado, sem copiar nem revelar", async () => {
    await montar({}, {}, "cofre");
    const lista = await screen.findByRole("list", { name: "Entradas do cofre" });
    expect(lista.textContent).toContain("OPENROUTER_CHAVE");
    expect(lista.textContent).toContain("sensível");
    expect(lista.textContent).toContain("••••");
    expect(within(lista).queryByRole("button", { name: /copiar|revelar|mostrar/i })).toBeNull();
  });
  it("nova entrada valida o nome, grava o valor uma vez e descarta do estado", async () => {
    const gravar = vi.fn().mockResolvedValue({});
    await montar({}, { gravar }, "cofre");
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Nova entrada" })); });
    const dlg = screen.getByRole("dialog", { name: "Nova entrada do cofre" });
    const nome = within(dlg).getByPlaceholderText("MINHA_CHAVE");
    fireEvent.change(nome, { target: { value: "1ruim" } });
    expect(within(dlg).getByRole("alert").textContent).toMatch(/MAIÚSCULAS/);
    fireEvent.change(nome, { target: { value: "MINHA_CHAVE" } });
    const valor = dlg.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(valor, { target: { value: "s3gredo" } });
    await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Gravar no cofre" })); });
    expect(gravar).toHaveBeenCalledWith({ id: null, nome: "MINHA_CHAVE", escopo: "global", workspace_id: null, sensivel: true, valor: "s3gredo" });
    expect(document.body.innerHTML).not.toContain("s3gredo");
  });
  it("apagar pede confirmação própria", async () => {
    const apagar = vi.fn().mockResolvedValue(true);
    await montar({}, { apagar }, "cofre");
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Apagar OPENROUTER_CHAVE" })); });
    expect(apagar).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apagar entrada" })); });
    expect(apagar).toHaveBeenCalledWith("e1");
  });
  it("cofre indisponível mostra o motivo e o próximo passo; trancado pede senha-mestra", async () => {
    await montar({}, { disponivel: async () => ({ ok: false, backend: "indisponivel", bloqueado: false, motivo: "Sem keyring." }) }, "cofre");
    expect(await screen.findByText(/Sem keyring\..*senha-mestra/)).toBeTruthy();
    cleanup();
    const desbloquear = vi.fn().mockResolvedValue({ ok: true, backend: "senha_mestra", bloqueado: false });
    await montar({}, { disponivel: async () => ({ ok: true, backend: "senha_mestra", bloqueado: true }), desbloquear }, "cofre");
    fireEvent.change(await screen.findByLabelText("Senha-mestra"), { target: { value: "abc" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Desbloquear" })); });
    expect(desbloquear).toHaveBeenCalledWith("abc");
    expect(document.body.innerHTML).not.toContain('value="abc"');
  });
  it("sem API do cofre: indisponível", async () => {
    await montar({}, { disponivel: undefined }, "cofre");
    expect(await screen.findByText("Cofre indisponível")).toBeTruthy();
  });
});
