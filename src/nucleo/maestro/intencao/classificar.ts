// T-16.06 · `classificarIntencao` por regras (puro; sem rede, sem modelo, sem Electron). Léxico com pesos + regras B1..B10.
// confianca = forca × (0,5 + 0,5 × margem); faixa: alta ≥ 0,70 · média 0,45–0,69 · baixa < 0,45 (baixa ⇒ `desconhecida`).
// O classificador só devolve RÓTULOS: texto do usuário (inclusive injeção) nunca vira ação. Nunca lança.
import { INTENCOES_PONTUAVEIS, type FaixaConfianca, type Intencao, type NivelRigidez, type ResultadoClassificacao, type TipoReferencia } from "../../../compartilhado/maestro";
import { LEXICO, type EntradaLexico } from "./lexico";
import { negadoEm, normalizar } from "./normalizar";

export const LIMITE_ALTA = 0.7;
export const LIMITE_MEDIA = 0.45;
const CAP_POR_INTENCAO = 12;

export interface ContextoClassificacao {
  /** slugs de trabalhos abertos no índice (B4: retomada por slug). */
  slugs_abertos?: readonly string[];
}

// ---- léxico compilado (uma vez) ----
interface Compilada {
  e: EntradaLexico;
  agulha: string | null;
  re: RegExp | null;
}
const COMPILADO: readonly Compilada[] = LEXICO.map((e) => ({
  e,
  agulha: e.tipo === "prefixo" ? ` ${e.termo}` : e.tipo === "palavra" ? ` ${e.termo} ` : null,
  re: e.tipo === "regex" ? new RegExp(` ${e.termo}(?= )`) : null,
}));

const SKILL_PARA_INTENCAO: Readonly<Record<string, Intencao>> = {
  runx: "bug", sprintx: "feature", prodx: "pedido", buildx: "projeto", mergex: "entrega", legadox: "refatoracao", stackx: "convencoes", designx: "design", memox: "historico", onboarding: "onboarding",
};
const RE_COMANDO = /^\s*\/(?:expx:)?(runx|sprintx|prodx|buildx|mergex|legadox|stackx|designx|memox|onboarding)[a-z0-9-]*(?=\s|$)/i;
const ROTULOS: Readonly<Record<string, Intencao>> = {
  bug: "bug", feature: "feature", refatoracao: "refatoracao", refactor: "refatoracao", refator: "refatoracao", pedido: "pedido", projeto: "projeto", entrega: "entrega", duvida: "duvida", historico: "historico", convencoes: "convencoes", design: "design", onboarding: "onboarding",
};
const ROTULO = "(bug|feature|refatoracao|refactor|refator|pedido|projeto|entrega|duvida|historico|convencoes|design|onboarding)";
const RE_ROTULO_COLCHETE = new RegExp(`(?:^|[\\s(])(?:\\[|#)${ROTULO}\\]?(?=$|[\\s:,.)\\]])`, "i");
const RE_ROTULO_DOIS_PONTOS = new RegExp(`^\\s*${ROTULO}\\s*:`, "i");
const RE_STACK = /Traceback \(most recent|^\s*at\s+\S+\s+\(.+:\d+:\d+\)|\b(?:TypeError|ReferenceError|NullPointerException|SyntaxError|Uncaught\s+\w+|Exception in thread)\b|\bHTTP\s*5\d\d\b/m;
const RE_OC = /\bOC-\d{4}-\d{3,5}\b/i;
const RE_PD = /\bPD-\d{4}-\d{3,5}\b/i;
const RE_FT = /\bFT-\d{1,3}\b/i;
const RE_IMPERATIVO = / (?:corrig|consert|arrum|implement|adicion|acrescent|cria |criar|refator|abre |abra |sobe |suba |monta |monte |faz |faca |fix |add |build |create |make |resolv|remov|apag|delet|atualiz|migr|integr)/;
const RE_INTERROGATIVA_INICIO = /^(?:como|onde|por que|qual|quais|quando|o que|quem|how|where|why|what|when|who|can you|pode me)\b/;
const RE_B10_HUMANO = /(?:revis\w* o pr|revisar pr|mergea|merge the pr|merg\w* o pr|fazer o merge|faz o merge|fazer merge|aprov\w* o pr|review the pr|review and merge)/;
const RE_B10_ACAO = /(?:abre |abrir|abra |sobe |subir|suba |prepara|preparar|commit|push|open |create |cria )/;
const RE_NIVEL_1 = /\b(?:pontual|so um ajuste|so uma linha|so uma cor|tiny|trivial)\b/;
const RE_NIVEL_2 = /\b(?:rapido|rapidinho|urgente|hotfix|quick|quickly)\b/;
const RE_NIVEL_4 = /(?:com cuidado|critico|producao|pagamento|migracao de dados|seguranca|dado pessoal|lgpd|carefully|production|payment|security)/;

const r2 = (n: number): number => Math.round(n * 100) / 100;
const faixaDe = (c: number): FaixaConfianca => (c >= LIMITE_ALTA ? "alta" : c >= LIMITE_MEDIA ? "media" : "baixa");

function acharReferencia(raw: string, slugs: readonly string[] | undefined, normalizado: string): { tipo: TipoReferencia; id: string } | null {
  const oc = RE_OC.exec(raw);
  if (oc !== null) return { tipo: "OC", id: oc[0].toUpperCase() };
  const pd = RE_PD.exec(raw);
  if (pd !== null) return { tipo: "PD", id: pd[0].toUpperCase() };
  const ft = RE_FT.exec(raw);
  if (ft !== null) return { tipo: "FT", id: ft[0].toUpperCase() };
  if (slugs !== undefined) {
    const padded = ` ${normalizado} `;
    for (const s of slugs) {
      const n = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (n.length >= 4 && padded.includes(` ${n} `)) return { tipo: "slug", id: s };
    }
  }
  return null;
}

function sugestaoDeNivel(n: string): NivelRigidez | null {
  if (RE_NIVEL_4.test(n)) return 4;
  if (RE_NIVEL_1.test(n)) return 1;
  if (RE_NIVEL_2.test(n)) return 2;
  return null;
}

const relogio = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

function vazio(inicio: number): ResultadoClassificacao {
  return { intencao: "desconhecida", confianca: 0, faixa: "baixa", pontos: {}, candidatas: [], sinais: [], retomar: null, sugestao_nivel: null, fonte: "regra", tempo_ms: r2(relogio() - inicio) };
}

/** Texto livre → intenção. Puro e síncrono (≤ 5 ms p95). Nunca lança. */
export function classificarIntencao(texto: string, ctx: ContextoClassificacao = {}): ResultadoClassificacao {
  const inicio = relogio();
  try {
    if (typeof texto !== "string" || texto.trim() === "") return vazio(inicio);
    const raw = texto.length > 8000 ? texto.slice(0, 8000) : texto;

    // B1: comando explícito do método ⇒ vai direto (o Maestro não reencaminha).
    const cmd = RE_COMANDO.exec(raw);
    if (cmd !== null) {
      const intencao = SKILL_PARA_INTENCAO[(cmd[1] as string).toLowerCase()] as Intencao;
      return { intencao, confianca: 1, faixa: "alta", pontos: { [intencao]: 100 }, candidatas: [{ intencao, confianca: 1 }], sinais: ["B1"], retomar: null, sugestao_nivel: null, fonte: "comando", tempo_ms: r2(relogio() - inicio) };
    }

    const n = normalizar(raw);
    const padded = ` ${n} `;
    const pontos: Partial<Record<Intencao, number>> = {};
    const sinais: string[] = [];
    let defeitos = 0;
    const soma = (i: Intencao, p: number): void => {
      pontos[i] = Math.min(CAP_POR_INTENCAO + 12, (pontos[i] ?? 0) + p);
    };
    const doLexico: Partial<Record<Intencao, number>> = {};

    for (const c of COMPILADO) {
      let acertou = false;
      if (c.re !== null) {
        acertou = c.re.test(padded);
      } else {
        const ag = c.agulha as string;
        let i = padded.indexOf(ag);
        for (let k = 0; i >= 0 && k < 4; k++) {
          if (!negadoEm(padded, i)) {
            acertou = true;
            break;
          }
          i = padded.indexOf(ag, i + 1);
        }
      }
      if (!acertou) continue;
      sinais.push(c.e.id);
      doLexico[c.e.intencao] = (doLexico[c.e.intencao] ?? 0) + c.e.peso;
      if (c.e.defeito) defeitos++;
    }
    for (const i of INTENCOES_PONTUAVEIS) {
      const v = doLexico[i];
      if (v !== undefined) soma(i, Math.min(v, CAP_POR_INTENCAO));
    }

    let fonte: "regra" | "explicito" = "regra";
    // B2: rótulo explícito.
    const rot = RE_ROTULO_COLCHETE.exec(raw) ?? RE_ROTULO_DOIS_PONTOS.exec(raw);
    if (rot !== null) {
      const alvo = ROTULOS[(rot[1] as string).toLowerCase()];
      if (alvo !== undefined) {
        soma(alvo, 10);
        sinais.push("B2");
        fonte = "explicito";
      }
    }
    // B7: stack trace / erro colado (olha o texto BRUTO: o log costuma vir em bloco de código).
    if (RE_STACK.test(raw)) {
      soma("bug", 3);
      sinais.push("B7");
      defeitos++;
    }
    // B8: refator + legado/sem testes.
    if (sinais.some((s) => s.startsWith("refatoracao.p.refator") || s.startsWith("refatoracao.p.refactor")) && sinais.some((s) => s.includes("legado") || s.includes("legacy") || s.includes("sem-testes"))) {
      soma("refatoracao", 3);
      sinais.push("B8");
    }
    // B9: "vale a pena" / "já existe".
    if (sinais.includes("pedido.w.vale-a-pena") || sinais.includes("pedido.w.ja-existe")) {
      soma("pedido", 4);
      soma("historico", 2);
      sinais.push("B9");
    }
    // B3: interrogativa sem verbo imperativo e sem sinal de defeito ⇒ dúvida.
    const interrogativa = n.endsWith("?") || n.includes(" ? ") || RE_INTERROGATIVA_INICIO.test(n);
    const maiorOutra = Math.max(0, ...(Object.entries(pontos) as Array<[Intencao, number]>).filter(([i]) => i !== "duvida").map(([, v]) => v));
    const palavrasUteis = n.replace(/\?/g, " ").trim().split(/\s+/).filter((w) => w !== "").length;
    if (interrogativa && palavrasUteis >= 2 && maiorOutra < 4 && !RE_IMPERATIVO.test(padded) && defeitos === 0) {
      soma("duvida", 3);
      sinais.push("B3");
    }
    // B5: bug × feature próximos ⇒ bug só com sinal de defeito, senão feature.
    const pb = pontos.bug ?? 0;
    const pf = pontos.feature ?? 0;
    if (pb >= 3 && pf >= 3 && Math.abs(pb - pf) < 1.5) {
      if (defeitos > 0) soma("bug", 2);
      else soma("feature", 2);
      sinais.push("B5");
    }
    // B10: entrega só de revisão/merge ⇒ o plano traz apenas a etapa humana.
    const soHumano = (pontos.entrega ?? 0) > 0 && RE_B10_HUMANO.test(n) && !RE_B10_ACAO.test(padded);
    if (soHumano) {
      soma("entrega", 4);
      sinais.push("B10");
    }

    const ordenadas = (Object.entries(pontos) as Array<[Intencao, number]>).filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1]);
    const retomar = acharReferencia(raw, ctx.slugs_abertos, n);
    const sugestao = sugestaoDeNivel(n);
    if (ordenadas.length === 0) return { ...vazio(inicio), retomar, sugestao_nivel: sugestao, sinais };

    const [melhor, topo] = ordenadas[0] as [Intencao, number];
    const segundo = ordenadas[1]?.[1] ?? 0;
    const forca = Math.min(1, topo / 6);
    const margem = (topo - segundo) / Math.max(topo, 1);
    const confianca = r2(forca * (0.5 + 0.5 * margem));
    const faixa = faixaDe(confianca);
    const candidatas = ordenadas.slice(0, 3).map(([intencao, p]) => ({ intencao, confianca: r2(Math.min(1, p / 6) * (p / topo)) }));
    const saida: ResultadoClassificacao = {
      intencao: faixa === "baixa" ? "desconhecida" : melhor,
      confianca,
      faixa,
      pontos: Object.fromEntries(ordenadas.map(([i, p]) => [i, r2(p)])) as Partial<Record<Intencao, number>>,
      candidatas,
      sinais,
      retomar,
      sugestao_nivel: sugestao,
      fonte,
      tempo_ms: r2(relogio() - inicio),
    };
    if (soHumano && saida.intencao === "entrega") saida.so_humano = true;
    return saida;
  } catch {
    return vazio(inicio);
  }
}
