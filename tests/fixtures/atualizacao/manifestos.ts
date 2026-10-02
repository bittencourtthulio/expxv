// Construtores de manifesto e artefato sintético para testes do atualizador. Nada aqui toca rede.
import { createHash } from "node:crypto";
import type { ManifestoAtualizacao } from "../../../src/compartilhado/atualizacao";
import { assinarComo, type NomeChaveDeTeste } from "./chaves-de-teste";

export const AGORA = new Date("2026-10-01T12:00:00.000Z");
export const sha512Hex = (b: Uint8Array | string): string => createHash("sha512").update(b).digest("hex");

export function artefatoSintetico(tamanho = 4096): Buffer {
  return Buffer.alloc(tamanho, "expx-artefato-sintetico\n");
}

export function manifestoBase(sobre: Partial<ManifestoAtualizacao> = {}, artefato: Buffer = artefatoSintetico()): ManifestoAtualizacao {
  return {
    esquema: 1,
    versao: "1.1.0",
    canal: "stable",
    publicado_em: "2026-09-30T12:00:00.000Z",
    valido_ate: "2026-10-30T12:00:00.000Z",
    artefatos: [
      { plataforma: "darwin", arquitetura: "universal", url_relativa: "stable/1.1.0/app-universal.dmg", sha512: sha512Hex(artefato), tamanho: artefato.length },
      { plataforma: "win32", arquitetura: "x64", url_relativa: "stable/1.1.0/app-Setup.exe", sha512: sha512Hex(artefato), tamanho: artefato.length },
    ],
    notas: "## 1.1.0\n- melhorias",
    staging: 100,
    ...sobre,
  };
}

export interface Assinado {
  bytes: Buffer;
  assinatura: string;
}
export function assinado(m: ManifestoAtualizacao | Record<string, unknown>, chave: NomeChaveDeTeste = "atual"): Assinado {
  const bytes = Buffer.from(JSON.stringify(m));
  return { bytes, assinatura: assinarComo(chave, bytes) };
}
