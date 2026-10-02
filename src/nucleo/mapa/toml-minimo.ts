// TOML mínimo próprio (T-17.15): tabelas, arrays de tabelas, strings (básica, literal, multilinha), números,
// booleanos, arrays (multilinha) e tabelas inline. Sem dependência. Nunca lança: o que não entende vira `lacunas`.
// Não avalia nada; só lê texto.

export type ValorToml = string | number | boolean | ValorToml[] | { [chave: string]: ValorToml };

export interface ResultadoToml {
  valor: Record<string, ValorToml>;
  /** Caminho pontilhado (`tool.poetry.dependencies.requests`) -> linha (1-based) da chave. */
  linhas: Map<string, number>;
  lacunas: string[];
}

class Leitor {
  pos = 0;
  constructor(readonly t: string) {}
  get fim(): boolean {
    return this.pos >= this.t.length;
  }
  espacos(): void {
    while (!this.fim && (this.t[this.pos] === " " || this.t[this.pos] === "\t")) this.pos++;
  }
  espacosEQuebras(): void {
    for (;;) {
      this.espacos();
      const c = this.t[this.pos];
      if (c === "#") while (!this.fim && this.t[this.pos] !== "\n") this.pos++;
      else if (c === "\n" || c === "\r") this.pos++;
      else return;
    }
  }
}

function parseChave(l: Leitor): string[] {
  const partes: string[] = [];
  for (;;) {
    l.espacos();
    const c = l.t[l.pos];
    if (c === '"' || c === "'") {
      partes.push(parseString(l));
    } else {
      const ini = l.pos;
      while (!l.fim && /[A-Za-z0-9_-]/.test(l.t[l.pos] as string)) l.pos++;
      if (l.pos === ini) throw new Error("chave vazia");
      partes.push(l.t.slice(ini, l.pos));
    }
    l.espacos();
    if (l.t[l.pos] === ".") {
      l.pos++;
      continue;
    }
    return partes;
  }
}

function parseString(l: Leitor): string {
  const aspa = l.t[l.pos] as string;
  const triplo = l.t.startsWith(aspa.repeat(3), l.pos);
  if (triplo) {
    l.pos += 3;
    if (l.t[l.pos] === "\r") l.pos++;
    if (l.t[l.pos] === "\n") l.pos++;
    let saida = "";
    while (!l.fim && !l.t.startsWith(aspa.repeat(3), l.pos)) {
      if (aspa === '"' && l.t[l.pos] === "\\") {
        saida += escape(l);
        continue;
      }
      saida += l.t[l.pos++];
    }
    if (l.fim) throw new Error("string multilinha sem fim");
    l.pos += 3;
    return saida;
  }
  l.pos++;
  let saida = "";
  while (!l.fim && l.t[l.pos] !== aspa) {
    const c = l.t[l.pos];
    if (c === "\n") throw new Error("string sem fim");
    if (aspa === '"' && c === "\\") saida += escape(l);
    else saida += l.t[l.pos++];
  }
  if (l.fim) throw new Error("string sem fim");
  l.pos++;
  return saida;
}

function escape(l: Leitor): string {
  l.pos++;
  const c = l.t[l.pos++] ?? "";
  switch (c) {
    case "n": return "\n";
    case "t": return "\t";
    case "r": return "\r";
    case "\\": return "\\";
    case '"': return '"';
    case "\n": {
      while (/\s/.test(l.t[l.pos] ?? "x")) l.pos++;
      return "";
    }
    default: return c;
  }
}

function parseValor(l: Leitor): ValorToml {
  l.espacos();
  const c = l.t[l.pos];
  if (c === '"' || c === "'") return parseString(l);
  if (c === "[") {
    l.pos++;
    const arr: ValorToml[] = [];
    for (;;) {
      l.espacosEQuebras();
      if (l.t[l.pos] === "]") {
        l.pos++;
        return arr;
      }
      arr.push(parseValor(l));
      l.espacosEQuebras();
      if (l.t[l.pos] === ",") l.pos++;
      else if (l.t[l.pos] !== "]") throw new Error("array malformado");
    }
  }
  if (c === "{") {
    l.pos++;
    const obj: { [k: string]: ValorToml } = {};
    for (;;) {
      l.espacos();
      if (l.t[l.pos] === "}") {
        l.pos++;
        return obj;
      }
      const chave = parseChave(l);
      l.espacos();
      if (l.t[l.pos] !== "=") throw new Error("inline sem =");
      l.pos++;
      atribuir(obj, chave, parseValor(l));
      l.espacos();
      if (l.t[l.pos] === ",") l.pos++;
      else if (l.t[l.pos] !== "}") throw new Error("inline malformado");
    }
  }
  const ini = l.pos;
  while (!l.fim && !/[\s,\]}#]/.test(l.t[l.pos] as string)) l.pos++;
  const bruto = l.t.slice(ini, l.pos);
  if (bruto === "") throw new Error("valor vazio");
  if (bruto === "true") return true;
  if (bruto === "false") return false;
  const num = Number(bruto.replace(/_/g, ""));
  if (!Number.isNaN(num) && /^[+-]?[0-9]/.test(bruto)) return num;
  return bruto; // datas e afins: texto cru
}

function atribuir(alvo: { [k: string]: ValorToml }, chave: string[], valor: ValorToml): void {
  let atual = alvo;
  for (const p of chave.slice(0, -1)) {
    const prox = atual[p];
    if (prox === undefined || typeof prox !== "object" || Array.isArray(prox)) {
      const novo: { [k: string]: ValorToml } = {};
      atual[p] = novo;
      atual = novo;
    } else atual = prox;
  }
  atual[chave[chave.length - 1] as string] = valor;
}

export function lerToml(texto: string): ResultadoToml {
  const l = new Leitor(texto);
  const raiz: { [k: string]: ValorToml } = {};
  const linhas = new Map<string, number>();
  const lacunas: string[] = [];
  let atual = raiz;
  let prefixo: string[] = [];
  const linhaDe = (pos: number): number => {
    let n = 1;
    for (let i = 0; i < pos; i++) if (texto[i] === "\n") n++;
    return n;
  };
  const pularLinha = (): void => {
    while (!l.fim && l.t[l.pos] !== "\n") l.pos++;
  };
  while (!l.fim) {
    l.espacosEQuebras();
    if (l.fim) break;
    const ini = l.pos;
    try {
      if (l.t[l.pos] === "[") {
        const duplo = l.t[l.pos + 1] === "[";
        l.pos += duplo ? 2 : 1;
        const chave = parseChave(l);
        l.espacos();
        if (l.t[l.pos] !== "]") throw new Error("tabela sem ]");
        l.pos += duplo ? 2 : 1;
        // navega/cria
        let no = raiz;
        for (let i = 0; i < chave.length; i++) {
          const p = chave[i] as string;
          const ultimo = i === chave.length - 1;
          let prox = no[p];
          if (duplo && ultimo) {
            if (!Array.isArray(prox)) {
              prox = [];
              no[p] = prox;
            }
            const novo: { [k: string]: ValorToml } = {};
            (prox as ValorToml[]).push(novo);
            no = novo;
          } else {
            if (Array.isArray(prox)) prox = prox[prox.length - 1] as ValorToml;
            if (prox === undefined || typeof prox !== "object") {
              prox = {};
              no[p] = prox;
            }
            no = prox as { [k: string]: ValorToml };
          }
        }
        atual = no;
        prefixo = chave;
        linhas.set(chave.join("."), linhaDe(ini));
      } else {
        const chave = parseChave(l);
        l.espacos();
        if (l.t[l.pos] !== "=") throw new Error("esperava =");
        l.pos++;
        const valor = parseValor(l);
        atribuir(atual, chave, valor);
        linhas.set([...prefixo, ...chave].join("."), linhaDe(ini));
      }
    } catch (e) {
      lacunas.push(`linha ${linhaDe(ini)}: ${(e as Error).message}`);
      l.pos = Math.max(l.pos, ini);
      pularLinha();
      continue;
    }
    l.espacos();
    if (l.t[l.pos] === "#") pularLinha();
  }
  return { valor: raiz, linhas, lacunas };
}
