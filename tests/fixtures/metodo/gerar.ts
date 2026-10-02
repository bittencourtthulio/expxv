// Gerador da fixture "projeto Expx sintético completo". Escreve em um diretório (normalmente
// temporário) o que o expxdev grava em docs/ e .expx/, modelado nos templates reais das skills
// (sprintx, runx, mergex, prodx, buildx, legadox, designx). Serve aos testes do núcleo do Método
// e ao e2e (T-04.05 em diante). Nada aqui lê ou escreve fora do diretório recebido.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stringify } from "yaml";

export const HOJE_FIXTURE = "2026-09-29T12:00:00Z";

type Obj = Record<string, unknown>;

function escrever(raiz: string, rel: string, conteudo: string | Buffer): void {
  const abs = join(raiz, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, conteudo);
}

/** frontmatter + corpo. */
export function md(dados: Obj, corpo = "# Documento\n\nTexto.\n"): string {
  return `---\n${stringify(dados, { lineWidth: 0 })}---\n${corpo}`;
}

export interface TaskSpec {
  id: string;
  fase: string;
  status?: string;
  dep?: string[];
  par?: boolean;
  suite?: string;
  integ?: string | null;
  func?: string | null;
  regressao?: string | null;
  concluida_em?: string | null;
  titulo?: string;
}

export function task(s: TaskSpec): Obj {
  const t: Obj = {
    id: s.id,
    titulo: s.titulo ?? `Task ${s.id}`,
    fase: s.fase,
    status: s.status ?? "pendente",
    objetivo: `Objetivo de ${s.id}`,
    arquivos: { cria: [`src/${s.id.toLowerCase()}.ts`], altera: [] },
    teste_integracao: s.integ === undefined ? "valida o fluxo contra o banco de teste" : s.integ,
    teste_funcional: s.func === undefined ? "valida a entrada X com saida Y" : s.func,
    criterio_aceite: "o teste passa",
    depende_de: s.dep ?? [],
    paralelizavel: s.par ?? false,
    concluida_em: s.concluida_em ?? (s.status === "concluida" ? "2026-09-28" : null),
    suite: s.suite ?? (s.status === "concluida" ? "verde" : "nao_executada"),
  };
  if (s.regressao !== undefined) t.teste_regressao = s.regressao;
  return t;
}

export function fase(id: string, tasks: string[], o: Obj = {}): Obj {
  return {
    id,
    titulo: `Fase ${id}`,
    status: "em_andamento",
    criterio_saida: "a suite da fase passa",
    paralelizavel: false,
    paralela_com: [],
    tasks,
    ...o,
  };
}

export interface OrqSpec {
  tool?: string;
  id: string;
  estagio: string;
  status?: string;
  tipo_trabalho?: string;
  tipo_ocorrencia?: string | null;
  extra?: Obj;
}

export function orquestrador(o: OrqSpec): string {
  return md(
    {
      expx_schema: 1,
      expx_tool: o.tool ?? "sprintx",
      kind: "orquestrador",
      trabalho_id: o.id,
      titulo: `Trabalho ${o.id}`,
      tipo_trabalho: o.tipo_trabalho ?? "feature",
      tipo_ocorrencia: o.tipo_ocorrencia ?? null,
      estagio: o.estagio,
      status: o.status ?? "em_andamento",
      criado_em: "2026-09-20",
      atualizado_em: "2026-09-28",
      concluido_em: null,
      sprints: ["sprint-01"],
      caminho_critico: [],
      modulo_afetado: ["pagamentos"],
      arquivos_alterados: [],
      palavras_chave: ["pix"],
      worktree: null,
      ...o.extra,
    },
    `# Orquestrador — ${o.id}\n\n## 1. Objetivo\nTexto.\n`,
  );
}

export function tasksMd(trabalho: string, sprint: string, tasks: Obj[]): string {
  return md({ expx_schema: 1, expx_tool: "sprintx", kind: "tasks", trabalho_id: trabalho, sprint_id: sprint, atualizado_em: "2026-09-28", tasks }, `# Tasks — ${sprint}\n`);
}
export function fasesMd(trabalho: string, sprint: string, fases: Obj[]): string {
  return md(
    { expx_schema: 1, expx_tool: "sprintx", kind: "fases", trabalho_id: trabalho, sprint_id: sprint, atualizado_em: "2026-09-28", fases },
    `# Fases — ${sprint}\n\n\`\`\`mermaid\nflowchart LR\n  T_01_01 --> T_01_02\n\`\`\`\n`,
  );
}
export function sprintMd(trabalho: string, sprint: string, o: Obj = {}): string {
  return md(
    { expx_schema: 1, expx_tool: "sprintx", kind: "sprint", trabalho_id: trabalho, sprint_id: sprint, titulo: `Sprint ${sprint}`, status: "em_andamento", criterio_saida: "a suite inteira passa com 0 failed", fases: [], riscos: [], atualizado_em: "2026-09-28", ...o },
    `# Sprint\n`,
  );
}
function planoMd(tool: string, trabalho: string, sprint: string, fases: Obj[], tasks: Obj[], sprintObj: Obj = {}): string {
  return md(
    {
      expx_schema: 1,
      expx_tool: tool,
      kind: "plano",
      trabalho_id: trabalho,
      sprint_id: sprint,
      atualizado_em: "2026-09-28",
      sprint: { titulo: `Plano ${sprint}`, status: "em_andamento", criterio_saida: "a suite inteira passa", riscos: [], fora_de_escopo: [], ...sprintObj },
      fases,
      tasks,
    },
    `# Plano — ${sprint}\n\n## Tasks\n\n---\n\`\`\`yaml\nid: T-01.01\n\`\`\`\n`,
  );
}
export const blocoVazio = (trabalho: string, tool = "sprintx"): string =>
  md({ expx_schema: 1, expx_tool: tool, kind: "bloqueios", trabalho_id: trabalho, atualizado_em: "2026-09-28", bloqueios: [] }, "# Bloqueios\n\nNenhum bloqueio registrado.\n");
export function bloqueiosMd(trabalho: string, itens: Obj[], tool = "sprintx"): string {
  return md({ expx_schema: 1, expx_tool: tool, kind: "bloqueios", trabalho_id: trabalho, atualizado_em: "2026-09-28", bloqueios: itens }, "# Bloqueios\n");
}
const baseIndice = (trabalho: string, tool = "sprintx"): string =>
  md({ expx_schema: 1, expx_tool: tool, kind: "base_indice", trabalho_id: trabalho, atualizado_em: "2026-09-20" }, "# Indice da base\n");
const decisoes = (trabalho: string, itens: Obj[] = [{ id: "D-00", decisao: "densidade padrao", status: "fechada", bloqueante: false }]): string =>
  md({ expx_schema: 1, expx_tool: "sprintx", kind: "decisoes", trabalho_id: trabalho, atualizado_em: "2026-09-21", decisoes: itens }, "# Decisoes\n");

export function evento(o: Obj): string {
  return JSON.stringify({
    ts: "2026-09-28T10:00:00Z",
    expx_eventos: 1,
    trabalho_id: "x",
    ferramenta: "sprintx",
    origem: "skill",
    evento: "task_iniciada",
    fase: "f6",
    task: null,
    agente: "principal",
    resultado: "ok",
    detalhe: "",
    arquivos: [],
    ...o,
  });
}

/** Uma feature mínima e completa, no layout novo ou no legado (mesmo conteúdo, pasta diferente). */
export function escreverFeatureSimples(raiz: string, pasta: string, id = "agenda-online"): void {
  const p = pasta.replace(/\/$/, "");
  escrever(raiz, `${p}/base/00-INDICE.md`, baseIndice(id));
  escrever(raiz, `${p}/00-DECISOES.md`, decisoes(id));
  escrever(raiz, `${p}/00-BLOQUEIOS.md`, blocoVazio(id));
  escrever(raiz, `${p}/00-AUDITORIA.md`, `# Auditoria\n\n| sev | achado |\n|---|---|\n| BAIXA | x |\n\nVEREDITO: SIM\n`);
  escrever(raiz, `${p}/ORQUESTRADOR.md`, orquestrador({ id, estagio: "f6" }));
  escrever(raiz, `${p}/sprint-01/sprint.md`, sprintMd(id, "sprint-01", { fases: ["F-01.1", "F-01.2"] }));
  escrever(raiz, `${p}/sprint-01/fases.md`, fasesMd(id, "sprint-01", [fase("F-01.1", ["T-01.01"]), fase("F-01.2", ["T-01.02", "T-01.03"])]));
  escrever(
    raiz,
    `${p}/sprint-01/tasks.md`,
    tasksMd(id, "sprint-01", [
      task({ id: "T-01.01", fase: "F-01.1", status: "concluida", par: true }),
      task({ id: "T-01.02", fase: "F-01.2", status: "em_andamento", dep: ["T-01.01"] }),
      task({ id: "T-01.03", fase: "F-01.2", dep: ["T-01.02"] }),
    ]),
  );
}

export interface InfoFixture {
  raiz: string;
  /** ids dos trabalhos esperados por categoria, para os testes. */
  ids: Record<string, string>;
}

/** Escreve o projeto Expx sintético completo em `raiz` e devolve os ids principais. */
export function gerarProjetoExpx(raiz: string): InfoFixture {
  // -------------------------------------------------------------- .expx
  escrever(raiz, ".expx/expx-lock.json", JSON.stringify({ expx_lock: 1, cli_version: "0.9.0", harness: ["claude", "opencode"], skills: { sprintx: { commit: "abc" }, runx: { commit: "abc" } } }, null, 2));
  escrever(raiz, ".expx/hooks.json", JSON.stringify({ expx_hooks: 1, hooks: { segredo: { modo: "bloqueio", tipo: "seguranca" } } }));
  escrever(raiz, ".expx/memoria/indice.json", JSON.stringify({ versao: 1, arquivos: {} }));

  // ------------------------------------------ sprintx: cobranca-pix (F6, verde)
  const cp = "docs/sprintx/features/cobranca-pix";
  const cpId = "cobranca-pix";
  escrever(raiz, `${cp}/base/00-INDICE.md`, baseIndice(cpId));
  escrever(raiz, `${cp}/base/00-LACUNAS.md`, "# Lacunas\n\nNAO DOCUMENTADO: limites do PSP.\n");
  escrever(raiz, `${cp}/base/pagamentos.md`, "# Pagamentos\n\nSem frontmatter.\n");
  escrever(raiz, `${cp}/00-DECISOES.md`, decisoes(cpId));
  escrever(raiz, `${cp}/00-BLOQUEIOS.md`, blocoVazio(cpId));
  escrever(raiz, `${cp}/00-AUDITORIA.md`, "# Auditoria\n\nVEREDITO: SIM\n");
  escrever(
    raiz,
    `${cp}/ORQUESTRADOR.md`,
    orquestrador({ id: cpId, estagio: "f6", extra: { worktree: "../repo--cobranca-pix", caminho_critico: ["F-01.1", "F-01.2"], chave_extra_futura: "aceita" } }),
  );
  escrever(raiz, `${cp}/sprint-01/sprint.md`, sprintMd(cpId, "sprint-01", { fases: ["F-01.1", "F-01.2"] }));
  escrever(raiz, `${cp}/sprint-01/fases.md`, fasesMd(cpId, "sprint-01", [fase("F-01.1", ["T-01.01", "T-01.02"], { status: "concluido" }), fase("F-01.2", ["T-01.03", "T-01.04"])]));
  escrever(
    raiz,
    `${cp}/sprint-01/tasks.md`,
    tasksMd(cpId, "sprint-01", [
      task({ id: "T-01.01", fase: "F-01.1", status: "concluida", par: true }),
      task({ id: "T-01.02", fase: "F-01.1", status: "concluida", par: true, suite: "parcial" }),
      task({ id: "T-01.03", fase: "F-01.2", status: "concluida", dep: ["T-01.01", "T-01.02"] }),
      task({ id: "T-01.04", fase: "F-01.2", status: "em_andamento", dep: ["T-01.03"] }),
    ]),
  );
  // sprint-02 condensada (kind: plano)
  escrever(
    raiz,
    `${cp}/sprint-02/tasks.md`,
    planoMd(
      "sprintx",
      cpId,
      "sprint-02",
      [fase("F-02.1", ["T-02.01"], { status: "nao_iniciado" }), fase("F-02.2", ["T-02.02"], { status: "nao_iniciado" })],
      [task({ id: "T-02.01", fase: "F-02.1", dep: ["T-01.04"] }), task({ id: "T-02.02", fase: "F-02.2", dep: ["T-02.01"] })],
    ),
  );
  escrever(raiz, `${cp}/FECHAMENTO.md.rascunho`, "ignorado: nome fora da lista\n");

  // rastro com rotação: .1 (antigo, com uma linha quebrada) e o corrente
  escrever(
    raiz,
    "docs/eventos/cobranca-pix.1.jsonl",
    [
      evento({ ts: "2026-09-27T09:00:00Z", trabalho_id: cpId, evento: "fase_iniciada", fase: "f6" }),
      "{esta linha esta quebrada",
      evento({ ts: "2026-09-27T09:05:00Z", trabalho_id: cpId, evento: "task_iniciada", task: "T-01.01" }),
      evento({ ts: "2026-09-27T09:35:00Z", trabalho_id: cpId, evento: "task_concluida", task: "T-01.01", detalhe: "suite verde" }),
    ].join("\n") + "\n",
  );
  escrever(
    raiz,
    "docs/eventos/cobranca-pix.jsonl",
    [
      evento({ ts: "2026-09-28T10:00:00Z", trabalho_id: cpId, evento: "task_iniciada", task: "T-01.03", sessao: "claude@s1", harness: "claude" }),
      evento({ ts: "2026-09-28T10:30:00Z", trabalho_id: cpId, evento: "task_concluida", task: "T-01.03" }),
      evento({ ts: "2026-09-29T11:00:00Z", trabalho_id: cpId, evento: "task_iniciada", task: "T-01.04" }),
    ].join("\n") + "\n",
  );

  // ------------------------------------ sprintx: relatorio-vendas (F5, auditoria NAO)
  const rv = "docs/sprintx/features/relatorio-vendas";
  escrever(raiz, `${rv}/base/00-INDICE.md`, baseIndice("relatorio-vendas"));
  escrever(raiz, `${rv}/00-DECISOES.md`, decisoes("relatorio-vendas"));
  escrever(raiz, `${rv}/00-AUDITORIA.md`, "# Auditoria\n\n| ALTA | plano sem teste |\n\nVEREDITO: NÃO\n");
  escrever(raiz, `${rv}/ORQUESTRADOR.md`, orquestrador({ id: "relatorio-vendas", estagio: "f5" }));
  escrever(raiz, `${rv}/sprint-01/tasks.md`, planoMd("sprintx", "relatorio-vendas", "sprint-01", [fase("F-01.1", ["T-01.01"], { status: "nao_iniciado" })], [task({ id: "T-01.01", fase: "F-01.1" })]));

  // --------------------------------- sprintx: exportar-csv (F2, decisao pendente)
  const ec = "docs/sprintx/features/exportar-csv";
  escrever(raiz, `${ec}/base/00-INDICE.md`, baseIndice("exportar-csv"));
  escrever(raiz, `${ec}/00-DECISOES.md`, decisoes("exportar-csv", [{ id: "D-00", decisao: "densidade", status: "fechada", bloqueante: false }, { id: "D-01", decisao: "formato do arquivo", status: "pendente", bloqueante: true }]));

  // ------------------------------------------ sprintx: so-base (F1)
  escrever(raiz, "docs/sprintx/features/so-base/base/00-INDICE.md", baseIndice("so-base"));

  // ----------------- sprintx: plano-quebrado (todas as violacoes de plano)
  const pq = "docs/sprintx/features/plano-quebrado";
  const pqId = "plano-quebrado";
  escrever(raiz, `${pq}/base/00-INDICE.md`, baseIndice(pqId));
  escrever(raiz, `${pq}/00-DECISOES.md`, decisoes(pqId));
  escrever(raiz, `${pq}/00-AUDITORIA.md`, "VEREDITO: SIM\n");
  // estagio e3 com expx_tool sprintx -> estagio_incoerente
  escrever(raiz, `${pq}/ORQUESTRADOR.md`, orquestrador({ id: pqId, estagio: "e3" }));
  escrever(
    raiz,
    `${pq}/00-BLOQUEIOS.md`,
    bloqueiosMd(pqId, [
      { id: "B-01", task: "T-01.05", aberto_em: "2026-08-01", resolvido_em: null, descricao: "credencial do PSP ausente" },
      { id: "B-02", task: "T-01.01", aberto_em: "2026-08-02", resolvido_em: "2026-08-03", descricao: "resolvido" },
    ]),
  );
  escrever(raiz, `${pq}/sprint-01/sprint.md`, sprintMd(pqId, "sprint-01", { criterio_saida: null, fases: ["F-01.1", "F-01.2"] }));
  escrever(
    raiz,
    `${pq}/sprint-01/fases.md`,
    fasesMd(pqId, "sprint-01", [fase("F-01.1", ["T-01.01", "T-01.02", "T-01.03"], { criterio_saida: null, paralelizavel: true, paralela_com: ["F-01.2"] }), fase("F-01.2", ["T-01.04", "T-01.05"], { paralelizavel: true, paralela_com: ["F-01.1"] })]),
  );
  escrever(
    raiz,
    `${pq}/sprint-01/tasks.md`,
    tasksMd(pqId, "sprint-01", [
      task({ id: "T-01.01", fase: "F-01.1", status: "concluida", suite: "nao_executada", integ: null }),
      task({ id: "T-01.02", fase: "F-01.1", dep: ["T-01.03"] }),
      task({ id: "T-01.03", fase: "F-01.1", dep: ["T-01.02"] }),
      task({ id: "T-01.04", fase: "F-01.2", par: true, dep: ["T-01.01"], func: "   " }),
      task({ id: "T-01.05", fase: "F-01.2", status: "bloqueada", dep: ["T-99.99"] }),
    ]),
  );

  // -------------- sprintx: feature-truncada (YAML truncado + kind desconhecido + BOM)
  const ft = "docs/sprintx/features/feature-truncada";
  escrever(raiz, `${ft}/base/00-INDICE.md`, "﻿" + baseIndice("feature-truncada"));
  escrever(raiz, `${ft}/00-DECISOES.md`, md({ expx_schema: 1, expx_tool: "sprintx", kind: "tipo_do_futuro", trabalho_id: "feature-truncada", decisoes: [], campo_novo: { a: 1 } }));
  escrever(raiz, `${ft}/ORQUESTRADOR.md`, "﻿" + orquestrador({ id: "feature-truncada", estagio: "f4" }));
  escrever(raiz, `${ft}/sprint-01/sprint.md`, sprintMd("feature-truncada", "sprint-01"));
  // tasks.md gravado pela metade (sem o --- de fechamento)
  escrever(raiz, `${ft}/sprint-01/tasks.md`, "---\nexpx_schema: 1\nexpx_tool: sprintx\nkind: tasks\ntrabalho_id: feature-truncada\ntasks:\n  - id: T-01.01\n    titulo: Task tr");

  // --------------- sprintx sob buildx: fundacao-autenticacao (origem_buildx)
  const fa = "docs/sprintx/features/fundacao-autenticacao";
  escrever(raiz, `${fa}/base/00-INDICE.md`, baseIndice("fundacao-autenticacao"));
  escrever(raiz, `${fa}/00-DECISOES.md`, decisoes("fundacao-autenticacao"));
  escrever(raiz, `${fa}/00-AUDITORIA.md`, "VEREDITO: SIM\n");
  escrever(raiz, `${fa}/ORQUESTRADOR.md`, orquestrador({ id: "fundacao-autenticacao", estagio: "f6", extra: { origem_buildx: "loja-demo", feature_id: "FT-01" } }));
  escrever(raiz, `${fa}/sprint-01/tasks.md`, planoMd("sprintx", "fundacao-autenticacao", "sprint-01", [fase("F-01.1", ["T-01.01"])], [task({ id: "T-01.01", fase: "F-01.1", status: "concluida" })]));

  // ------------------------------------------------- legado: agenda-online (docs/<slug>/)
  escreverFeatureSimples(raiz, "docs/agenda-online", "agenda-online");

  // ---------------------------------- runx: OC-2026-0142 (e5, aprovado, entregue)
  const o1 = "docs/manutencao/OC-2026-0142-frete-errado";
  const o1Id = "OC-2026-0142-frete-errado";
  const runxBase = (id: string, extra: Obj = {}) => ({ expx_schema: 1, expx_tool: "runx", trabalho_id: id, atualizado_em: "2026-09-25", ...extra });
  escrever(raiz, `${o1}/00-OCORRENCIA.md`, md(runxBase(o1Id, { kind: "ocorrencia", titulo: "frete errado", tipo_ocorrencia: "bug", recebido_em: "2026-09-20", origem: "ticket-0142", tem_reproducao: true, modulo_afetado: ["frete"], worktree: null }), "# OC\n"));
  escrever(raiz, `${o1}/BLOQUEIOS.md`, blocoVazio(o1Id, "runx"));
  escrever(raiz, `${o1}/base/00-INDICE.md`, baseIndice(o1Id, "runx"));
  escrever(raiz, `${o1}/01-CAUSA-RAIZ.md`, md(runxBase(o1Id, { kind: "causa_raiz", modo: "causa_raiz", comprovada: true, evidencia: "teste_falho", arquivos_impactados: ["src/frete/calculo.ts"], palavras_chave: ["frete"], regressao_de: "OC-2026-0100-peso", evidencia_regressao: "calculo.ts:42 alterado pela OC-2026-0100", decisoes: [] }), "# Causa raiz\n"));
  escrever(raiz, `${o1}/ORQUESTRADOR.md`, orquestrador({ tool: "runx", id: o1Id, estagio: "e5", status: "concluido", tipo_trabalho: "ocorrencia", tipo_ocorrencia: "bug" }));
  escrever(
    raiz,
    `${o1}/sprint-01/tasks.md`,
    planoMd("runx", o1Id, "sprint-01", [fase("F-01.1", ["T-01.01", "T-01.02"], { status: "concluido" })], [
      task({ id: "T-01.01", fase: "F-01.1", status: "concluida", regressao: "frete com peso zero falha antes do fix" }),
      task({ id: "T-01.02", fase: "F-01.1", status: "concluida", dep: ["T-01.01"], regressao: null }),
    ]),
  );
  escrever(raiz, `${o1}/QA.md`, md(runxBase(o1Id, { kind: "qa", veredito: "aprovado", executado_em: "2026-09-25", achados: [] }), "# QA\n\nVEREDITO: APROVADO — pronta para fechamento.\n"));
  escrever(raiz, "docs/relatorios/INDICE.md", md({ expx_schema: 1, expx_tool: "runx", kind: "relatorios_indice", atualizado_em: "2026-09-26" }, "# Indice\n\n| OC | titulo |\n"));
  escrever(raiz, `docs/relatorios/2026-09-26-${o1Id}/tecnico.md`, md(runxBase(o1Id, { kind: "relatorio_tecnico" }), "# Tecnico\n"));
  escrever(raiz, `docs/relatorios/2026-09-26-${o1Id}/uso.md`, md(runxBase(o1Id, { kind: "relatorio_uso" }), "# Uso\n"));
  escrever(
    raiz,
    `docs/entregas/${o1Id}/ENTREGA.md`,
    md(
      { expx_schema: 1, expx_tool: "runx", kind: "entrega", trabalho_id: o1Id, entregue_por: "mergex", titulo: "frete errado", tipo_trabalho: "ocorrencia", tipo_ocorrencia: "bug", estado: "entregue", versionado: true, branch: "fix/OC-2026-0142-frete-errado", branch_base: "main", commits: [{ task: "T-01.01", commit: "a1b2c3" }, { task: "T-01.02", commit: "d4e5f6" }], modulo_afetado: ["frete"], arquivos_alterados: ["src/frete/calculo.ts"], faixa_atencao: [{ arquivo: "src/frete/calculo.ts", faixa: "alta" }], raio: null, atencao: { olho_obrigatorio: 1, leitura_rapida: 0, dispensavel: 0 }, portao: "pronto", desvios: [], push_feito: true, pr_url: "https://exemplo.invalid/pr/7", pr_estado: "merged", criado_em: "2026-09-25", atualizado_em: "2026-09-26", entregue_em: "2026-09-26" },
      "# Entrega\n",
    ),
  );
  escrever(raiz, `docs/entregas/${o1Id}/PR.md`, "# PR\n");

  // ------------------------------- runx: OC-2026-0150 (QA reprovado -> e3, vermelho)
  const o2 = "docs/manutencao/OC-2026-0150-tela-lenta";
  const o2Id = "OC-2026-0150-tela-lenta";
  escrever(raiz, `${o2}/00-OCORRENCIA.md`, md(runxBase(o2Id, { kind: "ocorrencia", titulo: "tela lenta", tipo_ocorrencia: "melhoria-ux", recebido_em: "2026-09-22", origem: null, tem_reproducao: false, modulo_afetado: [], worktree: null }), "# OC\n"));
  escrever(raiz, `${o2}/01-CAUSA-RAIZ.md`, md(runxBase(o2Id, { kind: "causa_raiz", modo: "analise_impacto", comprovada: false, evidencia: null, arquivos_impactados: [], palavras_chave: [], regressao_de: null, evidencia_regressao: null, decisoes: [] }), "# Impacto\n"));
  escrever(raiz, `${o2}/ORQUESTRADOR.md`, orquestrador({ tool: "runx", id: o2Id, estagio: "e3", tipo_trabalho: "ocorrencia", tipo_ocorrencia: "melhoria-ux" }));
  escrever(raiz, `${o2}/sprint-01/tasks.md`, planoMd("runx", o2Id, "sprint-01", [fase("F-01.1", ["T-01.01"], { status: "concluido" })], [task({ id: "T-01.01", fase: "F-01.1", status: "concluida" })]));
  escrever(raiz, `${o2}/QA.md`, md(runxBase(o2Id, { kind: "qa", veredito: "reprovado", executado_em: "2026-09-27", achados: [{ severidade: "alta", arquivo: "src/tela.ts", problema: "teste fraco", correcao_sugerida: "reforcar" }] }), "# QA\n\nVEREDITO: REPROVADO — nao esta pronta.\n"));

  // ---------- runx: OC-2026-0155 (bug sem teste de regressao, e3, em andamento)
  const o3 = "docs/manutencao/OC-2026-0155-sem-regressao";
  const o3Id = "OC-2026-0155-sem-regressao";
  escrever(raiz, `${o3}/00-OCORRENCIA.md`, md(runxBase(o3Id, { kind: "ocorrencia", titulo: "sem regressao", tipo_ocorrencia: "bug", recebido_em: "2026-09-28", origem: null, tem_reproducao: true, modulo_afetado: [], worktree: null }), "# OC\n"));
  escrever(raiz, `${o3}/01-CAUSA-RAIZ.md`, md(runxBase(o3Id, { kind: "causa_raiz", modo: "causa_raiz", comprovada: true, evidencia: "log", arquivos_impactados: [], palavras_chave: [], regressao_de: null, evidencia_regressao: null, decisoes: [] }), "# Causa\n"));
  escrever(raiz, `${o3}/ORQUESTRADOR.md`, orquestrador({ tool: "runx", id: o3Id, estagio: "e3", tipo_trabalho: "ocorrencia", tipo_ocorrencia: "bug" }));
  escrever(raiz, `${o3}/sprint-01/tasks.md`, planoMd("runx", o3Id, "sprint-01", [fase("F-01.1", ["T-01.01"])], [task({ id: "T-01.01", fase: "F-01.1", status: "em_andamento", regressao: null })]));

  // -------------------- runx: OC-2026-0160 (so ocorrencia, sem causa raiz -> e1)
  const o4Id = "OC-2026-0160-recem-chegada";
  escrever(raiz, `docs/manutencao/${o4Id}/00-OCORRENCIA.md`, md(runxBase(o4Id, { kind: "ocorrencia", titulo: "recem chegada", tipo_ocorrencia: "bug", recebido_em: "2026-09-29", origem: null, tem_reproducao: false, modulo_afetado: [], worktree: null }), "# OC\n"));

  // -------------------------------------------------------------------- prodx
  const prodBase = { schema: "expx-schema-v1" };
  escrever(raiz, "docs/produto/PRODUTO.md", md({ kind: "produto", ...prodBase, titulo: "Produto", data: "2026-09-01", signatario: "Maria (provisorio)" }, "# Produto\n"));
  escrever(raiz, "docs/produto/INDICE.md", md({ kind: "produto_indice", ...prodBase, atualizado_em: "2026-09-28" }, "# Indice\n"));
  const p1 = "docs/produto/pedidos/PD-2026-0007-exportar-pdf";
  escrever(raiz, `${p1}/01-pedido.md`, md({ kind: "pedido", ...prodBase, pd_id: "PD-2026-0007", titulo: "exportar pdf", data: "2026-09-26", classificacao: "novo" }, "# Pedido\n"));
  escrever(raiz, `${p1}/02-existencia.md`, md({ kind: "existencia", ...prodBase, pd_id: "PD-2026-0007", titulo: "exportar pdf", data: "2026-09-26", desfecho: "nao_existe" }, "# Existencia\n"));
  escrever(raiz, `${p1}/03-avaliacao.md`, md({ kind: "avaliacao", ...prodBase, pd_id: "PD-2026-0007", titulo: "exportar pdf", data: "2026-09-27" }, "# Avaliacao\n"));
  escrever(raiz, `${p1}/VEREDITO.md`, md({ kind: "veredito", ...prodBase, pd_id: "PD-2026-0007", titulo: "exportar pdf", data: "2026-09-27", veredito: "fazer", via: "avaliacao", gatilhos_disparados: ["G1"], aprovado_por: "PENDENTE", aprovado_em: "PENDENTE", provisorio: false, trabalho_gerado: "-", recorrencia: 1 }, "# Veredito\n\n**FAZER**\n"));
  const p2 = "docs/produto/pedidos/PD-2026-0008-tema-escuro";
  escrever(raiz, `${p2}/01-pedido.md`, md({ kind: "pedido", ...prodBase, pd_id: "PD-2026-0008", titulo: "tema escuro", data: "2026-09-20", classificacao: "melhoria" }, "# Pedido\n"));
  escrever(raiz, `${p2}/02-existencia.md`, md({ kind: "existencia", ...prodBase, pd_id: "PD-2026-0008", data: "2026-09-20" }, "# Existencia\n"));
  escrever(raiz, `${p2}/03-avaliacao.md`, md({ kind: "avaliacao", ...prodBase, pd_id: "PD-2026-0008", data: "2026-09-21" }, "# Avaliacao\n"));
  escrever(raiz, `${p2}/VEREDITO.md`, md({ kind: "veredito", ...prodBase, pd_id: "PD-2026-0008", titulo: "tema escuro", data: "2026-09-21", veredito: "fazer", via: "avaliacao", gatilhos_disparados: [], aprovado_por: "Maria", aprovado_em: "2026-09-22", provisorio: false, trabalho_gerado: "sprintx:tema-escuro", recorrencia: 1 }, "# Veredito\n"));
  escrever(raiz, `${p2}/BRIEFING.md`, md({ kind: "briefing", ...prodBase, pd_id: "PD-2026-0008", destino: "sprintx", densidade_sugerida: "mvp", modo_construcao_sugerido: "autonomo" }, "# Briefing\n"));

  // ------------------------------------------------------------------- buildx
  const projId = "loja-demo";
  const bx = (kind: string, extra: Obj = {}) => ({ expx_schema: 1, expx_tool: "buildx", kind, projeto_id: projId, atualizado_em: "2026-09-28", ...extra });
  escrever(raiz, "docs/projeto/PROJETO.md", md(bx("projeto", { titulo: "Loja demo", etapa: "b4", total_features: 3, features_entregues: 1, features_bloqueadas: 0, ciclos_recursao: 0 }), "# Loja demo\n"));
  escrever(raiz, "docs/projeto/PREMISSAS.md", md(bx("premissas"), "# Premissas\n"));
  escrever(raiz, "docs/projeto/VEREDITO.md", md({ kind: "veredito", schema: "expx-schema-v1", pd_id: "PD-2026-0001", aprovado_por: "buildx (modo autonomo)", provisorio: true, veredito: "fazer" }, "# Veredito\n"));
  escrever(
    raiz,
    "docs/projeto/MAPA.md",
    md(
      bx("mapa", { total_features: 3, pendentes: 1, em_andamento: 1, entregues: 1, bloqueadas: 0 }),
      [
        "# Loja demo — Mapa de features",
        "",
        "### FT-01 — Fundacao e autenticacao",
        "**Slug:** `fundacao-autenticacao` → `docs/fundacao-autenticacao/`",
        "**Entrega:** o usuario entra no sistema.",
        "**Depende de:** []",
        "**Paralelizável:** false",
        "**Origem:** template",
        "**Status:** entregue",
        "**PR:** #1",
        "",
        "---",
        "",
        "### FT-02 — Catalogo",
        "**Slug:** `catalogo`",
        "**Depende de:** [FT-01]",
        "**Paralelizável:** false",
        "**Origem:** descricao",
        "**Status:** em_andamento",
        "",
        "---",
        "",
        "### FT-03 — Carrinho",
        "**Slug:** `carrinho`",
        "**Depende de:** [FT-01, FT-02]",
        "**Paralelizável:** false",
        "**Origem:** descricao",
        "**Status:** pendente",
        "",
      ].join("\n"),
    ),
  );

  // ------------------------------------------------ camadas (stackx/legadox/designx)
  escrever(raiz, "docs/stack/CONVENCOES.md", "# Convencoes\n\n## Testes\nEvidencia: tests/a.test.ts:1\n");
  escrever(raiz, "docs/legado/PERFIL.md", "# Perfil do legado\n\n## FAIXA: MEDIO\n\nSem frontmatter.\n");
  escrever(raiz, "docs/legado/raio/exportar-csv.md", "# Raio\n\n## FAIXA: ALTO\n\nAprovado por: PENDENTE\n");
  escrever(raiz, "docs/legado/raio/cobranca-pix.md", "# Raio\n\n## FAIXA: BAIXO\n");
  escrever(raiz, "docs/design-system/DESIGN-SYSTEM.md", md({ expx_schema: 1, expx_tool: "designx", kind: "design_system", origem: "cartografia", consistente: true, drift_detectado: false }, "# DS\n"));
  escrever(raiz, "docs/design-system/AUDIT.md", md({ expx_schema: 1, expx_tool: "designx", kind: "design_audit", veredito: "aprovado", violacoes: 0, avisos: 1 }, "# Audit\n"));

  // -------------------------------------------------------------- ruido ignorado
  escrever(raiz, "docs/node_modules/pacote/ORQUESTRADOR.md", md({ expx_schema: 1, expx_tool: "sprintx", kind: "orquestrador", trabalho_id: "deve-ser-ignorado" }));
  escrever(raiz, "docs/dist/ORQUESTRADOR.md", md({ expx_schema: 1, expx_tool: "sprintx", kind: "orquestrador", trabalho_id: "deve-ser-ignorado-dist" }));

  return {
    raiz,
    ids: {
      emExecucao: cpId,
      auditoriaNao: "relatorio-vendas",
      decisaoPendente: "exportar-csv",
      soBase: "so-base",
      planoQuebrado: pqId,
      truncada: "feature-truncada",
      sobBuildx: "fundacao-autenticacao",
      legado: "agenda-online",
      runxEntregue: o1Id,
      runxReprovado: o2Id,
      runxSemRegressao: o3Id,
      runxRecente: o4Id,
      prodxPendente: "PD-2026-0007",
      prodxAssinado: "PD-2026-0008",
      projeto: projId,
    },
  };
}

/** Projeto sintético grande para medir P-10: N artefatos de estado em `docs/`. */
export function gerarVolume(raiz: string, artefatos = 200): number {
  let n = 0;
  let i = 0;
  while (n < artefatos) {
    i++;
    const id = `feature-${String(i).padStart(3, "0")}`;
    const p = `docs/sprintx/features/${id}`;
    const arquivos = 10;
    escrever(raiz, `${p}/base/00-INDICE.md`, baseIndice(id));
    escrever(raiz, `${p}/00-DECISOES.md`, decisoes(id));
    escrever(raiz, `${p}/00-BLOQUEIOS.md`, blocoVazio(id));
    escrever(raiz, `${p}/00-AUDITORIA.md`, "VEREDITO: SIM\n");
    escrever(raiz, `${p}/ORQUESTRADOR.md`, orquestrador({ id, estagio: "f6" }));
    escrever(raiz, `${p}/sprint-01/sprint.md`, sprintMd(id, "sprint-01"));
    escrever(raiz, `${p}/sprint-01/fases.md`, fasesMd(id, "sprint-01", [fase("F-01.1", ["T-01.01", "T-01.02"])]));
    escrever(
      raiz,
      `${p}/sprint-01/tasks.md`,
      tasksMd(id, "sprint-01", [task({ id: "T-01.01", fase: "F-01.1", status: "concluida" }), task({ id: "T-01.02", fase: "F-01.1", dep: ["T-01.01"] })]),
    );
    escrever(raiz, `${p}/sprint-02/tasks.md`, planoMd("sprintx", id, "sprint-02", [fase("F-02.1", ["T-02.01"])], [task({ id: "T-02.01", fase: "F-02.1", dep: ["T-01.02"] })]));
    escrever(raiz, `${p}/FECHAMENTO.md`, md({ expx_schema: 1, expx_tool: "sprintx", kind: "fechamento", trabalho_id: id }));
    n += arquivos;
  }
  return n;
}
