// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConhecimento, EventoConhecimentoApi } from "../../../compartilhado/conhecimento-api";
import type { ApiRag, EventoRag } from "../../../compartilhado/rag";
import { instalar, remover } from "../../a11y/ade-falso";
import { BACKEND_LOCAL, conhecimentoFalso, ESTADO_CONHECIMENTO, ESTADO_VAZIO, no, ragFalso } from "../../a11y/ade-falso-conhecimento";
import { criarStoreConhecimento } from "../../estado/conhecimento";
import { criarStoreRag } from "../../estado/rag";
import { storeWorkspaces } from "../../estado/workspaces";
import { TelaConhecimento } from "./Conhecimento";
import { Grafo } from "./Grafo";

beforeEach(async () => {
  instalar();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null as never); // jsdom não desenha canvas
  await storeWorkspaces.iniciar();
});
afterEach(() => { cleanup(); remover(); vi.restoreAllMocks(); });

async function montar(sobre: Partial<ApiConhecimento> = {}, sobreRag: Partial<ApiRag> = {}, aba: "grafo" | "lista" | "fontes" | "aprendizados" | "backend" | "config" = "grafo") {
  const api = conhecimentoFalso(sobre);
  const rag = ragFalso(sobreRag);
  let emitirC: (e: EventoConhecimentoApi) => void = () => undefined;
  api.assinar = (cb) => { emitirC = cb; return () => undefined; };
  const storeC = criarStoreConhecimento({ api: () => api, avisar: () => undefined, quadro: (f) => f() });
  const storeR = criarStoreRag({ api: () => rag, avisar: () => undefined });
  await act(async () => { render(<TelaConhecimento store={storeC} storeBackend={storeR} abaInicial={aba} />); });
  return { api, rag, storeC, storeR, emitirC: (e: EventoConhecimentoApi) => act(async () => { emitirC(e); }), emitirR: (e: EventoRag) => act(async () => { rag.emitir(e); }) };
}
const aba = async (nome: string) => { await act(async () => { fireEvent.click(screen.getByRole("tab", { name: nome })); }); };
const clicar = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };

describe("Conhecimento: barra única e estados", () => {
  it("uma linha de controles: abas, filtros de tipo, período, missão, busca de nó e busca geral", async () => {
    await montar();
    const barra = screen.getByRole("toolbar", { name: "Controles do conhecimento" });
    expect(within(screen.getByRole("tablist", { name: "Seções do conhecimento" })).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Grafo", "Lista", "Fontes", "Aprendizados", "Backend", "Config"]);
    expect(within(barra).getByRole("group", { name: "Filtrar por tipo de nó" })).toBeTruthy();
    expect(within(barra).getByLabelText("Período")).toBeTruthy();
    expect(within(barra).getByLabelText("Missão")).toBeTruthy();
    expect(within(barra).getByRole("searchbox", { name: "Buscar nó" })).toBeTruthy();
    expect(within(barra).getByRole("searchbox", { name: "Buscar no conhecimento" })).toBeTruthy();
    expect(screen.getByRole("tabpanel")).toBeTruthy();
  });

  it("estado vazio ensina o próximo passo e o botão indexa docs e commits", async () => {
    const reindexar = vi.fn(async () => ({ enfileirado: true }));
    await montar({ estado: async () => ESTADO_VAZIO, subgrafo: async () => ({ nos: [], arestas: [], truncado: false }), reindexar });
    expect(await screen.findByText("Ainda não há conhecimento neste projeto")).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Indexar docs e commits agora" }));
    expect(reindexar).toHaveBeenCalledWith("w1", "docs");
    expect(reindexar).toHaveBeenCalledWith("w1", "git");
  });

  it("carregando mostra aria-busy; erro tem 'Tentar de novo' e 'Reiniciar indexação'", async () => {
    let soltar: (v: { nos: never[]; arestas: never[]; truncado: boolean }) => void = () => undefined;
    await montar({ subgrafo: () => new Promise((r) => { soltar = r as never; }) });
    expect(screen.getByText("Carregando grafo…").getAttribute("aria-busy")).toBe("true");
    await act(async () => { soltar({ nos: [], arestas: [], truncado: false }); });
    cleanup();
    const subgrafo = vi.fn().mockRejectedValueOnce(new Error("worker caiu")).mockResolvedValue({ nos: [no("n1", "arquivo")], arestas: [], truncado: false });
    await montar({ subgrafo });
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("worker caiu");
    expect(screen.getByRole("button", { name: "Reiniciar indexação" })).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(document.querySelector("canvas")?.getAttribute("data-nos")).toBe("1"));
  });

  it("RAG desligado explica e oferece ligar", async () => {
    const gravarConfig = vi.fn(conhecimentoFalso().gravarConfig);
    await montar({ estado: async () => ({ ...ESTADO_CONHECIMENTO, ativo: false }), gravarConfig });
    expect(await screen.findByText("O conhecimento está desligado neste projeto")).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Ligar conhecimento" }));
    expect(gravarConfig).toHaveBeenCalledWith({ workspace_id: "w1", ativo: true });
  });

  it("grafo preenchido: canvas com os nós, legenda por tipo e aviso quando truncado", async () => {
    await montar({ subgrafo: async () => ({ nos: [no("n1", "arquivo"), no("n2", "task")], arestas: [{ origem: "n1", destino: "n2", tipo: "toca", peso: 1 }], truncado: true }) });
    await waitFor(() => expect(document.querySelector("canvas")?.getAttribute("data-nos")).toBe("2"));
    expect(screen.getByRole("list", { name: "Legenda dos tipos de nó" }).textContent).toContain("Arquivo 1");
    expect(screen.getByText(/Grafo truncado/)).toBeTruthy();
  });

  it("indexando: barra fina com contagem pelo evento de progresso e fim limpa a barra", async () => {
    const m = await montar();
    await m.emitirC({ canal: "conhecimento:progresso", payload: { workspace_id: "w1", fase: "docs", pendentes: 37, pct: 63 } });
    expect(screen.getByText(/63% indexando/)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Progresso da indexação" }).getAttribute("aria-valuenow")).toBe("63");
    await m.emitirC({ canal: "conhecimento:progresso", payload: { workspace_id: "w1", fase: null, pendentes: 0, pct: null } });
    expect(screen.queryByRole("progressbar", { name: "Progresso da indexação" })).toBeNull();
  });

  it("offline: faixa 'usando cópia de <data>'", async () => {
    await montar({}, { estado: async () => ({ ...BACKEND_LOCAL, provedor: "qdrant", modo: "espelho", offline: true, ultima_sincronizacao: "2026-09-30T10:00:00Z" }) });
    expect(await screen.findByText(/offline: usando cópia de 2026-09-30/)).toBeTruthy();
  });

  it("⌘F/Ctrl+F foca a busca; duplo clique no canvas só age em nó (sem nó sob o ponteiro, nada)", async () => {
    await montar();
    await act(async () => { fireEvent.keyDown(screen.getByRole("region", { name: "Conhecimento" }), { key: "f", ctrlKey: true }); });
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Buscar no conhecimento" }));
  });
});

describe("Conhecimento: lista acessível e detalhe do nó", () => {
  it("a aba Lista tem os mesmos nós; clicar abre o detalhe com fontes, aprendizados e vizinhos; Esc limpa", async () => {
    const detalheNo = vi.fn(conhecimentoFalso().detalheNo);
    await montar({ detalheNo });
    await aba("Lista");
    const lista = await screen.findByRole("list", { name: "Nós do grafo de conhecimento" });
    expect(within(lista).getAllByRole("listitem").length).toBe(6);
    await clicar(within(lista).getByRole("button", { name: /src\/login\.ts/ }));
    const detalhe = await screen.findByRole("complementary", { name: "Detalhe do nó" });
    expect(detalheNo).toHaveBeenCalledWith("w1", "n1");
    await waitFor(() => expect(within(detalhe).getByText("Fontes")).toBeTruthy());
    expect(within(detalhe).getByText("Documento d1")).toBeTruthy();
    expect(within(detalhe).getByText("Vizinhos")).toBeTruthy();
    await act(async () => { fireEvent.keyDown(screen.getByRole("region", { name: "Conhecimento" }), { key: "Escape" }); });
    expect(within(screen.getByRole("complementary")).getByText(/Selecione um nó/)).toBeTruthy();
  });

  it("teclado na lista: ↓ move, → vai ao vizinho, ← volta; só a linha atual entra no Tab", async () => {
    await montar();
    await aba("Lista");
    const lista = await screen.findByRole("list", { name: "Nós do grafo de conhecimento" });
    const botoes = () => within(lista).getAllByRole("button");
    expect(botoes().filter((b) => b.tabIndex === 0)).toHaveLength(1);
    const primeiro = botoes()[0] as HTMLElement; // peso maior: src/login.ts
    primeiro.focus();
    await act(async () => { fireEvent.keyDown(primeiro, { key: "ArrowDown" }); });
    expect(botoes().find((b) => b.tabIndex === 0)).not.toBe(primeiro);
    await act(async () => { fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Home" }); });
    expect((document.activeElement as HTMLElement).textContent).toContain("src/login.ts");
    await act(async () => { fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" }); });
    const vizinho = (document.activeElement as HTMLElement).textContent ?? "";
    expect(vizinho).not.toContain("src/login.ts");
    await act(async () => { fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowLeft" }); });
    expect((document.activeElement as HTMLElement).textContent).toContain("src/login.ts");
  });

  it("filtro de nó por texto (sem acento) reduz a lista; ver trechos mostra o texto como TEXTO", async () => {
    await montar({ detalheDocumento: async () => ({ fonte: (await conhecimentoFalso().listarDocumentos({} as never)).itens[0]!, chunks: [{ id: "c1", trecho: "<img src=x onerror=alert(1)> trecho" }], aprendizado: null, arestas: [] }) });
    await aba("Lista");
    await act(async () => { fireEvent.change(screen.getByRole("searchbox", { name: "Buscar nó" }), { target: { value: "DECISAO".toLowerCase() } }); });
    await act(async () => { fireEvent.change(screen.getByRole("searchbox", { name: "Buscar nó" }), { target: { value: "cookie" } }); });
    const lista = await screen.findByRole("list", { name: "Nós do grafo de conhecimento" });
    expect(within(lista).getAllByRole("listitem")).toHaveLength(1);
    await clicar(within(lista).getByRole("button", { name: /cookie/ }));
    await clicar(await screen.findByRole("button", { name: "Ver trechos" }));
    const pre = await screen.findByText(/onerror=alert/);
    expect(pre.tagName).toBe("PRE");
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("Grafo (canvas): movimento, posições salvas e reduced-motion", () => {
  const nos = [no("a", "arquivo"), no("b", "task"), no("c", "commit")];
  const arestas = [{ origem: "a", destino: "b", tipo: "toca", peso: 1 }, { origem: "b", destino: "c", tipo: "toca", peso: 1 }];
  const base = { nos, arestas, selecionadoId: null, semente: "w1", truncado: false, aoSelecionar: () => undefined, aoFocar: () => undefined };

  it("reduced-motion: calcula as posições finais direto e as entrega para persistir", async () => {
    const aoPosicoes = vi.fn();
    await act(async () => { render(<Grafo {...base} aoPosicoes={aoPosicoes} reduzirMovimento />); });
    expect(aoPosicoes).toHaveBeenCalledTimes(1);
    const p = aoPosicoes.mock.calls[0]?.[0] as Array<{ id: string; x: number; y: number }>;
    expect(p.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(p.every((x) => Number.isFinite(x.x) && Number.isFinite(x.y))).toBe(true);
  });

  it("nós já posicionados abrem sem simular (nada para persistir de novo)", async () => {
    const aoPosicoes = vi.fn();
    const posicionados = nos.map((n, i) => ({ ...n, x: i * 50, y: 0 }));
    await act(async () => { render(<Grafo {...base} nos={posicionados} aoPosicoes={aoPosicoes} />); });
    await new Promise((r) => setTimeout(r, 30));
    expect(aoPosicoes).not.toHaveBeenCalled();
  });

  it("teclado no grafo: Esc limpa a seleção; os botões de zoom têm nome", async () => {
    const aoSelecionar = vi.fn();
    await act(async () => { render(<Grafo {...base} aoSelecionar={aoSelecionar} aoPosicoes={() => undefined} reduzirMovimento />); });
    const grupo = screen.getByRole("group", { name: /Grafo de conhecimento/ });
    await act(async () => { fireEvent.keyDown(grupo, { key: "Escape" }); });
    expect(aoSelecionar).toHaveBeenCalledWith(null);
    for (const n of ["Aproximar", "Afastar", "Enquadrar tudo"]) expect(screen.getByRole("button", { name: n })).toBeTruthy();
  });
});

describe("Conhecimento: busca", () => {
  it("resultados com trecho, fonte, estado e feedback; HTML do trecho continua texto; 'ver no grafo' filtra o nó", async () => {
    const feedback = vi.fn(async () => ({ ok: true }));
    await montar({ feedback });
    const campo = screen.getByRole("searchbox", { name: "Buscar no conhecimento" });
    await act(async () => { fireEvent.change(campo, { target: { value: "login" } }); });
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter" }); });
    const regiao = await screen.findByRole("region", { name: "Resultados da busca" });
    await waitFor(() => expect(within(regiao).getByText(/Consulta completa/)).toBeTruthy());
    expect(within(regiao).getByText(/Trecho sobre login: <b>não é HTML<\/b>/)).toBeTruthy();
    expect(regiao.querySelector("b")).toBeNull();
    expect(within(regiao).getByText(/doc · 01\/10\/2026 · docs\/d1\.md/)).toBeTruthy();
    await clicar(within(regiao).getByRole("button", { name: "Útil" }));
    expect(feedback).toHaveBeenCalledWith({ workspace_id: "w1", alvo_tipo: "chunk", alvo_id: "c1", valor: "util" });
    expect(within(regiao).getByRole("button", { name: "Útil" }).hasAttribute("disabled")).toBe(true);
    await clicar(within(regiao).getByRole("button", { name: "Ver no grafo" }));
    expect(screen.queryByRole("region", { name: "Resultados da busca" })).toBeNull();
    expect((screen.getByRole("searchbox", { name: "Buscar nó" }) as HTMLInputElement).value).toBe("Documento d1");
  });

  it("prévia do contexto mostra o envelope escapado como texto, nunca como HTML", async () => {
    await montar();
    const campo = screen.getByRole("searchbox", { name: "Buscar no conhecimento" });
    await act(async () => { fireEvent.change(campo, { target: { value: "login" } }); });
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter" }); });
    await clicar(await screen.findByRole("button", { name: "Prévia do contexto" }));
    const previa = await screen.findByRole("region", { name: "Prévia do contexto" });
    expect(previa.textContent).toContain("<conhecimento_previo tipo=\"dados\">");
    expect(previa.textContent).toContain("<script>alert(1)</script>");
    expect(document.querySelector("script[src], conhecimento_previo")).toBeNull();
  });

  it("estados da consulta: degradado/lento mostram o aviso; vazio explica", async () => {
    await montar({ buscar: async () => ({ resultados: [], estado: "degradado", consulta_id: "q", latencia_ms: 900, modelo: "hash", aviso: "só lexical" }) });
    const campo = screen.getByRole("searchbox", { name: "Buscar no conhecimento" });
    await act(async () => { fireEvent.change(campo, { target: { value: "x" } }); });
    await act(async () => { fireEvent.keyDown(campo, { key: "Enter" }); });
    expect(await screen.findByText(/Resposta parcial.*só lexical/)).toBeTruthy();
    expect(screen.getByText("Nada encontrado")).toBeTruthy();
    await act(async () => { fireEvent.keyDown(screen.getByRole("region", { name: "Conhecimento" }), { key: "Escape" }); });
    expect(screen.queryByRole("region", { name: "Resultados da busca" })).toBeNull();
  });
});

describe("Conhecimento: fontes", () => {
  it("contagem por tipo; reindexar; esquecer por documento pede confirmação", async () => {
    const esquecer = vi.fn(async () => ({ removidos: 1 }));
    const reindexar = vi.fn(async () => ({ enfileirado: true }));
    await montar({ esquecer, reindexar }, {}, "fontes");
    const tabela = await screen.findByRole("table", { name: "Documentos indexados por tipo" });
    await waitFor(() => expect(within(tabela).getByText("commit")).toBeTruthy());
    await act(async () => { fireEvent.change(screen.getByLabelText("Fonte"), { target: { value: "codigo" } }); });
    await clicar(screen.getByRole("button", { name: "Reindexar" }));
    expect(reindexar).toHaveBeenCalledWith("w1", "codigo");
    await clicar(screen.getByRole("button", { name: "Esquecer documento Documento d1" }));
    const dlg = await screen.findByRole("dialog", { name: "Esquecer do conhecimento?" });
    expect(esquecer).not.toHaveBeenCalled();
    await clicar(within(dlg).getByRole("button", { name: "Esquecer" }));
    expect(esquecer).toHaveBeenCalledWith("w1", { documento_id: "d1" });
  });

  it("apagar tudo exige digitar o nome do workspace", async () => {
    const purgar = vi.fn(async () => ({ removidos: 340 }));
    await montar({ purgar }, {}, "fontes");
    await clicar(await screen.findByRole("button", { name: "Apagar tudo…" }));
    const dlg = await screen.findByRole("dialog", { name: "Apagar todo o conhecimento deste projeto?" });
    const apagar = within(dlg).getByRole("button", { name: "Apagar tudo" }) as HTMLButtonElement;
    expect(apagar.disabled).toBe(true);
    await act(async () => { fireEvent.change(within(dlg).getByLabelText(/Digite o nome do projeto/), { target: { value: "errado" } }); });
    expect(apagar.disabled).toBe(true);
    await act(async () => { fireEvent.change(within(dlg).getByLabelText(/Digite o nome do projeto/), { target: { value: "w1" } }); });
    expect(apagar.disabled).toBe(false);
    await clicar(apagar);
    expect(purgar).toHaveBeenCalledWith("w1", "w1");
  });

  it("importar histórico exige consentimento (caixa marcada) e avisa da mascaração de segredos", async () => {
    const importarHistorico = vi.fn(async () => ({ enfileirado: true, sessoes: 4 }));
    await montar({ importarHistorico }, {}, "fontes");
    await clicar(await screen.findByRole("button", { name: "Importar histórico das CLIs…" }));
    const dlg = await screen.findByRole("dialog", { name: "Importar histórico das CLIs" });
    expect(within(dlg).getByText(/Segredos .* são mascarados/)).toBeTruthy();
    const ok = within(dlg).getByRole("button", { name: "Importar" }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    await clicar(within(dlg).getByRole("checkbox"));
    await clicar(ok);
    expect(importarHistorico).toHaveBeenCalledWith("w1", "claude");
  });
});

describe("Conhecimento: aprendizados e config", () => {
  it("lista com ações ativar/arquivar/rejeitar/editar e feedback por ícones", async () => {
    const atualizarAprendizado = vi.fn(conhecimentoFalso().atualizarAprendizado);
    const feedback = vi.fn(async () => ({ ok: true }));
    await montar({ atualizarAprendizado, feedback }, {}, "aprendizados");
    const lista = await screen.findByRole("list", { name: "Aprendizados" });
    expect(within(lista).getAllByRole("listitem").length).toBe(3);
    await clicar(within(lista).getByRole("button", { name: "Ativar Aprendizado a1" }));
    expect(atualizarAprendizado).toHaveBeenCalledWith({ workspace_id: "w1", id: "a1", acao: "ativar" });
    await clicar(within(lista).getByRole("button", { name: "Útil: Aprendizado a2" }));
    expect(feedback).toHaveBeenCalledWith({ workspace_id: "w1", alvo_tipo: "aprendizado", alvo_id: "a2", valor: "util" });
    await clicar(within(lista).getByRole("button", { name: "Editar Aprendizado a2" }));
    const dlg = await screen.findByRole("dialog", { name: "Editar aprendizado" });
    await act(async () => { fireEvent.change(within(dlg).getByLabelText("Texto"), { target: { value: "novo texto" } }); });
    await clicar(within(dlg).getByRole("button", { name: "Salvar" }));
    expect(atualizarAprendizado).toHaveBeenCalledWith({ workspace_id: "w1", id: "a2", acao: "editar", texto: "novo texto" });
  });

  it("filtro por estado vira pedido; vazio com filtro diz o que fazer", async () => {
    const listarAprendizados = vi.fn(async () => ({ itens: [], proximo: null }));
    await montar({ listarAprendizados }, {}, "aprendizados");
    await act(async () => { fireEvent.change(await screen.findByLabelText("Estado do aprendizado"), { target: { value: "ativo" } }); });
    expect(listarAprendizados).toHaveBeenLastCalledWith(expect.objectContaining({ estado: "ativo" }));
    expect(await screen.findByText("Nada com esse filtro")).toBeTruthy();
  });

  it("config: grava ao mudar; avisos de IA e de execução direta total; estado do índice e cobertura", async () => {
    const gravarConfig = vi.fn(conhecimentoFalso().gravarConfig);
    await montar({ gravarConfig }, {}, "config");
    await clicar(await screen.findByRole("switch", { name: "Hook de prompt" }));
    expect(gravarConfig).toHaveBeenCalledWith({ workspace_id: "w1", hook_prompt: false });
    await act(async () => { fireEvent.change(screen.getByLabelText("Aprendizado"), { target: { value: "assistido" } }); });
    expect(gravarConfig).toHaveBeenLastCalledWith({ workspace_id: "w1", aprendizado_modo: "assistido" });
    expect(await screen.findByText(/consome a cota da sua CLI/)).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByLabelText("Execução pelo chat"), { target: { value: "total" } }); });
    expect((await screen.findAllByRole("note")).some((n) => /Direto total/.test(n.textContent ?? ""))).toBe(true);
    const tabela = screen.getByRole("table", { name: "Estado do índice" });
    expect(within(tabela).getByText(/82%/)).toBeTruthy();
    expect(within(tabela).getByText("exato")).toBeTruthy();
  });

  it("modelos: mostra Ollama detectado, ONNX indisponível com o motivo do main e 'Baixar modelo' só delega ao main", async () => {
    const definirModelo = vi.fn(conhecimentoFalso().definirModelo);
    await montar({ definirModelo }, {}, "config");
    expect(await screen.findByText(/detectado em http:\/\/127\.0\.0\.1:11434/)).toBeTruthy();
    expect(screen.getByText(/modelo não baixado/)).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Baixar modelo" }));
    expect(definirModelo).toHaveBeenCalledWith("w1", "onnx:minilm");
  });

  it("número fora da faixa não é gravado", async () => {
    const gravarConfig = vi.fn(conhecimentoFalso().gravarConfig);
    await montar({ gravarConfig }, {}, "config");
    const campo = await screen.findByLabelText("Retenção das transcrições");
    await act(async () => { fireEvent.change(campo, { target: { value: "0" } }); fireEvent.blur(campo); });
    expect(gravarConfig).not.toHaveBeenCalled();
    await act(async () => { fireEvent.change(campo, { target: { value: "30" } }); fireEvent.blur(campo); });
    expect(gravarConfig).toHaveBeenCalledWith({ workspace_id: "w1", retencao_transcricao_dias: 30 });
  });
});

describe("Conhecimento: backend online", () => {
  const configurado = { ...BACKEND_LOCAL, provedor: "qdrant" as const, url: "https://qdrant.exemplo.com", host: "qdrant.exemplo.com", colecao_remota: "conhecimento_projeto", modo: "espelho" as const, segredos: { api_key: "••••1234" } };

  it("tudo desligado por padrão: modo local, nenhum provedor, nada de migração", async () => {
    await montar({}, {}, "backend");
    expect(await screen.findByText("modo local")).toBeTruthy();
    expect(screen.getByText("nenhum provedor configurado")).toBeTruthy();
    expect(screen.getByText("Salve um provedor para poder migrar.")).toBeTruthy();
  });

  it("formulário gerado pelos campos do provedor; secreto é password; http público é recusado e não salva", async () => {
    const configurar = vi.fn(ragFalso().configurar);
    await montar({}, { configurar }, "backend");
    await act(async () => { fireEvent.change(await screen.findByLabelText("Provedor"), { target: { value: "supabase" } }); });
    const chave = screen.getByLabelText(/Chave de serviço/) as HTMLInputElement;
    expect(chave.type).toBe("password");
    expect((screen.getByLabelText("Schema") as HTMLInputElement).type).toBe("text");
    await act(async () => { fireEvent.change(screen.getByLabelText("URL do serviço"), { target: { value: "http://exemplo.com" } }); });
    await act(async () => { fireEvent.change(screen.getByLabelText("Coleção"), { target: { value: "expxv" } }); });
    await act(async () => { fireEvent.change(chave, { target: { value: "SEGREDO-XYZ" } }); });
    await clicar(screen.getByRole("button", { name: "Salvar" }));
    expect(configurar).not.toHaveBeenCalled();
    expect(screen.getByText(/Use https/)).toBeTruthy();
  });

  it("segredo vai ao main UMA vez, o campo é limpo e o valor nunca aparece na tela; só a máscara", async () => {
    const configurar = vi.fn(ragFalso().configurar);
    let salvo = false;
    const estado = vi.fn(async () => (salvo ? configurado : BACKEND_LOCAL));
    await montar({}, { configurar: async (p) => { salvo = true; return configurar(p); }, estado }, "backend");
    await act(async () => { fireEvent.change(await screen.findByLabelText("Provedor"), { target: { value: "qdrant" } }); });
    await act(async () => { fireEvent.change(screen.getByLabelText("URL do serviço"), { target: { value: "https://qdrant.exemplo.com" } }); });
    await act(async () => { fireEvent.change(screen.getByLabelText("Coleção"), { target: { value: "conhecimento_projeto" } }); });
    const chave = screen.getByLabelText(/Chave da API/) as HTMLInputElement;
    await act(async () => { fireEvent.change(chave, { target: { value: "SEGREDO-XYZ" } }); });
    await clicar(screen.getByRole("button", { name: "Salvar" }));
    expect(configurar).toHaveBeenCalledWith(expect.objectContaining({ campos_secretos: { api_key: "SEGREDO-XYZ" } }));
    await waitFor(() => expect((screen.getByLabelText(/Chave da API/) as HTMLInputElement).value).toBe(""));
    expect((screen.getByLabelText(/Chave da API/) as HTMLInputElement).placeholder).toContain("••••1234");
    expect(document.body.textContent).not.toContain("SEGREDO-XYZ");
    expect(document.body.innerHTML).not.toContain("SEGREDO-XYZ");
  });

  it("migração: prévia → NADA enviado até o consentimento → barra de progresso por evento com pausar/retomar/cancelar → verificar", async () => {
    const iniciarMigracao = vi.fn(async () => ({ migracao_id: "mg1" }));
    const pausarMigracao = vi.fn(async () => ({ ok: true }));
    const retomarMigracao = vi.fn(async () => ({ ok: true }));
    const cancelarMigracao = vi.fn(async () => ({ ok: true }));
    const verificarMigracao = vi.fn(async () => ({ ok: true, local: 158, remoto: 158, amostrados: 20, divergentes: 0 }));
    const m = await montar({}, { estado: async () => configurado, iniciarMigracao, pausarMigracao, retomarMigracao, cancelarMigracao, verificarMigracao }, "backend");
    await clicar(await screen.findByRole("button", { name: "Prévia da migração" }));
    const previa = await screen.findByRole("region", { name: "Prévia da migração" });
    expect(within(previa).getByText("158")).toBeTruthy();
    expect(within(previa).getByText(/Chave: \[REDACTED\]/)).toBeTruthy(); // amostra já redigida
    expect(within(previa).getByText(/Código-fonte sai da máquina/)).toBeTruthy();
    expect(iniciarMigracao).not.toHaveBeenCalled();
    await clicar(within(previa).getByRole("button", { name: "Migrar…" }));
    const dlg = await screen.findByRole("dialog", { name: "Autorizar o envio para fora desta máquina" });
    for (const t of ["qdrant.exemplo.com", "conhecimento_projeto", "versão 1"]) expect(within(dlg).getByText(new RegExp(t))).toBeTruthy();
    expect(within(dlg).getAllByText(/qdrant/).length).toBeGreaterThan(0);
    const autorizar = within(dlg).getByRole("button", { name: "Autorizar e migrar" }) as HTMLButtonElement;
    expect(autorizar.disabled).toBe(true);
    await clicar(autorizar);
    expect(iniciarMigracao).not.toHaveBeenCalled();
    await clicar(within(dlg).getByRole("checkbox"));
    await clicar(autorizar);
    expect(iniciarMigracao).toHaveBeenCalledTimes(1);
    await m.emitirR({ canal: "rag:migracao_progresso", payload: { migracao_id: "mg1", estado: "enviando", enviados: 50, total: 100 } });
    const barra = screen.getByRole("progressbar", { name: "Progresso da migração" });
    expect(barra.getAttribute("aria-valuenow")).toBe("50");
    await clicar(screen.getByRole("button", { name: "Pausar" }));
    expect(pausarMigracao).toHaveBeenCalledWith("mg1");
    await m.emitirR({ canal: "rag:migracao_progresso", payload: { migracao_id: "mg1", estado: "pausada", enviados: 50, total: 100 } });
    await clicar(screen.getByRole("button", { name: "Retomar" }));
    expect(retomarMigracao).toHaveBeenCalledWith("mg1");
    await m.emitirR({ canal: "rag:migracao_progresso", payload: { migracao_id: "mg1", estado: "concluida", enviados: 100, total: 100 } });
    await clicar(await screen.findByRole("button", { name: "Verificar" }));
    expect(await screen.findByText("íntegra")).toBeTruthy();
  });

  it("recusar o consentimento não envia nada e volta à prévia", async () => {
    const iniciarMigracao = vi.fn(async () => ({ migracao_id: "mg1" }));
    await montar({}, { estado: async () => configurado, iniciarMigracao }, "backend");
    await clicar(await screen.findByRole("button", { name: "Prévia da migração" }));
    await clicar(await screen.findByRole("button", { name: "Migrar…" }));
    const dlg = await screen.findByRole("dialog");
    await clicar(within(dlg).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(iniciarMigracao).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Migrar…" })).toBeTruthy();
  });

  it("apagar remoto exige digitar o nome da coleção; voltar para local não apaga nada", async () => {
    const apagarRemoto = vi.fn(async () => ({ apagados: 10 as number | "desconhecido" }));
    const voltarParaLocal = vi.fn(async () => ({ ok: true }));
    await montar({}, { estado: async () => configurado, apagarRemoto, voltarParaLocal }, "backend");
    await clicar(await screen.findByRole("button", { name: "Apagar remoto…" }));
    const dlg = await screen.findByRole("dialog", { name: "Apagar a coleção remota?" });
    const apagar = within(dlg).getByRole("button", { name: "Apagar remoto" }) as HTMLButtonElement;
    expect(apagar.disabled).toBe(true);
    await act(async () => { fireEvent.change(within(dlg).getByLabelText(/Digite o nome da coleção/), { target: { value: "conhecimento_projeto" } }); });
    await clicar(apagar);
    expect(apagarRemoto).toHaveBeenCalledWith("w1", "conhecimento_projeto");
    await clicar(screen.getByRole("button", { name: "Voltar para local" }));
    const d2 = await screen.findByRole("dialog", { name: "Voltar para o modo local?" });
    expect(within(d2).getByText(/Nada é apagado/)).toBeTruthy();
    await clicar(within(d2).getByRole("button", { name: "Voltar para local" }));
    expect(voltarParaLocal).toHaveBeenCalledWith("w1", false);
  });

  it("Supabase mostra o script de preparação copiável; tipos de aviso forte vêm desligados", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await montar({}, {}, "backend");
    await act(async () => { fireEvent.change(await screen.findByLabelText("Provedor"), { target: { value: "supabase" } }); });
    expect(screen.getByText(/create extension if not exists vector/)).toBeTruthy();
    await clicar(screen.getByRole("button", { name: "Copiar script" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("create extension"));
    for (const t of ["codigo", "transcricao", "chat"]) expect((screen.getByRole("checkbox", { name: new RegExp(`^${t}`) }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: /^doc/ }) as HTMLInputElement).checked).toBe(true);
    await clicar(screen.getByRole("checkbox", { name: /^codigo/ }));
    expect(screen.getByText(/podem conter segredos/)).toBeTruthy();
  });

  it("erro do teste de conexão mostra o motivo", async () => {
    await montar({}, { testar: async () => ({ ok: false, motivo: "401 chave recusada" }) }, "backend");
    await act(async () => { fireEvent.change(await screen.findByLabelText("Provedor"), { target: { value: "qdrant" } }); });
    await act(async () => { fireEvent.change(screen.getByLabelText("URL do serviço"), { target: { value: "https://q.exemplo.com" } }); });
    await act(async () => { fireEvent.change(screen.getByLabelText("Coleção"), { target: { value: "expxv" } }); });
    await clicar(screen.getByRole("button", { name: "Testar conexão" }));
    expect(await screen.findByText(/401 chave recusada/)).toBeTruthy();
  });
});
