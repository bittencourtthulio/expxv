// Anexar captura ao Pane (Fase 11, T-11.20): reusa o fluxo de anexos do terminal (T-01.08): allowlist de tipo, recusa de arquivo de ambiente, symlink para fora e caminho relativo.
// Imagem dentro do workspace é usada no lugar; imagem fora (captura sem workspace) é copiada para a pasta de entradas do produto (PASTA_ANEXOS). NUNCA envia Enter.
import { isAbsolute, relative, resolve } from "node:path";
import type { ResultadoAnexoCaptura } from "../../compartilhado/captura";
import { formatarCaminhoParaPrompt, prepararAnexos } from "../terminais/anexos";

export async function anexarImagemAoPane(cwd: string, sessaoId: string, caminhoAbsoluto: string): Promise<ResultadoAnexoCaptura> {
  const r = await prepararAnexos(cwd, sessaoId, [{ caminho: caminhoAbsoluto }]);
  return { caminhos: r.caminhos, texto: r.texto };
}

/** `The folder <path> contains N frames sampled at F fps…` (texto da spec 08 §8). Caminho relativo ao cwd quando a pasta está dentro dele; nunca termina em quebra de linha. */
export function textoPromptQuadros(cwd: string, pastaAbsoluta: string, quadros: number, fps: number): ResultadoAnexoCaptura {
  const rel = relative(resolve(cwd), resolve(pastaAbsoluta));
  const caminho = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) ? rel : resolve(pastaAbsoluta);
  const n = Math.max(0, Math.floor(quadros));
  const f = Math.max(1, Math.floor(fps));
  const texto = `The folder ${formatarCaminhoParaPrompt(caminho)} contains ${n} frames sampled at ${f} fps from a screen recording, in chronological order (frame_0001.png onward). Analyze them in sequence and describe what happens. `;
  return { caminhos: [caminho], texto };
}
