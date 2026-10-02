// Delegar card (Fase 10, T-10.19) de ponta a ponta no main: ligarCusto + porta real (`custo-delegar.ts`) sobre banco real. O spawn imita a orquestração (cria/reaproveita a
// `task` pelo `task_ref` e a reivindica). Prova: não burla WIP, Missão (livre/sem worktree/encerrada), limite de workers nem a unicidade do card; `docs/**` intacto.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../nucleo/banco";
import { criarRepositorios } from "../nucleo/banco/repos";
import { NaoEncontradoErro } from "../nucleo/dominio";
import type { IndiceProjeto } from "../nucleo/metodo/tipos";
import type { PedidoSpawn, PortaRota, ResultadoRotaSpawn } from "../nucleo/mcp/portas";
import { PRODUTO } from "../nucleo/produto";
import { criarBarramento, type Agendador } from "./barramento";
import { ligarCusto } from "./custo";
import { criarPortaDelegar } from "./custo-delegar";

const abertos: Banco[] = [];
const pastas: string[] = [];
afterEach(() => {
  abertos.splice(0).forEach((b) => b.fechar());
  pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});
const AGORA = new Date("2026-06-10T12:00:00.000Z");
const agendador: Agendador = { setTimeout: () => 0, clearTimeout: () => undefined };
const task = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, titulo: `T ${id}`, fase: "F1", status, depende_de: [], paralelizavel: false, suite: "nao_executada", concluida_em: null, objetivo: "fazer X", criterio_aceite: "X feito", teste_integracao: null, teste_funcional: null, teste_regressao: null, arquivo: `docs/sprintx/${id}.md`, duracao_observada_ms: null, ...extra });
const indice = (tasks: ReturnType<typeof task>[]): IndiceProjeto => ({ trabalhos: [{ id: "w1", tipo: "feature", titulo: "Trabalho 1", veredito_qa: null, veredito_auditoria: null, violacoes: [], ultima_atividade: "2026-06-10T00:00:00.000Z", sprints: [{ id: "s1", fases: [{ id: "F1", tasks }] }] }] }) as unknown as IndiceProjeto;

const ROTA_OK: ResultadoRotaSpawn = { ok: true, provedor: "claude", cli: "claude", modelo: "claude-sonnet-4-5", esforco: null, conta_id: null, faixa: "medio", task_type: "implementar", recibo: "implementar: claude medio", decisoes: [], skills: [], decisao_id: null };

function montar(opc: { tasks?: ReturnType<typeof task>[]; modo?: "livre" | "squad" | "agentico"; worktree?: boolean; estado?: string; semRota?: boolean; falharSpawn?: boolean; vivos?: number; rag?: { modo: "off" | "aviso" | "bloqueio"; contexto_chars: number; consultou?: boolean } } = {}) {
  const avisos: string[] = [];
  const banco = abrirBanco(":memory:");
  abertos.push(banco);
  migrar(banco);
  const raiz = mkdtempSync(join(tmpdir(), "delegar-"));
  pastas.push(raiz);
  mkdirSync(join(raiz, "wt"), { recursive: true });
  const r = criarRepositorios(banco);
  const ws = r.workspace.criar({ nome: "w", raiz });
  const mis = r.mission.criar({ workspace_id: ws.id, modo: opc.modo ?? "agentico", origem: "feature", titulo: "M1", trabalho_id: "w1" });
  if (opc.worktree !== false) banco.executar("UPDATE mission SET worktree = 'wt' WHERE id = ?", [mis.id]);
  if (opc.estado !== undefined) banco.executar("UPDATE mission SET estado = ? WHERE id = ?", [opc.estado, mis.id]);
  const piloto = r.pane.criar({ workspace_id: ws.id, mission_id: mis.id, tipo: "cli", cli: "claude", papel: "piloto", eh_piloto: true });
  for (let i = 0; i < (opc.vivos ?? 0); i++) r.pane.criar({ workspace_id: ws.id, mission_id: mis.id, tipo: "cli", cli: "claude", papel: "executor" });
  const spawns: PedidoSpawn[] = [];
  const gravadas: string[] = [];
  const rota: PortaRota = { nivel: async () => 3, rotear: async () => ROTA_OK, gravar: async (paneId) => void gravadas.push(paneId) };
  const porta = criarPortaDelegar({
    banco,
    task: r.task,
    raizDoWorkspace: () => raiz,
    spawn: () => async (p) => {
      spawns.push(p);
      if (opc.falharSpawn === true) {
        // a orquestração real descarta o card que acabou de criar/reaproveitar quando o Pane não abre
        const t = banco.consultarUm<{ id: string }>("SELECT id FROM task WHERE mission_id = ? AND task_ref = ?", [p.mission_id, p.task_ref ?? ""]);
        if (t) r.task.mudarEstado(t.id, "descartada");
        throw new Error("CLI ausente em /Users/x/segredo");
      }
      const pane = r.pane.criar({ workspace_id: p.workspace_id, mission_id: p.mission_id as string, tipo: "cli", cli: p.provedor, papel: "executor" });
      const t = banco.consultarUm<{ id: string }>("SELECT id FROM task WHERE mission_id = ? AND task_ref = ?", [p.mission_id, p.task_ref ?? ""]);
      if (t) r.task.mudarEstado(t.id, "reivindicada", { pane_id: pane.id });
      return { pane_id: pane.id };
    },
    rota: () => (opc.semRota === true ? null : rota),
    ...(opc.rag === undefined
      ? {}
      : {
          rag: () => ({ ativo: async () => true, politica: async () => ({ consulta_obrigatoria: opc.rag!.modo, hook_prompt: false, contexto_chars: opc.rag!.contexto_chars }), consultouRecentemente: async () => opc.rag!.consultou === true }),
          avisar: (msg: string) => void avisos.push(msg),
        }),
  });
  const tasks = opc.tasks ?? [task("T-01.01", "pendente"), task("T-01.02", "pendente", { depende_de: ["T-01.01"] })];
  const l = ligarCusto({
    banco,
    workspace: (id) => {
      if (id !== ws.id) throw new NaoEncontradoErro("Workspace", id);
      return { id: ws.id, raiz };
    },
    metodo: { garantir: async () => undefined, indices: async () => new Map([[raiz, indice(tasks)]]), rastro: async () => ({ eventos: [], proximo: 0 }) },
    barramento: criarBarramento(agendador),
    emitirRenderer: () => undefined,
    relogio: () => AGORA,
    delegar: () => porta,
  });
  const pedido = (id = "T-01.01") => ({ workspace_id: ws.id, mission_id: mis.id, trabalho_id: "w1", task_id: id, confirmar: true as const });
  return { banco, r, ws, mis, piloto, l, raiz, spawns, gravadas, pedido, avisos };
}
async function erro(p: Promise<unknown>): Promise<{ codigo: string; sub: string | null }> {
  try {
    await p;
  } catch (e) {
    const x = e as { codigo?: string; subcodigo?: string | null };
    return { codigo: x.codigo ?? "?", sub: x.subcodigo ?? null };
  }
  throw new Error("não falhou");
}
const nTasks = (m: ReturnType<typeof montar>): number => m.banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM task", [])?.n ?? 0;

describe("board:delegar_card com a porta real", () => {
  it("card pronto: briefing na pasta do produto, task com a referência do card, Pane pelo roteador (task_type implementar) e recibo; docs/** intacto", async () => {
    const m = montar();
    const r = await m.l.board().delegar(m.pedido());
    expect(r).toMatchObject({ task_ref: "T-01.01", recibo: "implementar: claude medio" });
    expect(m.spawns[0]).toMatchObject({ mission_id: m.mis.id, papel: "executor", provedor: "claude", task_ref: "T-01.01", cwd: null, briefing_path: `${PRODUTO.pastaNoProjeto}/missoes/${m.mis.id}/briefing-T-01.01.md` });
    const brief = readFileSync(join(m.raiz, "wt", m.spawns[0]?.briefing_path as string), "utf8");
    expect(brief).toContain("## Contrato");
    expect(brief).toContain("fazer X");
    expect(existsSync(join(m.raiz, "docs"))).toBe(false);
    expect(existsSync(join(m.raiz, "wt", "docs"))).toBe(false);
    const t = m.r.task.listarPorMissao(m.mis.id).itens;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ task_ref: "T-01.01", estado: "reivindicada", papel: "executor", pane_id: r.pane_id });
    expect(m.gravadas).toEqual([r.pane_id]);
  });

  it("P-80: teto estourado só bloqueia com a opção do workspace ligada; nada em andamento é interrompido; o recibo leva a estimativa", async () => {
    const m = montar({ tasks: [task("T-01.01", "pendente"), task("T-01.02", "pendente")] });
    const f = m.l.servico().registrarFonte({ cli: "claude", base: "claude_config", relativo: "a.jsonl", pane_id: m.piloto.id, mission_id: m.mis.id, workspace_id: m.ws.id });
    m.l.tetoGravar(m.mis.id, 1);
    m.l.servico().ingerir(f.id, [{ chave: "a", ts: "2026-06-10T10:00:00.000Z", modelo: "claude-sonnet-4-5", tokens: { entrada: 2_000_000, cache_escrita: 0, cache_leitura: 0, saida: 0 } }]);
    // padrão (só alerta): delega normalmente e devolve a estimativa histórica (sem histórico) separada do custo
    const r = await m.l.board().delegar(m.pedido());
    expect(r.estimativa).toMatchObject({ confianca: "sem_historico" });
    // opt-in ligado: o próximo card é recusado, sem criar nada e sem tocar nos Panes existentes
    m.l.board().configGravar(m.ws.id, { wip: {}, bloquear_ao_estourar_teto: true });
    const antes = nTasks(m);
    expect(await erro(m.l.board().delegar(m.pedido("T-01.02")))).toEqual({ codigo: "rule_violation", sub: "ceiling_reached" });
    expect(nTasks(m)).toBe(antes);
    expect(m.r.pane.listarPorMissao(m.mis.id).every((p) => p.estado !== "encerrado")).toBe(true);
  });

  it("sem confirmar não há efeito", async () => {
    const m = montar();
    expect(await erro(m.l.board().delegar({ ...m.pedido(), confirmar: false } as never))).toMatchObject({ codigo: "invalid" });
    expect(nTasks(m)).toBe(0);
    expect(m.spawns).toHaveLength(0);
  });

  it("card já delegado ⇒ conflict e nada novo é criado (índice ux_task_ref)", async () => {
    const m = montar();
    await m.l.board().delegar(m.pedido());
    expect(await erro(m.l.board().delegar(m.pedido()))).toEqual({ codigo: "conflict", sub: "already_delegated" });
    expect(nTasks(m)).toBe(1);
    expect(m.spawns).toHaveLength(1);
  });

  it("card com dependência aberta ⇒ recusa com o motivo (não pronto)", async () => {
    const m = montar();
    expect(await erro(m.l.board().delegar(m.pedido("T-01.02")))).toEqual({ codigo: "rule_violation", sub: "not_ready" });
    expect(nTasks(m)).toBe(0);
  });

  it("NÃO burla o WIP: com o limite de em_andamento atingido a delegação é recusada sem efeito algum", async () => {
    const m = montar({ tasks: [task("T-01.01", "em_andamento"), task("T-01.02", "pendente")] });
    m.l.board().configGravar(m.ws.id, { wip: { em_andamento: 1 } });
    expect(await erro(m.l.board().delegar(m.pedido("T-01.02")))).toEqual({ codigo: "rule_violation", sub: "wip_exceeded" });
    expect(nTasks(m)).toBe(0);
    expect(m.spawns).toHaveLength(0);
    expect(existsSync(join(m.raiz, "wt", PRODUTO.pastaNoProjeto))).toBe(false);
  });

  it.each([
    ["Missão livre", { modo: "livre" as const }],
    ["Missão sem worktree do trabalho", { worktree: false }],
    ["Missão já encerrada", { estado: "concluida" }],
  ])("NÃO burla a permissão: %s é recusada (not_in_mission/mission_closed) sem efeito", async (_n, opc) => {
    const m = montar(opc);
    const e = await erro(m.l.board().delegar(m.pedido()));
    expect(e.codigo).toBe("rule_violation");
    expect(["not_in_mission", "mission_closed"]).toContain(e.sub);
    expect(nTasks(m)).toBe(0);
    expect(m.spawns).toHaveLength(0);
  });

  it("Missão de outro trabalho não recebe o card (not_in_mission)", async () => {
    const m = montar();
    const outra = m.r.mission.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "feature", titulo: "M2", trabalho_id: "outro" });
    m.banco.executar("UPDATE mission SET worktree = 'wt' WHERE id = ?", [outra.id]);
    expect(await erro(m.l.board().delegar({ ...m.pedido(), mission_id: outra.id }))).toEqual({ codigo: "rule_violation", sub: "not_in_mission" });
    expect(nTasks(m)).toBe(0);
  });

  it("limite de workers vivos da Missão (8) vale também para a delegação", async () => {
    const m = montar({ vivos: 8 });
    expect(await erro(m.l.board().delegar(m.pedido()))).toEqual({ codigo: "rule_violation", sub: "limit_reached" });
    expect(m.spawns).toHaveLength(0);
    expect(nTasks(m)).toBe(0); // a linha de task criada antes é desfeita
  });

  it("sem roteador: unavailable/no_router e nenhum card fantasma", async () => {
    const m = montar({ semRota: true });
    expect(await erro(m.l.board().delegar(m.pedido()))).toMatchObject({ codigo: "unavailable" });
    expect(nTasks(m)).toBe(0);
  });

  it("Pane que não abre: erro nominal sem vazar o texto cru e o card pode ser delegado de novo depois", async () => {
    const m = montar({ falharSpawn: true });
    const e = await erro(m.l.board().delegar(m.pedido()));
    expect(e).toEqual({ codigo: "unavailable", sub: "spawn_failed" });
    expect(nTasks(m)).toBe(0); // sem fantasma que trave o `ux_task_ref`
    const m2 = montar();
    await m2.l.board().delegar(m2.pedido());
    expect(nTasks(m2)).toBe(1);
  });
});

describe("regra de consulta ao RAG em aberta→reivindicada (Fase 15 × 10)", () => {
  it("modo bloqueio, injeção desligada e sem consulta ⇒ rule_violation/rag_consult_required, sem Pane e sem task órfã", async () => {
    const m = montar({ rag: { modo: "bloqueio", contexto_chars: 0 } });
    expect(await erro(m.l.board().delegar(m.pedido()))).toEqual({ codigo: "rule_violation", sub: "rag_consult_required" });
    expect(m.spawns).toHaveLength(0);
    expect(nTasks(m)).toBe(0);
  });
  it("modo aviso avisa e segue; injeção ligada nunca bloqueia; consulta recente: segue sem aviso; RAG ausente: igual a antes", async () => {
    const a = montar({ rag: { modo: "aviso", contexto_chars: 0 } });
    await a.l.board().delegar(a.pedido());
    expect(a.avisos).toHaveLength(1);
    expect(a.spawns).toHaveLength(1);
    const b = montar({ rag: { modo: "bloqueio", contexto_chars: 1500 } });
    await b.l.board().delegar(b.pedido());
    const c = montar({ rag: { modo: "bloqueio", contexto_chars: 0, consultou: true } });
    await c.l.board().delegar(c.pedido());
    expect(b.spawns).toHaveLength(1); // injeção ligada: o bloqueio vira só aviso (a injeção registra a consulta)
    expect(c.avisos).toEqual([]);
    const d = montar();
    expect((await d.l.board().delegar(d.pedido())).task_ref).toBe("T-01.01");
  });
});
