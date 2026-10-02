// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DETALHE, DETALHE_HUMANO, PLANO, RECIBO, RESUMO, config, maestroFalso } from "../../a11y/ade-falso-maestro";
import { instalar, remover } from "../../a11y/ade-falso";
import { criarStoreMaestro, type StoreMaestro } from "../../estado/maestro";
import { storeWorkspaces } from "../../estado/workspaces";
import { TelaPipelines, type AbaPipelines } from "./Pipelines";

type Sobre = Parameters<typeof maestroFalso>[0];
let store: StoreMaestro;
beforeEach(async () => { instalar(); await storeWorkspaces.iniciar(); });
afterEach(() => { cleanup(); remover(); vi.restoreAllMocks(); });

async function montar(sobre: Sobre = {}, aba: AbaPipelines = "pipeline", preparar?: (s: StoreMaestro) => Promise<void>) {
  const f = maestroFalso(sobre);
  (globalThis as unknown as { ade: Record<string, unknown> }).ade = { ...(globalThis as unknown as { ade: Record<string, unknown> }).ade, ...f };
  store = criarStoreMaestro({ api: () => f.maestro, previa: () => f.rigidez, quadro: (fn) => fn() });
  await act(async () => { await storeWorkspaces.iniciar(); });
  if (preparar !== undefined) await act(async () => { await preparar(store); });
  await act(async () => { render(<TelaPipelines store={store} abaInicial={aba} />); });
  return f;
}
const aba = async (nome: string) => { await act(async () => { fireEvent.click(screen.getByRole("tab", { name: nome })); }); };

describe("tela Pipelines: estrutura e estados", () => {
  it("sub-navegação lateral com as cinco seções e a contagem", async () => {
    await montar();
    const barra = screen.getByRole("tablist", { name: "Seções dos pipelines" });
    expect(barra.getAttribute("aria-orientation")).toBe("vertical");
    expect(within(barra).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Pipeline", "Intenção", "Etapas", "Rigidez", "Provedores"]);
    expect(await screen.findByText("1 ativo")).toBeTruthy();
  });

  it("estado vazio explica o próximo passo; carregando tem aria-busy; erro tem 'Tentar de novo'", async () => {
    await montar({ maestro: { listarPipelines: async () => [] } });
    expect(await screen.findByText("Nenhum pipeline em andamento")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pedir ao Maestro" })).toBeTruthy();
    cleanup();
    let soltar: (v: never[]) => void = () => undefined;
    await montar({ maestro: { listarPipelines: () => new Promise((r) => { soltar = r as never; }) } });
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
    await act(async () => { soltar([]); });
    cleanup();
    const listar = vi.fn().mockRejectedValueOnce(new Error("banco travado")).mockResolvedValue([RESUMO]);
    await montar({ maestro: { listarPipelines: listar } });
    expect((await screen.findByRole("alert")).textContent).toContain("banco travado");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" })); });
    expect(await screen.findByRole("list", { name: "Pipelines ativos" })).toBeTruthy();
  });
});

describe("Intenção: plano antes de executar", () => {
  it("propõe o plano com intenção, confiança, fonte, nível, perfis por etapa, terminais, marcas e recibo; nada executa sozinho", async () => {
    const f = await montar({}, "intencao");
    const confirmar = vi.spyOn(f.maestro, "confirmar");
    await act(async () => { fireEvent.change(screen.getByLabelText("O que você quer fazer?"), { target: { value: "corrige o erro ao salvar o pedido" } }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Propor plano" })); });
    const plano = await screen.findByRole("region", { name: "Plano proposto" });
    expect(plano.textContent).toContain("Correção de defeito");
    expect(plano.textContent).toContain("confiança alta · 86%");
    expect(plano.textContent).toContain("regras locais");
    expect(plano.textContent).toContain("pipeline runx");
    expect(plano.textContent).toContain("4 terminais");
    const trilha = within(plano).getByRole("list", { name: "Etapas do plano" });
    const qa = within(trilha).getByRole("heading", { name: "QA" }).closest("li") as HTMLElement;
    const perfilQa = within(qa).getByLabelText("Perfil de QA");
    expect(perfilQa.textContent).toContain("OpenCode");
    expect(perfilQa.textContent).toContain("padrão da faixa");
    expect(within(perfilQa).getByText("Esforço")).toBeTruthy();
    expect(within(trilha).getByText("piso de qualidade")).toBeTruthy();
    expect(within(trilha).getByText("ação humana: o Maestro para")).toBeTruthy();
    expect(within(plano).getByRole("radio", { name: /3 · Padrão/ }).getAttribute("aria-checked")).toBe("true");
    expect(plano.textContent).toContain(RECIBO.texto);
    expect(plano.textContent).toContain("Rigidez abaixo de Padrão");
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("mudar o nível antes de executar recalcula as etapas pela prévia e vai no confirmar", async () => {
    const previaPlano = vi.fn(async () => PLANO.etapas.slice(0, 1));
    const f = await montar({ rigidez: { previaPlano } }, "intencao", async (s) => { await s.definirWorkspace("w1"); await s.pedir("corrige o erro ao salvar"); });
    const confirmar = vi.spyOn(f.maestro, "confirmar");
    await act(async () => { fireEvent.click(screen.getByRole("radio", { name: /2 · Leve/ })); });
    await waitFor(() => expect(previaPlano).toHaveBeenCalledWith({ workspace_id: "w1", pipeline_id: "runx", nivel: 2 }));
    expect(within(screen.getByRole("list", { name: "Etapas do plano" })).getAllByRole("listitem").filter((li) => li.classList.contains("pl-passo"))).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Executar" })); });
    await waitFor(() => expect(confirmar).toHaveBeenCalled());
    expect(confirmar.mock.calls[0]?.[0]).toMatchObject({ plano_id: "mpl_1", nivel: 2 });
  });

  it("etapa humana mostra H sem opção de pular; etapa de piso não pode ser pulada", async () => {
    await montar({}, "intencao", async (s) => { await s.definirWorkspace("w1"); await s.pedir("corrige o erro ao salvar"); });
    expect(screen.queryByRole("checkbox", { name: "Pular mergex.revisar" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Pular prodx.p0" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Pular runx.e3" })).toBeTruthy();
  });

  it("Cancelar e 'Tratar neste painel' descartam o plano", async () => {
    const f = await montar({}, "intencao", async (s) => { await s.definirWorkspace("w1"); await s.pedir("corrige o erro ao salvar"); });
    const cancelar = vi.spyOn(f.maestro, "cancelar");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tratar neste painel" })); });
    expect(cancelar).toHaveBeenCalledWith("mpl_1");
    expect(screen.queryByRole("region", { name: "Plano proposto" })).toBeNull();
    expect(screen.getByText("Nenhum plano proposto")).toBeTruthy();
  });

  it("confiança média mostra as candidatas e a escolha vai no confirmar; intenção desconhecida não executa", async () => {
    const media = { ...PLANO, confianca: 0.55, candidatas: [{ intencao: "bug" as const, confianca: 0.55 }, { intencao: "feature" as const, confianca: 0.4 }] };
    const f = await montar({ maestro: { pedir: async () => ({ plano: media, recibo: RECIBO }) } }, "intencao", async (s) => { await s.definirWorkspace("w1"); await s.pedir("melhora isso"); });
    const confirmar = vi.spyOn(f.maestro, "confirmar");
    await act(async () => { fireEvent.click(screen.getByRole("radio", { name: /Funcionalidade nova/ })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Executar" })); });
    await waitFor(() => expect(confirmar).toHaveBeenCalled());
    expect(confirmar.mock.calls[0]?.[0]).toMatchObject({ intencao: "feature" });
    cleanup();
    await montar({ maestro: { pedir: async () => ({ plano: { ...PLANO, intencao: "desconhecida", confianca: 0.2 }, recibo: RECIBO }) } }, "intencao", async (s) => { await s.definirWorkspace("w1"); await s.pedir("hmm"); });
    expect((screen.getByRole("button", { name: "Executar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("texto acima de 4000 é recusado no cliente (nenhuma chamada)", async () => {
    const f = await montar({}, "intencao");
    const pedir = vi.spyOn(f.maestro, "pedir");
    await act(async () => { fireEvent.change(screen.getByLabelText("O que você quer fazer?"), { target: { value: "a".repeat(4001) } }); });
    expect(screen.getByRole("alert").textContent).toContain("4000");
    expect((screen.getByRole("button", { name: "Propor plano" }) as HTMLButtonElement).disabled).toBe(true);
    expect(pedir).not.toHaveBeenCalled();
  });

  it("trava de raio ALTO ao executar pede justificativa de 20+ caracteres e a envia", async () => {
    const confirmar = vi.fn().mockRejectedValueOnce(new Error("abaixo_do_minimo: Raio ALTO exige nível 4")).mockResolvedValue(RESUMO);
    await montar({ maestro: { confirmar } }, "intencao", async (s) => { await s.definirWorkspace("w1"); await s.pedir("corrige o erro ao salvar"); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Executar" })); });
    const dlg = await screen.findByRole("dialog", { name: "Justificar nível abaixo do mínimo" });
    expect(dlg.textContent).toContain("Raio ALTO exige nível 4");
    await act(async () => { fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "Aprovado pelo dono em produção hoje" } }); });
    await act(async () => { fireEvent.click(within(dlg).getByRole("button", { name: "Confirmar" })); });
    await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(2));
    expect(confirmar.mock.calls[1]?.[0]).toMatchObject({ justificativa: "Aprovado pelo dono em produção hoje" });
  });
});

describe("acompanhamento do pipeline", () => {
  it("lista, detalhe com etapas, terminal, nível e piso I1..I10 com símbolo e texto", async () => {
    await montar();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /runx/ })); });
    const detalhe = await screen.findByRole("article", { name: "Pipeline runx" });
    const trilha = within(detalhe).getByRole("list", { name: "Etapas do pipeline" });
    expect(Array.from(trilha.children)).toHaveLength(3);
    expect(within(trilha).getByText("painel aaaaaa")).toBeTruthy();
    expect(within(trilha).getByText("concluída")).toBeTruthy();
    expect(within(trilha).getByText("executando")).toBeTruthy();
    expect(within(detalhe).getByText("1 de 3 etapas concluídas")).toBeTruthy();
    const piso = within(detalhe).getByRole("region", { name: "Piso de qualidade" });
    expect(piso.textContent).toMatch(/I1.*ok/);
    expect(piso.textContent).toMatch(/I2.*não comprovado/);
    expect(piso.textContent).toMatch(/I3.*violado/);
    expect(within(detalhe).getByText("Recibo da decisão")).toBeTruthy();
    expect(within(detalhe).getByRole("button", { name: "Pausar" })).toBeTruthy();
  });

  it("etapa humana: mostra o aviso e o caminho do arquivo e NÃO oferece botão de assinar/aprovar/mergear", async () => {
    await montar({ maestro: { listarPipelines: async () => [{ ...RESUMO, id: "mpl_2", pipeline_id: "prodx", estado: "aguardando_humano" }], detalhe: async () => DETALHE_HUMANO } });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /prodx/ })); });
    const portao = await screen.findByRole("note", { name: "Ação humana necessária" });
    expect(portao.textContent).toMatch(/assinatura do veredito é sua/);
    expect(portao.textContent).toContain("docs/pedidos/PD-2026-0001/VEREDITO.md");
    const nomes = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(nomes.filter((n) => /assin|aprov|merge|mergear/i.test(n))).toEqual([]);
    expect(screen.getByRole("button", { name: "Abrir arquivo" })).toBeTruthy();
  });

  it("ações do pipeline passam por maestro:pipeline_acao; cancelar pede confirmação própria", async () => {
    const f = await montar();
    const acao = vi.spyOn(f.maestro, "acao");
    const cancelar = vi.spyOn(f.maestro, "cancelar");
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /runx/ })); });
    await screen.findByRole("article", { name: "Pipeline runx" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Pausar" })); });
    expect(acao).toHaveBeenCalledWith({ id: "mpl_1", acao: "pausar", etapa_id: null });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cancelar pipeline" })); });
    expect(cancelar).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancelar pipeline" })); });
    expect(cancelar).toHaveBeenCalledWith("mpl_1");
  });

  it("evento do Maestro recarrega a lista (coalescido) e o detalhe aberto", async () => {
    let emitir: (e: { workspace_id: string; pipeline_id: string; tipo: string; estado: null; etapa_id: null }) => void = () => undefined;
    const detalhe = vi.fn(async () => DETALHE);
    await montar({ maestro: { assinar: (cb) => { emitir = cb as never; return () => undefined; }, detalhe } });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /runx/ })); });
    await waitFor(() => expect(detalhe).toHaveBeenCalledTimes(1));
    await act(async () => { emitir({ workspace_id: "w1", pipeline_id: "mpl_1", tipo: "maestro.stage_changed", estado: null, etapa_id: null }); });
    await waitFor(() => expect(detalhe.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("erro de detalhe é mostrado em PT-BR (nunca payload cru)", async () => {
    await montar({ maestro: { detalhe: async () => { throw new Error("pipeline sumiu do banco"); } } });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /runx/ })); });
    expect((await screen.findByRole("alert")).textContent).toContain("Não foi possível abrir o pipeline: pipeline sumiu do banco");
  });
});

describe("Etapas: matriz, validação ao vivo e linhas humanas", () => {
  it("linhas humanas travadas (cadeado, sem seletores) e as demais têm seletores rotulados", async () => {
    await montar({}, "etapas");
    const tabela = await screen.findByRole("table", { name: "Matriz de etapas por perfil" });
    const humana = within(tabela).getByText("Assinatura do veredito").closest("tr") as HTMLElement;
    expect(humana.textContent).toContain("Ação humana");
    expect(within(humana).queryAllByRole("combobox")).toHaveLength(0);
    expect(within(tabela).getByLabelText("CLI de Causa raiz")).toBeTruthy();
    expect(within(tabela).getByLabelText("Esforço de Causa raiz")).toBeTruthy();
    expect(within(tabela).getByRole("button", { name: /Skills permitidas de Causa raiz: 1/ })).toBeTruthy();
    expect(within(tabela).getAllByRole("rowgroup").length).toBeGreaterThan(1);
  });

  it("etapa de piso não pode ser desligada", async () => {
    await montar({}, "etapas");
    const sel = (await screen.findByLabelText("Execução de Triagem")) as HTMLSelectElement;
    expect(within(sel).getByRole("option", { name: "desligada" }).hasAttribute("disabled")).toBe(true);
    const outra = screen.getByLabelText("Execução de Correção") as HTMLSelectElement;
    expect(within(outra).getByRole("option", { name: "desligada" }).hasAttribute("disabled")).toBe(false);
  });

  it("CLI sem método (V2) mostra o erro inline e NÃO grava; corrigir grava", async () => {
    const validar = vi.fn(async ({ configs }: { configs: Array<{ etapa_id: string; perfil: { cli: string } }> }) => configs.some((c) => c.etapa_id === "runx.e3" && c.perfil.cli === "codex") ? [{ codigo: "V2", severidade: "erro" as const, etapa_id: "runx.e3", mensagem: "esta CLI não executa os comandos do método; use Claude Code ou OpenCode" }] : []);
    const gravarConfig = vi.fn(async (p: { config: ReturnType<typeof config> }) => ({ config: { config: p.config, origem: "global" as const }, achados: [] }));
    await montar({ pipelines: { validar, gravarConfig } }, "etapas");
    await act(async () => { fireEvent.change(await screen.findByLabelText("CLI de Correção"), { target: { value: "codex" } }); });
    const alerta = await screen.findByText(/esta CLI não executa os comandos do método/, undefined, { timeout: 2000 });
    expect(alerta.closest("li")?.textContent).toContain("V2");
    expect(gravarConfig).not.toHaveBeenCalled();
    expect(screen.getByText(/Não salvo: corrija o erro/)).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByLabelText("CLI de Correção"), { target: { value: "opencode" } }); });
    await waitFor(() => expect(gravarConfig).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(gravarConfig.mock.calls[0]?.[0].config.perfil.cli).toBe("opencode");
    await waitFor(() => expect(screen.queryByText(/esta CLI não executa/)).toBeNull());
  });

  it("avaliador igual ao implementador: erro V1 aparece nas DUAS linhas", async () => {
    const validar = vi.fn(async () => [{ codigo: "V1", severidade: "erro" as const, etapa_id: "runx.e4", mensagem: "o avaliador não pode ter o mesmo perfil do implementador", relacionadas: ["runx.e3"] }]);
    await montar({ pipelines: { validar } }, "etapas");
    await act(async () => { fireEvent.change(await screen.findByLabelText("Faixa de QA"), { target: { value: "medio" } }); });
    await waitFor(() => expect(screen.getAllByText(/o avaliador não pode ter o mesmo perfil/)).toHaveLength(2), { timeout: 2000 });
  });

  it("perfil pronto pede confirmação e aplica; restaurar fábrica pede confirmação", async () => {
    const f = await montar({}, "etapas");
    const aplicar = vi.spyOn(f.pipelines, "aplicarPronto");
    const restaurar = vi.spyOn(f.pipelines, "restaurarConfig");
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Econômico" })); });
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Aplicar" })); });
    expect(aplicar).toHaveBeenCalledWith({ workspace_id: null, pronto_id: "economico", cli: "manter" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Restaurar fábrica" })); });
    expect(restaurar).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Restaurar" })); });
    expect(restaurar).toHaveBeenCalledWith({ workspace_id: null, etapa_id: null });
  });

  it("importação hostil mostra a prévia com erros e NADA é aplicado", async () => {
    const importarConfirmar = vi.fn(async () => []);
    await montar({ pipelines: { importarPrevia: async () => ({ previa_id: null, configs: [], achados: [], erros: [{ campo: "etapas[0].perfil.modelo", motivo: "modelo inválido (sem flag, caminho ou espaço)" }], cancelado: false }), importarConfirmar } }, "etapas");
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Importar…" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "De um arquivo…" })); });
    const dlg = await screen.findByRole("dialog");
    expect(dlg.textContent).toContain("modelo inválido");
    expect(dlg.textContent).toContain("nada será aplicado");
    expect((within(dlg).getByRole("button", { name: "Aplicar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(importarConfirmar).not.toHaveBeenCalled();
  });
});

describe("Rigidez: matriz acessível e configuração", () => {
  it("células com símbolo + rótulo acessível, legenda e parâmetros por nível", async () => {
    await montar({}, "rigidez");
    const m = await screen.findByRole("table", { name: "Matriz de rigidez: etapas por nível" });
    const celula = within(m).getAllByRole("cell").find((c) => c.getAttribute("aria-label")?.includes("Causa raiz, nível 2"));
    expect(celula?.getAttribute("aria-label")).toBe("Causa raiz, nível 2: roda reduzida");
    expect(screen.getByLabelText("Legenda").textContent).toContain("◐ reduzida");
    expect(screen.getByRole("table", { name: "Parâmetros por nível" })).toBeTruthy();
    const hooks4 = screen.getByRole("list", { name: "Hooks do nível 4" });
    expect(within(hooks4).getByText("task-so-fecha-verde").closest("li")?.textContent).toContain("bloqueia");
    expect(within(hooks4).getByText("A task só fecha com a suíte verde.")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Hooks do nível 1" })).getByText("task-so-fecha-verde").closest("li")?.textContent).toContain("só avisa");
    expect(screen.getByText("Nenhum hook gerenciado: o método volta ao padrão.")).toBeTruthy();
    const param = screen.getByRole("table", { name: "Parâmetros por nível" });
    expect(within(param).getByText("Pipeline de bug e feature")).toBeTruthy();
    expect(within(param).getByText("como o método define")).toBeTruthy();
    expect(param.textContent).not.toMatch(/_/);
  });

  it("reverter hooks só do que o app escreveu; desligar 'mostrar o plano' exige confirmação própria", async () => {
    const f = await montar({}, "rigidez");
    const reverter = vi.spyOn(f.rigidez, "hooksReverter");
    const gravar = vi.spyOn(f.maestro, "gravarConfig");
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Reverter só o que o app escreveu" })); });
    expect(reverter).toHaveBeenCalled();
    const caixa = await screen.findByLabelText(/Mostrar o plano antes de executar/);
    await act(async () => { fireEvent.click(caixa); });
    expect(gravar).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Desligar" })); });
    expect(gravar).toHaveBeenCalledWith(expect.objectContaining({ confirmado: true, config: expect.objectContaining({ confirmar_plano: false }) }));
  });

  it("prévia do plano usa rigidez:previa_plano com o pipeline e o nível escolhidos", async () => {
    const previaPlano = vi.fn(async () => PLANO.etapas);
    await montar({ rigidez: { previaPlano } }, "rigidez");
    await waitFor(() => expect(previaPlano).toHaveBeenCalledWith({ workspace_id: "w1", pipeline_id: "runx", nivel: 3 }));
    await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "5 · Total" })); });
    await waitFor(() => expect(previaPlano).toHaveBeenCalledWith({ workspace_id: "w1", pipeline_id: "runx", nivel: 5 }));
    expect(screen.getByRole("list", { name: "Etapas do plano simulado" })).toBeTruthy();
  });
});

describe("Provedores", () => {
  it("só aponta para as telas existentes (sem duplicar o decisor nem o OpenRouter)", async () => {
    await montar({}, "provedores");
    expect(screen.getByRole("button", { name: "Decisor externo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Modelos do OpenRouter" })).toBeTruthy();
  });
});
void DETALHE;
