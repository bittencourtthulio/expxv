import { describe, expect, it, vi } from "vitest";
import type { AgenteResumo, ItemWorkspaceResumo } from "../../compartilhado/workspaces-resumo";
import {
  rotuloHa,
  abreviarMeio, aplicarAoVivo, confirmacaoTerminar, criarCoalescedor, filtrarItens, formatarDuracao, gravarPrefsPainel, larguraPorTecla, lerPrefsPainel,
  limitarLargura, linhasDoCard, mesclarAoVivo, moverNaOrdem, ordenarItens, passoNaLista, precisaAtencao, rotuloDoEstado, sanearPrefsPainel, somarAtencaoFora,
  descreverAgora, alternarEm, anunciosDeMudanca, moverUmPasso, CHAVE_PAINEL_WORKSPACES, LARGURA_MAX, LARGURA_MIN, LARGURA_PADRAO,
} from "./painel-workspaces-logica";

export const agente = (id: string, extra: Partial<AgenteResumo> = {}): AgenteResumo => ({
  sessao_id: id, pane_id: null, mission_id: null, pai_sessao_id: null, profundidade: 0, ferramenta_id: "claude", titulo: `Claude ${id}`, papel: null, piloto: false,
  estado: "ocioso", sessao_estado: "executando", atividade: null, desde: 0, atividade_em: null, linha: null, subagentes: null, ...extra,
});
export const item = (id: string, nome: string, extra: Partial<ItemWorkspaceResumo> = {}): ItemWorkspaceResumo => ({
  id, nome, pasta_mascarada: `~/p/${nome}`, branch: "main", sujo: false, atual: false, missao: null, missoes_ativas: 0, agentes: [], execucao: null,
  contagens: { agentes: 0, trabalhando: 0, aguardando: 0, erro: 0, subagentes: 0, terminais: 0 }, ...extra,
});

describe("preferências persistidas", () => {
  it("saneia o que vem do storage e limita a largura entre 200 e 360", () => {
    expect(limitarLargura(10)).toBe(LARGURA_MIN);
    expect(limitarLargura(999)).toBe(LARGURA_MAX);
    expect(limitarLargura(Number.NaN)).toBe(LARGURA_PADRAO);
    const p = sanearPrefsPainel({ fixado: true, largura: 5000, ordem: ["a", "a", 3, "b"], favoritos: "x", recolhidos: ["c"], modo: "compacto", lixo: 1 });
    expect(p).toEqual({ fixado: true, largura: LARGURA_MAX, ordem: ["a", "b"], favoritos: [], recolhidos: ["c"], modo: "compacto" });
    expect(sanearPrefsPainel(null).fixado).toBe(false);
    expect(sanearPrefsPainel({ modo: "x" }).modo).toBe("detalhado");
  });
  it("grava e relê; storage quebrado não derruba", () => {
    const mem = new Map<string, string>();
    const arm = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    gravarPrefsPainel({ fixado: true, largura: 300, ordem: ["a"], favoritos: ["a"], recolhidos: [], modo: "detalhado" }, arm);
    expect(mem.has(CHAVE_PAINEL_WORKSPACES)).toBe(true);
    expect(lerPrefsPainel(arm)).toMatchObject({ fixado: true, largura: 300, favoritos: ["a"] });
    const ruim = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(lerPrefsPainel(ruim).fixado).toBe(false);
    expect(() => gravarPrefsPainel(lerPrefsPainel(ruim), ruim)).not.toThrow();
    mem.set(CHAVE_PAINEL_WORKSPACES, "{quebrado");
    expect(lerPrefsPainel(arm).fixado).toBe(false);
  });
});

describe("ordenação, favoritos e filtro", () => {
  const itens = [item("c", "Charlie"), item("a", "alfa"), item("b", "Bravo"), item("d", "delta")];
  it("favoritos no topo, depois a ordem manual, depois o resto por nome; não muta a entrada", () => {
    const copia = [...itens];
    expect(ordenarItens(itens, { ordem: [], favoritos: [] }).map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    expect(ordenarItens(itens, { ordem: ["d", "c"], favoritos: [] }).map((i) => i.id)).toEqual(["d", "c", "a", "b"]);
    expect(ordenarItens(itens, { ordem: ["d", "c"], favoritos: ["b"] }).map((i) => i.id)).toEqual(["b", "d", "c", "a"]);
    expect(itens).toEqual(copia);
  });
  it("mover na ordem põe o item antes do alvo e devolve a ordem completa", () => {
    expect(moverNaOrdem(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(moverNaOrdem(["a", "b"], "a", "a")).toEqual(["a", "b"]);
    expect(moverNaOrdem(["a", "b"], "x", "a")).toEqual(["a", "b"]);
    expect(alternarEm(["a"], "b")).toEqual(["a", "b"]);
    expect(alternarEm(["a", "b"], "a")).toEqual(["b"]);
  });
  it("mover um passo troca com o vizinho e respeita os extremos", () => {
    expect(moverUmPasso(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moverUmPasso(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moverUmPasso(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moverUmPasso(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(moverUmPasso(["a"], "x", 1)).toEqual(["a"]);
  });
  it("filtra por nome, pasta, ramo, Missão e agente, ignorando acento e caixa", () => {
    const todos = [
      item("a", "Café", { pasta_mascarada: "~/clientes/cafe" }),
      item("b", "beta", { branch: "feature/login" }),
      item("c", "gama", { missao: { id: "m", titulo: "Migração do banco", modo: "livre", estado: "executando", piloto_sessao_id: null }, agentes: [agente("s1", { titulo: "Codex · revisor" })] }),
    ];
    expect(filtrarItens(todos, "").length).toBe(3);
    expect(filtrarItens(todos, "CAFE").map((i) => i.id)).toEqual(["a"]);
    expect(filtrarItens(todos, "clientes").map((i) => i.id)).toEqual(["a"]);
    expect(filtrarItens(todos, "login").map((i) => i.id)).toEqual(["b"]);
    expect(filtrarItens(todos, "migracao").map((i) => i.id)).toEqual(["c"]);
    expect(filtrarItens(todos, "revisor").map((i) => i.id)).toEqual(["c"]);
    expect(filtrarItens(todos, "zzz")).toEqual([]);
  });
});

describe("atenção", () => {
  const com = (a: number, e: number, atual = false) => item("x", "x", { atual, contagens: { agentes: a + e, trabalhando: 0, aguardando: a, erro: e, subagentes: 0, terminais: 0 } });
  it("aguardando ou erro pedem atenção; o selo soma só os workspaces fora do atual", () => {
    expect(precisaAtencao(com(1, 0))).toBe(true);
    expect(precisaAtencao(com(0, 1))).toBe(true);
    expect(precisaAtencao(com(0, 0))).toBe(false);
    expect(somarAtencaoFora([com(2, 1, true), com(1, 0), com(0, 2)])).toBe(3);
  });
});

describe("estado ao vivo", () => {
  it("o store de terminais manda no estado, na atividade e nos subagentes", () => {
    const a = agente("s1", { estado: "ocioso" });
    const r = mesclarAoVivo(a, { estado: "executando", atividade: "aguardando", subagentes: { total: 2, ativos: 1 } }, 500);
    expect(r).toMatchObject({ estado: "aguardando", atividade: "aguardando", atividade_em: 500, subagentes: { total: 2, ativos: 1 } });
    expect(mesclarAoVivo(a, undefined, 500)).toBe(a);
    expect(mesclarAoVivo(a, { estado: "erro" }, 1).estado).toBe("erro");
    expect(mesclarAoVivo(a, { estado: "iniciando" }, 1).estado).toBe("iniciando");
  });
  it("aplicar a um item recalcula as contagens e mantém os terminais", () => {
    const it0 = item("w", "w", { agentes: [agente("s1"), agente("s2")], contagens: { agentes: 2, trabalhando: 0, aguardando: 0, erro: 0, subagentes: 0, terminais: 3 } });
    const r = aplicarAoVivo(it0, (id) => (id === "s2" ? { estado: "executando", atividade: "trabalhando" } : undefined), 10);
    expect(r.contagens).toMatchObject({ agentes: 2, trabalhando: 1, terminais: 3 });
    expect(aplicarAoVivo(item("v", "v"), () => undefined, 1).agentes).toEqual([]);
  });
});

describe("texto", () => {
  it("abrevia no meio e preserva o fim do caminho", () => {
    const r = abreviarMeio("~/clientes/empresa-grande/projeto-x", 20);
    expect([...r].length).toBe(20);
    expect(r.startsWith("~/clien")).toBe(true);
    expect(r.endsWith("jeto-x")).toBe(true);
    expect(r).toContain("…");
    expect(abreviarMeio("curto", 20)).toBe("curto");
  });
  it("formata duração", () => {
    expect(formatarDuracao(null, 10)).toBe("");
    expect(formatarDuracao(10_000, 12_000)).toBe("agora");
    expect(formatarDuracao(0, 42_000)).toBe("42s");
    expect(formatarDuracao(0, 5 * 60_000)).toBe("5m");
    expect(formatarDuracao(0, 65 * 60_000)).toBe("1h05");
  });
  it("rótulos nunca dependem só de cor e descrevem o que faz agora", () => {
    expect(rotuloDoEstado("aguardando")).toEqual({ texto: "aguardando você", forma: "alerta" });
    expect(rotuloDoEstado("trabalhando").forma).toBe("anel");
    expect(rotuloDoEstado("erro").forma).toBe("erro");
    expect(descreverAgora(agente("s", { estado: "trabalhando", linha: "rodando testes" }))).toBe("rodando testes");
    expect(descreverAgora(agente("s", { estado: "trabalhando" }))).toBe("trabalhando");
    expect(descreverAgora(agente("s", { estado: "aguardando" }))).toBe("aguardando sua resposta");
    expect(descreverAgora(agente("s", { estado: "ocioso" }))).toBe("ocioso");
  });
});

describe("confirmação de terminar", () => {
  it("agente trabalhando e piloto com workers pedem aviso mais claro; ocioso, a pergunta curta", () => {
    expect(confirmacaoTerminar(agente("a", { estado: "trabalhando", titulo: "Claude Code" }), 0)).toMatchObject({ pergunta: "Terminar Claude Code?", forte: true });
    expect(confirmacaoTerminar(agente("a", { piloto: true, titulo: "Claude · piloto" }), 2)).toMatchObject({ forte: true, detalhe: expect.stringContaining("2 workers") });
    expect(confirmacaoTerminar(agente("a", { estado: "ocioso", titulo: "Codex" }), 0)).toEqual({ pergunta: "Terminar Codex?", forte: false, detalhe: null });
  });
});

describe("árvore de linhas", () => {
  const agentes = Array.from({ length: 9 }, (_, i) => agente(`s${i}`));
  it("limita a 6 agentes e acrescenta 'e mais N'", () => {
    const l = linhasDoCard(item("w", "w", { agentes }));
    expect(l.filter((x) => x.tipo === "agente")).toHaveLength(6);
    expect(l.at(-1)).toMatchObject({ tipo: "mais", quantos: 3 });
    expect(linhasDoCard(item("w", "w", { agentes }), 6, true).some((x) => x.tipo === "mais")).toBe(false);
  });
  it("Missão → piloto → workers (níveis) → execução, com 'último' para as linhas-guia", () => {
    const it1 = item("w", "w", {
      missao: { id: "m1", titulo: "Login", modo: "squad", estado: "executando", piloto_sessao_id: "p" }, missoes_ativas: 1,
      agentes: [agente("p", { piloto: true }), agente("w1", { pai_sessao_id: "p", profundidade: 1 }), agente("w2", { pai_sessao_id: "p", profundidade: 1 })],
      execucao: { fase: "rodando", nome: "dev", porta: 5173, sessao_id: "r", iniciado_em: 1 },
    });
    const l = linhasDoCard(it1);
    expect(l.map((x) => x.tipo)).toEqual(["missao", "agente", "agente", "agente", "execucao"]);
    expect(l[0]).toMatchObject({ mais: 1 });
    expect(l.filter((x) => x.tipo === "agente").map((x) => (x.tipo === "agente" ? [x.nivel, x.ultimo] : null))).toEqual([[1, true], [2, false], [2, true]]);
  });
  it("sem Missão a raiz é o nível 0", () => {
    const l = linhasDoCard(item("w", "w", { agentes: [agente("a")] }));
    expect(l[0]).toMatchObject({ tipo: "agente", nivel: 0, ultimo: true });
  });
});

describe("teclado", () => {
  it("↑/↓/Home/End percorrem sem sair dos limites", () => {
    expect(passoNaLista("ArrowDown", -1, 3)).toBe(0);
    expect(passoNaLista("ArrowDown", 2, 3)).toBe(2);
    expect(passoNaLista("ArrowUp", 0, 3)).toBe(0);
    expect(passoNaLista("ArrowUp", 2, 3)).toBe(1);
    expect(passoNaLista("End", 0, 3)).toBe(2);
    expect(passoNaLista("Home", 2, 3)).toBe(0);
    expect(passoNaLista("a", 0, 3)).toBeNull();
    expect(passoNaLista("ArrowDown", 0, 0)).toBeNull();
  });
  it("redimensionar por teclado respeita 200–360", () => {
    expect(larguraPorTecla("ArrowRight", 264, false)).toBe(280);
    expect(larguraPorTecla("ArrowLeft", 264, true)).toBe(200);
    expect(larguraPorTecla("ArrowRight", 350, true)).toBe(360);
    expect(larguraPorTecla("Home", 300, false)).toBe(200);
    expect(larguraPorTecla("End", 300, false)).toBe(360);
    expect(larguraPorTecla("x", 300, false)).toBeNull();
  });
});

describe("coalescedor", () => {
  it("junta uma rajada numa entrega só com o último valor", () => {
    vi.useFakeTimers();
    const entregar = vi.fn();
    const c = criarCoalescedor<number>(entregar, 300);
    for (let i = 0; i < 100; i += 1) c.agendar(i);
    expect(entregar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(entregar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(entregar).toHaveBeenCalledTimes(1);
    expect(entregar).toHaveBeenCalledWith(99);
    c.agendar(1);
    c.cancelar();
    vi.advanceTimersByTime(1000);
    expect(entregar).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("identidade estável e anúncios", () => {
  it("sem mudança no estado ao vivo devolve o mesmo objeto (cartões memorizados não renderizam)", () => {
    const a = agente("s1", { estado: "trabalhando", atividade: "trabalhando", sessao_estado: "executando" });
    expect(mesclarAoVivo(a, { estado: "executando", atividade: "trabalhando" }, 9)).toBe(a);
    const it0 = item("w", "w", { agentes: [a] });
    expect(aplicarAoVivo(it0, () => ({ estado: "executando", atividade: "trabalhando" }), 9)).toBe(it0);
    expect(aplicarAoVivo(it0, () => ({ estado: "executando", atividade: "aguardando" }), 9)).not.toBe(it0);
  });
  it("anuncia só quem passou a aguardar ou a falhar, no máximo 3", () => {
    const antes = [item("w", "beta", { agentes: [agente("a", { estado: "trabalhando" }), agente("b", { estado: "ocioso" })] })];
    const depois = [item("w", "beta", { agentes: [agente("a", { estado: "aguardando", titulo: "Claude Code" }), agente("b", { estado: "erro", titulo: "Codex" }), agente("c", { estado: "aguardando" })] })];
    expect(anunciosDeMudanca(antes, depois)).toEqual(["beta: Claude Code aguarda você", "beta: Codex terminou com erro"]);
    expect(anunciosDeMudanca(depois, depois)).toEqual([]);
    const muitos = (e: "ocioso" | "aguardando") => [item("w", "w", { agentes: Array.from({ length: 5 }, (_, i) => agente(`s${i}`, { estado: e })) })];
    const r = anunciosDeMudanca(muitos("ocioso"), muitos("aguardando"));
    expect(r).toHaveLength(4);
    expect(r[3]).toBe("e mais 2");
  });
});

describe("rotuloHa", () => {
  it("fala em linguagem curta e some quando desconhecido", () => {
    const n = 1_000_000_000;
    expect(rotuloHa(null, n)).toBe("");
    expect(rotuloHa(n - 2_000, n)).toBe("agora");
    expect(rotuloHa(n - 30_000, n)).toBe("há 30 s");
    expect(rotuloHa(n - 180_000, n)).toBe("há 3 min");
    expect(rotuloHa(n - 2 * 3_600_000, n)).toBe("há 2 h");
    expect(rotuloHa(n - 3 * 86_400_000, n)).toBe("há 3 d");
  });
});
