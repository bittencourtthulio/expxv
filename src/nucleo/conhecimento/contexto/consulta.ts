// Deriva a consulta de uma tarefa: termos distintivos (reusa a derivação da Fase 8), identificadores quebrados, nomes de arquivo,
// referências `T-NN.MM`/`OC-…`/`D-NN`. Puro; ≤ 200 caracteres (cabe em `rag_consulta.consulta_redigida`).
import { derivarConsulta } from "../../memoria/consulta-previa";
import { termosDeIdentificadores } from "../fts";
import { redigir } from "../chunking/comum";

export interface ConsultaDerivada {
  consulta: string;
  arquivos: string[];
  refs: string[];
}

const RE_REF = /\b(?:T-\d{1,3}\.\d{1,3}|OC-[A-Za-z0-9][A-Za-z0-9_-]{1,40}|(?:PD|D|P)-\d{1,4})\b/g;

export function derivarConsultaConhecimento(tarefa: string, arquivos: readonly string[] = []): ConsultaDerivada {
  const texto = redigir(tarefa.slice(0, 2000));
  const refs = [...new Set(texto.match(RE_REF) ?? [])].slice(0, 6);
  const arqs = arquivos.filter((a) => typeof a === "string" && a !== "" && !a.startsWith("/") && !a.includes("..")).slice(0, 20);
  const nomes = arqs.map((a) => (a.split("/").pop() as string).replace(/\.[A-Za-z0-9]+$/, "")).filter((n) => n.length >= 3);
  const ids = termosDeIdentificadores(texto, 12).split(" ").filter((t) => t.length >= 4).slice(0, 6);
  const base = derivarConsulta(texto, 8).split(" ").filter(Boolean);
  const termos: string[] = [];
  for (const t of [...refs, ...base, ...ids, ...nomes.flatMap((n) => termosDeIdentificadores(n, 4).split(" "))]) {
    const x = t.toLowerCase();
    if (x.length >= 2 && !termos.includes(x)) termos.push(x);
  }
  let consulta = "";
  for (const t of termos) {
    if (consulta.length + t.length + 1 > 200) break;
    consulta += (consulta ? " " : "") + t;
  }
  return { consulta, arquivos: arqs, refs };
}
