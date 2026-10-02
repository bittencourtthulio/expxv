import type { Confianca, Linguagem } from "../tipos";
import { idArquivo, idSimbolo, type ArquivoMapa } from "./tipos";

// Código morto CANDIDATO (T-17.27). Nunca "remover": a saída é sempre "candidato" (Camada 10 do legadox).

export const ROTULO_CANDIDATO = "candidato a código morto (verificar antes de qualquer remoção)";

export interface ArestaUso {
  tipo: string;
  de: string;
  para: string;
  confianca: Confianca;
}

export interface EntradaMorto {
  arquivos: readonly ArquivoMapa[];
  /** Todas as arestas do grafo (só as de uso contam). */
  arestas: readonly ArestaUso[];
  /** Ids de entradas e dos arquivos que as declaram. */
  caminhosDeEntrada?: ReadonlySet<string>;
  /** Handlers de entrada (ids de símbolo). */
  handlers?: ReadonlySet<string>;
  /** API pública do pacote (arquivos exportados por manifesto, `main`, `exports`, barrel público). */
  apiPublica?: ReadonlySet<string>;
  /** Arquivos citados por configuração (webpack, tsconfig, manifestos, workflows). */
  referenciadosPorConfig?: ReadonlySet<string>;
  /** Idade em dias por arquivo (do git); ausente = desconhecida. */
  idadeDias?: ReadonlyMap<string, number>;
}

export type ConfiancaMorto = "alta" | "media" | "baixa";

export interface CandidatoMorto {
  id: string;
  tipo: "arquivo" | "simbolo";
  caminho: string;
  linha: number | null;
  confianca: ConfiancaMorto;
  motivos: string[];
  rotulo: typeof ROTULO_CANDIDATO;
}

const USO_ARQUIVO = new Set(["importa", "reexporta"]);
const USO_SIMBOLO = new Set(["chama", "instancia", "herda", "implementa", "referencia", "aciona"]);
const NIVEL: ConfiancaMorto[] = ["baixa", "media", "alta"];
const TIPOS_SIMBOLO_CANDIDATO = new Set(["funcao", "classe", "constante", "tipo", "enum", "interface", "struct", "trait"]);

export function candidatosMortos(e: EntradaMorto): CandidatoMorto[] {
  const dinamicos = new Set<Linguagem>();
  for (const a of e.arquivos) if (a.extracao.dinamicos.length > 0) dinamicos.add(a.extracao.linguagem);
  const usoExata = new Map<string, number>();
  const usoHeur = new Map<string, number>();
  for (const a of e.arestas) {
    if (!USO_ARQUIVO.has(a.tipo) && !USO_SIMBOLO.has(a.tipo)) continue;
    if (a.de === a.para) continue;
    const m = a.confianca === "exata" ? usoExata : usoHeur;
    m.set(a.para, (m.get(a.para) ?? 0) + 1);
  }
  const saida: CandidatoMorto[] = [];
  const nivel = (heur: boolean, caminho: string, ling: Linguagem): { nivel: number; motivos: string[] } => {
    let n = 2;
    const motivos: string[] = ["sem referência exata no grafo"];
    if (heur) {
      n--;
      motivos.push("há referência heurística (por nome)");
    }
    if (dinamicos.has(ling)) {
      n--;
      motivos.push(`${ling} usa recurso dinâmico (reflexão/eval) no projeto`);
    }
    const idade = e.idadeDias?.get(caminho);
    if (idade === undefined || idade <= 365) {
      n--;
      motivos.push(idade === undefined ? "idade desconhecida" : "alterado no último ano");
    }
    return { nivel: Math.max(0, n), motivos };
  };
  for (const a of e.arquivos) {
    const x = a.extracao;
    if (x.e_teste || x.e_gerado) continue;
    if (e.caminhosDeEntrada?.has(a.caminho) || e.apiPublica?.has(a.caminho) || e.referenciadosPorConfig?.has(a.caminho)) continue;
    const id = idArquivo(a.caminho);
    if ((usoExata.get(id) ?? 0) > 0) continue;
    const r = nivel((usoHeur.get(id) ?? 0) > 0, a.caminho, x.linguagem);
    saida.push({ id, tipo: "arquivo", caminho: a.caminho, linha: null, confianca: NIVEL[r.nivel] as ConfiancaMorto, motivos: r.motivos, rotulo: ROTULO_CANDIDATO });
  }
  const arquivosMortos = new Set(saida.map((c) => c.id));
  for (const a of e.arquivos) {
    const x = a.extracao;
    if (x.e_teste || x.e_gerado || e.caminhosDeEntrada?.has(a.caminho) || e.referenciadosPorConfig?.has(a.caminho)) continue;
    for (const s of x.simbolos) {
      if (!TIPOS_SIMBOLO_CANDIDATO.has(s.tipo)) continue;
      if (s.decoradores.length > 0) continue; // framework pode ligar por decorador
      if (s.exportado && e.apiPublica?.has(a.caminho)) continue;
      const id = idSimbolo(a.caminho, s.qualificado);
      if (e.handlers?.has(id)) continue;
      if ((usoExata.get(id) ?? 0) > 0) continue;
      // símbolo de arquivo já candidato: o arquivo é o achado; não repetir símbolo a símbolo
      if (arquivosMortos.has(idArquivo(a.caminho))) continue;
      // exportado e importado por nome em outro arquivo? (binding sem chamada) conta como uso do arquivo, não do símbolo: segue candidato
      const r = nivel((usoHeur.get(id) ?? 0) > 0, a.caminho, x.linguagem);
      saida.push({ id, tipo: "simbolo", caminho: a.caminho, linha: s.linha, confianca: NIVEL[r.nivel] as ConfiancaMorto, motivos: r.motivos, rotulo: ROTULO_CANDIDATO });
    }
  }
  const ordem: Record<ConfiancaMorto, number> = { alta: 0, media: 1, baixa: 2 };
  saida.sort((x, y) => ordem[x.confianca] - ordem[y.confianca] || x.caminho.localeCompare(y.caminho) || (x.linha ?? 0) - (y.linha ?? 0));
  return saida;
}
