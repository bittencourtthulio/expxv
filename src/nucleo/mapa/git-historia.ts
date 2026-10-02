import { StringDecoder } from "node:string_decoder";
import { GitCanceladoErro, GitErro, GitIndisponivelErro } from "../git/erros";
import { ExecutorVcs } from "../vcs/executor";

// História git para o mapa (T-17.22): churn, autores e acoplamento temporal a partir de UM `git log` em streaming,
// cancelável, somente leitura (`GIT_OPTIONAL_LOCKS=0` pelo executor). Nomes e e-mails de autor NÃO saem daqui:
// o resultado carrega só CONTAGENS de autores distintos (nomes ficam fora do mapa; D-163, LAC-17.10).

export const JANELA_DIAS_PADRAO = 730;
export const MAX_COMMITS_PADRAO = 20_000;
export const RECENTE_DIAS_PADRAO = 365;
/** Acoplamento: commits com 2..30 arquivos; pares com ≥ 5 co-alterações e grau ≥ 0,3; teto de 5 000 pares. */
export const ACOPLAMENTO = { minArquivos: 2, maxArquivos: 30, minCo: 5, minGrau: 0.3, maxPares: 5_000 } as const;
const MAX_BYTES_LOG = 512 * 1024 * 1024;
const CORRECAO = /\b(fix(es|ed)?|bug(s|fix)?|corrig\w*|corrige|hotfix)\b/i;

export interface OpcoesHistoria {
  /** Raiz do repositório (cwd do git). */
  raiz: string;
  executor?: ExecutorVcs;
  janelaDias?: number;
  maxCommits?: number;
  /** `churn_janela` conta só os últimos N dias (padrão 365); `churn_total` conta toda a janela coletada. */
  recenteDias?: number;
  signal?: AbortSignal;
  /** Relógio (testes). */
  agora?: Date;
}

export interface HistoriaArquivo {
  caminho: string;
  churn_total: number;
  churn_janela: number;
  autores_n: number;
  /** ISO do commit mais antigo que tocou o arquivo dentro da janela. */
  criado_git: string;
  ultima_alt: string;
  commits_correcao: number;
}

export interface ParAcoplado {
  a: string;
  b: string;
  co_alteracoes: number;
  grau: number;
}

export type EstadoHistoriaGit = "ok" | "parcial" | "indisponivel";

export interface ResultadoHistoria {
  estado: EstadoHistoriaGit;
  arquivos: Map<string, HistoriaArquivo>;
  acoplamento: ParAcoplado[];
  commits: number;
  /** Motivo quando `indisponivel`/`parcial`. */
  motivo: string | null;
}

interface EntradaCommit {
  autor: string;
  ts: number;
  correcao: boolean;
  arquivos: string[];
}

/** Acumulador do `git log` (puro; recebe pedaços de texto). Aplicável a qualquer fonte do mesmo formato. */
export class AcumuladorHistoria {
  private resto = "";
  private readonly alias = new Map<string, string>();
  private readonly por = new Map<string, { total: number; janela: number; autores: Set<string>; primeiro: number; ultimo: number; correcoes: number }>();
  private readonly elegiveis: string[][] = [];
  commits = 0;
  private readonly limiteRecente: number;

  constructor(limiteRecenteSegundos: number) {
    this.limiteRecente = limiteRecenteSegundos;
  }

  alimentar(texto: string): void {
    this.resto += texto;
    let i: number;
    // cada registro começa em \x1e; o último pode estar incompleto
    while ((i = this.resto.indexOf("\x1e", 1)) > 0) {
      this.registro(this.resto.slice(this.resto.startsWith("\x1e") ? 1 : 0, i));
      this.resto = this.resto.slice(i);
    }
  }

  finalizar(): void {
    if (this.resto.length > 0) this.registro(this.resto.startsWith("\x1e") ? this.resto.slice(1) : this.resto);
    this.resto = "";
  }

  private atual(c: string): string {
    return this.alias.get(c) ?? c;
  }

  private registro(chunk: string): void {
    const z = chunk.indexOf("\0");
    if (z < 0) return;
    const [, nome, email, ct, assunto] = ((): string[] => {
      const p = chunk.slice(0, z).split("\x1f");
      return [p[0] ?? "", p[1] ?? "", p[2] ?? "", p[3] ?? "", p.slice(4).join("\x1f")];
    })();
    const ts = Number(ct);
    const autor = (email as string).trim().toLowerCase() || (nome as string).trim().toLowerCase();
    const tokens = chunk.slice(z + 1).split("\0");
    const arquivos: string[] = [];
    for (let k = 0; k < tokens.length; k++) {
      const st = (tokens[k] as string).replace(/^\n+/, "");
      if (st === "") continue;
      const letra = st[0] as string;
      if (letra === "R" || letra === "C") {
        const antigo = tokens[++k];
        const novo = tokens[++k];
        if (antigo === undefined || novo === undefined) break;
        const destino = this.atual(novo);
        if (letra === "R") this.alias.set(antigo, destino); // o passado de `antigo` pertence ao nome atual
        arquivos.push(destino);
      } else {
        const caminho = tokens[++k];
        if (caminho === undefined) break;
        arquivos.push(this.atual(caminho));
      }
    }
    this.commits++;
    const correcao = CORRECAO.test(assunto as string);
    const unicos = [...new Set(arquivos)];
    const e: EntradaCommit = { autor, ts, correcao, arquivos: unicos };
    for (const f of e.arquivos) {
      let p = this.por.get(f);
      if (p === undefined) this.por.set(f, (p = { total: 0, janela: 0, autores: new Set(), primeiro: Infinity, ultimo: -Infinity, correcoes: 0 }));
      p.total++;
      if (e.ts >= this.limiteRecente) p.janela++;
      p.autores.add(e.autor);
      if (e.ts < p.primeiro) p.primeiro = e.ts;
      if (e.ts > p.ultimo) p.ultimo = e.ts;
      if (e.correcao) p.correcoes++;
    }
    if (e.arquivos.length >= ACOPLAMENTO.minArquivos && e.arquivos.length <= ACOPLAMENTO.maxArquivos) this.elegiveis.push(e.arquivos);
  }

  async resultado(): Promise<{ arquivos: Map<string, HistoriaArquivo>; acoplamento: ParAcoplado[] }> {
    const arquivos = new Map<string, HistoriaArquivo>();
    const iso = (s: number): string => new Date(s * 1000).toISOString();
    for (const [caminho, p] of this.por) {
      arquivos.set(caminho, { caminho, churn_total: p.total, churn_janela: p.janela, autores_n: p.autores.size, criado_git: iso(p.primeiro), ultima_alt: iso(p.ultimo), commits_correcao: p.correcoes });
    }
    // acoplamento: só arquivos com ≥ minCo alterações podem formar par elegível
    const pares = new Map<string, number>();
    let n = 0;
    for (const lista of this.elegiveis) {
      const f = lista.filter((x) => (this.por.get(x)?.total ?? 0) >= ACOPLAMENTO.minCo).sort();
      for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) {
        const k = `${f[i] as string}\0${f[j] as string}`;
        pares.set(k, (pares.get(k) ?? 0) + 1);
      }
      if (++n % 2000 === 0) await new Promise<void>((r) => setImmediate(r)); // não monopoliza o event loop
    }
    const acoplamento: ParAcoplado[] = [];
    for (const [k, co] of pares) {
      if (co < ACOPLAMENTO.minCo) continue;
      const [a, b] = k.split("\0") as [string, string];
      const media = ((this.por.get(a)?.total ?? 1) + (this.por.get(b)?.total ?? 1)) / 2;
      const grau = Math.round((co / media) * 1000) / 1000;
      if (grau >= ACOPLAMENTO.minGrau) acoplamento.push({ a, b, co_alteracoes: co, grau });
    }
    acoplamento.sort((x, y) => y.co_alteracoes - x.co_alteracoes || y.grau - x.grau || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
    return { arquivos, acoplamento: acoplamento.slice(0, ACOPLAMENTO.maxPares) };
  }
}

const vazio = (motivo: string): ResultadoHistoria => ({ estado: "indisponivel", arquivos: new Map(), acoplamento: [], commits: 0, motivo });

/** Coleta a história (git). Sem git ou sem repositório: `indisponivel` (o raio trata o churn como pior caso). */
export async function coletarHistoria(opcoes: OpcoesHistoria): Promise<ResultadoHistoria> {
  const executor = opcoes.executor ?? new ExecutorVcs();
  const agora = opcoes.agora ?? new Date();
  const janela = opcoes.janelaDias ?? JANELA_DIAS_PADRAO;
  const max = opcoes.maxCommits ?? MAX_COMMITS_PADRAO;
  const recente = opcoes.recenteDias ?? RECENTE_DIAS_PADRAO;
  const desde = new Date(agora.getTime() - janela * 86_400_000).toISOString();
  const acc = new AcumuladorHistoria(Math.floor(agora.getTime() / 1000) - recente * 86_400);
  const dec = new StringDecoder("utf8");
  let truncado = false;
  try {
    const r = await executor.executar(
      ["log", "--no-merges", `--since=${desde}`, "-n", String(max), "--format=%x1e%H%x1f%an%x1f%ae%x1f%ct%x1f%s", "--name-status", "-z", "-M"],
      {
        cwd: opcoes.raiz,
        confianca: "nao_confiavel",
        tipo: "leitura",
        timeoutMs: 120_000,
        maxBytes: MAX_BYTES_LOG,
        encerrarNoLimite: true,
        ...(opcoes.signal === undefined ? {} : { signal: opcoes.signal }),
        aoStdout: (b) => acc.alimentar(dec.write(b)),
        // sem repositório (128) não lança: tratamos como indisponível abaixo
        tolerar: [128],
      },
    );
    acc.alimentar(dec.end());
    acc.finalizar();
    if (r.codigo !== 0) return vazio("sem repositório git");
    truncado = r.truncado || r.encerradoPorLimite;
  } catch (e) {
    if (e instanceof GitCanceladoErro) throw e;
    if (e instanceof GitIndisponivelErro) return vazio("git indisponível");
    if (e instanceof GitErro) return vazio("git falhou");
    throw e;
  }
  const { arquivos, acoplamento } = await acc.resultado();
  const cortou = acc.commits >= max;
  return { estado: truncado || cortou ? "parcial" : "ok", arquivos, acoplamento, commits: acc.commits, motivo: truncado ? "saída do git passou do teto" : cortou ? "teto de commits atingido" : null };
}
