// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ESPECIES, GRUPOS_ESPECIE, type BichinhoVisao, type EventoBichinhoMudou, type UsoEspecie } from "../../compartilhado/bichinho";
import type { Workspace } from "../../compartilhado/dominio";
import { criarStoreWorkspaces } from "../estado/workspaces";
import { CHAVE_META_OVO, CHAVE_SEM_REPETIR, criarStoreBichinho, NASCIMENTO_MS } from "./estado";
import BichinhoSlot from "./Slot";
import SeletorEspecie, { filtrarEspecies } from "./SeletorEspecie";
import { dicaDoBichinho, faltaParaChocar, rotuloDoBichinho, textoOvo } from "./util";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const OVO = { tarefas: 2, meta_tarefas: 4, tokens: 80_000, piso_tokens: 150_000, progresso: 50 };
const visao = (o: Partial<BichinhoVisao> = {}): BichinhoVisao => ({
  workspace_id: "ws_a", especie: "raposa", especie_automatica: "raposa", manual: false, motivo: ["JavaScript conta 10 pontos para raposa"], apelido: null, estagio: "jovem", maturidade: 30,
  componentes: { tokens: 40, conhecimento: 25 }, tokens_total: 4_500_000, conhecimento_itens: { memoria: 12, chunks: 300, total: 312 }, humor: "ocioso", doente: false, esforco: { nivel: 0, origem: "nenhuma", tokens_por_min: null, bytes_por_s: 0, sessoes_fluindo: 0 }, em: 1, ...o,
});
const ws = (id: string, nome: string): Workspace => ({ id, nome, raiz: `/p/${nome}`, e_git: true, acesso_externo: "nenhum", permissao: "seguro", ultimo_uso_em: null, criado_em: "x", atualizado_em: "x" });

async function ambiente(inicial: BichinhoVisao[], usos: UsoEspecie[] = [], config: Record<string, unknown> = {}) {
  let cb: ((e: EventoBichinhoMudou) => void) | null = null;
  const mapa = new Map(inicial.map((v) => [v.workspace_id, v]));
  const api = {
    listar: vi.fn(async (ids: readonly string[]) => ids.map((i) => mapa.get(i)).filter((v): v is BichinhoVisao => v !== undefined)),
    obter: vi.fn(),
    atencao: vi.fn(async (id: string) => mapa.get(id)!),
    usos: vi.fn(async () => usos),
    trocarEspecie: vi.fn(async (id: string, especie) => { const v = visao({ ...mapa.get(id)!, especie: especie ?? "raposa", manual: especie !== null }); mapa.set(id, v); return v; }),
    renomear: vi.fn(),
    assinar: vi.fn((f: (e: EventoBichinhoMudou) => void) => { cb = f; return () => { cb = null; }; }),
  };
  const gravados: Array<[string, unknown]> = [];
  const cfg = { ler: vi.fn(async (c: string) => config[c]), gravar: vi.fn(async (c: string, v: unknown) => { gravados.push([c, v]); return { ok: true as const }; }) };
  const avisos: string[] = [];
  const timers: Array<() => void> = [];
  const store = criarStoreBichinho({ api: () => api as never, config: () => cfg as never, nomeDe: (id) => (id === "ws_a" ? "meu-app" : null), avisar: (t) => avisos.push(t), agora: () => 1_000, agendar: (fn) => void timers.push(fn) });
  const wsApi = { estado: vi.fn().mockResolvedValue({ atual: ws("ws_a", "meu-app"), recentes: [ws("ws_a", "meu-app")] }), assinar: vi.fn(() => () => undefined), abrir: vi.fn(), definirAtual: vi.fn(), remover: vi.fn(), definirPermissao: vi.fn(), worktrees: vi.fn() };
  const workspaces = criarStoreWorkspaces({ api: () => wsApi as never });
  await act(async () => { await workspaces.iniciar(); });
  return { api, gravados, avisos, store, workspaces, timers, emitir: (e: EventoBichinhoMudou) => act(() => cb?.(e)) };
}

describe("textos do ovo (D-671)", () => {
  it("tooltip: 'Ovo: 2/4 tarefas · 80 mil/150 mil tokens (50%)' e o que falta", () => {
    expect(textoOvo(OVO)).toBe("Ovo: 2/4 tarefas · 80 mil/150 mil tokens (50%)");
    expect(faltaParaChocar(OVO)).toBe("2 tarefas e 70 mil tokens");
    expect(faltaParaChocar({ ...OVO, tarefas: 3 })).toBe("1 tarefa e 70 mil tokens");
    expect(faltaParaChocar({ ...OVO, tarefas: 4, tokens: 150_000 })).toBeNull();
    expect(dicaDoBichinho(visao({ estagio: "ovo", ovo: OVO }))).toMatch(/^Ovo: 2\/4 tarefas/);
    expect(dicaDoBichinho(visao())).toMatch(/^Agora:/);
    expect(rotuloDoBichinho(visao({ estagio: "ovo", ovo: OVO }), "meu-app")).toMatch(/ovo: 2\/4 tarefas/);
  });
});

describe("store: nascimento, reatribuição e preferências", () => {
  it("o ovo que chocou avisa 'Seu bichinho nasceu: <espécie>!' UMA vez e marca o nascimento por 3 s", async () => {
    const a = await ambiente([visao({ estagio: "ovo", ovo: OVO })]);
    await act(async () => { await a.store.garantir(["ws_a"]); });
    await a.emitir({ workspace_id: "ws_a", visao: visao({ estagio: "filhote", ovo: null }), estagio_novo: true, nasceu: true });
    expect(a.avisos).toEqual(["Seu bichinho nasceu: raposa! (meu-app)"]);
    expect(a.store.obter().nasceu.has("ws_a")).toBe(true);
    expect(a.store.obter().subiu.has("ws_a")).toBe(false);
    await act(async () => { a.timers.splice(0).forEach((f) => f()); });
    expect(a.store.obter().nasceu.has("ws_a")).toBe(false);
    expect(NASCIMENTO_MS).toBe(3_000);
    await a.emitir({ workspace_id: "ws_a", visao: visao({ estagio: "filhote", ovo: null }), estagio_novo: false });
    expect(a.avisos).toHaveLength(1);
  });

  it("subida de estágio comum continua como antes (cresceu), sem confundir com nascimento", async () => {
    const a = await ambiente([visao()]);
    await act(async () => { await a.store.garantir(["ws_a"]); });
    await a.emitir({ workspace_id: "ws_a", visao: visao({ estagio: "adulto" }), estagio_novo: true });
    expect(a.avisos).toEqual(["Raposa de meu-app cresceu: agora é adulto."]);
    expect(a.store.obter().subiu.has("ws_a")).toBe(true);
  });

  it("reatribuição por repetição avisa UMA vez (primeira visão que carrega o aviso), seja na carga ou no evento", async () => {
    const a = await ambiente([visao({ especie: "lontra", reatribuido: { de: "raposa" } })]);
    await act(async () => { await a.store.garantir(["ws_a"]); });
    expect(a.avisos).toEqual(["Seu bichinho de meu-app agora é lontra, para não repetir raposa."]);
    await a.emitir({ workspace_id: "ws_a", visao: visao({ especie: "lontra", reatribuido: null }), estagio_novo: false });
    expect(a.avisos).toHaveLength(1);
  });

  it("preferências 'Sem repetir espécie' (padrão ligada) e meta do ovo (2 a 6, padrão 4) leem, validam e gravam", async () => {
    const a = await ambiente([visao()], [], { [CHAVE_SEM_REPETIR]: false, [CHAVE_META_OVO]: 99 });
    await act(async () => { await a.store.garantir(["ws_a"]); });
    expect(a.store.obter()).toMatchObject({ semRepetir: false, metaOvo: 6 });
    await act(async () => { await a.store.definirSemRepetir(true); await a.store.definirMetaOvo(3); });
    expect(a.gravados).toContainEqual([CHAVE_SEM_REPETIR, true]);
    expect(a.gravados).toContainEqual([CHAVE_META_OVO, 3]);
    const padrao = await ambiente([visao()]);
    await act(async () => { await padrao.store.garantir(["ws_a"]); });
    expect(padrao.store.obter()).toMatchObject({ semRepetir: true, metaOvo: 4 });
  });
});

describe("filtrarEspecies (busca e grupo)", () => {
  it("sem filtro devolve as 100; busca ignora acento e caixa; grupo restringe", () => {
    expect(filtrarEspecies("", "todos")).toHaveLength(100);
    expect(filtrarEspecies("ouriço", "todos")).toContain("ourico");
    expect(filtrarEspecies("PORCO", "todos")).toContain("porco-espinho");
    expect(filtrarEspecies("agua", "todos")).toContain("agua-viva");
    expect(filtrarEspecies("rust", "todos")).toContain("caranguejo"); // pelo que representa
    expect(filtrarEspecies("zzzz", "todos")).toEqual([]);
    for (const g of GRUPOS_ESPECIE) expect(filtrarEspecies("", g).length).toBeGreaterThanOrEqual(3);
    expect(GRUPOS_ESPECIE.flatMap((g) => filtrarEspecies("", g)).sort()).toEqual([...ESPECIES].sort());
    expect(filtrarEspecies("a", "aves").every((e) => ["arara", "pinguim", "falcao", "corvo", "pavao", "flamingo", "pato", "cisne", "pelicano", "beija-flor", "avestruz", "gaivota", "tucano", "coruja"].includes(e))).toBe(true);
  });
});

describe("seletor 'Trocar bichinho'", () => {
  const abrir = async (usos: UsoEspecie[] = [], v = visao()) => {
    const a = await ambiente([v], usos);
    await act(async () => { await a.store.garantir([v.workspace_id]); });
    const r = render(<SeletorEspecie visao={v} store={a.store} aoFechar={() => undefined} />);
    await act(async () => { await Promise.resolve(); });
    return { a, ...r };
  };

  it("mostra as 100 espécies com prévia viva; busca por nome e filtro por grupo; vazio avisa", async () => {
    await abrir();
    const grade = screen.getByRole("group", { name: "100 espécies" });
    expect(within(grade).getAllByRole("button")).toHaveLength(100);
    fireEvent.change(screen.getByLabelText("Buscar bichinho pelo nome"), { target: { value: "capi" } });
    expect(within(screen.getByRole("group", { name: "1 espécies" })).getByRole("button", { name: /^Capivara/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Buscar bichinho pelo nome"), { target: { value: "xyzxyz" } });
    expect(screen.getByRole("status").textContent).toMatch(/Nenhum bichinho/);
    fireEvent.change(screen.getByLabelText("Buscar bichinho pelo nome"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Aves" }));
    expect(screen.getByRole("button", { name: "Aves" }).getAttribute("aria-pressed")).toBe("true");
    const aves = within(screen.getByRole("group", { name: /espécies$/ })).getAllByRole("button");
    expect(aves.length).toBeGreaterThanOrEqual(10);
    expect(aves.every((b) => /ave/i.test(b.getAttribute("aria-label") ?? ""))).toBe(true);
  });

  it("prévia viva acompanha o foco/ponteiro e usa o estágio e o humor do bichinho atual", async () => {
    await abrir([], visao({ estagio: "adulto", humor: "trabalhando" }));
    fireEvent.pointerEnter(screen.getByRole("button", { name: /^Girafa,/ }));
    const svg = screen.getByTestId("bichinho-previa").querySelector("svg")!;
    expect(svg.dataset["especie"]).toBe("girafa");
    expect(svg.dataset["estagio"]).toBe("adulto");
    expect(svg.dataset["humor"]).toBe("trabalhando");
  });

  it("marca as espécies já usadas por OUTROS workspaces (não a do próprio) e avisa onde, sem impedir a escolha", async () => {
    const usos: UsoEspecie[] = [{ especie: "polvo", workspace_id: "ws_b", workspace_nome: "api-legada" }, { especie: "raposa", workspace_id: "ws_a", workspace_nome: "meu-app" }];
    const { a } = await abrir(usos);
    const polvo = screen.getByRole("button", { name: /^Polvo,/ });
    expect(polvo.getAttribute("aria-label")).toMatch(/já em uso em api-legada/);
    expect(polvo.hasAttribute("data-uso")).toBe(true);
    expect(screen.getByRole("button", { name: /^Raposa,/ }).hasAttribute("data-uso")).toBe(false);
    fireEvent.click(polvo);
    await act(async () => { await Promise.resolve(); });
    expect(a.api.trocarEspecie).toHaveBeenCalledWith("ws_a", "polvo");
    expect(screen.getAllByRole("status").map((s) => s.textContent).join(" ")).toMatch(/já está em uso em api-legada/);
  });

  it("'Sem repetir espécie' alterna a preferência; 'Automático' só vale depois de uma escolha manual", async () => {
    const { a } = await abrir([], visao({ manual: true, especie: "gato", especie_automatica: "raposa" }));
    const auto = screen.getByRole("button", { name: /^Automático \(Raposa\)/ }) as HTMLButtonElement;
    expect(auto.disabled).toBe(false);
    fireEvent.click(auto);
    await act(async () => { await Promise.resolve(); });
    expect(a.api.trocarEspecie).toHaveBeenCalledWith("ws_a", null);
    fireEvent.click(screen.getByRole("switch", { name: /Sem repetir espécie/ }));
    await act(async () => { await Promise.resolve(); });
    expect(a.gravados).toContainEqual([CHAVE_SEM_REPETIR, false]);
  });

  it("automático desabilitado quando já é automático", async () => {
    await abrir();
    expect((screen.getByRole("button", { name: /^Automático/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("popover: ovo e seletor sob demanda", () => {
  it("ovo: mostra 'Chocando', o texto de progresso, o que falta e a meta configurável; sem a barra de maturidade", async () => {
    const a = await ambiente([visao({ estagio: "ovo", maturidade: 12, ovo: OVO })]);
    render(<BichinhoSlot recolhido={false} store={a.store} workspaces={a.workspaces} />);
    const botao = await screen.findByRole("button", { name: /Abrir detalhes/ });
    expect(botao.getAttribute("title")).toMatch(/^Ovo: 2\/4 tarefas · 80 mil\/150 mil tokens \(50%\)/);
    fireEvent.click(botao);
    const dialogo = screen.getByRole("dialog");
    expect(screen.getByRole("progressbar", { name: "Chocando" }).getAttribute("aria-valuenow")).toBe("50");
    expect(screen.queryByRole("progressbar", { name: "Maturidade" })).toBeNull();
    expect(dialogo.textContent).toMatch(/Ovo: 2\/4 tarefas · 80 mil\/150 mil tokens \(50%\)/);
    expect(dialogo.textContent).toMatch(/Faltam 2 tarefas e 70 mil tokens/);
    fireEvent.change(screen.getByLabelText("Tarefas para chocar"), { target: { value: "3" } });
    await act(async () => { await Promise.resolve(); });
    expect(a.gravados).toContainEqual([CHAVE_META_OVO, 3]);
  });

  it("o seletor só existe depois de 'Trocar bichinho' (e Escape fecha primeiro o seletor, depois o popover)", async () => {
    const a = await ambiente([visao()]);
    render(<BichinhoSlot recolhido={false} store={a.store} workspaces={a.workspaces} />);
    fireEvent.click(await screen.findByRole("button", { name: /Abrir detalhes/ }));
    expect(document.querySelector(".bi-seletor")).toBeNull();
    expect(a.api.usos).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Trocar bichinho/ }));
    expect(await screen.findByRole("dialog", { name: "Trocar bichinho" })).toBeTruthy();
    await act(async () => { await Promise.resolve(); });
    expect(a.api.usos).toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("Buscar bichinho pelo nome"), { key: "Escape" });
    expect(document.querySelector(".bi-seletor")).toBeNull();
    expect(screen.getByRole("dialog", { name: /Bichinho de/ })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
