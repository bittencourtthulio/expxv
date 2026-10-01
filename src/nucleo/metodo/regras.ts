import { montarGrafo } from "./grafo";
import type { Task, Trabalho, Violacao } from "./tipos";

export interface OpcoesRegras {
  /** "agora" entra como parâmetro: regra que lê o relógio não é testável. Epoch em ms. */
  agora: number;
  diasBloqueio?: number;
}

const vazio = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

const PREFIXO_ESTAGIO: Record<string, string> = { sprintx: "f", runx: "e", buildx: "b" };

function ordinalEstagio(e: string | null): { letra: string; n: number } | null {
  const m = e ? /^([a-z])(\d+)/.exec(e) : null;
  return m?.[1] && m[2] ? { letra: m[1], n: Number(m[2]) } : null;
}

function diasEntre(inicio: string | null, agora: number): number {
  const a = inicio ? Date.parse(`${inicio.slice(0, 10)}T00:00:00Z`) : NaN;
  if (Number.isNaN(a)) return 0;
  const d = new Date(agora);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - a) / 86_400_000);
}

function todasAsTasks(t: Trabalho): Task[] {
  return t.sprints.flatMap((s) => s.fases.flatMap((f) => f.tasks));
}

/**
 * Violações do método: o que o ADE LEU e desobedece uma regra (distinto de rejeição, que é falha
 * de leitura). Escopos estreitos de propósito (violação falsa é defeito): regressão só para bug
 * do runx; critério de saída só para fase declarada; dependência só dentro do trabalho.
 */
export function verificarViolacoes(t: Trabalho, opcoes: OpcoesRegras): Violacao[] {
  const saida: Violacao[] = [];
  const diasBloqueio = opcoes.diasBloqueio ?? 7;
  const tasks = todasAsTasks(t);
  const v = (tipo: Violacao["tipo"], alvo: string, arquivo: string, detalhe: string): void => {
    saida.push({ tipo, trabalho_id: t.id, alvo, arquivo, detalhe });
  };

  for (const task of tasks) {
    for (const campo of ["teste_integracao", "teste_funcional"] as const) {
      if (vazio(task[campo])) v("teste_ausente", task.id, task.arquivo, `${campo} esta ausente ou vazio`);
    }
    // `verde` e `parcial` fecham task; a suíte inteira é cobrada no portão (E4 / fim de sprint).
    if (task.status === "concluida" && task.suite !== "verde" && task.suite !== "parcial") {
      v("concluida_sem_verde", task.id, task.arquivo, `task concluida com suite ${task.suite}`);
    }
    if (task.paralelizavel && task.depende_de.length > 0) {
      v("paralela_com_dependencia", task.id, task.arquivo, `paralelizavel: true com depende_de ${task.depende_de.join(", ")}`);
    }
  }

  if (t.ferramenta === "runx" && t.tipo_ocorrencia === "bug" && tasks.length > 0) {
    const primeira = [...tasks].sort((a, b) => a.id.localeCompare(b.id))[0];
    if (primeira && vazio(primeira.teste_regressao)) v("regressao_ausente", primeira.id, primeira.arquivo, "primeira task de um bug sem teste_regressao");
  }

  // paralelismo declarado entre fases que, na verdade, dependem uma da outra
  const fases = t.sprints.flatMap((s) => s.fases);
  const porFase = new Map(fases.map((f) => [f.id, new Set(f.tasks.map((x) => x.id))]));
  const fasesComConflito = new Set<string>();
  for (const f of fases) {
    for (const outraId of f.paralela_com) {
      const outra = fases.find((x) => x.id === outraId);
      const idsOutra = porFase.get(outraId);
      const idsF = porFase.get(f.id);
      if (!outra || !idsOutra || !idsF) continue;
      const cruza =
        f.tasks.some((x) => x.depende_de.some((d) => idsOutra.has(d))) || outra.tasks.some((x) => x.depende_de.some((d) => idsF.has(d)));
      if (cruza) {
        fasesComConflito.add(f.id);
        fasesComConflito.add(outraId);
      }
    }
  }
  for (const id of [...fasesComConflito].sort()) {
    const f = fases.find((x) => x.id === id);
    if (f) v("paralela_com_dependencia", id, f.arquivo, "fase declarada paralela com outra de que depende (ou que dela depende)");
  }

  for (const s of t.sprints) {
    if (vazio(s.criterio_saida)) v("sem_criterio_saida", s.id, s.arquivo, "sprint sem criterio_saida");
    for (const f of s.fases) {
      if (f.declarada && vazio(f.criterio_saida)) v("sem_criterio_saida", f.id, f.arquivo, "fase sem criterio_saida");
    }
  }

  for (const b of t.bloqueios) {
    if (!b.aberto) continue;
    const dias = diasEntre(b.aberto_em, opcoes.agora);
    if (dias > diasBloqueio) v("bloqueio_antigo", b.id, b.arquivo, `aberto ha ${dias} dias (limite ${diasBloqueio})`);
  }

  // referências e ciclos: entre tasks, e entre features no buildx
  const nosTasks = tasks.map((x) => ({ id: x.id, depende_de: x.depende_de, fase: x.fase, status: x.status as string }));
  const arquivoDe = new Map<string, string>(tasks.map((x) => [x.id, x.arquivo]));
  const nosFeatures = t.features.map((x) => ({ id: x.id, depende_de: x.depende_de, fase: null, status: x.status }));
  for (const x of t.features) arquivoDe.set(x.id, `${t.pasta}/MAPA.md`);
  for (const nos of [nosTasks, nosFeatures]) {
    if (nos.length === 0) continue;
    const g = montarGrafo(nos);
    for (const d of g.dependencias_inexistentes) {
      v("dependencia_inexistente", d.de, arquivoDe.get(d.de) ?? t.pasta, `depende_de aponta ${d.ate}, que nao existe neste trabalho`);
    }
    for (const id of g.ciclos.flat().sort()) v("ciclo_dependencia", id, arquivoDe.get(id) ?? t.pasta, "participa de um ciclo de dependencias");
  }

  // estágio: coerente com a ferramenta e não à frente do que o disco prova
  const arqOrq = `${t.pasta}/ORQUESTRADOR.md`;
  const prefixo = PREFIXO_ESTAGIO[t.ferramenta];
  if (prefixo && t.estagio_declarado) {
    const decl = ordinalEstagio(t.estagio_declarado);
    if (!decl || decl.letra !== prefixo) {
      v("estagio_incoerente", t.id, arqOrq, `${t.ferramenta} com estagio ${t.estagio_declarado}`);
    } else {
      const disco = ordinalEstagio(t.estagio);
      if (disco && disco.letra === decl.letra && decl.n > disco.n) {
        v("estagio_incoerente", t.id, arqOrq, `estagio declarado ${t.estagio_declarado} esta a frente do que o disco prova (${t.estagio})`);
      }
    }
  }
  return saida;
}
