// Checagens automáticas (T-12.13): `file_exists`, `contains_text`, `command_exit_zero` (lista FECHADA, executada pelo chamador no MESMO sandbox e no workdir). `critica` ativa o portão de qualidade.
// `opens_without_console_error` precisa de janela Electron offscreen (captura do artefato web): fica para a integração com o main e não é executada aqui.
import { lstatSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { caminhoRelativoSeguro, garantirDentro } from "../execucao/workdir";
import type { ChecagemTarefa, ResultadoChecagem } from "../tipos";
import { comandoPermitido } from "./comandos";

export interface DepsChecagens {
  workdir: string;
  /** roda o argv (da lista fechada) no workdir, sob o sandbox da execução; devolve o código de saída (`null` = não executou). */
  rodarComando: (argv: string[]) => Promise<number | null>;
}

const MAX_LEITURA = 2 * 1024 * 1024;

function arquivoSeguro(workdir: string, rel: string): string | null {
  if (!caminhoRelativoSeguro(rel)) return null;
  const abs = join(workdir, ...rel.split("/"));
  try {
    if (lstatSync(abs).isSymbolicLink()) return null;
    if (!statSync(abs).isFile()) return null;
    garantirDentro(workdir, abs);
    return abs;
  } catch { return null; }
}

export async function executarChecagens(checagens: readonly ChecagemTarefa[], d: DepsChecagens): Promise<ResultadoChecagem[]> {
  const saida: ResultadoChecagem[] = [];
  for (const c of checagens) {
    const base = { tipo: c.tipo, alvo: c.alvo, critica: c.critica };
    try {
      if (c.tipo === "file_exists") {
        const ok = arquivoSeguro(d.workdir, c.alvo) !== null;
        saida.push({ ...base, ok, detalhe: ok ? null : "arquivo não encontrado" });
      } else if (c.tipo === "contains_text") {
        const abs = arquivoSeguro(d.workdir, c.alvo);
        if (abs === null) { saida.push({ ...base, ok: false, detalhe: "arquivo não encontrado" }); continue; }
        const texto = readFileSync(abs).subarray(0, MAX_LEITURA).toString("utf8").toLowerCase();
        const ok = typeof c.texto === "string" && c.texto !== "" && texto.includes(c.texto.toLowerCase());
        saida.push({ ...base, ok, detalhe: ok ? null : "texto não encontrado" });
      } else {
        const argv = comandoPermitido(c.alvo);
        if (argv === null) { saida.push({ ...base, ok: false, detalhe: "comando fora da lista permitida" }); continue; }
        const codigo = await d.rodarComando(argv);
        saida.push({ ...base, ok: codigo === 0, detalhe: codigo === 0 ? null : codigo === null ? "não executou" : `saída ${codigo}` });
      }
    } catch (e) {
      saida.push({ ...base, ok: false, detalhe: e instanceof Error ? e.message.slice(0, 120) : "erro" });
    }
  }
  return saida;
}

export const criticaFalhou = (r: readonly ResultadoChecagem[]): boolean => r.some((x) => x.critica && !x.ok);
