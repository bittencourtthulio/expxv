// Integração OpenRouter × harness (T-09.28): contas Claude esgotadas → modelo OpenRouter habilitado da mesma faixa; OpenRouter só com
// consentimento, conta, modelo habilitado e CLI compatível (adaptador `verificado` instalada); `tipos_permitidos` respeitado.
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AccountUsage } from "../compartilhado/limites";
import { abrirBanco, migrar, type Banco } from "../nucleo/banco";
import { criarRepositorios } from "../nucleo/banco/repos";
import { criarServicoOpenRouter } from "../nucleo/openrouter";
import { criarRegistroConsentimento } from "../nucleo/rede";
import { criarBarramento } from "./barramento";
import { criarHarnessMain } from "./harness";

const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const bancos: Banco[] = [];
afterEach(() => bancos.splice(0).forEach((b) => b.fechar()));

const uso = (id: string, provider: string, kind: "five_hour" | "credit", pct: number): AccountUsage => ({
  account_id: id, provider, fetched_at: "2026-10-01T11:59:00.000Z", fonte: kind === "credit" ? "openrouter_api" : "claude_statusline", confianca: "medido", status: "ok",
  windows: [{ kind, used_pct: pct, resets_at: kind === "credit" ? null : "2026-10-01T17:00:00.000Z" }], model_buckets: {},
  bottleneck: kind, slack_pct: 100 - pct, idade_s: 60, vencidas: [],
});

async function montar(o: { consentir?: boolean; instalados?: string[]; modelo?: { tipos?: string[]; habilitado?: boolean }; comConta?: boolean; claudeUso?: number } = {}) {
  const banco = abrirBanco(":memory:");
  bancos.push(banco);
  migrar(banco);
  const repos = criarRepositorios(banco);
  const ws = repos.workspace.criar({ nome: "w", raiz: "/w", permissao: "seguro" });
  const cl = repos.conta.criar({ provedor: "claude", rotulo: "cl·1" });
  let orId: string | null = null;
  if (o.comConta !== false) {
    const c = repos.conta.criar({ provedor: "openrouter", rotulo: "or·1" });
    repos.contaOpenrouter.gravar({ conta_id: c.id, cofre_entrada_id: "OPENROUTER_KEY_TESTE", ultimos4: "abcd" });
    orId = c.id;
  }
  repos.openrouterModelo.sincronizar([{ id: "anthropic/claude-x", nome: "Claude X" }, { id: "meta/llama", nome: "Llama" }]);
  repos.openrouterModelo.gravarClassificacao({ id: "anthropic/claude-x", habilitado: o.modelo?.habilitado ?? true, faixa: "topo", tipos_permitidos: o.modelo?.tipos ?? [], ordem: 1 });
  const instalados = o.instalados ?? ["claude", "opencode"];
  if (o.consentir !== false) repos.config.definir("openrouter", { habilitado: true, consentimento_em: "2026-10-01T10:00:00.000Z", clis_preferidas: ["opencode", "aider"], atualizar_saldo: true });
  const provedores = { listar: async () => instalados.map((id) => ({ ferramenta: { id, instalado: true }, contas: [] })) as never };
  const servico = criarServicoOpenRouter({
    repos, cofre: async () => { throw new Error("sem cofre"); }, rede: () => { throw new Error("sem rede"); }, consentimento: criarRegistroConsentimento(),
    instaladas: async () => instalados,
  });
  const usos = [uso(cl.id, "claude", "five_hour", o.claudeUso ?? 100), ...(orId === null ? [] : [uso(orId, "openrouter", "credit", 10)])];
  const h = criarHarnessMain({
    repos,
    contas: { listar: () => repos.conta.listar({ limite: 500 }).itens, obter: (id) => repos.conta.obter(id), ambienteDaConta: () => ({}) },
    provedores: provedores as never,
    workspaces: { permissaoDe: () => "seguro" },
    limites: () => ({ snapshot: () => ({ contas: usos, geral: { pior: null, folga_media_pct: null, cobertura: { com_dado: 0, total: 0 }, em_alerta: 0, esgotadas: 0 } }) }),
    cofre: async () => { throw new Error("sem cofre"); },
    barramento: criarBarramento(),
    caminhosEquivalencia: [join(__dirname, "..", "..", "resources", "harness", "equivalencia.json")],
    agora: () => T0,
    openrouter: () => servico,
  });
  await h.iniciar();
  return { h, repos, ws, orId };
}
const pedido = (ws: string, extra: Record<string, unknown> = {}) => ({ workspace_id: ws, mission_id: null, pedido_por_pane_id: "pane_p", papel: "executor" as const, agente_id: null, task_type: "implementar", descricao: "x", faixa: null, ...extra });

describe("OpenRouter no roteamento (CT-9.33)", () => {
  it("conta Claude esgotada → modelo OpenRouter habilitado da mesma faixa, com a CLI compatível e a conta OpenRouter", async () => {
    const m = await montar();
    const r = await m.h.portaRota.rotear(pedido(m.ws.id));
    expect(r).toMatchObject({ ok: true, provedor: "openrouter", cli: "opencode", modelo: "anthropic/claude-x", conta_id: m.orId, faixa: "topo" });
  });

  it("Claude com folga: OpenRouter é o ÚLTIMO (nunca ganha da conta boa)", async () => {
    const m = await montar({ claudeUso: 10 });
    expect(await m.h.portaRota.rotear(pedido(m.ws.id))).toMatchObject({ ok: true, provedor: "claude" });
  });

  it("sem consentimento, sem conta, sem modelo habilitado ou sem CLI compatível: OpenRouter é pulado", async () => {
    for (const o of [{ consentir: false }, { comConta: false }, { modelo: { habilitado: false } }, { instalados: ["claude", "codex", "goose"] }]) {
      const m = await montar(o);
      const r = await m.h.portaRota.rotear(pedido(m.ws.id));
      expect(r.ok && r.provedor === "openrouter", JSON.stringify(o)).toBe(false);
    }
  });

  it("modelo com tipos_permitidos fora do tipo da tarefa é pulado; dentro, vale", async () => {
    const fora = await montar({ modelo: { tipos: ["auditar"] } });
    const rf = await fora.h.portaRota.rotear(pedido(fora.ws.id));
    expect(rf.ok && rf.provedor === "openrouter").toBe(false);
    const dentro = await montar({ modelo: { tipos: ["implementar"] } });
    expect(await dentro.h.portaRota.rotear(pedido(dentro.ws.id))).toMatchObject({ ok: true, provedor: "openrouter" });
  });

  it("a equivalência efetiva incorpora os modelos habilitados (por faixa/ordem) e some quando o dono desabilita ou revoga", async () => {
    const m = await montar();
    expect(m.h.equivalenciaEfetiva().provedores["openrouter"]?.topo?.map((e) => e.modelo)).toEqual(["anthropic/claude-x"]);
    m.repos.openrouterModelo.gravarClassificacao({ id: "anthropic/claude-x", habilitado: false, faixa: "topo", tipos_permitidos: [], ordem: 1 });
    expect(m.h.equivalenciaEfetiva().provedores["openrouter"]?.topo ?? []).toEqual([]);
    const revogado = await montar({ consentir: false });
    expect(revogado.h.equivalenciaEfetiva().provedores["openrouter"]?.topo ?? []).toEqual([]);
  });
});
