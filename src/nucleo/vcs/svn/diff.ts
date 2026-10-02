import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { NomeInvalidoErro } from "../../git/erros";
import { LIMITE_DIFF_BYTES, parseDiff } from "../git/diff";
import type { Diff, OpcoesDiff } from "../vcs";
import { caminhoWc, rodarSvn, type OpcoesBaseSvn } from "./comum";

// T-06.24: `svn diff` (formato "Index:") convertido para o texto estilo git e entregue ao parser da 6A;
// diffs de PROPRIEDADE ficam em `propriedades`.

export interface LinhaPropriedade {
  tipo: "add" | "del" | "ctx";
  texto: string;
}

export interface PropriedadeDiff {
  caminho: string;
  nome: string;
  acao: "adicionada" | "modificada" | "removida";
  antigo: string | null;
  novo: string | null;
  linhas: LinhaPropriedade[];
}

export interface DiffSvn extends Diff {
  propriedades: PropriedadeDiff[];
}

const rotuloInexistente = (l: string): boolean => /\t\(nonexistent\)\s*$/.test(l) || /\t\(revision 0\)\s*$/.test(l);

/** Converte a saída de `svn diff` em (texto estilo git, diffs de propriedade). Nunca lança. */
export function converterDiffSvn(texto: string): { git: string; propriedades: PropriedadeDiff[] } {
  const linhas = texto.split("\n");
  const saida: string[] = [];
  const propriedades: PropriedadeDiff[] = [];
  let caminho = "";
  let i = 0;
  const abrir = (c: string, binario: boolean, novo: boolean, apagado: boolean): void => {
    saida.push(`diff --git a/${c} b/${c}`);
    if (novo) saida.push("new file mode 100644");
    if (apagado) saida.push("deleted file mode 100644");
    if (binario) saida.push(`Binary files ${novo ? "/dev/null" : `a/${c}`} and ${apagado ? "/dev/null" : `b/${c}`} differ`);
  };
  while (i < linhas.length) {
    const l = linhas[i] as string;
    if (l.startsWith("Index: ")) {
      caminho = l.slice(7).replace(/\r$/, "");
      i++;
      if ((linhas[i] ?? "").startsWith("===")) i++;
      const velho = linhas[i] ?? "";
      const novoL = linhas[i + 1] ?? "";
      if (velho.startsWith("--- ") && novoL.startsWith("+++ ")) {
        const novo = rotuloInexistente(velho);
        const apagado = rotuloInexistente(novoL);
        abrir(caminho, false, novo, apagado);
        saida.push(novo ? "--- /dev/null" : `--- a/${caminho}`, apagado ? "+++ /dev/null" : `+++ b/${caminho}`);
        i += 2;
      } else if ((linhas[i] ?? "").startsWith("Cannot display: file marked as a binary type")) {
        abrir(caminho, true, false, false);
        i++;
      } else if (caminho !== "." && !(linhas[i] ?? "").startsWith("Property changes on:") && (linhas[i] ?? "") !== "" ) {
        // arquivo só com mudança de propriedade/sem cabeçalho: nada a abrir
      }
      continue;
    }
    if (l.startsWith("Property changes on: ")) {
      const cam = l.slice(21).replace(/\r$/, "");
      i++;
      if ((linhas[i] ?? "").startsWith("____")) i++;
      let atual: PropriedadeDiff | null = null;
      while (i < linhas.length && !(linhas[i] as string).startsWith("Index: ")) {
        const p = linhas[i] as string;
        const cab = /^(Added|Modified|Deleted): (.+)$/.exec(p);
        if (cab) {
          atual = { caminho: cam, nome: (cab[2] as string).replace(/\r$/, ""), acao: cab[1] === "Added" ? "adicionada" : cab[1] === "Deleted" ? "removida" : "modificada", antigo: null, novo: null, linhas: [] };
          propriedades.push(atual);
        } else if (atual && !p.startsWith("## ") && !p.startsWith("\\ No newline") && p !== "") {
          const t = p[0] === "+" ? "add" : p[0] === "-" ? "del" : "ctx";
          atual.linhas.push({ tipo: t, texto: p.slice(1) });
        }
        i++;
      }
      for (const pr of propriedades) {
        if (pr.caminho !== cam || pr.antigo !== null || pr.novo !== null) continue;
        const velhas = pr.linhas.filter((x) => x.tipo !== "add").map((x) => x.texto);
        const novas = pr.linhas.filter((x) => x.tipo !== "del").map((x) => x.texto);
        pr.antigo = pr.acao === "adicionada" ? null : velhas.join("\n");
        pr.novo = pr.acao === "removida" ? null : novas.join("\n");
      }
      continue;
    }
    if (caminho !== "" && (l.startsWith("@@") || l.startsWith(" ") || l.startsWith("+") || l.startsWith("-") || l.startsWith("\\"))) saida.push(l);
    i++;
  }
  return { git: saida.join("\n") + "\n", propriedades };
}

export interface OpcoesDiffSvn extends OpcoesDiff, OpcoesBaseSvn {}

/** `base`: `N` (contra a revisão N) ou `N:M`/`N:HEAD`. */
function intervalo(base: string): string {
  if (!/^\d+(:(\d+|HEAD))?$/.test(base)) throw new NomeInvalidoErro(`revisão: ${base}`);
  return base;
}

async function diffNaoRastreado(raiz: string, caminho: string): Promise<Diff> {
  const cam = caminho.replace(/\\/g, "/");
  caminhoWc(cam);
  const abs = join(raiz, cam);
  const st = await stat(abs);
  if (!st.isFile() || st.size > LIMITE_DIFF_BYTES) return { arquivos: [], truncado: st.size > LIMITE_DIFF_BYTES, grande: true };
  const buf = await readFile(abs);
  if (buf.includes(0)) return parseDiff(`diff --git a/${cam} b/${cam}\nnew file mode 100644\nBinary files /dev/null and b/${cam} differ\n`);
  const txt = buf.toString("utf8");
  const ls = txt.split("\n");
  if (ls[ls.length - 1] === "") ls.pop();
  const corpo = ls.map((x) => `+${x}`).join("\n");
  return parseDiff(`diff --git a/${cam} b/${cam}\nnew file mode 100644\n--- /dev/null\n+++ b/${cam}\n@@ -0,0 +1,${ls.length} @@\n${corpo}\n${txt.endsWith("\n") || txt === "" ? "" : "\\ No newline at end of file\n"}`);
}

/** Diff da cópia de trabalho (ou `base`), com o diff interno do svn (nunca um `--diff-cmd` externo). */
export async function diffSvn(raiz: string, op: OpcoesDiffSvn = {}): Promise<DiffSvn> {
  if (op.naoRastreado === true) {
    if (op.caminho === undefined) throw new NomeInvalidoErro("caminho obrigatório para arquivo não rastreado");
    return { ...(await diffNaoRastreado(raiz, op.caminho)), propriedades: [] };
  }
  const flags = ["--internal-diff"];
  if (op.base !== undefined) flags.push("-r", intervalo(op.base));
  if (op.contexto !== undefined) {
    if (!Number.isInteger(op.contexto) || op.contexto < 0 || op.contexto > 1000) throw new NomeInvalidoErro(`contexto: ${op.contexto}`);
    flags.push("-x", `-U${op.contexto}`);
  }
  const r = await rodarSvn(raiz, "diff", flags, op.caminho === undefined ? [] : [caminhoWc(op.caminho)], {
    ...op,
    maxBytes: op.limiteBytes ?? LIMITE_DIFF_BYTES,
    encerrarNoLimite: true,
    timeoutMs: 60_000,
  });
  const { git, propriedades } = converterDiffSvn(r.stdout);
  const d = parseDiff(git, { truncado: r.truncado });
  return { ...d, propriedades };
}
