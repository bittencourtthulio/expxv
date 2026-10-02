// Painel livre que orquestra: abrir, ligar e desligar com `resume` (D-420 a D-427), sobre a orquestração real e sessões falsas.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarTmp, detectorFalso, ferramenta, limpar, novoBanco, sessoesFalsas } from "../../tests/fixtures/dominio/ambiente";
import { criarServicoContas } from "../nucleo/provedores/contas";
import { criarServicoProvedores } from "../nucleo/provedores/servico";
import { criarServicoMissoes } from "../nucleo/missoes/servico";
import { criarServicoPanes } from "../nucleo/missoes/panes";
import { criarBarramento } from "./barramento";
import { criarOrquestracao, type Orquestracao } from "./orquestracao";
import { criarPainelLivre, ErroPainelLivre, sanearErroDePainelLivre } from "./painel-livre";

afterEach(limpar);
const RAIZ_REPO = join(__dirname, "..", "..");
const ATIVOS = {
  pastaDePrompts: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "prompts"),
  scriptGancho: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "hooks", "scripts", "gancho.mjs"),
  caminhoWorker: "/nao-usado/mcp-worker.js",
};
const abertas: Orquestracao[] = [];
afterEach(async () => { while (abertas.length) await abertas.pop()?.encerrar(); });

function montar(conversas: Record<string, string> = {}) {
  const { banco, repos } = novoBanco();
  const dados = criarTmp("pl-dados-");
  const raiz = criarTmp("pl-ws-");
  const ws = repos.workspace.criar({ nome: "ws", raiz });
  const sessoes = sessoesFalsas();
  const detector = detectorFalso([ferramenta("claude"), ferramenta("codex"), ferramenta("opencode"), ferramenta("gemini"), ferramenta("grok"), ferramenta("terminal")]);
  const contas = criarServicoContas({ banco, repos, pastaDeDados: dados, casa: dados, env: {} });
  const workspaces = { exigir: (id: string) => repos.workspace.exigir(id) };
  const barramento = criarBarramento();
  const panes = criarServicoPanes({ banco, repos, workspaces, sessoes: async () => sessoes as never, detector, contas });
  const missoes = criarServicoMissoes({ banco, repos, workspaces, panes });
  const provedores = criarServicoProvedores({ detector, contas });
  const orq = criarOrquestracao({
    dominio: { repos, workspaces, provedores, missoes, panes }, banco, barramento, sessoes: async () => sessoes as never, dirApp: dados,
    executavelNode: "/app/Electron", electronComoNode: true, ativos: ATIVOS, atrasoFechamentoMs: 10, intervaloSegurancaMs: 50,
    iniciarServidor: () => Promise.resolve({ url: "http://127.0.0.1:1/mcp", urlGanchos: "http://127.0.0.1:1/hooks", porta: 1, portaAnterior: null, portaReutilizada: true, emitirToken: (p) => `token-${p.pane_id}`, revogar: () => undefined, fechar: async () => undefined }),
  });
  abertas.push(orq);
  const ferramentaDa = new Map<string, string>();
  const painel = criarPainelLivre({
    orquestracao: () => orq,
    dominio: { repos, workspaces, panes },
    sessoes: async () => ({
      obter: (id) => { const s = sessoes.sessoes.get(id); return s === undefined ? undefined : { ferramenta_id: ferramentaDa.get(id) ?? String((s.pedido["ferramenta_id"] as string | undefined) ?? "claude"), estado: s.estado, cwd: s.cwd }; },
      encerrar: (id) => sessoes.encerrar(id),
      descartar: (id) => sessoes.descartar(id),
    }),
    conversas: { listar: () => conversas },
    permissaoDoWorkspace: () => "seguro",
    esperaMs: 0,
  });
  /** terminal comum (sem Pane), como `terminais:abrir` faz no renderer */
  const abrirComum = (cli: string, cwd = raiz): string => {
    const r = sessoes.abrir({ ferramenta_id: cli, argumentos: [] }, { cwd });
    ferramentaDa.set(r.sessao_id, cli);
    return r.sessao_id;
  };
  return { orq, repos, raiz, ws, sessoes, painel, panes, abrirComum, missoes, ferramentaDa };
}
const args = (m: ReturnType<typeof montar>, sessao: string): string[] => m.sessoes.sessoes.get(sessao)?.pedido["argumentos"] as string[];

describe("preferência do workspace", () => {
  it("padrão DESLIGADO; grava e lê; workspace desconhecido falha", async () => {
    const m = montar();
    await m.orq.iniciar();
    expect(m.painel.preferencia({ workspace_id: m.ws.id })).toEqual({ workspace_id: m.ws.id, ativa: false, orquestrador_edita: false, fechar_workers: true });
    expect(m.painel.preferencia({ workspace_id: m.ws.id, ativa: true }).ativa).toBe(true);
    expect(m.painel.preferencia({ workspace_id: m.ws.id }).ativa).toBe(true);
    expect(() => m.painel.preferencia({ workspace_id: "ws_naoexiste00000000" })).toThrow();
  });
});

describe("abrir", () => {
  it("sem a preferência não cria Missão nem Pane (erro nominal)", async () => {
    const m = montar();
    await m.orq.iniciar();
    await expect(m.painel.abrir({ workspace_id: m.ws.id, ferramenta_id: "claude", orquestrar: true })).rejects.toMatchObject({ codigo: "preferencia_desligada" });
    expect(m.repos.mission.listarPorWorkspace(m.ws.id).itens).toHaveLength(0);
    expect(m.sessoes.sessoes.size).toBe(0);
  });

  it("com a preferência: Pane piloto da Missão avulsa; sem orquestrar: Pane livre comum; CLI sem MCP é recusada antes de criar a Missão", async () => {
    const m = montar();
    await m.orq.iniciar();
    m.painel.preferencia({ workspace_id: m.ws.id, ativa: true });
    const r = await m.painel.abrir({ workspace_id: m.ws.id, ferramenta_id: "codex", orquestrar: true });
    expect(r).toMatchObject({ orquestrando: true });
    expect(m.repos.mission.exigir(r.missao_id as string)).toMatchObject({ modo: "agentico", estado: "executando", piloto_pane_id: r.pane_id });
    const livre = await m.painel.abrir({ workspace_id: m.ws.id, ferramenta_id: "claude", orquestrar: false });
    expect(livre).toMatchObject({ orquestrando: false, missao_id: null });
    await expect(m.painel.abrir({ workspace_id: m.ws.id, ferramenta_id: "gemini", orquestrar: true })).rejects.toMatchObject({ codigo: "cli_sem_mcp" });
    expect(m.repos.mission.listarPorWorkspace(m.ws.id).itens).toHaveLength(1);
  });
});

describe("opt-out \"orquestrador pode editar\" e ponte do Grok (D-512, D-514)", () => {
  it("fechar_workers (D-520): padrão LIGADO; grava e lê por workspace, sem mexer nas outras preferências", async () => {
    const m = montar();
    await m.orq.iniciar();
    expect(m.painel.preferencia({ workspace_id: m.ws.id }).fechar_workers).toBe(true);
    expect(m.painel.preferencia({ workspace_id: m.ws.id, fechar_workers: false })).toMatchObject({ ativa: false, orquestrador_edita: false, fechar_workers: false });
    expect(m.painel.preferencia({ workspace_id: m.ws.id }).fechar_workers).toBe(false);
    expect(m.painel.preferencia({ workspace_id: m.ws.id, ativa: true }).fechar_workers).toBe(false);
    expect(m.painel.preferencia({ workspace_id: m.ws.id, fechar_workers: true }).fechar_workers).toBe(true);
  });

  it("orquestrador_edita: padrão desligado; grava e lê por workspace", async () => {
    const m = montar();
    await m.orq.iniciar();
    expect(m.painel.preferencia({ workspace_id: m.ws.id }).orquestrador_edita).toBe(false);
    expect(m.painel.preferencia({ workspace_id: m.ws.id, orquestrador_edita: true })).toMatchObject({ ativa: false, orquestrador_edita: true });
    expect(m.painel.preferencia({ workspace_id: m.ws.id }).orquestrador_edita).toBe(true);
  });

  it("Grok sem a ponte: erro nominal ponte_necessaria, sem Missão nem sessão; com a ponte autorizada abre como orquestrador e desligar remove o arquivo", async () => {
    const m = montar();
    await m.orq.iniciar();
    m.painel.preferencia({ workspace_id: m.ws.id, ativa: true });
    await expect(m.painel.abrir({ workspace_id: m.ws.id, ferramenta_id: "grok", orquestrar: true })).rejects.toMatchObject({ codigo: "ponte_necessaria" });
    expect(m.repos.mission.listarPorWorkspace(m.ws.id).itens).toHaveLength(0);
    expect(m.sessoes.sessoes.size).toBe(0);
    expect(m.painel.ponteGrok({ workspace_id: m.ws.id, acao: "estado" })).toMatchObject({ estado: "ausente", arquivo: ".grok/config.toml" });
    expect(m.painel.ponteGrok({ workspace_id: m.ws.id, acao: "aplicar" }).estado).toBe("ativa");
    const r = await m.painel.abrir({ workspace_id: m.ws.id, ferramenta_id: "grok", orquestrar: true });
    expect(r.orquestrando).toBe(true);
    expect(args(m, r.sessao_id)).toEqual(expect.arrayContaining(["--rules", "--no-subagents"]));
    await m.orq.avulso.encerrarMissao(r.missao_id as string, "teste");
    expect(m.painel.ponteGrok({ workspace_id: m.ws.id, acao: "estado" }).estado).toBe("ausente");
  });

  it("ponte bloqueada (já existe .grok/config.toml de outra pessoa): aplicar não sobrescreve e o Grok continua sem orquestrar", async () => {
    const m = montar();
    await m.orq.iniciar();
    mkdirSync(join(m.raiz, ".grok"));
    writeFileSync(join(m.raiz, ".grok", "config.toml"), "[ui]\ntheme = \"x\"\n");
    const r = m.painel.ponteGrok({ workspace_id: m.ws.id, acao: "aplicar" });
    expect(r.estado).toBe("bloqueada");
    expect(readFileSync(join(m.raiz, ".grok", "config.toml"), "utf8")).toContain("theme");
    m.painel.preferencia({ workspace_id: m.ws.id, ativa: true });
    await expect(m.painel.abrir({ workspace_id: m.ws.id, ferramenta_id: "grok", orquestrar: true })).rejects.toMatchObject({ codigo: "ponte_necessaria" });
  });
});

describe("orquestrar (ligar/desligar um painel já aberto)", () => {
  it("ligar: encerra a sessão comum, reabre como piloto avulso retomando a conversa (resume) na mesma pasta", async () => {
    const m = montar({ sessao_1: "conv-abc123" });
    await m.orq.iniciar();
    m.painel.preferencia({ workspace_id: m.ws.id, ativa: true });
    const antiga = m.abrirComum("claude");
    expect(antiga).toBe("sessao_1");
    const r = await m.painel.orquestrar({ workspace_id: m.ws.id, sessao_id: antiga, ligar: true });
    expect(r).toMatchObject({ orquestrando: true, retomado: true, aviso: null });
    expect(r.sessao_id).not.toBe(antiga);
    expect(m.sessoes.sessoes.has(antiga)).toBe(false);
    expect(args(m, r.sessao_id).slice(0, 2)).toEqual(["--resume", "conv-abc123"]);
    expect(m.repos.pane.exigir(r.pane_id as string)).toMatchObject({ eh_piloto: true, mission_id: r.missao_id });
  });

  it("CLI sem retomada: abre sessão nova e AVISA; sem preferência recusa antes de encerrar a sessão", async () => {
    const m = montar({ sessao_1: "conv-1" });
    await m.orq.iniciar();
    const comum = m.abrirComum("opencode");
    await expect(m.painel.orquestrar({ workspace_id: m.ws.id, sessao_id: comum, ligar: true })).rejects.toMatchObject({ codigo: "preferencia_desligada" });
    expect(m.sessoes.sessoes.get(comum)?.estado).toBe("executando");
    m.painel.preferencia({ workspace_id: m.ws.id, ativa: true });
    const r = await m.painel.orquestrar({ workspace_id: m.ws.id, sessao_id: comum, ligar: true });
    expect(r.retomado).toBe(false);
    expect(r.aviso).toMatch(/não retomou/);
  });

  it("desligar: os workers e a Missão avulsa saem, o painel volta como Pane livre retomando a conversa", async () => {
    const m = montar();
    await m.orq.iniciar();
    m.painel.preferencia({ workspace_id: m.ws.id, ativa: true });
    const ligado = await m.painel.abrir({ workspace_id: m.ws.id, ferramenta_id: "claude", orquestrar: true });
    const worker = await m.orq.portas.panes.spawn({
      workspace_id: m.ws.id, mission_id: ligado.missao_id, pedido_por_pane_id: ligado.pane_id, provedor: "claude", modelo: null, conta_id: null,
      papel: "explorador", agente_id: null, briefing_path: null, cwd: null, prompt: "pesquisa",
    });
    const conversas = { [ligado.sessao_id]: "conv-xyz999" };
    // o armazém de conversas é lido a cada chamada: simula a CLI ter gravado o id
    Object.assign(montar, {});
    const m2 = { ...m, painel: criarPainelLivre({ orquestracao: () => m.orq, dominio: { repos: m.repos, workspaces: { exigir: (id: string) => m.repos.workspace.exigir(id) }, panes: m.panes }, sessoes: async () => ({ obter: (id) => { const s = m.sessoes.sessoes.get(id); return s === undefined ? undefined : { ferramenta_id: "claude", estado: s.estado, cwd: s.cwd }; }, encerrar: (id) => m.sessoes.encerrar(id), descartar: (id) => m.sessoes.descartar(id) }), conversas: { listar: () => conversas }, permissaoDoWorkspace: () => "seguro", esperaMs: 0 }) };
    const r = await m2.painel.orquestrar({ workspace_id: m.ws.id, sessao_id: ligado.sessao_id, ligar: false });
    expect(r).toMatchObject({ orquestrando: false, missao_id: null, retomado: true });
    expect(m.repos.pane.exigir(worker.pane_id).estado).toBe("encerrado");
    expect(m.repos.mission.exigir(ligado.missao_id as string).estado).toBe("abortada");
    expect(args(m, r.sessao_id).slice(0, 2)).toEqual(["--resume", "conv-xyz999"]);
    expect(m.repos.pane.exigir(r.pane_id as string).mission_id).toBeNull();
  });

  it("já no estado pedido: devolve a MESMA sessão sem reabrir; Pane de Missão real e terminal comum nunca são tocados", async () => {
    const m = montar();
    await m.orq.iniciar();
    m.painel.preferencia({ workspace_id: m.ws.id, ativa: true });
    const ligado = await m.painel.abrir({ workspace_id: m.ws.id, ferramenta_id: "claude", orquestrar: true });
    expect(await m.painel.orquestrar({ workspace_id: m.ws.id, sessao_id: ligado.sessao_id, ligar: true })).toMatchObject({ sessao_id: ligado.sessao_id, orquestrando: true });
    const comum = m.abrirComum("claude");
    expect(await m.painel.orquestrar({ workspace_id: m.ws.id, sessao_id: comum, ligar: false })).toMatchObject({ sessao_id: comum, pane_id: null, orquestrando: false });
    const shell = m.abrirComum("terminal");
    await expect(m.painel.orquestrar({ workspace_id: m.ws.id, sessao_id: shell, ligar: true })).rejects.toMatchObject({ codigo: "cli_sem_mcp" });
    // Missão real (agêntica de verdade): o interruptor não vale
    const real = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "pedido", titulo: "Real", pedido: "x", clis: { piloto: "claude" } });
    const pilotoReal = m.repos.pane.exigir(real.piloto_pane_id as string);
    await expect(m.painel.orquestrar({ workspace_id: m.ws.id, sessao_id: pilotoReal.sessao_pty_id as string, ligar: true })).rejects.toMatchObject({ codigo: "painel_de_missao" });
  });

  it("sessão inexistente ou encerrada: erro nominal; erro de infraestrutura vira texto genérico", async () => {
    const m = montar();
    await m.orq.iniciar();
    await expect(m.painel.orquestrar({ workspace_id: m.ws.id, sessao_id: "sessao_zzzz", ligar: true })).rejects.toBeInstanceOf(ErroPainelLivre);
    expect(sanearErroDePainelLivre(new Error("ENOENT /Users/x/segredo")).message).not.toContain("/Users");
  });
});
