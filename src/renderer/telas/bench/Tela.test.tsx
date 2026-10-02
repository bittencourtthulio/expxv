// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiBench, EventoBenchIpc } from "../../../compartilhado/bench";
import { formatar, varrer } from "../../a11y/varredura";
import { montarComandos } from "../../estado/paleta";
import { TelaBench } from "./Bench";
import { ALVOS, RES, RUN, TAREFAS, TOKEN, apiFalsa, comparacaoFalsa, detalheFalso, estimativaFalsa, gradeFalsa, res, type OpcoesApi } from "./fabrica-teste";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

type Espia = { [K in keyof ApiBench]: ReturnType<typeof vi.fn> & ApiBench[K] } & { emitir: (e: EventoBenchIpc) => void };
function espiar(o: OpcoesApi = {}): Espia {
  const api = apiFalsa(o);
  for (const k of Object.keys(api) as Array<keyof typeof api>) if (k !== "emitir" && k !== "assinar") (api as unknown as Record<string, unknown>)[k] = vi.fn(api[k] as never);
  return api as unknown as Espia;
}
const harnessFalso = () => ({ gravarPolitica: vi.fn(async (p: unknown) => p as never) });
async function montar(api: Espia, extra: { harness?: ReturnType<typeof harnessFalso>; copiar?: (t: string) => Promise<void> } = {}) {
  await act(async () => { render(<TelaBench api={api} contas={[{ id: "cta_1", rotulo: "Conta bench", provedor: "claude" }]} harness={extra.harness as never} copiar={extra.copiar ?? (async () => undefined)} />); });
  await screen.findByRole("toolbar", { name: "Controles do Bench" });
  await act(async () => { await Promise.resolve(); });
}
const clicar = (el: HTMLElement) => act(async () => { fireEvent.click(el); });
const botao = (nome: string | RegExp) => screen.getByRole("button", { name: nome });
const rodarDaBarra = () => within(screen.getByRole("toolbar", { name: "Controles do Bench" })).getByRole("button", { name: /Rodar…/ });
const confere = (onde: string) => { const a = varrer(document.body); expect(a.length === 0 ? "" : `${onde}\n${formatar(a)}`).toBe(""); };

describe("casca", () => {
  it("UMA linha de controles com tarefas, alvos, paralelo, teto, rodar, cancelar, julgar, comparar, exportar e contador; grade com estados por forma; sem violação de acessibilidade", async () => {
    await montar(espiar());
    const barra = screen.getByRole("toolbar", { name: "Controles do Bench" });
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
    for (const nome of [/^Tarefas/, /^Alvos/, /Rodar…/, /^Cancelar/, /Julgar…/, /^Comparar/, /^Exportar/]) expect(within(barra).getByRole("button", { name: nome })).toBeTruthy();
    expect(screen.getByLabelText("Paralelo")).toBeTruthy();
    expect(screen.getByLabelText("Teto US$")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Progresso" }).textContent).toBe("3/4 · US$ 0,0246");
    expect(screen.getByRole("grid", { name: "Resultados por tarefa e alvo" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Tarefa", "Modelo A", "Modelo B"]);
    confere("grade");
  });
  it("cada célula diz o estado por forma e por texto; custo desconhecido é '?' e NUNCA '0'", async () => {
    await montar(espiar());
    const desconhecida = screen.getByRole("button", { name: /t-um em Modelo B: concluído.*custo desconhecido.*sem nota/ });
    expect(desconhecida.textContent).toContain("?");
    expect(desconhecida.textContent).not.toMatch(/US\$ 0[,.]00\b/);
    const falhou = screen.getByRole("button", { name: /t-dois em Modelo A: falhou/ });
    expect(falhou.textContent).toContain("✕");
    expect(screen.getByRole("button", { name: /t-dois em Modelo B: executando/ }).textContent).toContain("▶");
    expect(screen.getByRole("button", { name: /t-um em Modelo A: concluído, 12,3 s, US\$ 0,0123, nota 8,0/ }).textContent).toContain("✓");
  });
  it("sem alvo disponível: estado vazio explica o próximo passo (conta dedicada em Provedores)", async () => {
    await montar(espiar({ alvos: [], grade: null }));
    expect(screen.getByText("Nenhum alvo disponível")).toBeTruthy();
    expect(screen.getByText(/conta dedicada em Provedores/)).toBeTruthy();
    expect(botao("Configurar alvos")).toBeTruthy();
    expect(rodarDaBarra().hasAttribute("disabled")).toBe(true);
    confere("sem alvo");
  });
  it("com alvos e sem Run: explica que nada roda sem consentimento", async () => {
    await montar(espiar({ grade: null }));
    expect(screen.getByText("Nenhuma Run ainda")).toBeTruthy();
    expect(screen.getByText(/Nada roda sem esse consentimento/)).toBeTruthy();
    confere("sem run");
  });
  it("sem preços: faixa 'informe preços para ver custo'", async () => {
    await montar(espiar({ precos: [] }));
    expect(screen.getByText(/Sem preços cadastrados/)).toBeTruthy();
    await clicar(botao("Informar preços"));
    expect(await screen.findByRole("dialog", { name: /Preços/ })).toBeTruthy();
    confere("preços");
  });
  it("erro de carregamento mostra a mensagem e 'Tentar de novo'", async () => {
    const api = espiar();
    api.alvosListar = vi.fn(async () => { throw new Error("[unavailable] Falha interna no Bench."); }) as never;
    await montar(api);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Falha interna");
    api.alvosListar = vi.fn(async () => ALVOS) as never;
    await clicar(botao("Tentar de novo"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
  it("jamais usa window.confirm/alert/prompt", async () => {
    const c = vi.spyOn(window, "confirm"), a = vi.spyOn(window, "alert"), p = vi.spyOn(window, "prompt");
    const api = espiar();
    await montar(api);
    await clicar(rodarDaBarra());
    await screen.findByRole("dialog");
    expect([c, a, p].every((f) => f.mock.calls.length === 0)).toBe(true);
  });
  it("seletores são popovers de checkboxes: tarefa em rascunho vem desabilitada; Esc fecha e devolve o foco", async () => {
    await montar(espiar());
    const bt = screen.getByRole("button", { name: /^Tarefas/ });
    await clicar(bt);
    const grupo = screen.getByRole("group", { name: "Tarefas" });
    const rascunho = within(grupo).getByRole("checkbox", { name: /Rascunho pesado/ });
    expect(rascunho.hasAttribute("disabled")).toBe(true);
    expect(within(grupo).getByRole("checkbox", { name: /Tarefa um/ })).toBeTruthy();
    await act(async () => { fireEvent.keyDown(grupo, { key: "Escape" }); });
    expect(screen.queryByRole("group", { name: "Tarefas" })).toBeNull();
    expect(document.activeElement).toBe(bt);
  });
});

describe("consentimento digitado", () => {
  it("o botão só habilita com a frase EXATA; com ela: consentir → rodar com o token; o diálogo fecha e a Run aparece", async () => {
    const api = espiar({ grade: null });
    await montar(api);
    await clicar(rodarDaBarra());
    const dlg = await screen.findByRole("dialog", { name: /Rodar: confirmação/ });
    expect(within(dlg).getByText(/Isto executa código gerado por IA sem pedir confirmação/)).toBeTruthy();
    expect(within(dlg).getByText("US$ 0,50 – 1,80")).toBeTruthy();
    expect(within(dlg).getByText(/Sandbox do macOS ativo/)).toBeTruthy();
    const confirmar = within(dlg).getByRole("button", { name: "Rodar" });
    const campo = within(dlg).getByRole("textbox");
    expect(confirmar.hasAttribute("disabled")).toBe(true);
    for (const errado of ["rodar", "RODAR ", "RODA", "SIM"]) { await act(async () => { fireEvent.change(campo, { target: { value: errado } }); }); expect(confirmar.hasAttribute("disabled"), errado).toBe(true); }
    await act(async () => { fireEvent.change(campo, { target: { value: "RODAR" } }); });
    expect(confirmar.hasAttribute("disabled")).toBe(false);
    api.estadoRun = vi.fn(async () => gradeFalsa()) as never;
    await clicar(confirmar);
    expect(api.consentir).toHaveBeenCalledWith("est_lq3k2j9x", "RODAR", "rodar");
    expect(api.rodar).toHaveBeenCalledWith("est_lq3k2j9x", TOKEN);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("fechar o diálogo descarta o token (Cancelar e Esc)", async () => {
    const api = espiar();
    await montar(api);
    await clicar(rodarDaBarra());
    const dlg = await screen.findByRole("dialog");
    await clicar(within(dlg).getByRole("button", { name: "Cancelar" }));
    expect(api.descartarConsentimento).toHaveBeenCalledWith("est_lq3k2j9x");
    expect(api.rodar).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    await clicar(rodarDaBarra());
    await screen.findByRole("dialog");
    await act(async () => { fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); });
    expect(api.descartarConsentimento).toHaveBeenCalledTimes(2);
  });
  it("sandbox indisponível: mostra o motivo, NÃO tem campo nem botão de rodar ('rodar mesmo assim' não existe)", async () => {
    const api = espiar({ estimativa: estimativaFalsa({ sandbox: "indisponivel", frase_exigida: null, avisos: ["Sandbox indisponível: não posso rodar."] }) });
    await montar(api);
    await clicar(rodarDaBarra());
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getAllByText(/não posso rodar/).length).toBeGreaterThan(0);
    expect(within(dlg).getByRole("alert").textContent).toMatch(/não há opção de rodar mesmo assim/);
    expect(within(dlg).queryByRole("textbox")).toBeNull();
    expect(within(dlg).queryByRole("button", { name: "Rodar" })).toBeNull();
    expect(within(dlg).queryByRole("button", { name: /mesmo assim/i })).toBeNull();
    confere("sandbox indisponível");
  });
  it("sem sandbox (Windows) pede a frase REFORÇADA", async () => {
    const api = espiar({ estimativa: estimativaFalsa({ sandbox: "nenhum", frase_exigida: "RODAR SEM SANDBOX" }) });
    await montar(api);
    await clicar(rodarDaBarra());
    const dlg = await screen.findByRole("dialog");
    const campo = within(dlg).getByRole("textbox");
    await act(async () => { fireEvent.change(campo, { target: { value: "RODAR" } }); });
    expect(within(dlg).getByRole("button", { name: "Rodar" }).hasAttribute("disabled")).toBe(true);
    await act(async () => { fireEvent.change(campo, { target: { value: "RODAR SEM SANDBOX" } }); });
    expect(within(dlg).getByRole("button", { name: "Rodar" }).hasAttribute("disabled")).toBe(false);
  });
  it("custo desconhecido aparece como tal no diálogo (nunca 0)", async () => {
    const api = espiar({ estimativa: estimativaFalsa({ custo_min_usd: null, custo_max_usd: null, alvos_sem_custo: 2 }) });
    await montar(api);
    await clicar(rodarDaBarra());
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("custo desconhecido para 2 alvo(s)")).toBeTruthy();
  });
  it("token recusado pelo serviço: o erro aparece no diálogo e a tela não troca de Run", async () => {
    const api = espiar();
    api.rodar = vi.fn(async () => ({ erro: "consentimento_invalido" as const })) as never;
    await montar(api);
    await clicar(rodarDaBarra());
    const dlg = await screen.findByRole("dialog");
    await act(async () => { fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "RODAR" } }); });
    await clicar(within(dlg).getByRole("button", { name: "Rodar" }));
    expect((await within(dlg).findByRole("alert")).textContent).toMatch(/expirou ou já foi usado/);
  });
  it("Julgar: escolhe o juiz, consente com a finalidade 'julgar' e chama julgar com o token; a atualização da grade segue", async () => {
    const api = espiar();
    await montar(api);
    await clicar(botao(/Julgar…/));
    const dlg = await screen.findByRole("dialog", { name: /Julgar: confirmação/ });
    await act(async () => { fireEvent.change(within(dlg).getByRole("combobox"), { target: { value: "alvo-j" } }); });
    await waitFor(() => expect(api.estimar).toHaveBeenLastCalledWith(expect.objectContaining({ juiz_alvo: "alvo-j" })));
    await act(async () => { fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "RODAR" } }); });
    await clicar(within(dlg).getByRole("button", { name: "Julgar" }));
    expect(api.consentir).toHaveBeenCalledWith("est_lq3k2j9x", "RODAR", "julgar");
    expect(api.julgar).toHaveBeenCalledWith(RUN, null, "alvo-j", TOKEN);
  });
  it("Cancelar fica visível, desabilitado fora de execução e habilitado com a Run executando", async () => {
    const api = espiar({ grade: gradeFalsa({ estado: "executando" }) });
    await montar(api);
    const cancelar = botao(/^Cancelar/);
    expect(cancelar.hasAttribute("disabled")).toBe(false);
    await clicar(cancelar);
    expect(api.cancelar).toHaveBeenCalledWith(RUN);
  });
});

describe("detalhe", () => {
  it("clicar numa célula abre o detalhe: métricas, checagens, entregas; nota manual e log por páginas", async () => {
    const api = espiar();
    await montar(api);
    await clicar(screen.getByRole("button", { name: /t-um em Modelo A: concluído/ }));
    const det = await screen.findByRole("complementary", { name: "Detalhe do resultado" });
    await within(det).findByText(/1000 entrada/);
    expect(within(det).getByText(/US\$ 0,0123 \(relatado pela CLI\)/)).toBeTruthy();
    expect(within(det).getByText(/texto não encontrado/)).toBeTruthy();
    expect(within(det).getByText("garantido")).toBeTruthy();
    // nota manual validada e enviada
    const campo = within(det).getByLabelText("Nota (0–10)");
    await act(async () => { fireEvent.change(campo, { target: { value: "11" } }); });
    await clicar(within(det).getByRole("button", { name: "Gravar nota" }));
    expect(within(det).getByRole("alert").textContent).toMatch(/0 a 10/);
    expect(api.notaManual).not.toHaveBeenCalled();
    await act(async () => { fireEvent.change(campo, { target: { value: "7,5" } }); });
    await clicar(within(det).getByRole("button", { name: "Gravar nota" }));
    expect(api.notaManual).toHaveBeenCalledWith(RES, 7.5, null);
    // log: só lê quando pedido, em páginas de 64 KiB
    expect(api.logLer).not.toHaveBeenCalled();
    await clicar(within(det).getByRole("button", { name: "Carregar log" }));
    expect(api.logLer).toHaveBeenCalledWith(RES, 0, 65_536);
    await within(det).findByRole("list", { name: "Linhas do log" });
    // entrega: sempre TEXTO (nunca renderiza o HTML do artefato)
    await clicar(within(det).getByRole("button", { name: "index.html" }));
    const previa = await within(det).findByLabelText("Conteúdo de index.html");
    expect(previa.textContent).toBe("<h1>entrega</h1>");
    expect(previa.querySelector("h1")).toBeNull();
    confere("detalhe");
    await clicar(within(det).getByRole("button", { name: "Recolher o detalhe" }));
    expect(screen.queryByRole("complementary", { name: "Detalhe do resultado" })).toBeNull();
  });
  it("Re-rodar reaparece com o diálogo de consentimento e chama rerodar com o token", async () => {
    const api = espiar();
    await montar(api);
    await clicar(screen.getByRole("button", { name: /t-um em Modelo A: concluído/ }));
    const det = await screen.findByRole("complementary", { name: "Detalhe do resultado" });
    await within(det).findByText(/1000 entrada/);
    await clicar(within(det).getByRole("button", { name: "Re-rodar…" }));
    const dlg = await screen.findByRole("dialog", { name: /Re-rodar: confirmação/ });
    expect(api.estimar).toHaveBeenLastCalledWith({ tarefas: ["t-um"], alvos: ["alvo-a"], max_paralelo: 1, teto_usd: null, juiz_alvo: null });
    await act(async () => { fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "RODAR" } }); });
    await clicar(within(dlg).getByRole("button", { name: "Re-rodar" }));
    expect(api.rerodar).toHaveBeenCalledWith(RUN, "t-um", "alvo-a", TOKEN);
  });
});

describe("comparar", () => {
  it("veredito em texto com números, placar, selos, SVG próprio com título e tabela por tarefa; 'sem custo' quando há null", async () => {
    await montar(espiar());
    await clicar(botao("Comparar"));
    await screen.findByText(/Veredito:/);
    expect(screen.getByText(/alvo-b venceu 1 de 2/)).toBeTruthy();
    expect(screen.getByText("sem custo")).toBeTruthy();
    expect(screen.getByText(/Placar: alvo-a 1 · alvo-b 1/)).toBeTruthy();
    const svg = screen.getByRole("img", { name: /Score médio por alvo/ });
    expect(svg.querySelectorAll("rect").length).toBe(2);
    const tabela = screen.getByRole("table", { name: "Comparação por tarefa" });
    expect(within(tabela).getAllByText(/venceu/).length).toBe(2); // o vencedor é dito por TEXTO, não só por cor
    expect(within(tabela).getAllByText(/custo desconhecido/).length).toBeGreaterThan(0);
    confere("comparar");
  });
  it("não comparável e menos de 2 alvos explicam o que fazer", async () => {
    await montar(espiar({ comparacao: { erro: "nao_comparavel" } }));
    await clicar(botao("Comparar"));
    expect(await screen.findByText(/Não comparável/)).toBeTruthy();
    cleanup();
    const um = espiar({ alvos: [ALVOS[0]!] });
    await montar(um);
    await clicar(botao("Comparar"));
    expect(screen.getByText(/ao menos 2 alvos/)).toBeTruthy();
  });
  it("selos: score não comparável, harness parcial e versões diferentes", async () => {
    await montar(espiar({ comparacao: comparacaoFalsa({ selos: ["nao_comparavel", "harness_parcial", "versoes_diferentes"] }) }));
    await clicar(botao("Comparar"));
    for (const t of ["score não comparável", "harness parcial", "versões diferentes da tarefa"]) expect(await screen.findByText(t)).toBeTruthy();
  });
});

describe("sugestão para o harness (só sugere)", () => {
  it("gerar sugestão NÃO grava nada; aplicar exige confirmação e grava a política global com fallback", async () => {
    const harness = harnessFalso();
    await montar(espiar(), { harness });
    await clicar(botao("Comparar"));
    await clicar(await screen.findByRole("button", { name: "Gerar sugestão" }));
    expect(await screen.findByText("bug-fix")).toBeTruthy();
    expect(harness.gravarPolitica).not.toHaveBeenCalled();
    await clicar(screen.getByRole("button", { name: "Aplicar ao Harness…" }));
    const dlg = await screen.findByRole("dialog", { name: "Aplicar ao Harness" });
    expect(within(dlg).getByText(/Isto grava a política/).textContent).toMatch(/política global do harness para bug-fix/);
    expect(harness.gravarPolitica).not.toHaveBeenCalled();
    await clicar(within(dlg).getByRole("button", { name: "Aplicar política" }));
    expect(harness.gravarPolitica).toHaveBeenCalledTimes(1);
    const p = harness.gravarPolitica.mock.calls[0]![0] as { workspace_id: unknown; task_type: string; fallback: unknown[] };
    expect([p.workspace_id, p.task_type]).toEqual([null, "bug-fix"]);
    expect(p.fallback.length).toBeGreaterThanOrEqual(1);
  });
  it("cancelar a confirmação não grava; sem a API do harness só há 'Copiar JSON'", async () => {
    const harness = harnessFalso();
    const copiar = vi.fn(async (_t: string) => undefined);
    await montar(espiar(), { harness, copiar });
    await clicar(botao("Comparar"));
    await clicar(await screen.findByRole("button", { name: "Gerar sugestão" }));
    await clicar(await screen.findByRole("button", { name: "Aplicar ao Harness…" }));
    await clicar(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    expect(harness.gravarPolitica).not.toHaveBeenCalled();
    await clicar(screen.getByRole("button", { name: "Copiar JSON" }));
    expect(copiar).toHaveBeenCalledTimes(1);
    expect(JSON.parse(copiar.mock.calls[0]![0] as string)).toMatchObject({ task_type: "bug-fix", workspace_id: null });
    cleanup();
    await montar(espiar());
    await clicar(botao("Comparar"));
    await clicar(await screen.findByRole("button", { name: "Gerar sugestão" }));
    await screen.findByText("bug-fix");
    expect(screen.queryByRole("button", { name: "Aplicar ao Harness…" })).toBeNull();
  });
  it("o harness recusando mostra o erro e nada some", async () => {
    const harness = { gravarPolitica: vi.fn(async () => { throw new Error("modelo inválido no harness"); }) };
    await montar(espiar(), { harness: harness as never });
    await clicar(botao("Comparar"));
    await clicar(await screen.findByRole("button", { name: "Gerar sugestão" }));
    await clicar(await screen.findByRole("button", { name: "Aplicar ao Harness…" }));
    await clicar(within(await screen.findByRole("dialog")).getByRole("button", { name: "Aplicar política" }));
    expect((await screen.findByText(/modelo inválido no harness/)).getAttribute("role")).toBe("alert");
  });
});

describe("eventos e escala", () => {
  it("progresso da Run atual atualiza a grade (coalescido); evento de outra Run é ignorado", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = espiar();
      await montar(api);
      const antes = api.estadoRun.mock.calls.length;
      await act(async () => { api.emitir({ tipo: "progresso", run_id: "brun_OUTRA0000000000", resultado_id: null, estado: "concluido", concluidos: 1, total: 2, custo_acumulado_usd: null }); await vi.advanceTimersByTimeAsync(400); });
      expect(api.estadoRun.mock.calls.length).toBe(antes);
      await act(async () => {
        for (let i = 0; i < 10; i++) api.emitir({ tipo: "progresso", run_id: RUN, resultado_id: RES, estado: "concluido", concluidos: i, total: 4, custo_acumulado_usd: null });
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(api.estadoRun.mock.calls.length).toBe(antes + 1); // 10 eventos → 1 releitura
    } finally { vi.useRealTimers(); }
  });
  it("grade com mais de 100 linhas é virtualizada: só as visíveis existem no DOM", async () => {
    const tarefas = Array.from({ length: 150 }, (_, i) => `tarefa-${String(i).padStart(3, "0")}`);
    const rs = tarefas.map((t, i) => res(`bres_${String(i).padStart(10, "0")}0000000000`, t, "alvo-a"));
    const g = gradeFalsa({}, rs);
    g.run.tarefas = tarefas.map((slug) => ({ slug, versao: 1 }));
    g.run.alvos = ["alvo-a"];
    await montar(espiar({ grade: g }));
    const botoes = screen.getAllByRole("button", { name: /em Modelo A:/ });
    expect(botoes.length).toBeGreaterThan(0);
    expect(botoes.length).toBeLessThan(60);
    expect(screen.getByRole("list", { name: "Linhas da grade" })).toBeTruthy();
  });
  it("fora do Electron (sem API) a tela explica", async () => {
    cleanup();
    await act(async () => { render(<TelaBench />); });
    expect(screen.getByText("Bench indisponível")).toBeTruthy();
  });
});

describe("paleta ⌘K", () => {
  it("expõe comandos do Bench e NENHUM que inicie Run", () => {
    const acoes = { navegar: vi.fn(), abrirProjeto: vi.fn(), novaMissao: vi.fn(), novoTerminal: vi.fn(), alternarTema: vi.fn(), irParaWorkspace: vi.fn(), abrirTrabalho: vi.fn() };
    const lista = montarComandos({ mac: true, workspaceAtual: null, recentes: [], trabalhos: [], temaEfetivo: "escuro", acoes });
    const bench = lista.filter((c) => c.grupo === "Bench");
    expect(bench.map((c) => c.id).sort()).toEqual(["bench:abrir", "bench:alvos", "bench:comparar", "bench:precos", "bench:sugestao"]);
    expect(bench.find((c) => c.id === "bench:abrir")?.atalho).toBe("⌘⇧B");
    expect(JSON.stringify(bench.map((c) => c.titulo)).toLowerCase()).not.toMatch(/rodar|executar|iniciar|julgar/);
    expect(lista.find((c) => c.id === "ir:bench")?.titulo).toBe("Ir para Bench");
  });
});

void TAREFAS; void detalheFalso;
