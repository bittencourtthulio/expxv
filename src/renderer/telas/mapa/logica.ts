// Lógica pura da tela Mapa (Fase 17): estados, formatação, textos e o perfil em Markdown. Sem DOM, sem IPC.
import type { PerfilProvisorioMapa, ResumoMapaIpc } from "../../../compartilhado/mapa";
import type { NomeIcone } from "../../componentes/Icone";
import type { ItemSubNav } from "../../componentes/subnavegacao-logica";

export const ABAS_MAPA = ["grafo", "camadas", "fluxo", "hotspots", "entradas", "dados", "divida"] as const;
export type AbaMapa = (typeof ABAS_MAPA)[number];
const ICONE_ABA: Record<AbaMapa, NomeIcone> = { grafo: "grafo", camadas: "catalogo", fluxo: "pipelines", hotspots: "alerta", entradas: "subir", dados: "memoria", divida: "aviso" };
export const ROTULO_ABA: Record<AbaMapa, string> = { grafo: "Grafo", camadas: "Camadas", fluxo: "Fluxo", hotspots: "Hotspots", entradas: "Entradas", dados: "Dados", divida: "Dívida" };
export const ITENS_ABAS_MAPA: ReadonlyArray<ItemSubNav<AbaMapa>> = ABAS_MAPA.map((id) => ({ id, rotulo: ROTULO_ABA[id], icone: ICONE_ABA[id] }));

export const COMANDO_INSTALAR_CTAGS = "brew install universal-ctags";
export const ROTULO_FASE: Record<string, string> = { varrendo: "Varrendo arquivos", extraindo: "Extraindo símbolos", resolvendo: "Resolvendo dependências", historia: "Lendo a história do git", analises: "Calculando análises" };

export type EstadoTela = "sem_workspace" | "carregando" | "erro" | "nunca" | "analisando" | "pronto" | "parcial" | "desatualizado";

/** Máquina de estados da tela, derivada do resumo (a fonte da verdade é o main). */
export function estadoDaTela(p: { workspaceId: string | null; resumo: ResumoMapaIpc | null; erro: unknown; carregando: boolean }): EstadoTela {
  if (p.workspaceId === null) return "sem_workspace";
  if (p.erro !== null && p.erro !== undefined && p.resumo === null) return "erro";
  if (p.resumo === null) return p.carregando ? "carregando" : "erro";
  if (p.resumo.analisando) return "analisando";
  if (p.resumo.estado === "vazio") return "nunca";
  if (p.resumo.estado === "parcial") return "parcial";
  if (p.resumo.desatualizado === true && p.resumo.alterados_n > 0) return "desatualizado";
  return "pronto";
}

/** Erro do IPC chega como `Error("[codigo] texto")`; nada de caminho, SQL nem stack na tela. */
export function textoDoErro(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const limpo = m.replace(/^Error invoking remote method '[^']*':\s*(Error:\s*)?/, "").replace(/^\[[a-z_]+\]\s*/, "").trim();
  if (limpo === "" || /\/|\\|\bat\s+\S+\s*\(/.test(limpo)) return "Não foi possível concluir a operação.";
  return limpo.length > 200 ? `${limpo.slice(0, 197)}…` : limpo;
}

export function formatarNumero(n: number): string {
  return new Intl.NumberFormat("pt-BR").format(n);
}

export function tempoRelativo(iso: string | null, agora: number = Date.now()): string {
  if (iso === null) return "nunca";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "nunca";
  const s = Math.max(0, Math.round((agora - t) / 1000));
  if (s < 45) return "agora há pouco";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

export function rotuloEstado(estado: EstadoTela): string {
  const r: Record<EstadoTela, string> = { sem_workspace: "sem projeto", carregando: "carregando", erro: "erro", nunca: "não analisado", analisando: "analisando", pronto: "pronto", parcial: "parcial", desatualizado: "desatualizado" };
  return r[estado];
}

export function resumoDaBarra(r: ResumoMapaIpc, agora?: number): string {
  return `${formatarNumero(r.arquivos)} arq · ${tempoRelativo(r.analisado_em, agora)}`;
}

export function estimativaTexto(n: number | null): string {
  if (n === null) return "A análise roda em segundo plano e não trava o app.";
  const seg = Math.max(1, Math.round(n / 170));
  return `Cerca de ${formatarNumero(n)} arquivos, estimativa de ${seg < 60 ? `${seg} s` : `${Math.round(seg / 60)} min`}. Roda em segundo plano e não trava o app.`;
}

export function percentualProgresso(feito: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((feito / total) * 100)));
}

export function evidenciaCopiavel(caminho: string, linha: number | null): string {
  return linha === null ? caminho : `${caminho}:${linha}`;
}

/** Rótulo seguro de código morto: nunca "morto" sem "candidato". */
export function rotuloMorto(): string {
  return "candidato a código morto (verificar antes de qualquer remoção)";
}

export function perfilParaMarkdown(p: PerfilProvisorioMapa): string {
  const L: string[] = [];
  L.push("# Perfil provisório do mapa");
  L.push("", `> ${p.nota}`, "");
  L.push(`Gerado em ${p.gerado_em}. Este perfil não é o PERFIL.md: quem escreve é o /expx:legadox-perfil.`, "");
  L.push("## Stack", `- Ecossistemas: ${p.stack.ecossistemas.join(", ") || "nenhum detectado"}`, `- Manifestos: ${p.stack.manifestos.join(", ") || "nenhum"}`);
  for (const l of p.stack.linguagens) L.push(`- ${l.linguagem}: ${formatarNumero(l.arquivos)} arquivos, ${formatarNumero(l.loc)} linhas`);
  L.push("", "## Entradas por categoria");
  const cats = Object.entries(p.entradas_por_categoria);
  if (cats.length === 0) L.push("- nenhuma entrada detectada");
  for (const [k, v] of cats) L.push(`- ${k}: ${v}`);
  L.push("", "## Camadas", `- ${p.camadas.modulos} módulos, ${p.camadas.violacoes} violações candidatas, ${p.camadas.ciclos} ciclos`);
  L.push("", "## Comandos declarados");
  if (p.comandos.length === 0) L.push("- nenhum");
  for (const c of p.comandos) L.push(`- ${c.nome}: \`${c.comando}\` (${c.fonte}${c.linha === null ? "" : `:${c.linha}`})`);
  L.push("", "## Cobertura", `- ${p.cobertura.sem_teste} de ${p.cobertura.total} arquivos sem teste (${p.cobertura.metodo})`);
  L.push("", "## Dialetos conflitantes");
  if (p.dialetos_conflitantes.length === 0) L.push("- nenhum");
  for (const d of p.dialetos_conflitantes) L.push(`- ${d.eixo}: ${d.forca}`);
  L.push("", "## Zonas de risco candidatas");
  if (p.zonas_candidatas.length === 0) L.push("- nenhuma");
  for (const z of p.zonas_candidatas) L.push(`- ${z.categoria}: ${z.pastas.join(", ") || "sem pasta"}. Quem valida: ${z.quem_valida}`);
  L.push("", "## Dívida candidata", `- ${p.divida.ciclos} ciclos`, `- ${p.divida.candidatos_mortos} candidatos a código morto (verificar antes de qualquer remoção)`, `- ${p.divida.hotspots_quentes} hotspots quentes`);
  return `${L.join("\n")}\n`;
}

export function ehCaminhoRelativoSeguro(c: string): boolean {
  return c !== "" && !c.startsWith("/") && !/^[A-Za-z]:/.test(c) && !c.split("/").includes("..") && !c.includes("\0");
}
