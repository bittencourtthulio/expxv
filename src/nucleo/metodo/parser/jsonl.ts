import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EventoRastro } from "../tipos";

export interface LeituraJsonl {
  eventos: EventoRastro[];
  /** offset em bytes logo após a última linha COMPLETA processada. */
  offset: number;
  invalidas: number;
}

/** Teto de bytes lidos de um JSONL de uma vez (a cauda). */
export const LIMITE_LEITURA_JSONL = 8 * 1024 * 1024;

const VAZIO: LeituraJsonl = { eventos: [], offset: 0, invalidas: 0 };

function paraEvento(valor: unknown): EventoRastro | null {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) return null;
  const o = valor as Record<string, unknown>;
  if (typeof o.ts !== "string" || typeof o.evento !== "string" || typeof o.trabalho_id !== "string") return null;
  const texto = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return {
    ...o,
    ts: o.ts,
    expx_eventos: typeof o.expx_eventos === "number" ? o.expx_eventos : 1,
    trabalho_id: o.trabalho_id,
    ferramenta: texto(o.ferramenta) ?? "",
    origem: texto(o.origem) ?? "",
    evento: o.evento,
    fase: texto(o.fase),
    task: texto(o.task),
    agente: texto(o.agente),
    resultado: texto(o.resultado) ?? "",
    detalhe: texto(o.detalhe) ?? "",
    arquivos: Array.isArray(o.arquivos) ? o.arquivos.filter((x): x is string => typeof x === "string") : [],
  };
}

/**
 * Lê um JSONL a partir de um offset de bytes. Só consome linhas completas (terminadas em \n): a
 * última linha, se incompleta, fica adiada para a próxima leitura. Arquivo que encolheu foi
 * reescrito: recomeça do zero. Nunca lança.
 */
export async function lerJsonlDesde(caminho: string, offsetInicial: number, teto = LIMITE_LEITURA_JSONL): Promise<LeituraJsonl> {
  try {
    const info = await stat(caminho);
    let inicio = Math.max(0, offsetInicial);
    if (info.size < inicio) inicio = 0;
    if (info.size === inicio) return { eventos: [], offset: inicio, invalidas: 0 };
    // AUD-12: nunca aloca mais que o teto. Arquivo maior: só a cauda; a primeira linha (cortada) é descartada.
    let descartarPrimeiraLinha = false;
    if (info.size - inicio > teto) { inicio = info.size - teto; descartarPrimeiraLinha = true; }

    const fd = await open(caminho, "r");
    let buf: Buffer;
    try {
      const tamanho = info.size - inicio;
      buf = Buffer.alloc(tamanho);
      let lidos = 0;
      while (lidos < tamanho) {
        const { bytesRead } = await fd.read(buf, lidos, tamanho - lidos, inicio + lidos);
        if (bytesRead === 0) break;
        lidos += bytesRead;
      }
      buf = buf.subarray(0, lidos);
    } finally {
      await fd.close();
    }

    if (descartarPrimeiraLinha) {
      const primeira = buf.indexOf(0x0a);
      if (primeira < 0) return { eventos: [], offset: info.size, invalidas: 0 }; // uma linha só, maior que o teto: ignorada
      buf = buf.subarray(primeira + 1);
      inicio += primeira + 1;
    }
    const ultimaQuebra = buf.lastIndexOf(0x0a);
    if (ultimaQuebra < 0) return { eventos: [], offset: inicio, invalidas: 0 };
    let texto = buf.subarray(0, ultimaQuebra + 1).toString("utf8");
    if (inicio === 0 && texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);

    const eventos: EventoRastro[] = [];
    let invalidas = 0;
    for (const linha of texto.split("\n")) {
      const t = linha.trim();
      if (t === "") continue;
      try {
        const ev = paraEvento(JSON.parse(t));
        if (ev) eventos.push(ev);
        else invalidas++;
      } catch {
        invalidas++;
      }
    }
    return { eventos, offset: inicio + ultimaQuebra + 1, invalidas };
  } catch {
    return { ...VAZIO, eventos: [] };
  }
}

function pertenceAoTrabalho(nome: string, id: string): boolean {
  if (nome === `${id}.jsonl`) return true;
  if (!nome.startsWith(`${id}.`) || !nome.endsWith(".jsonl")) return false;
  return /^\d+$/.test(nome.slice(id.length + 1, -".jsonl".length));
}

/** Lê o corrente e todos os rotacionados (`<id>.N.jsonl`) de um trabalho, em ordem de `ts`. */
export async function lerRastroDoTrabalho(dirEventos: string, trabalhoId: string): Promise<{ eventos: EventoRastro[]; invalidas: number }> {
  let nomes: string[] = [];
  try {
    nomes = (await readdir(dirEventos)).filter((n) => pertenceAoTrabalho(n, trabalhoId));
  } catch {
    return { eventos: [], invalidas: 0 };
  }
  const leituras = await Promise.all(nomes.map((n) => lerJsonlDesde(join(dirEventos, n), 0)));
  const eventos = leituras.flatMap((l) => l.eventos);
  // ordenação estável: empates mantêm a ordem de leitura
  eventos.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return { eventos, invalidas: leituras.reduce((s, l) => s + l.invalidas, 0) };
}

export interface TailJsonl {
  lerNovos(caminho: string): Promise<EventoRastro[]>;
  offsetDe(caminho: string): number;
  esquecer(caminho: string): void;
}

/** Tail por offset: cada chamada devolve só o que foi acrescentado desde a anterior. */
export function criarTailJsonl(): TailJsonl {
  const offsets = new Map<string, number>();
  return {
    async lerNovos(caminho) {
      const r = await lerJsonlDesde(caminho, offsets.get(caminho) ?? 0);
      offsets.set(caminho, r.offset);
      return r.eventos;
    },
    offsetDe: (c) => offsets.get(c) ?? 0,
    esquecer: (c) => void offsets.delete(c),
  };
}
