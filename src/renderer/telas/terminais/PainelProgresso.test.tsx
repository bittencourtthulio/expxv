// @vitest-environment jsdom
// Painel de progresso (D-660…): itens e estados, scroll para a etapa atual, clique foca a sessão, recolher/colapsar, abas, menu, largura e modo estreito.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemProgresso, Progresso } from "../../../compartilhado/progresso";
import { criarStoreProgresso, type StoreProgresso } from "../../estado/progresso";
import { CHAVE_LARGURA_PROGRESSO, PainelProgresso } from "./PainelProgresso";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
beforeEach(() => { localStorage.clear(); });

type Est = ItemProgresso["estado"];
function prog(id: string, resultado: Progresso["resultado"], estados: Est[], extra: Partial<Progresso> = {}): Progresso {
  return { id, origem: "maestro", titulo: "Pipeline: nova feature", workspace_id: "ws_1", resultado, concluido: resultado === "concluido", previsto: false, iniciado_em: 1_000, fim_em: resultado === "em_andamento" ? null : 241_000, itens: estados.map((estado, i) => ({ id: `e${i}`, rotulo: `Etapa ${i + 1}`, estado })), ...extra };
}
const NOVE: Est[] = ["concluido", "concluido", "concluido", "em_andamento", "pendente", "pendente", "pendente", "pendente", "pendente"];

function montar(progressos: Progresso[], opcoes: { ws?: string | null; pref?: boolean } = {}) {
  const api = { estado: async () => ({ progressos }), dispensar: vi.fn(async () => ({ ok: true as const })), fixar: vi.fn(async () => ({ ok: true as const })), assinar: () => () => undefined };
  const focarSessao = vi.fn();
  const abrirPipelines = vi.fn();
  const avisar = vi.fn();
  const ws = { atual: opcoes.ws === null ? null : { id: opcoes.ws ?? "ws_1" }, obter() { return { atual: this.atual }; }, assinar: () => () => undefined };
  const store: StoreProgresso = criarStoreProgresso({ api: () => api as never, config: () => ({ ler: async () => opcoes.pref, gravar: async () => ({ ok: true }) }) as never, workspaces: ws, focarSessao, abrirPipelines, avisar });
  return { store, api, focarSessao, abrirPipelines, avisar };
}
async function abrir(progressos: Progresso[], opcoes: Parameters<typeof montar>[1] = {}) {
  const m = montar(progressos, opcoes);
  await act(async () => { await m.store.iniciar(); });
  return m;
}
const renderizar = (m: { store: StoreProgresso }, props: { larguraJanela?: number; compacto?: boolean } = {}) => render(<PainelProgresso store={m.store} larguraJanela={props.larguraJanela ?? 1280} compacto={props.compacto ?? false} />);

describe("PainelProgresso: lista TO-DO", () => {
  it("não renderiza nada sem progresso, em outro workspace ou com a feature desligada", async () => {
    const vazio = await abrir([]);
    expect(renderizar(vazio).container.firstChild).toBeNull();
    cleanup();
    const outro = await abrir([prog("pl:a", "em_andamento", NOVE, { workspace_id: "ws_2" })]);
    expect(renderizar(outro).container.firstChild).toBeNull();
    cleanup();
    const desligado = await abrir([prog("pl:a", "em_andamento", NOVE)], { pref: false });
    expect(renderizar(desligado).container.firstChild).toBeNull();
  });

  it("cabeçalho de uma linha com título e contador; barra fina; lista semântica `ol` com o estado de cada item em texto", async () => {
    const m = await abrir([prog("pl:a", "em_andamento", NOVE, { pedido: "Adicionar frete" })]);
    renderizar(m);
    const painel = screen.getByRole("complementary", { name: "Progresso da pipeline" });
    expect(within(painel).getByRole("heading", { name: "Pipeline: nova feature" })).toBeTruthy();
    expect(within(painel).getByLabelText("3 de 9 etapas").textContent).toBe("3/9");
    const barra = within(painel).getByRole("progressbar");
    expect(barra.getAttribute("aria-valuenow")).toBe("3");
    expect(barra.getAttribute("aria-valuemax")).toBe("9");
    const itens = within(painel).getAllByRole("listitem");
    expect(itens).toHaveLength(9);
    expect(painel.querySelector("ol")).not.toBeNull();
    expect(itens[0]!.textContent).toContain("Concluído");
    expect(itens[3]!.textContent).toContain("Em andamento");
    expect(itens[4]!.textContent).toContain("Pendente");
    expect(painel.textContent).toContain("“Adicionar frete”");
  });

  it("a etapa em andamento tem aria-current=step e só ela; falha e aguardando têm marca e texto próprios", async () => {
    const m = await abrir([prog("pl:a", "aguardando", ["concluido", "falhou", "aguardando", "pulado", "pendente"])]);
    renderizar(m);
    const itens = screen.getAllByRole("listitem");
    expect(itens.filter((i) => i.getAttribute("aria-current") === "step")).toHaveLength(1);
    expect(itens[2]!.getAttribute("aria-current")).toBe("step"); // sem etapa em andamento, a que espera você
    expect(itens[1]!.textContent).toContain("Falhou");
    expect(itens[2]!.textContent).toContain("Aguardando você");
    expect(itens[3]!.textContent).toContain("Pulado");
    expect(itens.map((i) => i.querySelector(".prog-marca")?.getAttribute("data-estado"))).toEqual(["concluido", "falhou", "aguardando", "pulado", "pendente"]);
  });

  it("a lista rola para manter a etapa atual visível (e de novo quando ela muda)", async () => {
    const rolar = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: rolar });
    const m = await abrir([prog("pl:a", "em_andamento", NOVE)]);
    renderizar(m);
    expect(rolar).toHaveBeenCalled();
    expect((rolar.mock.contexts.at(-1) as HTMLElement).getAttribute("data-item")).toBe("e3");
    rolar.mockClear();
    act(() => m.store.aplicar({ progressos: [prog("pl:a", "em_andamento", ["concluido", "concluido", "concluido", "concluido", "em_andamento", "pendente", "pendente", "pendente", "pendente"])] }));
    expect((rolar.mock.contexts.at(-1) as HTMLElement).getAttribute("data-item")).toBe("e4");
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("clicar numa etapa com terminal foca a sessão dela; etapa sem terminal não é botão", async () => {
    const itens = prog("pl:a", "em_andamento", ["concluido", "em_andamento", "pendente"]);
    itens.itens[0]!.sessao_id = "sess_1";
    itens.itens[1]!.sessao_id = "sess_2";
    const m = await abrir([itens]);
    renderizar(m);
    const botoes = screen.getAllByTitle("Ir para o terminal desta etapa");
    expect(botoes).toHaveLength(2);
    fireEvent.click(botoes[1]!);
    expect(m.focarSessao).toHaveBeenCalledWith("sess_2");
    expect(screen.getAllByRole("listitem")[2]!.querySelector("button")).toBeNull();
  });

  it("portão humano: 'Aguardando você' em âmbar com a ação 'Abrir' que foca o painel que espera", async () => {
    const p = prog("pl:a", "aguardando", ["concluido", "aguardando", "pendente"]);
    p.itens[1]!.sessao_id = "sess_espera";
    const m = await abrir([p]);
    renderizar(m);
    expect(screen.getByRole("complementary").getAttribute("data-tom")).toBe("aguardando");
    expect(screen.getByText("Aguardando você: Etapa 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(m.focarSessao).toHaveBeenCalledWith("sess_espera");
  });

  it("falha mostra 'Parou na etapa X' e o botão Dispensar; o painel não fecha sozinho", async () => {
    const m = await abrir([prog("pl:a", "falhou", ["concluido", "falhou", "pendente"])]);
    renderizar(m);
    expect(screen.getByText("Parou na etapa Etapa 2: falhou")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dispensar" }));
    expect(m.api.dispensar).toHaveBeenCalledWith("pl:a");
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("concluído: resumo 'Concluído: 9/9 em 4 min' (não é aguardando: sem botão Abrir)", async () => {
    const m = await abrir([prog("pl:a", "em_andamento", NOVE)]);
    renderizar(m);
    act(() => m.store.aplicar({ progressos: [prog("pl:a", "concluido", Array<Est>(9).fill("concluido"))] }));
    expect(screen.getByText("Concluído: 9/9 em 4 min")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Abrir" })).toBeNull();
  });

  it("lista 'prevista' (skill sem Maestro) se declara prevista", async () => {
    const m = await abrir([prog("sk:runx:p", "em_andamento", ["em_andamento", "pendente"], { origem: "skill", titulo: "/expx:runx", previsto: true })]);
    renderizar(m);
    expect(screen.getByText("Etapas previstas")).toBeTruthy();
  });

  it("fases do sprintx: cabeçalhos curtos; fase concluída colapsa sozinha e o dono pode abrir", async () => {
    const itens: ItemProgresso[] = [
      { id: "T-01", rotulo: "T-01 Modelo", estado: "concluido", grupo: "F1 · Fundação" },
      { id: "T-02", rotulo: "T-02 Migração", estado: "concluido", grupo: "F1 · Fundação" },
      { id: "T-03", rotulo: "T-03 Tela", estado: "em_andamento", grupo: "F2 · Interface" },
      { id: "T-04", rotulo: "T-04 Testes", estado: "pendente", grupo: "F2 · Interface" },
    ];
    const m = await abrir([prog("sx:frete", "em_andamento", [], { origem: "sprintx", titulo: "Sprint: Frete", itens })]);
    renderizar(m);
    const cab1 = screen.getByRole("button", { name: /F1 · Fundação/ });
    const cab2 = screen.getByRole("button", { name: /F2 · Interface/ });
    expect(cab1.getAttribute("aria-expanded")).toBe("false");
    expect(cab2.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByText("T-01 Modelo")).toBeNull();
    expect(screen.getByText("T-03 Tela")).toBeTruthy();
    expect(cab1.textContent).toContain("2/2");
    fireEvent.click(cab1);
    expect(screen.getByText("T-01 Modelo")).toBeTruthy();
  });
});

describe("PainelProgresso: recolher, fechar, menu, abas", () => {
  it("recolher vira a barra fina de 24 px com o contador; clicar reabre", async () => {
    const m = await abrir([prog("pl:a", "em_andamento", NOVE)]);
    const { container } = renderizar(m);
    fireEvent.click(screen.getByRole("button", { name: "Recolher o painel de progresso" }));
    const slot = container.querySelector<HTMLElement>(".prog-slot")!;
    expect(slot.style.width).toBe("24px");
    const barra = screen.getByRole("button", { name: /Mostrar o progresso: Pipeline: nova feature, 3 de 9/ });
    expect(barra.textContent).toContain("3/9");
    expect(screen.queryByRole("list")).toBeNull();
    fireEvent.click(barra);
    expect(screen.getByRole("list")).toBeTruthy();
  });

  it("fechar dispensa só aquele progresso; os outros continuam", async () => {
    const m = await abrir([prog("pl:a", "em_andamento", NOVE), prog("pl:b", "em_andamento", ["em_andamento", "pendente"], { titulo: "Pipeline: corrigir bug", iniciado_em: 2_000 })]);
    renderizar(m);
    fireEvent.click(screen.getByRole("button", { name: "Fechar este progresso" }));
    expect(m.api.dispensar).toHaveBeenCalledWith("pl:a");
    expect(screen.getByRole("heading", { name: "Pipeline: corrigir bug" })).toBeTruthy();
  });

  it("menu '⋯': Fixar aberto (liga e desliga) e Ver detalhes na tela Pipelines", async () => {
    const m = await abrir([prog("pl:a", "em_andamento", NOVE)]);
    renderizar(m);
    fireEvent.click(screen.getByRole("button", { name: "Mais opções do progresso" }));
    const fixar = screen.getByRole("menuitemcheckbox", { name: /Fixar aberto/ });
    expect(fixar.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(fixar);
    expect(m.api.fixar).toHaveBeenCalledWith("pl:a", true);
    fireEvent.click(screen.getByRole("button", { name: "Mais opções do progresso" }));
    expect(screen.getByRole("menuitemcheckbox", { name: /Fixar aberto/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: /Ver detalhes na tela Pipelines/ }));
    expect(m.abrirPipelines).toHaveBeenCalledWith(expect.objectContaining({ id: "pl:a" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("vários progressos: no máximo 3 abas, o resto vira 'e mais N'; a aba escolhida troca a lista", async () => {
    const todos = ["a", "b", "c", "d", "e"].map((x, i) => prog(`pl:${x}`, "em_andamento", ["em_andamento", "pendente"], { titulo: `Pipeline: tarefa ${x}`, iniciado_em: 1_000 + i }));
    const m = await abrir(todos);
    renderizar(m);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "e mais 2" }));
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    fireEvent.click(screen.getByRole("tab", { name: /tarefa d/ }));
    expect(screen.getByRole("heading", { name: "Pipeline: tarefa d" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /tarefa d/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("o progresso que pede atenção (falha/aguardando) aparece primeiro", async () => {
    const m = await abrir([prog("pl:a", "em_andamento", NOVE), prog("pl:b", "aguardando", ["concluido", "aguardando"], { titulo: "Pipeline: corrigir bug", iniciado_em: 5_000 })]);
    renderizar(m);
    expect(screen.getByRole("heading", { name: "Pipeline: corrigir bug" })).toBeTruthy();
  });
});

describe("PainelProgresso: largura e janela estreita", () => {
  it("largura padrão 248; o divisor muda de 16 em 16 pelas setas, respeita 200–320 e persiste", async () => {
    const m = await abrir([prog("pl:a", "em_andamento", NOVE)]);
    const { container } = renderizar(m);
    const slot = container.querySelector<HTMLElement>(".prog-slot")!;
    expect(slot.style.width).toBe("248px");
    const borda = screen.getByRole("separator", { name: /Largura do painel de progresso/ });
    expect(borda.getAttribute("aria-valuenow")).toBe("248");
    fireEvent.keyDown(borda, { key: "ArrowLeft" });
    expect(slot.style.width).toBe("264px");
    expect(localStorage.getItem(CHAVE_LARGURA_PROGRESSO)).toBe("264");
    for (let i = 0; i < 10; i++) fireEvent.keyDown(borda, { key: "ArrowLeft" });
    expect(slot.style.width).toBe("320px");
    for (let i = 0; i < 20; i++) fireEvent.keyDown(borda, { key: "ArrowRight" });
    expect(slot.style.width).toBe("200px");
  });

  it("restaura a largura salva (e ignora lixo)", async () => {
    localStorage.setItem(CHAVE_LARGURA_PROGRESSO, "300");
    const m = await abrir([prog("pl:a", "em_andamento", NOVE)]);
    expect(renderizar(m).container.querySelector<HTMLElement>(".prog-slot")!.style.width).toBe("300px");
    cleanup();
    localStorage.setItem(CHAVE_LARGURA_PROGRESSO, "999999");
    expect(renderizar(m).container.querySelector<HTMLElement>(".prog-slot")!.style.width).toBe("320px");
    cleanup();
    localStorage.setItem(CHAVE_LARGURA_PROGRESSO, "lixo");
    expect(renderizar(m).container.querySelector<HTMLElement>(".prog-slot")!.style.width).toBe("248px");
  });

  it("janela estreita (< 1000 px): barra fina de 24 px; clicar expande SOBREPOSTO (a coluna continua 24 px) e Esc recolhe", async () => {
    const m = await abrir([prog("pl:a", "em_andamento", NOVE)]);
    const { container } = renderizar(m, { larguraJanela: 900 });
    const slot = container.querySelector<HTMLElement>(".prog-slot")!;
    expect(slot.style.width).toBe("24px");
    expect(screen.queryByRole("separator")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Mostrar o progresso/ }));
    expect(slot.style.width).toBe("24px"); // não esmaga os terminais
    expect(screen.getByRole("complementary").hasAttribute("data-sobreposto")).toBe(true);
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("button", { name: /Mostrar o progresso/ })).toBeTruthy();
  });

  it("foco único (D-32, compacto): também fica na barra fina", async () => {
    const m = await abrir([prog("pl:a", "em_andamento", NOVE)]);
    const { container } = renderizar(m, { compacto: true });
    expect(container.querySelector<HTMLElement>(".prog-slot")!.style.width).toBe("24px");
  });

  it("a região viva (aria-live=polite) anuncia só mudanças de etapa", async () => {
    const m = await abrir([prog("pl:a", "em_andamento", ["em_andamento", "pendente"])]);
    renderizar(m);
    const viva = () => screen.getByRole("status");
    expect(viva().getAttribute("aria-live")).toBe("polite");
    act(() => m.store.aplicar({ progressos: [prog("pl:a", "em_andamento", ["concluido", "em_andamento"])] }));
    expect(viva().textContent).toBe("Pipeline: nova feature. Etapa 2 de 2: Etapa 2.");
  });
});
