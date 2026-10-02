import { stat } from "node:fs/promises";
import { join } from "node:path";
import { descobrir } from "./descoberta";
import { montarTrabalhos } from "./modelo";
import { criarTailJsonl } from "./parser/jsonl";
import { lerArtefato } from "./parser/leitores";
import type { Artefato, CamadaComData, EventoRastro, IndiceProjeto, Rejeicao } from "./tipos";

export interface OpcoesIndexador {
  /** relógio injetado (epoch ms). */
  agora?: () => number;
  diasBloqueio?: number;
}

export interface Indexador {
  /** indexa (releitura TOTAL do projeto) e devolve o índice. Nunca lança. */
  indexar(raiz: string): Promise<IndiceProjeto>;
  /** libera o estado incremental (offsets, cache) de uma raiz. */
  descartar(raiz: string): void;
}

const CONCORRENCIA = 32;
const TETO_EVENTOS_POR_ARQUIVO = 5000;

interface EstadoRaiz {
  tail: ReturnType<typeof criarTailJsonl>;
  eventosPorArquivo: Map<string, EventoRastro[]>;
  ultimoBom: Map<string, Artefato>;
}

async function emLotes<T, R>(itens: T[], limite: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const saida = new Array<R>(itens.length);
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    for (;;) {
      const i = proximo++;
      if (i >= itens.length) return;
      saida[i] = await fn(itens[i] as T);
    }
  });
  await Promise.all(trabalhadores);
  return saida;
}

/** Arquivo de cada camada de contexto (relativo à raiz); só estas cinco têm data. */
const ARQUIVO_DA_CAMADA: Readonly<Record<CamadaComData, string>> = {
  convencoes: "docs/stack/CONVENCOES.md",
  perfil_legado: "docs/legado/PERFIL.md",
  design_system: "docs/design-system/DESIGN-SYSTEM.md",
  produto: "docs/produto/PRODUTO.md",
  memoria: ".expx/memoria/indice.json",
};

/** Um `stat` por camada presente (barato, só nos arquivos já descobertos). Nunca lança: falha vira "sem data". */
async function datasDasCamadas(raiz: string, presentes: Readonly<Record<CamadaComData, boolean>>): Promise<Partial<Record<CamadaComData, string>>> {
  const saida: Partial<Record<CamadaComData, string>> = {};
  await Promise.all(
    (Object.keys(ARQUIVO_DA_CAMADA) as CamadaComData[]).filter((c) => presentes[c]).map(async (c) => {
      try {
        saida[c] = (await stat(join(raiz, ...ARQUIVO_DA_CAMADA[c].split("/")))).mtime.toISOString();
      } catch {
        /* sem data */
      }
    }),
  );
  return saida;
}

function vazio(raiz: string, agora: number, t0: number): IndiceProjeto {
  return {
    raiz,
    gerado_em: new Date(agora).toISOString(),
    duracao_ms: Math.round(performance.now() - t0),
    trabalhos: [],
    violacoes: [],
    rejeicoes: [],
    avisos: [],
    camadas: { convencoes: false, perfil_legado: false, design_system: false, produto: false, hooks: false, lock: false, memoria: false },
    artefatos_lidos: 0,
  };
}

export function criarIndexador(opcoes: OpcoesIndexador = {}): Indexador {
  const relogio = opcoes.agora ?? Date.now;
  const estados = new Map<string, EstadoRaiz>();
  const estadoDe = (raiz: string): EstadoRaiz => {
    let e = estados.get(raiz);
    if (!e) {
      e = { tail: criarTailJsonl(), eventosPorArquivo: new Map(), ultimoBom: new Map() };
      estados.set(raiz, e);
    }
    return e;
  };

  return {
    descartar: (raiz) => void estados.delete(raiz),

    async indexar(raiz) {
      const t0 = performance.now();
      const agora = relogio();
      try {
        const est = estadoDe(raiz);
        const d = await descobrir(raiz);

        // rastro: tail por offset, acumulado por arquivo (rotação = arquivos distintos)
        const vivos = new Set(d.eventos);
        for (const f of [...est.eventosPorArquivo.keys()]) {
          if (!vivos.has(f)) {
            est.eventosPorArquivo.delete(f);
            est.tail.esquecer(join(raiz, ...f.split("/")));
          }
        }
        await emLotes(d.eventos, CONCORRENCIA, async (f) => {
          const novos = await est.tail.lerNovos(join(raiz, ...f.split("/")));
          if (novos.length === 0 && est.eventosPorArquivo.has(f)) return;
          const acum = (est.eventosPorArquivo.get(f) ?? []).concat(novos);
          est.eventosPorArquivo.set(f, acum.length > TETO_EVENTOS_POR_ARQUIVO ? acum.slice(-TETO_EVENTOS_POR_ARQUIVO) : acum);
        });
        const eventos = new Map<string, EventoRastro[]>();
        for (const lista of est.eventosPorArquivo.values()) {
          for (const e of lista) {
            const l = eventos.get(e.trabalho_id);
            if (l) l.push(e);
            else eventos.set(e.trabalho_id, [e]);
          }
        }

        // artefatos: tudo o que a descoberta listou
        const caminhos = [
          ...new Set([
            ...d.trabalhos.flatMap((t) => t.arquivos),
            ...d.projeto,
            ...d.entregas.flatMap((e) => e.arquivos),
            ...d.camadas,
            ...d.relatorios,
          ]),
        ];
        const lidos = await emLotes(caminhos, CONCORRENCIA, (c) => lerArtefato(raiz, c));
        const artefatos = new Map<string, Artefato>();
        const avisos: string[] = [];
        const rejeicoes: Rejeicao[] = [];
        const presentes = new Set(caminhos);
        for (const c of [...est.ultimoBom.keys()]) if (!presentes.has(c)) est.ultimoBom.delete(c);
        for (const a of lidos) {
          let uso = a;
          let substituido = false;
          if (a.rejeicao === "yaml_invalido" && est.ultimoBom.has(a.caminho)) {
            substituido = true;
            // gravação em andamento: a UI não pisca, segue com a última leitura válida
            uso = est.ultimoBom.get(a.caminho) as Artefato;
            avisos.push(`${a.caminho}: frontmatter ilegivel agora (gravacao em andamento?); usando a ultima leitura valida`);
          } else {
            avisos.push(...a.avisos);
            if (a.dados !== null) est.ultimoBom.set(a.caminho, a);
          }
          if (a.rejeicao !== null && !substituido) rejeicoes.push({ caminho: a.caminho, motivo: a.rejeicao });
          artefatos.set(a.caminho, uso);
        }

        const camadas = {
          convencoes: d.camadas.includes("docs/stack/CONVENCOES.md"),
          perfil_legado: d.camadas.includes("docs/legado/PERFIL.md"),
          design_system: d.camadas.includes("docs/design-system/DESIGN-SYSTEM.md"),
          produto: d.camadas.includes("docs/produto/PRODUTO.md"),
          hooks: d.config.hooks,
          lock: d.config.lock,
          memoria: d.config.memoria,
        };
        const trabalhos = montarTrabalhos({ descoberta: d, artefatos, eventos, agora, ...(opcoes.diasBloqueio === undefined ? {} : { diasBloqueio: opcoes.diasBloqueio }) });
        return {
          raiz,
          gerado_em: new Date(agora).toISOString(),
          duracao_ms: Math.round(performance.now() - t0),
          trabalhos,
          violacoes: trabalhos.flatMap((t) => t.violacoes),
          rejeicoes,
          avisos,
          camadas,
          camadas_mtime: await datasDasCamadas(raiz, camadas),
          artefatos_lidos: lidos.length,
        };
      } catch (erro) {
        const r = vazio(raiz, agora, t0);
        r.avisos.push(`falha ao indexar ${raiz}: ${erro instanceof Error ? erro.message : String(erro)}`);
        return r;
      }
    },
  };
}

/** Indexação sem estado (uma vez só). É a função que o worker executa a frio. */
export function indexarProjeto(raiz: string, opcoes: OpcoesIndexador = {}): Promise<IndiceProjeto> {
  return criarIndexador(opcoes).indexar(raiz);
}

export interface Conjunto {
  /** alinha o conjunto à lista de raízes (saída de `git worktree list`): indexa as novas, descarta as removidas. */
  sincronizar(raizes: string[]): Promise<{ entraram: string[]; sairam: string[]; indices: IndiceProjeto[] }>;
  reindexar(raiz: string): Promise<IndiceProjeto | undefined>;
  obter(raiz: string): IndiceProjeto | undefined;
  raizes(): string[];
}

/** Um indexador (estado incremental) por worktree. */
export function criarConjunto(opcoes: OpcoesIndexador = {}): Conjunto {
  const indexadores = new Map<string, Indexador>();
  const indices = new Map<string, IndiceProjeto>();
  const de = (raiz: string): Indexador => {
    let i = indexadores.get(raiz);
    if (!i) {
      i = criarIndexador(opcoes);
      indexadores.set(raiz, i);
    }
    return i;
  };
  return {
    async sincronizar(raizes) {
      const alvo = [...new Set(raizes)];
      const sairam = [...indices.keys()].filter((r) => !alvo.includes(r));
      for (const r of sairam) {
        indexadores.get(r)?.descartar(r);
        indexadores.delete(r);
        indices.delete(r);
      }
      const entraram = alvo.filter((r) => !indices.has(r));
      await Promise.all(entraram.map(async (r) => void indices.set(r, await de(r).indexar(r))));
      return { entraram, sairam, indices: alvo.map((r) => indices.get(r)).filter((x): x is IndiceProjeto => x !== undefined) };
    },
    async reindexar(raiz) {
      if (!indices.has(raiz)) return undefined;
      const novo = await de(raiz).indexar(raiz);
      indices.set(raiz, novo);
      return novo;
    },
    obter: (raiz) => indices.get(raiz),
    raizes: () => [...indices.keys()],
  };
}
