// Download verificado do artefato (Fase 21, T-21.14, AU-03/14): sha512 em STREAMING, teto de bytes = `tamanho` do manifesto assinado,
// arquivo parcial apagado em qualquer falha ou cancelamento, progresso coalescido (≤ 4 eventos/s, P-156). Nunca bloqueia o event loop:
// só leitura/escrita assíncrona em pedaços. Erros só por código nominal; caminho e URL jamais em mensagem.
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { createReadStream } from "node:fs";
import type { ArtefatoAtualizacao } from "../../../compartilhado/atualizacao";
import { AtualizacaoErro, motivoDeErro } from "./erros";
import type { Transporte } from "./transporte";

export interface PedidoDownload {
  transporte: Transporte;
  /** caminho-base do feed (do build), ex.: "/". */
  caminhoBase: string;
  artefato: ArtefatoAtualizacao;
  /** pasta de destino (userData/updates). */
  destinoDir: string;
  onProgresso?: (fracao: number) => void;
  sinal?: AbortSignal;
  /** relógio injetável (ms) para o coalescimento do progresso. */
  agoraMs?: () => number;
  ociosoMs?: number;
}
export interface ArquivoVerificado {
  caminho: string;
  bytes: number;
  sha512: string;
}

const NOME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const iguaisHex = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));

function nomeDoArquivo(a: ArtefatoAtualizacao): string {
  const nome = basename(a.url_relativa);
  if (!NOME_OK.test(nome)) throw new AtualizacaoErro("manifesto_invalido");
  return nome;
}

export async function baixarEVerificar(p: PedidoDownload): Promise<ArquivoVerificado> {
  const nome = nomeDoArquivo(p.artefato);
  const base = p.caminhoBase.endsWith("/") ? p.caminhoBase : `${p.caminhoBase}/`;
  const final = join(p.destinoDir, nome);
  const parcial = `${final}.parcial`;
  const agora = p.agoraMs ?? Date.now;
  const abortado = (): boolean => p.sinal?.aborted === true;
  await mkdir(p.destinoDir, { recursive: true, mode: 0o700 });
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  let resposta: Awaited<ReturnType<Transporte["stream"]>> | null = null;
  const hash = createHash("sha512");
  let recebidos = 0;
  let ultimoProgresso = -Infinity;
  const limpar = async (): Promise<void> => {
    try {
      resposta?.cancelar();
    } catch {
      /* já encerrada */
    }
    try {
      await fh?.close();
    } catch {
      /* já fechado */
    }
    fh = null;
    await rm(parcial, { force: true });
  };
  try {
    if (abortado()) throw new AtualizacaoErro("cancelado");
    resposta = await p.transporte.stream({
      caminho: `${base}${p.artefato.url_relativa}`.replace(/\/{2,}/g, "/"),
      max_bytes: p.artefato.tamanho,
      cabecalhos: { Accept: "application/octet-stream" },
      ...(p.sinal !== undefined ? { sinal: p.sinal } : {}),
      ...(p.ociosoMs !== undefined ? { ocioso_ms: p.ociosoMs } : {}),
    });
    if (resposta.status !== 200) throw new AtualizacaoErro("falha_de_rede");
    fh = await open(parcial, "w", 0o600);
    for await (const pedaco of resposta.corpo) {
      if (abortado()) throw new AtualizacaoErro("cancelado");
      recebidos += pedaco.length;
      if (recebidos > p.artefato.tamanho) throw new AtualizacaoErro("tamanho_diferente"); // maior que o assinado: aborta no ato
      hash.update(pedaco);
      await fh.write(pedaco);
      const t = agora();
      if (p.onProgresso !== undefined && t - ultimoProgresso >= 250) {
        ultimoProgresso = t;
        p.onProgresso(Math.min(1, recebidos / p.artefato.tamanho));
      }
    }
    if (recebidos !== p.artefato.tamanho) throw new AtualizacaoErro("tamanho_diferente");
    const digest = hash.digest("hex");
    if (!iguaisHex(digest, p.artefato.sha512)) throw new AtualizacaoErro("hash_diferente");
    await fh.sync();
    await fh.close();
    fh = null;
    await rename(parcial, final);
    p.onProgresso?.(1);
    return { caminho: final, bytes: recebidos, sha512: digest };
  } catch (e) {
    await limpar();
    if (abortado()) throw new AtualizacaoErro("cancelado");
    throw e instanceof AtualizacaoErro ? e : new AtualizacaoErro(motivoDeErro(e));
  }
}

/** Reconfere (sha512 e tamanho) um arquivo já no disco, em streaming. Remove o arquivo se divergir. Usado ANTES de instalar (TOCTOU, AU-26). */
export async function reverificarArquivo(caminho: string, artefato: ArtefatoAtualizacao): Promise<void> {
  const hash = createHash("sha512");
  let total = 0;
  try {
    for await (const pedaco of createReadStream(caminho)) {
      total += (pedaco as Buffer).length;
      if (total > artefato.tamanho) break;
      hash.update(pedaco as Buffer);
    }
  } catch {
    throw new AtualizacaoErro("falha_de_rede");
  }
  if (total !== artefato.tamanho) {
    await rm(caminho, { force: true });
    throw new AtualizacaoErro("tamanho_diferente");
  }
  if (!iguaisHex(hash.digest("hex"), artefato.sha512)) {
    await rm(caminho, { force: true });
    throw new AtualizacaoErro("hash_diferente");
  }
}
