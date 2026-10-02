import type { Aresta, Confianca, EntradaBruta, SubtipoEntrada } from "../tipos";
import { idArquivo, idEntrada, idSimbolo, type ArquivoMapa } from "./tipos";

// Entradas e fluxos (T-17.23): agrega as entradas dos extratores com manifestos e `web.xml`, normaliza a chave,
// liga entrada → handler (`aciona`) e calcula o FLUXO por BFS em `chama`/`instancia`.

export interface Entrada {
  id: string;
  subtipo: SubtipoEntrada;
  /** Normalizada: `GET /users/:id`. */
  chave: string;
  framework: string;
  caminho: string;
  linha: number;
  confianca: Confianca;
  /** Id do símbolo-handler, quando resolvido. */
  handler: string | null;
}

export interface ManifestoEntradas {
  /** Arquivo do manifesto (ex.: `package.json`). */
  caminho: string;
  /** `bin` do manifesto: nome do comando → arquivo (relativo à raiz). */
  bin?: Readonly<Record<string, string>>;
  /** `main` do manifesto (arquivo de entrada). */
  main?: string;
  /** `scripts` do manifesto: nome → comando (só viram entradas `cli` os nomes dados em `scriptsRelevantes`). */
  scripts?: Readonly<Record<string, string>>;
  linha?: number;
}

export interface WebXml {
  caminho: string;
  texto: string;
}

export interface ResultadoEntradas {
  entradas: Entrada[];
  /** Arestas `aciona` (entrada → símbolo ou arquivo). */
  arestas: Aresta[];
  /** Contagem por categoria (subtipo) para o perfil. */
  porCategoria: Record<string, number>;
}

const SCRIPTS_RELEVANTES = new Set(["start", "dev", "serve", "build", "test", "migrate", "seed", "worker", "cli"]);

/** `get /users/{id}/` → `GET /users/:id`. Chaves que não são HTTP (`ipc:x`, `cron:*`) só têm o espaço normalizado. */
export function normalizarChave(chave: string): string {
  const t = chave.trim().replace(/\s+/g, " ");
  const m = /^([A-Za-z]+) (\/\S*)$/.exec(t);
  if (m === null) return t;
  let p = m[2] as string;
  p = p.replace(/\{\*?(\w+)\}/g, ":$1").replace(/<(?:[\w.]+:)?(\w+)>/g, ":$1").replace(/\/{2,}/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return `${(m[1] as string).toUpperCase()} ${p}`;
}

function entradasDeWebXml(w: WebXml): EntradaBruta[] {
  const saida: EntradaBruta[] = [];
  const classes = new Map<string, string>();
  for (const m of w.texto.matchAll(/<servlet>[\s\S]*?<servlet-name>\s*([^<\s]+)\s*<\/servlet-name>[\s\S]*?<servlet-class>\s*([^<\s]+)\s*<\/servlet-class>[\s\S]*?<\/servlet>/g)) classes.set(m[1] as string, m[2] as string);
  for (const m of w.texto.matchAll(/<servlet-mapping>[\s\S]*?<servlet-name>\s*([^<\s]+)\s*<\/servlet-name>[\s\S]*?<url-pattern>\s*([^<\s]+)\s*<\/url-pattern>[\s\S]*?<\/servlet-mapping>/g)) {
    const linha = w.texto.slice(0, m.index ?? 0).split("\n").length;
    const classe = classes.get(m[1] as string);
    saida.push({ tipo: "rota", chave: `ALL ${m[2] as string}`, framework: "servlet", handler: classe === undefined ? null : (classe.split(".").pop() ?? null), linha, confianca: "exata" });
  }
  return saida;
}

export interface OpcoesEntradas {
  manifestos?: readonly ManifestoEntradas[];
  webXml?: readonly WebXml[];
}

/** Agrega e resolve entradas. Handler: mesmo arquivo (`exata`), senão nome único no projeto (`heuristica`). */
export function agregarEntradas(arquivos: readonly ArquivoMapa[], opcoes: OpcoesEntradas = {}): ResultadoEntradas {
  const porCaminho = new Map(arquivos.map((a) => [a.caminho, a]));
  const porNome = new Map<string, string[]>();
  for (const a of arquivos) {
    for (const s of a.extracao.simbolos) {
      if (s.tipo !== "funcao" && s.tipo !== "metodo" && s.tipo !== "classe") continue;
      let l = porNome.get(s.nome);
      if (l === undefined) porNome.set(s.nome, (l = []));
      l.push(idSimbolo(a.caminho, s.qualificado));
    }
  }
  const entradas: Entrada[] = [];
  const arestas: Aresta[] = [];
  const vistos = new Set<string>();
  const add = (caminho: string, e: EntradaBruta, arquivo: ArquivoMapa | undefined): void => {
    const chave = normalizarChave(e.chave);
    const id = idEntrada(caminho, chave);
    if (vistos.has(id)) return;
    vistos.add(id);
    let handler: string | null = null;
    let confianca: Confianca = e.confianca;
    if (e.handler !== null) {
      const local = arquivo?.extracao.simbolos.find((s) => s.qualificado === e.handler || s.nome === e.handler);
      if (local !== undefined && arquivo !== undefined) handler = idSimbolo(arquivo.caminho, local.qualificado);
      else {
        const cand = porNome.get(e.handler.split(".").pop() ?? e.handler) ?? [];
        if (cand.length === 1) {
          handler = cand[0] as string;
          confianca = "heuristica";
        }
      }
    }
    entradas.push({ id, subtipo: e.tipo, chave, framework: e.framework, caminho, linha: e.linha, confianca, handler });
    arestas.push({
      tipo: "aciona",
      de: id,
      para: handler ?? idArquivo(caminho),
      confianca: handler !== null ? confianca : "heuristica",
      peso: 1,
      candidatos: null,
      fonte: "extracao",
      arquivo_id: null,
      linha: e.linha,
      evidencias: [`${caminho}:${e.linha}`],
    });
  };
  for (const a of arquivos) for (const e of a.extracao.entradas) add(a.caminho, e, a);
  for (const w of opcoes.webXml ?? []) for (const e of entradasDeWebXml(w)) add(w.caminho, e, undefined);
  for (const m of opcoes.manifestos ?? []) {
    const linha = m.linha ?? 1;
    for (const [nome, alvo] of Object.entries(m.bin ?? {})) {
      const destino = alvo.replace(/^\.\//, "");
      add(porCaminho.has(destino) ? destino : m.caminho, { tipo: "cli", chave: `bin:${nome}`, framework: "manifesto", handler: null, linha, confianca: porCaminho.has(destino) ? "exata" : "heuristica" }, undefined);
    }
    if (m.main !== undefined) {
      const destino = m.main.replace(/^\.\//, "");
      add(porCaminho.has(destino) ? destino : m.caminho, { tipo: "main", chave: `main:${destino}`, framework: "manifesto", handler: null, linha, confianca: porCaminho.has(destino) ? "exata" : "heuristica" }, undefined);
    }
    for (const nome of Object.keys(m.scripts ?? {})) {
      if (SCRIPTS_RELEVANTES.has(nome)) add(m.caminho, { tipo: "cli", chave: `script:${nome}`, framework: "manifesto", handler: null, linha, confianca: "exata" }, undefined);
    }
  }
  entradas.sort((x, y) => x.caminho.localeCompare(y.caminho) || x.linha - y.linha || x.chave.localeCompare(y.chave));
  const porCategoria: Record<string, number> = {};
  for (const e of entradas) porCategoria[e.subtipo] = (porCategoria[e.subtipo] ?? 0) + 1;
  return { entradas, arestas, porCategoria };
}

// ---------------------------------------------------------------------------------------------
// Fluxo

export interface ArestaFluxoEntrada {
  tipo: string;
  de: string;
  para: string;
  confianca: Confianca;
}

export interface OpcoesFluxo {
  profundidade?: number;
  minConfianca?: Confianca;
  maxNos?: number;
}

export interface NoFluxo {
  id: string;
  /** Distância da entrada (0 = a própria entrada). */
  nivel: number;
  /** Folha externa (`ext:`): o fluxo para aqui. */
  externo: boolean;
  /** Alcançado só por aresta heurística (desenhar tracejado). */
  tracejado: boolean;
  /** Tabelas tocadas (`le_tabela`/`escreve_tabela`) por este nó. */
  tabelas: string[];
  /** Participa de ciclo (recursão) dentro do fluxo. */
  em_ciclo: boolean;
}

export interface ArestaFluxo {
  tipo: string;
  de: string;
  para: string;
  confianca: Confianca;
  tracejado: boolean;
  /** Aponta para nó já visitado de nível menor ou igual (volta/recursão). */
  retorno: boolean;
}

export interface ResultadoFluxo {
  raiz: string;
  nos: NoFluxo[];
  arestas: ArestaFluxo[];
  tabelas: string[];
  externos: string[];
  truncado: boolean;
}

const TIPOS_FLUXO = new Set(["aciona", "chama", "instancia"]);
const TIPOS_TABELA = new Set(["le_tabela", "escreve_tabela"]);

/**
 * Fluxo de uma entrada: BFS em `aciona`/`chama`/`instancia` (profundidade 6, 300 nós por padrão), para em `externo`, anota as
 * tabelas tocadas e os ciclos. A ordem dos nós é a das camadas (nível, depois ordem de descoberta; determinística).
 */
export function fluxo(arestas: readonly ArestaFluxoEntrada[], entradaId: string, opcoes: OpcoesFluxo = {}): ResultadoFluxo {
  const profundidade = opcoes.profundidade ?? 6;
  const maxNos = opcoes.maxNos ?? 300;
  const so = opcoes.minConfianca === "exata";
  const saida = new Map<string, ArestaFluxoEntrada[]>();
  for (const a of arestas) {
    if (!TIPOS_FLUXO.has(a.tipo) && !TIPOS_TABELA.has(a.tipo)) continue;
    if (so && a.confianca !== "exata") continue;
    let l = saida.get(a.de);
    if (l === undefined) saida.set(a.de, (l = []));
    l.push(a);
  }
  const nivel = new Map<string, number>([[entradaId, 0]]);
  const tracejado = new Map<string, boolean>([[entradaId, false]]);
  const ordem: string[] = [entradaId];
  const tabelasDe = new Map<string, Set<string>>();
  const todasTabelas = new Set<string>();
  const arestasSaida: ArestaFluxo[] = [];
  let truncado = false;
  for (let h = 0; h < ordem.length; h++) {
    const v = ordem[h] as string;
    const nv = nivel.get(v) as number;
    if (v.startsWith("ext:")) continue;
    for (const a of saida.get(v) ?? []) {
      if (TIPOS_TABELA.has(a.tipo)) {
        const nome = a.para.replace(/^tab:/, "");
        let s = tabelasDe.get(v);
        if (s === undefined) tabelasDe.set(v, (s = new Set()));
        s.add(nome);
        todasTabelas.add(nome);
        continue;
      }
      const jaVisto = nivel.has(a.para);
      if (!jaVisto) {
        if (nv >= profundidade) {
          truncado = true;
          continue;
        }
        if (ordem.length >= maxNos) {
          truncado = true;
          continue;
        }
        nivel.set(a.para, nv + 1);
        tracejado.set(a.para, a.confianca === "heuristica" || tracejado.get(v) === true);
        ordem.push(a.para);
      }
      arestasSaida.push({ tipo: a.tipo, de: v, para: a.para, confianca: a.confianca, tracejado: a.confianca === "heuristica", retorno: jaVisto && (nivel.get(a.para) as number) <= nv });
    }
  }
  // ciclo: nós em arestas de retorno e todos que estão no caminho entre alvo e origem do retorno
  const emCiclo = new Set<string>();
  const adj = new Map<string, string[]>();
  for (const a of arestasSaida) {
    let l = adj.get(a.de);
    if (l === undefined) adj.set(a.de, (l = []));
    l.push(a.para);
  }
  for (const r of arestasSaida.filter((x) => x.retorno)) {
    // nós alcançáveis de r.para que alcançam r.de dentro do subgrafo do fluxo
    const frente = new Set<string>([r.para]);
    for (const q = [r.para]; q.length > 0; ) {
      const x = q.pop() as string;
      for (const w of adj.get(x) ?? []) if (!frente.has(w)) { frente.add(w); q.push(w); }
    }
    if (!frente.has(r.de)) continue;
    const volta = new Map<string, string[]>();
    for (const a of arestasSaida) {
      let l = volta.get(a.para);
      if (l === undefined) volta.set(a.para, (l = []));
      l.push(a.de);
    }
    const tras = new Set<string>([r.de]);
    for (const q = [r.de]; q.length > 0; ) {
      const x = q.pop() as string;
      for (const w of volta.get(x) ?? []) if (!tras.has(w)) { tras.add(w); q.push(w); }
    }
    for (const x of frente) if (tras.has(x)) emCiclo.add(x);
    emCiclo.add(r.de);
    emCiclo.add(r.para);
  }
  const nos: NoFluxo[] = ordem.map((id) => ({
    id,
    nivel: nivel.get(id) as number,
    externo: id.startsWith("ext:"),
    tracejado: tracejado.get(id) === true,
    tabelas: [...(tabelasDe.get(id) ?? [])].sort(),
    em_ciclo: emCiclo.has(id),
  }));
  return { raiz: entradaId, nos, arestas: arestasSaida, tabelas: [...todasTabelas].sort(), externos: nos.filter((n) => n.externo).map((n) => n.id), truncado };
}
