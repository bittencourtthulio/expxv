// Analisador próprio de `.gitignore` (T-17.03), usado quando não há git. Semântica do git: padrões relativos à
// pasta do arquivo `.gitignore`, `!` nega, `/` no fim = só diretório, `/` no início ou no meio ancora, `**`,
// a última regra que casa vence e um diretório ignorado nunca tem filhos reincluídos.

export interface RegraGitignore {
  regex: RegExp;
  negada: boolean;
  soDiretorio: boolean;
  /** `true`: casa contra o caminho relativo à `base`; `false`: casa contra o nome (em qualquer profundidade). */
  ancorada: boolean;
  /** Pasta (relativa à raiz, sem barra final) do `.gitignore` de origem; `""` = raiz. */
  base: string;
}

function globParaRegex(glob: string): string {
  let r = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const antes = i === 0 || glob[i - 1] === "/";
        const depois = glob[i + 2] === "/" || i + 2 === glob.length;
        if (antes && depois) {
          if (glob[i + 2] === "/") {
            r += "(?:.*/)?"; // `**/` = zero ou mais diretórios
            i += 3;
          } else {
            r += ".*"; // `/**` no fim = tudo dentro
            i += 2;
          }
          continue;
        }
        r += "[^/]*";
        i += 2;
        continue;
      }
      r += "[^/]*";
      i++;
    } else if (c === "?") {
      r += "[^/]";
      i++;
    } else if (c === "[") {
      const fim = glob.indexOf("]", i + 2);
      if (fim === -1) {
        r += "\\[";
        i++;
      } else {
        let classe = glob.slice(i + 1, fim);
        if (classe.startsWith("!")) classe = `^${classe.slice(1)}`;
        r += `[${classe.replace(/\\/g, "\\\\")}]`;
        i = fim + 1;
      }
    } else if (c === "\\" && i + 1 < glob.length) {
      r += (glob[i + 1] as string).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      i += 2;
    } else {
      r += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      i++;
    }
  }
  return r;
}

/** Converte o texto de um `.gitignore` em regras. Linhas vazias e comentários são ignorados. */
export function parseGitignore(texto: string, base = ""): RegraGitignore[] {
  const regras: RegraGitignore[] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    let linha = bruta;
    // espaços finais só contam se escapados
    linha = linha.replace(/(?<!\\)\s+$/, "");
    if (linha === "" || linha.startsWith("#")) continue;
    let negada = false;
    if (linha.startsWith("!")) {
      negada = true;
      linha = linha.slice(1);
    } else if (linha.startsWith("\\!") || linha.startsWith("\\#")) {
      linha = linha.slice(1);
    }
    let soDiretorio = false;
    if (linha.endsWith("/")) {
      soDiretorio = true;
      linha = linha.replace(/\/+$/, "");
    }
    if (linha === "") continue;
    const ancorada = linha.includes("/");
    if (linha.startsWith("/")) linha = linha.slice(1);
    try {
      regras.push({ regex: new RegExp(`^${globParaRegex(linha)}$`), negada, soDiretorio, ancorada, base });
    } catch {
      /* padrão inválido: o git também o ignora */
    }
  }
  return regras;
}

export class AvaliadorGitignore {
  private readonly regras: RegraGitignore[] = [];
  private readonly cacheDiretorios = new Map<string, boolean>();

  constructor(regras: readonly RegraGitignore[] = []) {
    this.regras.push(...regras);
  }

  adicionar(regras: readonly RegraGitignore[]): void {
    this.regras.push(...regras);
    this.cacheDiretorios.clear();
  }

  private decidir(caminho: string, ehDir: boolean): boolean {
    let ignorado = false;
    for (const regra of this.regras) {
      if (regra.soDiretorio && !ehDir) continue;
      let relativo: string;
      if (regra.base === "") relativo = caminho;
      else if (caminho.startsWith(`${regra.base}/`)) relativo = caminho.slice(regra.base.length + 1);
      else continue;
      const alvo = regra.ancorada ? relativo : relativo.slice(relativo.lastIndexOf("/") + 1);
      if (regra.regex.test(alvo)) ignorado = !regra.negada;
    }
    return ignorado;
  }

  /** `caminho` relativo à raiz, com `/`. Ignorado se ele ou qualquer pasta-pai for ignorado. */
  ignorado(caminho: string, ehDir = false): boolean {
    const partes = caminho.split("/");
    let acumulado = "";
    for (let i = 0; i < partes.length - 1; i++) {
      acumulado = acumulado === "" ? (partes[i] as string) : `${acumulado}/${partes[i] as string}`;
      let d = this.cacheDiretorios.get(acumulado);
      if (d === undefined) {
        d = this.decidir(acumulado, true);
        this.cacheDiretorios.set(acumulado, d);
      }
      if (d) return true;
    }
    return this.decidir(caminho, ehDir);
  }
}
