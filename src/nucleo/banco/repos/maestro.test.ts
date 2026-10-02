import { afterEach, describe, expect, it } from "vitest";
import { criarMundo } from "../../../../tests/fixtures/maestro/mundo";
import type { EtapaConfig, PipelineEstado } from "../../../compartilhado/maestro";
import { abrirBanco, migrar, type Banco } from "../index";
import { MIGRACOES, VERSAO_SUPORTADA } from "../migracoes";
import { resumirParaDecisor } from "../../harness/decisor/resumo";
import { COMANDO_MAX, criarRepoMaestro, RETENCAO_RECIBO_DIAS } from "./maestro";
import { criarRepoWorkspace } from "./workspace";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
function novo() {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  const ws = criarRepoWorkspace(b).criar({ nome: "w", raiz: "/w" });
  return { b, ws, repo: criarRepoMaestro(b) };
}
async function pipelineReal(workspaceId: string, texto = "corrige, estou com um problema no login: o botão não funciona"): Promise<{ p: PipelineEstado; recibo: ReturnType<ReturnType<typeof criarMundo>["persistencia"]["recibos"]>[number] }> {
  const m = criarMundo();
  const { plano } = await m.servico.pedir({ workspace_id: "ws1", texto, contexto: null, via: "api", nivel_pedido: null, executar_direto: null });
  await m.servico.confirmar(plano.id);
  const p = (await m.persistencia.carregar(plano.id)) as PipelineEstado;
  return { p: { ...p, workspace_id: workspaceId, mission_id: null }, recibo: m.persistencia.recibos()[0]! };
}
const cfg = (etapa: string, o: Partial<EtapaConfig["perfil"]> = {}): EtapaConfig => ({ etapa_id: etapa, perfil: { cli: "claude", modelo: null, esforco: "alto", faixa: "alto", origem_modelo: "cli", agente_id: null, ...o }, skills: ["runx-causa"], modo_execucao: "novo_terminal", atualizado_por: "usuario" });

describe("migration 0010-maestro", () => {
  it("é a versão 10, cria as tabelas do plano e NÃO recria openrouter_modelo (Fase 9)", () => {
    const { b } = novo();
    expect(MIGRACOES[9]?.nome).toBe("0010-maestro");
    expect(VERSAO_SUPORTADA).toBeGreaterThanOrEqual(10);
    const t = b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((x) => x.name);
    expect(t).toEqual(expect.arrayContaining(["maestro_pipeline", "maestro_etapa_exec", "maestro_etapa_config", "maestro_rigidez", "maestro_rigidez_log", "maestro_recibo", "openrouter_modelo"]));
  });
  it("migra do banco da v9 com dados, sem perda", () => {
    const b = abrirBanco(":memory:");
    abertos.push(b);
    migrar(b, { migracoes: MIGRACOES.slice(0, 9) });
    const ws = criarRepoWorkspace(b).criar({ nome: "w", raiz: "/w" });
    const r = migrar(b);
    expect(r.aplicadas).toContain("0010-maestro");
    expect(b.consultarUm("SELECT id FROM workspace WHERE id = ?", [ws.id])).toBeDefined();
  });
  it("CHECKs: estado e nível inválidos são recusados", () => {
    const { b, ws } = novo();
    const base = (estado: string, nivel: number) => () =>
      b.executar("INSERT INTO maestro_pipeline (id,workspace_id,pipeline_id,intencao,estado,via,texto_hash,texto_resumo,nivel_base,nivel_atual,plano_json,criado_em,atualizado_em) VALUES ('x',?,'runx','bug',?,'api','h','r',?,?,'{}','t','t')", [ws.id, estado, nivel, nivel]);
    expect(base("inventado", 3)).toThrow();
    expect(base("proposto", 9)).toThrow();
    expect(base("proposto", 3)).not.toThrow();
  });
});

describe("repo maestro: pipelines e recibos (round-trip da PortaPersistencia)", () => {
  it("grava e relê PipelineEstado e ReciboMaestro iguais, com as execuções (extras inclusos)", async () => {
    const { repo, ws, b } = novo();
    const { p, recibo } = await pipelineReal(ws.id);
    repo.salvarPipeline(p);
    repo.salvarRecibo(recibo, { workspace_id: ws.id, via: "api", sinais: ["bug.corrige"], resumo_enviado: null, resumo_hash: null, criado_em: p.criado_em });
    expect(repo.carregarPipeline(p.id)).toEqual({ ...p, execs: p.execs.map((e) => ({ ...e, comando: e.comando === null ? null : resumirParaDecisor(e.comando, { max: COMANDO_MAX }) })) });
    expect(repo.lerRecibo(p.id)).toEqual(recibo);
    expect(b.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM maestro_etapa_exec WHERE pipeline_id = ?", [p.id])?.n).toBe(p.execs.length);
  });
  it("salvar de novo reescreve as execuções sem duplicar; ativos só trazem os não terminais", async () => {
    const { repo, ws, b } = novo();
    const { p } = await pipelineReal(ws.id);
    repo.salvarPipeline(p);
    repo.salvarPipeline({ ...p, execs: p.execs.slice(0, 2) });
    expect(b.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM maestro_etapa_exec")?.n).toBe(2);
    expect(repo.listarAtivos(ws.id)).toHaveLength(1);
    expect(repo.listarAtivos(null)).toHaveLength(1);
    repo.salvarPipeline({ ...p, estado: "concluido", concluido_em: p.criado_em });
    expect(repo.listarAtivos(ws.id)).toHaveLength(0);
    expect(repo.listarPipelines(ws.id, false, 10)).toHaveLength(1);
    expect(repo.listarPipelines(ws.id, true, 10)).toHaveLength(0);
  });
  it("o texto do pedido nunca vai ao banco (só o resumo)", async () => {
    const { repo, ws, b } = novo();
    const cauda = "FIM-DO-TEXTO-LONGO-QUE-NAO-PODE-IR-AO-BANCO";
    const { p } = await pipelineReal(ws.id, `corrige o erro do login ${"detalhe do problema ".repeat(20)} ${cauda}`);
    repo.salvarPipeline(p);
    const todo = JSON.stringify([b.consultar("SELECT * FROM maestro_pipeline"), b.consultar("SELECT * FROM maestro_etapa_exec")]);
    expect(todo).not.toContain(cauda);
    expect(p.texto_resumo.length).toBeLessThanOrEqual(200);
    const segredo = ["sk", "-or-v1-", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].join("");
    const { p: p2 } = await pipelineReal(ws.id, `corrige o login, a chave ${segredo} vazou`);
    repo.salvarPipeline({ ...p2, id: "mpl_seg" });
    expect(JSON.stringify(b.consultar("SELECT * FROM maestro_etapa_exec WHERE pipeline_id = 'mpl_seg'"))).not.toContain(segredo);
  });
  it("apagar o workspace apaga o pipeline e as execuções (CASCADE)", async () => {
    const { repo, ws, b } = novo();
    const { p } = await pipelineReal(ws.id);
    repo.salvarPipeline(p);
    b.executar("DELETE FROM workspace WHERE id = ?", [ws.id]);
    expect(repo.carregarPipeline(p.id)).toBeNull();
    expect(b.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM maestro_etapa_exec")?.n).toBe(0);
  });
  it("consulta quente (listar ativos com 30 pipelines) ≤ 5 ms por pipeline em média (P-14/P-223)", async () => {
    const { repo, ws } = novo();
    const { p } = await pipelineReal(ws.id);
    for (let i = 0; i < 30; i++) repo.salvarPipeline({ ...p, id: `mpl_x${i}` });
    const t0 = performance.now();
    expect(repo.listarAtivos(ws.id)).toHaveLength(30);
    expect((performance.now() - t0) / 30).toBeLessThan(5);
  });
});

describe("repo maestro: configuração, rigidez, auditoria e retenção", () => {
  it("config por etapa: global e override do workspace independentes; restaurar apaga só o escopo", () => {
    const { repo, ws } = novo();
    repo.gravarConfig(null, cfg("runx.e1", { modelo: "opus" }));
    repo.gravarConfig(ws.id, cfg("runx.e1", { modelo: "haiku" }));
    repo.gravarConfig(ws.id, cfg("runx.e1", { modelo: "sonnet" }));
    expect(repo.listarConfig(null).map((l) => l.config.perfil.modelo)).toEqual(["opus"]);
    expect(repo.listarConfig(ws.id).map((l) => l.config.perfil.modelo)).toEqual(["sonnet"]);
    expect(repo.restaurarConfig(ws.id, "runx.e1")).toBe(1);
    expect(repo.listarConfig(ws.id)).toEqual([]);
    expect(repo.listarConfig(null)).toHaveLength(1);
  });
  it("rigidez por escopo: nível inválido recusado; remover volta ao padrão", () => {
    const { repo, ws } = novo();
    expect(repo.lerRigidez("workspace", ws.id)).toBeNull();
    repo.gravarRigidez("workspace", ws.id, 2);
    expect(repo.lerRigidez("workspace", ws.id)).toEqual({ nivel: 2, voltar_ao_padrao: false });
    expect(() => repo.gravarRigidez("workspace", ws.id, 9 as never)).toThrow();
    repo.removerRigidez("workspace", ws.id);
    expect(repo.lerRigidez("workspace", ws.id)).toBeNull();
  });
  it("auditoria: grava e lista; retenção apaga recibos vencidos (90 d) e log (365 d) em lote", async () => {
    const { repo, ws, b } = novo();
    repo.registrarRigidezLog({ ts: "2020-01-01T00:00:00.000Z", workspace_id: ws.id, pipeline_id: null, etapa_atual: null, escopo: "workspace", de: 3, para: 2, por: "usuario", trava: null, justificativa: null, hooks_escritos: false });
    repo.registrarRigidezLog({ ts: new Date().toISOString(), workspace_id: ws.id, pipeline_id: null, etapa_atual: null, escopo: "workspace", de: 2, para: 3, por: "usuario", trava: null, justificativa: null, hooks_escritos: true });
    expect(repo.listarRigidezLog(ws.id, 10)).toHaveLength(2);
    const { recibo } = await pipelineReal(ws.id);
    repo.salvarRecibo({ ...recibo, pipeline_id: null }, { workspace_id: ws.id, via: "api", sinais: [], resumo_enviado: null, resumo_hash: null, criado_em: new Date(Date.now() - (RETENCAO_RECIBO_DIAS + 1) * 86_400_000).toISOString() });
    expect(repo.purgarLote(Date.now())).toBe(2);
    expect(repo.purgarLote(Date.now())).toBe(0);
    expect(repo.listarRigidezLog(ws.id, 10)).toHaveLength(1);
    expect(b.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM maestro_recibo")?.n).toBe(0);
  });
});
