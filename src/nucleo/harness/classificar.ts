// Classificador de task_type (Fase 9, T-09.10): heurística PURA por palavras-chave PT/EN com peso (DADO editável abaixo).
// Sem I/O, sem relógio, sem rede, sem lançar. Entrada limitada a 2 000 caracteres (o resto é ignorado). ≤ 0,1 ms por chamada.
// Sem nenhum acerto: `{ task_type: "geral", confianca: 0.2 }`. Nenhum nome de modelo aqui: só tipos de tarefa.
export interface ClassificacaoTaskType {
  task_type: string;
  /** 0..1 */
  confianca: number;
}

export const LIMITE_ENTRADA_CLASSIFICADOR = 2000;
export const CONFIANCA_SEM_ACERTO = 0.2;

/**
 * Termos por task_type. Termo terminado em `*` casa por prefixo de palavra; termo com espaço casa a sequência de palavras.
 * Tudo em minúsculas e SEM acento (o texto é normalizado do mesmo jeito).
 */
export const PALAVRAS_CHAVE: Readonly<Record<string, ReadonlyArray<readonly [string, number]>>> = {
  implementar: [["implement*", 3], ["construir", 2], ["desenvolv*", 2], ["nova funcionalidade", 3], ["nova feature", 3], ["adicionar", 1.5], ["adicione", 1.5], ["criar endpoint", 3], ["build", 1.5], ["add feature", 3], ["executar task", 3], ["task do plano", 3], ["integrar", 1.5], ["integracao", 1.5]],
  "bug-fix": [["bug", 2], ["corrig*", 2.5], ["conserta*", 2.5], ["fix", 2.5], ["erro", 1.5], ["quebrou", 2.5], ["nao funciona", 2.5], ["crash*", 2], ["defeito", 2], ["regressao", 2], ["falha", 1.5], ["broken", 2], ["typo", 2]],
  "bug-profundo": [["causa raiz", 4], ["root cause", 4], ["intermitente", 3.5], ["race condition", 4], ["condicao de corrida", 4], ["vazamento de memoria", 4], ["memory leak", 4], ["deadlock", 4], ["investigar", 2.5], ["so acontece", 2.5], ["as vezes", 1.5], ["flaky", 3], ["heisenbug", 4], ["sem causa", 2.5]],
  refatorar: [["refator*", 4], ["refactor*", 4], ["limpar codigo", 3], ["reorganizar", 2.5], ["renomear", 2.5], ["extrair", 1.5], ["simplificar", 2], ["divida tecnica", 3], ["tech debt", 3], ["clean up", 2], ["duplicacao", 2]],
  front: [["tela", 2.5], ["interface", 2.5], ["botao", 3], ["css", 3.5], ["layout", 3], ["componente", 2], ["ui", 2], ["frontend", 3.5], ["front end", 3.5], ["modal", 3], ["responsiv*", 3], ["estilo", 2], ["tema escuro", 3], ["animacao", 2.5], ["pixel", 2]],
  auditar: [["audit*", 6], ["conformidade", 2.5], ["revisar o plano", 4], ["independente", 1], ["compliance", 2.5], ["veredito", 2]],
  qa: [["qa", 4], ["teste manual", 4], ["homolog*", 4], ["roteiro de teste", 4], ["casos de teste", 3.5], ["validar a entrega", 4], ["validar", 2], ["aceite", 2], ["quality assurance", 4]],
  "revisar-pr": [["pull request", 4], ["pr", 2.5], ["code review", 4], ["revisar pr", 4], ["revisao de codigo", 4], ["diff", 2.5], ["revisar o codigo", 3.5], ["review", 1.5]],
  triar: [["triar", 4], ["triagem", 4], ["pedido cru", 4], ["chamado", 2.5], ["vale a pena", 3], ["ja existe", 3], ["priorizar", 2.5], ["triage", 4]],
  planejar: [["planej*", 4], ["plano", 2.5], ["roadmap", 3.5], ["sprint*", 3], ["arquitetura", 3], ["projetar", 2.5], ["design doc", 3.5], ["estimar", 2.5], ["estimativa", 2.5], ["fases", 2], ["plan", 2.5], ["decompor", 2.5]],
  descobrir: [["descobr*", 4.5], ["levantar requisitos", 4], ["requisitos", 3], ["entrevista", 3], ["discovery", 4], ["entender o problema", 3.5], ["pesquisa de usuario", 3]],
  docs: [["document*", 4], ["readme", 4], ["changelog", 4], ["tutorial", 3], ["comentarios", 1.5], ["docs", 3.5], ["escrever texto", 2.5], ["guia de uso", 3.5], ["manual", 2]],
  pentest: [["pentest", 5], ["seguranca", 3], ["vulnerabilidade*", 4], ["owasp", 4.5], ["injection", 3.5], ["xss", 4], ["cve", 4], ["penetration", 4.5], ["exploit", 3.5], ["csrf", 4]],
};

const SEM_MARCAS = /[\u0300-\u036f]/g;
const NAO_ALFANUM = /[^a-z0-9]+/g;

/** minúsculas, sem acento, só [a-z0-9] separados por 1 espaço, com espaço nas pontas. */
export function normalizarTexto(t: string): string {
  const s = t.length > LIMITE_ENTRADA_CLASSIFICADOR ? t.slice(0, LIMITE_ENTRADA_CLASSIFICADOR) : t;
  const n = s.toLowerCase().normalize("NFD").replace(SEM_MARCAS, "").replace(NAO_ALFANUM, " ").trim();
  return n === "" ? " " : ` ${n} `;
}

// ---- índice (montado uma vez): trie de caracteres sobre o texto normalizado; sem alocação por palavra ----
// Termo exato ou sequência de palavras termina com um espaço (fim de palavra); termo com `*` termina onde está (prefixo).
interface NoTrie {
  filhos: Map<number, NoTrie>;
  termos: number[];
}
const TIPOS_DO_TERMO: string[] = [];
const PESOS_DO_TERMO: number[] = [];
const RAIZ: NoTrie = { filhos: new Map(), termos: [] };
for (const [tipo, lista] of Object.entries(PALAVRAS_CHAVE)) {
  for (const [termo, peso] of lista) {
    const id = TIPOS_DO_TERMO.length;
    TIPOS_DO_TERMO.push(tipo);
    PESOS_DO_TERMO.push(peso);
    const chaves = termo.endsWith("*") ? termo.slice(0, -1) : `${termo} `;
    let no = RAIZ;
    for (let c = 0; c < chaves.length; c++) {
      const k = chaves.charCodeAt(c);
      let f = no.filhos.get(k);
      if (!f) no.filhos.set(k, (f = { filhos: new Map(), termos: [] }));
      no = f;
    }
    no.termos.push(id);
  }
}
const ORDEM_TIPOS: readonly string[] = Object.keys(PALAVRAS_CHAVE);
const ESPACO = 32;

/** Classifica. Nunca lança; entrada inválida ou sem acerto vira `geral` (0,2). Determinística (empate pela ordem de `PALAVRAS_CHAVE`). */
export function classificar(texto: string): ClassificacaoTaskType {
  try {
    if (typeof texto !== "string" || texto.length === 0) return { task_type: "geral", confianca: CONFIANCA_SEM_ACERTO };
    const n = normalizarTexto(texto);
    const achados: number[] = [];
    for (let i = 1; i < n.length; i++) {
      if (n.charCodeAt(i - 1) !== ESPACO) continue;
      let no: NoTrie | undefined = RAIZ;
      for (let c = i; c < n.length; c++) {
        no = no.filhos.get(n.charCodeAt(c));
        if (!no) break;
        if (no.termos.length > 0) for (const id of no.termos) if (!achados.includes(id)) achados.push(id);
      }
    }
    if (achados.length === 0) return { task_type: "geral", confianca: CONFIANCA_SEM_ACERTO };
    const placar: Record<string, number> = {};
    for (const id of achados) placar[TIPOS_DO_TERMO[id] as string] = (placar[TIPOS_DO_TERMO[id] as string] ?? 0) + (PESOS_DO_TERMO[id] as number);
    let melhor: string | null = null;
    let s1 = 0;
    let s2 = 0;
    for (const tipo of ORDEM_TIPOS) {
      const v = placar[tipo] ?? 0;
      if (v > s1) {
        s2 = s1;
        s1 = v;
        melhor = tipo;
      } else if (v > s2) s2 = v;
    }
    if (melhor === null) return { task_type: "geral", confianca: CONFIANCA_SEM_ACERTO };
    const base = 1 - Math.exp(-s1 / 3);
    const folga = 0.5 + (0.5 * (s1 - s2)) / s1;
    const confianca = Math.round(Math.min(0.95, Math.max(0.3, base * folga)) * 100) / 100;
    return { task_type: melhor, confianca };
  } catch {
    return { task_type: "geral", confianca: CONFIANCA_SEM_ACERTO };
  }
}

/** Forma que o roteador espera em `deps.classificar` (`null` = sem acerto, o roteador cai em `geral`). */
export function classificarParaRoteador(descricao: string): { task_type: string; confianca: number } | null {
  const r = classificar(descricao);
  return r.task_type === "geral" ? null : r;
}
