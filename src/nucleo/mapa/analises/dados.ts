import { extrairTabelasSql } from "../extratores/sql";
import type { AcessoDadoBruto, Aresta, Confianca } from "../tipos";
import { idArquivo, idSimbolo, idTabela, type ArquivoMapa } from "./tipos";

// Acesso a dados (T-17.24): normaliza os `dados` brutos para nós `tab:<nome>`, cria `le_tabela`/`escreve_tabela`,
// registra as DEFINIÇÕES (migrações e arquivos de esquema) e responde "quem toca X" e "tabelas de cada entrada".
// O tokenizador de SQL é tolerante, não um parser completo: limite declarado (SQL montado em runtime não aparece).

const IDENT = /^[a-z_][a-z0-9_$]*$/;

/** Minúsculo, sem aspas/crases/colchetes e sem esquema (`"Public"."Users"` → `users`). `null` se não for identificador simples. */
export function normalizarTabela(nome: string): string | null {
  const t = nome.trim().replace(/[`"'[\]]/g, "");
  if (t === "" || /[\s${}()?:@#%*,;]/.test(t)) return null;
  const ult = (t.split(".").pop() ?? "").toLowerCase();
  return IDENT.test(ult) ? ult : null;
}

const RE_MIGRACAO_PASTA = /(^|\/)(migrations?|migrate|db\/migrate|alembic\/versions|flyway|liquibase|changelog|database\/migrations)\//i;
const RE_MIGRACAO_NOME = /(^|\/)(V\d+(?:[._]\d+)*__[^/]+\.sql|\d{4,}[_-][^/]+\.(sql|py|rb|php|ts|js|cs|java)|\d{14}_[^/]+)$/;

/** Heurística de caminho para `e_migracao`. */
export function ehMigracao(caminho: string): boolean {
  return RE_MIGRACAO_PASTA.test(caminho) || RE_MIGRACAO_NOME.test(caminho) || /(^|\/)(schema\.rb|schema\.prisma|structure\.sql)$/.test(caminho);
}

export interface DefinicaoTabela {
  tabela: string;
  caminho: string;
  linha: number;
  fonte: string;
  colunas: number | null;
}

/** Definições a partir de arquivos de esquema em texto: `.sql` (DDL), `schema.prisma`, `schema.rb`. Outros tipos: lista vazia. */
export function definicoesDeTexto(caminho: string, texto: string): DefinicaoTabela[] {
  const saida: DefinicaoTabela[] = [];
  const linhaDe = (i: number): number => texto.slice(0, i).split("\n").length;
  if (/\.sql$/i.test(caminho)) {
    const limpo = texto.replace(/--[^\n]*/g, (m) => " ".repeat(m.length)).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
    for (const m of limpo.matchAll(/\b(create|alter|drop)\s+(?:or\s+replace\s+)?(?:temporary\s+|temp\s+|unlogged\s+)?table\s+(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?([\w`"\[\].$]+)/gi)) {
      const nome = normalizarTabela(m[2] as string);
      if (nome === null) continue;
      let colunas: number | null = null;
      if ((m[1] as string).toLowerCase() === "create") {
        const ini = limpo.indexOf("(", (m.index ?? 0) + m[0].length);
        if (ini >= 0) {
          let prof = 0;
          let fim = ini;
          for (; fim < limpo.length; fim++) {
            const c = limpo[fim];
            if (c === "(") prof++;
            else if (c === ")" && --prof === 0) break;
          }
          colunas = limpo.slice(ini + 1, fim).split(/,(?![^(]*\))/).filter((p) => p.trim() !== "" && !/^\s*(primary|foreign|unique|constraint|key|index|check)\b/i.test(p)).length;
        }
      }
      saida.push({ tabela: nome, caminho, linha: linhaDe(m.index ?? 0), fonte: "ddl", colunas });
    }
  } else if (/(^|\/)schema\.prisma$/.test(caminho)) {
    for (const m of texto.matchAll(/^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)) {
      const map = /@@map\(\s*"([^"]+)"\s*\)/.exec(m[2] as string);
      const nome = normalizarTabela(map !== null ? (map[1] as string) : (m[1] as string));
      if (nome === null) continue;
      const colunas = (m[2] as string).split("\n").filter((l) => /^\s*\w+\s+\w+/.test(l) && !/^\s*@@/.test(l)).length;
      saida.push({ tabela: nome, caminho, linha: linhaDe(m.index ?? 0), fonte: "prisma", colunas });
    }
  } else if (/(^|\/)schema\.rb$/.test(caminho)) {
    for (const m of texto.matchAll(/^\s*create_table\s+["':]([\w.]+)["']?/gm)) {
      const nome = normalizarTabela(m[1] as string);
      if (nome !== null) saida.push({ tabela: nome, caminho, linha: linhaDe(m.index ?? 0), fonte: "schema_rb", colunas: null });
    }
  }
  return saida;
}

/** Tabelas de um bloco de SQL com várias instruções (arquivos `.sql`): usa o extrator literal por instrução. */
export function acessosDeSqlTexto(texto: string): Array<{ tabela: string; operacao: AcessoDadoBruto["operacao"]; linha: number }> {
  const saida: Array<{ tabela: string; operacao: AcessoDadoBruto["operacao"]; linha: number }> = [];
  let linha = 1;
  for (const parte of texto.replace(/--[^\n]*/g, "").split(";")) {
    const inicio = linha + (parte.length - parte.trimStart().length > 0 ? parte.slice(0, parte.length - parte.trimStart().length).split("\n").length - 1 : 0);
    for (const t of extrairTabelasSql(parte)) saida.push({ ...t, linha: inicio });
    linha += parte.split("\n").length - 1;
  }
  return saida;
}

export interface Tabela {
  nome: string;
  /** Onde é definida (migração, modelo, DDL). */
  definidaEm: Array<{ caminho: string; linha: number; fonte: string }>;
  colunas: number | null;
}

export interface ResultadoDados {
  tabelas: Map<string, Tabela>;
  /** `le_tabela` / `escreve_tabela`; do símbolo, ou do arquivo se o símbolo é desconhecido. */
  arestas: Aresta[];
  /** Caminhos marcados `e_migracao` (por caminho ou por só conter definições de tabela). */
  migracoes: Set<string>;
}

export interface OpcoesDados {
  /** Definições vindas de `definicoesDeTexto` (arquivos de esquema lidos pelo chamador). */
  definicoes?: readonly DefinicaoTabela[];
}

/** Normaliza o acesso a dados de todos os arquivos. SQL literal estático = `exata`; interpolado/ORM sem prova = `heuristica`. */
export function analisarDados(arquivos: readonly ArquivoMapa[], opcoes: OpcoesDados = {}): ResultadoDados {
  const tabelas = new Map<string, Tabela>();
  const arestas = new Map<string, Aresta>();
  const migracoes = new Set<string>();
  const garantir = (nome: string): Tabela => {
    let t = tabelas.get(nome);
    if (t === undefined) tabelas.set(nome, (t = { nome, definidaEm: [], colunas: null }));
    return t;
  };
  const definir = (d: DefinicaoTabela): void => {
    const t = garantir(d.tabela);
    if (!t.definidaEm.some((x) => x.caminho === d.caminho && x.linha === d.linha)) t.definidaEm.push({ caminho: d.caminho, linha: d.linha, fonte: d.fonte });
    if (d.colunas !== null && (t.colunas === null || d.colunas > t.colunas)) t.colunas = d.colunas;
    if (ehMigracao(d.caminho)) migracoes.add(d.caminho);
  };
  for (const d of opcoes.definicoes ?? []) definir(d);
  for (const a of arquivos) {
    if (ehMigracao(a.caminho)) migracoes.add(a.caminho);
    let soDefine = a.extracao.dados.length > 0;
    for (const d of a.extracao.dados) {
      const nome = normalizarTabela(d.tabela);
      if (nome === null) continue;
      garantir(nome);
      if (d.operacao === "define") {
        definir({ tabela: nome, caminho: a.caminho, linha: d.linha, fonte: d.fonte, colunas: null });
        continue;
      }
      soDefine = false;
      const tipo = d.operacao === "escreve" ? "escreve_tabela" : "le_tabela";
      const confianca: Confianca = d.operacao === "desconhecida" ? "heuristica" : d.confianca;
      const de = d.de !== null && a.extracao.simbolos.some((s) => s.qualificado === d.de) ? idSimbolo(a.caminho, d.de) : idArquivo(a.caminho);
      const chave = `${tipo}|${de}|${nome}`;
      const atual = arestas.get(chave);
      const evid = `${a.caminho}:${d.linha}`;
      if (atual === undefined) arestas.set(chave, { tipo, de, para: idTabela(nome), confianca, peso: 1, candidatos: null, fonte: "extracao", arquivo_id: null, linha: d.linha, evidencias: [evid] });
      else {
        atual.peso += 1;
        if (confianca === "exata") atual.confianca = "exata";
        if (atual.evidencias !== null && atual.evidencias.length < 5 && !atual.evidencias.includes(evid)) atual.evidencias.push(evid);
      }
    }
    if (soDefine) migracoes.add(a.caminho);
  }
  return { tabelas, arestas: [...arestas.values()], migracoes };
}

export interface Toque {
  /** Id do símbolo ou do arquivo que toca. */
  de: string;
  operacao: "le" | "escreve";
  confianca: Confianca;
  evidencia: string | null;
}

/** "Quem toca a tabela X": arestas de leitura/escrita para a tabela (nome ou id). */
export function quemToca(arestas: readonly Aresta[], tabela: string): Toque[] {
  const id = tabela.startsWith("tab:") ? tabela : idTabela(normalizarTabela(tabela) ?? tabela.toLowerCase());
  return arestas
    .filter((a) => a.para === id && (a.tipo === "le_tabela" || a.tipo === "escreve_tabela"))
    .map((a) => ({ de: a.de, operacao: a.tipo === "escreve_tabela" ? ("escreve" as const) : ("le" as const), confianca: a.confianca, evidencia: a.evidencias?.[0] ?? null }))
    .sort((x, y) => x.de.localeCompare(y.de) || x.operacao.localeCompare(y.operacao));
}

/** Tabelas tocadas por uma entrada: usa o fluxo (nós alcançados) e as arestas de dados. */
export function tabelasDe(arestas: readonly Aresta[], nosDoFluxo: Iterable<string>): Array<{ tabela: string; le: boolean; escreve: boolean }> {
  const nos = new Set(nosDoFluxo);
  const mapa = new Map<string, { tabela: string; le: boolean; escreve: boolean }>();
  for (const a of arestas) {
    if (!nos.has(a.de) || (a.tipo !== "le_tabela" && a.tipo !== "escreve_tabela")) continue;
    const nome = a.para.replace(/^tab:/, "");
    const t = mapa.get(nome) ?? { tabela: nome, le: false, escreve: false };
    if (a.tipo === "le_tabela") t.le = true;
    else t.escreve = true;
    mapa.set(nome, t);
  }
  return [...mapa.values()].sort((x, y) => x.tabela.localeCompare(y.tabela));
}
