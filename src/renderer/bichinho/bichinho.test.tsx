// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ESPECIES, ESPECIES_LEGADAS, ESTAGIOS, HUMORES, type BichinhoVisao, type EventoBichinhoMudou, type NivelEsforco } from "../../compartilhado/bichinho";
import type { Workspace } from "../../compartilhado/dominio";
import { criarStoreWorkspaces } from "../estado/workspaces";
import { criarStoreBichinho, CHAVE_MOSTRAR, CHAVE_SILENCIAR, COMEMORACAO_MS } from "./estado";
import { ESPIAR_DURACAO_MS, ESPIAR_MAX_MS, useEspiar } from "./hooks";
import BichinhoMini from "./Mini";
import { BichinhoSprite } from "./Sprite";
import { RECEITAS } from "./sprites/receitas";
import BichinhoSlot from "./Slot";
import { formatarContagem, nivelDaVisao, PERFIL_MOVIMENTO, posicionarPopover, rotuloDoBichinho, textoEsforco } from "./util";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const visao = (o: Partial<BichinhoVisao> = {}): BichinhoVisao => ({
  workspace_id: "ws_a", especie: "raposa", especie_automatica: "raposa", manual: false, motivo: ["JavaScript (100% do peso) conta 10 pontos para raposa"], apelido: null, estagio: "jovem", maturidade: 30,
  componentes: { tokens: 40, conhecimento: 25 }, tokens_total: 4_500_000, conhecimento_itens: { memoria: 12, chunks: 300, total: 312 }, humor: "ocioso", doente: false, esforco: { nivel: 0, origem: "nenhuma", tokens_por_min: null, bytes_por_s: 0, sessoes_fluindo: 0 }, em: 1, ...o,
});
const ws = (id: string, nome: string): Workspace => ({ id, nome, raiz: `/p/${nome}`, e_git: true, acesso_externo: "nenhum", permissao: "seguro", ultimo_uso_em: null, criado_em: "x", atualizado_em: "x" });

async function ambiente(inicial: BichinhoVisao[], opc: { config?: Record<string, unknown> } = {}) {
  let cb: ((e: EventoBichinhoMudou) => void) | null = null;
  const mapa = new Map(inicial.map((v) => [v.workspace_id, v]));
  const api = {
    listar: vi.fn(async (ids: readonly string[]) => ids.map((i) => mapa.get(i)).filter((v): v is BichinhoVisao => v !== undefined)),
    obter: vi.fn(),
    atencao: vi.fn(async (id: string) => mapa.get(id)!),
    usos: vi.fn(async () => []),
    trocarEspecie: vi.fn(async (id: string, especie) => { const v = visao({ ...mapa.get(id)!, especie: especie ?? "raposa", manual: especie !== null }); mapa.set(id, v); return v; }),
    renomear: vi.fn(async (id: string, apelido: string | null) => { const v = visao({ ...mapa.get(id)!, apelido }); mapa.set(id, v); return v; }),
    assinar: vi.fn((f: (e: EventoBichinhoMudou) => void) => { cb = f; return () => { cb = null; }; }),
  };
  const gravados: Array<[string, unknown]> = [];
  const config = { ler: vi.fn(async (c: string) => opc.config?.[c]), gravar: vi.fn(async (c: string, v: unknown) => { gravados.push([c, v]); return { ok: true as const }; }) };
  const avisos: string[] = [];
  let agora = 1_000;
  const timers: Array<() => void> = [];
  const store = criarStoreBichinho({ api: () => api as never, config: () => config as never, nomeDe: (id) => (id === "ws_a" ? "meu-app" : null), avisar: (t) => avisos.push(t), agora: () => agora, agendar: (fn) => void timers.push(fn) });
  const wsApi = { estado: vi.fn().mockResolvedValue({ atual: ws("ws_a", "meu-app"), recentes: [ws("ws_a", "meu-app"), ws("ws_b", "outro")] }), assinar: vi.fn(() => () => undefined), abrir: vi.fn(), definirAtual: vi.fn(), remover: vi.fn(), definirPermissao: vi.fn(), worktrees: vi.fn() };
  const workspaces = criarStoreWorkspaces({ api: () => wsApi as never });
  await act(async () => { await workspaces.iniciar(); });
  return { api, config, gravados, avisos, store, workspaces, emitir: (e: EventoBichinhoMudou) => act(() => cb?.(e)), avancar: (ms: number) => { agora += ms; timers.splice(0).forEach((f) => f()); } };
}

describe("Sprite: arte e acessibilidade", () => {
  it("renderiza as 100 espécies × 6 estágios (e uma amostra por arquétipo × 8 humores) sem quebrar, com role=img e rótulo", () => {
    let total = 0;
    const confere = (especie: (typeof ESPECIES)[number], estagio: (typeof ESTAGIOS)[number], humor: (typeof HUMORES)[number]): void => {
      const { container, unmount } = render(<BichinhoSprite especie={especie} estagio={estagio} humor={humor} doente maturidade={5} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("role")).toBe("img");
      expect(svg.getAttribute("aria-label")).toMatch(new RegExp(estagio));
      expect(svg.dataset["especie"]).toBe(especie);
      total++;
      unmount();
    };
    for (const especie of ESPECIES) for (const estagio of ESTAGIOS) confere(especie, estagio, "ocioso");
    const primeiraPorArquetipo = new Map<string, (typeof ESPECIES)[number]>();
    for (const [id, r] of Object.entries(RECEITAS)) if (!primeiraPorArquetipo.has(r.a)) primeiraPorArquetipo.set(r.a, id as (typeof ESPECIES)[number]);
    const amostra = [...ESPECIES_LEGADAS, ...primeiraPorArquetipo.values()];
    for (const especie of amostra) for (const humor of HUMORES) confere(especie, "adulto", humor);
    expect(total).toBe(100 * 6 + amostra.length * 8);
  });

  it("estágios acrescentam acessórios sem remover os anteriores: lenço, óculos, cicatriz e medalha, coroa e aura", () => {
    const vai = (estagio: (typeof ESTAGIOS)[number]) => render(<BichinhoSprite especie="gato" estagio={estagio} />).container;
    const tem = (c: HTMLElement, sel: string) => c.querySelector(sel) !== null;
    expect(tem(vai("filhote"), ".bi-lenco")).toBe(false);
    expect(tem(vai("jovem"), ".bi-lenco")).toBe(true);
    expect(tem(vai("jovem"), ".bi-oculos")).toBe(false);
    expect(tem(vai("adulto"), ".bi-oculos")).toBe(true);
    expect(tem(vai("adulto"), ".bi-cicatriz")).toBe(false);
    const vet = vai("veterano");
    expect(tem(vet, ".bi-cicatriz") && tem(vet, ".bi-medalha") && tem(vet, ".bi-oculos") && tem(vet, ".bi-lenco")).toBe(true);
    expect(tem(vet, ".bi-coroa")).toBe(false);
    const lenda = vai("lendario");
    expect(tem(lenda, ".bi-coroa") && tem(lenda, ".bi-aura") && tem(lenda, ".bi-cicatriz")).toBe(true);
    expect(tem(vai("ovo"), ".bi-ovo")).toBe(true);
  });

  it("estados legíveis sem texto: cada humor mostra o seu símbolo", () => {
    const sel: Record<string, string> = { aguardando: ".bi-balao", dormindo: ".bi-zzz", curioso: ".bi-interrogacao", pensando: ".bi-pensando", trabalhando: ".bi-notebook", comemorando: ".bi-confete", preocupado: ".bi-gota" };
    for (const [humor, s] of Object.entries(sel)) expect(render(<BichinhoSprite especie="coruja" estagio="adulto" humor={humor as never} />).container.querySelector(s), humor).not.toBeNull();
    expect(render(<BichinhoSprite especie="coruja" estagio="adulto" doente />).container.querySelector(".bi-termometro")).not.toBeNull();
    expect(render(<BichinhoSprite especie="coruja" estagio="adulto" subiu />).container.querySelector(".bi-confete")).not.toBeNull();
  });

  it("modo cabeça (menu recolhido) recorta o desenho; o ovo continua inteiro", () => {
    expect(render(<BichinhoSprite especie="urso" estagio="adulto" cabeca />).container.querySelector("svg")!.getAttribute("viewBox")).not.toBe("0 0 64 64");
    expect(render(<BichinhoSprite especie="urso" estagio="ovo" cabeca />).container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 64 64");
  });

  it("rótulo: 'Bichinho do projeto X: raposa, jovem, trabalhando' (+ apelido e cota alta); informação nunca só por cor", () => {
    expect(rotuloDoBichinho(visao({ humor: "trabalhando" }), "meu-app")).toBe("Bichinho do projeto meu-app: raposa, jovem, trabalhando");
    expect(rotuloDoBichinho(visao({ apelido: "Fox", humor: "aguardando", doente: true, estagio: "lendario" }), "x")).toBe("Bichinho do projeto x, chamado Fox: raposa, lendário, esperando você, com a cota de consumo alta");
  });
});

describe("CSS: custo ocioso zero, reduced motion e tokens", () => {
  const css = readFileSync(join(__dirname, "bichinho.css"), "utf8");
  const animacoes = [...css.matchAll(/([^{}]+)\{[^{}]*animation:[^{}]*\}/g)];
  it("toda animação está dentro de prefers-reduced-motion: no-preference e fora do modo quieto", () => {
    const antes = css.slice(0, css.indexOf("@media (prefers-reduced-motion: no-preference)"));
    expect(antes).not.toMatch(/animation\s*:/);
    const bloco = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference)"), css.indexOf("@keyframes bi-bater"));
    for (const m of bloco.matchAll(/^\s+(\.bi-wrap[^{]+)\{[^}]*animation:/gm)) expect(m[1]).toMatch(/:not\(\[data-quieto\]\)|data-pausado/);
    expect(animacoes.length).toBeGreaterThan(15);
  });
  it("só o trabalhar, o pensar e o esforço (nível ≥ 1, que expira sozinho) repetem para sempre; dormir, esperar e preocupar têm contagem finita", () => {
    const infinitas = [...css.matchAll(/(\.bi-wrap[^{]+)\{[^}]*animation:[^}]*infinite/g)].map((m) => m[1]!);
    for (const s of infinitas) expect(s, s).toMatch(/trabalhando|pensando|data-nivel|bi-faisca|bi-folego/);
    // o balanço do ovo também só existe com esforço (fora de data-nivel="0")
    expect(infinitas.filter((s) => /bi-ovo/.test(s)).every((s) => /:not\(\[data-nivel="0"\]\)/.test(s))).toBe(true);
    // nenhuma animação infinita vale para o nível 0 (parado) nem para dormindo
    for (const s of infinitas) { expect(s.replace(/:not\(\[data-nivel="0"\]\)/g, ""), s).not.toMatch(/data-nivel="0"/); expect(s, s).not.toMatch(/data-humor="dormindo"\]\s/); }
    for (const h of ["dormindo", "aguardando", "preocupado", "comemorando", "curioso"]) {
      const regras = [...css.matchAll(new RegExp(`(\\.bi-wrap[^{]*(?<!:not\\(\\[)data-humor="${h}"[^{]*)\\{([^}]*animation:[^}]*)\\}`, "g"))];
      expect(regras.length, h).toBeGreaterThan(0);
      for (const r of regras) expect(r[2], h).not.toMatch(/infinite/);
    }
  });
  it("janela oculta pausa as animações; só transform e opacity animam", () => {
    expect(css).toMatch(/data-pausado[^{]*\{[^}]*animation-play-state:\s*paused/);
    const frames = css.slice(css.indexOf("@keyframes bi-bater"), css.indexOf("/* ---- encaixes"));
    expect(frames).not.toMatch(/\b(width|height|top|left|margin|filter|box-shadow)\s*:/);
  });
  it("tokens do bichinho existem para todas as espécies e nenhum arquivo do bichinho usa cor literal", () => {
    const tokens = readFileSync(join(__dirname, "..", "tokens.css"), "utf8");
    for (const e of ESPECIES_LEGADAS) { expect(tokens).toContain(`--bichinho-${e}:`); expect(css).toContain(`--bichinho-${e})`); }
    // as 86 novas usam as paletas do sistema de partes (D-674), definidas em bichinho.css
    for (const p of new Set(Object.values(RECEITAS).map((r) => r.p))) expect(css).toContain(`.bi[data-pal="${p}"]`);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/);
    for (const f of ["arte.tsx", "Sprite.tsx", "Popover.tsx", "Slot.tsx", "sprites/partes.tsx", "sprites/montar.tsx", "sprites/receitas.ts"]) expect(readFileSync(join(__dirname, f), "utf8")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/);
  });
});

describe("store do Bichinho", () => {
  it("pedidos da mesma rodada viram UMA chamada em lote; ids já conhecidos não são pedidos de novo", async () => {
    const a = await ambiente([visao(), visao({ workspace_id: "ws_b", especie: "gato" })]);
    await Promise.all([a.store.garantir(["ws_a"]), a.store.garantir(["ws_b"]), a.store.garantir(["ws_a"])]);
    expect(a.api.listar).toHaveBeenCalledTimes(1);
    expect(a.api.listar.mock.calls[0]![0].slice().sort()).toEqual(["ws_a", "ws_b"]);
    await a.store.garantir(["ws_a", "ws_b"]);
    expect(a.api.listar).toHaveBeenCalledTimes(1);
    expect(a.api.assinar).toHaveBeenCalledTimes(1);
  });

  it("preferências: padrão ligado e sem silêncio; lê e grava pelas chaves do contrato", async () => {
    const a = await ambiente([visao()]);
    await a.store.garantir(["ws_a"]);
    expect(a.store.obter()).toMatchObject({ mostrar: true, silenciar: false });
    const b = await ambiente([visao()], { config: { [CHAVE_MOSTRAR]: false, [CHAVE_SILENCIAR]: true } });
    await b.store.garantir(["ws_a"]);
    expect(b.store.obter()).toMatchObject({ mostrar: false, silenciar: true });
    await a.store.definirSilenciar(true);
    await a.store.definirMostrar(false);
    expect(a.gravados).toEqual([[CHAVE_SILENCIAR, true], [CHAVE_MOSTRAR, false]]);
  });

  it("evento do main atualiza só aquele workspace; estagio_novo avisa uma vez e a marca expira", async () => {
    const a = await ambiente([visao(), visao({ workspace_id: "ws_b", especie: "gato" })]);
    await a.store.garantir(["ws_a", "ws_b"]);
    await a.emitir({ workspace_id: "ws_a", visao: visao({ humor: "trabalhando" }), estagio_novo: false });
    expect(a.store.obter().visoes.get("ws_a")!.humor).toBe("trabalhando");
    expect(a.store.obter().visoes.get("ws_b")!.humor).toBe("ocioso");
    expect(a.avisos).toHaveLength(0);
    await a.emitir({ workspace_id: "ws_a", visao: visao({ estagio: "adulto", maturidade: 46 }), estagio_novo: true });
    expect(a.avisos).toEqual(["Raposa de meu-app cresceu: agora é adulto."]);
    expect(a.store.obter().subiu.has("ws_a")).toBe(true);
    a.avancar(COMEMORACAO_MS + 1);
    expect(a.store.obter().subiu.has("ws_a")).toBe(false);
  });

  it("trocar espécie e renomear passam pela API e devolvem o erro nominal (sem lançar)", async () => {
    const a = await ambiente([visao()]);
    await a.store.garantir(["ws_a"]);
    expect(await a.store.trocarEspecie("ws_a", "polvo")).toBeNull();
    expect(a.store.obter().visoes.get("ws_a")).toMatchObject({ especie: "polvo", manual: true });
    expect(await a.store.trocarEspecie("ws_a", "dragao" as never)).toBe("Espécie desconhecida.");
    a.api.renomear.mockRejectedValueOnce(new Error("O apelido precisa ter de 1 a 24 caracteres."));
    expect(await a.store.renomear("ws_a", "x")).toMatch(/apelido/);
  });

  it("sem ponte (navegador/teste): indisponível, sem lançar", async () => {
    const store = criarStoreBichinho({ api: () => undefined, config: () => undefined });
    await store.garantir(["ws_a"]);
    expect(store.obter().disponivel).toBe(false);
  });
});

describe("Slot do menu", () => {
  it("mostra o bichinho do workspace ATUAL, com rótulo descritivo; recolhido mostra só a cabeça", async () => {
    const a = await ambiente([visao({ humor: "trabalhando" })]);
    const { rerender } = render(<BichinhoSlot recolhido store={a.store} workspaces={a.workspaces} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const botao = await screen.findByRole("button", { name: /Bichinho do projeto meu-app: raposa, jovem, trabalhando/ });
    expect(botao.querySelector("svg")!.dataset["cabeca"]).toBe("true");
    expect(a.api.atencao).toHaveBeenCalledWith("ws_a");
    rerender(<BichinhoSlot recolhido={false} store={a.store} workspaces={a.workspaces} />);
    expect(botao.querySelector("svg")!.dataset["cabeca"]).toBeUndefined();
    expect(botao.textContent).toMatch(/Raposa · jovem/);
  });

  it("clique abre o popover (nome, espécie, estágio, maturidade com os dois componentes, tokens e conhecimento); Escape fecha e devolve o foco", async () => {
    const a = await ambiente([visao({ apelido: "Fox" })]);
    render(<BichinhoSlot recolhido={false} store={a.store} workspaces={a.workspaces} />);
    const botao = await screen.findByRole("button", { name: /Abrir detalhes/ });
    fireEvent.click(botao);
    const dialogo = screen.getByRole("dialog", { name: /Bichinho de meu-app/ });
    expect(dialogo.textContent).toMatch(/Fox/);
    expect(dialogo.textContent).toMatch(/Raposa · jovem/);
    expect(screen.getByRole("progressbar", { name: "Maturidade" }).getAttribute("aria-valuenow")).toBe("30");
    expect(screen.getByRole("progressbar", { name: "Tokens" }).getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByRole("progressbar", { name: "Conhecimento" }).getAttribute("aria-valuenow")).toBe("25");
    expect(dialogo.textContent).toMatch(/4,5 mi tokens acumulados/);
    expect(dialogo.textContent).toMatch(/312 itens/);
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(botao);
  });

  it("Trocar bichinho, Renomear e Silenciar animações agem pela API/prefs; Automático volta ao automático", async () => {
    const a = await ambiente([visao()]);
    render(<BichinhoSlot recolhido={false} store={a.store} workspaces={a.workspaces} />);
    fireEvent.click(await screen.findByRole("button", { name: /Abrir detalhes/ }));
    fireEvent.click(screen.getByRole("button", { name: /Trocar bichinho/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Polvo,/ }));
    await act(async () => { await Promise.resolve(); });
    expect(a.api.trocarEspecie).toHaveBeenCalledWith("ws_a", "polvo");
    fireEvent.click(await screen.findByRole("button", { name: /^Automático/ }));
    await act(async () => { await Promise.resolve(); });
    expect(a.api.trocarEspecie).toHaveBeenLastCalledWith("ws_a", null);
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    fireEvent.change(screen.getByPlaceholderText("Raposa"), { target: { value: "Ferris" } });
    fireEvent.click(screen.getByRole("button", { name: "Renomear" }));
    await act(async () => { await Promise.resolve(); });
    expect(a.api.renomear).toHaveBeenCalledWith("ws_a", "Ferris");
    fireEvent.click(screen.getByRole("switch", { name: "Silenciar animações" }));
    await act(async () => { await Promise.resolve(); });
    expect(a.gravados).toContainEqual([CHAVE_SILENCIAR, true]);
    expect(document.querySelector(".bi-wrap[data-quieto]")).not.toBeNull();
  });

  it("'Mostrar bichinhos' desligado (ou Ocultar bichinhos) remove o slot", async () => {
    const a = await ambiente([visao()]);
    render(<BichinhoSlot recolhido={false} store={a.store} workspaces={a.workspaces} />);
    fireEvent.click(await screen.findByRole("button", { name: /Abrir detalhes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ocultar bichinhos" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("button", { name: /Abrir detalhes/ })).toBeNull();
    expect(a.gravados).toContainEqual([CHAVE_MOSTRAR, false]);
  });

  it("não rouba foco ao reagir (mudança de humor não mexe no foco)", async () => {
    const a = await ambiente([visao()]);
    render(<><input aria-label="campo" /><BichinhoSlot recolhido store={a.store} workspaces={a.workspaces} /></>);
    await screen.findByRole("button", { name: /Abrir detalhes/ });
    const campo = screen.getByLabelText("campo");
    campo.focus();
    await a.emitir({ workspace_id: "ws_a", visao: visao({ humor: "aguardando" }), estagio_novo: false });
    expect(document.activeElement).toBe(campo);
  });
});

describe("Mini do card", () => {
  it("reage ao estado do SEU workspace mesmo sem ser o ativo", async () => {
    const a = await ambiente([visao(), visao({ workspace_id: "ws_b", especie: "gato", humor: "dormindo" })]);
    render(<BichinhoMini workspaceId="ws_b" store={a.store} workspaces={a.workspaces} />);
    const img = await screen.findByRole("img", { name: /Bichinho do projeto outro: gato, jovem, dormindo/ });
    expect(img.dataset["humor"]).toBe("dormindo");
    await a.emitir({ workspace_id: "ws_b", visao: visao({ workspace_id: "ws_b", especie: "gato", humor: "aguardando" }), estagio_novo: false });
    expect(screen.getByRole("img", { name: /gato, jovem, esperando você/ })).toBeTruthy();
  });

  it("não renderiza nada com 'Mostrar bichinhos' desligado ou sem visão", async () => {
    const a = await ambiente([visao()], { config: { [CHAVE_MOSTRAR]: false } });
    const { container } = render(<BichinhoMini workspaceId="ws_a" store={a.store} workspaces={a.workspaces} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector(".bi-mini")).toBeNull();
  });
});

describe("util e ganchos", () => {
  it("formatarContagem em pt-BR", () => {
    expect([0, 950, 12_300, 4_500_000, 1_200_000_000, -3, Number.NaN].map(formatarContagem)).toEqual(["0", "950", "12,3 mil", "4,5 mi", "1,2 bi", "0", "0"]);
  });
  it("popover abre à direita se couber, à esquerda se não, e nunca sai da janela", () => {
    const j = { largura: 1280, altura: 800 };
    expect(posicionarPopover({ left: 0, right: 56, top: 700, bottom: 750 }, j)).toEqual({ left: 64, bottom: 50 });
    expect(posicionarPopover({ left: 1100, right: 1240, top: 300, bottom: 340 }, j).left).toBe(1100 - 8 - 268);
    expect(posicionarPopover({ left: 0, right: 56, top: 0, bottom: 20 }, j).bottom).toBe(800 - 360 - 8);
  });
  it("useEspiar: o passeio raro dura 1,8 s, só acontece parado e para ao ficar ativo=false", () => {
    vi.useFakeTimers();
    function Cena({ ativo }: { ativo: boolean }) { return <span data-testid="x" data-espiando={String(useEspiar(ativo, () => 0))} />; }
    const { rerender } = render(<Cena ativo />);
    const leitura = () => screen.getByTestId("x").dataset["espiando"];
    expect(leitura()).toBe("false");
    act(() => { vi.advanceTimersByTime(2 * 60_000 + 10); });
    expect(leitura()).toBe("true");
    act(() => { vi.advanceTimersByTime(ESPIAR_DURACAO_MS + 10); });
    expect(leitura()).toBe("false");
    rerender(<Cena ativo={false} />);
    act(() => { vi.advanceTimersByTime(ESPIAR_MAX_MS * 2); });
    expect(leitura()).toBe("false");
    expect(vi.getTimerCount()).toBe(0);
  });
  beforeEach(() => undefined);
});

describe("esforço proporcional (D-500…): níveis 0–4 no sprite, no mini e no tooltip", () => {
  const NIVEIS: NivelEsforco[] = [0, 1, 2, 3, 4];
  const esf = (nivel: NivelEsforco, o: Partial<BichinhoVisao["esforco"]> = {}): BichinhoVisao["esforco"] => ({ nivel, origem: nivel === 0 ? "nenhuma" : "estimado", tokens_por_min: null, bytes_por_s: 0, sessoes_fluindo: nivel > 0 ? 1 : 0, ...o });
  const svgDe = (nivel: NivelEsforco, humor: "ocioso" | "trabalhando" = "trabalhando", especie: "raposa" | "caranguejo" = "raposa") => render(<BichinhoSprite especie={especie} estagio="adulto" humor={humor} nivel={nivel} />).container.querySelector("svg")!;

  it("data-nivel e as variáveis de velocidade/amplitude escalam com o nível (monotônico: mais rápido e mais amplo)", () => {
    const ciclos: number[] = [];
    const amps: number[] = [];
    for (const n of [2, 3, 4] as NivelEsforco[]) {
      const svg = svgDe(n);
      expect(svg.dataset["nivel"]).toBe(String(n));
      expect(svg.style.getPropertyValue("--bi-ciclo")).toBe(`${PERFIL_MOVIMENTO[n].ciclo}s`);
      ciclos.push(parseFloat(svg.style.getPropertyValue("--bi-ciclo")));
      amps.push(parseFloat(svg.style.getPropertyValue("--bi-amp")));
    }
    expect(ciclos).toEqual([...ciclos].sort((a, b) => b - a));
    expect(amps).toEqual([...amps].sort((a, b) => a - b));
    expect(new Set(ciclos).size).toBe(3);
    expect(amps[2]!).toBeGreaterThan(amps[0]! * 3);
  });

  it("nunca dormindo com esforço: trabalhando vale no mínimo 2; dormindo é 0; atento é 1 parado", () => {
    expect(svgDe(0).dataset["nivel"]).toBe("2");
    expect(render(<BichinhoSprite especie="gato" estagio="jovem" humor="dormindo" nivel={4} />).container.querySelector("svg")!.dataset["nivel"]).toBe("0");
    expect(svgDe(1, "ocioso").dataset["nivel"]).toBe("1");
    expect(svgDe(0, "ocioso").dataset["nivel"]).toBe("0");
  });

  it("partículas e expressão crescem por nível: gotas 2→3→4, faíscas 0→3→5, chama e boca ofegante só nos altos", () => {
    const conta = (svg: SVGElement, sel: string): number => svg.querySelectorAll(sel).length;
    expect(NIVEIS.slice(2).map((n) => conta(svgDe(n), ".bi-suor circle"))).toEqual([2, 3, 4]);
    expect(NIVEIS.slice(2).map((n) => conta(svgDe(n), ".bi-faisca"))).toEqual([0, 3, 5]);
    expect(NIVEIS.slice(2).map((n) => conta(svgDe(n), ".bi-chama"))).toEqual([0, 1, 1]);
    expect(NIVEIS.slice(2).map((n) => conta(svgDe(n), ".bi-folego circle"))).toEqual([0, 2, 3]);
    expect(NIVEIS.slice(2).map((n) => conta(svgDe(n, "trabalhando", "caranguejo"), ".bi-ofegar"))).toEqual([0, 1, 1]);
    // concentrado (olhos semicerrados) → arregalado: o raio vertical do olho cresce
    const ry = (n: NivelEsforco): number => parseFloat(svgDe(n).querySelector(".bi-olho ellipse")!.getAttribute("ry")!);
    expect(ry(2)).toBeLessThan(ry(3));
    expect(ry(3)).toBeLessThan(ry(4));
  });

  it("indicadores estáticos mantêm a informação: barras acesas = nível, anel a partir do 2, nada no 0", () => {
    for (const n of NIVEIS) {
      const svg = svgDe(n, n === 0 ? "ocioso" : "trabalhando");
      const nivel = Number(svg.dataset["nivel"]);
      expect(svg.querySelectorAll(".bi-acesa")).toHaveLength(nivel);
      expect(svg.querySelectorAll(".bi-medidor rect")).toHaveLength(nivel === 0 ? 0 : 4);
      expect(svg.querySelector(".bi-anel") !== null).toBe(nivel >= 2);
    }
  });

  it("reduzir movimento não zera a informação: o CSS só anima dentro de no-preference e os indicadores existem fora dele", () => {
    const css = readFileSync(join(__dirname, "bichinho.css"), "utf8");
    const fora = css.slice(0, css.indexOf("@media (prefers-reduced-motion: no-preference)"));
    for (const classe of [".bi-anel", ".bi-acesa", ".bi-chama", ".bi-faisca"]) expect(fora).toContain(classe);
    expect(fora).not.toMatch(/animation\s*:/);
    // silenciar animações (data-quieto) mantém o sprite com o mesmo nível e os mesmos indicadores
    const { container } = render(<span className="bi-wrap" data-quieto><BichinhoSprite especie="raposa" estagio="adulto" humor="trabalhando" nivel={4} /></span>);
    expect(container.querySelectorAll(".bi-acesa")).toHaveLength(4);
    expect(container.querySelector(".bi-anel")).not.toBeNull();
  });

  it("o CSS escala por variável (sem número fixo de ciclo nas animações do trabalho) e cada nível alto tem a sua animação", () => {
    const css = readFileSync(join(__dirname, "bichinho.css"), "utf8");
    expect(css).toMatch(/\.bi-corpo \{ animation: bi-bater var\(--bi-ciclo/);
    expect(css).toMatch(/data-nivel="4"\] \.bi-corpo \{ animation: bi-frenesi/);
    expect(css).toMatch(/@keyframes bi-bater .*--bi-amp/);
    expect(css).toMatch(/\.bi-faisca \{ animation: bi-faisca/);
  });

  it("tooltip e popover: 'agora: acelerado · ~4,2 mil tokens/min' (medido) ou 'saída intensa' (estimado); sem dado sensível", async () => {
    expect(textoEsforco(visao({ humor: "trabalhando", esforco: esf(3, { origem: "medido", tokens_por_min: 4_200 }) }))).toBe("acelerado · ~4,2 mil tokens/min");
    expect(textoEsforco(visao({ humor: "trabalhando", esforco: esf(3) }))).toBe("acelerado · saída intensa");
    expect(textoEsforco(visao({ humor: "trabalhando", esforco: esf(4) }))).toBe("frenético · saída intensa");
    expect(textoEsforco(visao({ humor: "dormindo", esforco: esf(4) }))).toBe("parado");
    const a = await ambiente([visao({ humor: "trabalhando", esforco: esf(3, { origem: "medido", tokens_por_min: 4_200 }) })]);
    render(<BichinhoMini workspaceId="ws_a" store={a.store} workspaces={a.workspaces} />);
    const mini = await screen.findByTitle("Agora: acelerado · ~4,2 mil tokens/min");
    expect(mini.className).toBe("bi-mini");
  });

  it("popover do slot mostra o esforço atual e o rótulo de acessibilidade cita o nível alto", async () => {
    const a = await ambiente([visao({ humor: "trabalhando", esforco: esf(4) })]);
    render(<BichinhoSlot recolhido={false} store={a.store} workspaces={a.workspaces} />);
    const botao = await screen.findByRole("button", { name: /esforço frenético/ });
    fireEvent.click(botao);
    expect(await screen.findByText(/Agora: frenético · saída intensa/)).toBeTruthy();
  });

  it("mini de workspace NÃO ativo reage ao seu próprio esforço (evento só daquele workspace)", async () => {
    const a = await ambiente([visao(), visao({ workspace_id: "ws_b", especie: "gato" })]);
    render(<BichinhoMini workspaceId="ws_b" store={a.store} workspaces={a.workspaces} />);
    const antes = await screen.findByRole("img", { name: /gato/ });
    expect(antes.dataset["nivel"]).toBe("0");
    await a.emitir({ workspace_id: "ws_b", visao: visao({ workspace_id: "ws_b", especie: "gato", humor: "trabalhando", esforco: esf(4) }), estagio_novo: false });
    expect(screen.getByRole("img", { name: /gato/ }).dataset["nivel"]).toBe("4");
  });

  it("nivelDaVisao tolera visão antiga sem o campo", () => {
    expect(nivelDaVisao({ humor: "trabalhando" })).toBe(2);
    expect(nivelDaVisao({ humor: "ocioso" })).toBe(0);
  });

  it("custo ocioso: parado (nível 0) não gera nenhuma regra de animação ativa nem timer no componente", () => {
    vi.useFakeTimers();
    const antes = vi.getTimerCount();
    const { container } = render(<span className="bi-wrap"><BichinhoSprite especie="raposa" estagio="adulto" humor="ocioso" nivel={0} /></span>);
    expect(container.querySelector("svg")!.dataset["nivel"]).toBe("0");
    expect(container.querySelector(".bi-medidor")).toBeNull();
    expect(container.querySelector(".bi-faisca, .bi-chama, .bi-anel")).toBeNull();
    expect(vi.getTimerCount()).toBe(antes);
  });
});
