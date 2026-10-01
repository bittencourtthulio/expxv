// P-14: consulta ao banco (caminho quente) ≤ 5 ms por consulta, banco real (node:sqlite em arquivo, WAL)
// com 10 000 linhas por tabela. Roda em Node puro, sem Electron. As consultas são as REAIS dos repositórios
// (src/nucleo/banco/repos). Valor registrado = a PIOR mediana (de 100 execuções) entre todas as consultas;
// o pior caso individual (máximo) sai no log. As 5 primeiras execuções de cada consulta aquecem o cache de
// statements e não entram na amostra (documentado: a 1ª execução compila o SQL, não é o "caminho quente").
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, describe, expect, it } from "vitest";
import { abrirBanco, agora, gerarId, migrar, type Banco } from "../../src/nucleo/banco";
import { criarRepositorios } from "../../src/nucleo/banco/repos";
import { gravarMedicoes, registrar } from "./registro";

const LINHAS = 10_000;
const EXECUCOES = 100;
const AQUECIMENTO = 5;

let banco: Banco | undefined;
let pasta: string | undefined;
afterAll(() => {
  gravarMedicoes();
  banco?.fechar();
  if (pasta !== undefined) rmSync(pasta, { recursive: true, force: true });
});

const mediana = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

describe("P-14: consultas quentes ao banco (10 000 linhas)", () => {
  it("mediana de 100 execuções de cada consulta real dos repositórios ≤ 5 ms", () => {
    pasta = mkdtempSync(join(tmpdir(), "ade-perf-banco-"));
    banco = abrirBanco(join(pasta, "perf.db"));
    migrar(banco);
    const b = banco;
    const r = criarRepositorios(b);
    const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
    const ts = agora();
    const ids = { missao: "", task: "", pane: "" };
    b.transacao((tx) => {
      for (let i = 0; i < LINHAS; i++) tx.executar("INSERT INTO workspace (id,nome,raiz,e_git,acesso_externo,permissao,ultimo_uso_em,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)", [gerarId("workspace"), `w${i}`, `/w${i}`, 1, "nenhum", "seguro", agora(new Date(1_700_000_000_000 + i * 1000)), ts, ts]);
      const im = tx.preparar("INSERT INTO mission (id,workspace_id,modo,origem,titulo,estado,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?)");
      const ip = tx.preparar("INSERT INTO pane (id,mission_id,workspace_id,display_id,tipo,papel,estado,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)");
      const it = tx.preparar("INSERT INTO task (id,mission_id,task_ref,titulo,papel,estado,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?)");
      const ih = tx.preparar("INSERT INTO handoff (id,task_id,resumo,status,criado_em,atualizado_em) VALUES (?,?,?,?,?,?)");
      const ie = tx.preparar("INSERT INTO evento_dominio (id,tipo,payload_json,criado_em) VALUES (?,?,?,?)");
      const ic = tx.preparar("INSERT INTO conta (id,provedor,rotulo,habilitada,criado_em,atualizado_em) VALUES (?,?,?,?,?,?)");
      const ig = tx.preparar("INSERT INTO config (chave,valor_json,criado_em,atualizado_em) VALUES (?,?,?,?)");
      const tipos = ["pane_criado", "pane_encerrado", "mission_criada", "task_entregue", "handoff_criado"];
      for (let i = 0; i < LINHAS; i++) {
        const mid = gerarId("mission");
        const tid = gerarId("task");
        const pid = gerarId("pane");
        im.executar([mid, ws.id, "agentico", "livre", `m${i}`, i % 7 === 0 ? "executando" : "concluida", ts, ts]);
        ip.executar([pid, mid, ws.id, i + 1, "cli", "executor", i % 5 === 0 ? "pronto" : "encerrado", ts, ts]);
        it.executar([tid, mid, `t-${i}`, "x", "executor", "aberta", ts, ts]);
        ih.executar([gerarId("handoff"), tid, "resumo", "ok", ts, ts]);
        ie.executar([gerarId("evento", 1_700_000_000_000 + i), tipos[i % tipos.length] as string, '{"x":1}', agora(new Date(1_700_000_000_000 + i * 1000))]);
        ic.executar([gerarId("conta"), i % 2 === 0 ? "claude" : "codex", `c${i}`, i % 3 === 0 ? 0 : 1, ts, ts]);
        ig.executar([`chave.${i}`, "1", ts, ts]);
        if (i === LINHAS - 2) { ids.missao = mid; ids.task = tid; ids.pane = pid; }
      }
    });
    const cfgChave = `chave.${Math.floor(LINHAS / 2)}`;
    const consultas: Record<string, () => unknown> = {
      "mission.listarPorWorkspace(50)": () => r.mission.listarPorWorkspace(ws.id, { limite: 50 }),
      "mission.listarPorWorkspace(executando)": () => r.mission.listarPorWorkspace(ws.id, { estado: "executando", limite: 50 }),
      "mission.obter": () => r.mission.obter(ids.missao),
      "pane.listarPorWorkspace(ativos)": () => r.pane.listarPorWorkspace(ws.id, { somenteAtivos: true, limite: 50 }),
      "pane.listarPorMissao": () => r.pane.listarPorMissao(ids.missao),
      "task.listarPorMissao": () => r.task.listarPorMissao(ids.missao),
      "handoff.obter": () => r.handoff.obter(ids.task),
      "handoff.listarPorTask": () => r.handoff.listarPorTask(ids.task),
      "workspace.recentes(20)": () => r.workspace.recentes(20),
      "workspace.obterPorRaiz": () => r.workspace.obterPorRaiz("/w5000"),
      "workspace.listar(50)": () => r.workspace.listar({ limite: 50 }),
      "conta.listar(habilitadas)": () => r.conta.listar({ provedor: "claude", apenasHabilitadas: true, limite: 50 }),
      "config.obter": () => r.config.obter(cfgChave),
      "evento_dominio.ultimos(tipo)": () => b.consultar("SELECT id,tipo,payload_json,criado_em FROM evento_dominio WHERE tipo = ? ORDER BY criado_em DESC LIMIT 50", ["task_entregue"]),
    };
    expect(b.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM mission")?.n).toBe(LINHAS);

    const linhas: string[] = [];
    let piorMediana = 0;
    let piorNome = "";
    let piorMaximo = 0;
    for (const [nome, fn] of Object.entries(consultas)) {
      for (let i = 0; i < AQUECIMENTO; i++) fn();
      const tempos: number[] = [];
      for (let i = 0; i < EXECUCOES; i++) {
        const t0 = performance.now();
        fn();
        tempos.push(performance.now() - t0);
      }
      const med = mediana(tempos);
      const max = Math.max(...tempos);
      linhas.push(`  ${nome.padEnd(42)} mediana ${med.toFixed(3)} ms  máx ${max.toFixed(3)} ms`);
      if (med > piorMediana) { piorMediana = med; piorNome = nome; }
      if (max > piorMaximo) piorMaximo = max;
    }
    console.log(`P-14 (${EXECUCOES} execuções por consulta, ${LINHAS} linhas):\n${linhas.join("\n")}\n  pior mediana: ${piorNome} ${piorMediana.toFixed(3)} ms; pior caso individual ${piorMaximo.toFixed(2)} ms`);
    const m = registrar({ id: "P-14", descricao: `consulta quente ao banco (pior mediana de ${Object.keys(consultas).length}, 10 mil linhas)`, valor: piorMediana, limite: 5, unidade: "ms" });
    expect(m.ok, `${piorNome}: mediana ${m.valor} ms > ${m.limite} ms`).toBe(true);
  });
});
