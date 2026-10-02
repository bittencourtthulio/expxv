import type { ArquivoParaResolver, LigacaoImport } from "./resolucao/comum";
import type { Confianca, ChamadaBruta, HerancaBruta, SimboloBruto } from "./tipos";
import { MAX_CANDIDATOS, MAX_EVIDENCIAS } from "./tipos";

// Resolução de chamadas e confiança (T-17.19, §4.2 do plano). PURA: recebe os arquivos já extraídos e as ligações de
// import já resolvidas (resolucao/*) e produz arestas SÍMBOLO -> SÍMBOLO (`chama`, `instancia`, `referencia`, `herda`,
// `implementa`) com confiança. Ordem de resolução, de mais forte para mais fraca:
//   1. escopo local (definições do arquivo; `this/self/$this` na classe e nas bases)
//   2. binding de import -> símbolo exportado do arquivo-alvo (segue `reexporta` ≤ 5 saltos)        = exata
//   3. `Receptor.método` com receptor classe/namespace local ou importado                            = exata
//   4. só por nome: único = heurística (candidatos=1); 2–5 = uma aresta por candidato; > 5 descartado  = heurística
//   5. interfaces: chamada a método de interface liga também às implementações (via_interface)       = heurística
// Limite declarado: sem tipo do receptor (variável local tipada) a extração não informa nada; essas chamadas caem no
// passo 4 (pedido em docs/ade/pedidos/17-pedidos.md).

export type TipoArestaSimbolo = "chama" | "instancia" | "referencia" | "herda" | "implementa";

export interface ArestaSimbolo {
  tipo: TipoArestaSimbolo;
  /** `sim:<arquivo>#<qualificado>` ou `arq:<arquivo>` (chamada no topo do arquivo). */
  de: string;
  /** `sim:…`, `arq:…` ou `ext:<eco>:<nome>`. */
  para: string;
  confianca: Confianca;
  /** Número de candidatos quando a resolução foi por nome (≤ 5). */
  candidatos: number | null;
  via_interface: boolean;
  peso: number;
  /** Primeira ocorrência. */
  arquivo: string;
  linha: number;
  /** Até 5 `arquivo:linha`. */
  evidencias: string[];
}

export interface EntradaChamadas {
  arquivos: ReadonlyMap<string, ArquivoParaResolver>;
  /** Todas as ligações de import (união dos resolvedores). */
  ligacoes: readonly LigacaoImport[];
}

export interface OpcoesChamadas {
  /** Nomes genéricos que NUNCA são resolvidos só por nome (padrão: `STOPLIST_PADRAO`). */
  stoplist?: ReadonlySet<string>;
}

export interface ResultadoChamadas {
  arestas: ArestaSimbolo[];
  /** Chamadas só-por-nome com mais de 5 candidatos (descartadas e contadas). */
  chamadas_ambiguas: number;
  /** Chamadas só-por-nome descartadas pela stoplist. */
  descartadas_stoplist: number;
  /** Chamadas sem nenhum alvo no projeto (API de biblioteca, builtin). */
  sem_alvo: number;
}

/** Nomes genéricos (por linguagem somados) que não se resolvem só por nome. */
export const STOPLIST_PADRAO: ReadonlySet<string> = new Set(
  (
    "get set run handle toString map push pop shift unshift filter forEach reduce find findIndex some every includes indexOf slice splice concat join split trim replace match test exec " +
    "then catch finally call apply bind log error warn info debug print println printf sprintf errorf puts format parse stringify assign keys values entries items add remove delete has clear " +
    "append insert update create init start stop open close read write send emit on off once next done count index length size equals hashCode compareTo toJSON valueOf " +
    "str int len range sorted sum min max abs setdefault startswith endswith strip lower upper each each_with_index select reject collect inject first last new initialize to_s to_a to_h " +
    "main constructor render validate execute apply_async save load dump dumps loads sleep wait cancel reset toArray stream collect of from build"
  ).split(/\s+/),
);

const CLASSE_IMPLICITA = new Set(["java", "csharp", "ruby", "cpp", "c", "php"]);
const RECEPTORES_PROPRIOS = new Set(["this", "self", "$this", "cls", "static"]);
const RECEPTORES_BASE = new Set(["super", "base", "parent"]);
const TIPOS_CLASSE = new Set(["classe", "struct", "interface", "trait", "enum", "tipo"]);
const MAX_SALTOS = 5;

interface RefSimbolo {
  arquivo: string;
  sim: SimboloBruto;
}

interface Binding {
  local: string;
  /** Arquivos alcançados (pacote/namespace pode ter vários). */
  alvos: string[];
  ext: string | null;
  /** Nome exportado quando o binding é de um nome (TS `{ a as b }`, Java FQN, PHP `use`); `null` = módulo/namespace. */
  nome: string | null;
  /** `import * as ns`, `import modulo`, pacote Go: o binding também pode ser um namespace. */
  namespace: boolean;
  confianca: Confianca;
  linha: number;
}

const idSim = (a: string, q: string): string => `sim:${a}#${q}`;
const ultimoSegmento = (s: string): string => s.split(/[./\\:]+/).filter(Boolean).pop() ?? s;
const primeiroSegmento = (s: string): string => s.split(/[./\\:]+/).filter(Boolean)[0] ?? s;

export function resolverChamadas(entrada: EntradaChamadas, opcoes: OpcoesChamadas = {}): ResultadoChamadas {
  const stoplist = opcoes.stoplist ?? STOPLIST_PADRAO;
  const arquivos = [...entrada.arquivos.values()].sort((a, b) => (a.caminho < b.caminho ? -1 : 1));

  // ---- índices
  const simbolos = new Map<string, Map<string, SimboloBruto>>();
  const porNome = new Map<string, RefSimbolo[]>();
  for (const a of arquivos) {
    const m = new Map<string, SimboloBruto>();
    for (const s of a.extracao.simbolos) {
      m.set(s.qualificado, s);
      const l = porNome.get(s.nome) ?? [];
      l.push({ arquivo: a.caminho, sim: s });
      porNome.set(s.nome, l);
    }
    simbolos.set(a.caminho, m);
  }
  const ligacoesPorArquivo = new Map<string, LigacaoImport[]>();
  for (const l of entrada.ligacoes) {
    const x = ligacoesPorArquivo.get(l.arquivo) ?? [];
    x.push(l);
    ligacoesPorArquivo.set(l.arquivo, x);
  }
  const sim = (arq: string, q: string): SimboloBruto | undefined => simbolos.get(arq)?.get(q);
  const ling = (arq: string): string => entrada.arquivos.get(arq)?.linguagem ?? "outra";

  // ---- bindings por arquivo
  const bindingsCache = new Map<string, Map<string, Binding[]>>();
  const bindingsDe = (arq: string): Map<string, Binding[]> => {
    const cache = bindingsCache.get(arq);
    if (cache !== undefined) return cache;
    const mapa = new Map<string, Binding[]>();
    const poe = (b: Binding): void => {
      const l = mapa.get(b.local) ?? [];
      l.push(b);
      mapa.set(b.local, l);
    };
    for (const l of ligacoesPorArquivo.get(arq) ?? []) {
      const alvos = (l.alvos ?? (l.para !== null && l.para.startsWith("arq:") ? [l.para] : [])).map((x) => x.slice(4));
      const ext = l.para !== null && l.para.startsWith("ext:") ? l.para : null;
      if (alvos.length === 0 && ext === null) continue;
      const base = { alvos, ext, confianca: l.confianca, linha: l.linha };
      if (l.nomes.length === 0) {
        // `import a.b.C` / `using X` / `use A\B` / pacote Go: liga pelo último segmento (e pelo texto inteiro e o 1º segmento)
        const ult = ultimoSegmento(l.especificador);
        poe({ ...base, local: ult, nome: ult, namespace: true });
        if (/[./\\:]/.test(l.especificador)) {
          poe({ ...base, local: l.especificador, nome: null, namespace: true });
          poe({ ...base, local: primeiroSegmento(l.especificador), nome: null, namespace: true });
        }
        continue;
      }
      for (const n of l.nomes) {
        if (n.nome === "*") {
          if (n.alias !== null && n.alias !== "_" && n.alias !== ".") poe({ ...base, local: n.alias, nome: null, namespace: true });
          else if (n.alias === null || n.alias === ".") poe({ ...base, local: "*", nome: "*", namespace: false });
          continue;
        }
        const limpo = n.nome.replace(/^(function|const) /, "");
        poe({ ...base, local: n.alias ?? limpo, nome: limpo, namespace: false });
      }
    }
    bindingsCache.set(arq, mapa);
    return mapa;
  };

  /** Símbolo exportado `nome` em `arq`, seguindo `reexporta` (≤ 5 saltos). */
  const exportado = (arq: string, nome: string, saltos = 0, visto = new Set<string>()): RefSimbolo | null => {
    if (saltos > MAX_SALTOS || visto.has(`${arq}|${nome}`)) return null;
    visto.add(`${arq}|${nome}`);
    const direto = sim(arq, nome);
    if (direto !== undefined) return { arquivo: arq, sim: direto };
    if (nome === "default") {
      for (const s of simbolos.get(arq)?.values() ?? []) if (s.nome === "default") return { arquivo: arq, sim: s };
    }
    const a = entrada.arquivos.get(arq);
    if (a === undefined) return null;
    for (const l of ligacoesPorArquivo.get(arq) ?? []) {
      const imp = a.extracao.imports.find((i) => i.especificador === l.especificador && i.linha === l.linha);
      if (imp === undefined || imp.tipo !== "reexport" || l.para === null || !l.para.startsWith("arq:")) continue;
      const alvo = l.para.slice(4);
      if (l.nomes.length === 0 || l.nomes.some((n) => n.nome === "*" && n.alias === null)) {
        const r = exportado(alvo, nome, saltos + 1, visto);
        if (r !== null) return r;
      } else {
        for (const n of l.nomes) if ((n.alias ?? n.nome) === nome) {
          const r = exportado(alvo, n.nome, saltos + 1, visto);
          if (r !== null) return r;
        }
      }
    }
    return null;
  };

  /** Procura `nome` nos arquivos-alvo de um binding. */
  const noBinding = (b: Binding, nome: string): RefSimbolo[] => {
    const achados: RefSimbolo[] = [];
    for (const arq of b.alvos) {
      const r = exportado(arq, nome);
      if (r !== null) achados.push(r);
    }
    return achados;
  };

  // ---- acumulador de arestas
  const arestas = new Map<string, ArestaSimbolo>();
  const resultado: ResultadoChamadas = { arestas: [], chamadas_ambiguas: 0, descartadas_stoplist: 0, sem_alvo: 0 };
  const ligar = (tipo: TipoArestaSimbolo, de: string, para: string, confianca: Confianca, candidatos: number | null, via: boolean, arq: string, linha: number): void => {
    const chave = `${tipo}|${de}|${para}|${via ? 1 : 0}`;
    const ev = `${arq}:${linha}`;
    const x = arestas.get(chave);
    if (x === undefined) arestas.set(chave, { tipo, de, para, confianca, candidatos, via_interface: via, peso: 1, arquivo: arq, linha, evidencias: [ev] });
    else {
      x.peso++;
      if (x.evidencias.length < MAX_EVIDENCIAS && !x.evidencias.includes(ev)) x.evidencias.push(ev);
      if (confianca === "exata" && x.confianca !== "exata") {
        x.confianca = "exata";
        x.candidatos = null;
      }
    }
  };

  // ---- interfaces
  const implementacoes = new Map<string, Array<{ arquivo: string; classe: string }>>();
  const classePorNome = (nome: string): RefSimbolo[] => (porNome.get(nome) ?? []).filter((r) => TIPOS_CLASSE.has(r.sim.tipo) && r.sim.tipo !== "interface" && r.sim.tipo !== "trait");
  for (const a of arquivos)
    for (const h of a.extracao.herancas ?? []) {
      if (h.tipo !== "implementa") continue;
      const iface = ultimoSegmento(h.base.replace(/<.*$/, ""));
      let classe: { arquivo: string; classe: string } | null = null;
      if (sim(a.caminho, h.classe) !== undefined) classe = { arquivo: a.caminho, classe: h.classe };
      else {
        const c = classePorNome(ultimoSegmento(h.classe));
        if (c.length === 1) classe = { arquivo: (c[0] as RefSimbolo).arquivo, classe: (c[0] as RefSimbolo).sim.qualificado };
      }
      if (classe === null) continue;
      const l = implementacoes.get(iface) ?? [];
      if (!l.some((x) => x.arquivo === (classe as { arquivo: string }).arquivo && x.classe === (classe as { classe: string }).classe)) l.push(classe);
      implementacoes.set(iface, l);
    }

  const aposResolverMembro = (tipo: TipoArestaSimbolo, de: string, alvo: RefSimbolo, arq: string, linha: number): void => {
    // método de interface -> implementações
    const i = alvo.sim.qualificado.lastIndexOf(".");
    if (i < 0 || (tipo !== "chama")) return;
    const cont = sim(alvo.arquivo, alvo.sim.qualificado.slice(0, i));
    if (cont === undefined || (cont.tipo !== "interface" && cont.tipo !== "trait")) return;
    const impls = (implementacoes.get(cont.nome) ?? []).slice(0, MAX_CANDIDATOS);
    for (const im of impls) {
      const m = sim(im.arquivo, `${im.classe}.${alvo.sim.nome}`);
      if (m !== undefined) ligar("chama", de, idSim(im.arquivo, m.qualificado), "heuristica", impls.length, true, arq, linha);
    }
  };

  /** Classe envolvente (qualificado) de um símbolo. */
  const classeEnvolvente = (arq: string, de: string | null): string | null => {
    if (de === null) return null;
    const partes = de.split(".");
    for (let n = partes.length; n >= 1; n--) {
      const q = partes.slice(0, n).join(".");
      const s = sim(arq, q);
      if (s !== undefined && TIPOS_CLASSE.has(s.tipo)) return q;
    }
    return null;
  };

  const basesDe = (arq: string, classe: string): HerancaBruta[] => (entrada.arquivos.get(arq)?.extracao.herancas ?? []).filter((h) => h.classe === classe);

  /** Resolve um nome de tipo como escrito (`Base`, `a.b.Base`, `\A\B`) para o símbolo de classe. */
  const resolverTipo = (arq: string, nome: string): { ref: RefSimbolo | null; ext: string | null; confianca: Confianca; candidatos: number | null; todos?: RefSimbolo[] } => {
    const limpo = nome.replace(/<.*$/, "").replace(/^\\/, "");
    const direto = sim(arq, limpo.replace(/\\/g, "."));
    if (direto !== undefined) return { ref: { arquivo: arq, sim: direto }, ext: null, confianca: "exata", candidatos: null };
    const binds = bindingsDe(arq);
    for (const chave of [limpo, primeiroSegmento(limpo), ultimoSegmento(limpo)]) {
      for (const b of binds.get(chave) ?? []) {
        const alvos = b.nome !== null && b.nome !== "*" ? noBinding(b, b.nome) : noBinding(b, ultimoSegmento(limpo));
        const a1 = alvos.filter((r) => TIPOS_CLASSE.has(r.sim.tipo));
        if (a1.length === 1) return { ref: a1[0] as RefSimbolo, ext: null, confianca: b.confianca === "exata" ? "exata" : "heuristica", candidatos: null };
        if (b.ext !== null && b.alvos.length === 0) return { ref: null, ext: b.ext, confianca: "exata", candidatos: null };
      }
    }
    for (const b of binds.get("*") ?? []) {
      const a1 = noBinding(b, ultimoSegmento(limpo)).filter((r) => TIPOS_CLASSE.has(r.sim.tipo));
      if (a1.length === 1) return { ref: a1[0] as RefSimbolo, ext: null, confianca: b.confianca === "exata" ? "exata" : "heuristica", candidatos: null };
    }
    const cands = (porNome.get(ultimoSegmento(limpo)) ?? []).filter((r) => TIPOS_CLASSE.has(r.sim.tipo));
    if (cands.length >= 1 && cands.length <= MAX_CANDIDATOS) return { ref: cands.length === 1 ? (cands[0] as RefSimbolo) : null, ext: null, confianca: "heuristica", candidatos: cands.length, todos: cands };
    return { ref: null, ext: null, confianca: "heuristica", candidatos: null };
  };

  /** Membro `nome` de uma classe, subindo pelas bases (≤ 5 níveis). */
  const membroDaClasse = (arq: string, classe: string, nome: string, nivel = 0, visto = new Set<string>()): RefSimbolo | null => {
    const chave = `${arq}|${classe}`;
    if (nivel > MAX_SALTOS || visto.has(chave)) return null;
    visto.add(chave);
    const m = sim(arq, `${classe}.${nome}`);
    if (m !== undefined) return { arquivo: arq, sim: m };
    for (const h of basesDe(arq, classe)) {
      const b = resolverTipo(arq, h.base);
      if (b.ref !== null && b.candidatos === null) {
        const r = membroDaClasse(b.ref.arquivo, b.ref.sim.qualificado, nome, nivel + 1, visto);
        if (r !== null) return r;
      }
    }
    return null;
  };

  const tiposChamavel = (tipo: TipoArestaSimbolo): ReadonlySet<string> =>
    tipo === "chama" ? new Set(["funcao", "metodo", "classe", "struct"]) : TIPOS_CLASSE;

  // ---- passada principal
  for (const a of arquivos) {
    const arq = a.caminho;
    const l = ling(arq);
    const binds = bindingsDe(arq);
    const deId = (de: string | null): string => (de !== null && sim(arq, de) !== undefined ? idSim(arq, de) : `arq:${arq}`);
    const arestaTipo = (c: ChamadaBruta): TipoArestaSimbolo => (c.tipo === "instancia" ? "instancia" : c.tipo === "referencia" ? "referencia" : "chama");

    for (const c of a.extracao.chamadas ?? []) {
      const tipo = arestaTipo(c);
      const de = deId(c.de);
      const emit = (r: RefSimbolo, conf: Confianca, cand: number | null = null): void => {
        ligar(tipo, de, idSim(r.arquivo, r.sim.qualificado), conf, cand, false, arq, c.linha);
        aposResolverMembro(tipo, de, r, arq, c.linha);
      };
      const emitExt = (ext: string): void => ligar(tipo, de, ext, "exata", null, false, arq, c.linha);
      const aceita = tiposChamavel(tipo);
      const rec = c.receptor;

      // ---------- sem receptor
      if (rec === null) {
        // 1) escopo: funções aninhadas / classe implícita / topo do arquivo
        const partes = c.de === null ? [] : c.de.split(".");
        let achou: SimboloBruto | undefined;
        for (let n = partes.length; n >= 1 && achou === undefined; n--) {
          const pref = partes.slice(0, n).join(".");
          const ps = sim(arq, pref);
          if (ps === undefined) continue;
          const vale = ps.tipo === "funcao" || ps.tipo === "metodo" || (TIPOS_CLASSE.has(ps.tipo) && CLASSE_IMPLICITA.has(l));
          if (!vale) continue;
          const cand = sim(arq, `${pref}.${c.alvo}`);
          if (cand !== undefined && aceita.has(cand.tipo)) achou = cand;
        }
        if (achou === undefined) {
          const topo = sim(arq, c.alvo);
          if (topo !== undefined && aceita.has(topo.tipo)) achou = topo;
        }
        if (achou === undefined && CLASSE_IMPLICITA.has(l)) {
          const cls = classeEnvolvente(arq, c.de);
          const m = cls === null ? null : membroDaClasse(arq, cls, c.alvo);
          if (m !== null && aceita.has(m.sim.tipo)) {
            emit(m, "exata");
            continue;
          }
        }
        if (achou !== undefined) {
          emit({ arquivo: arq, sim: achou }, "exata");
          continue;
        }
        // Go: mesmo pacote (mesma pasta)
        if (l === "go") {
          const pasta = arq.slice(0, Math.max(arq.lastIndexOf("/"), 0));
          const irmaos = arquivos.filter((x) => x.linguagem === "go" && x.caminho !== arq && x.caminho.slice(0, Math.max(x.caminho.lastIndexOf("/"), 0)) === pasta && !x.caminho.endsWith("_test.go"));
          const r: RefSimbolo[] = [];
          for (const x of irmaos) {
            const s2 = sim(x.caminho, c.alvo);
            if (s2 !== undefined) r.push({ arquivo: x.caminho, sim: s2 });
          }
          if (r.length === 1 && aceita.has((r[0] as RefSimbolo).sim.tipo)) {
            emit(r[0] as RefSimbolo, "exata");
            continue;
          }
        }
        // 2) binding de import por nome
        let resolvido = false;
        for (const b of binds.get(c.alvo) ?? []) {
          if (b.nome !== null && b.nome !== "*") {
            const r = noBinding(b, b.nome).filter((x) => aceita.has(x.sim.tipo));
            if (r.length === 1) {
              emit(r[0] as RefSimbolo, b.confianca === "exata" ? "exata" : "heuristica", b.confianca === "exata" ? null : 1);
              resolvido = true;
              break;
            }
            if (r.length === 0 && b.ext !== null && b.alvos.length === 0) {
              emitExt(b.ext);
              resolvido = true;
              break;
            }
          }
        }
        if (resolvido) continue;
        // 2b) curinga (`using X`, `import static a.B.*`, `from x import *`, dot-import)
        const curingas = (binds.get("*") ?? []).flatMap((b) => noBinding(b, c.alvo).filter((x) => aceita.has(x.sim.tipo)).map((x) => ({ x, b })));
        if (curingas.length === 1) {
          const { x, b } = curingas[0] as { x: RefSimbolo; b: Binding };
          emit(x, b.confianca === "exata" ? "exata" : "heuristica", b.confianca === "exata" ? null : 1);
          continue;
        }
        // 2c) bindings sem nomes (Java/C#/PHP por FQN; pacote de namespace) cobrindo o nome
        const porLocal = (binds.get(c.alvo) ?? []).filter((b) => b.namespace && b.nome !== null);
        for (const b of porLocal) {
          const r = noBinding(b, c.alvo).filter((x) => aceita.has(x.sim.tipo));
          if (r.length === 1) {
            emit(r[0] as RefSimbolo, b.confianca === "exata" ? "exata" : "heuristica", b.confianca === "exata" ? null : 1);
            resolvido = true;
            break;
          }
        }
        if (resolvido) continue;
        // 3) por nome
        porNomeSoh(c, tipo, de, emit);
        continue;
      }

      // ---------- receptor próprio / base
      if (RECEPTORES_PROPRIOS.has(rec) || RECEPTORES_BASE.has(rec)) {
        const cls = classeEnvolvente(arq, c.de);
        if (cls !== null) {
          let m: RefSimbolo | null = null;
          if (RECEPTORES_BASE.has(rec)) {
            for (const h of basesDe(arq, cls)) {
              const b = resolverTipo(arq, h.base);
              if (b.ref !== null && b.candidatos === null) {
                m = membroDaClasse(b.ref.arquivo, b.ref.sim.qualificado, c.alvo);
                if (m !== null) break;
              }
            }
          } else m = membroDaClasse(arq, cls, c.alvo);
          if (m !== null) {
            emit(m, "exata");
            continue;
          }
        }
        porNomeSoh(c, tipo, de, emit, true);
        continue;
      }

      // ---------- receptor nomeado
      const recLimpo = rec.replace(/^\\/, "");
      if (rec !== "?" && !rec.startsWith("$")) {
        // a) classe/namespace local (`Foo.alvo`, `a.b.alvo`)
        const local = sim(arq, `${recLimpo.replace(/[\\]/g, ".")}.${c.alvo}`);
        if (local !== undefined && aceita.has(local.tipo)) {
          emit({ arquivo: arq, sim: local }, "exata");
          continue;
        }
        // b) binding do receptor
        const chaves = [...new Set([recLimpo, primeiroSegmento(recLimpo), ultimoSegmento(recLimpo)])];
        let feito = false;
        for (const chave of chaves) {
          const resto = chave === recLimpo ? "" : chave === primeiroSegmento(recLimpo) ? recLimpo.slice(chave.length).replace(/^[./\\:]+/, "") : "";
          for (const b of binds.get(chave) ?? []) {
            const classes: RefSimbolo[] = [];
            if (b.nome !== null && b.nome !== "*") classes.push(...noBinding(b, b.nome));
            if (resto !== "") for (const arq2 of b.alvos) { const r = exportado(arq2, resto.split(/[./\\:]/)[0] as string); if (r !== null) classes.push(r); }
            // classe importada: membro dela
            for (const cl of classes.filter((x) => TIPOS_CLASSE.has(x.sim.tipo))) {
              const m = membroDaClasse(cl.arquivo, cl.sim.qualificado, c.alvo);
              if (m !== null && aceita.has(m.sim.tipo)) {
                emit(m, b.confianca === "exata" ? "exata" : "heuristica", b.confianca === "exata" ? null : 1);
                feito = true;
                break;
              }
            }
            if (feito) break;
            // interface sem o membro declarado como símbolo: liga às implementações
            for (const cl of classes.filter((x) => x.sim.tipo === "interface" || x.sim.tipo === "trait")) {
              const impls = (implementacoes.get(cl.sim.nome) ?? []).filter((im) => sim(im.arquivo, `${im.classe}.${c.alvo}`) !== undefined).slice(0, MAX_CANDIDATOS);
              for (const im of impls) ligar("chama", de, idSim(im.arquivo, `${im.classe}.${c.alvo}`), "heuristica", impls.length, true, arq, c.linha);
              if (impls.length > 0) feito = true;
            }
            if (feito) break;
            // namespace/módulo importado: função/classe `alvo` nos arquivos-alvo
            if (b.namespace && resto === "") {
              const r = noBinding(b, c.alvo).filter((x) => aceita.has(x.sim.tipo));
              if (r.length === 1) {
                emit(r[0] as RefSimbolo, b.confianca === "exata" ? "exata" : "heuristica", b.confianca === "exata" ? null : 1);
                feito = true;
                break;
              }
            }
            if (b.ext !== null && b.alvos.length === 0) {
              emitExt(b.ext);
              feito = true;
              break;
            }
          }
          if (feito) break;
        }
        if (feito) continue;
      }
      porNomeSoh(c, tipo, de, emit, true);
    }

    // ---- herança / implementação
    for (const h of a.extracao.herancas ?? []) {
      const tipo: TipoArestaSimbolo = h.tipo;
      let de = sim(arq, h.classe) !== undefined ? idSim(arq, h.classe) : null;
      if (de === null) {
        // ligação de DI: a `classe` pode estar em outro arquivo
        const c = classePorNome(ultimoSegmento(h.classe));
        de = c.length === 1 ? idSim((c[0] as RefSimbolo).arquivo, (c[0] as RefSimbolo).sim.qualificado) : `arq:${arq}`;
      }
      const alvo = resolverTipo(arq, h.base);
      if (alvo.ext !== null) ligar(tipo, de, alvo.ext, "exata", null, false, arq, h.linha);
      else if (alvo.ref !== null) ligar(tipo, de, idSim(alvo.ref.arquivo, alvo.ref.sim.qualificado), alvo.confianca, alvo.candidatos, false, arq, h.linha);
      else if (alvo.todos !== undefined) for (const t of alvo.todos) ligar(tipo, de, idSim(t.arquivo, t.sim.qualificado), "heuristica", alvo.todos.length, false, arq, h.linha);
      else resultado.sem_alvo++;
    }
  }

  /** Passo 4: só por nome (stoplist, único, 2–5, >5 descartado). */
  function porNomeSoh(c: ChamadaBruta, tipo: TipoArestaSimbolo, de: string, emit: (r: RefSimbolo, conf: Confianca, cand?: number | null) => void, comReceptor = false): void {
    if (stoplist.has(c.alvo)) {
      resultado.descartadas_stoplist++;
      return;
    }
    const aceita = tiposChamavel(tipo);
    let cands = (porNome.get(c.alvo) ?? []).filter((r) => aceita.has(r.sim.tipo));
    if (comReceptor) {
      const metodos = cands.filter((r) => r.sim.tipo === "metodo");
      if (metodos.length > 0) cands = metodos;
      else cands = cands.filter((r) => r.sim.tipo !== "classe" || tipo !== "chama");
    }
    void de;
    if (cands.length === 0) {
      resultado.sem_alvo++;
      return;
    }
    if (cands.length > MAX_CANDIDATOS) {
      resultado.chamadas_ambiguas++;
      return;
    }
    for (const r of cands) emit(r, "heuristica", cands.length);
  }

  resultado.arestas = [...arestas.values()];
  return resultado;
}
