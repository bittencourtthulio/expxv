// Importadores de cobertura (T-17.26), SOMENTE LEITURA e sem executar nada: o ADE não roda a suíte (D-162).
// Formatos: lcov, Cobertura XML, JaCoCo XML e `go cover` (`cover.out`). Entrada = texto já lido pelo chamador.

export type FormatoCobertura = "lcov" | "cobertura" | "jacoco" | "gocover";

export interface CoberturaArquivo {
  /** Caminho como veio do relatório (normalizado com `/`). */
  caminho: string;
  linhas_total: number;
  linhas_cobertas: number;
  pct: number;
  formato: FormatoCobertura;
}

/** Caminhos onde os relatórios costumam ficar (o chamador só LÊ o que existir). */
export const CAMINHOS_RELATORIO_CONHECIDOS: readonly string[] = [
  "coverage/lcov.info",
  "lcov.info",
  "coverage/cobertura-coverage.xml",
  "coverage/cobertura.xml",
  "coverage.xml",
  "cobertura.xml",
  "target/site/jacoco/jacoco.xml",
  "build/reports/jacoco/test/jacocoTestReport.xml",
  "cover.out",
  "coverage.out",
];

const norm = (c: string): string => c.replace(/\\/g, "/").replace(/^\.\//, "");
const pct = (cob: number, total: number): number => (total === 0 ? 0 : Math.round((cob / total) * 10_000) / 100);

export function detectarFormato(nome: string, texto: string): FormatoCobertura | null {
  const ini = texto.slice(0, 2000);
  if (/^mode:\s*(set|count|atomic)\b/m.test(ini)) return "gocover";
  if (/^(TN:|SF:)/m.test(ini)) return "lcov";
  if (/<report\b[^>]*>/.test(ini) || /jacoco/i.test(nome) || /<!DOCTYPE report/i.test(ini)) return "jacoco";
  if (/<coverage\b/.test(ini) || /cobertura/i.test(nome)) return "cobertura";
  return null;
}

export function lerLcov(texto: string): CoberturaArquivo[] {
  const saida: CoberturaArquivo[] = [];
  let atual: { caminho: string; da: Map<number, number>; lf: number | null; lh: number | null } | null = null;
  const fechar = (): void => {
    if (atual === null) return;
    const total = atual.lf ?? atual.da.size;
    const cob = Math.min(atual.lh ?? [...atual.da.values()].filter((h) => h > 0).length, total);
    saida.push({ caminho: atual.caminho, linhas_total: total, linhas_cobertas: cob, pct: pct(cob, total), formato: "lcov" });
    atual = null;
  };
  for (const bruta of texto.split(/\r?\n/)) {
    const l = bruta.trim();
    if (l.startsWith("SF:")) {
      fechar();
      atual = { caminho: norm(l.slice(3)), da: new Map(), lf: null, lh: null };
    } else if (atual !== null) {
      if (l.startsWith("DA:")) {
        const [n, h] = l.slice(3).split(",");
        atual.da.set(Number(n), Number(h));
      } else if (l.startsWith("LF:")) atual.lf = Number(l.slice(3));
      else if (l.startsWith("LH:")) atual.lh = Number(l.slice(3));
      else if (l === "end_of_record") fechar();
    }
  }
  fechar();
  return saida.filter((s) => s.caminho !== "");
}

const ATTR = (tag: string, nome: string): string | undefined => new RegExp(`\\b${nome}="([^"]*)"`).exec(tag)?.[1];

export function lerCobertura(texto: string): CoberturaArquivo[] {
  const fontes = [...texto.matchAll(/<source>([^<]*)<\/source>/g)].map((m) => norm((m[1] as string).trim()));
  const porArquivo = new Map<string, Map<number, number>>();
  for (const m of texto.matchAll(/<class\b([^>]*)>([\s\S]*?)<\/class>/g)) {
    const arq = ATTR(m[1] as string, "filename");
    if (arq === undefined) continue;
    let mapa = porArquivo.get(arq);
    if (mapa === undefined) porArquivo.set(arq, (mapa = new Map()));
    for (const l of (m[2] as string).matchAll(/<line\b([^>]*)\/?>/g)) {
      const n = Number(ATTR(l[1] as string, "number"));
      const h = Number(ATTR(l[1] as string, "hits") ?? 0);
      mapa.set(n, Math.max(mapa.get(n) ?? 0, h));
    }
  }
  const saida: CoberturaArquivo[] = [];
  for (const [arq, linhas] of porArquivo) {
    const total = linhas.size;
    const cob = [...linhas.values()].filter((h) => h > 0).length;
    let caminho = norm(arq);
    // `sources` relativo prefixa o nome; os absolutos são removidos no casamento (`casarCaminhos`)
    const rel = fontes.find((s) => s !== "" && !s.startsWith("/") && !/^[A-Za-z]:/.test(s) && s !== ".");
    if (rel !== undefined) caminho = `${rel.replace(/\/$/, "")}/${caminho}`;
    saida.push({ caminho, linhas_total: total, linhas_cobertas: cob, pct: pct(cob, total), formato: "cobertura" });
  }
  return saida;
}

export function lerJacoco(texto: string): CoberturaArquivo[] {
  const saida: CoberturaArquivo[] = [];
  for (const p of texto.matchAll(/<package\b([^>]*)>([\s\S]*?)<\/package>/g)) {
    const pacote = (ATTR(p[1] as string, "name") ?? "").replace(/\./g, "/");
    for (const s of (p[2] as string).matchAll(/<sourcefile\b([^>]*)>([\s\S]*?)<\/sourcefile>/g)) {
      const nome = ATTR(s[1] as string, "name");
      if (nome === undefined) continue;
      const c = [...(s[2] as string).matchAll(/<counter\b([^>]*)\/?>/g)].find((x) => ATTR(x[1] as string, "type") === "LINE");
      if (c === undefined) continue;
      const cob = Number(ATTR(c[1] as string, "covered") ?? 0);
      const perdidas = Number(ATTR(c[1] as string, "missed") ?? 0);
      saida.push({ caminho: pacote === "" ? nome : `${pacote}/${nome}`, linhas_total: cob + perdidas, linhas_cobertas: cob, pct: pct(cob, cob + perdidas), formato: "jacoco" });
    }
  }
  return saida;
}

export function lerGoCover(texto: string): CoberturaArquivo[] {
  const por = new Map<string, { total: number; cob: number }>();
  for (const l of texto.split(/\r?\n/)) {
    const m = /^(.+?):\d+\.\d+,\d+\.\d+\s+(\d+)\s+(\d+)$/.exec(l.trim());
    if (m === null) continue;
    const e = por.get(m[1] as string) ?? { total: 0, cob: 0 };
    e.total += Number(m[2]);
    if (Number(m[3]) > 0) e.cob += Number(m[2]);
    por.set(m[1] as string, e);
  }
  return [...por].map(([caminho, e]) => ({ caminho: norm(caminho), linhas_total: e.total, linhas_cobertas: e.cob, pct: pct(e.cob, e.total), formato: "gocover" as const }));
}

export function lerCoberturaTexto(formato: FormatoCobertura, texto: string): CoberturaArquivo[] {
  switch (formato) {
    case "lcov":
      return lerLcov(texto);
    case "cobertura":
      return lerCobertura(texto);
    case "jacoco":
      return lerJacoco(texto);
    case "gocover":
      return lerGoCover(texto);
  }
}

export interface CoberturaCasada extends CoberturaArquivo {
  /** Caminho do projeto (relativo à raiz) ao qual o relatório foi casado. */
  arquivo: string;
}

/**
 * Casa os caminhos do relatório com os do projeto: exato; prefixo absoluto (da raiz informada) removido; ou sufixo ÚNICO
 * (`com/x/Foo.java` ↔ `src/main/java/com/x/Foo.java`; `modulo/pkg/a.go` ↔ `pkg/a.go`). Ambíguo ou sem par: descartado.
 */
export function casarCaminhos(relatorio: readonly CoberturaArquivo[], caminhosProjeto: readonly string[], raiz?: string): CoberturaCasada[] {
  const conjunto = new Set(caminhosProjeto);
  const porNome = new Map<string, string[]>();
  for (const c of caminhosProjeto) {
    const n = c.slice(c.lastIndexOf("/") + 1);
    let l = porNome.get(n);
    if (l === undefined) porNome.set(n, (l = []));
    l.push(c);
  }
  const prefixo = raiz === undefined ? null : `${norm(raiz).replace(/\/$/, "")}/`;
  const saida: CoberturaCasada[] = [];
  for (const r of relatorio) {
    let p = norm(r.caminho);
    if (prefixo !== null && p.startsWith(prefixo)) p = p.slice(prefixo.length);
    let achado: string | undefined = conjunto.has(p) ? p : undefined;
    if (achado === undefined) {
      const candidatos = (porNome.get(p.slice(p.lastIndexOf("/") + 1)) ?? []).filter((c) => c.endsWith(`/${p}`) || p.endsWith(`/${c}`));
      if (candidatos.length === 1) achado = candidatos[0];
      else if (candidatos.length > 1) {
        const comum = (c: string): number => {
          const a = c.split("/").reverse();
          const b = p.split("/").reverse();
          let i = 0;
          while (i < a.length && i < b.length && a[i] === b[i]) i++;
          return i;
        };
        const pontos = candidatos.map((c) => [c, comum(c)] as const).sort((x, y) => y[1] - x[1]);
        if (pontos[0] !== undefined && pontos[1] !== undefined && pontos[0][1] > pontos[1][1]) achado = pontos[0][0];
      }
    }
    if (achado !== undefined) saida.push({ ...r, arquivo: achado });
  }
  return saida;
}

export interface CoberturaPasta {
  pasta: string;
  linhas_total: number;
  linhas_cobertas: number;
  pct: number;
  arquivos: number;
}

/** Cobertura agregada por pasta (ponderada por linhas). */
export function coberturaPorPasta(casadas: readonly CoberturaCasada[]): CoberturaPasta[] {
  const por = new Map<string, CoberturaPasta>();
  for (const c of casadas) {
    const i = c.arquivo.lastIndexOf("/");
    const pasta = i < 0 ? "." : c.arquivo.slice(0, i);
    const e = por.get(pasta) ?? { pasta, linhas_total: 0, linhas_cobertas: 0, pct: 0, arquivos: 0 };
    e.linhas_total += c.linhas_total;
    e.linhas_cobertas += c.linhas_cobertas;
    e.arquivos++;
    por.set(pasta, e);
  }
  return [...por.values()].map((e) => ({ ...e, pct: pct(e.linhas_cobertas, e.linhas_total) })).sort((a, b) => a.pasta.localeCompare(b.pasta));
}

/** Aviso quando o relatório é mais velho que o código mais recente (a medição pode estar defasada). */
export function avisoDefasagem(mtimeRelatorioMs: number, mtimeCodigoMaisNovoMs: number): string | null {
  if (mtimeRelatorioMs >= mtimeCodigoMaisNovoMs) return null;
  const dias = Math.max(1, Math.round((mtimeCodigoMaisNovoMs - mtimeRelatorioMs) / 86_400_000));
  return `relatório de cobertura mais velho que o código (cerca de ${dias} dia(s)): a cobertura medida pode estar defasada`;
}
