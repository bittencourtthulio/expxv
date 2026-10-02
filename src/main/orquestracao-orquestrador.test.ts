// Orquestrador de verdade (D-510 a D-514): "CLI falsa" POR TIPO DE CLI que lê o prompt de orquestrador pelo canal que a CLI real usa (flag, arquivo, env) e então chama
// `pane_spawn` N vezes por um cliente MCP real; tabela de lançamento (canal + proibições) e prova de que SEM "Orquestrar" nada muda.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { criarTmp, detectorFalso, ferramenta, limpar, novoBanco, sessoesFalsas } from "../../tests/fixtures/dominio/ambiente";
import { criarServicoContas } from "../nucleo/provedores/contas";
import { criarServicoProvedores } from "../nucleo/provedores/servico";
import { criarServicoMissoes } from "../nucleo/missoes/servico";
import { criarServicoPanes } from "../nucleo/missoes/panes";
import { ErroMcp } from "../nucleo/mcp/erros";
import { aplicarPonteGrok, ARQUIVO_DA_PONTE_GROK, estadoDaPonteGrok, VARIAVEL_PONTE_TOKEN, VARIAVEL_PONTE_URL } from "../nucleo/orquestracao/ponte-grok";
import { VARIAVEL_TOKEN } from "../nucleo/orquestracao/piloto";
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
function threadEmProcesso(dados: Parameters<NonNullable<Parameters<typeof iniciarServidorRemoto>[0]["criarThread"]>>[0]): ThreadMcp {
  const { port1, port2 } = new MessageChannel();
  void montarServidorDoWorker(port2, dados, () => undefined);
  return { postMessage: (m) => port1.postMessage(m), on: (e, f) => port1.on(e, f), off: (e, f) => port1.off(e, f), once: (e, f) => port1.once(e === "exit" ? "close" : e, f as never), terminate: async () => { port1.close(); port2.close(); } };
}
const abertas: Orquestracao[] = [];
const clientes: Client[] = [];
afterEach(async () => { while (clientes.length) await clientes.pop()?.close().catch(() => undefined); while (abertas.length) await abertas.pop()?.encerrar(); });

function montar() {
  const { banco, repos } = novoBanco();
  const dados = criarTmp("orq-dados-");
  const raiz = criarTmp("orq-ws-");
  const ws = repos.workspace.criar({ nome: "ws", raiz });
  const sessoes = sessoesFalsas();
  const detector = detectorFalso((["claude", "codex", "opencode", "grok", "gemini", "aider", "qwen", "kilo"] as const).map((id) => ferramenta(id)));
  const contas = criarServicoContas({ banco, repos, pastaDeDados: dados, casa: dados, env: {} });
  const workspaces = { exigir: (id: string) => repos.workspace.exigir(id) };
  const panes = criarServicoPanes({ banco, repos, workspaces, sessoes: async () => sessoes as never, detector, contas });
  const missoes = criarServicoMissoes({ banco, repos, workspaces, panes });
  const provedores = criarServicoProvedores({ detector, contas });
  const orq = criarOrquestracao({
    dominio: { repos, workspaces, provedores, missoes, panes }, banco, barramento: criarBarramento(), sessoes: async () => sessoes as never, dirApp: dados,
    executavelNode: "/app/Electron", electronComoNode: true, ativos: ATIVOS, atrasoFechamentoMs: 10, intervaloSegurancaMs: 50,
    iniciarServidor: (deps, ganchos) => iniciarServidorRemoto({ caminhoWorker: "-", deps, ganchos, criarThread: threadEmProcesso }),
  });
  abertas.push(orq);
  return { orq, repos, dados, raiz, ws, sessoes, panes };
}
type M = ReturnType<typeof montar>;

async function abrirAvulso(m: M, cli: string, permissao: "seguro" | "equilibrado" | "automatico" = "seguro") {
  m.orq.avulso.definirPreferencia(m.ws.id, true);
  const missao = m.orq.avulso.criarMissao({ workspace_id: m.ws.id, rotulo: `${cli} 10:00`, permissao });
  const aberto = await m.panes.abrirPane({ missao_id: missao.id, cli, papel: "piloto", contexto: { avulso: true } });
  m.orq.avulso.vincularPane(missao.id, aberto.pane.id);
  const sessao = m.sessoes.sessoes.get(aberto.sessao_id)!;
  return { missao, pane: aberto.pane, sessao, args: sessao.pedido["argumentos"] as string[], env: sessao.ambiente };
}

interface ComandoLido { prompt: string; url: string; token: string }

/** Como a CLI REAL lê o que o app injetou: cada tipo de CLI usa o seu canal (e só ele). */
function lerComoACli(m: M, cli: string, pane_id: string, args: string[], env: Record<string, string>): ComandoLido {
  const valorDe = (flag: string): string | undefined => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  if (cli === "claude") {
    const mcp = JSON.parse(readFileSync(valorDe("--mcp-config") as string, "utf8")) as { mcpServers: Record<string, { url: string; headers: { Authorization: string } }> };
    const srv = mcp.mcpServers[PRODUTO.id] as { url: string; headers: { Authorization: string } };
    const arquivo = valorDe("--append-system-prompt-file");
    const prompt = valorDe("--append-system-prompt") ?? (arquivo === undefined ? "" : readFileSync(arquivo, "utf8"));
    return { prompt, url: srv.url, token: srv.headers.Authorization.replace("Bearer ", "") };
  }
  if (cli === "codex") {
    const dev = args.find((a) => a.startsWith("developer_instructions=")) as string;
    const url = args.find((a) => a.startsWith(`mcp_servers.${PRODUTO.id}.url=`)) as string;
    return { prompt: JSON.parse(dev.slice("developer_instructions=".length)) as string, url: JSON.parse(url.slice(url.indexOf("=") + 1)) as string, token: env[VARIAVEL_TOKEN] as string };
  }
  if (cli === "opencode") {
    const cfg = JSON.parse(env["OPENCODE_CONFIG_CONTENT"] as string) as { instructions: string[]; mcp: Record<string, { url: string }> };
    return { prompt: readFileSync(cfg.instructions[0] as string, "utf8"), url: (cfg.mcp[PRODUTO.id] as { url: string }).url, token: env[VARIAVEL_TOKEN] as string };
  }
  // grok: o servidor vem do arquivo de projeto da ponte (`${VAR}`), preenchido pelo ambiente da sessão
  const toml = readFileSync(join(m.raiz, ARQUIVO_DA_PONTE_GROK), "utf8");
  expect(toml).toContain("${" + VARIAVEL_PONTE_URL + "}");
  expect(pane_id).toBeTruthy();
  return { prompt: valorDe("--rules") ?? "", url: env[VARIAVEL_PONTE_URL] as string, token: env[VARIAVEL_PONTE_TOKEN] as string };
}

/** A CLI falsa OBEDECE ao prompt que leu: sem a regra de `pane_spawn` ela não abre nada; com ela, abre uma tarefa por terminal, em paralelo. */
async function obedecer(lido: ComandoLido, tarefas: number): Promise<string[]> {
  if (!lido.prompt.includes("pane_spawn")) return [];
  const c = new Client({ name: "cli-falsa", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(lido.url), { requestInit: { headers: { Authorization: `Bearer ${lido.token}` } } }) as never);
  clientes.push(c);
  const r = await Promise.all(Array.from({ length: tarefas }, async (_, i) => {
    const x = await c.callTool({ name: "pane_spawn", arguments: { provider: "claude", role: "scout", title: `Tarefa ${i + 1}`, prompt: `Pesquisar a fonte ${i + 1} e entregar o resumo.` } });
    expect(x.isError === true ? JSON.stringify(x.content) : "ok").toBe("ok");
    return (JSON.parse((x.content as Array<{ text: string }>)[0]?.text ?? "null") as { pane_id: string }).pane_id;
  }));
  return r;
}

const codigo = async (p: Promise<unknown>): Promise<string | undefined> => { try { await p; } catch (e) { return e instanceof ErroMcp ? (e.subcode ?? e.code) : "outro"; } return undefined; };

describe("CLI falsa por tipo: lê o prompt de orquestrador pelo canal da CLI e chama pane_spawn N vezes (MCP real)", () => {
  it.each(["claude", "codex", "opencode"])("%s: o prompt chega pelo canal da CLI, obriga pane_spawn e 5 tarefas viram 5 terminais na Missão avulsa", async (cli) => {
    const m = montar();
    await m.orq.iniciar();
    const { pane, missao, args, env } = await abrirAvulso(m, cli);
    const lido = lerComoACli(m, cli, pane.id, args, env);
    expect(lido.prompt).toMatch(/ORQUESTRADOR|ORCHESTRATOR/);
    expect(lido.prompt).toContain("pane_spawn");
    expect(lido.prompt).toMatch(/subagent/i);
    const ids = await obedecer(lido, 5);
    expect(new Set(ids).size).toBe(5);
    const workers = m.repos.pane.listarPorMissao(missao.id).filter((p) => !p.eh_piloto);
    expect(workers.map((w) => w.id).sort()).toEqual([...ids].sort());
  });

  it("grok: SEM a ponte não orquestra (erro nominal, nada de Missão órfã com token); COM a ponte lê --rules, recebe o servidor pelo ambiente e abre os terminais", async () => {
    const m = montar();
    await m.orq.iniciar();
    m.orq.avulso.definirPreferencia(m.ws.id, true);
    const sem = m.orq.avulso.criarMissao({ workspace_id: m.ws.id, rotulo: "grok", permissao: "seguro" });
    expect(await codigo(m.panes.abrirPane({ missao_id: sem.id, cli: "grok", papel: "piloto", contexto: { avulso: true } }))).toBe("unavailable");
    expect(existsSync(join(m.raiz, ".grok"))).toBe(false);
    aplicarPonteGrok(m.raiz); // o dono autorizou no diálogo
    const { pane, missao, args, env } = await abrirAvulso(m, "grok");
    const lido = lerComoACli(m, "grok", pane.id, args, env);
    expect(lido.prompt).toContain("pane_spawn");
    expect(args).toEqual(expect.arrayContaining(["--no-subagents", "--deny", "Edit"]));
    expect(args.join(" ")).not.toMatch(/always-approve|yolo|bypass|--disallowed-tools/);
    expect(args.join(" ")).not.toContain(lido.token); // o token nunca vai no argv
    expect((await obedecer(lido, 3)).length).toBe(3);
    expect(m.repos.pane.listarPorMissao(missao.id).filter((p) => !p.eh_piloto)).toHaveLength(3);
    // desligar a orquestração remove a ponte (reversível); o arquivo some
    expect(estadoDaPonteGrok(m.raiz).estado).toBe("ativa");
    await m.orq.avulso.encerrarMissao(missao.id, "orquestracao_desligada");
    expect(estadoDaPonteGrok(m.raiz).estado).toBe("ausente");
  });

  it("uma CLI que NÃO leu o prompt (sem a regra) não abre nada: a obediência vem do canal, não de sorte", async () => {
    expect(await obedecer({ prompt: "sem regra", url: "http://127.0.0.1:1/mcp", token: "x" }, 3)).toEqual([]);
  });
});

describe("tabela de lançamento por CLI: canal de injeção + proibições no comando real", () => {
  it("claude: --append-system-prompt(-file), settings por sessão negando Agent/Task e edição; nunca --disallowedTools nem bypass", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { pane, args } = await abrirAvulso(m, "claude");
    expect(args.some((a) => a === "--append-system-prompt" || a === "--append-system-prompt-file")).toBe(true);
    expect(args).not.toContain("--disallowedTools");
    expect(args.join(" ")).not.toMatch(/dangerously|bypass/);
    const settings = JSON.parse(readFileSync(join(m.dados, "panes", pane.id, "claude-settings.json"), "utf8")) as { permissions: { allow: string[]; deny: string[] } };
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(["Agent", "Task", "Edit", "Write", "MultiEdit", "NotebookEdit"]));
    expect(settings.permissions.allow).toContain(`mcp__${PRODUTO.id}__pane_spawn`);
  });

  it("codex: developer_instructions, --disable multi_agent e -s read-only (modo seguro); no automático sai o -s", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { args } = await abrirAvulso(m, "codex");
    expect(args.some((a) => a.startsWith("developer_instructions="))).toBe(true);
    expect(args.join(" ")).toContain("--disable multi_agent");
    expect(args.join(" ")).toContain("-s read-only");
    expect(args.join(" ")).not.toMatch(/bypass|danger/);
    const m2 = montar();
    await m2.orq.iniciar();
    const auto = await abrirAvulso(m2, "codex", "automatico");
    expect(auto.args).not.toContain("-s");
    expect(auto.args.join(" ")).toContain("--disable multi_agent");
  });

  it("opencode: instruções por arquivo efêmero na pasta do app (fora do repositório) e permissões task/edit negadas", async () => {
    const m = montar();
    await m.orq.iniciar();
    const { pane, env } = await abrirAvulso(m, "opencode");
    const cfg = JSON.parse(env["OPENCODE_CONFIG_CONTENT"] as string) as { instructions: string[]; permission: Record<string, string>; mcp: Record<string, unknown> };
    expect(cfg.instructions[0]).toBe(join(m.dados, "panes", pane.id, "instrucoes.md"));
    expect(cfg.instructions[0]?.startsWith(m.raiz)).toBe(false);
    expect(cfg.permission).toMatchObject({ task: "deny", edit: "deny" });
    expect(Object.keys(cfg.mcp)).toContain(PRODUTO.id); // o MCP e as instruções convivem na mesma variável
  });

  it("gemini, aider, qwen e kilo: não orquestram (erro nominal 'unavailable', nenhum token escopado emitido)", async () => {
    const m = montar();
    await m.orq.iniciar();
    m.orq.avulso.definirPreferencia(m.ws.id, true);
    for (const cli of ["gemini", "aider", "qwen", "kilo"]) {
      const missao = m.orq.avulso.criarMissao({ workspace_id: m.ws.id, rotulo: cli, permissao: "seguro" });
      expect(await codigo(m.panes.abrirPane({ missao_id: missao.id, cli, papel: "piloto", contexto: { avulso: true } }))).toBe("unavailable");
    }
  });

  it("opt-out do workspace (orquestrador pode editar): o Claude deixa de negar a edição, mas os subagentes seguem negados e o prompt avisa", async () => {
    const m = montar();
    await m.orq.iniciar();
    m.orq.avulso.definirOrquestradorEdita(m.ws.id, true);
    const { pane, args } = await abrirAvulso(m, "claude");
    const settings = JSON.parse(readFileSync(join(m.dados, "panes", pane.id, "claude-settings.json"), "utf8")) as { permissions: { deny: string[] } };
    expect(settings.permissions.deny).toEqual(["Agent", "Task"]);
    const arquivo = args[args.indexOf("--append-system-prompt-file") + 1];
    const prompt = args.includes("--append-system-prompt") ? args[args.indexOf("--append-system-prompt") + 1] : readFileSync(arquivo as string, "utf8");
    expect(prompt).toContain("liberou que o orquestrador edite");
    expect(prompt).toContain("pane_spawn");
  });
});

describe("sem Orquestrar nada muda", () => {
  it.each(["claude", "codex", "opencode", "grok"])("%s: painel livre comum abre sem nenhuma flag nova, sem instrução e sem token com tools", async (cli) => {
    const m = montar();
    await m.orq.iniciar();
    const aberto = await m.panes.abrirPane({ workspace_id: m.ws.id, cli });
    const s = m.sessoes.sessoes.get(aberto.sessao_id)!;
    const args = (s.pedido["argumentos"] as string[] | undefined) ?? [];
    for (const marca of ["--append-system-prompt", "--append-system-prompt-file", "--rules", "--no-subagents", "--deny", "--disable", "-s", "--disallowedTools"]) expect(args).not.toContain(marca);
    expect(args.some((a) => a.startsWith("developer_instructions="))).toBe(false);
    expect(s.ambiente["OPENCODE_CONFIG_CONTENT"]).toBeUndefined();
    expect(s.ambiente[VARIAVEL_PONTE_URL]).toBeUndefined();
    expect(s.ambiente[`${PRODUTO.prefixoEnv}ORQUESTRACAO`]).toBeUndefined();
    expect(existsSync(join(m.dados, "panes", aberto.pane.id, "instrucoes.md"))).toBe(false);
    expect(existsSync(join(m.raiz, ".grok"))).toBe(false);
    const settings = join(m.dados, "panes", aberto.pane.id, "claude-settings.json");
    if (existsSync(settings)) expect(readFileSync(settings, "utf8")).not.toMatch(/"Agent"|"Task"/);
  });
});
