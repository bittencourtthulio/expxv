// Auditoria da Fase 18 (docs/ade/AUDITORIA-AGIL.md): IA com dado sensível, ação humana forjada por agente, cálculo manipulável e vazamento entre workspaces.
// Cada achado corrigido tem aqui o teste que o impede de voltar.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WS_A, WS_B, montarAgil, metodoDaFixture, type MontagemAgil } from "../../tests/fixtures/agil/montagem-main";
import { ocorrencias, todasAsFontes } from "../../tests/fixtures/agil/gerar";
import type { FonteTrabalho } from "../nucleo/agil/portas";
import type { ClaimsDeAgil } from "../nucleo/mcp/portas";
import type { PortaMetodoMain } from "./agil-metodo";

const abertos: MontagemAgil[] = [];
afterEach(() => abertos.splice(0).forEach((m) => m.fechar()));
const novo = (o: Parameters<typeof montarAgil>[0] = {}): MontagemAgil => { const m = montarAgil(o); abertos.push(m); return m; };
const piloto = (ws: string, mode: ClaimsDeAgil["mode"] = "agentico"): ClaimsDeAgil => ({ workspace_id: ws, mission_id: "mis_1", pane_id: "pane_1", role: "piloto", mode });

/** método que serve fatias DIFERENTES (com nomes de trabalho repetidos) para cada workspace. */
function metodoPorWorkspace(fatias: Record<string, [number, number]>): PortaMetodoMain {
  const todas = todasAsFontes();
  return {
    fontes: async (ws) => { const [a, b] = fatias[ws] ?? [0, 0]; return todas.slice(a, b) as FonteTrabalho[]; },
    ocorrencias: async () => ocorrencias(),
    historicoSprintx: async () => null,
    esquecer: () => undefined,
    bloqueiosAbertos: () => 0,
  };
}
/** remove o que é identidade/tempo para comparar o CONTEÚDO de duas execuções. */
const normal = (o: unknown): unknown => JSON.parse(JSON.stringify(o, (k, v) => (["gerado_em", "id", "item_id", "sprint_id", "criado_em", "atualizado_em", "detectado_em", "calculado_em", "versao_origem", "registrado_em"].includes(k) ? undefined : v)));

describe("vazamento entre workspaces", () => {
  it("os dados de A não mudam quando B é sincronizado (mesmos nomes de trabalho nos dois): painel, backlog, retrabalho, práticas, exportação", async () => {
    const fatias = { [WS_A]: [0, 20], [WS_B]: [8, 40] } as Record<string, [number, number]>;
    const sozinho = novo({ workspaces: [WS_A], metodo: metodoPorWorkspace(fatias) });
    sozinho.servico.sincronizar(WS_A); await sozinho.servico.aguardarSincronizacao(WS_A);

    const junto = novo({ workspaces: [WS_A, WS_B], metodo: metodoPorWorkspace(fatias) });
    junto.servico.sincronizar(WS_B); await junto.servico.aguardarSincronizacao(WS_B);
    junto.servico.sincronizar(WS_A); await junto.servico.aguardarSincronizacao(WS_A);

    const lista = (m: MontagemAgil, ws: string) => m.servico.backlogListar(ws, { limite: 200 });
    expect(lista(junto, WS_A).total).toBe(lista(sozinho, WS_A).total);
    expect(normal(lista(junto, WS_A).itens.map((i) => ({ ...i, ordem: 0 })))).toEqual(normal(lista(sozinho, WS_A).itens.map((i) => ({ ...i, ordem: 0 }))));
    expect(normal(junto.servico.painel(WS_A))).toEqual(normal(sozinho.servico.painel(WS_A)));
    expect(normal(junto.servico.praticas(WS_A, null))).toEqual(normal(sozinho.servico.praticas(WS_A, null)));
    // mesmo nome de trabalho nos dois workspaces: o retrabalho de A existe por inteiro (a chave de deduplicação vale por workspace)
    const rA = junto.servico.retrabalhoListar(WS_A, 200);
    const rS = sozinho.servico.retrabalhoListar(WS_A, 200);
    expect(rA.eventos.length).toBeGreaterThan(0);
    expect(rA.eventos.length).toBe(rS.eventos.length);
    expect(rA.eventos.every((e) => e.workspace_id === WS_A)).toBe(true);
    expect(junto.servico.retrabalhoListar(WS_B, 200).eventos.every((e) => e.workspace_id === WS_B)).toBe(true);
    expect(junto.servico.retrabalhoListar(WS_B, 200).eventos.length).toBeGreaterThan(0);
    // exportações carregam só o próprio workspace
    await junto.servico.exportar(WS_A, "backlog", "json", null);
    const exportado = JSON.parse([...junto.arquivos.values()][0] as string) as { titulo: string }[];
    const titulosB = new Set(lista(junto, WS_B).itens.map((i) => i.id));
    expect(exportado.every((l) => !titulosB.has((l as unknown as { id: string }).id))).toBe(true);
  });

  it("erro de estimativa e calibração de B não entram no painel de A", async () => {
    const m = novo({ workspaces: [WS_A, WS_B], metodo: metodoPorWorkspace({ [WS_A]: [0, 12], [WS_B]: [12, 40] }) });
    for (const ws of [WS_A, WS_B]) { m.servico.sincronizar(ws); await m.servico.aguardarSincronizacao(ws); }
    const idsA = new Set(m.servico.backlogListar(WS_A, { limite: 200 }).itens.map((i) => i.id));
    const erroA = m.servico.painel(WS_A).erro_estimativa;
    expect(erroA.pontos.length).toBeGreaterThan(0);
    expect(erroA.pontos.every((p) => idsA.has(p.item_id))).toBe(true);
    const erroB = m.servico.painel(WS_B).erro_estimativa;
    expect(erroB.pontos.length).toBeGreaterThan(erroA.pontos.length);
    const linhas = m.banco.consultar<{ item_id: string; ref_ms_por_ponto: number | null }>("SELECT item_id, ref_ms_por_ponto FROM agil_erro_estimativa");
    expect(linhas.length).toBe(erroA.pontos.length + erroB.pontos.length);
  });

  it("um alias de agente igual em dois workspaces não colide nem atribui ao outro", () => {
    const m = novo();
    const a = m.servico.membroGravar(WS_A, { tipo: "agente", rotulo: "A1", aliases: [{ tipo: "agente", valor: "impl-1" }] });
    const b = m.servico.membroGravar(WS_B, { tipo: "agente", rotulo: "B1", aliases: [{ tipo: "agente", valor: "impl-1" }] });
    expect(m.servico.membroListar(WS_A).map((x) => x.id)).toEqual([a.id]);
    expect(m.servico.membroListar(WS_B).map((x) => x.id)).toEqual([b.id]);
  });

  it("após reabrir o banco (cache novo) o isolamento continua", async () => {
    const m = novo({ workspaces: [WS_A, WS_B], metodo: metodoPorWorkspace({ [WS_A]: [0, 6], [WS_B]: [0, 6] }) });
    for (const ws of [WS_A, WS_B]) { m.servico.sincronizar(ws); await m.servico.aguardarSincronizacao(ws); }
    const { criarBancoAgilSqlite } = await import("../nucleo/banco/repos/agil");
    const reaberto = criarBancoAgilSqlite(m.banco);
    expect(reaberto.itens.valores().filter((i) => i.workspace_id === WS_A)).toHaveLength(24);
    expect(reaberto.itens.valores().filter((i) => i.workspace_id === WS_B)).toHaveLength(24);
    expect(new Set(reaberto.itens.valores().map((i) => i.id)).size).toBe(48);
  });
});

describe("ação humana forjada por agente", () => {
  it("o código da porta do MCP não passa `ator`/`humano` ao núcleo, e o MCP nem importa o núcleo ágil", () => {
    const fonte = readFileSync(resolve(__dirname, "agil.ts"), "utf8");
    const porta = fonte.slice(fonte.indexOf("const portaMcp: PortaAgilMcp"), fonte.indexOf("function resolverRef"));
    expect(porta.length).toBeGreaterThan(1000);
    expect(porta).not.toMatch(/"humano"|\bator: |marcarRetrabalho|iniciarSprint|fecharSprint|cancelarSprint|registrarDemo|gravarEstimativaHumana|gravarClassificacaoHumana|aceitarEmLote|consentimentoIa/);
    for (const arq of varrer(resolve(__dirname, "..", "nucleo", "mcp"))) {
      if (/\.test\.ts$/.test(arq)) continue;
      expect(readFileSync(arq, "utf8"), arq).not.toMatch(/from "\.\.\/(?:\.\.\/)?agil(?:\/|")/);
    }
  });

  it("todo canal humano grava `ator: humano`; nenhum canal aceita `ator` no payload (ver ipc/agil.test.ts)", () => {
    const fonte = readFileSync(resolve(__dirname, "agil.ts"), "utf8");
    const usos = [...fonte.matchAll(/\bator: "(\w+)"/g)].map((x) => x[1]);
    expect(new Set(usos)).toEqual(new Set(["humano"]));
  });

  it("o núcleo recusa os cinco atos humanos para ator agente e nada muda no banco", async () => {
    const { criarAgil } = await import("../nucleo/agil/agil");
    const a = criarAgil({});
    const sp = a.sprint("ws").criar({ nome: "S", inicio: "2027-12-01", fim: "2027-12-12" });
    const it = a.backlog("ws").criar({ titulo: "x" });
    a.sprint("ws").adicionar(sp.id, it.id);
    const antes = JSON.stringify([a.banco.sprints.valores(), a.banco.sprintItens.valores(), a.banco.eventosRetrabalho.valores(), a.banco.demos.valores(), a.banco.auditoria.valores()]);
    const humanOnly = (f: () => unknown): void => { try { f(); } catch (e) { expect(e).toMatchObject({ code: "rule_violation", subcode: "human_only" }); return; } throw new Error("não lançou"); };
    humanOnly(() => a.sprint("ws").iniciar(sp.id, "agente"));
    humanOnly(() => a.sprint("ws").cancelar(sp.id, "agente"));
    humanOnly(() => a.sprint("ws").fechar({ sprint_id: sp.id, destino_pendentes: "backlog", ator: "agente" }));
    humanOnly(() => a.retrabalho("ws").marcar({ trabalho_id: "t", task_ref: "T-1", acao: "marcar_retrabalho", motivo: "motivo válido", ator: "agente" }));
    const { registrarDemo } = await import("../nucleo/agil/cerimonias/review");
    humanOnly(() => registrarDemo({ banco: a.banco, relogio: a.relogio }, sp.id, it.id, "aceito", null, "agente"));
    expect(JSON.stringify([a.banco.sprints.valores(), a.banco.sprintItens.valores(), a.banco.eventosRetrabalho.valores(), a.banco.demos.valores(), a.banco.auditoria.valores()])).toBe(antes);
  });

  it("o agente não escreve campos de decisão humana: resumo para o cliente, WSJF, dono, visibilidade e estado do item ficam intactos", async () => {
    const m = novo();
    const r = (await m.servico.portaMcp.chamar("backlog_propose", piloto(WS_A), { title: "Proposta", description: "d", resumo_cliente: "x", valor: 10, urgencia: 10, reducao_risco: 10, moscow: "must", dono_membro_id: "mbr_x", visibilidade_cliente: "sim", estado_ade: "pronto", changelog_tipo: "security" })) as { item_id: string };
    const it = (await m.servico.itemLer(WS_A, r.item_id)).item;
    expect(it).toMatchObject({ resumo_cliente: null, valor: null, urgencia: null, reducao_risco: null, moscow: null, dono_membro_id: null, visibilidade_cliente: "auto", estado_ade: "backlog", changelog_tipo: null });
  });

  it("consentimento da IA e marcação de retrabalho ficam na auditoria como ação humana", async () => {
    const m = novo({ workspaces: [WS_A] });
    m.servico.consentimentoIa(WS_A, true);
    m.servico.consentimentoIa(WS_A, false);
    const linhas = m.banco.consultar<{ acao: string; ator: string; workspace_id: string }>("SELECT acao, ator, workspace_id FROM agil_auditoria ORDER BY seq");
    expect(linhas).toEqual([{ acao: "ia.consentir", ator: "humano", workspace_id: WS_A }, { acao: "ia.revogar", ator: "humano", workspace_id: WS_A }]);
  });
});

describe("cálculo manipulável", () => {
  async function comItemConcluido() {
    const m = novo({ workspaces: [WS_A], metodo: metodoPorWorkspace({ [WS_A]: [0, 3] }) });
    m.servico.sincronizar(WS_A); await m.servico.aguardarSincronizacao(WS_A);
    const concluido = m.servico.backlogListar(WS_A, { limite: 200 }).itens.find((i) => i.estado_fluxo === "concluida" || i.estado_fluxo === "validada");
    expect(concluido).toBeTruthy();
    return { m, concluido: concluido as NonNullable<typeof concluido> };
  }

  it("o agente não reestima item concluído, descartado ou de sprint encerrada (o fato fica como foi)", async () => {
    const { m, concluido } = await comItemConcluido();
    await expect(m.servico.portaMcp.chamar("estimate_propose", piloto(WS_A), { item_ref: concluido.id, points: 21 })).rejects.toMatchObject({ code: "rule_violation" });
    const it = m.servico.itemCriar(WS_A, { titulo: "descartável" });
    m.servico.itemDescartar(WS_A, it.id, "duplicado");
    await expect(m.servico.portaMcp.chamar("estimate_propose", piloto(WS_A), { item_ref: it.id, points: 5 })).rejects.toMatchObject({ code: "rule_violation" });
    const det = await m.servico.itemLer(WS_A, concluido.id);
    expect(det.estimativas.every((e) => e.motor !== "agente")).toBe(true);
  });

  it("o humano pode reestimar mesmo assim (a regra é só contra o agente)", async () => {
    const { m, concluido } = await comItemConcluido();
    expect(m.servico.estimativaGravar(WS_A, { item_id: concluido.id, pontos: 13 }).estimativa).toMatchObject({ origem: "humano", pontos: 13 });
  });

  it("proposta repetida do agente não cria versões novas; há teto de versões por item e de propostas por hora/abertas", async () => {
    const m = novo();
    const it = m.servico.itemCriar(WS_A, { titulo: "alvo" });
    const c = piloto(WS_A);
    const p1 = (await m.servico.portaMcp.chamar("estimate_propose", c, { item_ref: it.id, points: 5 })) as { estimate_id: string };
    const p2 = (await m.servico.portaMcp.chamar("estimate_propose", c, { item_ref: it.id, points: 5 })) as { estimate_id: string; unchanged?: boolean };
    expect(p2).toMatchObject({ estimate_id: p1.estimate_id, unchanged: true });
    for (let i = 0; i < 40; i++) await m.servico.portaMcp.chamar("estimate_propose", c, { item_ref: it.id, points: i % 2 === 0 ? 8 : 13 }).catch(() => undefined);
    expect((await m.servico.itemLer(WS_A, it.id)).estimativas.length).toBeLessThanOrEqual(30);
    await expect(m.servico.portaMcp.chamar("estimate_propose", c, { item_ref: it.id, points: 3 })).rejects.toMatchObject({ code: "rule_violation", subcode: "limit_reached" });
    for (let i = 0; i < 30; i++) await m.servico.portaMcp.chamar("backlog_propose", c, { title: `proposta ${i}` });
    await expect(m.servico.portaMcp.chamar("backlog_propose", c, { title: "a 31ª na mesma hora" })).rejects.toMatchObject({ code: "rule_violation", subcode: "limit_reached" });
    m.rel.agora += 2 * 3_600_000;
    await expect(m.servico.portaMcp.chamar("backlog_propose", c, { title: "uma hora depois" })).resolves.toMatchObject({ state: "backlog" });
  });

  it("entradas numéricas absurdas são recusadas (NaN, negativo, enorme) e o compromisso inicial é imutável depois de iniciar", async () => {
    const m = novo({ workspaces: [WS_A], metodo: metodoDaFixture(0) });
    const it = m.servico.itemCriar(WS_A, { titulo: "x" });
    expect(() => m.servico.estimativaGravar(WS_A, { item_id: it.id, pontos: Number.NaN })).toThrow();
    const sp = m.servico.sprintCriar(WS_A, { nome: "S", inicio: "2027-12-01", fim: "2027-12-12" });
    m.servico.estimativaGravar(WS_A, { item_id: it.id, pontos: 5 });
    m.servico.sprintItemMover(WS_A, sp.id, it.id, "adicionar", null);
    const iniciada = m.servico.sprintIniciar(WS_A, sp.id);
    expect(iniciada.compromisso_pontos).toBe(5);
    m.servico.estimativaGravar(WS_A, { item_id: it.id, pontos: 13 });
    expect(m.servico.sprintListar(WS_A)[0]?.compromisso_pontos).toBe(5);
    expect(() => m.servico.sprintAtualizar(WS_A, sp.id, { inicio: "2027-11-01" })).toThrow(/imutável/);
  });
});

describe("zero escrita em docs/** e superfície de arquivo", () => {
  it("nenhum módulo da gestão ágil escreve em docs/**: só `agil.ts` grava (exportação em userData) e o nome do arquivo é seguro", () => {
    const main = ["agil.ts", "agil-metodo.ts", "agil-ia.ts", join("ipc", "agil.ts")].map((f) => [f, readFileSync(resolve(__dirname, f), "utf8")] as const);
    for (const [f, texto] of main) {
      if (f !== "agil-metodo.ts") expect(texto, f).not.toMatch(/["'`]docs\//); // o adaptador do método só LÊ docs/ (HISTORICO.md, QA.md…)
      if (f !== "agil.ts") expect(texto, f).not.toMatch(/writeFile|appendFile|rename\(|rm\(|unlink|mkdirSync\(.*docs/);
    }
    for (const arq of varrer(resolve(__dirname, "..", "nucleo", "agil"))) {
      if (/\.test\.ts$/.test(arq)) continue;
      expect(readFileSync(arq, "utf8"), arq).not.toMatch(/from "node:fs|from "fs"|child_process|worker_threads|from "electron"/);
    }
    const agil = main[0]?.[1] as string;
    expect(agil.match(/writeFile\(/g)?.length).toBe(1);
    expect(agil).toContain('join(userData, "agil", "exportacoes")');
  });

  it("o escritor de exportação recusa nome com barra, `..` ou vazio", async () => {
    const { criarEscritorExportacao } = await import("./agil");
    const { mkdtempSync, existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "agil-exp-"));
    const escrever = criarEscritorExportacao(dir);
    for (const nome of ["../fuga.csv", "a/b.csv", "", ".oculto", "x\u0000.csv", "..", "C:\\x.csv"]) await expect(escrever(nome, "x"), nome).rejects.toThrow();
    expect(await escrever("backlog-ok.csv", "a,b\r\n")).toBe("agil/exportacoes/backlog-ok.csv");
    expect(existsSync(join(dir, "agil", "exportacoes", "backlog-ok.csv"))).toBe(true);
    expect(existsSync(join(dir, "fuga.csv"))).toBe(false);
  });
});

function varrer(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? varrer(p) : /\.ts$/.test(n) ? [p] : [];
  });
}
