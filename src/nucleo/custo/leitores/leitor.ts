// Leitura incremental de transcripts JSONL (T-10.04/05/07). SÓ este diretório abre arquivos de CLI (e só por caminho que `fontes.ts` já validou).
// Princípios: nunca lança por conteúdo malformado; lê por OFFSET em blocos de 1 MiB (memória estável, sem carregar o arquivo); a última linha incompleta
// fica para o próximo ciclo; linha > 8 MB é pulada e contada; de cada linha sai SÓ `{ts, modelo, tokens, chave, usd_medido?}` — o resto é descartado ali.
import { open } from "node:fs/promises";
import type { RegistroExtraido } from "../../../compartilhado/custo";

export const LINHA_MAX_BYTES = 8 * 1024 * 1024;
export const LOTE_MAX = 500;
const BLOCO = 1024 * 1024;

/** Um leitor de formato: recebe os bytes de UMA linha (visão, sem cópia) e devolve no máximo um registro. Pode guardar estado entre linhas (Codex). */
export interface LeitorFormato {
  linha(bytes: Buffer): RegistroExtraido | null;
  /** estado serializável que permite retomar sem reler (null = não retomável: o arquivo é relido do início, idempotente). */
  estado(): unknown;
}
export interface FabricaLeitor {
  id: "claude" | "codex";
  /** `retomavel:false`: com offset > 0 e sem estado em memória, o executor volta ao início (deduplicação do banco garante a idempotência). */
  criar(estado: unknown): LeitorFormato;
  retomavel: boolean;
}

export interface PedidoLeitura {
  caminho: string;
  offset: number;
  estado?: unknown;
  fabrica: FabricaLeitor;
  loteMax?: number;
}
export interface LoteLido {
  registros: RegistroExtraido[];
  /** offset logo após a última linha COMPLETA já processada. */
  offset: number;
  /** linhas puladas (gigantes) NESTA leitura. */
  puladas: number;
  /** estado do leitor após este lote. */
  estado: unknown;
  tamanho: number;
  mtime_ms: number;
  inode: string;
  /** a leitura voltou ao início (rotação, truncamento ou leitor sem estado). */
  reiniciou: boolean;
  ultimo: boolean;
}

/** Une registros de mesma chave dentro do lote (o Claude Code grava uma linha por bloco com o mesmo `message.id`): fica o MAIOR valor de cada campo. */
export function fundirPorChave(regs: RegistroExtraido[]): RegistroExtraido[] {
  if (regs.length < 2) return regs;
  const por = new Map<string, RegistroExtraido>();
  for (const r of regs) {
    const a = por.get(r.chave);
    if (a === undefined) {
      por.set(r.chave, r);
      continue;
    }
    a.tokens = {
      entrada: Math.max(a.tokens.entrada, r.tokens.entrada),
      cache_escrita: Math.max(a.tokens.cache_escrita, r.tokens.cache_escrita),
      cache_leitura: Math.max(a.tokens.cache_leitura, r.tokens.cache_leitura),
      saida: Math.max(a.tokens.saida, r.tokens.saida),
    };
    if (a.modelo === null && r.modelo !== null) a.modelo = r.modelo;
    if ((a.usd_medido === undefined || a.usd_medido === null) && r.usd_medido !== undefined) a.usd_medido = r.usd_medido;
  }
  return [...por.values()];
}

/** Gerador de lotes (≤ 500 registros). O consumidor decide quando pedir o próximo (backpressure): nada é lido enquanto o lote anterior não foi consumido. */
export async function* lerLotes(p: PedidoLeitura): AsyncGenerator<LoteLido> {
  const loteMax = p.loteMax ?? LOTE_MAX;
  const fh = await open(p.caminho, "r");
  try {
    const st = await fh.stat();
    let offset = p.offset;
    let reiniciou = false;
    if (offset > st.size || (offset > 0 && !p.fabrica.retomavel && p.estado === undefined)) {
      offset = 0;
      reiniciou = true;
    }
    const leitor = p.fabrica.criar(reiniciou || offset === 0 ? undefined : p.estado);
    const meta = { tamanho: st.size, mtime_ms: Math.trunc(st.mtimeMs), inode: String(st.ino) };
    const bloco = Buffer.allocUnsafe(BLOCO);
    let carry: Buffer = Buffer.alloc(0);
    let descartando = false;
    let posBloco = offset; // offset do primeiro byte de `carry`+bloco
    let regs: RegistroExtraido[] = [];
    let puladas = 0;
    let offsetLinhas = offset;

    for (;;) {
      const { bytesRead } = await fh.read(bloco, 0, BLOCO, posBloco + carry.length);
      if (bytesRead === 0) break;
      const dados = carry.length === 0 ? bloco.subarray(0, bytesRead) : Buffer.concat([carry, bloco.subarray(0, bytesRead)]);
      let ini = 0;
      for (;;) {
        const nl = dados.indexOf(10, ini);
        if (nl < 0) break;
        if (descartando) {
          descartando = false;
        } else if (nl - ini > LINHA_MAX_BYTES) {
          puladas++;
        } else if (nl > ini) {
          let r: RegistroExtraido | null = null;
          try {
            r = leitor.linha(dados.subarray(ini, nl));
          } catch {
            r = null;
          }
          if (r !== null) regs.push(r);
        }
        ini = nl + 1;
        offsetLinhas = posBloco + ini;
        if (regs.length >= loteMax) {
          yield { registros: fundirPorChave(regs), offset: offsetLinhas, puladas, estado: leitor.estado(), ...meta, reiniciou, ultimo: false };
          regs = [];
          puladas = 0;
          reiniciou = false;
        }
      }
      const resto = dados.length - ini;
      if (!descartando && resto > LINHA_MAX_BYTES) {
        descartando = true;
        puladas++;
        carry = Buffer.alloc(0);
        posBloco = posBloco + dados.length; // descarta o resto da linha gigante; o offset só avança no próximo '\n'
        continue;
      }
      if (descartando) {
        carry = Buffer.alloc(0);
        posBloco = posBloco + dados.length;
        continue;
      }
      carry = resto > 0 ? Buffer.from(dados.subarray(ini)) : Buffer.alloc(0);
      posBloco = posBloco + ini;
    }
    yield { registros: fundirPorChave(regs), offset: offsetLinhas, puladas, estado: leitor.estado(), ...meta, reiniciou, ultimo: true };
  } finally {
    await fh.close();
  }
}
