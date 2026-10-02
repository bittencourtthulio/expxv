// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../../compartilhado/dominio";
import type { AgenteResumo, ItemWorkspaceResumo, ResumoWorkspaces } from "../../compartilhado/workspaces-resumo";
import { criarStorePainelWorkspaces } from "../estado/painel-workspaces";
import { criarStoreWorkspaces } from "../estado/workspaces";
import type { StoreTerminais } from "../estado/terminais";
import { readFileSync } from "node:fs";
import { storeAdicionarWorkspace } from "../estado/adicionar-workspace";
import { PainelWorkspaces } from "./PainelWorkspaces";

afterEach(cleanup);

const agente = (id: string, extra: Partial<AgenteResumo> = {}): AgenteResumo => ({
  sessao_id: id, pane_id: null, mission_id: null, pai_sessao_id: null, profundidade: 0, ferramenta_id: "claude", titulo: `Claude ${id}`, papel: null, piloto: false,
  estado: "ocioso", sessao_estado: "executando", atividade: null, desde: Date.now() - 120_000, atividade_em: null, linha: null, subagentes: null, ...extra,
});
const contar = (agentes: AgenteResumo[]) => ({ agentes: agentes.length, trabalhando: agentes.filter((a) => a.estado === "trabalhando").length, aguardando: agentes.filter((a) => a.estado === "aguardando").length, erro: agentes.filter((a) => a.estado === "erro").length, subagentes: 0, terminais: 0 });
const item = (id: string, nome: string, agentes: AgenteResumo[] = [], extra: Partial<ItemWorkspaceResumo> = {}): ItemWorkspaceResumo => ({
  id, nome, pasta_mascarada: `~/proj/${nome}`, branch: "main", sujo: false, atual: false, missao: null, missoes_ativas: 0, agentes, execucao: null, contagens: contar(agentes), ...extra,
});
const ws = (id: string, nome: string): Workspace => ({ id, nome, raiz: `/Users/x/proj/${nome}`, e_git: true, acesso_externo: "nenhum", permissao: "seguro", ultimo_uso_em: null, criado_em: "x", atualizado_em: "x" });

const RESUMO = (itens: ItemWorkspaceResumo[]): ResumoWorkspaces => ({ versao: 1, gerado_em: 1, itens });

function montar(itens: ItemWorkspaceResumo[], opcoes: { atual?: string | null; sessoes?: Array<{ sessao_id: string; estado: string; atividade?: string }>; sobreposto?: boolean; armazem?: boolean } = {}) {
  const guardado = new Map<string, string>();
  const api = {
    resumo: vi.fn(async () => RESUMO(itens)),
    ativarResumo: vi.fn(async (a: boolean) => a),
    assinarResumo: vi.fn((_cb: (r: ResumoWorkspaces) => void) => () => undefined),
    encerrarAgente: vi.fn(async () => ({ ok: true, motivo: "encerrado" as const })),
    revelar: vi.fn(async () => true),
    copiarCaminho: vi.fn(async () => true),
  };
  const store = criarStorePainelWorkspaces({ api: () => api as never, armazem: { getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => void guardado.set(k, v) } });
  const wsApi = {
    estado: vi.fn().mockResolvedValue({ atual: opcoes.atual === null ? null : ws(opcoes.atual ?? itens[0]?.id ?? "x", "n"), recentes: itens.map((i) => ws(i.id, i.nome)) }),
    assinar: vi.fn(() => () => undefined), abrir: vi.fn().mockResolvedValue(null), definirAtual: vi.fn().mockResolvedValue(null), remover: vi.fn().mockResolvedValue(true), definirPermissao: vi.fn(), worktrees: vi.fn(),
  };
  const workspaces = criarStoreWorkspaces({ api: () => wsApi });
  let estadoTerm = { sessoes: (opcoes.sessoes ?? []) as never[] };
  const ouvTerm = new Set<() => void>();
  const terminais = { obter: () => estadoTerm, assinar: (o: () => void) => { ouvTerm.add(o); return () => void ouvTerm.delete(o); } } as unknown as StoreTerminais;
  const irParaSessao = vi.fn();
  const irParaTela = vi.fn();
  const r = render(<div className="casca"><PainelWorkspaces store={store} workspaces={workspaces} terminais={terminais} irParaSessao={irParaSessao} irParaTela={irParaTela} {...(opcoes.sobreposto !== undefined ? { sobreposto: opcoes.sobreposto } : {})} /></div>);
  const definirSessoes = (s: Array<{ sessao_id: string; estado: string; atividade?: string }>): void => { estadoTerm = { sessoes: s as never[] }; act(() => ouvTerm.forEach((o) => o())); };
  return { api, wsApi, store, workspaces, irParaSessao, irParaTela, guardado, definirSessoes, ...r };
}

const botaoCartao = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-nav="cartao"][data-ws="${id}"]`)!;
const linhaAgente = (sessao: string): HTMLElement => document.querySelector<HTMLElement>(`[data-nav="agente"][data-sessao="${sessao}"]`)!;
const cartao = (nome: string): HTMLElement => document.querySelector<HTMLElement>(`[data-ws-cartao="${nome}"]`)!;

const DOIS = (): ItemWorkspaceResumo[] => [
  item("ws_a", "alfa", [agente("sa", { estado: "trabalhando", titulo: "Claude Code", linha: "rodando testes" })]),
  item("ws_b", "beta", [agente("sb", { estado: "aguardando", titulo: "Codex" })]),
];

describe("PainelWorkspaces", () => {
  it("é um landmark complementary 'Workspaces', ativa o acompanhamento ao montar e solta ao desmontar", async () => {
    const m = montar(DOIS());
    await waitFor(() => expect(m.api.ativarResumo).toHaveBeenCalledWith(true));
    const aside = screen.getByRole("complementary", { name: "Workspaces" });
    expect(within(aside).getByRole("heading", { name: "Workspaces" })).toBeTruthy();
    await screen.findByText("alfa");
    expect(screen.getByLabelText("2 workspaces")).toBeTruthy();
    m.unmount();
    expect(m.api.ativarResumo).toHaveBeenLastCalledWith(false);
  });

  it("mostra o ativo destacado, ramo, pasta, chips e a linha do que o agente faz agora", async () => {
    montar(DOIS(), { atual: "ws_a" });
    await screen.findByText("alfa");
    const a = cartao("ws_a");
    await waitFor(() => expect(a.hasAttribute("data-ativo")).toBe(true));
    expect(botaoCartao("ws_a").getAttribute("aria-current")).toBe("true");
    expect(within(a).getByText("main")).toBeTruthy();
    expect(within(a).getByText("~/proj/alfa")).toBeTruthy();
    expect(within(a).getByText("rodando testes")).toBeTruthy();
    const b = cartao("ws_b");
    expect(b.hasAttribute("data-ativo")).toBe(false);
    expect(within(b).getByText("1 aguardando você")).toBeTruthy();
    expect(b.hasAttribute("data-atencao")).toBe(true);
  });

  it("selo do cabeçalho soma o que precisa de atenção FORA do workspace atual", async () => {
    montar(DOIS(), { atual: "ws_a" });
    await screen.findByText("alfa");
    expect(screen.getByRole("img", { name: /1 agente precisa de atenção em outros workspaces/ })).toBeTruthy();
  });

  it("clicar no cartão troca o workspace e leva aos Terminais, sem mexer nas sessões; o atual só navega", async () => {
    const m = montar(DOIS(), { atual: "ws_a" });
    await screen.findByText("alfa");
    fireEvent.click(botaoCartao("ws_a"));
    expect(m.wsApi.definirAtual).not.toHaveBeenCalled();
    expect(m.irParaTela).toHaveBeenLastCalledWith("terminais");
    m.irParaTela.mockClear();
    fireEvent.click(botaoCartao("ws_b"));
    expect(m.wsApi.definirAtual).toHaveBeenCalledWith("ws_b");
    expect(m.irParaTela).toHaveBeenCalledTimes(1);
    expect(m.irParaTela).toHaveBeenCalledWith("terminais");
    expect(m.api.encerrarAgente).not.toHaveBeenCalled();
    await waitFor(() => expect(cartao("ws_b").hasAttribute("data-ativo")).toBe(true)); // troca instantânea (otimista)
  });

  describe("chips de estado clicáveis", () => {
    const BETA = (): ItemWorkspaceResumo[] => [
      item("ws_a", "alfa", []),
      item("ws_b", "beta", [
        agente("piloto1", { estado: "trabalhando", piloto: true, profundidade: 0 }),
        agente("w1", { estado: "trabalhando", pai_sessao_id: "piloto1", profundidade: 1 }),
        agente("w2", { estado: "aguardando", pai_sessao_id: "piloto1", profundidade: 1 }),
        agente("w3", { estado: "erro", pai_sessao_id: "piloto1", profundidade: 1 }),
      ], { execucao: { fase: "rodando", nome: "dev", porta: 5173, sessao_id: "exec1", iniciado_em: 1 } }),
    ];

    it("'N agentes' troca para o workspace e foca o agente que trabalha (a raiz antes do worker)", async () => {
      const m = montar(BETA(), { atual: "ws_a" });
      await screen.findByText("alfa");
      fireEvent.click(cartao("ws_b").querySelector<HTMLElement>('button.pws-chip-acao[data-tom="neutro"]')!);
      expect(m.wsApi.definirAtual).toHaveBeenCalledWith("ws_b");
      expect(m.irParaSessao).toHaveBeenCalledWith("piloto1");
    });

    it("'aguardando você' e 'com erro' focam o agente certo; 'executando' foca a sessão de execução", async () => {
      const m = montar(BETA(), { atual: "ws_a" });
      await screen.findByText("alfa");
      const chip = (tom: string) => cartao("ws_b").querySelector<HTMLElement>(`button.pws-chip-acao[data-tom="${tom}"]`)!;
      fireEvent.click(chip("aguardando"));
      expect(m.irParaSessao).toHaveBeenLastCalledWith("w2");
      fireEvent.click(chip("erro"));
      expect(m.irParaSessao).toHaveBeenLastCalledWith("w3");
      fireEvent.click(chip("execucao"));
      expect(m.irParaSessao).toHaveBeenLastCalledWith("exec1");
    });

    it("execução sem sessão conhecida abre a tela Terminais; o clique no chip não dispara a troca duas vezes", async () => {
      const m = montar([item("ws_a", "alfa", []), item("ws_b", "beta", [], { execucao: { fase: "rodando", nome: null, porta: null, sessao_id: null, iniciado_em: 1 } })], { atual: "ws_a" });
      await screen.findByText("alfa");
      fireEvent.click(cartao("ws_b").querySelector<HTMLElement>('button.pws-chip-acao[data-tom="execucao"]')!);
      expect(m.irParaTela).toHaveBeenCalledWith("terminais");
      expect(m.wsApi.definirAtual).toHaveBeenCalledTimes(1);
    });
  });

  it("clicar em QUALQUER área do cartão (pasta, ramo, folga) troca o workspace; controles não trocam", async () => {
    const m = montar(DOIS(), { atual: "ws_a" });
    await screen.findByText("alfa");
    const b = cartao("ws_b");
    const pasta = b.querySelector(".pws-pasta") as HTMLElement;
    fireEvent.click(pasta);
    expect(m.wsApi.definirAtual).toHaveBeenCalledWith("ws_b");
    expect(m.irParaTela).toHaveBeenLastCalledWith("terminais");
    m.wsApi.definirAtual.mockClear();
    m.irParaTela.mockClear();
    // agora o atual é ws_b: a folga do próprio cartão do ws_a (li) volta para ele
    fireEvent.click(cartao("ws_a"));
    expect(m.wsApi.definirAtual).toHaveBeenCalledWith("ws_a");
    m.wsApi.definirAtual.mockClear();
    m.irParaTela.mockClear();
    // o chevron de recolher é um controle: não troca de workspace
    const chevron = cartao("ws_b").querySelector(".pws-chevron") as HTMLElement;
    fireEvent.click(chevron);
    expect(m.wsApi.definirAtual).not.toHaveBeenCalled();
    expect(m.irParaTela).not.toHaveBeenCalled();
    // trocar de volta para ws_b por uma área morta (a linha do ramo/chips) também vale
    fireEvent.click(cartao("ws_b").querySelector(".pws-meta") as HTMLElement);
    expect(m.wsApi.definirAtual).toHaveBeenCalledWith("ws_b");
  });

  it("clicar num agente troca o workspace e foca o painel dele nos Terminais", async () => {
    const m = montar(DOIS(), { atual: "ws_a" });
    await screen.findByText("alfa");
    fireEvent.click(linhaAgente("sb"));
    expect(m.wsApi.definirAtual).toHaveBeenCalledWith("ws_b");
    expect(m.irParaSessao).toHaveBeenCalledWith("sb");
  });

  describe("estrutura do cartão (nome em primeiro lugar)", () => {
    it("a linha do nome contém SOMENTE o bichinho e o nome", async () => {
      montar(DOIS(), { atual: "ws_a" });
      await screen.findByText("alfa");
      for (const id of ["ws_a", "ws_b"]) {
        const linha = cartao(id).querySelector(".pws-linha-nome") as HTMLElement;
        expect([...linha.children].map((c) => c.className)).toEqual(["pws-bichinho", "pws-nome-botao"]);
        expect(linha.querySelector("button .pws-atencao-ponto, button .pws-atual-rotulo, .pws-fav, .pws-chevron, .pws-menu-raiz")).toBeNull();
        expect((linha.querySelector(".pws-nome-botao") as HTMLElement).textContent).toBe(id === "ws_a" ? "alfa" : "beta");
      }
    });
    it("2ª linha = resumo (atenção, agentes, chips, há quanto tempo); 3ª = ramo, pasta e ações; nada cobre a 2ª", async () => {
      montar(DOIS(), { atual: "ws_a" });
      await screen.findByText("alfa");
      const b = cartao("ws_b");
      const ordem = [...b.children].map((c) => c.className).filter((c) => /pws-(linha-nome|linha-estado|meta)/.test(c));
      expect(ordem).toEqual(["pws-linha-nome", "pws-linha-estado", "pws-meta"]);
      const l2 = b.querySelector(".pws-linha-estado") as HTMLElement;
      expect(within(l2).getByRole("img", { name: "precisa de atenção" })).toBeTruthy();
      expect(within(l2).getByText("1 agente")).toBeTruthy();
      expect(within(l2).getByText("1 aguardando você")).toBeTruthy();
      expect(within(l2).getByText(/^há 2 min$/)).toBeTruthy();
      expect(within(l2).queryByRole("button", { name: "Mais ações de beta" })).toBeNull();
      const l3 = b.querySelector(".pws-meta") as HTMLElement;
      expect(within(l3).getByText("main")).toBeTruthy();
      expect(within(l3).getByText("~/proj/beta")).toBeTruthy();
      expect(within(l3).getByRole("button", { name: "Mais ações de beta" })).toBeTruthy();
    });
    it("a 2ª linha existe sempre: 'sem agentes' discreto (sem chip) quando vazio, e o resumo conta agentes mesmo só aguardando", async () => {
      montar([item("ws_v", "vazio"), item("ws_b", "beta", [agente("s1", { estado: "aguardando" }), agente("s2", { estado: "trabalhando" })])], { atual: "ws_v" });
      await screen.findByText("vazio");
      const v = cartao("ws_v").querySelector(".pws-linha-estado") as HTMLElement;
      expect(within(v).getByText("sem agentes").className).toBe("pws-sem-agentes");
      const b = cartao("ws_b").querySelector(".pws-linha-estado") as HTMLElement;
      expect(within(b).getByText("2 agentes · 1 ativo")).toBeTruthy();
      expect(within(b).getByText("1 aguardando você")).toBeTruthy();
    });
    it("o nome completo vai no tooltip e o ativo tem aria-current", async () => {
      const longo = "landing-sala-dos-mestres-com-um-nome-realmente-muito-comprido";
      montar([item("ws_l", longo), item("ws_b", "beta")], { atual: "ws_l" });
      await screen.findByText(longo);
      expect(botaoCartao("ws_l").title).toContain(longo);
      expect(botaoCartao("ws_l").getAttribute("aria-current")).toBe("true");
      expect(botaoCartao("ws_b").getAttribute("aria-current")).toBeNull();
    });
    it("as ações seguem acessíveis por teclado (fora de display:none, na ordem do Tab) e ficam visíveis no foco (CSS)", async () => {
      montar(DOIS(), { atual: "ws_a" });
      await screen.findByText("alfa");
      for (const nome of ["Recolher alfa", "Fixar alfa no topo", "Mais ações de alfa"]) {
        const b = screen.getByRole("button", { name: nome });
        expect(b.tabIndex).toBe(0);
        b.focus();
        expect(document.activeElement).toBe(b);
      }
      const css = readFileSync("src/renderer/casca/painel-workspaces.css", "utf8");
      expect(css).toMatch(/\.pws-acoes\s*\{[^}]*opacity:\s*0/);
      expect(css).not.toMatch(/\.pws-acoes\s*\{[^}]*(display:\s*none|visibility:\s*hidden)/);
      expect(css).toMatch(/\.pws-acoes:focus-within[^{]*\{[^}]*opacity:\s*1/);
      expect(css).toMatch(/@media \(hover: none\)\s*\{\s*\.pws-acoes\s*\{[^}]*opacity:\s*1/);
    });
    it("recuo: padding esquerdo do cartão ≤ 10 px, recuo por nível ≤ 12 px e no máximo 2 níveis de recuo", async () => {
      const css = readFileSync("src/renderer/casca/painel-workspaces.css", "utf8");
      const px = (v: string): number => Number(new RegExp(`${v}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(css)?.[1] ?? NaN);
      expect(px("--pws-pad-esq")).toBeLessThanOrEqual(10);
      expect(px("--pws-recuo-nivel")).toBeLessThanOrEqual(12);
      expect(css).toMatch(/\.pws-cartao\s*\{[^}]*padding:\s*\d+px\s+\d+px\s+\d+px\s+var\(--pws-pad-esq\)/);
      expect(css).not.toMatch(/\.pws-chevron\s*\{[^}]*\bwidth:/); // o chevron não reserva coluna fixa
      montar([item("ws_a", "alfa", [agente("p", { piloto: true }), agente("w", { pai_sessao_id: "p", profundidade: 1 }), agente("x", { pai_sessao_id: "w", profundidade: 2 }), agente("y", { pai_sessao_id: "x", profundidade: 3 })])]);
      await screen.findByText("alfa");
      const nos = [...cartao("ws_a").querySelectorAll<HTMLElement>(".pws-no")];
      expect(nos.map((n) => n.style.getPropertyValue("--nivel"))).toEqual(["0", "1", "2", "2"]);
    });
  });

  describe("terminar agente", () => {
    it("pede confirmação inline; 'Não' e Esc cancelam sem encerrar", async () => {
      const m = montar(DOIS(), { atual: "ws_a" });
      await screen.findByText("alfa");
      fireEvent.click(screen.getByRole("button", { name: "Terminar Codex" }));
      expect(screen.getByRole("alertdialog", { name: "Terminar Codex?" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Não" }));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Terminar Codex" }));
      fireEvent.keyDown(screen.getByRole("button", { name: "Sim, terminar" }), { key: "Escape" });
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(m.api.encerrarAgente).not.toHaveBeenCalled();
    });
    it("agente trabalhando pede aviso mais claro; 'Sim' encerra SÓ aquela sessão naquele workspace", async () => {
      const m = montar(DOIS(), { atual: "ws_b" });
      await screen.findByText("alfa");
      fireEvent.click(screen.getByRole("button", { name: "Terminar Claude Code" }));
      expect(screen.getByText(/interrompido/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Sim, terminar" }));
      await waitFor(() => expect(m.api.encerrarAgente).toHaveBeenCalledTimes(1));
      expect(m.api.encerrarAgente).toHaveBeenCalledWith("ws_a", "sa");
      expect(m.wsApi.definirAtual).not.toHaveBeenCalled(); // terminar não troca de workspace
    });
  });

  it("limita a 6 agentes por cartão e mostra 'e mais N'", async () => {
    const muitos = Array.from({ length: 9 }, (_, i) => agente(`s${i}`, { titulo: `Agente ${i}` }));
    montar([item("ws_a", "alfa", muitos)]);
    await screen.findByText("alfa");
    expect(within(cartao("ws_a")).getAllByRole("button", { name: /^Terminar / })).toHaveLength(6);
    expect(within(cartao("ws_a")).getByText("e mais 3 agentes")).toBeTruthy();
  });

  it("monta a árvore: Missão → piloto → worker, subagentes só como contagem, e a Execução", async () => {
    montar([item("ws_a", "alfa", [agente("p", { piloto: true, titulo: "Claude · piloto", subagentes: { total: 3, ativos: 2 } }), agente("w", { pai_sessao_id: "p", profundidade: 1, titulo: "Codex · executor #2" })], {
      missao: { id: "m", titulo: "Corrigir login", modo: "squad", estado: "executando", piloto_sessao_id: "p" },
      execucao: { fase: "rodando", nome: "dev", porta: 5173, sessao_id: "r", iniciado_em: Date.now() - 60_000 },
    })]);
    await screen.findByText("alfa");
    const c = cartao("ws_a");
    expect(within(c).getByText("Corrigir login")).toBeTruthy();
    expect(within(c).getByText("Abrir Missão")).toBeTruthy();
    expect(within(c).getByText("2/3 sub")).toBeTruthy();
    expect(within(c).getByText("Execução · dev")).toBeTruthy();
    expect(within(c).getByText(/porta 5173/)).toBeTruthy();
    const niveis = [...c.querySelectorAll<HTMLElement>(".pws-no")].map((n) => n.dataset["nivel"]);
    expect(niveis).toEqual(["0", "1", "2", "0"]);
  });

  it("'Abrir Missão' troca o workspace e abre a tela de Missões", async () => {
    const m = montar([item("ws_a", "alfa"), item("ws_b", "beta", [agente("p", { piloto: true })], { missao: { id: "m", titulo: "T", modo: "livre", estado: "executando", piloto_sessao_id: "p" } })], { atual: "ws_a" });
    await screen.findByText("beta");
    fireEvent.click(screen.getByText("Abrir Missão"));
    expect(m.wsApi.definirAtual).toHaveBeenCalledWith("ws_b");
    expect(m.irParaTela).toHaveBeenCalledWith("missoes");
  });

  it("o estado ao vivo do store de terminais atualiza o cartão sem novo resumo do main", async () => {
    const m = montar([item("ws_a", "alfa", [agente("sa", { estado: "ocioso" })])], { atual: "ws_a" });
    await screen.findByText("alfa");
    expect(within(cartao("ws_a")).queryByText(/aguardando você/)).toBeNull();
    m.definirSessoes([{ sessao_id: "sa", estado: "executando", atividade: "aguardando" }]);
    expect(within(cartao("ws_a")).getAllByText(/aguardando você/).length).toBeGreaterThan(0);
    expect(m.api.resumo).toHaveBeenCalledTimes(1);
  });

  it("filtra por nome, ramo ou agente e mostra aviso quando nada combina", async () => {
    montar(DOIS());
    await screen.findByText("alfa");
    const campo = screen.getByRole("searchbox");
    fireEvent.change(campo, { target: { value: "codex" } });
    expect(screen.queryByText("alfa")).toBeNull();
    expect(screen.getByText("beta")).toBeTruthy();
    fireEvent.change(campo, { target: { value: "zzz" } });
    expect(screen.getByText(/Nenhum workspace combina/)).toBeTruthy();
  });

  it("estado vazio pede para adicionar um workspace (abre o modal D-600)", async () => {
    const m = montar([], { atual: null });
    await screen.findByText(/Nenhum projeto aberto/);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar workspace…" }));
    expect(storeAdicionarWorkspace.obter().aberto).toBe(true);
    expect(m.wsApi.abrir).not.toHaveBeenCalled();
    storeAdicionarWorkspace.fechar();
  });

  it("o botão + do cabeçalho abre o modal Adicionar workspace", async () => {
    const m = montar(DOIS());
    await screen.findByText("alfa");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar workspace" }));
    expect(storeAdicionarWorkspace.obter()).toMatchObject({ aberto: true, secao: "pasta" });
    expect(m.wsApi.abrir).not.toHaveBeenCalled();
    storeAdicionarWorkspace.fechar();
  });

  it("erro do main aparece com 'Tentar de novo'", async () => {
    const itens = DOIS();
    const m = montar(itens);
    await screen.findByText("alfa");
    m.api.resumo.mockRejectedValueOnce(new Error("falhou"));
    await act(async () => { await m.store.atualizar(); });
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  describe("teclado", () => {
    it("↑/↓ percorrem os cartões, → entra nos agentes, ← volta, Delete pede para terminar, Esc cancela", async () => {
      montar(DOIS(), { atual: "ws_a" });
      await screen.findByText("alfa");
      const botoes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-nav="cartao"]')];
      botoes()[0]!.focus();
      fireEvent.keyDown(botoes()[0]!, { key: "ArrowDown" });
      expect(document.activeElement).toBe(botoes()[1]);
      fireEvent.keyDown(botoes()[1]!, { key: "ArrowUp" });
      expect(document.activeElement).toBe(botoes()[0]);
      fireEvent.keyDown(botoes()[0]!, { key: "ArrowRight" });
      const linha = document.activeElement as HTMLElement;
      expect(linha.dataset["nav"]).toBe("agente");
      expect(linha.dataset["sessao"]).toBe("sa");
      fireEvent.keyDown(linha, { key: "Delete" });
      const sim = screen.getByRole("button", { name: "Sim, terminar" });
      expect(sim).toBeTruthy();
      fireEvent.keyDown(sim, { key: "Escape" });
      expect(screen.queryByRole("alertdialog")).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(botoes()[0]));
    });
    it("só um botão de cartão fica na ordem do Tab", async () => {
      montar(DOIS(), { atual: "ws_b" });
      await screen.findByText("alfa");
      const tab = [...document.querySelectorAll<HTMLElement>('[data-nav="cartao"]')].filter((b) => b.tabIndex === 0);
      expect(tab).toHaveLength(1);
      await waitFor(() => expect(tab[0]!.dataset["ws"]).toBe("ws_b"));
    });
  });

  describe("preferências persistidas", () => {
    it("favoritar sobe o cartão e grava", async () => {
      const m = montar(DOIS());
      await screen.findByText("alfa");
      expect([...document.querySelectorAll("[data-ws-cartao]")].map((e) => (e as HTMLElement).dataset["wsCartao"])).toEqual(["ws_a", "ws_b"]);
      fireEvent.click(screen.getByRole("button", { name: "Fixar beta no topo" }));
      expect([...document.querySelectorAll("[data-ws-cartao]")].map((e) => (e as HTMLElement).dataset["wsCartao"])).toEqual(["ws_b", "ws_a"]);
      expect([...m.guardado.values()].join("")).toContain('"favoritos":["ws_b"]');
    });
    it("recolher e expandir tudo; modo compacto esconde a árvore", async () => {
      montar(DOIS());
      await screen.findByText("alfa");
      expect(screen.getAllByRole("list", { name: /Agentes em/ })).toHaveLength(2);
      fireEvent.click(screen.getByRole("button", { name: "Recolher todos os cartões" }));
      expect(screen.queryAllByRole("list", { name: /Agentes em/ })).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: "Expandir todos os cartões" }));
      expect(screen.getAllByRole("list", { name: /Agentes em/ })).toHaveLength(2);
      fireEvent.click(screen.getByRole("button", { name: "Visão geral compacta" }));
      expect(screen.queryAllByRole("list", { name: /Agentes em/ })).toHaveLength(0);
      // visão geral: uma linha [bichinho][nome] + selo mínimo de atenção (sem chips, ramo nem pasta)
      expect(within(cartao("ws_b")).getByRole("img", { name: "1 agente precisa de atenção" })).toBeTruthy();
      expect(cartao("ws_b").querySelector(".pws-chips, .pws-meta")).toBeNull();
      expect(within(cartao("ws_b")).getByRole("button", { name: "Mais ações de beta" })).toBeTruthy();
    });
    it("arrastar reordena e persiste", async () => {
      const m = montar(DOIS());
      await screen.findByText("alfa");
      const dt = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
      fireEvent.dragStart(cartao("ws_b"), { dataTransfer: dt });
      fireEvent.dragOver(cartao("ws_a"), { dataTransfer: dt });
      fireEvent.drop(cartao("ws_a"), { dataTransfer: dt });
      expect([...document.querySelectorAll("[data-ws-cartao]")].map((e) => (e as HTMLElement).dataset["wsCartao"])).toEqual(["ws_b", "ws_a"]);
      expect([...m.guardado.values()].join("")).toContain('"ordem":["ws_b","ws_a"]');
    });
    it("Alt+↓ reordena por teclado", async () => {
      montar(DOIS());
      await screen.findByText("alfa");
      const a = botaoCartao("ws_a");
      fireEvent.keyDown(a, { key: "ArrowDown", altKey: true });
      expect([...document.querySelectorAll("[data-ws-cartao]")].map((e) => (e as HTMLElement).dataset["wsCartao"])).toEqual(["ws_b", "ws_a"]);
    });
  });

  describe("menu do cartão", () => {
    it("o menu ⋯ abre FORA do cartão (portal no body, posição fixa), para não ser cortado por ele", async () => {
      montar(DOIS());
      await screen.findByText("alfa");
      fireEvent.click(screen.getByRole("button", { name: "Mais ações de alfa" }));
      const menu = screen.getByRole("menu", { name: "Ações de alfa" });
      expect(cartao("ws_a").contains(menu)).toBe(false); // não é filho do cartão (que corta o que passa da borda)
      expect(menu.parentElement).toBe(document.body);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("menu", { name: "Ações de alfa" })).toBeNull();
    });

    it("clicar fora fecha o menu; clicar num item do menu flutuante não o fecha antes da ação", async () => {
      const m = montar(DOIS());
      await screen.findByText("alfa");
      fireEvent.click(screen.getByRole("button", { name: "Mais ações de alfa" }));
      fireEvent.mouseDown(screen.getByRole("menuitem", { name: "Copiar caminho" })); // mousedown dentro do menu não fecha
      expect(screen.getByRole("menu", { name: "Ações de alfa" })).toBeTruthy();
      fireEvent.click(screen.getByRole("menuitem", { name: "Copiar caminho" }));
      expect(m.api.copiarCaminho).toHaveBeenCalledWith("ws_a");
      fireEvent.click(screen.getByRole("button", { name: "Mais ações de alfa" }));
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("menu", { name: "Ações de alfa" })).toBeNull();
    });

    it("revelar e copiar chamam o main só com o id; remover pede confirmação e não apaga a pasta", async () => {
      const m = montar(DOIS());
      await screen.findByText("alfa");
      fireEvent.click(screen.getByRole("button", { name: "Mais ações de alfa" }));
      fireEvent.click(screen.getByRole("menuitem", { name: /Revelar no Finder|Mostrar no Explorador/ }));
      expect(m.api.revelar).toHaveBeenCalledWith("ws_a");
      fireEvent.click(screen.getByRole("button", { name: "Mais ações de alfa" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Copiar caminho" }));
      expect(m.api.copiarCaminho).toHaveBeenCalledWith("ws_a");
      fireEvent.click(screen.getByRole("button", { name: "Mais ações de beta" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Remover da lista" }));
      expect(screen.getByText(/A pasta não é apagada/)).toBeTruthy();
      expect(m.wsApi.remover).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Sim, remover" }));
      expect(m.wsApi.remover).toHaveBeenCalledWith("ws_b");
    });
  });

  describe("largura", () => {
    it("a borda é um separador com teclado (200–360) e grava a largura na variável CSS da casca", async () => {
      const m = montar(DOIS());
      await screen.findByText("alfa");
      const sep = screen.getByRole("separator", { name: /Largura/ });
      expect(sep.getAttribute("aria-valuemin")).toBe("200");
      expect(sep.getAttribute("aria-valuemax")).toBe("360");
      expect(sep.getAttribute("aria-valuenow")).toBe("264");
      fireEvent.keyDown(sep, { key: "ArrowRight" });
      expect(m.store.obter().prefs.largura).toBe(280);
      expect(document.querySelector<HTMLElement>(".casca")!.style.getPropertyValue("--painel-ws-largura")).toBe("280px");
      fireEvent.keyDown(sep, { key: "End" });
      expect(m.store.obter().prefs.largura).toBe(360);
      fireEvent.keyDown(sep, { key: "Home" });
      expect(m.store.obter().prefs.largura).toBe(200);
    });
  });

  it("como sobreposição (janela estreita), Esc solta o painel", async () => {
    const m = montar(DOIS(), { sobreposto: true });
    await screen.findByText("alfa");
    m.store.definirFixado(true);
    expect(screen.getByRole("complementary", { name: "Workspaces" }).hasAttribute("data-sobreposto")).toBe(true);
    fireEvent.keyDown(botaoCartao("ws_a"), { key: "Escape" });
    expect(m.store.obter().prefs.fixado).toBe(false);
  });

  it("30 workspaces e 60 agentes renderizam rápido", async () => {
    const itens = Array.from({ length: 30 }, (_, i) => item(`ws_${i}`, `proj${i}`, [agente(`a${i}`, { estado: "trabalhando", linha: "editando" }), agente(`b${i}`)]));
    const t0 = performance.now();
    montar(itens);
    await screen.findByText("proj0");
    expect(document.querySelectorAll("[data-ws-cartao]")).toHaveLength(30);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
