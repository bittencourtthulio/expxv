// Montagem PURA do contexto prévio: hits + sinais → envelope com orçamento de caracteres. Sem E/S.
import type { HitBusca } from "../busca/buscador";
import { CONTEXTO_CHARS_MAX, CONTEXTO_CHARS_MIN, CONTEXTO_CHARS_PADRAO } from "../constantes";
import { limparParaSaida } from "../seguranca";
import { SECOES, envelopeContexto, type Secao } from "./envelope";
import { classificar } from "./sinais";
import type { SinaisContexto } from "../../../compartilhado/conhecimento";

const ROTULO_TIPO: Record<string, string> = { doc: "doc", relatorio: "relatório", decisao: "decisão", causa_raiz: "causa raiz", qa: "qa", handoff: "handoff", task: "task", missao: "missão", commit: "commit", pr: "pr", codigo: "código", transcricao: "sessão", chat: "chat", aprendizado: "aprendizado", nota: "nota" };
const SECAO_DE = { ja_existe: "Já existe?", correcao: "Correções anteriores", decisao: "Decisões relacionadas", aprendizado: "Aprendizados", outros: "Outras referências" } as const;

export interface EntradaMontagem {
  hits: readonly HitBusca[];
  consulta: string;
  orcamentoChars?: number;
  geradoEm: string;
  memoxInstalado?: boolean;
}

export interface Montagem {
  markdown: string;
  sinais: SinaisContexto;
  /** hits efetivamente citados, na ordem [k1], [k2]… */
  citados: HitBusca[];
}

export function limitarOrcamento(n: number | undefined): number {
  return Math.min(CONTEXTO_CHARS_MAX, Math.max(CONTEXTO_CHARS_MIN, Math.floor(n ?? CONTEXTO_CHARS_PADRAO)));
}

export function montarContexto(e: EntradaMontagem): Montagem {
  const orcamento = limitarOrcamento(e.orcamentoChars);
  const { sinais, porHit } = classificar(e.hits, e.consulta);
  const secoes = new Map<Secao, string[]>(SECOES.map((s) => [s, []]));
  const citados: HitBusca[] = [];
  const base = envelopeContexto({ geradoEm: e.geradoEm, secoes: SECOES.map((titulo) => ({ titulo, linhas: [] })), memoxInstalado: e.memoxInstalado === true });
  let gasto = base.length;
  e.hits.forEach((h, i) => {
    const c = h.chunk;
    const quando = c.ocorrido_em.slice(0, 10);
    const ref = c.task_ref ? ` · ${limparParaSaida(c.task_ref, 20)}` : "";
    const k = citados.length + 1;
    const cab = `- [k${k} · ${ROTULO_TIPO[c.tipo] ?? c.tipo} · ${quando}${ref}] `;
    const folga = orcamento - gasto - cab.length - 1;
    if (folga < 40) return;
    const texto = limparParaSaida(`${c.titulo !== "" && !c.texto.startsWith(c.titulo) ? `${c.titulo}: ` : ""}${c.texto}`, Math.min(300, folga));
    const linha = `${cab}${texto}`;
    (secoes.get(SECAO_DE[porHit[i] as keyof typeof SECAO_DE]) as string[]).push(linha);
    citados.push(h);
    gasto += linha.length + 1;
  });
  const markdown = envelopeContexto({ geradoEm: e.geradoEm, secoes: SECOES.map((titulo) => ({ titulo, linhas: secoes.get(titulo) as string[] })), memoxInstalado: e.memoxInstalado === true });
  return { markdown, sinais, citados };
}
