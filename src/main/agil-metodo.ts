// Adaptador `PortaMetodo` da gestão ágil (Fase 18, T-18.07) sobre o modelo do método que o main já mantém (`GerenciadorMetodo`). SOMENTE LEITURA (D-04):
// nunca escreve em `docs/**`. Para cada trabalho com tasks monta a `FonteTrabalho` (rastro completo + QA.md + ENTREGA.md, tolerantes) com `montarFonte`.
// LEVEZA: só relê rastro/artefatos do trabalho cuja ASSINATURA BARATA (status, última atividade, contagem de eventos, vereditos, tasks) mudou; o resto volta do
// cache e o sincronizador o pula por `versao_origem`. Leitura de arquivo é assíncrona e com concorrência limitada; nada aqui bloqueia o event loop.
import type { Artefato, EventoRastro, Trabalho } from "../nucleo/metodo/tipos";
import { montarFonte } from "../nucleo/agil/fatos/fonte";
import type { FonteTrabalho, OcorrenciaRunx, PortaMetodo } from "../nucleo/agil/portas";
import { acharTrabalho, type IndicesPorRaiz } from "../nucleo/metodo/missao";
import { lerArtefato } from "../nucleo/metodo/parser/leitores";
import { hash } from "../nucleo/agil/util";

const PAGINA = 500;
const TETO_EVENTOS = 50_000;
const CONCORRENCIA = 4;
const SEGURO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export interface DepsPortaMetodoAgil {
  /** garante o índice do método do workspace (idempotente) e devolve a raiz; `null` = workspace sem método. */
  garantir(workspaceId: string): Promise<{ raiz: string } | null>;
  indices(workspaceId: string): Promise<IndicesPorRaiz>;
  /** todos os trabalhos (mesclados entre worktrees) do workspace. */
  trabalhos(workspaceId: string): Trabalho[];
  rastro(workspaceId: string, trabalhoId: string, depois: number): Promise<{ eventos: EventoRastro[]; proximo: number }>;
  lerArtefato?: (raiz: string, relativo: string) => Promise<Artefato>;
}

interface EntradaCache { assinatura: string; fonte: FonteTrabalho }
const temTasks = (t: Trabalho): boolean => t.sprints.some((s) => s.fases.some((f) => f.tasks.length > 0));

/** muda quando algo que importa muda; barata (nenhum arquivo é aberto). */
export function assinaturaBarata(t: Trabalho): string {
  const tasks = t.sprints.flatMap((s) => s.fases.flatMap((f) => f.tasks.map((k) => `${k.id}:${k.status}:${k.concluida_em ?? ""}:${k.suite}`)));
  return hash([t.id, t.status, t.ultima_atividade ?? "", t.eventos_total, t.veredito_qa ?? "", t.veredito_auditoria ?? "", t.entrega?.commits ?? 0, t.entrega?.estado ?? "", t.bloqueios.length, ...tasks].join("|"));
}

async function emLotes<T, R>(itens: readonly T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(itens.length);
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(n, itens.length) }, async () => {
    for (let k = i++; k < itens.length; k = i++) out[k] = await fn(itens[k] as T);
  });
  await Promise.all(trabalhadores);
  return out;
}

export interface PortaMetodoMain extends PortaMetodo {
  /** descarta o cache (sincronização forçada). */
  esquecer(workspaceId?: string): void;
  /** bloqueios abertos por workspace, vistos na última leitura (alimenta o painel; `null` = nunca lido). */
  bloqueiosAbertos(workspaceId: string): number | null;
}

export function criarPortaMetodoMain(d: DepsPortaMetodoAgil): PortaMetodoMain {
  const ler = d.lerArtefato ?? lerArtefato;
  const cache = new Map<string, EntradaCache>();
  const cacheOc = new Map<string, { assinatura: string; oc: OcorrenciaRunx }>();
  const bloqueios = new Map<string, number>();

  async function lerRastro(ws: string, tid: string): Promise<EventoRastro[]> {
    const todos: EventoRastro[] = [];
    let depois = 0;
    for (let guarda = 0; guarda < 200 && todos.length < TETO_EVENTOS; guarda++) {
      const r = await d.rastro(ws, tid, depois);
      todos.push(...r.eventos);
      if (r.eventos.length < PAGINA || r.proximo <= depois) break;
      depois = r.proximo;
    }
    return todos;
  }

  async function montar(ws: string, t: Trabalho, indices: IndicesPorRaiz, raizWs: string): Promise<FonteTrabalho> {
    const raiz = acharTrabalho(indices, raizWs, t.id)?.raiz ?? raizWs;
    const rastro = SEGURO.test(t.id) ? await lerRastro(ws, t.id) : [];
    const qa = t.veredito_qa !== null ? await ler(raiz, `${t.pasta}/QA.md`).catch(() => null) : null;
    const entrega = t.entrega?.arquivo ? await ler(raiz, t.entrega.arquivo).catch(() => null) : null;
    return montarFonte(ws, t, rastro, { qa: qa && qa.rejeicao === null ? qa : null, entrega: entrega && entrega.rejeicao === null ? entrega : null });
  }

  return {
    async fontes(ws) {
      const base = await d.garantir(ws);
      if (base === null) return [];
      const indices = await d.indices(ws);
      const trabalhos = d.trabalhos(ws).filter(temTasks);
      bloqueios.set(ws, d.trabalhos(ws).reduce((n, t) => n + t.bloqueios.filter((b) => b.aberto).length, 0));
      const vivos = new Set(trabalhos.map((t) => `${ws}|${t.id}`));
      for (const k of [...cache.keys()]) if (k.startsWith(`${ws}|`) && !vivos.has(k)) cache.delete(k);
      return emLotes(trabalhos, CONCORRENCIA, async (t) => {
        const k = `${ws}|${t.id}`;
        const assinatura = assinaturaBarata(t);
        const c = cache.get(k);
        if (c && c.assinatura === assinatura) return c.fonte;
        const fonte = await montar(ws, t, indices, base.raiz);
        cache.set(k, { assinatura, fonte });
        return fonte;
      });
    },

    async ocorrencias(ws) {
      const base = await d.garantir(ws);
      if (base === null) return [];
      const indices = await d.indices(ws);
      const lista = d.trabalhos(ws).filter((t) => t.tipo === "ocorrencia");
      const out = await emLotes(lista, CONCORRENCIA, async (t): Promise<OcorrenciaRunx> => {
        const k = `${ws}|${t.id}`;
        const assinatura = assinaturaBarata(t);
        const c = cacheOc.get(k);
        if (c && c.assinatura === assinatura) return c.oc;
        const raiz = acharTrabalho(indices, base.raiz, t.id)?.raiz ?? base.raiz;
        const a = await ler(raiz, `${t.pasta}/00-OCORRENCIA.md`).catch(() => null);
        const dados = a?.dados ?? {};
        const txt = (x: unknown, max = 120): string | null => (typeof x === "string" && x.trim() !== "" ? x.trim().slice(0, max) : null);
        const arquivos = Array.isArray(dados["arquivos"]) ? (dados["arquivos"] as unknown[]).filter((f): f is string => typeof f === "string" && !f.startsWith("/") && !/^[A-Za-z]:/.test(f)).slice(0, 50) : [];
        const oc: OcorrenciaRunx = {
          id: t.id,
          tipo: t.tipo_ocorrencia ?? txt(dados["tipo"], 40) ?? "bug",
          aberta_em: txt(dados["aberta_em"], 40) ?? txt(dados["criado_em"], 40) ?? txt(dados["data"], 40),
          regressao_de: txt(dados["regressao_de"]),
          categoria: txt(dados["categoria"], 40),
          task_ref: txt(dados["task"], 40),
          arquivos,
        };
        cacheOc.set(k, { assinatura, oc });
        return oc;
      });
      return out;
    },

    async historicoSprintx(ws) {
      const base = await d.garantir(ws);
      if (base === null) return null;
      const a = await ler(base.raiz, "docs/sprintx/estimativas/HISTORICO.md").catch(() => null);
      return a && a.rejeicao === null && a.dados ? a.dados : null;
    },

    esquecer(ws) {
      if (ws === undefined) { cache.clear(); cacheOc.clear(); return; }
      for (const m of [cache, cacheOc]) for (const k of [...m.keys()]) if (k.startsWith(`${ws}|`)) m.delete(k);
    },
    bloqueiosAbertos: (ws) => bloqueios.get(ws) ?? null,
  };
}
