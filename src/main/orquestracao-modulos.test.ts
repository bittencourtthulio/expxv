// Módulos da suíte desligados (D-480) no lançamento dos Panes: no Claude Code, as skills dos módulos DESLIGADOS entram como `permissions.deny` num `--settings` por Pane
// (o settings global/do projeto nunca é tocado); nas outras CLIs não há esse gate. A orquestração real com Maestro falso e servidor MCP falso.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarTmp, detectorFalso, ferramenta, limpar, novoBanco, sessoesFalsas } from "../../tests/fixtures/dominio/ambiente";
import { criarServicoMissoes } from "../nucleo/missoes/servico";
import { criarServicoPanes } from "../nucleo/missoes/panes";
import { criarServicoProvedores } from "../nucleo/provedores/servico";
import { criarServicoContas } from "../nucleo/provedores/contas";
import { ajustarArgumentosDasSessoes } from "../nucleo/terminais/settings-claude";
import { denyDeModulos } from "../nucleo/suite/modulos";
import { criarBarramento } from "./barramento";
import { criarOrquestracao, type MaestroDaOrquestracao, type Orquestracao } from "./orquestracao";

afterEach(() => limpar());
const abertas: Orquestracao[] = [];
afterEach(async () => { while (abertas.length) await abertas.pop()?.encerrar(); });

const RAIZ_REPO = join(__dirname, "..", "..");
const ATIVOS = {
  pastaDePrompts: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "prompts"),
  scriptGancho: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "hooks", "scripts", "gancho.mjs"),
  caminhoWorker: "/nao-usado/mcp-worker.js",
};

function montar(o: { deny?: (ws: string) => readonly string[]; maestro?: boolean } = {}) {
  const b = novoBanco();
  const { banco, repos } = b;
  const dados = criarTmp("orq-mod-dados-");
  const raiz = criarTmp("orq-mod-ws-");
  const ws = repos.workspace.criar({ nome: "ws", raiz });
  const sessoes = sessoesFalsas();
  const detector = detectorFalso([ferramenta("claude"), ferramenta("codex")]);
  const contas = criarServicoContas({ banco, repos, pastaDeDados: dados });
  const workspaces = { exigir: (id: string) => repos.workspace.exigir(id) };
  const panes = criarServicoPanes({ banco, repos, workspaces, sessoes: async () => sessoes as never, detector, contas });
  const missoes = criarServicoMissoes({ banco, repos, workspaces, panes });
  const provedores = criarServicoProvedores({ detector, contas });
  const maestro: MaestroDaOrquestracao = {
    portaMcp: { pedir: async () => { throw new Error("n/a"); }, status: async () => ({ pipelines: [] }), permitido: async () => true } as never,
    ehPaneDoMaestro: () => false, hookAtivo: () => true, gancho: async () => ({ saida: {} }),
  };
  const orq = criarOrquestracao({
    dominio: { repos, workspaces, provedores, missoes, panes },
    banco, barramento: criarBarramento(), sessoes: async () => sessoes as never, dirApp: dados, executavelNode: "/app/Electron", electronComoNode: true,
    ativos: ATIVOS, atrasoFechamentoMs: 10, intervaloSegurancaMs: 50,
    ...(o.maestro === true ? { maestro: () => maestro } : {}),
    ...(o.deny === undefined ? {} : { denyDeModulos: o.deny }),
    iniciarServidor: () => Promise.resolve({
      url: "http://127.0.0.1:1/mcp", urlGanchos: "http://127.0.0.1:1/hooks", porta: 1, portaAnterior: null, portaReutilizada: true,
      emitirToken: (p) => `token-${p.pane_id}`, revogar: () => undefined, fechar: async () => undefined,
    }),
  });
  abertas.push(orq);
  return { orq, repos, ws, sessoes, missoes };
}
type M = ReturnType<typeof montar>;
const ultima = (m: M) => [...m.sessoes.sessoes.values()].at(-1)!;
const livre = (m: M, cli: string) => m.missoes.criar({ workspace_id: m.ws.id, modo: "livre", origem: "livre", titulo: "L", pedido: "", clis: { executor: cli } });
const settingsDe = (args: string[]): string[] => args.flatMap((a, i) => (a === "--settings" ? [args[i + 1] as string] : []));

describe("gate de skills por Pane (módulos desligados)", () => {
  it("Claude: um --settings por Pane com o deny dos módulos desligados (arquivo do app, nunca o do projeto)", async () => {
    const m = montar({ deny: () => denyDeModulos(["legadox"]) });
    await m.orq.iniciar();
    await livre(m, "claude");
    const args = ultima(m).pedido["argumentos"] as string[];
    const arquivos = settingsDe(args);
    expect(arquivos).toHaveLength(1);
    expect(arquivos[0]).toMatch(/panes[\\/].+[\\/]claude-modulos\.json$/);
    expect(arquivos[0]!.startsWith(m.ws.raiz)).toBe(false);
    const json = JSON.parse(readFileSync(arquivos[0] as string, "utf8")) as { permissions: { deny: string[] } };
    expect(json.permissions.deny).toEqual(expect.arrayContaining(["Skill(legadox)", "Skill(expx:legadox)", "Skill(legadox-raio)"]));
    expect(json.permissions.deny.some((d) => /sprintx|runx/.test(d))).toBe(false);
  });

  it("soma com o hook do Maestro: dois --settings, e a junção do Claude mantém hooks E deny", async () => {
    const m = montar({ deny: () => denyDeModulos(["legadox"]), maestro: true });
    await m.orq.iniciar();
    await livre(m, "claude");
    const args = ultima(m).pedido["argumentos"] as string[];
    expect(settingsDe(args)).toHaveLength(2);
    const juntado = ajustarArgumentosDasSessoes("claude", args);
    const arquivos = settingsDe(juntado);
    expect(arquivos).toHaveLength(1);
    const json = JSON.parse(readFileSync(arquivos[0] as string, "utf8")) as { hooks?: Record<string, unknown>; permissions?: { deny: string[] } };
    expect(Object.keys(json.hooks ?? {})).toContain("UserPromptSubmit");
    expect(json.permissions?.deny).toContain("Skill(legadox)");
  });

  it("Codex: sem gate (a CLI não tem como; a UI avisa 'parcial')", async () => {
    const m = montar({ deny: () => denyDeModulos(["legadox"]) });
    await m.orq.iniciar();
    await livre(m, "codex");
    expect(settingsDe((ultima(m).pedido["argumentos"] as string[] | undefined) ?? [])).toEqual([]);
  });

  it("nenhum módulo desligado, porta ausente ou porta que lança: o Pane abre como antes", async () => {
    for (const deny of [() => [] as string[], undefined, () => { throw new Error("falhou"); }]) {
      const m = montar(deny === undefined ? {} : { deny });
      await m.orq.iniciar();
      await livre(m, "claude");
      expect(settingsDe((ultima(m).pedido["argumentos"] as string[] | undefined) ?? [])).toEqual([]);
    }
  });
});
