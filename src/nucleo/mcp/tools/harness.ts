// Tools `harness_*` e `decisions_list` (Fase 9, T-09.17). Só traduzem o contrato externo (inglês, snake_case) para a porta `PortaHarness`
// implementada no main; nenhuma escolhe CLI, conta ou modelo por conta própria. Respostas ≤ 4 KB (corta a lista e marca `truncated`).
import type { Executor, Faixa, PropositoDecisao } from "../../../compartilhado/harness";
import { argumentoInvalido, indisponivel, violacaoDeRegra, type SubcodigoErro } from "../erros";
import type { PortaHarness } from "../portas";
import { comoObjeto, identificador, identificadorOpcional, inteiroOpcional, texto, textoOpcional, type DepsTools, type ImplTool } from "./comum";

// Cópias locais (só valores): o worker do MCP não carrega `compartilhado/harness` em tempo de execução (fecho do pacote, asarUnpack).
// Um teste (`harness.test.ts`) garante que estas listas são IGUAIS às do contrato.
export const FAIXAS_MCP: readonly string[] = ["topo", "alto", "medio", "rapido"];
export const PROPOSITOS_MCP: readonly string[] = ["selecao_conta", "task_type", "modelo_esforco", "troca", "intencao"];

/** Teto de toda resposta das tools da Fase 9. */
export const LIMITE_RESPOSTA_BYTES = 4096;

/** Monta a resposta com o máximo de itens que cabem em 4 KB; se cortou, marca `truncated: true` e informa `total`. */
export function caberEm4Kb<T>(itens: readonly T[], montar: (itens: T[], extra: { truncated?: true; total?: number }) => Record<string, unknown>, maximo: number = LIMITE_RESPOSTA_BYTES): Record<string, unknown> {
  const tamanho = (o: unknown): number => Buffer.byteLength(JSON.stringify(o), "utf8");
  let n = itens.length;
  let saida = montar([...itens], {});
  while (n > 0 && tamanho(saida) > maximo) {
    n = Math.max(0, n - Math.max(1, Math.floor(n * 0.2)));
    saida = montar(itens.slice(0, n), { truncated: true, total: itens.length });
  }
  return saida;
}

export function exigirHarness(deps: DepsTools): PortaHarness {
  if (deps.harness === undefined) throw indisponivel("O harness não está disponível.");
  return deps.harness;
}

const SUBCODIGOS_DE_ROTA: readonly string[] = [
  "no_capacity",
  "executor_disabled",
  "unknown_task_type",
  "invalid_effort",
  "no_compatible_cli",
  "model_not_enabled",
  "openrouter_not_consented",
];

/** Erro nominal da política/roteamento → `rule_violation` com subcode; o que não é conhecido vira `invalid_argument` (sem detalhe interno). */
export function erroDeRegra(codigo: string, mensagem: string): Error {
  if (SUBCODIGOS_DE_ROTA.includes(codigo)) return violacaoDeRegra(codigo as SubcodigoErro, mensagem);
  return argumentoInvalido(mensagem);
}

const FONTE_EXTERNA = { decisor: "decider", heuristica: "heuristic", regra: "rule" } as const;

export const harnessList: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const categoria = identificadorOpcional(a, "category");
  const lista = await exigirHarness(deps).listar(claims.workspace_id, categoria);
  return caberEm4Kb(lista, (itens, extra) => ({
    task_types: itens.map((p) => ({ slug: p.task_type, category: p.categoria, label: p.rotulo, executor: p.executor, alternates: p.alternativas, fallback: p.fallback, enabled: p.habilitada })),
    ...extra,
  }));
};

export const harnessRecommend: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const descricao = texto(a, "task_description", { max: 2000 });
  const r = await exigirHarness(deps).recomendar(claims.workspace_id, descricao);
  if (r.erro !== null) throw erroDeRegra(r.erro, r.recibo);
  return { task_type: r.task_type, confidence: Math.round(r.confianca * 100) / 100, executor: r.executor, account_id: r.conta_id, source: FONTE_EXTERNA[r.fonte], receipt: r.recibo.slice(0, 480) };
};

function executorDe(v: unknown, campo: string): Executor {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw argumentoInvalido(`O campo "${campo}" deve ser um objeto.`);
  const o = v as Record<string, unknown>;
  const opc = (k: string): string | null => {
    const x = o[k];
    if (x === undefined || x === null) return null;
    if (typeof x !== "string" || x.trim() === "" || x.length > 100) throw argumentoInvalido(`O campo "${campo}.${k}" deve ser texto curto.`);
    return x;
  };
  const provider = opc("provider");
  if (provider === null) throw argumentoInvalido(`O campo "${campo}.provider" é obrigatório.`);
  const faixa = opc("faixa");
  if (faixa !== null && !FAIXAS_MCP.includes(faixa)) throw argumentoInvalido(`O campo "${campo}.faixa" deve ser topo, alto, medio ou rapido.`);
  return { provider, cli: opc("cli"), model: opc("model"), effort: opc("effort"), faixa: faixa as Faixa | null };
}

export const harnessSet: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const porta = exigirHarness(deps);
  // defesa em profundidade: o `tools/list` já esconde a tool sem o opt-in, mas o token pode ser mais velho que a escolha do usuário
  if (claims.role !== "piloto" || claims.mode !== "agentico" || !(await porta.pilotoEditaPolitica(claims.workspace_id))) {
    throw violacaoDeRegra("forbidden_role", "Editar a política do harness exige o piloto agêntico e o opt-in do usuário no workspace.");
  }
  const taskType = identificador(a, "task_type");
  const provedor = identificador(a, "provider");
  const cli = identificadorOpcional(a, "cli");
  const modelo = identificadorOpcional(a, "model");
  const esforco = identificadorOpcional(a, "effort");
  const faixaBruta = textoOpcional(a, "faixa", 20);
  if (faixaBruta !== null && !FAIXAS_MCP.includes(faixaBruta)) throw argumentoInvalido('O campo "faixa" deve ser topo, alto, medio ou rapido.');
  if (modelo !== null && faixaBruta !== null) throw argumentoInvalido('Informe "model" ou "faixa", não os dois.');
  const brutoFallback = a["fallback"];
  let fallback: Executor[] | null = null;
  if (brutoFallback !== undefined && brutoFallback !== null) {
    if (!Array.isArray(brutoFallback) || brutoFallback.length === 0 || brutoFallback.length > 10) throw argumentoInvalido('O campo "fallback" deve ter de 1 a 10 executores.');
    fallback = brutoFallback.map((e, i) => executorDe(e, `fallback[${i}]`));
  }
  const r = await porta.definir({
    workspace_id: claims.workspace_id,
    pedido_por_pane_id: claims.pane_id,
    task_type: taskType,
    provedor,
    cli,
    modelo,
    faixa: faixaBruta as Faixa | null,
    esforco,
    fallback,
  });
  if (!r.ok) throw erroDeRegra(r.erro, r.mensagem);
  const p = r.politica;
  return { policy: { task_type: p.task_type, executor: p.executor, alternates: p.alternativas, fallback: p.fallback, enabled: p.habilitada }, ...(r.avisos.length > 0 ? { warnings: r.avisos.slice(0, 5) } : {}) };
};

export const decisionsList: ImplTool = async (args, { claims, deps }) => {
  const a = comoObjeto(args);
  const desde = textoOpcional(a, "since", 40);
  if (desde !== null && Number.isNaN(Date.parse(desde))) throw argumentoInvalido('O campo "since" deve ser uma data ISO-8601.');
  const propositoBruto = textoOpcional(a, "purpose", 30);
  if (propositoBruto !== null && !PROPOSITOS_MCP.includes(propositoBruto)) throw argumentoInvalido(`O campo "purpose" deve ser um de: ${PROPOSITOS_MCP.join(", ")}.`);
  const limite = inteiroOpcional(a, "limit", 1, 200) ?? 20;
  const r = await exigirHarness(deps).decisoes({ workspace_id: claims.workspace_id, desde, proposito: propositoBruto as PropositoDecisao | null, limite });
  return caberEm4Kb(r.decisoes, (itens, extra) => ({
    decisions: itens.map((d) => ({ id: d.id, at: d.criado_em, purpose: d.proposito, chosen: d.escolhida, source: d.fonte, receipt: d.recibo.slice(0, 240), cost_usd: d.custo_usd })),
    totals: { count: r.total, cost_usd: r.custo_usd },
    ...extra,
  }));
};
