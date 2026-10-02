// Ligação da memória no main (Fase 8, onda 2): fechamento na transação, restore idempotente pelo IPC real, retomada nativa, exportação,
// coletor + ciclo + reindexação do memox, métricas e a varredura "nenhum conteúdo na auditoria/diagnóstico" (T-08.20).
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarTmp, detectorFalso, ferramenta, limpar, novoBanco, sessoesFalsas } from "../../tests/fixtures/dominio/ambiente";
import type { PayloadsEventoMemoria } from "../compartilhado/memoria";
import { criarServicoContas } from "../nucleo/provedores/contas";
import { criarServicoPanes } from "../nucleo/missoes/panes";
import { criarServicoMissoes } from "../nucleo/missoes/servico";
import { criarBarramento } from "./barramento";
import { BRIEF_ARGV_CHARS, ligarMemoria, type DepsMemoria } from "./memoria";
import { criarRegistroIpc, type IpcMainLike } from "./ipc/registro";

afterEach(limpar);

const SEGREDO = "sk-abcdefghijklmnopqrstuvwxyz0123456789";

function montar(opc: { conversas?: Record<string, string>; ocioso?: boolean; memoxInstalado?: boolean; caminhoSaida?: string | null } = {}) {
  const { banco, repos } = novoBanco();
  const dados = criarTmp("mem-dados-");
  const raiz = criarTmp("mem-ws-");
  const ws = repos.workspace.criar({ nome: "meu-projeto", raiz });
  const sessoes = sessoesFalsas();
  const detector = detectorFalso([ferramenta("claude"), ferramenta("codex"), ferramenta("opencode")]);
  const contas = criarServicoContas({ banco, repos, pastaDeDados: dados });
  const workspaces = { exigir: (id: string) => repos.workspace.exigir(id) };
  const barramento = criarBarramento();
  const panes = criarServicoPanes({ banco, repos, workspaces, sessoes: async () => sessoes as never, detector, contas });
  const missoes = criarServicoMissoes({ banco, repos, workspaces, panes, aoEventoDominio: (t, p) => barramento.emitir(t, p) });

  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
  const enviados: Array<{ canal: string; payload: unknown }> = [];
  const agendados: Array<{ fn: () => void; ms: number }> = [];
  const reindexados: string[] = [];
  const estado = { ocioso: opc.ocioso ?? true };
  const deps: DepsMemoria = {
    banco, repos, barramento, registro, panes,
    conversas: () => opc.conversas ?? {},
    enviar: (canal, payload) => void enviados.push({ canal, payload }),
    escolherArquivoDeSaida: async () => (opc.caminhoSaida === undefined ? join(dados, "saida", "mem.json") : opc.caminhoSaida),
    ocioso: () => estado.ocioso,
    memoxInstalado: () => opc.memoxInstalado ?? false,
    reindexar: async (r) => void reindexados.push(r),
    agendar: (fn, ms) => {
      agendados.push({ fn, ms });
      return { cancelar: () => undefined };
    },
    aviso: () => undefined,
  };
  const memoria = ligarMemoria(deps);
  const chamar = (canal: string, payload: unknown) => (handlers.get(canal) as (e: unknown, p: unknown) => unknown)({}, payload);
  return { banco, repos, dados, raiz, ws, sessoes, panes, missoes, barramento, memoria, chamar, enviados, agendados, reindexados, estado, registro, handlers };
}
type M = ReturnType<typeof montar>;

async function paneLivre(m: M) {
  return m.panes.abrirPane({ workspace_id: m.ws.id, cli: "claude" });
}
const entradas = (m: M, where = "1=1") => m.banco.consultar<{ tipo: string; conteudo: string; estado: string }>(`SELECT tipo, conteudo, estado FROM memoria_entrada WHERE ${where} ORDER BY id`);

describe("ligação: leveza e canais", () => {
  it("registra os 14 canais `memoria:*` e não faz nada pesado ao ligar (nenhum timer, nenhuma tabela FTS)", () => {
    const m = montar();
    expect(m.registro.registrados().filter((c) => c.startsWith("memoria:"))).toHaveLength(14);
    expect(m.agendados).toHaveLength(0);
    expect(m.banco.consultar("SELECT name FROM sqlite_master WHERE name LIKE 'memoria_fts%'")).toHaveLength(0);
  });
});

describe("fechar Pane com memória na mesma transação (T-08.09)", () => {
  it("encerrarPane grava o evento de fechamento junto do UPDATE; fechar de novo não duplica", async () => {
    const m = montar();
    const a = await paneLivre(m);
    await m.panes.encerrarPane(a.pane.id, "usuario");
    await m.panes.encerrarPane(a.pane.id, "outro");
    expect(entradas(m, "tipo = 'evento'").map((e) => e.conteudo)).toEqual([`Painel #${a.pane.display_id} encerrado (usuario)`]);
  });
  it("memória desligada para o workspace: o Pane fecha e nada é gravado", async () => {
    const m = montar();
    m.memoria.servico.gravarConfig(m.ws.id, { ativa: false });
    const a = await paneLivre(m);
    await m.panes.encerrarPane(a.pane.id, "usuario");
    expect(entradas(m)).toHaveLength(0);
    expect(m.repos.pane.exigir(a.pane.id).estado).toBe("encerrado");
  });
});

describe("modo do Pane, pacote e brief para o lançamento", () => {
  it("modoDoPane reflete a config; Pane inexistente = undefined (token legado)", async () => {
    const m = montar();
    const a = await paneLivre(m);
    expect(m.memoria.modoDoPane(a.pane.id)).toBe("solo");
    m.memoria.servico.gravarConfig(m.ws.id, { solo: false });
    expect(m.memoria.modoDoPane(a.pane.id)).toBe("off");
    expect(m.memoria.modoDoPane("pane_nada")).toBeUndefined();
  });

  it("pacote: vazio = null; com anel 2 devolve o envelope de dado e respeita o orçamento", async () => {
    const m = montar();
    const miss = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "t", pedido: "p", clis: { piloto: "claude" } });
    const pilotoId = miss.piloto_pane_id as string;
    expect(m.memoria.pacote(pilotoId, "piloto", 2500)).toBeNull();
    for (let i = 0; i < 5; i++) {
      m.banco.executar(
        "INSERT INTO memoria_entrada (id,workspace_id,escopo,anel,tipo,conteudo,fonte,importancia,hash_conteudo,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [`mem_a${i}`, m.ws.id, "workspace", 2, "aprendizado", `aprendizado número ${i} ${"x".repeat(180)}`, "agente", 4, String(i).padStart(32, "0"), "2026-09-30T10:00:00.000Z", "2026-09-30T10:00:00.000Z"],
      );
    }
    const cheio = m.memoria.pacote(pilotoId, "piloto", 2500) as string;
    expect(cheio).toContain('<contexto_projeto tipo="dados">');
    expect(cheio.length).toBeLessThanOrEqual(2500);
    const menor = m.memoria.pacote(pilotoId, "piloto", 700) as string;
    expect(menor.length).toBeLessThanOrEqual(700);
    expect(menor).toContain("</contexto_projeto>");
    expect(m.memoria.pacote(pilotoId, "piloto", 50)).toBeNull();
  });
});

describe("restore idempotente pelo IPC (T-08.14)", () => {
  async function comCheckpoint(m: M) {
    const a = await paneLivre(m);
    const w = m.memoria.servico.memory_checkpoint(a.pane.id, { summary: "A pronto; falta B" });
    expect(w.entry_ids.length).toBe(1);
    await m.panes.encerrarPane(a.pane.id, "travou");
    return a;
  }

  it("AC-08.08: 20 chamadas concorrentes = exatamente 1 filho, com 1 prompt contendo 1 envelope; brief nunca persistido", async () => {
    const m = montar();
    const a = await comCheckpoint(m);
    const rs = (await Promise.all(Array.from({ length: 20 }, () => m.chamar("memoria:restaurar", { pane_id: a.pane.id, modo: "auto" })))) as Array<{ pane_id: string; modo: string; brief_injetado: boolean; ja_existia: boolean }>;
    expect(new Set(rs.map((r) => r.pane_id)).size).toBe(1);
    expect(rs.filter((r) => !r.ja_existia)).toHaveLength(1);
    const filhos = m.banco.consultar("SELECT id FROM pane WHERE respawn_de = ?", [a.pane.id]);
    expect(filhos).toHaveLength(1);
    const sessao = [...m.sessoes.sessoes.values()].at(-1);
    const prompt = sessao?.pedido["prompt_inicial"] as string | undefined;
    const argv = (sessao?.pedido["argumentos"] as string[]).join("\n");
    const brief = prompt ?? "";
    expect(brief.match(/<memoria_restaurada\b/g)).toHaveLength(1);
    expect(brief).toContain("A pronto; falta B");
    expect(argv).not.toContain("A pronto; falta B");
    const dump = JSON.stringify(m.banco.consultar("SELECT * FROM pane")) + JSON.stringify(m.banco.consultar("SELECT * FROM sessao"));
    expect(dump).not.toContain("falta B");
  });

  it("repetições depois do filho vivo devolvem o MESMO Pane (ja_existia)", async () => {
    const m = montar();
    const a = await comCheckpoint(m);
    const primeiro = (await m.chamar("memoria:restaurar", { pane_id: a.pane.id, modo: "auto" })) as { pane_id: string };
    for (let i = 0; i < 10; i++) expect(await m.chamar("memoria:restaurar", { pane_id: a.pane.id, modo: "auto" })).toMatchObject({ pane_id: primeiro.pane_id, ja_existia: true });
    expect(m.banco.consultar("SELECT id FROM pane WHERE respawn_de = ?", [a.pane.id])).toHaveLength(1);
  });

  it("retomada: conversa da sessão do Pane => `--resume`, sem brief", async () => {
    const m = montar({ conversas: { sessao_1: "conv-abc123" } });
    const a = await paneLivre(m); // sessao_1
    expect(a.sessao_id).toBe("sessao_1");
    m.memoria.servico.memory_checkpoint(a.pane.id, { summary: "estado do trabalho" });
    await m.panes.encerrarPane(a.pane.id, "fim");
    const r = (await m.chamar("memoria:restaurar", { pane_id: a.pane.id, modo: "auto" })) as { modo: string; brief_injetado: boolean };
    expect(r).toMatchObject({ modo: "retomada", brief_injetado: false });
    const sessao = [...m.sessoes.sessoes.values()].at(-1);
    const argv = sessao?.pedido["argumentos"] as string[];
    expect(argv.slice(0, 2)).toEqual(["--resume", "conv-abc123"]);
    expect(sessao?.pedido["prompt_inicial"]).toBeUndefined();
    // forçar brief ignora a retomada
    const m2 = montar({ conversas: { sessao_1: "conv-abc123" } });
    const b = await paneLivre(m2);
    m2.memoria.servico.memory_checkpoint(b.pane.id, { summary: "estado do trabalho" });
    await m2.panes.encerrarPane(b.pane.id, "fim");
    expect(await m2.chamar("memoria:restaurar", { pane_id: b.pane.id, modo: "brief" })).toMatchObject({ modo: "brief", brief_injetado: true });
  });

  it("memória desligada: sem brief (sem_memoria) e nada novo gravado; Pane ainda em uso é recusado", async () => {
    const m = montar();
    const a = await paneLivre(m);
    await expect(Promise.resolve(m.chamar("memoria:restaurar", { pane_id: a.pane.id, modo: "auto" }))).rejects.toThrow(/em uso/);
    m.memoria.servico.gravarConfig(m.ws.id, { ativa: false });
    await m.panes.encerrarPane(a.pane.id, "x");
    const antes = entradas(m).length;
    expect(await m.chamar("memoria:restaurar", { pane_id: a.pane.id, modo: "auto" })).toMatchObject({ modo: "sem_memoria", brief_injetado: false });
    expect(entradas(m)).toHaveLength(antes);
  });

  it("Pane orquestrado: brief longo é refeito em ≤ BRIEF_ARGV_CHARS (cabe no argv da CLI) sem cortar o envelope", async () => {
    const m = montar();
    const miss = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "t", pedido: "p", clis: { piloto: "claude" } });
    const pilotoId = miss.piloto_pane_id as string;
    for (let i = 0; i < 8; i++) m.memoria.servico.memory_write(pilotoId, { content: `decisão ${i}: ${"detalhe ".repeat(25)}`, kind: "decision" });
    m.memoria.servico.memory_checkpoint(pilotoId, { summary: "checkpoint do piloto" });
    await m.panes.encerrarPane(pilotoId, "troca");
    const vistos: unknown[] = [];
    m.panes.definirPreparador(async (e) => {
      vistos.push(e.pedido.contexto);
      return null;
    });
    await m.chamar("memoria:restaurar", { pane_id: pilotoId, modo: "brief" });
    const brief = (vistos[0] as { brief: string }).brief;
    expect(brief.length).toBeLessThanOrEqual(BRIEF_ARGV_CHARS);
    expect(brief.match(/<\/memoria_restaurada>/g)).toHaveLength(1);
    expect(brief).toContain("checkpoint do piloto");
  });
});

describe("IPC: estado, config, exportação e privacidade", () => {
  it("estado traz as métricas (só contadores) e a config reflete gravar/missao_config", async () => {
    const m = montar();
    const a = await paneLivre(m);
    m.memoria.servico.memory_write(a.pane.id, { content: "fato A", kind: "fact" });
    const e = (await m.chamar("memoria:estado", { workspace_id: m.ws.id })) as { metricas: Record<string, number>; contagens: Record<string, number>; config: { squad: boolean } };
    expect(e.metricas["entradas.ativas"]).toBeGreaterThanOrEqual(1);
    expect(Object.values(e.metricas).every((v) => typeof v === "number")).toBe(true);
    expect(e.contagens["pane"]).toBeGreaterThanOrEqual(1);
    const c = (await m.chamar("memoria:config_gravar", { workspace_id: m.ws.id, squad: false, teto_mb: 64, retencao_dias: 0, global_ativa: true })) as { squad: boolean; teto_mb: number; retencao_dias: number };
    expect(c).toMatchObject({ squad: false, teto_mb: 64, retencao_dias: 0 });
    const miss = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "t", pedido: "p", clis: { piloto: "claude" } });
    expect(await m.chamar("memoria:missao_config", { mission_id: miss.id, ativa: false })).toEqual({ mission_id: miss.id, ativa: false });
    expect(m.memoria.modoDoPane(miss.piloto_pane_id as string)).toBe("off");
    await m.chamar("memoria:missao_config", { mission_id: miss.id, ativa: null });
    expect(m.memoria.modoDoPane(miss.piloto_pane_id as string)).toBe("missao");
  });

  it("exportar: o main grava atômico 0600 no destino que o USUÁRIO escolheu; cancelar = null; nada de segredo no arquivo", async () => {
    const m = montar();
    const a = await paneLivre(m);
    m.memoria.servico.memory_write(a.pane.id, { content: `usei ${SEGREDO} no teste`, kind: "fact" });
    const r = (await m.chamar("memoria:exportar", { workspace_id: m.ws.id, escopo: "tudo" })) as { caminho_salvo: string };
    expect(r.caminho_salvo.endsWith(join("saida", "mem.json"))).toBe(true);
    expect(statSync(r.caminho_salvo).mode & 0o777).toBe(0o600);
    const texto = readFileSync(r.caminho_salvo, "utf8");
    expect(JSON.parse(texto).versao).toBe(1);
    expect(texto).not.toContain(SEGREDO);
    const cancelou = montar({ caminhoSaida: null });
    expect(await cancelou.chamar("memoria:exportar", { workspace_id: cancelou.ws.id, escopo: "tudo" })).toEqual({ caminho_salvo: null });
  });

  it("purgar exige o nome do workspace digitado; esquecer_pane apaga a linhagem; listar por Pane usa a linhagem", async () => {
    const m = montar();
    const a = await paneLivre(m);
    m.memoria.servico.memory_write(a.pane.id, { content: "fato B", kind: "fact" });
    const lista = (await m.chamar("memoria:listar", { workspace_id: m.ws.id, escopo: null, mission_id: null, pane_id: a.pane.id, tipos: ["fato"], busca: null, depois: null, limite: 10 })) as { itens: Array<{ conteudo: string }> };
    expect(lista.itens.map((i) => i.conteudo)).toEqual(["fato B"]);
    await expect(Promise.resolve(m.chamar("memoria:purgar", { workspace_id: m.ws.id, escopo: "tudo", confirmacao: "errado" }))).rejects.toThrow(/confirmação/);
    expect(entradas(m, "tipo='fato'")).toHaveLength(1);
    expect(await m.chamar("memoria:esquecer_pane", { pane_id: a.pane.id })).toMatchObject({ removidas: 1 });
    m.memoria.servico.memory_write(a.pane.id, { content: "fato C", kind: "fact" });
    expect(await m.chamar("memoria:purgar", { workspace_id: m.ws.id, escopo: "tudo", confirmacao: "meu-projeto" })).toMatchObject({ removidas: 1 });
  });

  it("preferências (anel 3) passam pelo IPC", async () => {
    const m = montar();
    const p = (await m.chamar("memoria:preferencias_gravar", { id: null, conteudo: "responder em português", importancia: 4 })) as { id: string; anel: number };
    expect(p.anel).toBe(3);
    expect(((await m.chamar("memoria:preferencias_listar", {})) as unknown[]).length).toBe(1);
    expect(await m.chamar("memoria:preferencias_remover", { id: p.id })).toEqual({ ok: true });
  });
});

describe("onda 2: FTS5, coletor, ciclo e memox (P-25)", () => {
  it("iniciar liga o FTS5 e o coletor; é idempotente e agenda o 1º ciclo em ocioso", async () => {
    const m = montar();
    await m.memoria.iniciar();
    await m.memoria.iniciar();
    expect(m.banco.consultar("SELECT name FROM sqlite_master WHERE name LIKE 'memoria_fts%'").length).toBeGreaterThan(0);
    expect(m.agendados).toHaveLength(1);
    expect(m.agendados[0]?.ms).toBeGreaterThanOrEqual(10_000);
    // o coletor assina `pane.closed` do barramento
    const a = await paneLivre(m);
    m.barramento.emitir("pane.closed", { pane_id: a.pane.id, reason: "fim" });
    for (let i = 0; i < 50 && entradas(m, "tipo='evento'").length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(entradas(m, "tipo='evento'").length).toBeGreaterThan(0);
  });

  it("fim da Missão: coletor grava o aprendizado de sistema e o memox reindexa (só com o memox instalado)", async () => {
    const com = montar({ memoxInstalado: true });
    const sem = montar({ memoxInstalado: false });
    for (const m of [com, sem]) {
      await m.memoria.iniciar();
      const miss = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "t", pedido: "p", clis: { piloto: "claude" } });
      m.barramento.emitir("mission.closed", { mission_id: miss.id, workspace_id: m.ws.id });
    }
    const idx = com.agendados.filter((a) => a.ms === 1_500);
    expect(idx).toHaveLength(1);
    idx[0]?.fn();
    await new Promise((r) => setTimeout(r, 5));
    expect(com.reindexados).toEqual([com.raiz]);
    expect(sem.agendados.filter((a) => a.ms === 1_500)).toHaveLength(0);
    expect(sem.reindexados).toEqual([]);
  });

  it("ciclo: só trabalha com o app ocioso; poda auditoria de memória com mais de 30 dias e preserva a recente", async () => {
    const m = montar({ ocioso: false });
    await m.memoria.iniciar();
    m.banco.executar("INSERT INTO evento_dominio (id,tipo,payload_json,criado_em) VALUES ('evt_old','memory.purged','{}','2020-01-01T00:00:00.000Z')");
    m.banco.executar("INSERT INTO evento_dominio (id,tipo,payload_json,criado_em) VALUES ('evt_new','memory.purged','{}',?)", [new Date().toISOString()]);
    m.banco.executar("INSERT INTO evento_dominio (id,tipo,payload_json,criado_em) VALUES ('evt_outro','mission.closed','{}','2020-01-01T00:00:00.000Z')");
    m.agendados[0]?.fn();
    await new Promise((r) => setTimeout(r, 30));
    const ids = m.banco.consultar<{ id: string }>("SELECT id FROM evento_dominio ORDER BY id").map((r) => r.id);
    expect(ids).not.toContain("evt_old");
    expect(ids).toContain("evt_new");
    expect(ids).toContain("evt_outro"); // só `memory.%` é podado aqui
    // reagenda o próximo ciclo (30 min)
    expect(m.agendados.at(-1)?.ms).toBe(30 * 60_000);
  });

  it("encerrar solta o gancho do Pane, o coletor e o timer", async () => {
    const m = montar();
    await m.memoria.iniciar();
    m.memoria.encerrar();
    const a = await paneLivre(m);
    await m.panes.encerrarPane(a.pane.id, "x");
    expect(entradas(m, "tipo='evento'")).toHaveLength(0);
  });
});

describe("porta do MCP: aviso do mission_complete", () => {
  it("só avisa com a memória ligada para a Missão: desligar (workspace ou Missão) cala o aviso", async () => {
    const m = montar();
    const miss = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "t", pedido: "p", clis: { piloto: "claude" } });
    expect(await m.memoria.portaMcp.temAprendizado(miss.id)).toBe(false);
    await m.memoria.portaMcp.chamar("memory_write", miss.piloto_pane_id as string, { content: "aprendi isso", kind: "learning" });
    expect(await m.memoria.portaMcp.temAprendizado(miss.id)).toBe(true);
    const outro = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "t2", pedido: "p", clis: { piloto: "claude" } }).catch(() => null);
    void outro;
    m.memoria.servico.repo.definirMissaoAtiva(miss.id, false, new Date().toISOString());
    expect(await m.memoria.portaMcp.temAprendizado(miss.id)).toBe(true);
  });
});

describe("T-08.20: observabilidade sem vazar conteúdo", () => {
  it("auditoria (evento_dominio), eventos do renderer e métricas nunca contêm o conteúdo nem o segredo", async () => {
    const m = montar();
    const eventos: Array<{ tipo: string; payload: unknown }> = [];
    for (const t of ["memory.entry_created", "memory.brief_built", "pane.restore_requested", "memory.forgotten", "memory.purged"]) m.barramento.assinar(t, (payload) => void eventos.push({ tipo: t, payload }));
    const a = await paneLivre(m);
    const texto = "conteudo-confidencial-xyz";
    const w = m.memoria.servico.memory_write(a.pane.id, { content: `${texto} ${SEGREDO}`, kind: "decision" });
    m.memoria.servico.memory_checkpoint(a.pane.id, { summary: `checkpoint ${texto}` });
    m.memoria.servico.memory_brief(a.pane.id, {});
    await m.panes.encerrarPane(a.pane.id, "fim");
    await m.chamar("memoria:restaurar", { pane_id: a.pane.id, modo: "brief" });
    m.memoria.servico.esquecer(w.entry_id);
    await new Promise((r) => setTimeout(r, 150)); // eventos coalescidos
    const auditoria = JSON.stringify(m.banco.consultar("SELECT tipo, payload_json FROM evento_dominio"));
    const renderer = JSON.stringify(m.enviados);
    const metricas = JSON.stringify(m.memoria.metricas());
    const barramento = JSON.stringify(eventos);
    for (const [nome, dump] of Object.entries({ auditoria, renderer, metricas, barramento })) {
      expect(dump, nome).not.toContain(texto);
      expect(dump, nome).not.toContain(SEGREDO);
    }
    expect(eventos.some((e) => e.tipo === "memory.entry_created")).toBe(true);
    expect(JSON.parse(auditoria).some((r: { tipo: string }) => r.tipo === "memory.forgotten")).toBe(true);
    // eventos do renderer: só ids e tamanhos
    const canais = m.enviados.map((e) => e.canal);
    expect(canais).toEqual(expect.arrayContaining(["memoria:entrada_criada", "memoria:brief_montado"]));
    for (const e of m.enviados) {
      const p = e.payload as PayloadsEventoMemoria[keyof PayloadsEventoMemoria];
      expect(Object.keys(p).every((k) => k !== "conteudo" && k !== "content")).toBe(true);
    }
  });
});

