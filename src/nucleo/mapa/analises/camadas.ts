import { niveisTopologicos } from "../grafo/camadas";
import { ciclos, componentesFortes } from "../grafo/ciclos";
import { construirGrafo } from "../grafo/memoria";
import { avaliarRegras, type RegraFronteira, type ViolacaoFronteira } from "../regras-fronteira";
import { pastaDe } from "./tipos";

// Camadas e regras de fronteira (T-17.25): camadas INFERIDAS pelos níveis da condensação do DAG de módulos, camadas MANUAIS
// (`camadas.json`, editáveis na UI), violações por regra importada (com `arquivo:linha` da regra e da importação) e a matriz DSM.
// Puro: recebe as importações entre arquivos já resolvidas.

export interface ImportacaoArquivo {
  /** Caminhos relativos. */
  de: string;
  para: string;
  linha?: number | null;
}

export interface CamadaManual {
  nome: string;
  /** Maior = mais alta (depende das mais baixas). */
  nivel: number;
  /** Pastas/módulos (prefixos relativos) que pertencem à camada. */
  pastas: string[];
}

export interface ModuloCamada {
  modulo: string;
  /** Nível inferido: 0 = base (não depende de nenhum outro módulo). Módulos em ciclo compartilham o nível. */
  camada: number;
  /** Camada manual, quando houver. */
  camada_manual: string | null;
  ca: number;
  ce: number;
  instabilidade: number;
  /** Número do ciclo (SCC com 2+ módulos), ou null. */
  ciclo_id: number | null;
  arquivos: number;
}

export interface ViolacaoCandidata {
  /** `inferida` (aresta menor-peso de um ciclo entre módulos) ou `manual` (camada baixa dependendo de camada alta). */
  origem: "inferida" | "manual";
  de_modulo: string;
  para_modulo: string;
  /** Importações que sustentam a aresta (`arquivo:linha`), até 5. */
  evidencias: string[];
  motivo: string;
}

export interface Dsm {
  /** Módulos ordenados da camada mais alta para a mais baixa. */
  modulos: string[];
  /** `celulas[i][j]` = importações do módulo i para o módulo j (linha depende da coluna). */
  celulas: number[][];
}

export interface ResultadoCamadas {
  modulos: ModuloCamada[];
  ciclos: Array<{ id: number; modulos: string[]; quebrar: Array<{ de: string; para: string; peso: number }> }>;
  violacoes_candidatas: ViolacaoCandidata[];
  /** Violações de regras importadas (deptrac, import-linter, dependency-cruiser, Packwerk). */
  violacoes_regras: ViolacaoFronteira[];
  dsm: Dsm;
}

export interface OpcoesCamadas {
  /** Todos os arquivos do projeto e seu módulo (padrão: a pasta do arquivo). */
  arquivos: ReadonlyArray<{ caminho: string; modulo?: string }>;
  importacoes: readonly ImportacaoArquivo[];
  regras?: readonly RegraFronteira[];
  manuais?: readonly CamadaManual[];
}

export function calcularCamadas(op: OpcoesCamadas): ResultadoCamadas {
  const moduloDe = new Map<string, string>();
  const contagem = new Map<string, number>();
  for (const a of op.arquivos) {
    const m = a.modulo ?? pastaDe(a.caminho);
    moduloDe.set(a.caminho, m);
    contagem.set(m, (contagem.get(m) ?? 0) + 1);
  }
  // aresta entre módulos + evidências
  const pesos = new Map<string, { de: string; para: string; peso: number; evid: string[] }>();
  for (const i of op.importacoes) {
    const de = moduloDe.get(i.de);
    const para = moduloDe.get(i.para);
    if (de === undefined || para === undefined || de === para) continue;
    const k = `${de}\0${para}`;
    const e = pesos.get(k) ?? { de, para, peso: 0, evid: [] };
    e.peso++;
    if (e.evid.length < 5) e.evid.push(`${i.de}:${i.linha ?? 1}`);
    pesos.set(k, e);
  }
  const modulos = [...contagem.keys()].sort();
  const g = construirGrafo(modulos, [...pesos.values()].map((e) => ({ de: e.de, para: e.para, tipo: "importa", peso: e.peso })));
  const scc = componentesFortes(g);
  const niveis = niveisTopologicos(g, scc);
  const cs = ciclos(g, scc);
  const cicloDe = new Map<number, number>();
  cs.forEach((c, idx) => c.nos.forEach((n) => cicloDe.set(n, idx + 1)));

  const manualDe = (m: string): CamadaManual | null => {
    let melhor: CamadaManual | null = null;
    let tam = -1;
    for (const c of op.manuais ?? []) {
      for (const p of c.pastas) {
        const norma = p.replace(/\/$/, "");
        if ((m === norma || m.startsWith(`${norma}/`)) && norma.length > tam) {
          melhor = c;
          tam = norma.length;
        }
      }
    }
    return melhor;
  };

  const linhas: ModuloCamada[] = modulos.map((m) => {
    const i = g.indice(m);
    const ca = g.grauEntrada(i);
    const ce = g.grauSaida(i);
    return { modulo: m, camada: niveis.nivel[i] as number, camada_manual: manualDe(m)?.nome ?? null, ca, ce, instabilidade: ca + ce === 0 ? 0 : Math.round((ce / (ca + ce)) * 1000) / 1000, ciclo_id: cicloDe.get(i) ?? null, arquivos: contagem.get(m) ?? 0 };
  });

  const candidatas: ViolacaoCandidata[] = [];
  for (const c of cs) {
    for (const q of c.quebrar) {
      const de = g.ids[q.de] as string;
      const para = g.ids[q.para] as string;
      candidatas.push({ origem: "inferida", de_modulo: de, para_modulo: para, evidencias: pesos.get(`${de}\0${para}`)?.evid ?? [], motivo: `ciclo entre ${c.tamanho} módulos: aresta de menor peso (${q.peso} importações), candidata a quebrar` });
    }
  }
  for (const e of pesos.values()) {
    const a = manualDe(e.de);
    const b = manualDe(e.para);
    if (a !== null && b !== null && a.nivel < b.nivel) {
      candidatas.push({ origem: "manual", de_modulo: e.de, para_modulo: e.para, evidencias: e.evid, motivo: `camada ${a.nome} (nível ${a.nivel}) depende de ${b.nome} (nível ${b.nivel}), que é mais alta` });
    }
  }
  candidatas.sort((x, y) => x.origem.localeCompare(y.origem) || x.de_modulo.localeCompare(y.de_modulo) || x.para_modulo.localeCompare(y.para_modulo));

  const ordenados = [...linhas].sort((x, y) => y.camada - x.camada || x.modulo.localeCompare(y.modulo));
  const pos = new Map(ordenados.map((m, i) => [m.modulo, i]));
  const celulas = ordenados.map(() => new Array<number>(ordenados.length).fill(0));
  for (const e of pesos.values()) (celulas[pos.get(e.de) as number] as number[])[pos.get(e.para) as number] = e.peso;

  const violacoesRegras = avaliarRegras(op.regras ?? [], op.importacoes.map((i) => ({ de: i.de, para: i.para, linha: i.linha ?? null })));
  return {
    modulos: linhas,
    ciclos: cs.map((c, idx) => ({ id: idx + 1, modulos: c.nos.map((n) => g.ids[n] as string), quebrar: c.quebrar.map((q) => ({ de: g.ids[q.de] as string, para: g.ids[q.para] as string, peso: q.peso })) })),
    violacoes_candidatas: candidatas,
    violacoes_regras: violacoesRegras,
    dsm: { modulos: ordenados.map((m) => m.modulo), celulas },
  };
}
