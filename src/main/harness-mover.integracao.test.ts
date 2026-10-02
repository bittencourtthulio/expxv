// Movimento com os repositórios REAIS (banco em memória): garante que `pane_rota`, cooldown e encerramento `superseded` funcionam de verdade,
// além dos dublês de `harness-mover.test.ts`. Pane fora de Missão (sem worktree nem git).
import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../nucleo/banco";
import { criarRepositorios } from "../nucleo/banco/repos";
import type { PedidoMoverPane } from "../nucleo/harness/troca";
import { criarMoverPane } from "./harness-mover";

const bancos: Banco[] = [];
afterEach(() => bancos.splice(0).forEach((b) => b.fechar()));

describe("moverPane com repositórios reais", () => {
  it("novo Pane com rota (+1 salto, task_type e decisão herdados), antigo superseded e conta de origem em cooldown", async () => {
    const banco = abrirBanco(":memory:");
    bancos.push(banco);
    migrar(banco);
    const repos = criarRepositorios(banco);
    const ws = repos.workspace.criar({ nome: "w", raiz: "/w" });
    const a = repos.conta.criar({ provedor: "claude", rotulo: "Pessoal" });
    const b = repos.conta.criar({ provedor: "claude", rotulo: "Trabalho" });
    const antigo = repos.pane.criar({ workspace_id: ws.id, tipo: "cli", cli: "claude", conta_id: a.id, papel: "executor", estado: "pronto" });
    repos.paneRota.gravar({ pane_id: antigo.id, perfil: { agente_id: null, provider: "claude", cli: "claude", modelo: null, esforco: null, faixa: "alto" }, task_type: "implementar", decisao_id: null, saltos: 1 });
    const arquivos = new Map<string, string>();
    const abertos: unknown[] = [];
    const agora = Date.parse("2026-10-01T12:00:00Z");
    const m = criarMoverPane({
      repos,
      panes: {
        abrirPane: async (p) => {
          abertos.push(p);
          const pane = repos.pane.criar({ workspace_id: ws.id, tipo: "cli", cli: p.cli, conta_id: p.conta_id ?? null, papel: p.papel ?? "executor", respawn_de: p.respawn_de ?? null, estado: "pronto" });
          return { pane, sessao_id: "s" };
        },
        encerrarPane: async (id, motivo) => repos.pane.encerrar(id, motivo),
        respawn: async () => {
          throw new Error("não deveria");
        },
      },
      taskDoPane: () => undefined,
      reatribuirTask: () => undefined,
      raiz: () => "/w",
      gravar: async (_r, rel, texto) => (arquivos.set(rel, texto), rel),
      ler: async () => null,
      statusGit: async () => null,
      tela: async () => ["ok"],
      scrub: async () => (t) => t,
      existeDiretorio: () => false,
      agora: () => agora,
    });
    const pedido: PedidoMoverPane = {
      pane_id: antigo.id,
      workspace_id: ws.id,
      de: { conta_id: a.id, provedor: "claude", modelo: null },
      para: { provedor: "claude", cli: "claude", modelo: null, esforco: null, conta_id: b.id, faixa: "alto" },
      motivo: "consumo_alto",
      recibo: "Troca feita.",
      troca_id: null,
      decisao_id: null,
    };
    const r = await m.moverPane(pedido);
    expect(repos.pane.exigir(antigo.id)).toMatchObject({ estado: "encerrado", encerrado_motivo: "superseded" });
    const novo = repos.pane.exigir(r.novo_pane_id);
    expect(novo).toMatchObject({ conta_id: b.id, respawn_de: antigo.id, estado: "pronto" });
    expect(repos.paneRota.obter(novo.id)).toMatchObject({ saltos: 2, task_type: "implementar", perfil: { provider: "claude" } });
    expect(repos.paneRota.obter(novo.id)?.ultima_troca_em).not.toBeNull();
    expect(repos.contaRoteamento.obter(a.id)?.em_cooldown_ate).toBe(new Date(agora + 5 * 60_000).toISOString());
    expect(repos.contaRoteamento.obter(b.id)?.em_cooldown_ate ?? null).toBeNull();
    expect((abertos[0] as { prompt_inicial: string }).prompt_inicial).toContain("retomada");
    expect([...arquivos.keys()]).toHaveLength(1);
  });
});
