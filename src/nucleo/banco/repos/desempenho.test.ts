import { afterEach, describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { abrirBanco, migrar, type Banco } from "../index";
import { agora, gerarId } from "../index";
import { criarRepositorios } from "./index";

let banco: Banco | undefined;
afterEach(() => {
  banco?.fechar();
  banco = undefined;
});
const mediana = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

describe("P-14: consultas quentes dos repositórios ≤ 5 ms com 10 000 linhas", () => {
  it("mediana de 50 execuções", () => {
    banco = abrirBanco(":memory:");
    migrar(banco);
    const r = criarRepositorios(banco);
    const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
    const ts = agora();
    banco.transacao((tx) => {
      const im = tx.preparar("INSERT INTO mission (id,workspace_id,modo,origem,titulo,estado,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?)");
      const ip = tx.preparar("INSERT INTO pane (id,mission_id,workspace_id,display_id,tipo,papel,estado,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)");
      const it = tx.preparar("INSERT INTO task (id,mission_id,task_ref,titulo,papel,estado,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?)");
      for (let i = 0; i < 10_000; i++) {
        const mid = gerarId("mission");
        im.executar([mid, ws.id, "agentico", "livre", `m${i}`, i % 7 === 0 ? "executando" : "concluida", ts, ts]);
        ip.executar([gerarId("pane"), mid, ws.id, i + 1, "cli", "executor", i % 5 === 0 ? "pronto" : "encerrado", ts, ts]);
        it.executar([gerarId("task"), mid, `t-${i}`, "x", "executor", "aberta", ts, ts]);
      }
    });
    const alvo = r.mission.listarPorWorkspace(ws.id, { limite: 1 }).itens[0];
    expect(alvo).toBeDefined();
    const consultas: Record<string, () => unknown> = {
      missoesRecentes: () => r.mission.listarPorWorkspace(ws.id, { limite: 50 }),
      missoesAtivas: () => r.mission.listarPorWorkspace(ws.id, { estado: "executando", limite: 50 }),
      panesAtivos: () => r.pane.listarPorWorkspace(ws.id, { somenteAtivos: true, limite: 50 }),
      panesDaMissao: () => r.pane.listarPorMissao(alvo!.id),
      tasksDaMissao: () => r.task.listarPorMissao(alvo!.id),
      obterMissao: () => r.mission.obter(alvo!.id),
      workspaceRecentes: () => r.workspace.recentes(20),
    };
    for (const [nome, fn] of Object.entries(consultas)) {
      const tempos: number[] = [];
      for (let i = 0; i < 50; i++) {
        const t0 = performance.now();
        fn();
        tempos.push(performance.now() - t0);
      }
      expect(mediana(tempos), nome).toBeLessThanOrEqual(5);
    }
  });
});
