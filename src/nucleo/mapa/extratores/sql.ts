import type { OperacaoDado } from "../tipos";

// Extração de tabelas de um literal SQL (compartilhada por todos os extratores). Estática e conservadora:
// só aceita texto com FORMA de SQL (evita frases como "Select an item from the list") e só devolve
// identificadores simples. Nunca guarda o texto do SQL, só nomes de tabela e a operação.

export interface TabelaSql {
  tabela: string;
  operacao: OperacaoDado;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const PALAVRAS = new Set(["select", "lateral", "unnest", "values", "dual", "set", "where", "only", "table", "if", "not", "exists", "as", "on", "using", "from", "join"]);

/** Forma mínima de uma consulta SQL de leitura: lista de colunas plausível antes do FROM. */
const SELECT_FORMA = /^select\s+(?:distinct\s+|top\s+\d+\s+)?(?:\*|[\w."`\[\]]+(?:\([^)]*\))?(?:\s+as\s+\w+)?(?:\s*,\s*[^,]+?)*)\s+from\s+\S/i;
const INICIO = /^\s*(select|insert\s+into|update\s+\S+\s+set|delete\s+from|truncate|create\s+(?:or\s+replace\s+)?(?:temporary\s+|temp\s+|unlogged\s+)?table|alter\s+table|drop\s+table|with\s+\w+\s+as\s*\()/i;

function limpar(token: string): string | null {
  let t = token.trim().replace(/[;,)]+$/g, "");
  if (t === "" || t.startsWith("(")) return null;
  t = t.replace(/[`"\[\]]/g, "");
  if (/[$?:{}@#%]/.test(t)) return null;
  const partes = t.split(".");
  const nome = (partes[partes.length - 1] ?? "").toLowerCase();
  if (!IDENT.test(nome) || PALAVRAS.has(nome)) return null;
  return nome;
}

function adicionar(saida: Map<string, OperacaoDado>, tabela: string | null, operacao: OperacaoDado): void {
  if (tabela === null) return;
  const atual = saida.get(tabela);
  // escrita/definição prevalece sobre leitura da mesma tabela
  if (atual === undefined || (atual === "le" && operacao !== "le")) saida.set(tabela, operacao);
}

/** `true` se o texto parece SQL (início de instrução + forma mínima). */
export function pareceSql(texto: string): boolean {
  if (texto.length < 12 || texto.length > 20_000) return false;
  const norm = texto.replace(/\s+/g, " ").trim();
  if (!INICIO.test(norm)) return false;
  if (/^select/i.test(norm) || /^with/i.test(norm)) return /^with/i.test(norm) ? /\bselect\b/i.test(norm) : SELECT_FORMA.test(norm);
  return true;
}

export function extrairTabelasSql(texto: string): TabelaSql[] {
  if (!pareceSql(texto)) return [];
  const sql = texto.replace(/\s+/g, " ").trim();
  const saida = new Map<string, OperacaoDado>();
  const baixa = sql.toLowerCase();
  const ctes = new Set<string>();
  for (const m of sql.matchAll(/(?:\bwith\b|,)\s*(\w+)\s+as\s*\(/gi)) ctes.add((m[1] as string).toLowerCase());

  let m: RegExpMatchArray | null;
  if ((m = /^insert\s+into\s+(\S+)/i.exec(sql))) adicionar(saida, limpar(m[1] as string), "escreve");
  else if ((m = /^update\s+(?:only\s+)?(\S+)\s+set\b/i.exec(sql))) adicionar(saida, limpar(m[1] as string), "escreve");
  else if ((m = /^delete\s+from\s+(?:only\s+)?(\S+)/i.exec(sql))) adicionar(saida, limpar(m[1] as string), "escreve");
  else if ((m = /^truncate\s+(?:table\s+)?(?:only\s+)?(\S+)/i.exec(sql))) adicionar(saida, limpar(m[1] as string), "escreve");
  else if ((m = /^create\s+(?:or\s+replace\s+)?(?:temporary\s+|temp\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(\S+)/i.exec(sql))) adicionar(saida, limpar(m[1] as string), "define");
  else if ((m = /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(\S+)/i.exec(sql))) adicionar(saida, limpar(m[1] as string), "define");
  else if ((m = /^drop\s+table\s+(?:if\s+exists\s+)?(\S+)/i.exec(sql))) adicionar(saida, limpar(m[1] as string), "define");

  // leituras: FROM a [alias], b ... e JOIN c (em qualquer ponto; cobre INSERT … SELECT e UPDATE … FROM)
  const ehDelete = /^delete\s+from/i.test(sql);
  for (const f of baixa.matchAll(/\bfrom\s+(.+?)(?=\s(?:where|group|order|having|limit|offset|union|intersect|except|returning|window|for\s+update)\b|\s(?:inner|left|right|full|cross|natural|join)\b|;|\)|$)/g)) {
    if (ehDelete && f.index === baixa.indexOf("from")) continue; // o alvo do DELETE já foi contado como escrita
    for (const segmento of (f[1] as string).split(",")) {
      const token = segmento.trim().split(" ")[0] ?? "";
      const nome = limpar(token);
      if (nome !== null && !ctes.has(nome)) adicionar(saida, nome, "le");
    }
  }
  for (const j of baixa.matchAll(/\bjoin\s+(\S+)/g)) {
    const nome = limpar(j[1] as string);
    if (nome !== null && !ctes.has(nome)) adicionar(saida, nome, "le");
  }
  return [...saida].map(([tabela, operacao]) => ({ tabela, operacao }));
}
