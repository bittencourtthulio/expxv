import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ConfigDecisorEntrada, PoliticaEntrada } from "../compartilhado/harness";
import type { AccountUsage, JanelaKind } from "../compartilhado/limites";
import { abrirBanco, migrar, type Banco } from "../nucleo/banco";
import { criarRepositorios, type Repositorios } from "../nucleo/banco/repos";
import type { Cofre } from "../nucleo/cofre";
import type { EntradaPreparoDePane, PreparoDaSessao } from "../nucleo/missoes/panes";
import { criarRegistroConsentimento, type ClienteRede } from "../nucleo/rede";
import { criarBarramento } from "./barramento";
import { ErroHarness, caminhosDaEquivalencia, combinarComplementos, configDecisorPadrao, criarComplementoDoCofre, criarHarnessMain, type DependenciasHarnessMain } from "./harness";
import { CANAIS_HARNESS_ONDA_5, registrarIpcHarness } from "./ipc/harness-manipuladores";
import { criarRegistroIpc, type IpcMainLike } from "./ipc/registro";

const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const RESET = "2026-10-01T17:00:00.000Z";
const SENTINELA = "SENTINELA-decisor-chave-7c1d9e2b";

const bancos: Banco[] = [];
const pastas: string[] = [];
afterEach(() => {
  bancos.splice(0).forEach((b) => b.fechar());
  pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});

const uso = (id: string, provider: string, janelas: Array<[JanelaKind, number | null]>): AccountUsage => {
  const medidas = janelas.filter(([, u]) => u !== null) as Array<[JanelaKind, number]>;
  const g = medidas.length === 0 ? null : medidas.reduce((a, b) => (b[1] > a[1] ? b : a));
  return {
    account_id: id, provider, fetched_at: "2026-10-01T11:59:00.000Z", fonte: "claude_statusline", confianca: "medido", status: "ok",
    windows: janelas.map(([kind, used]) => ({ kind, used_pct: used, resets_at: RESET })), model_buckets: {},
    bottleneck: g === null ? null : g[0], slack_pct: g === null ? null : 100 - g[1], idade_s: 60, vencidas: [],
  };
};

interface Opcoes {
  instalados?: string[];
  usos?: AccountUsage[];
  permissao?: "seguro" | "automatico";
  rede?: ClienteRede;
  caminhos?: string[];
  semLimites?: boolean;
}
function montar(o: Opcoes = {}) {
  const banco = abrirBanco(":memory:");
  bancos.push(banco);
  migrar(banco);
  const repos: Repositorios = criarRepositorios(banco);
  const dir = mkdtempSync(join(tmpdir(), "ade-harness-main-"));
  pastas.push(dir);
  const ws = repos.workspace.criar({ nome: "w", raiz: "/w", permissao: o.permissao ?? "seguro" });
  const contas = {
    cl1: repos.conta.criar({ provedor: "claude", rotulo: "cl·1" }),
    cl2: repos.conta.criar({ provedor: "claude", rotulo: "cl·2" }),
    cx1: repos.conta.criar({ provedor: "codex", rotulo: "cx·1" }),
  };
  const instalados = o.instalados ?? ["claude", "codex"];
  const usos: { atual: AccountUsage[] } = { atual: o.usos ?? [] };
  const avisos: string[] = [];
  const eventos: Array<[string, unknown]> = [];
  const barramento = criarBarramento();
  for (const t of ["policy.changed", "decisor.pausado"]) barramento.assinar(t, (p) => eventos.push([t, p]));
  let aberturasCofre = 0;
  const cofre = async (): Promise<Cofre> => {
    aberturasCofre++;
    throw new Error("o cofre não deveria abrir neste teste");
  };
  const deps: DependenciasHarnessMain = {
    repos,
    contas: { listar: () => repos.conta.listar({ limite: 500 }).itens, obter: (id) => repos.conta.obter(id), ambienteDaConta: (c) => ({ CONFIG_DIR_DA_CONTA: `/contas/${c.provedor}` }) },
    provedores: { listar: async () => instalados.map((id) => ({ ferramenta: { id, instalado: true }, contas: [] })) as never },
    workspaces: { permissaoDe: () => o.permissao ?? "seguro" },
    limites: () => (o.semLimites === true ? null : { snapshot: () => ({ contas: usos.atual, geral: { pior: null, folga_media_pct: null, cobertura: { com_dado: 0, total: 0 }, em_alerta: 0, esgotadas: 0 } }) }),
    cofre,
    barramento,
    caminhosEquivalencia: o.caminhos ?? [join(__dirname, "..", "..", "resources", "harness", "equivalencia.json")],
    agora: () => T0,
    aviso: (m) => avisos.push(m),
    consentimento: criarRegistroConsentimento(),
    ...(o.rede === undefined ? {} : { rede: o.rede }),
  };
  const h = criarHarnessMain(deps);
  return { banco, repos, ws, contas, h, usos, avisos, eventos, dir, aberturasCofre: () => aberturasCofre, consentimento: deps.consentimento! };
}

describe("iniciar: semente, equivalência e retenção", () => {
  it("semeia os TaskTypes embutidos e a política global, uma vez; nunca sobrescreve o que o usuário editou", async () => {
    const m = montar();
    await m.h.iniciar();
    expect(m.repos.taskType.listar().map((t) => t.slug)).toEqual(expect.arrayContaining(["implementar", "auditar", "bug-fix", "geral"]));
    const globais = m.repos.politica.listar(null);
    expect(globais.length).toBeGreaterThanOrEqual(12);
    expect(globais.every((p) => p.atualizado_por === "semente" && p.fallback.length >= 1)).toBe(true);
    // auditar escolhe provedor diferente do implementar quando há ≥ 2 (D-21)
    const prov = (t: string) => globais.find((p) => p.task_type === t)?.executor.provider;
    expect(prov("auditar")).not.toBe(prov("implementar"));
    const editada = { ...(globais.find((p) => p.task_type === "docs") as PoliticaEntrada), executor: { provider: "codex", cli: "codex", model: null, effort: null, faixa: "rapido" as const } };
    await m.h.politicaGravar(editada, "usuario");
    await m.h.iniciar(); // idempotente
    expect(m.repos.politica.listar(null).find((p) => p.task_type === "docs")?.executor.provider).toBe("codex");
  });

  it("sem Claude instalado a semente usa o que existe", async () => {
    const m = montar({ instalados: ["codex"] });
    await m.h.iniciar();
    const provs = new Set(m.repos.politica.listar(null).flatMap((p) => [p.executor.provider, ...p.alternativas.map((a) => a.provider), ...p.fallback.map((f) => f.provider)]));
    expect([...provs]).toEqual(["codex"]);
  });

  it("carrega resources/harness/equivalencia.json; arquivo ausente ⇒ tabela mínima embutida com aviso (nunca lança)", async () => {
    const ok = montar();
    await ok.h.iniciar();
    expect((await ok.h.equivalenciaLer()).padrao.provedores["claude"]?.topo?.[0]?.modelo).toBe("opus");
    const sem = montar({ caminhos: ["/nao/existe/equivalencia.json"] });
    await sem.h.iniciar();
    expect(sem.avisos.join(" ")).toMatch(/equivalência/);
    expect((await sem.h.equivalenciaLer()).padrao.faixas).toEqual(["topo", "alto", "medio", "rapido"]);
  });

  it("caminhosDaEquivalencia: empacotado prefere <resources>/harness; dev prefere resources/ da raiz", () => {
    const emp = caminhosDaEquivalencia({ dirMain: "/app/dist/main", resourcesPath: "/App/Resources", empacotado: true });
    expect(emp[0]).toBe(join("/App/Resources", "harness", "equivalencia.json"));
    const dev = caminhosDaEquivalencia({ dirMain: "/repo/dist/main", resourcesPath: "/x", empacotado: false });
    expect(dev[0]).toBe(join("/repo", "resources", "harness", "equivalencia.json"));
  });

  it("override do usuário vence o arquivo, vale na rota e 'restaurar' apaga só o override", async () => {
    const m = montar();
    await m.h.iniciar();
    const antes = (await m.h.equivalenciaLer()).efetiva.provedores["claude"]?.rapido;
    const novo = await m.h.equivalenciaGravar({ claude: { rapido: [{ modelo: "haiku-x", esforco: null }] } });
    expect(novo.efetiva.provedores["claude"]?.rapido?.[0]?.modelo).toBe("haiku-x");
    expect(novo.diferencas).toEqual({ claude: { rapido: [{ modelo: "haiku-x", esforco: null }] } });
    expect(novo.padrao.provedores["claude"]?.rapido).toEqual(antes);
    await expect(m.h.equivalenciaGravar({ claude: { rapido: [{ modelo: "não pode", esforco: null }] } })).rejects.toBeInstanceOf(ErroHarness);
    expect((await m.h.equivalenciaRestaurar()).diferencas).toEqual({});
  });
});

describe("política (CRUD) e portas do MCP", () => {
  it("gravar executor de provedor indisponível ⇒ erro nominal e NADA gravado; política antiga resolve pelo fallback", async () => {
    const m = montar();
    await m.h.iniciar();
    const base = m.repos.politica.listar(null).find((p) => p.task_type === "bug-fix") as PoliticaEntrada;
    const antes = JSON.stringify(m.repos.politica.listar(null));
    const ruim = { ...base, executor: { provider: "gemini", cli: "gemini", model: null, effort: null, faixa: "medio" as const } };
    await expect(m.h.politicaGravar(ruim, "usuario")).rejects.toMatchObject({ codigo: "executor_disabled", campo: "executor.provider" });
    expect(JSON.stringify(m.repos.politica.listar(null))).toBe(antes);
    expect(m.eventos.filter(([t]) => t === "policy.changed")).toHaveLength(0);
  });

  it("esforço vira null com aviso (nenhuma CLI expõe níveis hoje) e emite policy.changed", async () => {
    const m = montar();
    await m.h.iniciar();
    const base = m.repos.politica.listar(null).find((p) => p.task_type === "bug-fix") as PoliticaEntrada;
    const p = await m.h.politicaGravar({ ...base, executor: { ...base.executor, effort: "alto" } }, "usuario");
    expect(p.executor.effort).toBeNull();
    expect(m.eventos.some(([t, e]) => t === "policy.changed" && (e as { task_type: string }).task_type === "bug-fix")).toBe(true);
  });

  it("harness_list só expõe provedores habilitados; definir grava override do WORKSPACE (mcp) e a global fica intacta", async () => {
    const m = montar({ instalados: ["claude", "codex"] });
    await m.h.iniciar();
    m.repos.conta.criar({ provedor: "gemini", rotulo: "g" }); // conta sem CLI instalada: não é viável
    const lista = await m.h.portaHarness.listar(m.ws.id, null);
    expect(lista.length).toBeGreaterThan(5);
    expect(lista.every((p) => ["claude", "codex"].includes(p.executor.provider))).toBe(true);
    expect((await m.h.portaHarness.listar(m.ws.id, "revisao")).every((p) => p.categoria === "revisao")).toBe(true);

    const globalAntes = JSON.stringify(m.repos.politica.listar(null));
    const r = await m.h.portaHarness.definir({ workspace_id: m.ws.id, pedido_por_pane_id: "pane_1", task_type: "bug-fix", provedor: "codex", cli: null, modelo: null, faixa: "alto", esforco: null, fallback: null });
    expect(r.ok).toBe(true);
    const doWs = m.repos.politica.listar(m.ws.id);
    expect(doWs).toHaveLength(1);
    expect(doWs[0]).toMatchObject({ task_type: "bug-fix", atualizado_por: "mcp", executor: { provider: "codex", cli: "codex" } });
    expect(JSON.stringify(m.repos.politica.listar(null))).toBe(globalAntes);
    const ruim = await m.h.portaHarness.definir({ workspace_id: m.ws.id, pedido_por_pane_id: "pane_1", task_type: "bug-fix", provedor: "gemini", cli: null, modelo: null, faixa: "alto", esforco: null, fallback: null });
    expect(ruim).toMatchObject({ ok: false, erro: "executor_disabled" });
    const tipoRuim = await m.h.portaHarness.definir({ workspace_id: m.ws.id, pedido_por_pane_id: "pane_1", task_type: "nao-existe", provedor: "codex", cli: null, modelo: null, faixa: "alto", esforco: null, fallback: null });
    expect(tipoRuim).toMatchObject({ ok: false, erro: "unknown_task_type" });
  });

  it("piloto_edita_politica lê a config do workspace a cada chamada (padrão: desligado)", async () => {
    const m = montar();
    expect(m.h.pilotoEditaPolitica(m.ws.id)).toBe(false);
    m.repos.harnessWorkspace.gravar({ ...m.repos.harnessWorkspace.obter(m.ws.id), piloto_edita_politica: true });
    expect(m.h.pilotoEditaPolitica(m.ws.id)).toBe(true);
    expect(await m.h.portaHarness.pilotoEditaPolitica(m.ws.id)).toBe(true);
    m.repos.harnessWorkspace.restaurar(m.ws.id);
    expect(m.h.pilotoEditaPolitica(m.ws.id)).toBe(false);
  });

  it("recomendar: não grava Decisão nem cria Pane; erro de rota vem nominal", async () => {
    const m = montar({ usos: [uso("x", "claude", [["five_hour", 10]])] });
    await m.h.iniciar();
    const r = await m.h.portaHarness.recomendar(m.ws.id, "corrigir o botão");
    expect(r.erro).toBeNull();
    expect(r.executor).not.toBeNull();
    expect(r.recibo.length).toBeGreaterThan(5);
    expect(m.repos.decisao.listar({}).itens).toHaveLength(0);
    // sem nenhum provedor viável (nenhuma CLI instalada) ⇒ no_capacity
    const vazio = montar({ instalados: [] });
    await vazio.h.iniciar();
    expect((await vazio.h.portaHarness.recomendar(vazio.ws.id, "algo")).erro).toBe("no_capacity");
  });

  it("decisions_list só devolve as do workspace do token", async () => {
    const m = montar();
    const outro = m.repos.workspace.criar({ nome: "outro", raiz: "/o" });
    const nova = (ws: string, escolhida: string) => ({
      proposito: "selecao_conta" as const, workspace_id: ws, mission_id: null, pane_id: null, tipo: "choice" as const, opcoes: [escolhida], probs: null, escolhida, confianca: 0.9,
      fonte: "regra" as const, escolha_regra: escolhida, divergiu: false, latencia_ms: null, custo_usd: null, custo_origem: "desconhecido" as const, decisor: null, resumo_enviado: null,
      resumo_hash: null, skills_aplicadas: false, recibo: `Recibo ${escolhida}`,
    });
    m.h.decisoes.registrar(nova(m.ws.id, "a"));
    m.h.decisoes.registrar(nova(outro.id, "b"));
    m.h.decisoes.registrar(nova(m.ws.id, "c"));
    const r = await m.h.portaHarness.decisoes({ workspace_id: m.ws.id, desde: null, proposito: null, limite: 10 });
    expect(r.decisoes.map((d) => d.escolhida).sort()).toEqual(["a", "c"]);
    expect(r.custo_usd).toBeNull(); // custo desconhecido NUNCA vira 0
    expect((await m.h.portaHarness.decisoes({ workspace_id: m.ws.id, desde: null, proposito: null, limite: 1 })).decisoes).toHaveLength(1);
  });
});

describe("headline_pick / headline_limits (porta de limites; delega a pickAccount)", () => {
  const pedido = (m: ReturnType<typeof montar>, extra: Partial<Parameters<typeof m.h.portaLimites.escolher>[0]> = {}) =>
    m.h.portaLimites.escolher({ workspace_id: m.ws.id, provedor: "claude", janela: "auto", estrategia: "expires_first", modelo: null, ...extra });

  it("folgas 5/30/12 com max_slack ⇒ a de folga 30; a mesma escolha vale em expires_first (as outras estão quentes)", async () => {
    const m = montar();
    const c3 = m.repos.conta.criar({ provedor: "claude", rotulo: "cl·3" });
    m.usos.atual = [uso(m.contas.cl1.id, "claude", [["five_hour", 95]]), uso(m.contas.cl2.id, "claude", [["five_hour", 70]]), uso(c3.id, "claude", [["five_hour", 88]])];
    const r = await pedido(m, { estrategia: "max_slack" });
    expect(r).toMatchObject({ conta_id: m.contas.cl2.id, folga_pct: 30 });
    expect((await pedido(m))?.conta_id).toBe(m.contas.cl2.id);
  });

  it("Codex 99/40 ⇒ gargalo five_hour, folga 1", async () => {
    const m = montar();
    m.usos.atual = [uso(m.contas.cx1.id, "codex", [["five_hour", 99], ["weekly", 40]])];
    expect(await pedido(m, { provedor: "codex" })).toMatchObject({ conta_id: m.contas.cx1.id, folga_pct: 1 });
  });

  it("nenhuma conta ok (esgotadas ou desabilitadas) ⇒ null; conta sem dado nunca vira folga", async () => {
    const m = montar();
    m.usos.atual = [uso(m.contas.cl1.id, "claude", [["five_hour", 100]]), uso(m.contas.cl2.id, "claude", [["five_hour", 100]])];
    expect(await pedido(m)).toBeNull();
    m.usos.atual = [];
    const semDado = await pedido(m);
    expect(semDado?.folga_pct).toBeNull();
    m.repos.conta.listar({ limite: 10 }).itens.filter((c) => c.provedor === "claude").forEach((c) => banco_desabilitar(m, c.id));
    expect(await pedido(m)).toBeNull();
  });

  it("headline_limits filtra por provedor e, sem o serviço de limites ligado, devolve vazio (nunca erro)", async () => {
    const m = montar();
    m.usos.atual = [uso(m.contas.cl1.id, "claude", [["five_hour", 10]]), uso(m.contas.cx1.id, "codex", [["five_hour", 20]])];
    expect((await m.h.portaLimites.limites("codex")).contas.map((c) => c.account_id)).toEqual([m.contas.cx1.id]);
    expect((await m.h.portaLimites.limites(null)).contas).toHaveLength(2);
    const sem = montar({ semLimites: true });
    expect(await sem.h.portaLimites.limites(null)).toMatchObject({ contas: [], geral: { cobertura: { com_dado: 0, total: 0 } } });
    expect((await sem.h.portaLimites.escolher({ workspace_id: sem.ws.id, provedor: "claude", janela: "auto", estrategia: "expires_first", modelo: null }))?.folga_pct).toBeNull();
  });
});

function banco_desabilitar(m: ReturnType<typeof montar>, contaId: string): void {
  m.banco.executar("UPDATE conta SET habilitada = 0 WHERE id = ?", [contaId]);
}

describe("rota de Pane novo: pane_spawn sem provedor e Missão Automático (T-09.16)", () => {
  const pedido = (ws: string, extra: Record<string, unknown> = {}) => ({ workspace_id: ws, mission_id: null, pedido_por_pane_id: "pane_p", papel: "executor" as const, agente_id: null, task_type: null, descricao: "corrigir o bug do botão de salvar", faixa: null, ...extra });
  const usosOk = [uso("x", "claude", [["five_hour", 10]])];

  it("classifica pela descrição (heurística), roteia, grava UMA Decisão de conta e devolve o id dela", async () => {
    const m = montar({ usos: usosOk });
    await m.h.iniciar();
    const t0 = performance.now();
    const r = await m.h.portaRota.rotear(pedido(m.ws.id));
    expect(performance.now() - t0).toBeLessThan(300); // P-03
    expect(r).toMatchObject({ ok: true, task_type: "bug-fix", provedor: expect.any(String), cli: expect.any(String) });
    if (!r.ok) throw new Error("sem rota");
    expect(r.recibo.length).toBeGreaterThan(5);
    const decisoes = m.repos.decisao.listar({}).itens.filter((d) => d.proposito === "selecao_conta");
    expect(decisoes).toHaveLength(1);
    expect(r.decisao_id).toBe(decisoes[0]?.id);
    // a descrição (prompt do usuário) nunca é gravada
    expect(JSON.stringify(m.repos.decisao.listar({}).itens)).not.toContain("botão de salvar");
  });

  it("task_type e faixa explícitos vencem a heurística", async () => {
    const m = montar({ usos: usosOk });
    await m.h.iniciar();
    const r = await m.h.portaRota.rotear(pedido(m.ws.id, { task_type: "docs", faixa: "topo" }));
    expect(r).toMatchObject({ ok: true, task_type: "docs", faixa: "topo" });
  });

  it("sem capacidade devolve o erro nominal (sem lançar); gravar liga a rota ao Pane", async () => {
    const vazio = montar({ instalados: [] });
    await vazio.h.iniciar();
    expect(await vazio.h.portaRota.rotear(pedido(vazio.ws.id))).toMatchObject({ ok: false, erro: "no_capacity" });

    const m = montar({ usos: usosOk });
    await m.h.iniciar();
    const r = await m.h.portaRota.rotear(pedido(m.ws.id));
    if (!r.ok) throw new Error("sem rota");
    const { ok: _ok, ...rota } = r;
    void _ok;
    const pane = m.repos.pane.criar({ workspace_id: m.ws.id, tipo: "cli", cli: r.cli, papel: "executor" });
    await m.h.portaRota.gravar(pane.id, rota, "squad.membro");
    expect(m.repos.paneRota.obter(pane.id)).toMatchObject({ task_type: "bug-fix", decisao_id: r.decisao_id, saltos: 0, perfil: { agente_id: "squad.membro", provider: r.provedor, faixa: r.faixa } });
  });

  it("Fase 14: rota do harness NÃO sobrescreve a rota de um Pane cujo perfil já é do agente (o agent_id sobrepõe a rota)", async () => {
    const m = montar({ usos: usosOk });
    await m.h.iniciar();
    const r = await m.h.portaRota.rotear(pedido(m.ws.id));
    if (!r.ok) throw new Error("sem rota");
    const { ok: _ok, ...rota } = r;
    void _ok;
    const pane = m.repos.pane.criar({ workspace_id: m.ws.id, tipo: "cli", cli: "claude", papel: "executor" });
    // o preparo do agente (squads) já gravou o perfil que de fato roda
    m.repos.paneRota.gravar({ pane_id: pane.id, perfil: { agente_id: "squad.membro", provider: "codex", cli: "codex", modelo: "gpt-5", esforco: "medium", faixa: "alto" }, saltos: 0 });
    await m.h.portaRota.gravar(pane.id, rota, "squad.membro");
    expect(m.repos.paneRota.obter(pane.id)?.perfil).toMatchObject({ agente_id: "squad.membro", cli: "codex", modelo: "gpt-5" });
    // outro agente (ou sem agente) continua gravando normalmente
    const outro = m.repos.pane.criar({ workspace_id: m.ws.id, tipo: "cli", cli: r.cli, papel: "executor" });
    await m.h.portaRota.gravar(outro.id, rota, null);
    expect(m.repos.paneRota.obter(outro.id)?.perfil.provider).toBe(r.provedor);
  });

  it("nível vem de harness_workspace (padrão 4) e muda com a configuração", async () => {
    const m = montar();
    expect(await m.h.portaRota.nivel(m.ws.id)).toBe(m.h.configLer(m.ws.id).nivel);
    m.h.configGravar({ ...m.h.configLer(m.ws.id), nivel: 2 });
    expect(await m.h.portaRota.nivel(m.ws.id)).toBe(2);
  });

  it("Missão Automático: o gesto da origem escolhe o task_type e a Decisão nasce com origem do método", async () => {
    const m = montar({ usos: usosOk });
    await m.h.iniciar();
    const feature = await m.h.resolverCliAutomatico({ workspace_id: m.ws.id, origem: "feature", papel: "piloto", pedido: "cobrança via pix" });
    expect(feature.rota.task_type).toBe("planejar");
    expect(feature.cli).toBe(feature.rota.cli);
    const oc = await m.h.resolverCliAutomatico({ workspace_id: m.ws.id, origem: "ocorrencia", papel: "piloto", pedido: "frete errado" });
    expect(oc.rota.task_type).toBe("bug-fix");
    expect((await m.h.resolverCliAutomatico({ workspace_id: m.ws.id, origem: "livre", papel: "piloto", pedido: "" })).rota.task_type).toBe("geral");
    expect(m.repos.decisao.listar({}).itens.filter((d) => d.proposito === "selecao_conta")).toHaveLength(3);
  });

  it("Missão Automático sem capacidade: ErroHarness nominal", async () => {
    const vazio = montar({ instalados: [] });
    await vazio.h.iniciar();
    await expect(vazio.h.resolverCliAutomatico({ workspace_id: vazio.ws.id, origem: "feature", papel: "piloto", pedido: "x" })).rejects.toMatchObject({ codigo: "no_capacity" });
  });

  it("a tabela de equivalência efetiva é a mesma que o harness usa", async () => {
    const m = montar();
    await m.h.iniciar();
    expect(m.h.equivalenciaEfetiva().provedores["claude"]).toBeDefined();
  });
});

describe("decisor externo (desligado por padrão)", () => {
  const entrada = (extra: Partial<ConfigDecisorEntrada> = {}): ConfigDecisorEntrada => ({ ...configDecisorPadrao(), modo: "openai_compat", formato: "openai_chat", endpoint: "https://decisor.exemplo.test/v1/chat", modelo: "m-1", chave_ref: "CHAVE_DECISOR", usar_para: { task_type: true, modelo_esforco: false, intencao: true }, consentimento: null, ...extra });

  it("instalação nova: desligado, sem consentimento; classificarIntencao NÃO chama a rede (CT-9.04)", async () => {
    let chamadas = 0;
    const rede: ClienteRede = { requisitar: async () => ((chamadas++, { status: 200, texto: () => "{}" }) as never), stream: async () => ((chamadas++, {}) as never) };
    const m = montar({ rede });
    await m.h.iniciar();
    expect(m.h.decisorLer()).toMatchObject({ habilitado: false, consentimento: null, usar_para: { task_type: false, modelo_esforco: false, intencao: false } });
    const r = await m.h.classificarIntencao("corrigir o botão de salvar que travou", { workspace_id: m.ws.id });
    expect(r.fonte).toBe("regra");
    expect(chamadas).toBe(0);
    expect(m.aberturasCofre()).toBe(0);
  });

  it("ligar sem consentimento é erro; com consentimento grava `em`; trocar host/modo exige novo consentimento; desligar apaga", async () => {
    const m = montar();
    expect(() => m.h.decisorGravar(entrada({ habilitado: true }))).toThrow(/sem_consentimento/);
    expect(m.h.decisorLer().habilitado).toBe(false);
    const ligado = m.h.decisorGravar(entrada({ habilitado: true, consentimento: { host: "decisor.exemplo.test", modo: "openai_compat" } }));
    expect(ligado.habilitado).toBe(true);
    expect(ligado.consentimento).toMatchObject({ host: "decisor.exemplo.test", modo: "openai_compat" });
    expect(typeof ligado.consentimento?.em).toBe("string");
    // outro host com o consentimento do antigo: recusado
    expect(() => m.h.decisorGravar(entrada({ habilitado: true, endpoint: "https://outro.exemplo.test/x", consentimento: { host: "decisor.exemplo.test", modo: "openai_compat" } }))).toThrow(/sem_consentimento/);
    expect(m.h.decisorLer().endpoint).toBe("https://decisor.exemplo.test/v1/chat");
    const desligado = m.h.decisorGravar(entrada({ habilitado: false }));
    expect(desligado).toMatchObject({ habilitado: false, consentimento: null });
  });

  it("testar: sem consentimento nem chama a rede; com consentimento faz UMA chamada e a chave de teste nunca é gravada nem devolvida", async () => {
    const chamadas: Array<{ host: string; auth: string | undefined }> = [];
    const rede: ClienteRede = {
      requisitar: async (p) => {
        chamadas.push({ host: p.host, auth: (p.cabecalhos as Record<string, string> | undefined)?.["Authorization"] });
        return { status: 200, texto: () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ probs: { sim: 0.9, nao: 0.1 } }) } }], usage: { cost: 0.0001 } }) } as never;
      },
      stream: async () => {
        throw new Error("sem stream");
      },
    };
    const m = montar({ rede });
    expect(await m.h.decisorTestar(SENTINELA)).toMatchObject({ ok: false, motivo: "configuracao_incompleta" });
    m.h.decisorGravar(entrada());
    expect(await m.h.decisorTestar(SENTINELA)).toMatchObject({ ok: false, motivo: "sem_consentimento" });
    expect(chamadas).toHaveLength(0);
    m.h.decisorGravar(entrada({ habilitado: true, consentimento: { host: "decisor.exemplo.test", modo: "openai_compat" } }));
    const r = await m.h.decisorTestar(SENTINELA);
    expect(r.ok).toBe(true);
    expect(chamadas).toEqual([{ host: "decisor.exemplo.test", auth: `Bearer ${SENTINELA}` }]);
    expect(JSON.stringify(r)).not.toContain(SENTINELA);
    expect(JSON.stringify(m.repos.config.listar())).not.toContain(SENTINELA);
    expect(JSON.stringify(m.h.decisorLer())).not.toContain(SENTINELA);
    expect(m.aberturasCofre()).toBe(0); // a chave de teste veio no clique: o cofre não foi tocado
  });
});

describe("resolver perfil (Fases 14 e 16) e intenção", () => {
  it("(skill, etapa) → rota sem criar Pane; avaliador exclui o provedor do implementador", async () => {
    const m = montar({ usos: [uso("a", "claude", [["five_hour", 10]]), uso("b", "codex", [["five_hour", 10]])] });
    await m.h.iniciar();
    const impl = await m.h.resolverPerfil({ skill: "sprintx", etapa: "F6", ctx: { workspace_id: m.ws.id, papel: "executor", mission_id: null } });
    const aud = await m.h.resolverPerfil({ skill: "sprintx", etapa: "F5", ctx: { workspace_id: m.ws.id, papel: "revisor", mission_id: null, implementador_provedor: impl.executor.provider } });
    expect(impl.task_type).toBe("implementar");
    expect(aud.task_type).toBe("auditar");
    expect(aud.executor.provider).not.toBe(impl.executor.provider);
  });

  it("{perfil, ctx}: perfil `topo` com a conta estourada → topo de OUTRO provedor; perfil `rapido` não sobe de faixa", async () => {
    const m = montar();
    await m.h.iniciar();
    m.usos.atual = m.repos.conta.listar({ limite: 50 }).itens.map((c) => (c.provedor === "claude" ? uso(c.id, "claude", [["five_hour", 100]]) : uso(c.id, c.provedor, [["five_hour", 10]])));
    const topo = await m.h.resolverPerfil({ perfil: { agente_id: null, provider: "claude", cli: "claude", modelo: null, esforco: null, faixa: "topo" }, ctx: { workspace_id: m.ws.id, papel: "executor", mission_id: null } });
    expect(topo.executor.provider).toBe("codex");
    expect(topo.executor.faixa).toBe("topo");
    const rapido = await m.h.resolverPerfil({ perfil: { agente_id: null, provider: "codex", cli: "codex", modelo: null, esforco: null, faixa: "rapido" }, ctx: { workspace_id: m.ws.id, papel: "executor", mission_id: null } });
    expect(rapido.executor.faixa).toBe("rapido");
    expect(m.repos.decisao.listar({}).itens).toHaveLength(0); // só leitura
  });

  it("a PortaResolverPerfil da Fase 14 devolve conta, modelo, cli e o ambiente da conta (config dir; nunca segredo)", async () => {
    const m = montar({ usos: [] });
    await m.h.iniciar();
    m.usos.atual = m.repos.conta.listar({ limite: 50 }).itens.map((c) => uso(c.id, c.provedor, [["five_hour", 10]]));
    const r = await m.h.resolvedor.resolverPerfil({ agente_id: "sq.m", cli: "claude", modelo: null, esforco: null, faixa: "alto", conta_preferida: null, permissao: null }, { workspace_id: m.ws.id, papel: "executor", mission_id: null } as never);
    expect(r.cli).toBe("claude");
    expect(r.ambiente).toEqual({ CONFIG_DIR_DA_CONTA: "/contas/claude" });
    expect(r.conta).not.toBeNull();
  });
});

describe("complementos de lançamento de Pane (vaga única)", () => {
  const entrada = (ws: string): EntradaPreparoDePane => ({ workspace: { id: ws } }) as never;
  function vaga() {
    let atual: ((e: EntradaPreparoDePane) => Promise<PreparoDaSessao | null>) | null = null;
    return { porta: { definirComplemento: (fn: typeof atual) => void (atual = fn) }, rodar: (e: EntradaPreparoDePane) => atual?.(e) ?? Promise.resolve(null), instalado: () => atual !== null };
  }

  it("soma argumentos e ambiente de limites e cofre; um que falha não impede o outro nem o Pane", async () => {
    const v = vaga();
    const c = combinarComplementos(v.porta);
    expect(v.instalado()).toBe(false);
    c.vagaDeLimites.definirComplemento(async () => ({ argumentos: ["--settings", "x"], ambiente: { A: "1" } }));
    c.definirCofre(async () => ({ argumentos: [], ambiente: { B: "2" } }));
    expect(await v.rodar(entrada("ws"))).toEqual({ argumentos: ["--settings", "x"], ambiente: { A: "1", B: "2" } });
    c.definirCofre(async () => {
      throw new Error("boom");
    });
    expect(await v.rodar(entrada("ws"))).toEqual({ argumentos: ["--settings", "x"], ambiente: { A: "1" } });
    c.vagaDeLimites.definirComplemento(null);
    expect(await v.rodar(entrada("ws"))).toBeNull();
    c.encerrar();
    expect(v.instalado()).toBe(false);
  });

  it("cofre: sem opt-in e sem arquivo o cofre NEM abre; com opt-in só entra o que o cofre devolve (não sensível); scrubber é ligado", async () => {
    const m = montar();
    let aberturas = 0;
    const ligado: Array<((t: string) => string) | null> = [];
    const fake = { prepararScrubber: async () => undefined, scrubSincrono: (t: string) => t.replaceAll("VALOR-SECRETO", "«cofre:X»"), ambienteDoPane: async (_ws: string | null, injetar: boolean) => (injetar ? { REGIAO: "sa-east-1" } : {}) } as unknown as Cofre;
    const comp = (arquivo: boolean) => criarComplementoDoCofre({ repos: m.repos, cofre: async () => ((aberturas++, fake)), existeArquivo: () => arquivo, ligarScrub: (s) => ligado.push(s) });
    expect(await comp(false)({ workspace: m.ws } as never)).toBeNull();
    expect(aberturas).toBe(0);
    // arquivo existe: só liga o scrubber (nada de variável sem opt-in)
    expect(await comp(true)({ workspace: m.ws } as never)).toBeNull();
    expect(aberturas).toBe(1);
    expect(ligado[0]?.("a VALOR-SECRETO b")).toBe("a «cofre:X» b");
    m.repos.harnessWorkspace.gravar({ ...m.repos.harnessWorkspace.obter(m.ws.id), injetar_cofre_no_env: true });
    expect(await comp(false)({ workspace: m.ws } as never)).toEqual({ argumentos: [], ambiente: { REGIAO: "sa-east-1" } });
  });
});

describe("IPC harness:* (manipuladores)", () => {
  function ipc(m: ReturnType<typeof montar>) {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
    const logs: string[] = [];
    const registro = criarRegistroIpc({ ipcMain, autorizar: () => true, log: (l) => logs.push(l), logarPayload: true });
    registrarIpcHarness({ registro, harness: m.h });
    const chamar = (canal: string, payload?: unknown): Promise<any> => Promise.resolve((handlers.get(canal) as (e: unknown, ...a: unknown[]) => unknown)({}, payload));
    return { handlers, chamar, logs };
  }

  it("registra exatamente os canais desta onda (trocas e OpenRouter ficam de fora)", () => {
    const { handlers } = ipc(montar());
    expect([...handlers.keys()].sort()).toEqual([...CANAIS_HARNESS_ONDA_5].sort());
    for (const fora of ["harness:trocas_listar", "harness:troca_decidir", "harness:mover_pane"]) expect(handlers.has(fora)).toBe(false);
  });

  it("config, tipos, política e equivalência ponta a ponta; erros nominais chegam com o código", async () => {
    const m = montar();
    await m.h.iniciar();
    const { chamar } = ipc(m);
    const lida = await chamar("harness:config_ler", { workspace_id: m.ws.id });
    expect(lida).toMatchObject({ nivel: 4, limiar_troca_pct: 85, piloto_edita_politica: false, injetar_cofre_no_env: false });
    const { atualizado_em: _carimbo, ...cfg } = lida;
    void _carimbo;
    const gravada = await chamar("harness:config_gravar", { ...cfg, margem_troca_pontos: 15 });
    expect(gravada.margem_troca_pontos).toBe(15);
    await expect(chamar("harness:config_gravar", { ...cfg, limiar_troca_pct: 99, limiar_esgotamento_pct: 90 })).rejects.toThrow();
    const novoTipo = await chamar("harness:task_types_gravar", { slug: "revisao-lgpd", categoria: "revisao", rotulo: "Revisão LGPD", descricao: null });
    expect(novoTipo).toMatchObject({ slug: "revisao-lgpd", embutido: false });
    expect((await chamar("harness:task_types_listar", {})).map((t: { slug: string }) => t.slug)).toContain("revisao-lgpd");
    expect(await chamar("harness:task_types_apagar", { slug: "revisao-lgpd" })).toBe(true);
    await expect(chamar("harness:task_types_apagar", { slug: "implementar" })).rejects.toThrow(/embutido/);
    const efetivas = await chamar("harness:politica_listar", { workspace_id: m.ws.id });
    expect(efetivas.length).toBeGreaterThan(5);
    const { id: _i, atualizado_por: _p, atualizado_em: _e, ...semMeta } = efetivas[0];
    void _i; void _p; void _e;
    const ruim = { ...semMeta, workspace_id: null, executor: { provider: "gemini", cli: "gemini", model: null, effort: null, faixa: "alto" } };
    await expect(chamar("harness:politica_gravar", ruim)).rejects.toThrow(/executor_disabled/);
    const restaurada = await chamar("harness:politica_restaurar_semente", { workspace_id: null });
    expect(restaurada.length).toBe(efetivas.length);
    const eq = await chamar("harness:equivalencia_gravar", { provedores: { codex: { medio: [{ modelo: "gpt-x", esforco: null }] } } });
    expect(eq.diferencas).toEqual({ codex: { medio: [{ modelo: "gpt-x", esforco: null }] } });
    expect((await chamar("harness:equivalencia_restaurar", {})).diferencas).toEqual({});
  });

  it("recomendar devolve ResultadoDeRota sem criar Pane; sem capacidade lança erro nominal", async () => {
    const m = montar({ usos: [] });
    await m.h.iniciar();
    m.usos.atual = m.repos.conta.listar({ limite: 50 }).itens.map((c) => uso(c.id, c.provedor, [["five_hour", 20]]));
    const { chamar } = ipc(m);
    const r = await chamar("harness:recomendar", { workspace_id: m.ws.id, descricao: "corrigir bug no login" });
    expect(r).toMatchObject({ skills_aplicadas: false });
    expect(typeof r.recibo).toBe("string");
    expect(r.executor.provider).toMatch(/claude|codex/);
    const vazio = montar({ instalados: [] });
    await vazio.h.iniciar();
    await expect(ipc(vazio).chamar("harness:recomendar", { workspace_id: vazio.ws.id, descricao: "algo" })).rejects.toThrow(/no_capacity/);
  });

  it("decisor_testar é canal sensível: a chave nunca aparece no log do registro nem na resposta; decisor_ler não traz chave", async () => {
    const m = montar();
    const { chamar, logs } = ipc(m);
    const r = await chamar("harness:decisor_testar", { chave: SENTINELA });
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain(SENTINELA);
    expect(logs.join("\n")).not.toContain(SENTINELA);
    const ler = await chamar("harness:decisor_ler", {});
    expect(Object.keys(ler)).not.toContain("chave");
    expect(JSON.stringify(ler)).not.toContain(SENTINELA);
    await expect(chamar("harness:decisor_gravar", { ...ler, habilitado: true, consentimento: null })).rejects.toThrow();
  });

  it("intenção e perfil pelo IPC", async () => {
    const m = montar({ usos: [] });
    await m.h.iniciar();
    m.usos.atual = m.repos.conta.listar({ limite: 50 }).itens.map((c) => uso(c.id, c.provedor, [["five_hour", 20]]));
    const { chamar } = ipc(m);
    const i = await chamar("harness:classificar_intencao", { texto: "quero uma nova funcionalidade de relatórios", contexto: { workspace_id: m.ws.id } });
    expect(["regra", "fallback"]).toContain(i.fonte);
    expect(typeof i.intencao).toBe("string");
    const p = await chamar("harness:resolver_perfil", { skill: "runx", etapa: "E3", ctx: { workspace_id: m.ws.id, papel: "executor", mission_id: null } });
    expect(p.task_type).toBe("bug-fix");
  });
});
