import type { DadosAnaliseMapa, ResumoMapaIpc } from "../../../compartilhado/mapa";

// Relatório Markdown do mapa (T-17.38). Só fatos calculados: contagens, caminhos relativos e `arquivo:linha`; nenhuma linha de
// código-fonte. Código sem uso é SEMPRE "candidato" (Camada 10 do legadox): nunca se manda remover.

export interface EntradaRelatorio {
  resumo: ResumoMapaIpc;
  ciclos?: DadosAnaliseMapa["ciclos"];
  camadas?: DadosAnaliseMapa["camadas"];
  hotspots?: DadosAnaliseMapa["hotspots"];
  entradas?: DadosAnaliseMapa["entradas"];
  dados?: DadosAnaliseMapa["dados"];
  externas?: DadosAnaliseMapa["externas"];
  mortos?: DadosAnaliseMapa["mortos"];
  sem_teste?: DadosAnaliseMapa["sem_teste"];
}

const celula = (t: string | number): string => String(t).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const cod = (t: string): string => `\`${t.replace(/`/g, "'").replace(/[\r\n]+/g, " ")}\``;
const n = (x: number): string => x.toLocaleString("pt-BR");

export function exportarMarkdown(e: EntradaRelatorio, opcoes: { limite?: number } = {}): string {
  const lim = opcoes.limite ?? 20;
  const r = e.resumo;
  const L: string[] = ["# Mapa lógico do código", ""];
  L.push("## Panorama", "");
  L.push(`- Estado: ${r.estado} (versão ${r.versao_mapa}${r.analisado_em !== null ? `, analisado em ${r.analisado_em}` : ""}).`);
  L.push(`- Arquivos: ${n(r.arquivos)}; nós: ${n(r.nos)}.`);
  L.push(`- Arestas: ${n(r.arestas.exata)} exatas e ${n(r.arestas.heuristica)} heurísticas.`);
  if (r.linguagens.length > 0) {
    L.push("", "| Linguagem | Arquivos | Linhas |", "|---|---:|---:|");
    for (const l of r.linguagens) L.push(`| ${celula(l.linguagem)} | ${n(l.arquivos)} | ${n(l.loc)} |`);
  }
  if (e.entradas !== undefined) {
    L.push("", "## Entradas", "");
    const cats = Object.entries(e.entradas.por_categoria).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    L.push(cats.length === 0 ? "Nenhuma entrada detectada." : cats.map(([k, v]) => `${k}: ${v}`).join("; ") + ".");
    for (const it of e.entradas.itens.slice(0, lim)) L.push(`- ${cod(it.chave)} (${it.subtipo}, ${it.framework}) em ${cod(`${it.caminho}:${it.linha}`)}${it.confianca === "heuristica" ? " (heurística)" : ""}`);
  }
  if (e.camadas !== undefined) {
    L.push("", "## Camadas e violações", "");
    L.push(`${e.camadas.modulos.length} módulos; ${e.camadas.violacoes.length} violações candidatas; ${e.camadas.regras_importadas} regras de fronteira importadas.`);
    for (const v of e.camadas.violacoes.slice(0, lim)) L.push(`- ${cod(v.de_modulo)} -> ${cod(v.para_modulo)} (${v.origem}): ${celula(v.motivo)}${v.evidencias[0] !== undefined ? ` Evidência: ${cod(v.evidencias[0])}` : ""}`);
  }
  if (e.ciclos !== undefined) {
    L.push("", "## Ciclos de dependência", "");
    L.push(e.ciclos.total === 0 ? "Nenhum ciclo encontrado." : `${e.ciclos.total} ciclos; os maiores:`);
    for (const c of e.ciclos.ciclos.slice(0, lim)) L.push(`- ciclo ${c.id}: ${c.tamanho} arquivos (ex.: ${c.nos.slice(0, 3).map((x) => cod(x.replace(/^arq:/, ""))).join(", ")})`);
  }
  if (e.hotspots !== undefined) {
    L.push("", "## Hotspots", "");
    if (!e.hotspots.disponivel) L.push("História do git indisponível: sem churn não há hotspot (tratado como pior caso no raio de impacto).");
    else {
      L.push("| Arquivo | Pontuação | Alterações | Complexidade |", "|---|---:|---:|---:|");
      for (const h of e.hotspots.itens.slice(0, lim)) L.push(`| ${cod(h.caminho)} | ${h.score.toFixed(2)} | ${h.churn_janela} | ${h.complexidade_max} |`);
    }
  }
  if (e.dados !== undefined) {
    L.push("", "## Acesso a dados", "");
    L.push(e.dados.tabelas.length === 0 ? "Nenhuma tabela detectada." : "| Tabela | Leituras | Escritas |\n|---|---:|---:|");
    for (const t of e.dados.tabelas.slice(0, lim)) L.push(`| ${cod(t.nome)} | ${t.le_n} | ${t.escreve_n} |`);
  }
  if (e.externas !== undefined) {
    L.push("", "## Dependências externas", "", `${e.externas.itens.length} dependências. ${e.externas.aviso}`);
    for (const x of e.externas.itens.slice(0, lim)) L.push(`- ${cod(x.nome)} ${x.versao ?? "?"} (${x.ecossistema}${x.licenca !== null ? `, ${x.licenca}` : ""}${x.selo !== null ? `, ${x.selo}` : ""})`);
  }
  if (e.sem_teste !== undefined) {
    L.push("", "## Arquivos sem teste", "");
    L.push("Estimativa por convenção de nome e por importação nos testes (não é cobertura medida).");
    for (const p of e.sem_teste.por_pasta.slice(0, lim)) L.push(`- ${cod(p.pasta)}: ${p.sem_teste} de ${p.total} sem teste`);
  }
  if (e.mortos !== undefined) {
    L.push("", "## Candidatos a código morto", "", `${e.mortos.rotulo}.`);
    for (const m of e.mortos.itens.slice(0, lim)) L.push(`- ${cod(m.linha !== null ? `${m.caminho}:${m.linha}` : m.caminho)} (candidato, confiança ${m.confianca}): ${celula(m.motivos.join("; "))}`);
  }
  L.push("", "## Confiança e limites", "");
  L.push("- Arestas exatas vêm de regra da linguagem ou do manifesto; heurísticas vêm de nome ou convenção e aparecem tracejadas.");
  L.push("- O mapa não enxerga reflexão, injeção de dependência por convenção, SQL montado em tempo de execução nem rotas guardadas em banco.");
  L.push("- Faixa de raio e perfil são provisórios: quem classifica é o legadox; a aprovação de raio ALTO é humana.");
  return `${L.join("\n")}\n`;
}
