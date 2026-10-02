// Dedupe de aprendizados: hash do texto normalizado; quase-duplicata por trigramas de caracteres (≥ 0,80) funde (`vezes_visto++`,
// proveniência anexada, ≤ 10). (O cosseno ≥ 0,92 de modelo real entra por `similar` injetado pelo serviço quando houver modelo real.)
import { COSSENO_QUASE_DUPLICATA, TRIGRAMA_QUASE_DUPLICATA } from "../constantes";
import { idLocal, sha256 } from "../ids";
import { limparParaSaida } from "../seguranca";
import { redigir } from "../chunking/comum";
import type { AprendizadoLinha, Repos } from "../repos";
import type { CandidatoAprendizado, DocumentoEntrada, Proveniencia } from "../tipos";
import { estadoInicial } from "./extrair";

export const normalizarTexto = (t: string): string => t.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function trigramas(t: string): Set<string> {
  const n = ` ${normalizarTexto(t)} `;
  const s = new Set<string>();
  for (let i = 0; i + 3 <= n.length; i++) s.add(n.slice(i, i + 3));
  return s;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [p, g] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of p) if (g.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface ResultadoRegistro {
  status: "candidate" | "active" | "merged";
  id: string;
  novo: boolean;
  merged_into?: string;
  /** documento a indexar (o aprendizado é buscável como chunk único). */
  documento?: DocumentoEntrada;
}

export interface OpcoesRegistro {
  quando: string;
  /** tipo do documento de origem (relatório do método → nasce ativo). */
  origemTipo?: string | null;
  scrubber?: { scrub(t: string): string };
  /** similaridade vetorial (modelo real): devolve o id do aprendizado com cosseno ≥ 0,92, se houver. */
  similarVetorial?: (texto: string) => string | null;
}

const MAX_PROV = 10;

function anexarProveniencia(atual: string, nova: Proveniencia): string {
  let lista: Proveniencia[] = [];
  try {
    lista = JSON.parse(atual) as Proveniencia[];
  } catch {
    lista = [];
  }
  const chave = (p: Proveniencia): string => `${p.origem ?? ""}|${p.pane_id ?? ""}|${p.commit ?? ""}|${p.em}`;
  if (!lista.some((p) => chave(p) === chave(nova))) lista.push(nova);
  return JSON.stringify(lista.slice(-MAX_PROV));
}

const RANK_ESTADO: Record<string, number> = { arquivado: 0, candidato: 1, ativo: 2, rejeitado: -1 };

export function registrarAprendizado(repos: Repos, colecao_id: string, c: CandidatoAprendizado, op: OpcoesRegistro): ResultadoRegistro {
  const redOp = op.scrubber ? { scrubber: op.scrubber } : {};
  const texto = redigir(c.texto, redOp).slice(0, 1000);
  const tit = limparParaSaida(c.titulo, 120, redOp);
  const hash = sha256(`${c.tipo}\n${normalizarTexto(texto)}`);
  const inicial = estadoInicial(c, op.origemTipo ?? null);

  const fundir = (ex: AprendizadoLinha): ResultadoRegistro => {
    const novoEstado = (RANK_ESTADO[inicial] ?? 0) > (RANK_ESTADO[ex.estado] ?? 0) && ex.estado !== "rejeitado" && ex.estado !== "arquivado" ? inicial : ex.estado;
    repos.aprendizado.atualizar(ex.id, { vezes_visto: ex.vezes_visto + 1, proveniencia_json: anexarProveniencia(ex.proveniencia_json, c.proveniencia), estado: novoEstado as AprendizadoLinha["estado"] });
    return { status: "merged", id: ex.id, novo: false, merged_into: ex.id };
  };

  const igual = repos.aprendizado.porHash(colecao_id, hash);
  if (igual) return fundir(igual);

  const rep = repos.aprendizado.listar(colecao_id, { tipo: c.tipo, limite: 500 }).filter((a) => a.estado === "candidato" || a.estado === "ativo");
  if (op.similarVetorial) {
    const id = op.similarVetorial(texto);
    const ex = id ? rep.find((a) => a.id === id) : undefined;
    if (ex) return fundir(ex);
  }
  const tg = trigramas(texto);
  for (const a of rep) if (jaccard(tg, trigramas(a.texto)) >= TRIGRAMA_QUASE_DUPLICATA) return fundir(a);
  void COSSENO_QUASE_DUPLICATA;

  const id = idLocal("apr", Date.parse(op.quando) || undefined);
  repos.aprendizado.inserir({
    id,
    colecao_id,
    documento_id: null,
    tipo: c.tipo,
    titulo: tit,
    texto,
    fonte: c.fonte,
    estado: inicial,
    confianca: inicial === "ativo" ? 0.8 : 0.5,
    hash,
    proveniencia_json: JSON.stringify([c.proveniencia]),
    substitui_id: null,
    quando: op.quando,
  });
  const documento: DocumentoEntrada = {
    tipo: "aprendizado",
    origem: `aprendizado:${hash.slice(0, 16)}`,
    titulo: tit,
    texto: `${tit}\n\n${texto}`,
    formato: "evento",
    fonte: c.fonte,
    ocorrido_em: op.quando,
    mission_id: c.proveniencia.mission_id,
    task_ref: c.proveniencia.task_ref,
    pane_id: c.proveniencia.pane_id,
    cli: c.proveniencia.cli,
    modelo_autor: c.proveniencia.modelo,
    importancia: 4,
    arquivos: c.arquivos,
  };
  return { status: inicial === "ativo" ? "active" : "candidate", id, novo: true, documento };
}
