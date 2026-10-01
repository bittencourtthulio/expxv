import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { MessageChannel } from "node:worker_threads";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { criarTmp, detectorFalso, ferramenta, limpar, novoBanco, sessoesFalsas } from "../../tests/fixtures/dominio/ambiente";
import { criarServicoContas } from "../nucleo/provedores/contas";
import { criarServicoProvedores } from "../nucleo/provedores/servico";
import { criarServicoMissoes } from "../nucleo/missoes/servico";
import { criarServicoPanes } from "../nucleo/missoes/panes";
import { ErroMcp } from "../nucleo/mcp/erros";
import { PRODUTO } from "../nucleo/produto";
import { criarBarramento } from "./barramento";
import { iniciarServidorRemoto, type ThreadMcp } from "./mcp-remoto";
import { montarServidorDoWorker } from "./mcp-worker";
import { criarOrquestracao, type Orquestracao } from "./orquestracao";

afterEach(limpar);

const RAIZ_REPO = join(__dirname, "..", "..");
const ATIVOS = {
  pastaDePrompts: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "prompts"),
  scriptGancho: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "hooks", "scripts", "gancho.mjs"),
  caminhoWorker: "/nao-usado/mcp-worker.js",
};

/** A thread do servidor roda neste mesmo processo, ligada por um MessageChannel (sem Worker real). */
function threadEmProcesso(dados: Parameters<NonNullable<Parameters<typeof iniciarServidorRemoto>[0]["criarThread"]>>[0]): ThreadMcp {
  const { port1, port2 } = new MessageChannel();
  void montarServidorDoWorker(port2, dados, () => undefined);
  return {
    postMessage: (m) => port1.postMessage(m),
    on: (e, f) => port1.on(e, f),
    off: (e, f) => port1.off(e, f),
    once: (e, f) => port1.once(e === "exit" ? "close" : e, f as never),
    terminate: async () => { port1.close(); port2.close(); },
  };
}

const abertas: Orquestracao[] = [];
afterEach(async () => { while (abertas.length) await abertas.pop()?.encerrar(); });

function montar(opcoes: { ferramentas?: ReturnType<typeof ferramenta>[]; servidorReal?: boolean } = {}) {
  const b = novoBanco();
  const { banco, repos } = b;
  const dados = criarTmp("orq-dados-");
  const raiz = criarTmp("orq-ws-");
  const ws = repos.workspace.criar({ nome: "ws", raiz });
  const sessoes = sessoesFalsas();
  const detector = detectorFalso(opcoes.ferramentas ?? [ferramenta("claude"), ferramenta("codex"), ferramenta("opencode"), ferramenta("gemini")]);
  const contas = criarServicoContas({ banco, repos, pastaDeDados: dados });
  const workspaces = { exigir: (id: string) => repos.workspace.exigir(id) };
  const barramento = criarBarramento();
  const eventos: Array<{ tipo: string; payload: unknown }> = [];
  for (const tipo of ["handoff.submitted", "wake.queued", "wake.delivered"]) barramento.assinar(tipo, (payload) => void eventos.push({ tipo, payload }));
  const panes = criarServicoPanes({ banco, repos, workspaces, sessoes: async () => sessoes as never, detector, contas });
  const missoes = criarServicoMissoes({ banco, repos, workspaces, panes });
  const provedores = criarServicoProvedores({ detector, contas });
  const avisos: string[] = [];
  const falsoServidor = (): ReturnType<typeof iniciarServidorRemoto> =>
    Promise.resolve({
      url: "http://127.0.0.1:1/mcp",
      urlGanchos: "http://127.0.0.1:1/hooks",
      porta: 1,
      ...infoServidor,
      emitirToken: (p) => `token-${p.pane_id}-${p.role}`,
      revogar: (id) => void revogados.push(id),
      fechar: async () => undefined,
    });
  const revogados: string[] = [];
  const infoServidor: { portaAnterior: number | null; portaReutilizada: boolean } = { portaAnterior: null, portaReutilizada: true };
  const novaOrquestracao = (): Orquestracao => {
    const o = criarOrquestracao({
    dominio: { repos, workspaces, provedores, missoes, panes },
    banco,
    barramento,
    sessoes: async () => sessoes as never,
    dirApp: dados,
    executavelNode: "/app/Electron",
    electronComoNode: true,
    ativos: ATIVOS,
    avisar: (m) => void avisos.push(m),
    atrasoFechamentoMs: 10,
    intervaloSegurancaMs: 50,
    ...(opcoes.servidorReal === true
      ? { iniciarServidor: (deps, ganchos) => iniciarServidorRemoto({ caminhoWorker: "-", deps, ganchos, criarThread: threadEmProcesso }) }
      : { iniciarServidor: falsoServidor }),
  });
    abertas.push(o);
    return o;
  };
  const orq = novaOrquestracao();
  return { orq, novaOrquestracao, infoServidor, banco, repos, dados, raiz, ws, sessoes, panes, missoes, barramento, eventos, avisos, revogados, contas };
}

async function missaoAgentica(m: ReturnType<typeof montar>, opcoes: { portoes?: boolean } = {}) {
  const missao = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "Delegar", pedido: "Some 1+1 e entregue.", clis: { piloto: "claude" } });
  if (opcoes.portoes !== false) for (const p of ["direction", "content", "build", "qa"] as const) m.orq.liberarPortao(missao.id, p);
  const piloto = m.repos.pane.exigir(missao.piloto_pane_id as string);
  return { missao, piloto };
}

const pedidoSpawn = (m: ReturnType<typeof montar>, missao: { id: string }, piloto: { id: string }, extra: Record<string, unknown> = {}) => ({
  workspace_id: m.ws.id, mission_id: missao.id, pedido_por_pane_id: piloto.id, provedor: "claude", modelo: null, conta_id: null,
  papel: "executor" as const, agente_id: null, briefing_path: null, cwd: null, ...extra,
});

describe("lançamento do piloto (preparador)", () => {
  it("o piloto da Missão agêntica recebe MCP, settings por Pane e instruções, sem tocar no global do usuário", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { piloto, missao } = await missaoAgentica(m);
    const sessao = [...m.sessoes.sessoes.values()][0];
    const args = sessao?.pedido["argumentos"] as string[];
    const pasta = join(m.dados, "panes", piloto.id);
    expect(args).toContain("--mcp-config");
    expect(args[args.indexOf("--mcp-config") + 1]).toBe(join(pasta, "mcp.json"));
    expect(args[args.indexOf("--settings") + 1]).toBe(join(pasta, "claude-settings.json"));
    // instruções longas vão por arquivo (argumento de sessão ≤ 4 KB)
    expect(args).toContain("--append-system-prompt-file");
    expect(args.every((a) => Buffer.byteLength(a) <= 4096)).toBe(true);
    expect(readFileSync(join(pasta, "instrucoes.md"), "utf8")).toContain("piloto");
    // o último argumento é o pedido da Missão (brief)
    expect(args[args.length - 1]).toContain("Some 1+1 e entregue.");
    // token só no arquivo 0600 do Pane e no ambiente; nunca em argv
    expect(statSync(join(pasta, "mcp.json")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(pasta, "mcp.json"), "utf8")).toContain(`token-${piloto.id}-piloto`);
    expect(args.join(" ")).not.toContain("token-");
    expect(sessao?.ambiente[`${PRODUTO.prefixoEnv}GANCHOS_URL`]).toBe("http://127.0.0.1:1/hooks");
    expect(sessao?.ambiente[`${PRODUTO.prefixoEnv}MCP_TOKEN`]).toBe(`token-${piloto.id}-piloto`);
    // o settings do Pane tem o guarda de escrita do piloto e o marcador de gerenciado
    const settings = JSON.parse(readFileSync(join(pasta, "claude-settings.json"), "utf8")) as { hooks: Record<string, unknown>; [k: string]: unknown };
    expect(settings[`managed_by_${PRODUTO.id}`]).toBe(true);
    expect(Object.keys(settings.hooks)).toContain("PreToolUse");
    expect(missao.estado).toBe("intake");
  });

  it("Missão livre e Pane sem papel abrem a CLI comum (sem MCP)", async () => {
    const m = montar();
    await m.orq.iniciar();
    const livre = await m.missoes.criar({ workspace_id: m.ws.id, modo: "livre", origem: "livre", titulo: "L", pedido: "", clis: { executor: "claude" } });
    expect(livre.id).toBeDefined();
    const sessao = [...m.sessoes.sessoes.values()][0];
    expect(sessao?.pedido["argumentos"]).toEqual([]);
    expect(Object.keys(sessao?.ambiente ?? {})).toEqual([]);
    expect(existsSync(join(m.dados, "panes"))).toBe(false);
  });

  it("CLI sem contrato de intake não abre como piloto (pilot_cli_unsupported_intake), sem sessão órfã", async () => {
    const m = montar({ ferramentas: [ferramenta("gemini")] });
    await m.orq.iniciar();
    await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "G", pedido: "x", clis: { piloto: "gemini" } });
    expect(m.sessoes.sessoes.size).toBe(0);
    expect(m.repos.pane.listarPorWorkspace(m.ws.id).itens[0]).toMatchObject({ estado: "encerrado", encerrado_motivo: "falha_ao_abrir" });
  });

  it("se o servidor MCP não sobe, o Pane abre sem orquestração e a orquestração avisa", async () => {
    const m = montar();
    const orq = criarOrquestracao({
      dominio: { repos: m.repos, workspaces: { exigir: (id) => m.repos.workspace.exigir(id) }, provedores: criarServicoProvedores({ detector: detectorFalso(), contas: m.contas }), missoes: m.missoes, panes: m.panes },
      banco: m.banco, barramento: criarBarramento(), sessoes: async () => m.sessoes as never, dirApp: m.dados, executavelNode: "x", electronComoNode: false, ativos: ATIVOS,
      avisar: (x) => void m.avisos.push(x), iniciarServidor: () => Promise.reject(new Error("porta ocupada")),
    });
    abertas.push(orq);
    const missao = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "S", pedido: "x", clis: { piloto: "claude" } });
    expect(missao.piloto_pane_id).not.toBeNull();
    expect([...m.sessoes.sessoes.values()][0]?.pedido["argumentos"]).toEqual([]);
    expect(m.avisos.some((a) => a.includes("sem orquestração"))).toBe(true);
  });
});

describe("pane_spawn (PortaPanes.spawn)", () => {
  it("cria o card, abre o worker com token próprio e liga o card ao Pane; a Missão vai a executando", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { missao, piloto } = await missaoAgentica(m);
    mkdirSync(join(m.raiz, PRODUTO.pastaNoProjeto), { recursive: true });
    writeFileSync(join(m.raiz, PRODUTO.pastaNoProjeto, "briefing-x.md"), "# Card\n");
    const { pane_id } = await m.orq.portas.panes.spawn(pedidoSpawn(m, missao, piloto, { briefing_path: `${PRODUTO.pastaNoProjeto}/briefing-x.md`, agente_id: "dev-backend" }));
    const worker = m.repos.pane.exigir(pane_id);
    expect(worker).toMatchObject({ mission_id: missao.id, papel: "executor", eh_piloto: false, cli: "claude" });
    const task = m.repos.task.listarPorMissao(missao.id).itens[0];
    expect(task).toMatchObject({ task_ref: "t-1", titulo: "dev-backend", estado: "reivindicada", pane_id, papel: "executor", briefing_path: `${PRODUTO.pastaNoProjeto}/briefing-x.md` });
    const sessao = [...m.sessoes.sessoes.values()].find((s) => s.ambiente[`${PRODUTO.prefixoEnv}MCP_TOKEN`] === `token-${pane_id}-executor`);
    expect(sessao).toBeDefined();
    const args = sessao?.pedido["argumentos"] as string[];
    expect(args[args.length - 1]).toContain(`(task_id: ${task?.id})`);
    expect(args[args.length - 1]).toContain(`Briefing: ${PRODUTO.pastaNoProjeto}/briefing-x.md`);
    // a Missão acompanha o trabalho
    await new Promise((r) => setTimeout(r, 20));
    expect(m.repos.mission.exigir(missao.id).estado).toBe("executando");
    // o segundo card recebe t-2
    await m.orq.portas.panes.spawn(pedidoSpawn(m, missao, piloto));
    expect(m.repos.task.listarPorMissao(missao.id).itens.map((t) => t.task_ref)).toEqual(["t-1", "t-2"]);
  });

  it("revisor leva a Missão a revisando", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { missao, piloto } = await missaoAgentica(m);
    await m.orq.portas.panes.spawn(pedidoSpawn(m, missao, piloto, { papel: "revisor" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(m.repos.mission.exigir(missao.id).estado).toBe("revisando");
  });

  it("briefing ou cwd fora da árvore são recusados e nenhum card fica para trás", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { missao, piloto } = await missaoAgentica(m);
    await expect(m.orq.portas.panes.spawn(pedidoSpawn(m, missao, piloto, { briefing_path: "../fora.md" }))).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(m.orq.portas.panes.spawn(pedidoSpawn(m, missao, piloto, { cwd: "../fora" }))).rejects.toMatchObject({ code: "invalid_argument" });
    expect(m.repos.task.listarPorMissao(missao.id).itens).toHaveLength(0);
  });

  it("AUD-21: cwd que é link simbólico para fora da árvore é recusado (e pasta real dentro dela vale)", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { missao, piloto } = await missaoAgentica(m);
    const fora = criarTmp("orq-fora-");
    symlinkSync(fora, join(m.raiz, "atalho-para-fora"));
    mkdirSync(join(m.raiz, "sub"));
    await expect(m.orq.portas.panes.spawn(pedidoSpawn(m, missao, piloto, { cwd: "atalho-para-fora" }))).rejects.toMatchObject({ code: "invalid_argument" });
    expect(m.repos.task.listarPorMissao(missao.id).itens).toHaveLength(0);
    await expect(m.orq.portas.panes.spawn(pedidoSpawn(m, missao, piloto, { cwd: "sub" }))).resolves.toHaveProperty("pane_id");
  });

  it("CLI ausente: o card é descartado (nenhum worker sem card, nenhum card sem worker)", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { missao, piloto } = await missaoAgentica(m);
    await expect(m.orq.portas.panes.spawn(pedidoSpawn(m, missao, piloto, { provedor: "qwen" }))).rejects.toThrow();
    expect(m.repos.task.listarPorMissao(missao.id).itens[0]?.estado).toBe("descartada");
  });

  it("listar não traz conteúdo de tela e respeita Missão/workspace; obter devolve o task_id", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { missao, piloto } = await missaoAgentica(m);
    const { pane_id } = await m.orq.portas.panes.spawn(pedidoSpawn(m, missao, piloto));
    const lista = await m.orq.portas.panes.listar({ workspace_id: m.ws.id, mission_id: missao.id });
    expect(lista.map((p) => p.pane_id).sort()).toEqual([piloto.id, pane_id].sort());
    expect(Object.keys(lista[0] ?? {}).sort()).toEqual(["eh_piloto", "estado", "mission_id", "pane_id", "papel", "provedor", "task_id", "workspace_id"]);
    expect((await m.orq.portas.panes.obter(pane_id))?.task_id).toBe(m.repos.task.listarPorMissao(missao.id).itens[0]?.id);
    expect(await m.orq.portas.panes.obter("pane_nao_existe")).toBeNull();
    expect(await m.orq.portas.panes.listar({ workspace_id: m.ws.id, mission_id: null })).toEqual([]);
  });

  it("fora de Missão abre um Pane comum, sem card nem token", async () => {
    const m = montar();
    await m.orq.iniciar();
    const r = await m.orq.portas.panes.spawn({ workspace_id: m.ws.id, mission_id: null, pedido_por_pane_id: "x", provedor: "claude", modelo: null, conta_id: null, papel: "executor", agente_id: null, briefing_path: null, cwd: null });
    expect(m.repos.pane.exigir(r.pane_id).mission_id).toBeNull();
    expect([...m.sessoes.sessoes.values()][0]?.pedido["argumentos"]).toEqual([]);
  });
});

describe("leitura e envio", () => {
  it("pane_read devolve a tela (sem escapes) e só as últimas N linhas", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { missao, piloto } = await missaoAgentica(m);
    const { pane_id } = await m.orq.portas.panes.spawn(pedidoSpawn(m, missao, piloto));
    const sessaoId = m.repos.pane.exigir(pane_id).sessao_pty_id as string;
    for (let i = 1; i <= 500; i++) m.sessoes.emitir(sessaoId, { tipo: "saida", dados: `\u001b[1mlinha ${i}\u001b[0m\r\n` });
    const r = await m.orq.portas.panes.ler(pane_id, 100);
    expect(r?.linhas).toHaveLength(100);
    expect(r?.linhas[99]).toBe("linha 500");
    expect(r?.linhas.join("\n")).not.toContain("\u001b");
    expect(await m.orq.portas.panes.ler("pane_nao_existe", 10)).toBeNull();
  });

  it("pane_send tira controles do texto e recusa Pane encerrado; várias linhas viram colagem", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { missao, piloto } = await missaoAgentica(m);
    const { pane_id } = await m.orq.portas.panes.spawn(pedidoSpawn(m, missao, piloto));
    const sessao = m.sessoes.sessoes.get(m.repos.pane.exigir(pane_id).sessao_pty_id as string);
    expect(await m.orq.portas.panes.enviar(pane_id, "oi\u001b[31m\u0003 tudo", true)).toBe(true);
    expect(sessao?.escritas).toEqual(["oi[31m tudo\r"]);
    expect(await m.orq.portas.panes.enviar(pane_id, "a\nb", true)).toBe(true);
    expect(sessao?.escritas.slice(1)).toEqual(["\u001b[200~a\nb\u001b[201~", "\r"]);
    expect(await m.orq.portas.panes.enviar(pane_id, "\u001b", true)).toBe(false);
    expect(await m.orq.portas.panes.fechar(pane_id, "teste")).toBe(true);
    expect(await m.orq.portas.panes.enviar(pane_id, "depois", true)).toBe(false);
    expect(await m.orq.portas.panes.fechar(pane_id, "teste")).toBe(false);
    expect(m.revogados).toContain(pane_id);
  });
});

describe("missões, provedores e portões", () => {
  it("obter traz portões liberados e squad; liberar é idempotente e recusa portão inválido", async () => {
    const m = montar();
    const { missao } = await missaoAgentica(m, { portoes: false });
    expect((await m.orq.portas.missoes.obter(missao.id))?.portoes_liberados).toEqual([]);
    m.orq.liberarPortao(missao.id, "direction");
    m.orq.liberarPortao(missao.id, "direction");
    m.orq.liberarPortao(missao.id, "build");
    const info = await m.orq.portas.missoes.obter(missao.id);
    expect(info).toMatchObject({ modo: "agentico", titulo: "Delegar", agentes_do_squad: null, piloto_pane_id: missao.piloto_pane_id });
    expect(info?.portoes_liberados).toEqual(["direction", "build"]);
    expect(() => m.orq.liberarPortao(missao.id, "x" as never)).toThrow(ErroMcp);
    m.orq.definirSquad(missao.id, [{ agente_id: "dev", papel: "executor" }]);
    expect((await m.orq.portas.missoes.obter(missao.id))?.agentes_do_squad).toEqual([{ agente_id: "dev", papel: "executor" }]);
    m.orq.definirSquad(missao.id, null);
    expect((await m.orq.portas.missoes.obter(missao.id))?.agentes_do_squad).toBeNull();
    expect(await m.orq.portas.missoes.obter("mis_nao_existe")).toBeNull();
    expect((await m.orq.portas.missoes.listar({ workspace_id: m.ws.id })).map((x) => x.mission_id)).toEqual([missao.id]);
  });

  it("concluir exige handoff ok de revisor; com ele encerra a Missão (e seus Panes); Missão inexistente é recusada", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { missao, piloto } = await missaoAgentica(m);
    await expect(m.orq.portas.missoes.concluir(missao.id)).rejects.toMatchObject({ code: "rule_violation", subcode: "reviewer_required" });
    expect(m.repos.mission.exigir(missao.id).estado).not.toBe("concluida");
    const rev = await m.orq.portas.panes.spawn(pedidoSpawn(m, missao, piloto, { papel: "revisor" }));
    const task = m.repos.task.listarPorMissao(missao.id).itens[0]!;
    await m.orq.persistencia.gravar({ workspace_id: m.ws.id, mission_id: missao.id, de_pane_id: rev.pane_id, task_id: task.id, resumo: "ok", relatorio_path: "r.md", status: "ok", artefatos: [] });
    await m.orq.portas.missoes.concluir(missao.id);
    expect(m.repos.mission.exigir(missao.id).estado).toBe("concluida");
    expect(m.repos.pane.exigir(piloto.id).estado).toBe("encerrado");
    await expect(m.orq.portas.missoes.concluir("mis_nao_existe")).rejects.toThrow();
  });

  it("provedores: só os detectados, com contas habilitadas; conta desabilitada desliga o provedor", async () => {
    const m = montar();
    const a = m.contas.criar("codex", "Pessoal");
    let lista = await m.orq.portas.provedores.listar(m.ws.id);
    expect(lista.find((p) => p.provedor === "codex")).toMatchObject({ habilitado: true, contas: [a.id] });
    expect(lista.find((p) => p.provedor === "claude")).toMatchObject({ habilitado: true, contas: [] });
    m.contas.habilitar(a.id, false);
    lista = await m.orq.portas.provedores.listar(m.ws.id);
    expect(lista.find((p) => p.provedor === "codex")?.habilitado).toBe(false);
    expect((await m.orq.portas.provedores.modelos("claude")).map((x) => x.modelo)).toEqual(["opus", "sonnet", "haiku"]);
  });
});

describe("MCP: porta e validade dos tokens dos Panes recuperados (AUD-04)", () => {
  async function recuperado() {
    const m = montar();
    await m.orq.iniciar();
    const { piloto } = await missaoAgentica(m);
    await m.orq.encerrar();
    m.revogados.length = 0;
    m.avisos.length = 0;
    const sem: unknown[] = [];
    m.barramento.assinar("orquestracao.panes_sem_mcp", (p) => void sem.push(p));
    return { m, piloto, sem };
  }

  it("porta anterior ocupada por outro processo: os Panes recuperados perdem o token (ficam sem MCP) e há aviso", async () => {
    const { m, piloto, sem } = await recuperado();
    m.infoServidor.portaAnterior = 45555;
    m.infoServidor.portaReutilizada = false;
    const orq2 = m.novaOrquestracao();
    await orq2.iniciar();
    expect(m.revogados).toContain(piloto.id);
    expect(m.avisos.join("\n")).toMatch(/porta do MCP mudou/);
    expect(sem).toEqual([{ pane_ids: [piloto.id], motivo: "porta_ocupada" }]);
  });

  it("porta reutilizada e token recente: nada é revogado nem avisado", async () => {
    const { m, sem } = await recuperado();
    m.infoServidor.portaAnterior = 45555;
    m.infoServidor.portaReutilizada = true;
    await m.novaOrquestracao().iniciar();
    expect(m.revogados).toEqual([]);
    expect(sem).toEqual([]);
  });

  it("Pane criado há mais de 24 h: o token expirou e o app avisa que o Pane precisa ser recriado", async () => {
    const { m, piloto, sem } = await recuperado();
    m.banco.executar("UPDATE pane SET criado_em = ? WHERE id = ?", [new Date(Date.now() - 25 * 3600_000).toISOString(), piloto.id]);
    await m.novaOrquestracao().iniciar();
    expect(sem).toEqual([{ pane_ids: [piloto.id], motivo: "token_expirado" }]);
    expect(m.avisos.join("\n")).toMatch(/24 h/);
    expect(m.revogados).toEqual([]);
  });
});

describe("handoff persistido e wake", () => {
  async function comWorker() {
    const m = montar();
    await m.orq.iniciar();
    const base = await missaoAgentica(m);
    const { pane_id } = await m.orq.portas.panes.spawn(pedidoSpawn(m, base.missao, base.piloto));
    const task = m.repos.task.listarPorMissao(base.missao.id).itens[0]!;
    return { m, ...base, worker: pane_id, task };
  }
  const dadosHandoff = (x: Awaited<ReturnType<typeof comWorker>>, extra: Record<string, unknown> = {}) => ({
    workspace_id: x.m.ws.id, mission_id: x.missao.id, de_pane_id: x.worker, task_id: x.task.id, resumo: "2", relatorio_path: ".expxv/r.md", status: "ok" as const, artefatos: [], ...extra,
  });

  it("grava handoff + vínculo com a task na mesma transação e devolve o piloto como destino", async () => {
    const x = await comWorker();
    const r = await x.m.orq.persistencia.gravar(dadosHandoff(x));
    expect(r).toMatchObject({ para_pane_id: x.piloto.id, task_ref: "t-1" });
    const task = x.m.repos.task.exigir(x.task.id);
    expect(task).toMatchObject({ estado: "entregue", handoff_id: r.handoff_id });
    expect(x.m.repos.handoff.obter(r.handoff_id)).toMatchObject({ de_pane_id: x.worker, para_pane_id: x.piloto.id, status: "ok", resumo: "2" });
    expect(await x.m.orq.persistencia.doPane(x.worker)).toMatchObject({ handoff_id: r.handoff_id, status: "ok" });
    expect(await x.m.orq.persistencia.doPane(x.piloto.id)).toBeNull();
  });

  it("falha no banco não deixa handoff pela metade (rollback) e status falhou não entrega a task", async () => {
    const x = await comWorker();
    await expect(x.m.orq.persistencia.gravar(dadosHandoff(x, { resumo: "x".repeat(401) }))).rejects.toThrow();
    expect(x.m.repos.handoff.listarPorTask(x.task.id)).toEqual([]);
    expect(x.m.repos.task.exigir(x.task.id).handoff_id).toBeNull();
    await x.m.orq.persistencia.gravar(dadosHandoff(x, { status: "falhou", resumo: "não deu" }));
    expect(x.m.repos.task.exigir(x.task.id).estado).toBe("reivindicada");
    expect(x.m.repos.handoff.listarPorTask(x.task.id)[0]?.status).toBe("falhou");
  });

  it("task de outra Missão, de outro Pane ou inexistente é recusada", async () => {
    const x = await comWorker();
    await expect(x.m.orq.persistencia.gravar(dadosHandoff(x, { task_id: "task_nao_existe" }))).rejects.toMatchObject({ code: "not_found" });
    await expect(x.m.orq.persistencia.gravar(dadosHandoff(x, { de_pane_id: x.piloto.id }))).rejects.toMatchObject({ code: "unauthorized" });
    await expect(x.m.orq.persistencia.gravar(dadosHandoff(x, { mission_id: null }))).rejects.toMatchObject({ code: "unauthorized" });
    await expect(x.m.orq.persistencia.gravar(dadosHandoff(x, { mission_id: "mis_outra" }))).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("revisor ok só conta de Pane com papel revisor", async () => {
    const x = await comWorker();
    await x.m.orq.persistencia.gravar(dadosHandoff(x));
    expect(await x.m.orq.persistencia.temRevisorOk(x.missao.id)).toBe(false);
    const rev = await x.m.orq.portas.panes.spawn(pedidoSpawn(x.m, x.missao, x.piloto, { papel: "revisor" }));
    const taskRev = x.m.repos.task.listarPorMissao(x.missao.id).itens[1]!;
    await x.m.orq.persistencia.gravar(dadosHandoff(x, { de_pane_id: rev.pane_id, task_id: taskRev.id }));
    expect(await x.m.orq.persistencia.temRevisorOk(x.missao.id)).toBe(true);
  });

  it("wake: entregue ao piloto pronto, só depois de persistir; estado de sessão move a fila", async () => {
    const x = await comWorker();
    const sessaoPiloto = x.m.sessoes.sessoes.get(x.m.repos.pane.exigir(x.piloto.id).sessao_pty_id as string)!;
    // o piloto está "iniciando": nada é entregue
    x.m.orq.fila.enfileirar({ destino_pane_id: x.piloto.id, origem_pane_id: x.worker, task_id: "t-1", handoff_id: "hof_1", status: "ok", resumo: "2", relatorio_path: "r.md" });
    await x.m.orq.fila.ociosa();
    expect(sessaoPiloto.escritas).toEqual([]);
    // a sessão fica pronta (evento de estado da CLI): a fila entrega
    x.m.sessoes.emitir(sessaoPiloto.id, { tipo: "estado", estado: "executando", erro_codigo: null, mensagem: null });
    await x.m.orq.fila.ociosa();
    expect(sessaoPiloto.escritas).toHaveLength(1);
    expect(sessaoPiloto.escritas[0]).toMatch(/^\[wake\] Worker .* entregou o card t-1 \(ok\): 2 Relatório: r\.md\r$/);
  });

  it("AUD-05: o wake é gravado na mesma transação do handoff e some do banco quando entregue", async () => {
    const x = await comWorker();
    const r = await x.m.orq.persistencia.gravar(dadosHandoff(x));
    const linhas = () => x.m.banco.consultar<{ handoff_id: string; destino_pane_id: string; task_ref: string }>("SELECT handoff_id, destino_pane_id, task_ref FROM wake_pendente");
    expect(linhas()).toEqual([{ handoff_id: r.handoff_id, destino_pane_id: x.piloto.id, task_ref: "t-1" }]);
    // rollback do handoff leva o wake junto
    await expect(x.m.orq.persistencia.gravar(dadosHandoff(x, { resumo: "x".repeat(401) }))).rejects.toThrow();
    expect(linhas()).toHaveLength(1);
    // entrega: o piloto fica pronto e recebe; o registro é apagado
    const sessaoPiloto = x.m.sessoes.sessoes.get(x.m.repos.pane.exigir(x.piloto.id).sessao_pty_id as string)!;
    x.m.orq.fila.enfileirar({ destino_pane_id: x.piloto.id, origem_pane_id: x.worker, task_id: "t-1", handoff_id: r.handoff_id, status: "ok", resumo: "2", relatorio_path: "r.md" });
    x.m.sessoes.emitir(sessaoPiloto.id, { tipo: "estado", estado: "executando", erro_codigo: null, mensagem: null });
    await x.m.orq.fila.ociosa();
    expect(sessaoPiloto.escritas).toHaveLength(1);
    expect(linhas()).toEqual([]);
  });

  it("AUD-05: queda entre o banco e o wake — no boot seguinte o aviso é reentregue ao piloto, uma única vez", async () => {
    const x = await comWorker();
    await x.m.orq.persistencia.gravar(dadosHandoff(x)); // handoff gravado; o processo "cai" antes de enfileirar
    await x.m.orq.encerrar();
    expect(x.m.banco.consultar("SELECT 1 FROM wake_pendente")).toHaveLength(1); // sair do app NÃO descarta o pendente
    const orq2 = x.m.novaOrquestracao();
    await orq2.iniciar();
    const sessaoPiloto = x.m.sessoes.sessoes.get(x.m.repos.pane.exigir(x.piloto.id).sessao_pty_id as string)!;
    x.m.sessoes.emitir(sessaoPiloto.id, { tipo: "estado", estado: "executando", erro_codigo: null, mensagem: null });
    await orq2.fila.ociosa();
    const avisos = sessaoPiloto.escritas.filter((e) => e.includes("[wake]"));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("entregou o card t-1");
    expect(x.m.banco.consultar("SELECT 1 FROM wake_pendente")).toHaveLength(0);
    // outro boot: nada a reentregar
    await orq2.encerrar();
    const orq3 = x.m.novaOrquestracao();
    await orq3.iniciar();
    await orq3.fila.sondar();
    await orq3.fila.ociosa();
    expect(sessaoPiloto.escritas.filter((e) => e.includes("[wake]"))).toHaveLength(1);
  });

  it("AUD-05: pendente de um piloto que já terminou é descartado no boot (ninguém para acordar)", async () => {
    const x = await comWorker();
    await x.m.orq.persistencia.gravar(dadosHandoff(x));
    await x.m.orq.encerrar();
    x.m.repos.pane.encerrar(x.piloto.id, "teste");
    const orq2 = x.m.novaOrquestracao();
    await orq2.iniciar();
    expect(x.m.banco.consultar("SELECT 1 FROM wake_pendente")).toHaveLength(0);
    expect(orq2.fila.pendentes()).toEqual([]);
  });

  it("encerramento do Pane revoga o token e descarta a fila", async () => {
    const x = await comWorker();
    x.m.orq.fila.enfileirar({ destino_pane_id: x.worker, origem_pane_id: x.piloto.id, task_id: "t", handoff_id: "h", status: "ok", resumo: "r", relatorio_path: null });
    const sessaoWorker = x.m.repos.pane.exigir(x.worker).sessao_pty_id as string;
    x.m.sessoes.emitir(sessaoWorker, { tipo: "encerramento", codigo: 0, sinal: null });
    expect(x.m.orq.fila.pendentes(x.worker)).toEqual([]);
    expect(x.m.revogados).toContain(x.worker);
  });

  it("Pane encerrado pelo serviço (sem evento de sessão) também revoga o token, na próxima mudança de Missão", async () => {
    const x = await comWorker();
    expect(x.m.revogados).not.toContain(x.worker);
    x.m.repos.pane.encerrar(x.worker, "teste");
    x.m.barramento.emitir("missoes:mudou", {});
    expect(x.m.revogados).toContain(x.worker);
  });
});

describe("ciclo de vida", () => {
  it("iniciar e encerrar são idempotentes; encerrar NÃO revoga os tokens (valem depois de reiniciar), fecha o servidor e solta o preparador", async () => {
    const m = montar();
    await m.orq.iniciar();
    await m.orq.iniciar();
    const { piloto } = await missaoAgentica(m);
    expect(m.orq.servidor()).not.toBeNull();
    await m.orq.encerrar();
    await m.orq.encerrar();
    expect(m.revogados).not.toContain(piloto.id);
    expect(m.orq.servidor()).toBeNull();
    // depois de encerrar, um Pane novo abre comum
    const outra = await m.panes.abrirPane({ workspace_id: m.ws.id, cli: "claude" });
    expect((m.sessoes.sessoes.get(outra.sessao_id)?.pedido["argumentos"] as string[])).toEqual([]);
  });

  it("criar não sobe nada: servidor só depois de iniciar (ou do primeiro Pane orquestrado)", async () => {
    const m = montar();
    expect(m.orq.servidor()).toBeNull();
    expect(existsSync(join(m.dados, "panes"))).toBe(false);
  });
});

describe("servidor MCP em worker thread (RPC real)", () => {
  it("cliente MCP lista só as tools do papel, cria worker, entrega handoff e o wake chega; token adulterado/revogado é unauthorized", async () => {
    const m = montar({ servidorReal: true });
    await m.orq.iniciar();
    const { missao, piloto } = await missaoAgentica(m);
    const servidor = m.orq.servidor()!;
    const tokenPiloto = readFileSync(join(m.dados, "panes", piloto.id, "mcp.json"), "utf8").match(/Bearer ([^"]+)/)?.[1] as string;
    const conectar = async (token: string) => {
      const c = new Client({ name: "teste", version: "1" });
      await c.connect(new StreamableHTTPClientTransport(new URL(servidor.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }) as never);
      return c;
    };
    const chamar = async (c: Client, nome: string, args: Record<string, unknown>) => {
      const r = await c.callTool({ name: nome, arguments: args });
      const dados = JSON.parse((r.content as Array<{ text: string }>)[0]?.text ?? "null") as Record<string, unknown>;
      return { erro: r.isError === true, dados };
    };
    const piloto_ = await conectar(tokenPiloto);
    expect((await piloto_.listTools()).tools.map((t) => t.name)).toContain("pane_spawn");

    const spawn = await chamar(piloto_, "pane_spawn", { provider: "claude", role: "executor" });
    expect(spawn.erro).toBe(false);
    const workerId = spawn.dados["pane_id"] as string;
    expect(m.repos.pane.exigir(workerId).mission_id).toBe(missao.id);

    const tokenWorker = readFileSync(join(m.dados, "panes", workerId, "mcp.json"), "utf8").match(/Bearer ([^"]+)/)?.[1] as string;
    const w = await conectar(tokenWorker);
    expect((await w.listTools()).tools.map((t) => t.name)).toEqual(["handoff_submit"]);
    expect((await chamar(w, "pane_spawn", { provider: "claude" })).dados).toMatchObject({ code: "rule_violation", subcode: "forbidden_role" });

    const task = m.repos.task.listarPorMissao(missao.id).itens[0]!;
    mkdirSync(join(m.raiz, PRODUTO.pastaNoProjeto), { recursive: true });
    writeFileSync(join(m.raiz, PRODUTO.pastaNoProjeto, "r.md"), "# relatório\n2\n");
    const pronto = m.sessoes.sessoes.get(m.repos.pane.exigir(piloto.id).sessao_pty_id as string)!;
    m.sessoes.emitir(pronto.id, { tipo: "estado", estado: "executando", erro_codigo: null, mensagem: null });
    const entrega = await chamar(w, "handoff_submit", { task_id: task.id, summary: "2", report_path: `${PRODUTO.pastaNoProjeto}/r.md`, status: "ok" });
    expect(entrega.erro).toBe(false);
    await m.orq.fila.ociosa();
    expect(pronto.escritas.some((e) => e.includes("[wake]") && e.includes("entregou o card t-1"))).toBe(true);

    expect((await chamar(piloto_, "mission_complete", {})).dados).toMatchObject({ code: "rule_violation", subcode: "reviewer_required" });
    await expect(conectar(`${tokenPiloto}x`)).rejects.toThrow();
    m.orq.servidor()!.revogar(piloto.id);
    await expect(conectar(tokenPiloto)).rejects.toThrow();
    await piloto_.close();
    await w.close();
  }, 30_000);
});

describe("tokens persistentes (reinício do app)", () => {
  const status = async (url: string, token: string): Promise<number> => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
    });
    await r.text();
    return r.status;
  };
  const abrir = (dir: string) => iniciarServidorRemoto({ caminhoWorker: "-", deps: { maxPanesParalelos: 8 } as never, ganchos: { tratar: async () => ({ saida: {} }) } as never, criarThread: threadEmProcesso, dirSegredo: dir });
  const pedido = (pane_id: string) => ({ workspace_id: "ws_1", mission_id: "mis_1", pane_id, role: "executor" as const, mode: "agentico" as const });

  it("o token emitido antes de reiniciar continua valendo (mesma pasta); o revogado continua revogado; a porta é reaproveitada", async () => {
    const dir = criarTmp("orq-seg-");
    const s1 = await abrir(dir);
    const vivo = s1.emitirToken(pedido("pane_a"));
    const morto = s1.emitirToken(pedido("pane_b"));
    expect(await status(s1.url, vivo)).toBe(200);
    s1.revogar("pane_b");
    expect(await status(s1.url, morto)).toBe(401);
    await s1.fechar();
    expect(statSync(join(dir, "mcp-segredo")).mode & 0o777).toBe(0o600);

    const s2 = await abrir(dir); // "reinício"
    expect(s2.porta).toBe(s1.porta);
    expect(await status(s2.url, vivo)).toBe(200);
    expect(await status(s2.url, morto)).toBe(401);
    s2.revogar("pane_a"); // descartar o Pane
    expect(await status(s2.url, vivo)).toBe(401);
    expect(await status(s2.url, s2.emitirToken(pedido("pane_a")))).toBe(200); // respawn do mesmo pane_id
    await s2.fechar();

    const s3 = await abrir(dir); // a revogação do pane_a também sobreviveu
    expect(await status(s3.url, vivo)).toBe(401);
    await s3.fechar();
  }, 30_000);
});
