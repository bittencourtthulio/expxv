// Redação determinística (T-19.09): texto por TEMPLATE com variáveis, sempre disponível (sem modelo, sem rede), com a(s) fonte(s) de cada afirmação.
// Item sem texto limpo vira "Melhoria na plataforma" marcada `precisa_revisao` (nunca inventa). Ajuste humano sobrescreve o bloco inteiro e vale em toda regeneração.
import type { Afirmacao, Bloco, FatoItem, FatosSprint } from "../../../compartilhado/relatorios";
import { itemEntregue } from "../fatos/coletar";
import { tipoCorrecao } from "../fatos/fontes";
import { dataPt, horasPt, listaPt, numeroPt, pctPt, plural, usdPt } from "../util";
import { temJargao } from "./jargao";

export const BLOCOS_USUARIO = ["u_em_resumo", "u_novidades", "u_correcoes", "u_acao_necessaria", "u_proximos"] as const;
export const BLOCOS_TECNICOS = ["t_resumo", "t_meta", "t_qualidade", "t_entrega", "t_custo", "t_arquitetura", "t_riscos", "t_proximos"] as const;
export const TITULOS_BLOCOS: Record<string, string> = {
  u_em_resumo: "Em resumo", u_novidades: "Novidades", u_correcoes: "Correções", u_acao_necessaria: "O que você precisa fazer", u_proximos: "Em planejamento",
  t_resumo: "Resumo", t_meta: "Meta da sprint", t_qualidade: "Qualidade e retrabalho", t_entrega: "Entrega", t_custo: "Custo", t_arquitetura: "Alterações de arquitetura", t_riscos: "Riscos", t_proximos: "Próximos passos",
};

const af = (bloco: string, n: number, texto: string, fontes: string[]): Afirmacao => ({ id: `${bloco}.${n}`, texto, fontes });
const bloco = (id: string, publico: Bloco["publico"], afirmacoes: Afirmacao[], precisa = false): Bloco => ({ id, titulo: TITULOS_BLOCOS[id] ?? id, publico, afirmacoes, origem: "template", precisa_revisao: precisa });
const S = (f: FatosSprint): string => `sprint:${f.sprint.id}`;
const M = (f: FatosSprint, nome: string): string => `metrica:${f.sprint.id}/${nome}`;

const visiveisEntregues = (f: FatosSprint): FatoItem[] => f.itens.filter((i) => i.visivel_cliente && itemEntregue(i));

/** frase de um item para o cliente; `precisa` quando não há texto limpo. */
export function fraseDoItem(i: FatoItem): { texto: string; precisa: boolean } {
  const nome = i.titulo && !temJargao(i.titulo) ? i.titulo.replace(/[.\s]+$/, "") : null;
  if (i.resumo_cliente) return { texto: nome ? `${nome}: ${i.resumo_cliente.replace(/\s+$/, "")}` : i.resumo_cliente, precisa: false };
  if (nome) return { texto: `${nome}.`, precisa: false };
  return { texto: "Melhoria na plataforma.", precisa: true };
}

export function blocosUsuario(f: FatosSprint): Bloco[] {
  const vis = visiveisEntregues(f);
  const corr = vis.filter(tipoCorrecao);
  const nov = vis.filter((i) => !tipoCorrecao(i));
  const resumo = vis.length === 0
    ? "Nesta etapa não houve mudanças visíveis para você."
    : `Nesta etapa entregamos ${plural(nov.length, "novidade", "novidades")} e ${plural(corr.length, "correção", "correções")}${f.sprint.versao_lancamento ? ` (versão ${f.sprint.versao_lancamento})` : ""}.`;
  let precisa = false;
  const mk = (id: string, itens: FatoItem[]): Bloco => {
    let p = false;
    const afs = itens.map((i, n) => { const fr = fraseDoItem(i); p ||= fr.precisa; return af(id, n + 1, fr.texto, [`item:${i.item_id}`]); });
    precisa ||= p;
    return bloco(id, "usuario", afs, p);
  };
  const carregados = f.itens.filter((i) => i.visivel_cliente && i.resultado === "carregado");
  return [
    bloco("u_em_resumo", "usuario", [af("u_em_resumo", 1, resumo, [S(f)])]),
    mk("u_novidades", nov),
    mk("u_correcoes", corr),
    bloco("u_acao_necessaria", "usuario", [af("u_acao_necessaria", 1, "Não é preciso fazer nada diferente.", [S(f)])]),
    bloco("u_proximos", "usuario", carregados.map((i, n) => af("u_proximos", n + 1, fraseDoItem(i).texto, [`item:${i.item_id}`]))),
  ];
}

export function blocosTecnicos(f: FatosSprint): Bloco[] {
  const m = f.metricas;
  const s = f.sprint;
  const out: Bloco[] = [];
  const pts = m.pontos_planejados === null || m.pontos_entregues === null
    ? `${plural(m.itens_entregues, "item entregue", "itens entregues")} de ${m.itens_total}`
    : `${numeroPt(m.pontos_entregues)} de ${numeroPt(m.pontos_planejados)} pontos e ${m.itens_entregues} de ${m.itens_total} itens`;
  out.push(bloco("t_resumo", "tecnico", [af("t_resumo", 1, `A sprint ${s.nome} (${dataPt(s.inicio)} a ${dataPt(s.fim)}) entregou ${pts}.`, [S(f), M(f, "pontos")])]));

  const meta: Afirmacao[] = [];
  if (s.meta) meta.push(af("t_meta", 1, `Meta: ${s.meta}`, [S(f)]));
  meta.push(af("t_meta", meta.length + 1, m.meta_atingida === null ? "Não há dados suficientes para dizer se a meta de pontos foi atingida." : m.meta_atingida ? "A meta de pontos foi atingida." : "A meta de pontos não foi atingida.", [S(f), M(f, "pontos")]));
  out.push(bloco("t_meta", "tecnico", meta));

  const q: Afirmacao[] = [];
  q.push(af("t_qualidade", 1, `First-time-right: ${pctPt(m.first_time_right)}. Índice de retrabalho: ${m.ir === null ? "não avaliável" : `${pctPt(m.ir)} a ${pctPt(m.ir_max)}`}.`, [M(f, "first_time_right"), M(f, "retrabalho")]));
  q.push(af("t_qualidade", 2, `Tempo de ciclo: mediana ${horasPt(m.cycle_p50_h)} e P85 ${horasPt(m.cycle_p85_h)}. Defeitos escapados: ${m.defeitos_escapados === null ? "—" : m.defeitos_escapados}.`, [M(f, "ciclo")]));
  out.push(bloco("t_qualidade", "tecnico", q));

  out.push(bloco("t_entrega", "tecnico", [af("t_entrega", 1, `${plural(f.commits.length, "commit", "commits")} e ${plural(f.prs.length, "pull request", "pull requests")} registrados para a entrega.`, [S(f)])]));

  const c = f.custo;
  const custo = c.estado === "desconhecido" || (c.tokens === null && c.usd === null)
    ? "Custo desconhecido: o consumo não foi medido."
    : `Custo ${c.estado === "minimo" ? "mínimo conhecido" : "medido"}: ${c.usd === null ? "valor em dólar desconhecido" : usdPt(c.usd)}${c.tokens === null ? "" : `, ${numeroPt(c.tokens)} tokens`}.`;
  out.push(bloco("t_custo", "tecnico", [af("t_custo", 1, custo, [`custo:${s.id}`])]));

  const arq: Afirmacao[] = [];
  if (f.mapa === null) arq.push(af("t_arquitetura", 1, "Sem mapa de código: as alterações de arquitetura não puderam ser calculadas.", [S(f)]));
  else {
    const mods = f.mapa.modulos.map((x) => `${x.nome} (${plural(x.arquivos, "arquivo", "arquivos")})`);
    arq.push(af("t_arquitetura", 1, mods.length === 0 ? "Nenhum módulo mapeado foi alterado." : `Módulos alterados: ${listaPt(mods)}.`, ["mapa:modulos"]));
    if (f.mapa.ciclos !== null) arq.push(af("t_arquitetura", arq.length + 1, `Ciclos de dependência no mapa: ${f.mapa.ciclos}.`, ["mapa:modulos"]));
    if (f.mapa.pontos_quentes.length > 0) arq.push(af("t_arquitetura", arq.length + 1, `Pontos quentes: ${listaPt(f.mapa.pontos_quentes)}.`, ["mapa:modulos"]));
  }
  out.push(bloco("t_arquitetura", "tecnico", arq));

  const risco = f.itens.filter((i) => i.risco === "alto" || i.risco === "critico");
  out.push(bloco("t_riscos", "tecnico", risco.length === 0 ? [af("t_riscos", 1, "Nenhum item de risco alto ou crítico.", [S(f)])] : risco.map((i, n) => af("t_riscos", n + 1, `${i.titulo}: risco ${i.risco}${i.criticidade ? `, criticidade ${i.criticidade}` : ""}.`, [`item:${i.item_id}`]))));

  const prox = f.itens.filter((i) => i.resultado === "carregado" || i.resultado === "devolvido");
  out.push(bloco("t_proximos", "tecnico", prox.length === 0 ? [af("t_proximos", 1, "Nada foi carregado para a próxima sprint.", [S(f)])] : prox.map((i, n) => af("t_proximos", n + 1, `${i.titulo} (${i.resultado === "carregado" ? "carregado para a próxima sprint" : "devolvido ao backlog"}).`, [`item:${i.item_id}`]))));
  return out;
}

/** ajuste humano: sobrescreve o bloco inteiro (um parágrafo por linha) em TODAS as regenerações; a pessoa responde pelo texto. */
export function aplicarAjustes(blocos: readonly Bloco[], ajustes: ReadonlyMap<string, string>, f: FatosSprint): Bloco[] {
  return blocos.map((b) => {
    const t = ajustes.get(b.id);
    if (t === undefined || t.trim() === "") return b;
    const paragrafos = t.split(/\n{1,}/).map((x) => x.trim()).filter(Boolean);
    return { ...b, origem: "humano" as const, precisa_revisao: false, afirmacoes: paragrafos.map((p, n) => af(b.id, n + 1, p, [S(f)])) };
  });
}

export function montarBlocos(f: FatosSprint, ajustes: ReadonlyMap<string, string> = new Map()): Bloco[] {
  return aplicarAjustes([...blocosTecnicos(f), ...blocosUsuario(f)], ajustes, f);
}
