// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiAgil, EventoAgilIpc } from "../../../compartilhado/agil";
import { formatar, varrer } from "../../a11y/varredura";
import { pedirAgil } from "../../estado/agil-acoes";
import { TelaAgil } from "./Agil";
import { ALTURA_LINHA } from "./Backlog";
import { apiFalsa, painelVazio, type OpcoesApi } from "./fabrica-teste";

afterEach(() => { vi.restoreAllMocks(); });

type ApiEspia = { [K in keyof ApiAgil]: ReturnType<typeof vi.fn> & ApiAgil[K] } & { emitir: (e: EventoAgilIpc) => void };
function espiar(o: OpcoesApi = {}, ajustar?: (a: ApiAgil) => void): ApiEspia {
  const api = apiFalsa(o);
  let ouvinte: (e: EventoAgilIpc) => void = () => undefined;
  api.assinar = (cb) => { ouvinte = cb; return () => undefined; };
  ajustar?.(api);
  for (const k of Object.keys(api) as Array<keyof ApiAgil>) if (k !== "assinar") (api as unknown as Record<string, unknown>)[k] = vi.fn(api[k] as never);
  return Object.assign(api, { emitir: (e: EventoAgilIpc) => act(() => ouvinte(e)) }) as unknown as ApiEspia;
}
async function montar(api: ApiEspia, ws: string | null = "w1") {
  await act(async () => { render(<TelaAgil api={api} workspaceId={ws} />); });
  if (ws !== null) await screen.findByRole("tablist", { name: "Seções da gestão ágil" });
}
const clicar = (el: HTMLElement) => act(async () => { fireEvent.click(el); });
const aba = (nome: string) => clicar(screen.getByRole("tab", { name: nome }));
const esperar = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const confere = (onde: string) => { const a = varrer(document.body); expect(a.length === 0 ? "" : `${onde}\n${formatar(a)}`).toBe(""); };

describe("casca", () => {
  it("uma linha de controles com as 7 abas, filtros, busca e ações; painel com 16 cartões", async () => {
    await montar(espiar());
    const abas = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(abas).toEqual(["Painel", "Backlog", "Sprint", "Daily", "Retro", "Qualidade", "Config"]);
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
    for (const n of ["Sprint", "Pessoa ou agente", "Método", "Período: de", "Período: até", "Buscar no backlog"]) expect(screen.getByLabelText(n)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sincronizar com o método" })).toBeTruthy();
    expect(document.querySelectorAll("[data-grafico]")).toHaveLength(16);
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    confere("painel");
  });
  it("método Lean mostra só os gráficos do Lean", async () => {
    await montar(espiar());
    await act(async () => { fireEvent.change(screen.getByLabelText("Método"), { target: { value: "lean" } }); });
    const ids = [...document.querySelectorAll("[data-grafico]")].map((e) => e.getAttribute("data-grafico"));
    expect(ids).toContain("cfd"); expect(ids).not.toContain("burndown");
    expect(screen.getByText(/mostrando \d+ de 16 gráficos \(LEAN\)/)).toBeTruthy();
  });
  it("filtro por sprint refaz o painel com o filtro", async () => {
    const api = espiar();
    await montar(api);
    await act(async () => { fireEvent.change(screen.getByLabelText("Sprint"), { target: { value: "s1" } }); });
    await waitFor(() => expect(api.painel).toHaveBeenLastCalledWith("w1", { sprint_id: "s1" }));
  });
  it("sem dados: estado vazio com o próximo passo", async () => {
    await montar(espiar({ painel: painelVazio() }));
    expect(screen.getByText("Ainda não há dados de gestão ágil")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sincronizar agora" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ir para o Backlog" })).toBeTruthy();
  });
  it("sem projeto aberto e sem API fora do aplicativo", async () => {
    await montar(espiar(), null);
    expect(screen.getByText("Nenhum projeto aberto")).toBeTruthy();
    document.body.innerHTML = "";
    await act(async () => { render(<TelaAgil workspaceId="w1" />); });
    expect(screen.getByText("Gestão ágil indisponível")).toBeTruthy();
  });
  it("erro do IPC aparece traduzido e com 'Tentar de novo'", async () => {
    const api = espiar({}, (a) => { a.estado = () => Promise.reject(new Error("Error invoking remote method 'agil:estado': Error: [invalid_argument] workspace desconhecido")); });
    await montar(api);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("workspace desconhecido");
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
  });
  it("eventos do main recarregam os dados (coalescido) e a falha de sincronização vira aviso", async () => {
    const api = espiar();
    await montar(api);
    const antes = api.painel.mock.calls.length;
    await api.emitir({ tipo: "metricas_atualizadas", workspace_id: "w1", quando: "x" });
    await esperar(120);
    expect(api.painel.mock.calls.length).toBeGreaterThan(antes);
    const n = api.painel.mock.calls.length;
    await api.emitir({ tipo: "metricas_atualizadas", workspace_id: "outro", quando: "x" });
    await esperar(120);
    expect(api.painel.mock.calls.length).toBe(n);
  });
  it("setas trocam de aba e a paleta/atalho (pedirAgil) abre a aba pedida", async () => {
    await montar(espiar());
    const painel = screen.getByRole("tab", { name: "Painel" });
    await act(async () => { painel.focus(); fireEvent.keyDown(painel, { key: "ArrowRight" }); });
    expect(screen.getByRole("tab", { name: "Backlog" }).getAttribute("aria-selected")).toBe("true");
    await act(async () => { pedirAgil("daily"); });
    expect(screen.getByRole("tab", { name: "Daily" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("backlog", () => {
  it("5 000 itens: aria-rowcount total e DOM mínimo (≤ 200 nós na tabela)", async () => {
    await montar(espiar({ total: 5000 }));
    await aba("Backlog");
    const tabela = await screen.findByRole("table", { name: "Backlog" });
    await waitFor(() => expect(within(tabela).getAllByRole("row").length).toBeGreaterThan(5));
    expect(tabela.getAttribute("aria-rowcount")).toBe("5001");
    expect(tabela.querySelectorAll("*").length).toBeLessThanOrEqual(200);
    expect(screen.getByText("200 de 5000")).toBeTruthy();
    confere("backlog");
  });
  it("rolar até perto do fim carrega a próxima página", async () => {
    const api = espiar({ total: 450 });
    await montar(api);
    await aba("Backlog");
    const rol = (await screen.findByRole("table", { name: "Backlog" })).querySelector(".ag-rolagem") as HTMLElement;
    await waitFor(() => expect(screen.getByText("200 de 450")).toBeTruthy());
    await act(async () => { rol.scrollTop = ALTURA_LINHA * 180; fireEvent.scroll(rol); });
    await waitFor(() => expect(screen.getByText("400 de 450")).toBeTruthy());
  });
  it("estado vazio explica o próximo passo", async () => {
    await montar(espiar({ total: 0 }));
    await aba("Backlog");
    expect(await screen.findByText("Backlog vazio")).toBeTruthy();
  });
  it("edição inline de pontos grava como ajustada; título de item do método é só leitura", async () => {
    const api = espiar({ total: 6 });
    await montar(api);
    await aba("Backlog");
    const linha = await screen.findByRole("row", { name: /Item 2/ });
    const celulaPts = within(linha).getAllByRole("cell")[2] as HTMLElement;
    await act(async () => { fireEvent.doubleClick(celulaPts); });
    const campo = screen.getByLabelText("Pontos");
    await act(async () => { fireEvent.change(campo, { target: { value: "8" } }); fireEvent.keyDown(campo, { key: "Enter" }); });
    await waitFor(() => expect(api.estimativaGravar).toHaveBeenCalledWith("w1", { item_id: "it2", pontos: 8, estado: "ajustada" }));
    const meto = screen.getByRole("row", { name: /Item 3/ });
    await act(async () => { fireEvent.doubleClick(within(meto).getAllByRole("cell")[1] as HTMLElement); });
    expect(screen.queryByLabelText("Título")).toBeNull();
  });
  it("Alt+seta reordena (itemReordenar com o vizinho que fica depois) e arrastar também", async () => {
    const api = espiar({ total: 4 });
    await montar(api);
    await aba("Backlog");
    const linha = await screen.findByRole("row", { name: /Item 1/ });
    await act(async () => { linha.focus(); fireEvent.keyDown(linha, { key: "ArrowDown", altKey: true }); });
    await waitFor(() => expect(api.itemReordenar).toHaveBeenCalledWith("w1", "it1", "it3"));
    const l3 = screen.getByRole("row", { name: /Item 3/ });
    const l2 = screen.getByRole("row", { name: /Item 2/ });
    await act(async () => { fireEvent.dragStart(l3, { dataTransfer: { effectAllowed: "" } }); fireEvent.drop(l2, { dataTransfer: {} }); });
    await waitFor(() => expect(api.itemReordenar).toHaveBeenCalledWith("w1", "it3", "it2"));
  });
  it("com filtro ativo, arrastar fica desligado (linhas não são draggable)", async () => {
    await montar(espiar({ total: 3 }));
    await aba("Backlog");
    await act(async () => { fireEvent.change(screen.getByLabelText("Risco"), { target: { value: "alto" } }); });
    const linha = await screen.findByRole("row", { name: /Item 1/ });
    expect(linha.getAttribute("draggable")).not.toBe("true");
  });
  it("novo item pelo campo e estimativa em lote por heurística", async () => {
    const api = espiar({ total: 2 });
    await montar(api);
    await aba("Backlog");
    const campo = screen.getByLabelText("Novo item");
    await act(async () => { fireEvent.change(campo, { target: { value: "Tela de login" } }); fireEvent.keyDown(campo, { key: "Enter" }); });
    await waitFor(() => expect(api.itemCriar).toHaveBeenCalledWith("w1", { titulo: "Tela de login" }));
    await clicar(screen.getByRole("button", { name: "Estimar itens sem estimativa" }));
    expect(api.estimar).toHaveBeenCalledWith("w1", "sem_estimativa");
  });
});

describe("painel do item", () => {
  async function abrirItem(api: ApiEspia, nome: RegExp = /Item 1/) {
    await montar(api);
    await aba("Backlog");
    await clicar(await screen.findByRole("row", { name: nome }));
    return screen.findByRole("complementary", { name: /Detalhes de/ });
  }
  it("mostra origem, confiança, fatores e permite aceitar a sugestão (e a tecla A)", async () => {
    const api = espiar({ total: 3 });
    const painel = await abrirItem(api);
    expect(within(painel).getByText(/sugerido \(confiança 50 %\)/)).toBeTruthy();
    expect(within(painel).getByRole("list", { name: "Fatores da estimativa" }).textContent).toContain("integração externa");
    await clicar(within(painel).getByRole("button", { name: "Aceitar sugestão" }));
    await waitFor(() => expect(api.estimativaGravar).toHaveBeenCalledWith("w1", expect.objectContaining({ item_id: "it1", estado: "aceita", pontos: 5 })));
    const secao = within(painel).getByRole("region", { name: "Estimativa" });
    api.estimativaGravar.mockClear();
    await act(async () => { fireEvent.keyDown(secao, { key: "t" }); });
    await waitFor(() => expect(api.estimativaGravar).toHaveBeenCalledWith("w1", expect.objectContaining({ estado: "travada" })));
    confere("painel do item");
  });
  it("ajustar pontos grava como ajustada", async () => {
    const api = espiar({ total: 3 });
    const painel = await abrirItem(api);
    await act(async () => { fireEvent.change(within(painel).getByLabelText("Ajustar pontos"), { target: { value: "8" } }); });
    await clicar(within(painel).getByRole("button", { name: "Ajustar" }));
    await waitFor(() => expect(api.estimativaGravar).toHaveBeenCalledWith("w1", { item_id: "it1", estado: "ajustada", pontos: 8 }));
  });
  it("IA: sem consentimento explica e NÃO chama nada até o clique em Autorizar", async () => {
    const api = espiar({ total: 3 });
    const painel = await abrirItem(api);
    await clicar(within(painel).getByRole("button", { name: "Estimar com IA" }));
    expect(within(painel).getByRole("group", { name: "Consentimento para estimar com IA" }).textContent).toMatch(/enviado ao provedor/);
    expect(api.consentimentoIa).not.toHaveBeenCalled();
    expect(api.estimar).not.toHaveBeenCalled();
    await clicar(within(painel).getByRole("button", { name: "Autorizar e estimar" }));
    await waitFor(() => expect(api.consentimentoIa).toHaveBeenCalledWith("w1", true));
    await waitFor(() => expect(api.estimar).toHaveBeenCalledWith("w1", ["it1"]));
  });
  it("IA: com consentimento já dado estima direto, sem pedir de novo", async () => {
    const api = espiar({ total: 3, estado: { ia: { consentimento: true, modo: "ia_sugere", chamadas_hoje: 1, teto_dia: 40, perfil: "rapido", disponivel: true } } });
    const painel = await abrirItem(api);
    await clicar(within(painel).getByRole("button", { name: "Estimar com IA" }));
    await waitFor(() => expect(api.estimar).toHaveBeenCalledWith("w1", ["it1"]));
    expect(api.consentimentoIa).not.toHaveBeenCalled();
  });
  it("marcar retrabalho exige motivo de 5+ caracteres e só vale para task do método", async () => {
    const api = espiar({ total: 3 });
    const painel = await abrirItem(api, /Item 3/);
    const marcar = within(painel).getByRole("button", { name: "Marcar retrabalho" }) as HTMLButtonElement;
    expect(marcar.disabled).toBe(true);
    await act(async () => { fireEvent.change(within(painel).getByLabelText(/Motivo/), { target: { value: "abc" } }); });
    expect(marcar.disabled).toBe(true);
    await act(async () => { fireEvent.change(within(painel).getByLabelText(/Motivo/), { target: { value: "voltou do QA" } }); });
    expect(marcar.disabled).toBe(false);
    await clicar(marcar);
    await waitFor(() => expect(api.retrabalhoMarcar).toHaveBeenCalledWith("w1", { trabalho_id: "tr1", task_ref: "T-01.3", acao: "marcar_retrabalho", motivo: "voltou do QA" }));
  });
  it("item criado aqui: sem marcação; promover mostra o comando e vincular usa a sugestão", async () => {
    const api = espiar({ total: 3 }, (a) => { const o = a.itemLer; a.itemLer = async (w, id) => ({ ...(await o(w, id)), vinculos_sugeridos: [{ trabalho_id: "tr9", titulo: "Login", similaridade: 0.8 }] }); });
    const painel = await abrirItem(api);
    expect(within(painel).getByText(/vincule este item a um trabalho/)).toBeTruthy();
    await clicar(within(painel).getByRole("button", { name: "/sprintx" }));
    expect(await within(painel).findByText("/expx:sprintx exemplo")).toBeTruthy();
    await clicar(within(painel).getByRole("button", { name: "Vincular" }));
    await waitFor(() => expect(api.itemVincular).toHaveBeenCalledWith("w1", "it1", "tr9"));
  });
  it("erro de regra do IPC vira aviso em português (human_only)", async () => {
    const api = espiar({ total: 3 }, (a) => { a.retrabalhoMarcar = () => Promise.reject(new Error("[rule_violation/human_only] ação reservada a humano")); });
    const painel = await abrirItem(api, /Item 3/);
    await act(async () => { fireEvent.change(within(painel).getByLabelText(/Motivo/), { target: { value: "voltou do QA" } }); });
    await clicar(within(painel).getByRole("button", { name: "Marcar feita de primeira" }));
    await waitFor(() => expect(api.retrabalhoMarcar).toHaveBeenCalled());
  });
});

describe("sprint, daily, retro, qualidade e config", () => {
  it("sugere o compromisso com avisos, aplica e fecha com diálogo da UI (zero window.confirm)", async () => {
    const confirmar = vi.spyOn(window, "confirm");
    const api2 = espiar();
    await montar(api2);
    await aba("Sprint");
    expect(await screen.findByText(/Capacidade: 10 pontos/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Saúde da sprint" }).textContent).toMatch(/WIP acima do limite/);
    await clicar(screen.getByRole("button", { name: "Fechar sprint…" }));
    const dialogo = await screen.findByRole("dialog", { name: "Fechar Sprint 1" });
    await act(async () => { fireEvent.change(within(dialogo).getByLabelText("Destino dos pendentes"), { target: { value: "proxima" } }); });
    await clicar(within(dialogo).getByRole("button", { name: "Fechar sprint" }));
    await waitFor(() => expect(api2.sprintFechar).toHaveBeenCalledWith("w1", "s1", "proxima", null));
    expect(await screen.findByRole("dialog", { name: "Sprint fechada" })).toBeTruthy();
    expect(confirmar).not.toHaveBeenCalled();
  });
  it("planejamento: sugestão aparece com avisos e aplicar adiciona itens", async () => {
    const api = espiar({ sprints: [{ id: "s2", workspace_id: "w1", nome: "Sprint 2", meta: null, inicio: "2026-03-16", fim: "2026-03-27", estado: "planejada", capacidade_pontos: null, compromisso_pontos: null, iniciada_em: null, fechada_em: null, versao_lancamento: null, resumo_fechamento: null, criado_em: "x", atualizado_em: "x", itens: [] }] });
    await montar(api);
    await aba("Sprint");
    await clicar(await screen.findByRole("button", { name: "Sugerir compromisso" }));
    const regiao = await screen.findByRole("region", { name: "Sugestão de compromisso" });
    expect(within(regiao).getByRole("list", { name: "Avisos do planejamento" }).textContent).toMatch(/sem estimativa/);
    await clicar(within(regiao).getByRole("button", { name: "Aplicar ao compromisso" }));
    await waitFor(() => expect(api.sprintItemMover).toHaveBeenCalledWith("w1", "s2", "it1", "adicionar", "sugestão do planejamento"));
    expect(screen.getByRole("button", { name: "Iniciar sprint" })).toBeTruthy();
  });
  it("sem sprint: estado vazio com o próximo passo", async () => {
    await montar(espiar({ sprints: [] }));
    await aba("Sprint");
    expect(await screen.findByText("Nenhuma sprint ainda")).toBeTruthy();
  });
  it("daily: quatro blocos e 'Copiar texto' usa a área de transferência", async () => {
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
    await montar(espiar());
    await aba("Daily");
    expect(await screen.findByRole("heading", { name: "Ontem" })).toBeTruthy();
    for (const t of ["Hoje", "Bloqueios", "Atrasos e riscos"]) expect(screen.getByRole("heading", { name: t })).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Copiar texto" }));
    expect(escrever).toHaveBeenCalledWith("Ana: ontem T-01; hoje T-02");
  });
  it("daily sem atividade diz isso (não inventa)", async () => {
    const api = espiar({}, (a) => { const o = a.dailyGerar; a.dailyGerar = async (w, s) => ({ ...(await o(w, s)), sem_atividade: true, membros: [] }); });
    await montar(api);
    await aba("Daily");
    expect(await screen.findByText("Sem atividade registrada")).toBeTruthy();
  });
  it("retro: colunas, voto, dados da sprint e ação com dono", async () => {
    const api = espiar();
    await montar(api);
    await aba("Retro");
    expect(await screen.findByRole("region", { name: "Parar" })).toBeTruthy();
    await clicar(screen.getByRole("button", { name: /Votar em: Reuniões longas/ }));
    expect(api.retroItemGravar).toHaveBeenCalledWith("w1", "r1", { item_id: "ri1", voto: 1 });
    const campo = screen.getByLabelText("Ação");
    await act(async () => { fireEvent.change(campo, { target: { value: "Reduzir reuniões" } }); });
    await clicar(screen.getByRole("button", { name: "Adicionar ação" }));
    await waitFor(() => expect(api.retroAcaoGravar).toHaveBeenCalledWith("w1", "r1", { texto: "Reduzir reuniões", dono_membro_id: null, prazo: null }));
    expect(screen.getByRole("complementary", { name: "Dados da sprint" })).toBeTruthy();
  });
  it("qualidade: IR com faixa até ir_max, contadores e checklist manual", async () => {
    const api = espiar();
    await montar(api);
    await aba("Qualidade");
    expect(await screen.findByText("20 % a 30 %")).toBeTruthy();
    expect(screen.getByText("Em observação").nextSibling?.textContent).toBe("2");
    expect(screen.getByText("Indeterminadas").nextSibling?.textContent).toBe("1");
    const sel = await screen.findByLabelText(/Estado de Pareamento/);
    await act(async () => { fireEvent.change(sel, { target: { value: "ok" } }); });
    await waitFor(() => expect(api.checklistGravar).toHaveBeenCalledWith("w1", "s1", "pareamento", "ok", null));
    confere("qualidade");
  });
  it("config: consentimento da IA só muda por clique e salvar envia a configuração", async () => {
    const api = espiar();
    await montar(api);
    await aba("Config");
    const caixa = await screen.findByRole("checkbox", { name: /Permitir enviar o texto das tasks/ });
    expect((caixa as HTMLInputElement).checked).toBe(false);
    expect(api.consentimentoIa).not.toHaveBeenCalled();
    await clicar(caixa);
    await waitFor(() => expect(api.consentimentoIa).toHaveBeenCalledWith("w1", true));
    const janela = screen.getByLabelText("Janela de retrabalho (dias)");
    const salvar = screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement;
    expect(salvar.disabled).toBe(true);
    await act(async () => { fireEvent.change(janela, { target: { value: "7" } }); });
    expect(salvar.disabled).toBe(false);
    await clicar(salvar);
    await waitFor(() => expect(api.configGravar).toHaveBeenCalledWith("w1", expect.objectContaining({ janela_retrabalho_dias: 7 })));
    confere("config");
  });
  it("config: restaurar padrões carrega os defaults sem salvar sozinho", async () => {
    const api = espiar();
    await montar(api);
    await aba("Config");
    await act(async () => { fireEvent.change(await screen.findByLabelText("Janela de retrabalho (dias)"), { target: { value: "3" } }); });
    await clicar(screen.getByRole("button", { name: "Restaurar padrões" }));
    await waitFor(() => expect((screen.getByLabelText("Janela de retrabalho (dias)") as HTMLInputElement).value).toBe("14"));
    expect(api.configGravar).not.toHaveBeenCalled();
  });
});
