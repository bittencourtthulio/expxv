// Montagem dos documentos (modelo intermediário) a partir de fatos + blocos. Tabelas vêm DIRETO dos fatos (determinísticas); frases vêm dos blocos (com fonte).
import type { Bloco, FatosSprint } from "../../../compartilhado/relatorios";
import { itemEntregue } from "../fatos/coletar";
import { cabecalhoVersao, entradasChangelog } from "../formatos/changelog";
import type { Cartao, DocumentoRel, MarcaDoc, SecaoDoc } from "../formatos/documento";
import { dataPt, horasPt, numeroPt, pctPt, usdPt } from "../util";

export const MARCA_PADRAO: MarcaDoc = { nome: "Relatório de entrega", cor: "#2563eb", rodape: null };
type EstadoDoc = DocumentoRel["estado"];

const bloco = (bs: readonly Bloco[], id: string): Bloco | undefined => bs.find((b) => b.id === id);
const textos = (bs: readonly Bloco[], id: string): string[] => bloco(bs, id)?.afirmacoes.map((a) => a.texto) ?? [];
const carimbo = (f: FatosSprint, geradoEm: string): string => `sprint ${f.sprint.nome} · gerado em ${dataPt(geradoEm)}`;

export function docTecnico(f: FatosSprint, bs: readonly Bloco[], avisos: readonly string[], geradoEm: string, marca: MarcaDoc = MARCA_PADRAO): DocumentoRel {
  // citações: cada afirmação recebe [n,…] apontando para a tabela de fontes (apêndice)
  const numero = new Map<string, number>();
  const rot = new Map(f.fontes.map((x) => [x.id, x.rotulo]));
  const cit = (b: Bloco): string[] => b.afirmacoes.map((a) => {
    const ns = a.fontes.map((id) => { if (!numero.has(id)) numero.set(id, numero.size + 1); return numero.get(id) as number; });
    return `${a.texto} [${ns.join(", ")}]`;
  });
  const t = (id: string): string[] => { const b = bloco(bs, id); return b ? cit(b) : []; };
  const m = f.metricas;
  const secoes: SecaoDoc[] = [];
  secoes.push({ id: "identificacao", titulo: "Identificação", lista: [`Sprint: ${f.sprint.nome}`, `Período: ${dataPt(f.sprint.inicio)} a ${dataPt(f.sprint.fim)}`, `Versão de lançamento: ${f.sprint.versao_lancamento ?? "não informada"}`, `Fechada em: ${dataPt(f.sprint.fechada_em)}`, `Gerado em: ${dataPt(geradoEm)}`] });
  const cartoes: Cartao[] = [
    { rotulo: "Pontos entregues", valor: `${numeroPt(m.pontos_entregues)} / ${numeroPt(m.pontos_planejados)}` },
    { rotulo: "Itens entregues", valor: `${m.itens_entregues} / ${m.itens_total}` },
    { rotulo: "First-time-right", valor: pctPt(m.first_time_right) },
    { rotulo: "Custo", valor: f.custo.estado === "desconhecido" ? "desconhecido" : `${f.custo.estado === "minimo" ? "≥ " : ""}${usdPt(f.custo.usd)}` },
  ];
  secoes.push({ id: "resumo", titulo: "Resumo", cartoes, paragrafos: t("t_resumo") });
  secoes.push({ id: "meta", titulo: "Meta da sprint", paragrafos: t("t_meta") });
  secoes.push({
    id: "mudancas", titulo: "Mudanças", tabela: {
      legenda: "Itens da sprint", colunas: ["Item", "Categoria", "Pontos", "Risco", "Estado", "Duração observada", "Retrabalho", "Pull request"],
      linhas: f.itens.map((i) => [i.titulo, i.categoria, i.pontos, i.risco, i.resultado ?? i.estado_fluxo, horasPt(i.duracao_h), i.retrabalho, i.pr_url === null ? null : { texto: "abrir", href: i.pr_url }]),
    },
  });
  secoes.push({ id: "qualidade", titulo: "Qualidade e retrabalho", paragrafos: t("t_qualidade") });
  secoes.push({
    id: "entrega", titulo: "Entrega", paragrafos: t("t_entrega"),
    tabela: f.commits.length === 0 ? undefined : { legenda: "Commits da entrega (até 100)", colunas: ["Commit", "Mensagem", "Quando"], linhas: f.commits.slice(0, 100).map((c) => [c.sha7, c.mensagem, c.ts ? dataPt(c.ts) : null]) },
  });
  secoes.push({
    id: "metricas", titulo: "Métricas", grafico: { titulo: "Planejado × entregue", descricao: "Pontos planejados e pontos entregues na sprint.", unidade: "pontos", barras: [{ rotulo: "Planejado", valor: m.pontos_planejados ?? 0 }, { rotulo: "Entregue", valor: m.pontos_entregues ?? 0, destaque: true }] },
    tabela: { legenda: "Métricas da sprint", colunas: ["Métrica", "Valor"], linhas: [["Pontos planejados", numeroPt(m.pontos_planejados)], ["Pontos entregues", numeroPt(m.pontos_entregues)], ["Velocidade (média móvel)", numeroPt(m.velocidade_media_movel)], ["Ciclo P50", horasPt(m.cycle_p50_h)], ["Ciclo P85", horasPt(m.cycle_p85_h)], ["Lead time P85", horasPt(m.lead_p85_h)], ["Índice de retrabalho", m.ir === null ? "—" : `${pctPt(m.ir)} a ${pctPt(m.ir_max)}`], ["Bloqueio", horasPt(m.bloqueio_h)]] },
  });
  secoes.push({ id: "custo", titulo: "Custo", paragrafos: t("t_custo") });
  secoes.push({ id: "arquitetura", titulo: "Alterações de arquitetura", paragrafos: t("t_arquitetura") });
  secoes.push({ id: "riscos", titulo: "Riscos", paragrafos: t("t_riscos") });
  secoes.push({ id: "proximos", titulo: "Próximos passos", paragrafos: t("t_proximos") });
  if (avisos.length > 0) secoes.push({ id: "avisos", titulo: "Avisos e lacunas", lista: [...avisos] });
  const fontes = [...numero.entries()].map(([id, n]) => ({ n, rotulo: `${id}: ${rot.get(id) ?? id}` }));
  return { titulo: `Relatório técnico — ${f.sprint.nome}`, subtitulo: f.sprint.versao_lancamento ? `Versão ${f.sprint.versao_lancamento}` : null, estado: "interno", descricao: `Relatório técnico da sprint ${f.sprint.nome}.`, secoes, marca, carimbo: carimbo(f, geradoEm), fontes };
}

export function docUsuario(f: FatosSprint, bs: readonly Bloco[], estado: EstadoDoc, geradoEm: string, marca: MarcaDoc = MARCA_PADRAO): DocumentoRel {
  const sec = (id: string, titulo: string, bid: string, comoLista: boolean, aviso?: string): SecaoDoc | null => {
    const b = bloco(bs, bid);
    if (!b || b.afirmacoes.length === 0) return null;
    const ts = textos(bs, bid);
    return { id, titulo, ...(comoLista ? { lista: ts } : { paragrafos: ts }), ...(aviso && b.precisa_revisao && estado === "rascunho" ? { aviso } : {}) };
  };
  const secoes = [
    sec("em_resumo", "Em resumo", "u_em_resumo", false),
    sec("novidades", "Novidades", "u_novidades", true, "Revisão necessária: há itens sem texto próprio."),
    sec("correcoes", "Correções", "u_correcoes", true, "Revisão necessária: há itens sem texto próprio."),
    sec("acao_necessaria", "O que você precisa fazer", "u_acao_necessaria", false),
    sec("proximos", "Em planejamento", "u_proximos", true),
  ].filter((x): x is SecaoDoc => x !== null);
  return { titulo: `Novidades — ${f.sprint.versao_lancamento ? `versão ${f.sprint.versao_lancamento}` : f.sprint.nome}`, subtitulo: null, estado, descricao: "O que mudou para você nesta etapa.", secoes, marca, carimbo: `${dataPt(f.sprint.fechada_em ?? f.sprint.fim)}` };
}

export function docExecutivo(f: FatosSprint, bs: readonly Bloco[], geradoEm: string, marca: MarcaDoc = MARCA_PADRAO): DocumentoRel {
  const m = f.metricas;
  const destaques = f.itens.filter(itemEntregue).sort((a, b) => (b.pontos ?? -1) - (a.pontos ?? -1) || a.titulo.localeCompare(b.titulo)).slice(0, 5).map((i) => `${i.titulo}${i.pontos === null ? "" : ` (${numeroPt(i.pontos)} pontos)`}`);
  const secoes: SecaoDoc[] = [
    { id: "numeros", titulo: "Números da sprint", cartoes: [
      { rotulo: "Entregue × planejado", valor: `${numeroPt(m.pontos_entregues)} / ${numeroPt(m.pontos_planejados)} pontos` },
      { rotulo: "First-time-right", valor: pctPt(m.first_time_right), nota: m.ir === null ? undefined : `retrabalho ${pctPt(m.ir)} a ${pctPt(m.ir_max)}` },
      { rotulo: "Lead time P85", valor: horasPt(m.lead_p85_h) },
      { rotulo: "Defeitos escapados", valor: m.defeitos_escapados === null ? "—" : String(m.defeitos_escapados) },
      { rotulo: "Custo", valor: f.custo.estado === "desconhecido" ? "desconhecido" : `${f.custo.estado === "minimo" ? "≥ " : ""}${usdPt(f.custo.usd)}` },
      { rotulo: "Meta de pontos", valor: m.meta_atingida === null ? "sem dados" : m.meta_atingida ? "atingida" : "não atingida" },
    ] },
    { id: "resumo", titulo: "Resumo", paragrafos: textos(bs, "t_resumo") },
    { id: "destaques", titulo: "Destaques", lista: destaques.length === 0 ? ["Nenhum item entregue."] : destaques },
    { id: "riscos", titulo: "Riscos", paragrafos: textos(bs, "t_riscos").slice(0, 5) },
    { id: "proximos", titulo: "Próximos passos", paragrafos: textos(bs, "t_proximos").slice(0, 5) },
  ];
  return { titulo: `Resumo executivo — ${f.sprint.nome}`, subtitulo: null, estado: "interno", descricao: `Resumo executivo da sprint ${f.sprint.nome}.`, secoes, marca, carimbo: carimbo(f, geradoEm) };
}

export function docNotas(f: FatosSprint, estado: EstadoDoc, geradoEm: string, marca: MarcaDoc = MARCA_PADRAO): DocumentoRel {
  const entradas = entradasChangelog(f);
  const secoes: SecaoDoc[] = entradas.length === 0 ? [{ id: "vazio", titulo: cabecalhoVersao(f), paragrafos: ["Nesta etapa não houve mudanças visíveis."] }] : entradas.map((e) => ({ id: e.secao, titulo: `${e.titulo}`, lista: e.linhas.map((l) => l.texto) }));
  return { titulo: `Notas de versão — ${cabecalhoVersao(f)}`, subtitulo: null, estado, descricao: "Notas de versão no formato Keep a Changelog.", secoes, marca, carimbo: carimbo(f, geradoEm) };
}

export function docNovidades(f: FatosSprint, bs: readonly Bloco[], estado: EstadoDoc, geradoEm: string, marca: MarcaDoc = MARCA_PADRAO): DocumentoRel {
  const u = docUsuario(f, bs, estado, geradoEm, marca);
  return { ...u, titulo: `Novidades${f.sprint.versao_lancamento ? ` da versão ${f.sprint.versao_lancamento}` : ""}`, secoes: u.secoes.filter((s) => s.id !== "acao_necessaria"), descricao: (textos(bs, "u_em_resumo")[0] ?? "Novidades do sistema.").slice(0, 200) };
}
