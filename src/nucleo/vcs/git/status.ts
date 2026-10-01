import type { CodigoConflito, LetraMudanca, Mudanca, OpcoesStatus, StatusRepo } from "../vcs";
import { executorPadrao, type ExecutorVcs } from "../executor";
import { GitCanceladoErro, NaoEhRepoErro } from "../../git/erros";
import { caminhoRelativoSeguro } from "./diff";

// T-06.05 · Status: `git status --porcelain=v2 --branch -z`. Parser puro (`parseStatusV2`) + orquestração
// com degradação para `-uno` quando o cálculo passa de `limiteDegradarMs` (padrão 2 s).

export const LIMITE_DEGRADAR_MS = 2000;
const SAIDA_STATUS_MAX = 128 * 1024 * 1024;

export const CONFLITOS_XY: Readonly<Record<string, CodigoConflito>> = Object.freeze({
  UU: "ambos-modificaram",
  AA: "ambos-adicionaram",
  DD: "ambos-apagaram",
  AU: "adicionado-por-nos",
  UA: "adicionado-por-eles",
  DU: "apagado-por-nos",
  UD: "apagado-por-eles",
});

const LETRAS = new Set(["M", "T", "A", "D", "R", "C", "U"]);
const letra = (c: string | undefined): LetraMudanca => (c !== undefined && LETRAS.has(c) ? (c as LetraMudanca) : " ");

export function statusVazio(estado: StatusRepo["estado"] = "pronto"): StatusRepo {
  return {
    estado, branch: null, oid: null, upstream: null, ahead: 0, behind: 0, semCommits: false, arquivos: [],
    contagens: { staged: 0, naoStaged: 0, naoRastreados: 0, conflitos: 0, ignorados: 0 }, degradado: false, duracaoMs: 0,
  };
}

/** `S...` do porcelain v2: submódulo? `S<c><m><u>` -> flags dos três. */
function flagsSubmodulo(sub: string): string | undefined {
  if (sub[0] !== "S") return undefined;
  const f = (sub[1] === "C" ? "C" : "") + (sub[2] === "M" ? "M" : "") + (sub[3] === "U" ? "U" : "");
  return f === "" ? "" : f;
}

/** Pula `n` campos separados por espaço; devolve o resto (o caminho, que pode ter espaços). */
function resto(linha: string, n: number): string {
  let pos = 0;
  for (let i = 0; i < n; i++) {
    pos = linha.indexOf(" ", pos) + 1;
    if (pos === 0) return "";
  }
  return linha.slice(pos);
}

/** Interpreta a saída `-z` do porcelain v2. Tolerante: linha desconhecida ou truncada é ignorada. */
export function parseStatusV2(saida: string): StatusRepo {
  const r = statusVazio();
  const c = r.contagens;
  const toks = saida.split("\0");
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i] as string;
    if (t.length < 2) continue;
    const k = t.charCodeAt(0);
    if (k === 35 /* # */) {
      if (t.startsWith("# branch.oid ")) {
        const oid = t.slice(13);
        if (oid === "(initial)") r.semCommits = true;
        else r.oid = oid;
      } else if (t.startsWith("# branch.head ")) {
        const h = t.slice(14);
        r.branch = h === "(detached)" ? null : h;
      } else if (t.startsWith("# branch.upstream ")) r.upstream = t.slice(18);
      else if (t.startsWith("# branch.ab ")) {
        const m = /\+(\d+) -(\d+)/.exec(t);
        if (m) {
          r.ahead = Number(m[1]);
          r.behind = Number(m[2]);
        }
      }
    } else if (k === 49 /* 1 */) {
      // 1 XY sub mH mI mW hH hI path
      const x = t[2];
      const y = t[3];
      const sub = flagsSubmodulo(t.slice(5, 9));
      const m: Mudanca = { caminho: resto(t, 8), tipo: "ordinario", indice: letra(x), arvore: letra(y) };
      if (sub !== undefined) m.submodulo = sub;
      if (m.caminho === "") continue;
      if (m.indice !== " ") c.staged++;
      if (m.arvore !== " ") c.naoStaged++;
      r.arquivos.push(m);
    } else if (k === 50 /* 2 */) {
      // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
      const x = t[2];
      const y = t[3];
      const origem = toks[++i] as string | undefined;
      const sub = flagsSubmodulo(t.slice(5, 9));
      const m: Mudanca = { caminho: resto(t, 9), tipo: x === "C" || y === "C" ? "copiado" : "renomeado", indice: letra(x), arvore: letra(y) };
      if (origem) m.origem = origem;
      if (sub !== undefined) m.submodulo = sub;
      if (m.caminho === "") continue;
      if (m.indice !== " ") c.staged++;
      if (m.arvore !== " ") c.naoStaged++;
      r.arquivos.push(m);
    } else if (k === 117 /* u */) {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const xy = t.slice(2, 4);
      const m: Mudanca = { caminho: resto(t, 10), tipo: "conflito", indice: "U", arvore: "U" };
      const cod = CONFLITOS_XY[xy];
      if (cod) m.conflito = cod;
      if (m.caminho === "") continue;
      c.conflitos++;
      r.arquivos.push(m);
    } else if (k === 63 /* ? */) {
      r.arquivos.push({ caminho: t.slice(2), tipo: "naorastreado", indice: " ", arvore: " " });
      c.naoRastreados++;
    } else if (k === 33 /* ! */) {
      r.arquivos.push({ caminho: t.slice(2), tipo: "ignorado", indice: " ", arvore: " " });
      c.ignorados++;
    }
  }
  return r;
}

export interface OpcoesStatusGit extends OpcoesStatus {
  executor?: ExecutorVcs;
  /** Passou disto: aborta e refaz com `-uno`. Padrão 2000; 0 desliga a degradação. */
  limiteDegradarMs?: number;
  /** Força `-uno` (não rastreados omitidos) de saída. */
  semNaoRastreados?: boolean;
  executavel?: string;
}

/**
 * Calcula o `StatusRepo` de `raiz`. Se o status com não rastreados passa de `limiteDegradarMs`, aborta
 * e responde com `-uno` (`degradado: true`). Cancelável por `signal`. Nunca segura lock (leitura).
 */
export async function statusGit(raiz: string, op: OpcoesStatusGit = {}): Promise<StatusRepo> {
  const ex = op.executor ?? executorPadrao;
  const limite = op.limiteDegradarMs ?? LIMITE_DEGRADAR_MS;
  const inicio = performance.now();
  const rodar = (uno: boolean, signal: AbortSignal | undefined, timeoutMs: number) =>
    ex.executar(
      ["status", "--porcelain=v2", "--branch", "-z", uno ? "--untracked-files=no" : "--untracked-files=normal", ...(op.ignorados === true ? ["--ignored=traditional"] : [])],
      { cwd: raiz, tipo: "leitura", maxBytes: SAIDA_STATUS_MAX, timeoutMs, tolerar: [128], ...(signal ? { signal } : {}), ...(op.executavel ? { executavel: op.executavel } : {}) },
    );
  const concluir = (stdout: string, codigo: number, degradado: boolean): StatusRepo => {
    if (codigo !== 0) throw new NaoEhRepoErro(raiz);
    const s = parseStatusV2(stdout);
    s.degradado = degradado;
    s.duracaoMs = performance.now() - inicio;
    return s;
  };

  if (op.semNaoRastreados === true) {
    const r = await rodar(true, op.signal, 60_000);
    return concluir(r.stdout, r.codigo, true);
  }
  if (limite <= 0) {
    const r = await rodar(false, op.signal, 60_000);
    return concluir(r.stdout, r.codigo, false);
  }
  // tentativa completa com prazo; estourou -> cancela e degrada
  const ac = new AbortController();
  const aoAbortarFora = (): void => ac.abort();
  op.signal?.addEventListener("abort", aoAbortarFora, { once: true });
  let estourou = false;
  const relogio = setTimeout(() => {
    estourou = true;
    ac.abort();
  }, limite);
  try {
    const r = await rodar(false, ac.signal, 60_000);
    return concluir(r.stdout, r.codigo, false);
  } catch (e) {
    if (!(estourou && e instanceof GitCanceladoErro) || op.signal?.aborted) throw e;
  } finally {
    clearTimeout(relogio);
    op.signal?.removeEventListener("abort", aoAbortarFora);
  }
  const r = await rodar(true, op.signal, 60_000);
  return concluir(r.stdout, r.codigo, true);
}

// ---- Incremental ------------------------------------------------------------------------------------

/** Acima disto o status parcial deixa de compensar: volta ao completo. */
export const MAX_CAMINHOS_PARCIAL = 50;

const ordem = (m: Mudanca): number => (m.tipo === "ignorado" ? 2 : m.tipo === "naorastreado" ? 1 : 0);
const antes = (a: Mudanca, b: Mudanca): boolean => {
  const ra = ordem(a);
  const rb = ordem(b);
  return ra !== rb ? ra < rb : a.caminho < b.caminho;
};

function inserir(lista: Mudanca[], m: Mudanca): void {
  let lo = 0;
  let hi = lista.length;
  while (lo < hi) {
    const meio = (lo + hi) >>> 1;
    if (antes(lista[meio] as Mudanca, m)) lo = meio + 1;
    else hi = meio;
  }
  lista.splice(lo, 0, m);
}

export function recontar(arquivos: readonly Mudanca[]): StatusRepo["contagens"] {
  const c = { staged: 0, naoStaged: 0, naoRastreados: 0, conflitos: 0, ignorados: 0 };
  for (const m of arquivos) {
    if (m.tipo === "naorastreado") c.naoRastreados++;
    else if (m.tipo === "ignorado") c.ignorados++;
    else if (m.tipo === "conflito") c.conflitos++;
    else {
      if (m.indice !== " ") c.staged++;
      if (m.arvore !== " ") c.naoStaged++;
    }
  }
  return c;
}

/**
 * Status INCREMENTAL: roda `git status` só nos `caminhos` que o observador reportou (pathspec literal; custo
 * ≈ iniciar o processo, não importa o tamanho do repositório) e mescla o resultado ao status anterior.
 * Devolve null quando o atalho não é seguro e o chamador deve fazer o status completo: base não pronta,
 * caminhos demais/inválidos, renomeação envolvida, pasta não rastreada colapsada, ou aparição de arquivo
 * não rastreado (o git agrupa pastas inteiras; só o status completo decide como mostrar).
 */
export async function statusGitParcial(raiz: string, base: StatusRepo, caminhos: readonly string[], op: OpcoesStatusGit = {}): Promise<StatusRepo | null> {
  if (base.estado !== "pronto" || caminhos.length === 0 || caminhos.length > MAX_CAMINHOS_PARCIAL) return null;
  let alvo: string[];
  try {
    alvo = [...new Set(caminhos.map(caminhoRelativoSeguro))];
  } catch {
    return null;
  }
  const conj = new Set(alvo);
  for (const m of base.arquivos) {
    if (m.tipo === "renomeado" || m.tipo === "copiado") {
      if (conj.has(m.caminho) || (m.origem !== undefined && conj.has(m.origem))) return null;
    } else if (m.caminho.endsWith("/")) {
      // pasta não rastreada colapsada: algum alvo dentro dela exige o completo
      if (alvo.some((c) => c.startsWith(m.caminho))) return null;
    }
  }
  const ex = op.executor ?? executorPadrao;
  const inicio = performance.now();
  const r = await ex.executar(
    ["--literal-pathspecs", "status", "--porcelain=v2", "--branch", "-z", `--untracked-files=${base.degradado ? "no" : "normal"}`, "--", ...alvo],
    { cwd: raiz, tipo: "leitura", maxBytes: SAIDA_STATUS_MAX, timeoutMs: 30_000, tolerar: [128], ...(op.signal ? { signal: op.signal } : {}), ...(op.executavel ? { executavel: op.executavel } : {}) },
  );
  if (r.codigo !== 0) return null;
  const novo = parseStatusV2(r.stdout);
  if (novo.arquivos.some((m) => m.tipo === "naorastreado" || m.tipo === "renomeado" || m.tipo === "copiado")) return null;
  const arquivos = base.arquivos.filter((m) => !conj.has(m.caminho));
  for (const m of novo.arquivos) inserir(arquivos, m);
  return { ...base, arquivos, contagens: recontar(arquivos), parcial: true, duracaoMs: performance.now() - inicio };
}
