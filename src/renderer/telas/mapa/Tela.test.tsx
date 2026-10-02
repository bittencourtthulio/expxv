// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiMapa, EventoMapaIpc } from "../../../compartilhado/mapa";
import { formatar, varrer } from "../../a11y/varredura";
import { pedirMapa } from "../../estado/mapa-acoes";
import { TelaMapa, type GanchosMapa } from "./Mapa";
import { PANE, WS, apiFalsa, resumoFalso, type OpcoesApi } from "./fabrica-teste";

beforeEach(() => { HTMLCanvasElement.prototype.getContext = (() => null) as never; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

type Espia = { [K in keyof ApiMapa]: ReturnType<typeof vi.fn> & ApiMapa[K] } & { emitir: (e: EventoMapaIpc) => void };
function espiar(o: OpcoesApi = {}): Espia {
  const api = apiFalsa(o);
  let ouvinte: (e: EventoMapaIpc) => void = () => undefined;
  api.assinar = (cb) => { ouvinte = cb; return () => undefined; };
  for (const k of Object.keys(api) as Array<keyof ApiMapa>) if (k !== "assinar") (api as unknown as Record<string, unknown>)[k] = vi.fn(api[k] as never);
  return Object.assign(api, { emitir: (e: EventoMapaIpc) => act(() => ouvinte(e)) }) as unknown as Espia;
}
const ganchos: GanchosMapa = { panes: async () => [PANE], trabalhos: async () => ["minha-feature"] };
async function montar(api: Espia, ws: string | null = WS) {
  await act(async () => { render(<TelaMapa api={api} workspaceId={ws} ganchos={ganchos} semCanvas />); });
  if (ws !== null) await screen.findByRole("toolbar", { name: "Controles do mapa" });
}
const clicar = (el: HTMLElement) => act(async () => { fireEvent.click(el); });
const aba = (nome: string) => clicar(screen.getByRole("tab", { name: nome }));
const esperar = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const confere = (onde: string) => { const a = varrer(document.body); expect(a.length === 0 ? "" : `${onde}\n${formatar(a)}`).toBe(""); };

describe("casca e barra (D-32)", () => {
  it("uma única linha de controles com as 7 visões, busca, filtros, agrupar, exportar, método e mais; sem violação de acessibilidade", async () => {
    await montar(espiar());
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Grafo", "Camadas", "Fluxo", "Hotspots", "Entradas", "Dados", "Dívida"]);
    for (const n of ["Buscar símbolo", "Agrupar por"]) expect(screen.getByLabelText(n)).toBeTruthy();
    for (const n of [/Filtros/, /Exportar/, /Método/, /Mais/, /Reanalisar/]) expect(screen.getByRole("button", { name: n })).toBeTruthy();
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    await screen.findByText(/nós ·/);
    confere("grafo");
  });
  it("a barra é estruturalmente uma linha: flex nowrap, altura do token, sem cartões nem título de página", () => {
    const css = readFileSync(join(__dirname, "mapa.css"), "utf8");
    const regra = /\.mp-barra\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(regra).toMatch(/flex-wrap:\s*nowrap/);
    expect(regra).toMatch(/height:\s*var\(--barra-altura\)/);
    expect(regra).toMatch(/white-space:\s*nowrap/);
  });
  it("nenhuma cor literal nos arquivos da tela (só tokens)", () => {
    for (const f of readdirSync(__dirname)) {
      if (!/\.(tsx?|css)$/.test(f) || /\.test\.|fabrica-teste/.test(f)) continue;
      const t = readFileSync(join(__dirname, f), "utf8").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("/*")).join("\n");
      expect(t.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? [], f).toEqual([]);
    }
  });
  it("P-242: a tela monta só com mapa:resumo; primeiro quadro (barra) em até 100 ms com IPC falso", async () => {
    const api = espiar();
    const t0 = performance.now();
    await act(async () => { render(<TelaMapa api={api} workspaceId={WS} ganchos={ganchos} semCanvas />); });
    await screen.findByRole("toolbar");
    expect(performance.now() - t0).toBeLessThan(100);
    expect(api.resumo).toHaveBeenCalledTimes(1);
    expect(api.analisar).not.toHaveBeenCalled();
    const chamados = Object.keys(api).filter((k) => ((api as unknown as Record<string, { mock?: { calls: unknown[] } }>)[k]?.mock?.calls.length ?? 0) > 0);
    expect(chamados.every((k) => ["resumo", "grafo", "layoutLer", "layoutGravar"].includes(k))).toBe(true);
  });
});

describe("estados", () => {
  it("sem projeto e sem recurso do app explicam o próximo passo", async () => {
    await act(async () => { render(<TelaMapa api={espiar()} workspaceId={null} ganchos={ganchos} />); });
    expect(screen.getByText("Nenhum projeto aberto")).toBeTruthy();
    cleanup();
    await act(async () => { render(<TelaMapa workspaceId="ws_x" ganchos={ganchos} />); });
    expect(screen.getByText("Mapa indisponível")).toBeTruthy();
  });
  it("nunca analisado: botão primário com estimativa; clicar analisa de forma completa", async () => {
    const api = espiar({ resumo: resumoFalso({ estado: "vazio", arquivos: 0, estimativa_arquivos: 5000 }) });
    await montar(api);
    expect(screen.getByText(/5\.000 arquivos/)).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Analisar este projeto" }));
    expect(api.analisar).toHaveBeenCalledWith(WS, "completo", true);
    expect(screen.getByRole("button", { name: /Exportar/ })).toBeTruthy();
    confere("nunca");
  });
  it("analisando: progresso por fase e Cancelar", async () => {
    const api = espiar({ resumo: resumoFalso({ estado: "vazio", analisando: true, progresso: { execucao_id: 1, fase: "extraindo", feito: 10, total: 40 } }) });
    await montar(api);
    expect(screen.getByText(/Extraindo símbolos: 10 de 40/)).toBeTruthy();
    expect((screen.getByLabelText("Progresso da análise") as HTMLProgressElement).value).toBe(25);
    await clicar(screen.getByRole("button", { name: "Cancelar análise" }));
    expect(api.cancelar).toHaveBeenCalledWith(WS);
    confere("analisando");
  });
  it("evento de progresso atualiza a barra; fim da análise recarrega o resumo", async () => {
    const api = espiar();
    await montar(api);
    await api.emitir({ tipo: "progresso", workspace_id: WS, progresso: { execucao_id: 2, fase: "resolvendo", feito: 3, total: 9 } });
    expect(screen.getByText(/Resolvendo dependências: 3 de 9/)).toBeTruthy();
    await api.emitir({ tipo: "terminou", workspace_id: WS });
    await waitFor(() => expect(api.resumo).toHaveBeenCalledTimes(2));
    await api.emitir({ tipo: "terminou", workspace_id: "ws_outro" });
  });
  it("desatualizado: banner 'N arquivos mudaram — atualizar' dispara a análise incremental", async () => {
    const api = espiar({ resumo: resumoFalso({ desatualizado: true, alterados_n: 3 }) });
    await montar(api);
    expect(screen.getByText("3 arquivos mudaram — atualizar")).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Atualizar agora" }));
    expect(api.analisar).toHaveBeenCalledWith(WS, "incremental", true);
  });
  it("parcial e erro: continuar analisando; tentar de novo", async () => {
    await montar(espiar({ resumo: resumoFalso({ estado: "parcial" }) }));
    expect(screen.getByText(/interrompida; o mapa está parcial/)).toBeTruthy();
    cleanup();
    const ruim = espiar();
    ruim.resumo = vi.fn(async () => { throw new Error("[mapa] banco ocupado"); }) as never;
    await act(async () => { render(<TelaMapa api={ruim} workspaceId={WS} ganchos={ganchos} semCanvas />); });
    expect(await screen.findByText("banco ocupado")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
  });
  it("banners: história indisponível e linguagens degradadas com o comando do ctags para copiar", async () => {
    await montar(espiar({ resumo: resumoFalso({ historia: "indisponivel", degradadas: 12 }) }));
    expect(screen.getByText(/Sem história do git/)).toBeTruthy();
    expect(screen.getByText(/12 arquivos em linguagens sem gramática/)).toBeTruthy();
    expect(screen.getByText("brew install universal-ctags")).toBeTruthy();
  });
});

describe("visões", () => {
  it("Camadas, Fluxo, Hotspots, Entradas, Dados e Dívida renderizam e passam na varredura de acessibilidade", async () => {
    await montar(espiar());
    await aba("Camadas");
    await screen.findByText(/2 módulos/);
    expect(screen.getByRole("img", { name: /Matriz de dependências/ })).toBeTruthy();
    expect(screen.getByText(/lib não pode depender de src/)).toBeTruthy();
    confere("camadas");
    await aba("Hotspots");
    await screen.findByText(/pontuação 0.80/);
    confere("hotspots");
    await aba("Entradas");
    await screen.findByText("GET /users");
    confere("entradas");
    await aba("Dados");
    await clicar(await screen.findByRole("button", { name: /usuarios/ }));
    expect(screen.getByText("Quem toca usuarios")).toBeTruthy();
    confere("dados");
    await aba("Dívida");
    await screen.findByText(/Ciclos de dependência/);
    confere("divida");
  });
  it("Dívida: código morto aparece SEMPRE como candidato", async () => {
    await montar(espiar());
    await aba("Dívida");
    await screen.findByText(/Candidatos a código morto/);
    const alvos = [...document.querySelectorAll("h3, p, span, button, li")].filter((e) => /morto/i.test(e.textContent ?? "") && e.children.length === 0);
    expect(alvos.length).toBeGreaterThan(0);
    for (const e of alvos) expect(e.textContent ?? "", e.outerHTML).toMatch(/candidato/i);
    expect(screen.getByText(/Desligada por padrão/)).toBeTruthy();
  });
  it("Entradas: abrir uma rota leva ao Fluxo, com arestas heurísticas tracejadas e rótulo acessível", async () => {
    await montar(espiar());
    await aba("Entradas");
    await clicar(await screen.findByRole("button", { name: /GET \/users/ }));
    expect(screen.getByRole("tab", { name: "Fluxo", selected: true })).toBeTruthy();
    await screen.findByRole("group", { name: "Fluxograma da entrada" });
    const heur = document.querySelector('path.mp-fl-aresta[data-tracejado]') as SVGPathElement;
    expect(heur.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(screen.getByRole("img", { name: /heurística: sim:src\/a\.ts#listar chama sim:src\/b\.ts#ler/ })).toBeTruthy();
    const exata = [...document.querySelectorAll("path.mp-fl-aresta")].find((p) => !p.hasAttribute("data-tracejado"));
    expect(exata?.getAttribute("stroke-dasharray")).toBeNull();
    confere("fluxo");
    await clicar(screen.getByRole("button", { name: "Recolher listar" }));
    expect(screen.queryByRole("button", { name: /^ler/ })).toBeNull();
  });
});

describe("grafo: alternativa acessível em lista", () => {
  it("'Ver como lista' mostra os nós, seleciona e expande clusters; o painel carrega o detalhe do arquivo", async () => {
    const api = espiar();
    await montar(api);
    await screen.findByText(/nós ·/);
    await clicar(screen.getByRole("combobox", { name: "Agrupar por" }).parentElement?.querySelector("select") as HTMLElement);
    fireEvent.change(screen.getByLabelText("Agrupar por"), { target: { value: "arquivo" } });
    await clicar(screen.getByRole("button", { name: "Ver como lista" }));
    const lista = await screen.findByRole("list", { name: "Nós do grafo" });
    await clicar(within(lista).getByRole("button", { name: /a\.ts/ }));
    await waitFor(() => expect(api.no).toHaveBeenCalledWith(WS, "arq:src/a.ts"));
    expect(await screen.findByRole("region", { name: "Raio de impacto provisório" })).toBeTruthy();
    confere("lista");
  });
  it("agrupado por módulo, o cluster aparece com a contagem e Enter/clique o expande", async () => {
    await montar(espiar());
    await screen.findByText(/nós ·/);
    await clicar(screen.getByRole("button", { name: "Ver como lista" }));
    const lista = await screen.findByRole("list", { name: "Nós do grafo" });
    expect(within(lista).getByRole("button", { name: /src \(3\)/ })).toBeTruthy();
    await clicar(within(lista).getByRole("button", { name: /src \(3\)/ }));
    await waitFor(() => expect(screen.getByRole("list", { name: "Nós do grafo" }).textContent).toMatch(/a\.ts/));
  });
});

describe("selecionar arquivo -> ver raio -> disparar legadox-raio em 3 cliques", () => {
  it("o raio sempre leva o selo 'provisório' e o disparo usa o arquivo selecionado, o Pane e o trabalho", async () => {
    const api = espiar();
    await montar(api);
    await aba("Hotspots");
    await clicar(await screen.findByRole("button", { name: /src\/a\.ts/ })); // clique 1: selecionar
    const raio = await screen.findByRole("region", { name: "Raio de impacto provisório" });
    expect(within(raio).getAllByText("provisório").length).toBeGreaterThanOrEqual(2);
    expect(raio.textContent).toMatch(/provisório — quem classifica é o avaliador-de-raio/);
    expect(raio.textContent).toMatch(/MEDIO/);
    await clicar(screen.getByRole("button", { name: /Método/ })); // clique 2
    await waitFor(() => expect((screen.getByLabelText("Pane de destino") as HTMLSelectElement).value).toBe(PANE.id));
    await clicar(screen.getByRole("menuitem", { name: /Raio de impacto do arquivo/ })); // clique 3
    expect(api.disparar).toHaveBeenCalledWith(WS, { acao: "legadox_raio", pane_id: PANE.id, trabalho_id: "minha-feature", arquivos: ["src/a.ts"] });
    expect(await screen.findByText(/Enviado ao Pane: \/expx:stackx-detectar/)).toBeTruthy();
  });
  it("sem arquivo selecionado o raio fica desabilitado; sem Pane nada é enviado; ações humanas não existem no menu", async () => {
    const api = espiar();
    await act(async () => { render(<TelaMapa api={api} workspaceId={WS} ganchos={{ panes: async () => [], trabalhos: async () => [] }} semCanvas />); });
    await screen.findByRole("toolbar");
    await clicar(screen.getByRole("button", { name: /Método/ }));
    const itens = screen.getAllByRole("menuitem");
    expect(itens).toHaveLength(5);
    expect(itens.every((i) => i.getAttribute("aria-disabled") === "true")).toBe(true);
    expect(screen.queryByText(/aprovar|assinar|mergex/i)).toBeNull();
    await clicar(itens[0] as HTMLElement);
    expect(api.disparar).not.toHaveBeenCalled();
  });
});

describe("busca, filtros, exportação, perfil, apagar e opt-ins", () => {
  it("busca com debounce seleciona o símbolo e abre o detalhe com evidência copiável", async () => {
    const api = espiar();
    await montar(api);
    fireEvent.change(screen.getByLabelText("Buscar símbolo"), { target: { value: "lis" } });
    await clicar(await screen.findByRole("button", { name: /listar/ }));
    await waitFor(() => expect(api.no).toHaveBeenCalledWith(WS, "sim:src/a.ts#listar"));
    expect(api.buscar).toHaveBeenCalledTimes(1);
  });
  it("filtros: pasta fora da raiz nunca vai ao main; 'só exatas' refaz o pedido do grafo", async () => {
    const api = espiar();
    await montar(api);
    await screen.findByText(/nós ·/);
    await clicar(screen.getByRole("button", { name: /Filtros/ }));
    fireEvent.change(screen.getByLabelText("Pasta"), { target: { value: "../etc" } });
    fireEvent.change(screen.getByLabelText("Confiança"), { target: { value: "exata" } });
    await esperar(60);
    const ultimas = api.grafo.mock.calls.at(-1) as unknown[];
    expect(ultimas[2]).toEqual({ min_confianca: "exata" });
  });
  it("exportar: destino padrão e 'escolher a pasta'; relatório Markdown usa a vista relatório", async () => {
    const api = espiar();
    await montar(api);
    await clicar(screen.getByRole("button", { name: /Exportar/ }));
    await clicar(screen.getByRole("menuitem", { name: "Mermaid" }));
    expect(api.exportar).toHaveBeenLastCalledWith(WS, "mermaid", { tipo: "grafo", nivel: "arquivo", filtro: {} }, "padrao");
    await clicar(screen.getByRole("button", { name: /Exportar/ }));
    await clicar(screen.getByRole("menuitemradio", { name: "Escolher a pasta…" }));
    await clicar(screen.getByRole("menuitem", { name: "Relatório Markdown" }));
    expect(api.exportar).toHaveBeenLastCalledWith(WS, "md", { tipo: "relatorio" }, "escolher");
  });
  it("perfil provisório: aviso 'não é o PERFIL.md' e Copiar como Markdown usa a área de transferência do renderer", async () => {
    const escrever = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
    await montar(espiar());
    await clicar(screen.getByRole("button", { name: /Mais/ }));
    await clicar(screen.getByRole("menuitem", { name: "Ver perfil provisório" }));
    const d = await screen.findByRole("dialog", { name: "Perfil provisório" });
    expect(within(d).getByText(/Não é o PERFIL\.md/)).toBeTruthy();
    await clicar(await within(d).findByRole("button", { name: "Copiar como Markdown" }));
    expect(escrever).toHaveBeenCalledTimes(1);
    expect(String((escrever.mock.calls[0] as unknown[])[0])).toMatch(/não é o PERFIL\.md/);
    confere("perfil");
  });
  it("apagar o mapa exige digitar APAGAR no diálogo da própria UI (zero diálogo nativo)", async () => {
    const api = espiar();
    const confirmar = vi.spyOn(window, "confirm");
    await montar(api);
    await clicar(screen.getByRole("button", { name: /Mais/ }));
    await clicar(screen.getByRole("menuitem", { name: "Apagar o mapa…" }));
    const d = await screen.findByRole("dialog");
    const botao = within(d).getByRole("button", { name: "Apagar o mapa" }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText("Confirmação"), { target: { value: "apagar" } });
    expect(botao.disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText("Confirmação"), { target: { value: "APAGAR" } });
    await clicar(botao);
    expect(api.apagar).toHaveBeenCalledWith(WS, "APAGAR");
    expect(confirmar).not.toHaveBeenCalled();
  });
  it("opt-ins: agentes consultarem o mapa e atualizar sozinho começam desligados e gravam só a chave pedida", async () => {
    const api = espiar();
    await montar(api);
    await clicar(screen.getByRole("button", { name: /Mais/ }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Permitir que agentes consultem o mapa" }).getAttribute("aria-checked")).toBe("false");
    await clicar(screen.getByRole("menuitemcheckbox", { name: "Permitir que agentes consultem o mapa" }));
    expect(api.configGravar).toHaveBeenCalledWith(WS, { expor_agentes: true });
    await clicar(screen.getByRole("menuitemcheckbox", { name: "Atualizar sozinho quando o código mudar" }));
    expect(api.configGravar).toHaveBeenLastCalledWith(WS, { auto_atualizar: true });
  });
  it("a paleta (pedirMapa) dispara a análise e o perfil na tela montada", async () => {
    const api = espiar();
    await montar(api);
    await act(async () => { pedirMapa("analisar"); });
    expect(api.analisar).toHaveBeenCalledWith(WS, "completo", true);
    await act(async () => { pedirMapa("perfil"); });
    expect(await screen.findByRole("dialog", { name: "Perfil provisório" })).toBeTruthy();
  });
});
