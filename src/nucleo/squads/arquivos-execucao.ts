// Leitura de `plano.md` e `resultado.md` da execução (Fase 14, onda 6). Só LEITURA, só dentro da pasta do produto da árvore da Missão,
// sempre como texto: ≤ 256 KiB, sem controles/ANSI, segredos redigidos. O renderer nunca recebe caminho e nunca renderiza como HTML.
import { open } from "node:fs/promises";
import { join } from "node:path";
import { ID_DE_ARQUIVO, dentroDaPastaDoProduto, resolverDentroReal } from "../orquestracao/pasta";
import { PRODUTO } from "../produto";
import type { ArquivoExecucao, ResultadoArquivoExecucao } from "./tipos";
import { LIMITE_ARQUIVO_EXECUCAO_BYTES } from "./tipos";
import { redigirSegredos } from "./validar";

const NOME_DO_ARQUIVO: Record<ArquivoExecucao, string> = { plano: "plano.md", resultado: "resultado.md" };
const SEM_ARQUIVO: ResultadoArquivoExecucao = { existe: false, texto: null, truncado: false };

/** `base` = raiz da árvore da Missão (worktree dela ou a raiz do workspace). */
export async function lerArquivoDaExecucao(base: string, missionId: string, arquivo: ArquivoExecucao): Promise<ResultadoArquivoExecucao> {
  if (!ID_DE_ARQUIVO.test(missionId) || missionId.includes("..")) throw new Error("identificador de Missão inválido");
  const nome = NOME_DO_ARQUIVO[arquivo];
  if (nome === undefined) throw new Error("arquivo desconhecido");
  const rel = join(PRODUTO.pastaNoProjeto, "missoes", missionId, nome);
  const real = await resolverDentroReal(base, rel);
  if (real === null) return SEM_ARQUIVO; // ausente OU link simbólico para fora da árvore
  // o destino real precisa continuar na pasta do produto (um link para um arquivo da própria raiz também é recusado)
  const baseReal = await resolverDentroReal(base, ".");
  if (baseReal === null || !dentroDaPastaDoProduto(baseReal, real)) return SEM_ARQUIVO;
  let fh;
  try {
    fh = await open(real, "r");
    const st = await fh.stat();
    if (!st.isFile()) return SEM_ARQUIVO;
    const buf = Buffer.alloc(Math.min(st.size, LIMITE_ARQUIVO_EXECUCAO_BYTES));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const truncado = st.size > LIMITE_ARQUIVO_EXECUCAO_BYTES;
    const limpo = buf
      .subarray(0, bytesRead)
      .toString("utf8")
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
    return { existe: true, texto: redigirSegredos(limpo), truncado };
  } catch {
    return SEM_ARQUIVO;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}
