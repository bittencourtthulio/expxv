import { afterEach, describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { abrirBanco, migrar, type Banco } from "../index";
import { criarRepositorios } from "./index";
import type { DecisaoEntrada, Executor } from "../../../compartilhado/harness";

let banco: Banco | undefined;
afterEach(() => {
  banco?.fechar();
  banco = undefined;
});
const mediana = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
const exec: Executor = { provider: "claude", cli: null, model: null, effort: null, faixa: "alto" };

describe("P-14: consultas quentes do harness ≤ 5 ms com volume (mediana de 50 execuções)", () => {
  it("política efetiva, config do workspace, decisões, trocas e rota do Pane", () => {
    banco = abrirBanco(":memory:");
    migrar(banco);
    const r = criarRepositorios(banco);
    const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
    const tipos = Array.from({ length: 60 }, (_, i) => ({ slug: `tipo-${i}`, categoria: "desenvolvimento", rotulo: `T${i}`, descricao: null }));
    r.taskType.semear(tipos);
    for (const t of tipos) {
      r.politica.gravar({ workspace_id: null, task_type: t.slug, executor: exec, alternativas: [], fallback: [exec], skills: [], agente: null, conta_fixa_id: null, evitar_reservadas: true, habilitada: true }, "semente");
      r.politica.gravar({ workspace_id: ws.id, task_type: t.slug, executor: exec, alternativas: [], fallback: [exec], skills: [], agente: null, conta_fixa_id: null, evitar_reservadas: true, habilitada: true }, "usuario");
    }
    r.harnessWorkspace.gravar({ ...r.harnessWorkspace.obter(ws.id), modo_troca: "automatico" });
    const pane = r.pane.criar({ workspace_id: ws.id, tipo: "cli", cli: "claude", papel: "executor" } as never);
    r.paneRota.gravar({ pane_id: pane.id, perfil: { agente_id: null, provider: "claude", cli: "claude", modelo: null, esforco: null, faixa: "alto" } });
    const dec = (i: number): DecisaoEntrada => ({
      proposito: "selecao_conta", workspace_id: ws.id, mission_id: null, pane_id: null, tipo: "choice", opcoes: ["a"], probs: null, escolhida: "a", confianca: null, fonte: "regra",
      escolha_regra: "a", divergiu: false, latencia_ms: i, custo_usd: null, custo_origem: "desconhecido", decisor: null, resumo_enviado: null, resumo_hash: null, skills_aplicadas: false, recibo: "r",
    });
    banco.transacao(() => {
      for (let i = 0; i < 10_000; i++) {
        r.decisao.inserir(dec(i));
        if (i % 5 === 0) {
          r.trocaLog.inserir({
            workspace_id: ws.id, de: { conta_id: null, provedor: "claude", modelo: null }, para: { conta_id: null, provedor: "codex", modelo: null },
            motivo: "consumo_alto", modo: "automatico", tipo_troca: "outro_provedor", status: "feita", recibo: "r",
          });
        }
      }
    });
    const consultas: Record<string, () => unknown> = {
      politicaEfetiva: () => r.politica.efetiva(ws.id, "tipo-30"),
      politicasEfetivas: () => r.politica.efetivas(ws.id),
      configWorkspace: () => r.harnessWorkspace.obter(ws.id),
      decisoesRecentes: () => r.decisao.listar({ limite: 50 }),
      decisoesPorProposito: () => r.decisao.listar({ proposito: "selecao_conta", limite: 50 }),
      trocasRecentes: () => r.trocaLog.listar({ limite: 50 }),
      rotaDoPane: () => r.paneRota.obter(pane.id),
      contasRoteamento: () => r.contaRoteamento.listar(),
    };
    for (const [nome, fn] of Object.entries(consultas)) {
      fn(); // aquece
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
