// Coletor de fatos (T-19.05): monta o `FatosSprint` IMUTÁVEL e com hash a partir das portas. Tudo que é texto passa por `limparTexto` (cofre, segredos,
// caminho absoluto, controle). Desconhecido é `null`; custo e duração observada nunca viram zero. Mesmo conjunto de dados => mesmo `hash_fatos`.
import type { FatosSprint, FatoItem, FonteRef, MetricasSprint } from "../../../compartilhado/relatorios";
import type { PortasRelatorios, SprintBruta } from "../portas";
import { limparLinha, limparTexto, urlSegura } from "../seguranca";
import { jsonCanonico, sha256 } from "../util";

const H = 3_600_000;
const MAX_COMMITS = 500;
const MAX_ITENS = 2000;
const CATEGORIAS_VISIVEIS = new Set(["feature", "bug"]);

export const caminhoRelativoSeguro = (c: string): boolean => c.length > 0 && c.length < 300 && !/^([\\/~]|[A-Za-z]:)/.test(c) && !c.split(/[\\/]/).includes("..") && !/[\u0000-\u001f]/.test(c);

export function itemEntregue(i: { resultado: FatoItem["resultado"]; estado_fluxo: string }): boolean {
  return i.resultado === "concluido" || (i.resultado === null && (i.estado_fluxo === "concluida" || i.estado_fluxo === "validada"));
}
const visivel = (v: "auto" | "sim" | "nao", categoria: string | null): boolean => v === "sim" || (v === "auto" && categoria !== null && CATEGORIAS_VISIVEIS.has(categoria));
const h = (ms: number | null | undefined): number | null => (ms === null || ms === undefined ? null : Math.round((ms / H) * 100) / 100);

function metricasDe(s: SprintBruta, itens: FatoItem[]): MetricasSprint {
  const r = s.sprint.resumo_fechamento;
  const p = s.painel;
  const retSprint = p?.retrabalho.por_sprint.find((x) => x.sprint_id === s.sprint.id)?.resumo ?? p?.retrabalho ?? null;
  const planejados = r?.compromisso_inicial ?? s.sprint.compromisso_pontos ?? null;
  const entregues = r?.concluido_pontos ?? null;
  const bloq = s.itens.map((i) => i.fato?.bloqueada_ms ?? null).filter((x): x is number => x !== null);
  return {
    pontos_planejados: planejados,
    pontos_entregues: entregues,
    itens_entregues: itens.filter(itemEntregue).length,
    itens_total: itens.length,
    first_time_right: r?.first_time_right ?? retSprint?.first_time_right ?? null,
    ir: retSprint?.ir ?? null,
    ir_max: retSprint?.ir_max ?? null,
    velocidade_media_movel: p?.velocidade.find((v) => v.sprint_id === s.sprint.id)?.media_movel_3 ?? null,
    cycle_p50_h: h(p?.cycle.p50),
    cycle_p85_h: h(p?.cycle.p85),
    lead_p85_h: h(p?.lead.p85),
    defeitos_escapados: p ? (p.defeitos_escapados.por_sprint.find((d) => d.sprint_id === s.sprint.id)?.n ?? 0) : null,
    bloqueio_h: bloq.length > 0 ? h(bloq.reduce((a, b) => a + b, 0)) : null,
    meta_atingida: entregues !== null && planejados !== null && planejados > 0 ? entregues >= planejados : null,
  };
}

export async function coletarFatos(portas: PortasRelatorios, workspaceId: string, sprintId: string): Promise<{ fatos: FatosSprint; hash: string } | null> {
  const bruta = await portas.agil.sprint(workspaceId, sprintId);
  if (bruta === null) return null;
  const sc = (t: string | null | undefined, max = 200): string => limparLinha(t, portas.scrub, max);
  const avisos: string[] = [];
  const fontes: FonteRef[] = [];
  const s = bruta.sprint;
  fontes.push({ id: `sprint:${s.id}`, rotulo: sc(s.nome, 120), tipo: "sprint", ref: null });

  const itens: FatoItem[] = [];
  const commits: FatosSprint["commits"] = [];
  for (const b of bruta.itens.slice(0, MAX_ITENS)) {
    const categoria = b.resumo.categoria;
    const it: FatoItem = {
      item_id: b.item.id,
      titulo: sc(b.item.titulo, 200) || "Item sem título",
      trabalho_id: b.item.trabalho_id,
      task_ref: b.item.task_ref,
      epico_id: b.item.epico_id,
      categoria,
      risco: b.resumo.risco,
      criticidade: b.resumo.criticidade,
      pontos: b.resumo.pontos,
      estado_fluxo: b.resumo.estado_fluxo,
      resultado: b.resultado,
      duracao_h: h(b.resumo.duracao_obs_ms),
      retrabalho: b.resumo.situacao_retrabalho,
      commits_qtd: b.fato?.commits.length ?? 0,
      pr_url: null,
      visivel_cliente: visivel(b.item.visibilidade_cliente, categoria),
      resumo_cliente: b.item.resumo_cliente ? limparTexto(b.item.resumo_cliente, portas.scrub, 600) : null,
      changelog_tipo: b.item.changelog_tipo,
    };
    itens.push(it);
    fontes.push({ id: `item:${it.item_id}`, rotulo: it.titulo, tipo: "item", ref: it.trabalho_id !== null && it.task_ref !== null ? `${it.trabalho_id}/${it.task_ref}` : null });
    for (const c of b.fato?.commits ?? []) {
      if (c.sha === null || commits.length >= MAX_COMMITS) continue;
      const sha7 = c.sha.slice(0, 7);
      if (!/^[0-9a-f]{7}$/i.test(sha7)) continue;
      commits.push({ sha7: sha7.toLowerCase(), mensagem: sc(c.mensagem, 160), item_id: it.item_id, ts: c.ts });
      fontes.push({ id: `commit:${sha7.toLowerCase()}`, rotulo: `commit ${sha7.toLowerCase()}`, tipo: "commit", ref: null });
    }
  }
  commits.sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? "") || a.sha7.localeCompare(b.sha7));

  // PRs (versionamento): link só http(s) sem credencial
  const trabalhos = [...new Set(itens.map((i) => i.trabalho_id).filter((x): x is string => x !== null))].sort();
  const prsBrutos = trabalhos.length > 0 ? await portas.versionamento.prs(workspaceId, trabalhos).catch(() => null) : [];
  const prs: FatosSprint["prs"] = [];
  for (const p of prsBrutos ?? []) {
    const url = urlSegura(p.url);
    if (url === null) continue;
    prs.push({ trabalho_id: p.trabalho_id, url, estado: p.estado ? sc(p.estado, 30) : null });
    fontes.push({ id: `pr:${p.trabalho_id}`, rotulo: `pull request de ${p.trabalho_id}`, tipo: "pr", ref: p.trabalho_id });
    for (const i of itens) if (i.trabalho_id === p.trabalho_id) i.pr_url = url;
  }
  if (prsBrutos === null && trabalhos.length > 0) avisos.push("Versionamento indisponível: sem links de pull request.");

  // custo
  const tasks = itens.filter((i) => i.trabalho_id !== null && i.task_ref !== null).map((i) => ({ trabalho_id: i.trabalho_id as string, task_ref: i.task_ref as string }));
  const custoBruto = tasks.length > 0 ? await portas.custo.sprint(workspaceId, tasks).catch(() => null) : null;
  const custo: FatosSprint["custo"] = custoBruto ?? { tokens: null, usd: null, estado: "desconhecido" };
  if (custo.estado === "desconhecido") avisos.push("Custo desconhecido: o consumo desta sprint não foi medido.");
  fontes.push({ id: `custo:${s.id}`, rotulo: "custo da sprint", tipo: "custo", ref: null });

  // mapa de código: só caminhos relativos dos itens entregues
  const arquivos = [...new Set(bruta.itens.filter((b) => itemEntregue({ resultado: b.resultado, estado_fluxo: b.resumo.estado_fluxo })).flatMap((b) => b.fato?.arquivos ?? []).filter(caminhoRelativoSeguro))].sort().slice(0, 2000);
  const mapaBruto = arquivos.length > 0 ? await portas.mapa.alteracoes(workspaceId, arquivos).catch(() => null) : null;
  const mapa: FatosSprint["mapa"] = mapaBruto === null ? null : {
    modulos: mapaBruto.modulos.slice(0, 50).map((m) => ({ nome: sc(m.nome, 80), arquivos: m.arquivos })),
    ciclos: mapaBruto.ciclos,
    pontos_quentes: mapaBruto.pontos_quentes.slice(0, 20).map((p) => sc(p, 120)),
  };
  if (mapa === null) avisos.push("Sem mapa de código: as alterações de arquitetura não foram incluídas.");
  else fontes.push({ id: "mapa:modulos", rotulo: "mapa de código", tipo: "mapa", ref: null });

  const metricas = metricasDe(bruta, itens);
  for (const nome of ["pontos", "first_time_right", "retrabalho", "ciclo", "velocidade"]) fontes.push({ id: `metrica:${s.id}/${nome}`, rotulo: `métrica ${nome}`, tipo: "metrica", ref: null });
  const semPontos = itens.filter((i) => i.pontos === null && itemEntregue(i)).length;
  if (semPontos > 0) avisos.push(`${semPontos} item(ns) entregue(s) sem estimativa de pontos.`);
  if (itens.length === 0) avisos.push("A sprint não tem itens.");

  const fatos: FatosSprint = {
    versao_schema: 1,
    sprint: { id: s.id, nome: sc(s.nome, 120), meta: s.meta ? sc(s.meta, 300) : null, inicio: s.inicio, fim: s.fim, versao_lancamento: s.versao_lancamento ? sc(s.versao_lancamento, 40) : null, fechada_em: s.fechada_em },
    itens, commits, prs, metricas, custo, mapa, avisos, fontes: dedupe(fontes),
  };
  return { fatos, hash: hashFatos(fatos) };
}

const dedupe = (f: FonteRef[]): FonteRef[] => [...new Map(f.map((x) => [x.id, x])).values()];
export const hashFatos = (f: FatosSprint): string => sha256(jsonCanonico(f));
