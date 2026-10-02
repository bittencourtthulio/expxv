// T-18.26: daily gerada dos FATOS ([último dia útil -> agora]), por membro/agente. Nunca inventa: sem atividade => "sem atividade registrada".
// Saídas: texto curto (sem formatação, para chat) e Markdown. Observação humana por linha fica na cerimônia salva.
import type { ConfigAgil, MembroAgil } from "../../../compartilhado/agil";
import type { EventoRastro } from "../../metodo/tipos";
import { detectarAtrasadas } from "../eventos";
import type { ItemMetrica } from "../metricas/dados";
import { diaDe, diaParaMs, diaUtilAnterior, isoDe, ms, truncar } from "../util";

export interface LinhaDaily { ref: string; texto: string; observacao: string | null }
export interface BlocoMembro { membro_id: string | null; rotulo: string; ontem: LinhaDaily[]; hoje: LinhaDaily[]; bloqueios: LinhaDaily[]; atrasos: LinhaDaily[]; riscos: LinhaDaily[] }
export interface Daily { data: string; desde: string; gerada_em: string; membros: BlocoMembro[]; sem_atividade: boolean; texto_curto: string; markdown: string }
export interface EntradaDaily {
  itens: readonly ItemMetrica[];
  membros: readonly MembroAgil[];
  rastro: readonly (EventoRastro & { membro_id?: string | null })[];
  bloqueios_abertos: readonly { task: string | null; trabalho_id: string; descricao: string }[];
  agora: number;
  config: Pick<ConfigAgil, "dias_uteis" | "feriados">;
}

const L = (ref: string, texto: string): LinhaDaily => ({ ref, texto: truncar(texto, 160), observacao: null });

export function gerarDaily(e: EntradaDaily): Daily {
  const hoje = diaDe(isoDe(e.agora));
  const desde = diaUtilAnterior(hoje, e.config);
  const desdeMs = diaParaMs(desde);
  const rotulos = new Map(e.membros.map((m) => [m.id, m.rotulo]));
  const blocos = new Map<string, BlocoMembro>();
  const bloco = (id: string | null): BlocoMembro => {
    const k = id ?? "_sem_dono";
    let b = blocos.get(k);
    if (!b) { b = { membro_id: id, rotulo: id ? rotulos.get(id) ?? id : "Sem dono", ontem: [], hoje: [], bloqueios: [], atrasos: [], riscos: [] }; blocos.set(k, b); }
    return b;
  };
  const porRef = new Map(e.itens.map((i) => [`${i.trabalho_id}|${i.task_ref}`, i]));
  const eventosDe = (tipo: string): (EventoRastro & { membro_id?: string | null })[] => e.rastro.filter((x) => x.evento === tipo && (ms(x.ts) ?? -1) >= desdeMs && (ms(x.ts) ?? Infinity) <= e.agora);
  for (const i of e.itens) if (i.concluida_em && (ms(i.concluida_em) ?? -1) >= desdeMs && (ms(i.concluida_em) as number) <= e.agora) bloco(i.membro_id).ontem.push(L(i.ref, `Concluída: ${i.titulo}`));
  for (const x of eventosDe("commit_criado")) { const i = porRef.get(`${x.trabalho_id}|${x.task}`); bloco(i?.membro_id ?? x.membro_id ?? null).ontem.push(L(`${x.trabalho_id}/${x.task ?? ""}`, `Commit: ${x.detalhe || "sem mensagem"}`)); }
  for (const x of eventosDe("pr_aberto")) { const i = porRef.get(`${x.trabalho_id}|${x.task}`); bloco(i?.membro_id ?? null).ontem.push(L(`${x.trabalho_id}/${x.task ?? ""}`, `PR aberto${x.detalhe ? `: ${x.detalhe}` : ""}`)); }
  for (const x of eventosDe("veredito_emitido")) bloco(null).ontem.push(L(x.trabalho_id, `Veredito emitido: ${x.resultado}`));
  for (const i of e.itens) if (i.estado_fluxo === "em_andamento") bloco(i.membro_id).hoje.push(L(i.ref, `Em andamento: ${i.titulo}`));
  const idsConcl = new Set(e.itens.filter((i) => i.estado_fluxo === "concluida" || i.estado_fluxo === "validada").map((i) => i.ref));
  for (const i of e.itens.filter((x) => x.estado_fluxo === "pronto" && !x.descartado).slice(0, 50)) {
    if (i.depende_de.every((d) => idsConcl.has(`${i.trabalho_id}/${d}`))) bloco(i.membro_id).hoje.push(L(i.ref, `Próxima: ${i.titulo}`));
  }
  for (const b of e.bloqueios_abertos) { const i = porRef.get(`${b.trabalho_id}|${b.task}`); bloco(i?.membro_id ?? null).bloqueios.push(L(`${b.trabalho_id}/${b.task ?? ""}`, `Bloqueio: ${b.descricao}`)); }
  for (const a of detectarAtrasadas(e.itens, e.agora).atrasadas) bloco(a.item.membro_id).atrasos.push(L(a.item.ref, `Atrasada (${Math.round(a.idade_ms / 3_600_000)} h em andamento): ${a.item.titulo}`));
  for (const i of e.itens) if (i.estado_fluxo === "em_andamento" && (i.risco === "alto" || i.risco === "critico")) bloco(i.membro_id).riscos.push(L(i.ref, `Risco ${i.risco}: ${i.titulo}`));

  const membros = [...blocos.values()].sort((a, b) => (a.membro_id === null ? 1 : 0) - (b.membro_id === null ? 1 : 0) || a.rotulo.localeCompare(b.rotulo));
  const sem = membros.every((m) => m.ontem.length + m.hoje.length + m.bloqueios.length + m.atrasos.length + m.riscos.length === 0);
  const sec = (nome: string, ls: LinhaDaily[]): string => `${nome}: ${ls.length ? ls.map((l) => l.texto).join("; ") : "sem atividade registrada"}`;
  const curto = sem ? `Daily ${hoje}: sem atividade registrada.` : [`Daily ${hoje}`, ...membros.flatMap((m) => [`${m.rotulo}`, `  ${sec("Ontem", m.ontem)}`, `  ${sec("Hoje", m.hoje)}`, `  ${sec("Bloqueios", m.bloqueios)}`, ...(m.atrasos.length ? [`  ${sec("Atrasos", m.atrasos)}`] : []), ...(m.riscos.length ? [`  ${sec("Riscos", m.riscos)}`] : [])])].join("\n");
  const md = (nome: string, ls: LinhaDaily[]): string[] => [`**${nome}**`, ...(ls.length ? ls.map((l) => `- ${l.texto}`) : ["- sem atividade registrada"])];
  const markdown = sem ? `# Daily ${hoje}\n\nSem atividade registrada.\n` : [`# Daily ${hoje}`, "", ...membros.flatMap((m) => [`## ${m.rotulo}`, ...md("Ontem", m.ontem), ...md("Hoje", m.hoje), ...md("Bloqueios", m.bloqueios), ...(m.atrasos.length ? md("Atrasos", m.atrasos) : []), ...(m.riscos.length ? md("Riscos", m.riscos) : []), ""])].join("\n");
  return { data: hoje, desde, gerada_em: isoDe(e.agora), membros, sem_atividade: sem, texto_curto: curto, markdown };
}
