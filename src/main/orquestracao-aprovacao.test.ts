// D-640: política de aprovações dos workers. Lançamento de cada CLI verificado pelo comando que a sessão recebe (flags, settings e ambiente esperados e PROIBIDOS).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarTmp, detectorFalso, ferramenta, limpar, novoBanco, sessoesFalsas } from "../../tests/fixtures/dominio/ambiente";
import { criarServicoContas } from "../nucleo/provedores/contas";
import { criarServicoProvedores } from "../nucleo/provedores/servico";
import { criarServicoMissoes } from "../nucleo/missoes/servico";
import { criarServicoPanes } from "../nucleo/missoes/panes";
import { PRODUTO } from "../nucleo/produto";
import { criarBarramento } from "./barramento";
import { criarOrquestracao, type DepsOrquestracao, type Orquestracao } from "./orquestracao";
import type { PedidoToken } from "../nucleo/mcp/tokens";

afterEach(limpar);
const RAIZ_REPO = join(__dirname, "..", "..");
const ATIVOS = {
  pastaDePrompts: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "prompts"),
  scriptGancho: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "hooks", "scripts", "gancho.mjs"),
  caminhoWorker: "/nao-usado/mcp-worker.js",
};
const abertas: Orquestracao[] = [];
afterEach(async () => { while (abertas.length) await abertas.pop()?.encerrar(); });

function montar(extra: Partial<DepsOrquestracao> = {}) {
  const b = novoBanco();
  const { banco, repos } = b;
  const dados = criarTmp("apr-dados-");
  const raiz = criarTmp("apr-ws-");
  const ws = repos.workspace.criar({ nome: "ws", raiz });
  const sessoes = sessoesFalsas();
  const detector = detectorFalso([ferramenta("claude"), ferramenta("codex"), ferramenta("opencode"), ferramenta("gemini")]);
  const contas = criarServicoContas({ banco, repos, pastaDeDados: dados, casa: dados, env: {} });
  const workspaces = { exigir: (id: string) => repos.workspace.exigir(id) };
  const barramento = criarBarramento();
  const panes = criarServicoPanes({ banco, repos, workspaces, sessoes: async () => sessoes as never, detector, contas });
  const missoes = criarServicoMissoes({ banco, repos, workspaces, panes });
  const provedores = criarServicoProvedores({ detector, contas });
  const pedidosDeToken: PedidoToken[] = [];
  const avisos: string[] = [];
  const relogio = { t: 1_000_000, agora() { return this.t; } };
  const orq = criarOrquestracao({
    dominio: { repos, workspaces, provedores, missoes, panes },
    banco, barramento, sessoes: async () => sessoes as never, dirApp: dados, executavelNode: "/app/Electron", electronComoNode: true, ativos: ATIVOS,
    avisar: (m) => void avisos.push(m), atrasoFechamentoMs: 10, intervaloSegurancaMs: 50, relogio,
    iniciarServidor: () => Promise.resolve({
      url: "http://127.0.0.1:1/mcp", urlGanchos: "http://127.0.0.1:1/hooks", porta: 1, portaAnterior: null, portaReutilizada: true,
      emitirToken: (p) => { pedidosDeToken.push(p); return `token-${p.pane_id}-${p.role}`; },
      revogar: () => undefined, fechar: async () => undefined,
    }),
    ...extra,
  });
  abertas.push(orq);
  return { orq, banco, repos, dados, raiz, ws, sessoes, panes, missoes, pedidosDeToken, avisos, relogio };
}
type M = ReturnType<typeof montar>;

async function abrirAvulso(m: M, cli = "claude") {
  m.orq.avulso.definirPreferencia(m.ws.id, true);
  const missao = m.orq.avulso.criarMissao({ workspace_id: m.ws.id, rotulo: `${cli} 10:00`, permissao: "seguro" });
  const aberto = await m.panes.abrirPane({ missao_id: missao.id, cli, papel: "piloto", contexto: { avulso: true } });
  m.orq.avulso.vincularPane(missao.id, aberto.pane.id);
  return { missao, pane: aberto.pane, sessao: m.sessoes.sessoes.get(aberto.sessao_id)! };
}
const pedido = (m: M, missao: { id: string }, piloto: { id: string }, extra: Record<string, unknown> = {}) => ({
  workspace_id: m.ws.id, mission_id: missao.id, pedido_por_pane_id: piloto.id, provedor: "claude", modelo: null, conta_id: null,
  papel: "executor" as const, agente_id: null, briefing_path: null, cwd: null, ...extra,
});

const PROIBIDOS = ["--dangerously-skip-permissions", "bypassPermissions", "--always-approve", "--dangerously-bypass-approvals-and-sandbox", "--approve-for-me", "danger-full-access"];
const comoTexto = (s: { pedido: Record<string, unknown>; ambiente: Record<string, string> }): string => JSON.stringify({ a: s.pedido["argumentos"], e: s.ambiente });
const sessaoDe = (m: M, paneId: string) => [...m.sessoes.sessoes.values()].find((s) => s.id === m.repos.pane.exigir(paneId).sessao_pty_id)!;
const settingsDe = (m: M, paneId: string) => JSON.parse(readFileSync(join(m.dados, "panes", paneId, "claude-settings.json"), "utf8")) as { permissions?: { allow?: string[]; deny?: string[]; defaultMode?: string } };
const argsDe = (s: { pedido: Record<string, unknown> }): string[] => s.pedido["argumentos"] as string[];

/** Workspace git com worktree por worker (executor isola por padrão), como o main faz. */
function montarGit(extra: Partial<DepsOrquestracao> = {}) {
  const m = montar({ ...extra, avulso: { worktreeDoWorker: async ({ ref }) => ({ caminho: criarTmp(`wt-${ref}-`), branch: `avulso/${ref}` }), ...(extra.avulso ?? {}) } });
  m.banco.executar("UPDATE workspace SET e_git = 1 WHERE id = ?", [m.ws.id]);
  return m;
}

describe("aprovação dos workers: padrão automático seguro (D-640)", () => {
  it("worker Claude em worktree: acceptEdits + allowlist + deny, git sem hooks, nunca bypass; a flag do workspace não se soma", async () => {
    const m = montarGit({ avulso: { permissaoDoWorkspace: () => "automatico" } });
    await m.orq.iniciar();
    const a = await abrirAvulso(m);
    const r = await m.orq.portas.panes.spawn(pedido(m, a.missao, a.pane, { papel: "executor", prompt: "edita", titulo: "Editar" }));
    const sw = sessaoDe(m, r.pane_id);
    expect(sw.cwd).toContain("wt-");
    const args = argsDe(sw);
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    for (const proibido of PROIBIDOS) expect(comoTexto(sw)).not.toContain(proibido);
    expect(sw.permissao).toBe("seguro");
    const st = settingsDe(m, r.pane_id);
    expect(st.permissions?.defaultMode).toBe("acceptEdits");
    expect(st.permissions?.allow).toContain(`mcp__${PRODUTO.id}__handoff_submit`);
    expect(st.permissions?.allow).toContain("Bash(git commit:*)");
    expect(st.permissions?.deny).toEqual(expect.arrayContaining(["Bash(git push:*)", "Bash(rm -rf:*)", "Bash(sudo:*)", "Read(**/.env*)", "Agent", "Task"]));
    expect(sw.ambiente["GIT_CONFIG_KEY_0"]).toBe("core.hooksPath");
    // `--allowedTools` é variádico e engoliria o prompt posicional: a política vai só pelo settings do Pane
    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("--disallowedTools");
    // só as tools do app que o PAPEL do worker tem (entregar); nenhuma de orquestrador, Maestro ou conta
    const mcp = (st.permissions?.allow ?? []).filter((x) => x.startsWith("mcp__"));
    expect(mcp).toContain(`mcp__${PRODUTO.id}__handoff_submit`);
    for (const t of ["pane_spawn", "pane_send", "pane_close", "mission_complete", "maestro_request", "account_switch", "harness_set"]) expect(mcp).not.toContain(`mcp__${PRODUTO.id}__${t}`);
    // o gate do Pane (hooks do worker: Stop/handoff) continua no mesmo arquivo
    expect(JSON.stringify(st)).toContain("Stop");
    expect(m.orq.avulso.aprovacaoDoPane(r.pane_id)).toMatchObject({ nivel: "automatico_seguro", selo: "garantido" });
  });

  it("o ORQUESTRADOR (piloto) segue com a política do workspace: nenhuma flag da política dos workers", async () => {
    const m = montarGit();
    await m.orq.iniciar();
    const a = await abrirAvulso(m);
    expect(argsDe(a.sessao)).not.toContain("--permission-mode");
    expect(m.orq.avulso.aprovacaoDoPane(a.pane.id)).toBeNull();
  });

  it("cwd na raiz do dono (sem worktree) NÃO recebe automático: pergunta, com aviso; 'permitir também na raiz' liga o automático seguro", async () => {
    const m = montar();
    await m.orq.iniciar();
    const a = await abrirAvulso(m);
    const r1 = await m.orq.portas.panes.spawn(pedido(m, a.missao, a.pane, { papel: "explorador", prompt: "lê" }));
    expect(argsDe(sessaoDe(m, r1.pane_id))).not.toContain("--permission-mode");
    expect(settingsDe(m, r1.pane_id).permissions?.allow ?? []).toEqual([]);
    expect(m.avisos.some((x) => /raiz do projeto/.test(x))).toBe(true);
    expect(m.orq.avulso.aprovacaoDoPane(r1.pane_id)).toMatchObject({ nivel: "perguntar", nivel_pedido: "automatico_seguro", selo: "pergunta" });
    m.relogio.t += 10_000;
    m.orq.avulso.aprovacao({ workspace_id: m.ws.id, permitir_raiz: true });
    const r2 = await m.orq.portas.panes.spawn(pedido(m, a.missao, a.pane, { papel: "explorador", prompt: "lê 2" }));
    expect(argsDe(sessaoDe(m, r2.pane_id))).toContain("acceptEdits");
    expect(m.orq.avulso.aprovacaoDoPane(r2.pane_id)?.avisos.join(" ")).toMatch(/raiz/);
  });

  it("projeto NÃO confiável e nível 'perguntar' abrem o worker sem nada extra", async () => {
    const m = montarGit();
    await m.orq.iniciar();
    const a = await abrirAvulso(m);
    m.orq.avulso.aprovacao({ workspace_id: m.ws.id, confiavel: false });
    const r1 = await m.orq.portas.panes.spawn(pedido(m, a.missao, a.pane, { papel: "executor", prompt: "x" }));
    expect(argsDe(sessaoDe(m, r1.pane_id))).not.toContain("--permission-mode");
    expect(m.orq.avulso.aprovacaoDoPane(r1.pane_id)?.avisos.join(" ")).toMatch(/não confiável/);
    m.relogio.t += 10_000;
    m.orq.avulso.aprovacao({ workspace_id: m.ws.id, confiavel: true, nivel: "perguntar" });
    const r2 = await m.orq.portas.panes.spawn(pedido(m, a.missao, a.pane, { papel: "executor", prompt: "y" }));
    expect(argsDe(sessaoDe(m, r2.pane_id))).not.toContain("--permission-mode");
    expect(m.orq.avulso.aprovacaoDoPane(r2.pane_id)?.nivel).toBe("perguntar");
  });

  it("pane_spawn.aprovacao só ABAIXA: 'perguntar' tira a política; 'automatico_seguro' não eleva um workspace em 'perguntar'", async () => {
    const m = montarGit();
    await m.orq.iniciar();
    const a = await abrirAvulso(m);
    const baixo = await m.orq.portas.panes.spawn(pedido(m, a.missao, a.pane, { papel: "executor", prompt: "x", aprovacao: "perguntar" }));
    expect(argsDe(sessaoDe(m, baixo.pane_id))).not.toContain("--permission-mode");
    m.orq.avulso.aprovacao({ workspace_id: m.ws.id, nivel: "perguntar" });
    m.relogio.t += 10_000;
    const igual = await m.orq.portas.panes.spawn(pedido(m, a.missao, a.pane, { papel: "executor", prompt: "y", aprovacao: "automatico_seguro" }));
    expect(m.orq.avulso.aprovacaoDoPane(igual.pane_id)?.nivel).toBe("perguntar");
    expect(argsDe(sessaoDe(m, igual.pane_id))).not.toContain("--permission-mode");
  });

  it("padrão global: workspace sem valor próprio herda; o valor próprio vence; 'herdar' volta ao global", async () => {
    const m = montarGit();
    await m.orq.iniciar();
    expect(m.orq.avulso.aprovacao({ workspace_id: m.ws.id })).toMatchObject({ nivel: "automatico_seguro", proprio: false, padrao_global: "automatico_seguro" });
    m.orq.avulso.aprovacao({ workspace_id: null, nivel: "perguntar" });
    expect(m.orq.avulso.aprovacao({ workspace_id: m.ws.id })).toMatchObject({ nivel: "perguntar", proprio: false });
    m.orq.avulso.aprovacao({ workspace_id: m.ws.id, nivel: "automatico_seguro" });
    expect(m.orq.avulso.aprovacao({ workspace_id: m.ws.id })).toMatchObject({ nivel: "automatico_seguro", proprio: true });
    m.orq.avulso.aprovacao({ workspace_id: m.ws.id, herdar: true });
    expect(m.orq.avulso.aprovacao({ workspace_id: m.ws.id })).toMatchObject({ nivel: "perguntar", proprio: false });
  });
});

describe("nível TOTAL (bypass): só com confirmação digitada, só em worktree, deny mantido", () => {
  it("sem a palavra digitada o nível não é gravado", async () => {
    const m = montarGit();
    await m.orq.iniciar();
    expect(() => m.orq.avulso.aprovacao({ workspace_id: m.ws.id, nivel: "total" })).toThrow(/liberar tudo/);
    expect(() => m.orq.avulso.aprovacao({ workspace_id: m.ws.id, nivel: "total", confirmacao: "liberar" })).toThrow();
    expect(m.orq.avulso.aprovacao({ workspace_id: m.ws.id }).nivel).toBe("automatico_seguro");
  });

  it("em worktree com confirmação: único caso com --dangerously-skip-permissions (uma vez), e o deny segue no settings", async () => {
    const m = montarGit();
    await m.orq.iniciar();
    const a = await abrirAvulso(m);
    m.orq.avulso.aprovacao({ workspace_id: m.ws.id, nivel: "total", confirmacao: "liberar tudo" });
    const r = await m.orq.portas.panes.spawn(pedido(m, a.missao, a.pane, { papel: "executor", prompt: "tudo" }));
    const sw = sessaoDe(m, r.pane_id);
    expect(argsDe(sw).filter((x) => x === "--dangerously-skip-permissions")).toHaveLength(1);
    expect(settingsDe(m, r.pane_id).permissions?.deny).toContain("Bash(git push:*)");
    expect(m.orq.avulso.aprovacaoDoPane(r.pane_id)?.nivel).toBe("total");
  });

  it("fora de worktree NUNCA há bypass, nem com 'permitir na raiz'", async () => {
    const m = montar();
    await m.orq.iniciar();
    const a = await abrirAvulso(m);
    m.orq.avulso.aprovacao({ workspace_id: m.ws.id, nivel: "total", confirmacao: "liberar tudo", permitir_raiz: true });
    const r = await m.orq.portas.panes.spawn(pedido(m, a.missao, a.pane, { papel: "explorador", prompt: "raiz" }));
    for (const proibido of PROIBIDOS) expect(comoTexto(sessaoDe(m, r.pane_id))).not.toContain(proibido);
    expect(m.orq.avulso.aprovacaoDoPane(r.pane_id)?.nivel).toBe("automatico_seguro");
  });

  it("o agente não consegue pedir 'total' pelo pane_spawn: o pedido não eleva o configurado", async () => {
    const m = montarGit();
    await m.orq.iniciar();
    const a = await abrirAvulso(m);
    const r = await m.orq.portas.panes.spawn(pedido(m, a.missao, a.pane, { papel: "executor", prompt: "x", aprovacao: "total" }));
    expect(comoTexto(sessaoDe(m, r.pane_id))).not.toContain("--dangerously-skip-permissions");
  });
});

describe("demais CLIs como worker (comando de lançamento)", () => {
  it("Codex: sandbox workspace-write, -a never, rede desligada; nunca --approve-for-me nem o bypass, mesmo com o workspace automático", async () => {
    const m = montarGit({ avulso: { permissaoDoWorkspace: () => "automatico" } });
    await m.orq.iniciar();
    const a = await abrirAvulso(m, "codex");
    const r = await m.orq.portas.panes.spawn(pedido(m, a.missao, a.pane, { provedor: "codex", papel: "executor", prompt: "x" }));
    const sw = sessaoDe(m, r.pane_id);
    const args = argsDe(sw);
    expect(args.slice(args.indexOf("-s"), args.indexOf("-s") + 4)).toEqual(["-s", "workspace-write", "-a", "never"]);
    expect(args).toContain("sandbox_workspace_write.network_access=false");
    for (const proibido of PROIBIDOS) expect(comoTexto(sw)).not.toContain(proibido);
    expect(m.orq.avulso.aprovacaoDoPane(r.pane_id)?.selo).toBe("parcial");
  });

  it("OpenCode: permission allow/deny por OPENCODE_CONFIG_CONTENT, fundida às instruções e ao MCP do app", async () => {
    const m = montarGit();
    await m.orq.iniciar();
    const a = await abrirAvulso(m, "opencode");
    const r = await m.orq.portas.panes.spawn(pedido(m, a.missao, a.pane, { provedor: "opencode", papel: "executor", prompt: "x" }));
    const sw = sessaoDe(m, r.pane_id);
    const cfg = JSON.parse(sw.ambiente["OPENCODE_CONFIG_CONTENT"] ?? "{}") as { instructions?: string[]; mcp?: Record<string, unknown>; permission?: { bash: Record<string, string>; task: string } };
    expect(cfg.instructions?.length).toBe(1);
    expect(Object.keys(cfg.mcp ?? {})).toContain(PRODUTO.id);
    expect(cfg.permission?.bash["git push"]).toBe("deny");
    expect(cfg.permission?.task).toBe("deny");
    for (const proibido of PROIBIDOS) expect(comoTexto(sw)).not.toContain(proibido);
  });
});
