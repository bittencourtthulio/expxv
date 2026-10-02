// Servidor de atualização FALSO (T-21.19): feed de manifestos assinados com chaves de TESTE, artefatos sintéticos e cenários hostis.
// Só loopback (127.0.0.1, porta efêmera). NUNCA rede real. Encerrar SEMPRE no `finally`/`afterEach` (`fechar()`).
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ManifestoAtualizacao } from "../../../src/compartilhado/atualizacao";
import { assinarComo, type NomeChaveDeTeste } from "./chaves-de-teste";
import { artefatoSintetico, manifestoBase, sha512Hex } from "./manifestos";
import { subirServidorFalso, type ServidorFalso } from "../rede/servidor-falso";

export const CENARIOS = [
  "normal",
  "disponivel",
  "atual",
  "downgrade",
  "hash_errado",
  "assinatura_invalida",
  "canal_cruzado",
  "expirado",
  "redirecionamento",
  "lento",
  "infinito",
  "gigante",
  "304",
  "laco_3xx",
  "cabecalho_enorme",
] as const;
export type Cenario = (typeof CENARIOS)[number];

export interface OpcoesFeedFalso {
  cenario?: Cenario;
  /** versão publicada (padrão 1.1.0). */
  versao?: string;
  canal?: "stable" | "beta";
  artefato?: Buffer;
  /** campos a sobrescrever no manifesto antes de assinar. */
  manifestoSobre?: Partial<ManifestoAtualizacao>;
  chave?: NomeChaveDeTeste;
  /** mapa de contagem por rota (preenchido pelo servidor). */
}
export interface FeedFalso {
  servidor: ServidorFalso;
  host: string;
  porta: number;
  manifesto: ManifestoAtualizacao;
  artefato: Buffer;
  etag: string;
  /** requisições por caminho (sem query). */
  contagem(caminho: string): number;
  fechar(): Promise<void>;
}

const ETAG = '"manifesto-v1"';

export async function subirFeedFalso(op: OpcoesFeedFalso = {}): Promise<FeedFalso> {
  const cenario = op.cenario ?? "normal";
  const canal = cenario === "canal_cruzado" ? "beta" : (op.canal ?? "stable");
  const versao = cenario === "canal_cruzado" ? "1.1.0-beta.1" : cenario === "downgrade" ? "0.9.0" : cenario === "atual" ? "1.0.0" : (op.versao ?? "1.1.0");
  const artefato = op.artefato ?? artefatoSintetico();
  const servido = cenario === "hash_errado" ? Buffer.concat([artefato.subarray(0, artefato.length - 1), Buffer.from("X")]) : artefato;
  const relativa = `${canal}/${versao}/app-universal.dmg`;
  const manifesto = manifestoBase(
    {
      versao,
      canal,
      artefatos: [
        { plataforma: "darwin", arquitetura: "universal", url_relativa: relativa, sha512: sha512Hex(artefato), tamanho: artefato.length },
        { plataforma: "win32", arquitetura: "x64", url_relativa: `${canal}/${versao}/app-Setup.exe`, sha512: sha512Hex(artefato), tamanho: artefato.length },
      ],
      ...(cenario === "expirado" ? { publicado_em: "2026-01-01T00:00:00.000Z", valido_ate: "2026-02-01T00:00:00.000Z" } : {}),
      ...op.manifestoSobre,
    },
    artefato,
  );
  const bytes = Buffer.from(JSON.stringify(manifesto));
  const assinatura = cenario === "assinatura_invalida" ? assinarComo("intrusa", bytes) : assinarComo(op.chave ?? "atual", bytes);
  const contagens = new Map<string, number>();
  // canal cruzado: o feed `stable` serve (assinado!) um manifesto do canal `beta`
  const caminhoManifesto = cenario === "canal_cruzado" ? "/stable/manifesto.json" : `/${canal}/manifesto.json`;

  const manipulador = (req: IncomingMessage, res: ServerResponse): void => {
    const caminho = (req.url ?? "").split("?")[0] as string;
    contagens.set(caminho, (contagens.get(caminho) ?? 0) + 1);
    if (cenario === "laco_3xx") {
      res.statusCode = 302;
      res.setHeader("location", caminho);
      res.end();
      return;
    }
    if (cenario === "redirecionamento") {
      res.statusCode = 302;
      res.setHeader("location", "http://localhost:1/atacante");
      res.end();
      return;
    }
    if (cenario === "cabecalho_enorme") {
      res.setHeader("x-enorme", "a".repeat(20_000));
      res.setHeader("etag", ETAG);
    }
    if (caminho === caminhoManifesto) {
      if (cenario === "304" && req.headers["if-none-match"] === ETAG) {
        res.statusCode = 304;
        res.end();
        return;
      }
      if (cenario === "infinito") {
        res.statusCode = 200;
        const t = setInterval(() => res.write(Buffer.alloc(64 * 1024, 32)), 5);
        res.on("close", () => clearInterval(t));
        return;
      }
      if (cenario === "lento") {
        res.statusCode = 200;
        res.write("{");
        return; // nunca termina: o cliente precisa estourar o tempo-limite
      }
      res.statusCode = 200;
      res.setHeader("etag", ETAG);
      res.end(bytes);
      return;
    }
    if (caminho === `${caminhoManifesto}.sig`) {
      res.statusCode = 200;
      res.end(assinatura);
      return;
    }
    if (caminho === `/${relativa}`) {
      if (cenario === "gigante") {
        res.statusCode = 200;
        const t = setInterval(() => res.write(Buffer.alloc(256 * 1024, 7)), 2);
        res.on("close", () => clearInterval(t));
        return;
      }
      if (cenario === "infinito") {
        res.statusCode = 200;
        const t = setInterval(() => res.write(Buffer.alloc(64 * 1024, 7)), 5);
        res.on("close", () => clearInterval(t));
        return;
      }
      if (cenario === "lento") {
        res.statusCode = 200;
        res.write(servido.subarray(0, 8));
        return;
      }
      res.statusCode = 200;
      res.setHeader("content-length", String(servido.length));
      // em pedaços de 64 KiB com contrapressão (não enfileira o arquivo inteiro na memória do servidor, que roda no mesmo processo do teste)
      function* pedacos(): Generator<Buffer> {
        for (let i = 0; i < servido.length; i += 65536) yield servido.subarray(i, i + 65536);
      }
      Readable.from(pedacos(), { objectMode: false }).pipe(res);
      return;
    }
    res.statusCode = 404;
    res.end();
  };

  const servidor = await subirServidorFalso(manipulador);
  return {
    servidor,
    host: servidor.host,
    porta: servidor.porta,
    manifesto,
    artefato,
    etag: ETAG,
    contagem: (c) => contagens.get(c) ?? 0,
    fechar: () => servidor.fechar(),
  };
}
