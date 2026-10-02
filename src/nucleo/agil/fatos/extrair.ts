// T-18.06: Trabalho + rastro => FatoTask (PURO, nunca lança). O disco vence o rastro em status; duração só com `task_iniciada` anterior;
// sem rastro => `tem_rastro=false` e campos null. Linhas incompletas/fora de ordem/de rotação são toleradas.
import type { CommitFato, FatoTask } from "../../../compartilhado/agil";
import type { EventoRastro, Task } from "../../metodo/tipos";
import { atribuirAchado, severidadeForte } from "../retrabalho/atribuicao";
import type { CommitEntrega, FonteTrabalho } from "../portas";
import { instante, isoDe, ms } from "../util";

const TETO_ARQUIVOS = 200;
export interface OpcoesExtracao {
  agora: number;
  padroesTeste: readonly string[];
  /** fatos anteriores do mesmo trabalho (por task_ref): detecta `concluida` -> outro status por transição observada. */
  anteriores?: ReadonlyMap<string, FatoTask> | undefined;
}

export const ehArquivoDeTeste = (caminho: string, padroes: readonly string[]): boolean => {
  const c = `/${caminho.toLowerCase()}`;
  return padroes.some((p) => c.includes(p.toLowerCase()));
};

interface Ev { e: EventoRastro; t: number }
const ordenadosDaTask = (rastro: readonly EventoRastro[]): Map<string, Ev[]> => {
  const por = new Map<string, Ev[]>();
  for (const e of rastro) {
    if (!e || typeof e.task !== "string" || !e.task) continue;
    const t = ms(typeof e.ts === "string" ? e.ts : null);
    if (t === null) continue;
    (por.get(e.task) ?? por.set(e.task, []).get(e.task))?.push({ e, t });
  }
  for (const l of por.values()) l.sort((a, b) => a.t - b.t);
  return por;
};

function tasksDe(f: FonteTrabalho): Task[] {
  return f.trabalho.sprints.flatMap((s) => s.fases.flatMap((x) => x.tasks));
}

function commitsDaTask(ref: string, evs: readonly Ev[], entrega: readonly CommitEntrega[]): CommitFato[] {
  const out: CommitFato[] = [];
  const visto = new Set<string>();
  const add = (c: CommitFato): void => {
    const k = c.sha ?? `${c.mensagem}|${c.ts ?? ""}`;
    if (visto.has(k)) return;
    visto.add(k);
    out.push(c);
  };
  const re = new RegExp(`\\b${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  for (const c of entrega) if (c.task_ref === ref || (c.task_ref === null && re.test(c.mensagem))) add({ sha: c.sha, mensagem: c.mensagem, ts: c.ts, linhas: c.linhas, labels: c.labels });
  for (const { e } of evs) {
    if (e.evento !== "commit_criado") continue;
    const sha = typeof e["sha"] === "string" ? (e["sha"] as string) : null;
    add({ sha, mensagem: String(e.detalhe ?? ""), ts: e.ts, linhas: typeof e["linhas"] === "number" ? (e["linhas"] as number) : null, labels: [] });
  }
  return out;
}

export function extrairFatos(fonte: FonteTrabalho, o: OpcoesExtracao): FatoTask[] {
  const porTask = ordenadosDaTask(Array.isArray(fonte.rastro) ? fonte.rastro : []);
  const primeiroEvento = [...porTask.values()].reduce<number | null>((m, l) => (l[0] && (m === null || l[0].t < m) ? l[0].t : m), null);
  const tasks = tasksDe(fonte);
  const arquivosPorTask = new Map<string, string[]>();
  const base = new Map<string, Omit<FatoTask, "qa_reprovacoes">>();

  for (const t of tasks) {
    const evs = porTask.get(t.id) ?? [];
    const tem = evs.length > 0;
    const concluidasRastro = evs.filter((x) => x.e.evento === "task_concluida");
    const ultimaConclRastro = concluidasRastro[concluidasRastro.length - 1];
    // concluída_em: o disco vence — só existe se o status do disco é `concluida`
    let conclIso: string | null = null;
    let precisa = false;
    if (t.status === "concluida") {
      if (ultimaConclRastro) { conclIso = isoDe(ultimaConclRastro.t); precisa = true; }
      else { const d = instante(t.concluida_em); conclIso = d?.iso ?? null; precisa = d?.preciso ?? false; }
    }
    const conclMs = ms(conclIso);
    const iniciadas = evs.filter((x) => x.e.evento === "task_iniciada");
    // iniciada_em = último `task_iniciada` antes da conclusão (ou o último, se não concluída)
    const candidatas = conclMs !== null && precisa ? iniciadas.filter((x) => x.t <= conclMs) : iniciadas;
    const ultimaIni = candidatas[candidatas.length - 1];
    const duracao = t.status === "concluida" && precisa && conclMs !== null && ultimaIni ? Math.max(0, conclMs - ultimaIni.t) : null;

    // reaberturas: task_iniciada depois de task_concluida (rastro) e transição observada
    const reabertas = new Set<string>();
    let viuConclusao = false;
    for (const x of evs) {
      if (x.e.evento === "task_concluida") viuConclusao = true;
      else if (x.e.evento === "task_iniciada" && viuConclusao) { reabertas.add(isoDe(x.t)); viuConclusao = false; }
    }
    const ant = o.anteriores?.get(t.id);
    let reabertasEm = [...reabertas].sort();
    if (ant) {
      reabertasEm = [...new Set([...ant.reabertas_em, ...reabertasEm])].sort();
      if (ant.status_visto === "concluida" && t.status !== "concluida" && !reabertasEm.some((r) => !ant.reabertas_em.includes(r))) reabertasEm.push(isoDe(o.agora));
    }
    // ciclos pós-reabertura (mínimo observado): de cada reabertura até a conclusão seguinte
    let retrabMs: number | null = null;
    if (tem && reabertasEm.length > 0) {
      retrabMs = 0;
      for (const r of reabertasEm) {
        const rt = ms(r) as number;
        const prox = concluidasRastro.find((x) => x.t > rt);
        if (prox) retrabMs += prox.t - rt;
      }
    }

    // bloqueio: de `task_bloqueada` até o próximo `task_iniciada`/`task_concluida`
    let bloqueadaMs: number | null = null;
    if (tem) {
      bloqueadaMs = 0;
      let ini: number | null = null;
      for (const x of evs) {
        if (x.e.evento === "task_bloqueada") ini ??= x.t;
        else if ((x.e.evento === "task_iniciada" || x.e.evento === "task_concluida") && ini !== null) { bloqueadaMs += x.t - ini; ini = null; }
      }
      if (ini !== null && t.status === "bloqueada") bloqueadaMs += Math.max(0, o.agora - ini);
    }

    // intervalos em andamento (WIP)
    const intervalos: [string, string | null][] = [];
    let abertoEm: number | null = null;
    for (const x of evs) {
      if (x.e.evento === "task_iniciada") abertoEm ??= x.t;
      else if (x.e.evento === "task_concluida" && abertoEm !== null) { intervalos.push([isoDe(abertoEm), isoDe(x.t)]); abertoEm = null; }
    }
    if (abertoEm !== null && t.status !== "concluida") intervalos.push([isoDe(abertoEm), null]);

    // arquivos, TDD, vermelho antes do verde (só a partir do rastro)
    const arquivosEv = evs.filter((x) => x.e.evento === "arquivo_alterado");
    const ordenArq: string[] = [];
    for (const x of arquivosEv) for (const a of Array.isArray(x.e.arquivos) ? x.e.arquivos : []) if (typeof a === "string") ordenArq.push(a);
    const arquivos = [...new Set(ordenArq)].sort().slice(0, TETO_ARQUIVOS);
    arquivosPorTask.set(t.id, arquivos);
    let tdd: boolean | null = null;
    if (ordenArq.length > 0) {
      const iT = ordenArq.findIndex((a) => ehArquivoDeTeste(a, o.padroesTeste));
      const iP = ordenArq.findIndex((a) => !ehArquivoDeTeste(a, o.padroesTeste));
      tdd = iT === -1 ? false : iP === -1 ? true : iT < iP;
    }
    const suites = evs.filter((x) => x.e.evento === "suite_executada");
    let vermelho: boolean | null = null;
    if (suites.length > 0) {
      const ok = (x: Ev): boolean => x.e.resultado === "ok";
      const primeiroOk = suites.findIndex(ok);
      vermelho = primeiroOk === -1 ? null : suites.slice(0, primeiroOk).some((x) => !ok(x));
    }

    const agenteEv = iniciadas[0]?.e.agente ?? concluidasRastro[0]?.e.agente ?? evs.find((x) => x.e.agente)?.e.agente ?? null;
    const qaAprovado = fonte.trabalho.veredito_qa === "aprovado" || fonte.trabalho.veredito_qa === "sim";
    const validada = qaAprovado && t.status === "concluida" ? fonte.qa?.emitido_em ?? fonte.trabalho.ultima_atividade ?? null : null;
    const tipo = (t as unknown as { tipo_task?: unknown }).tipo_task;

    base.set(t.id, {
      workspace_id: fonte.workspace_id, trabalho_id: fonte.trabalho.id, task_ref: t.id, titulo: t.titulo, fase: t.fase, depende_de: [...t.depende_de],
      criterio_aceite: t.criterio_aceite, tipo_task: typeof tipo === "string" ? tipo : null, status_visto: t.status,
      iniciada_em: ultimaIni ? isoDe(ultimaIni.t) : null, concluida_em: conclIso, concluida_ts_precisa: precisa, duracao_obs_ms: duracao,
      bloqueada_ms: bloqueadaMs, reaberturas: reabertasEm.length, reabertas_em: reabertasEm, retrabalho_ms: retrabMs,
      suite_final: t.suite, agente: agenteEv, membro_id: null, arquivos, tdd_primeiro: tdd, vermelho_antes: vermelho,
      commits: commitsDaTask(t.id, evs, fonte.commits ?? []), validada_em: validada, tem_rastro: tem, intervalos,
      primeiro_evento_em: primeiroEvento === null ? null : isoDe(primeiroEvento),
      declarados: { integracao: !!t.teste_integracao, funcional: !!t.teste_funcional, regressao: !!t.teste_regressao },
      versao_origem: fonte.versao_origem, atualizado_em: isoDe(o.agora),
    });
  }

  // QA reprovado por task (atribuição: citada > arquivos > só o trabalho)
  const qaPorTask = new Map<string, number>();
  const refs = tasks.map((t) => ({ task_ref: t.id, arquivos: arquivosPorTask.get(t.id) ?? [] }));
  for (const a of fonte.qa?.achados ?? []) {
    if (!severidadeForte(a.severidade)) continue;
    for (const ref of atribuirAchado(a, refs).tasks) qaPorTask.set(ref, (qaPorTask.get(ref) ?? 0) + 1);
  }
  return [...base.values()].map((b) => ({ ...b, qa_reprovacoes: qaPorTask.get(b.task_ref) ?? 0 }));
}
