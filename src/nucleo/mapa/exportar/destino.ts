import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export const MENSAGEM_DESTINO_DOCS = "o ADE não escreve em docs/; escolha outra pasta";

export type ResultadoDestino = { ok: true; caminho: string } | { ok: false; erro: string };

/** realpath do ancestral existente mais próximo + o resto (não existente) anexado: resolve symlink e `..` sem exigir que o destino exista. */
function realpathTolerante(alvo: string): string {
  const resto: string[] = [];
  let atual = resolve(alvo);
  for (;;) {
    if (existsSync(atual)) {
      try {
        return join(realpathSync(atual), ...resto.reverse());
      } catch {
        return resolve(alvo);
      }
    }
    const pai = dirname(atual);
    if (pai === atual) return resolve(alvo);
    resto.push(atual.slice(pai.length + 1));
    atual = pai;
  }
}

const norm = (p: string): string => p.toLowerCase(); // APFS/NTFS não distinguem caixa: mais seguro recusar a mais

/** Recusa qualquer destino dentro de `<raiz>/docs/` (D-04), inclusive por `..` e por symlink. Caminho relativo conta a partir da raiz. */
export function destinoPermitido(raiz: string, destino: string): ResultadoDestino {
  if (typeof destino !== "string" || destino === "" || destino.includes("\0")) return { ok: false, erro: "destino inválido" };
  const abs = isAbsolute(destino) ? resolve(destino) : resolve(raiz, destino);
  const real = norm(realpathTolerante(abs));
  const docs = norm(realpathTolerante(join(raiz, "docs")));
  if (real === docs || real.startsWith(docs + sep)) return { ok: false, erro: MENSAGEM_DESTINO_DOCS };
  return { ok: true, caminho: abs };
}

const NOME_ARQUIVO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export interface PedidoGravacao {
  raiz: string;
  /** Pasta de destino (absoluta, ou relativa à raiz). */
  pasta: string;
  /** nome -> conteúdo. Nomes sem separador. */
  arquivos: Readonly<Record<string, string>>;
}

export function gravarExportacao(p: PedidoGravacao): { caminhos: string[]; bytes: number } {
  const d = destinoPermitido(p.raiz, p.pasta);
  if (!d.ok) throw new Error(d.erro);
  const nomes = Object.keys(p.arquivos);
  if (nomes.length === 0) throw new Error("nada a exportar");
  for (const nome of nomes) {
    if (!NOME_ARQUIVO.test(nome)) throw new Error(`nome de arquivo inválido: ${nome}`);
    const r = destinoPermitido(p.raiz, join(d.caminho, nome));
    if (!r.ok) throw new Error(r.erro);
  }
  mkdirSync(d.caminho, { recursive: true });
  // revalida depois de criar: a pasta criada pode resolver (por symlink) para dentro de docs/
  const depois = destinoPermitido(p.raiz, d.caminho);
  if (!depois.ok) throw new Error(depois.erro);
  const caminhos: string[] = [];
  let bytes = 0;
  for (const nome of nomes) {
    const alvo = join(d.caminho, nome);
    const tmp = `${alvo}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(tmp, p.arquivos[nome] as string, { encoding: "utf8", flag: "wx" });
      renameSync(tmp, alvo);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
    bytes += Buffer.byteLength(p.arquivos[nome] as string);
    caminhos.push(alvo);
  }
  return { caminhos, bytes };
}
