// Lógica PURA da tela Relatórios (testada sem DOM): abas, rótulos, leitura das variantes de divulgação, regras de habilitação dos botões e texto de erro.
import { LIMITES_VARIANTE, type EnvioDivulgacao, type EstadoCanalDivulgacao, type PacoteDetalhe, type PacoteResumo, type VarianteDivulgacao } from "../../../compartilhado/relatorios";
import type { ItemSubNav } from "../../componentes/subnavegacao-logica";

export type AbaRelatorios = "pacotes" | "revisao" | "divulgacao" | "config";
export const ABAS_RELATORIOS: readonly ItemSubNav<AbaRelatorios>[] = [
  { id: "pacotes", rotulo: "Pacotes", icone: "relatorios" },
  { id: "revisao", rotulo: "Revisão", icone: "catalogo" },
  { id: "divulgacao", rotulo: "Divulgação", icone: "chat" },
  { id: "config", rotulo: "Config", icone: "config" },
];

/** o IPC entrega `Error` com `[codigo] texto`; a UI mostra só o texto, sem prefixo técnico e sem caminho. */
export function textoDoErro(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const t = m.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, "").replace(/^\[[a-z_]+(\/[a-z_]+)?\]\s*/, "").trim();
  return t === "" ? "Algo deu errado. Tente de novo." : t;
}

export const ROTULO_ESTADO: Record<PacoteResumo["estado"], string> = { gerando: "gerando", pronto: "pronto", falhou: "falhou", obsoleto: "desatualizado" };
export const ROTULO_MODO: Record<PacoteResumo["modo_redacao"], string> = { template: "texto padrão", llm: "IA", misto: "IA + padrão" };
export const ROTULO_ETAPA: Record<string, string> = { coletar: "Coletando dados", redigir: "Redigindo", verificar: "Verificando", renderizar: "Montando arquivos", gravar: "Gravando" };

export function linhaDoPacote(p: PacoteResumo): string {
  return `${p.titulo} · ${ROTULO_ESTADO[p.estado]} · ${ROTULO_MODO[p.modo_redacao]} · ${p.revisao_usuario === "aprovado" ? "aprovado" : "rascunho"}${p.avisos_qtd > 0 ? ` · ${p.avisos_qtd} aviso(s)` : ""}`;
}
export function tamanhoPt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** lê `resumo-redes.txt` (`== curta (N caracteres) ==` + texto) em variantes; o texto é cortado pelo limite como última barreira. */
export function variantesDeRedes(txt: string): { variante: VarianteDivulgacao; texto: string; limite: number }[] {
  const out: { variante: VarianteDivulgacao; texto: string; limite: number }[] = [];
  const partes = txt.split(/^== (curta|media|longa) \(\d+ caracteres\) ==\n/m);
  for (let i = 1; i < partes.length; i += 2) {
    const v = partes[i] as VarianteDivulgacao;
    const limite = LIMITES_VARIANTE[v];
    out.push({ variante: v, texto: (partes[i + 1] ?? "").replace(/\n+$/, "").slice(0, limite), limite });
  }
  return out;
}
export const contador = (texto: string, limite: number): { n: number; estoura: boolean; rotulo: string } => ({ n: [...texto].length, estoura: [...texto].length > limite, rotulo: `${[...texto].length}/${limite}` });

/** regras de habilitação dos botões (a UI nunca decide sozinha: o main confere de novo). */
export function acoesDoPacote(p: PacoteDetalhe | null): { podeAprovar: boolean; podeDesaprovar: boolean; podeRegenerar: boolean; podeExportar: boolean; motivoAprovar: string | null } {
  if (p === null || p.estado !== "pronto") return { podeAprovar: false, podeDesaprovar: false, podeRegenerar: p !== null && p.estado !== "gerando", podeExportar: false, motivoAprovar: p?.estado === "gerando" ? "Aguarde o pacote ficar pronto." : "Só um pacote pronto pode ser aprovado." };
  const bloqueios = (p.verificacao?.violacoes ?? []).filter((v) => v.bloco.startsWith("u_") || v.bloco === "usuario").length;
  return { podeAprovar: p.revisao_usuario === "rascunho" && bloqueios === 0, podeDesaprovar: p.revisao_usuario === "aprovado", podeRegenerar: true, podeExportar: true, motivoAprovar: bloqueios > 0 ? `O texto do cliente tem ${bloqueios} problema(s) de linguagem ou cobertura: revise na aba Revisão.` : null };
}
export function podeEnviar(e: EnvioDivulgacao, canal: EstadoCanalDivulgacao | undefined, pacoteAprovado: boolean): { pode: boolean; motivo: string | null } {
  if (e.estado === "enviado") return { pode: false, motivo: "Já enviado." };
  if (e.estado !== "aprovado" && e.estado !== "falhou") return { pode: false, motivo: "Aprove o item antes de enviar." };
  if (!pacoteAprovado) return { pode: false, motivo: "Aprove primeiro o relatório do cliente." };
  if (canal === undefined || !canal.disponivel) return { pode: false, motivo: canal?.motivo ?? "Canal indisponível." };
  if (!canal.consentido) return { pode: false, motivo: canal.motivo ?? "Falta o seu consentimento para este canal." };
  return { pode: true, motivo: null };
}

export const nomeAmigavel = (nome: string): string => ({
  "tecnico.html": "Relatório técnico (HTML)", "tecnico.md": "Relatório técnico (Markdown)", "usuario.html": "Relatório do usuário (HTML)", "usuario.md": "Relatório do usuário (Markdown)",
  "executivo.html": "Resumo executivo (HTML)", "executivo.md": "Resumo executivo (Markdown)", "notas-de-versao.html": "Notas de versão (HTML)", "notas-de-versao.md": "Notas de versão (Markdown)",
  "tasks.csv": "Tarefas (CSV)", "tasks-jira.csv": "Tarefas para Jira (CSV)", "tasks-github.csv": "Tarefas para GitHub (CSV)", "metricas.csv": "Métricas (CSV)", "pacote.json": "Pacote completo (JSON)",
  "divulgacao/novidades.html": "Novidades (HTML)", "divulgacao/novidades.md": "Novidades (Markdown)", "divulgacao/release-github.md": "Notas para o GitHub", "divulgacao/resumo-redes.txt": "Resumo para redes",
  "divulgacao/email.txt": "E-mail (texto)",
} as Record<string, string>)[nome] ?? nome;
