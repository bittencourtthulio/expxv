// Montagem dos arquivos do pacote (T-19.22, parte pura): renderiza todos os formatos a partir de fatos + blocos + verificação. Nada de I/O aqui: devolve conteúdo e metadados.
// Arquivos para o cliente carregam o estado da revisão (rascunho/aprovado) na faixa do topo; reemitir com `aprovado` só troca a faixa.
import type { Bloco, ConfigRelatorios, FatosSprint, FormatoArquivo, PublicoArquivo, Verificacao } from "../../../compartilhado/relatorios";
import { PRODUTO } from "../../produto";
import { entradasChangelog, cabecalhoVersao, ROTULO_SECAO } from "../formatos/changelog";
import { metricasCsv, tasksCsv, tasksGithubCsv, tasksJiraCsv } from "../formatos/csv";
import { emailTxt, resumoRedes } from "../formatos/divulgacao";
import { renderizarHtml } from "../formatos/html";
import { pacoteJson } from "../formatos/json";
import { renderizarMarkdown } from "../formatos/markdown";
import { sha256 } from "../util";
import { docExecutivo, docNotas, docNovidades, docTecnico, docUsuario, MARCA_PADRAO } from "./documentos";

export interface ArquivoGerado { nome: string; formato: FormatoArquivo; publico: PublicoArquivo; conteudo: string; revisao: "rascunho" | "aprovado" | "na" }
export interface EntradaMontagem {
  fatos: FatosSprint;
  hash_fatos: string;
  blocos: Bloco[];
  verificacao: Verificacao;
  modo_bloco: Record<string, "template" | "llm" | "humano">;
  cfg: ConfigRelatorios;
  gerado_em: string;
  revisao: "rascunho" | "aprovado";
  avisos: string[];
}

/** nomes dos arquivos do cliente (sofrem a troca de faixa ao aprovar). */
export const ARQUIVOS_CLIENTE = ["usuario.html", "usuario.md", "notas-de-versao.html", "notas-de-versao.md", "divulgacao/novidades.html", "divulgacao/novidades.md", "divulgacao/release-github.md", "divulgacao/resumo-redes.txt", "divulgacao/email.txt"] as const;

function releaseGithub(f: FatosSprint): string {
  const e = entradasChangelog(f);
  const corpo = e.length === 0 ? "Nesta etapa não houve mudanças visíveis." : e.map((s) => `### ${ROTULO_SECAO[s.secao]}\n${s.linhas.map((l) => `- ${l.texto.replace(/[\r\n]+/g, " ")}`).join("\n")}`).join("\n\n");
  return `## ${cabecalhoVersao(f)}\n\n${corpo}\n`;
}
function textoRedes(f: FatosSprint, cfg: ConfigRelatorios): string {
  const r = resumoRedes(f, cfg);
  return (["curta", "media", "longa"] as const).map((v) => `== ${v} (${[...r[v]].length} caracteres) ==\n${r[v]}\n`).join("\n");
}

export function montarArquivos(e: EntradaMontagem): ArquivoGerado[] {
  const { fatos: f, blocos: bs, cfg } = e;
  const marca = MARCA_PADRAO;
  const cli = e.revisao;
  const mk = (nome: string, formato: FormatoArquivo, publico: PublicoArquivo, conteudo: string): ArquivoGerado => ({ nome, formato, publico, conteudo, revisao: publico === "cliente" ? cli : "na" });
  const tec = docTecnico(f, bs, e.avisos, e.gerado_em, marca);
  const usu = docUsuario(f, bs, cli, e.gerado_em, marca);
  const exe = docExecutivo(f, bs, e.gerado_em, marca);
  const nota = docNotas(f, cli, e.gerado_em, marca);
  const nov = docNovidades(f, bs, cli, e.gerado_em, marca);
  const mail = emailTxt(f, cfg);
  return [
    mk("tecnico.html", "html", "interno", renderizarHtml(tec)),
    mk("tecnico.md", "md", "interno", renderizarMarkdown(tec)),
    mk("usuario.html", "html", "cliente", renderizarHtml(usu)),
    mk("usuario.md", "md", "cliente", renderizarMarkdown(usu)),
    mk("executivo.html", "html", "gestao", renderizarHtml(exe)),
    mk("executivo.md", "md", "gestao", renderizarMarkdown(exe)),
    mk("notas-de-versao.html", "html", "cliente", renderizarHtml(nota)),
    mk("notas-de-versao.md", "md", "cliente", renderizarMarkdown(nota)),
    mk("tasks.csv", "csv", "interno", tasksCsv(f, cfg.csv_bom)),
    mk("tasks-jira.csv", "csv", "interno", tasksJiraCsv(f, cfg.csv_bom)),
    mk("tasks-github.csv", "csv", "interno", tasksGithubCsv(f, cfg.csv_bom)),
    mk("metricas.csv", "csv", "interno", metricasCsv(f, cfg.csv_bom)),
    mk("pacote.json", "json", "maquina", pacoteJson({ hash_fatos: e.hash_fatos, fatos: f, blocos: bs, verificacao: e.verificacao, modo_bloco: e.modo_bloco })),
    mk("divulgacao/novidades.html", "html", "cliente", renderizarHtml(nov)),
    mk("divulgacao/novidades.md", "md", "cliente", renderizarMarkdown(nov)),
    mk("divulgacao/release-github.md", "md", "cliente", releaseGithub(f)),
    mk("divulgacao/resumo-redes.txt", "txt", "cliente", textoRedes(f, cfg)),
    mk("divulgacao/email.txt", "txt", "cliente", mail.texto),
  ];
}

export interface Manifesto { esquema: "relatorio_manifesto_v1"; gerador: string; versao_pacote: number; hash_fatos: string; gerado_em: string; modo_redacao: string; modo_bloco: Record<string, string>; arquivos: { nome: string; sha256: string; bytes: number }[]; avisos: string[] }
export interface EntradaManifesto { nome: string; sha256: string; bytes: number }
export const entradasDe = (arquivos: readonly ArquivoGerado[]): EntradaManifesto[] => arquivos.map((a) => ({ nome: a.nome, sha256: sha256(a.conteudo), bytes: Buffer.byteLength(a.conteudo, "utf8") }));
/** o manifesto lista o que ESTÁ no disco: ao reemitir só os arquivos do cliente, os demais entram com o hash já registrado. */
export function montarManifesto(p: { entradas: readonly EntradaManifesto[]; versao: number; hash_fatos: string; gerado_em: string; modo_redacao: string; modo_bloco: Record<string, string>; avisos: string[] }): string {
  const m: Manifesto = {
    esquema: "relatorio_manifesto_v1", gerador: PRODUTO.id, versao_pacote: p.versao, hash_fatos: p.hash_fatos, gerado_em: p.gerado_em, modo_redacao: p.modo_redacao, modo_bloco: p.modo_bloco,
    arquivos: [...p.entradas].sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0)), avisos: p.avisos,
  };
  return `${JSON.stringify(m, null, 2)}\n`;
}
