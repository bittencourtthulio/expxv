import type { CorSinaleira, EventoRastro, Sinaleira, Trabalho } from "./tipos";

export interface OpcoesSinaleira {
  /** janela de "recente" (atividade, regra_violada, acao_bloqueada). Padrão 24 h. */
  limiteRecenteMs?: number;
  /** task em andamento sem nenhum evento por mais que isso vira amarelo. Padrão 4 h. */
  limiteTaskParadaMs?: number;
}

const HORA = 3_600_000;

function paraMs(valor: string | null, agora: number): number | null {
  if (!valor) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    // só data: vale o fim do dia, sem passar do presente
    const fim = Date.parse(`${valor}T23:59:59Z`);
    return Number.isNaN(fim) ? null : Math.min(fim, agora);
  }
  const ms = Date.parse(valor);
  return Number.isNaN(ms) ? null : ms;
}

function duracaoTexto(ms: number): string {
  const h = ms / HORA;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} dias`;
}

/**
 * Sinaleira do trabalho (F-… §5.3), derivada só de dado observável. A cor nunca é o único dado:
 * sempre há `motivo` (o mais grave) e `motivos` (todos). O tempo citado é de parede, não esforço.
 */
export function calcularSinaleira(t: Trabalho, eventos: EventoRastro[], agora: number, opcoes: OpcoesSinaleira = {}): Sinaleira {
  const recenteMs = opcoes.limiteRecenteMs ?? 24 * HORA;
  const paradaMs = opcoes.limiteTaskParadaMs ?? 4 * HORA;
  const vermelhos: string[] = [];
  const amarelos: string[] = [];

  const tsEventos = eventos.map((e) => Date.parse(e.ts)).filter((n) => !Number.isNaN(n));
  const ultimoEvento = tsEventos.length > 0 ? Math.max(...tsEventos) : null;
  const ultima = ultimoEvento ?? paraMs(t.ultima_atividade, agora);
  const recente = (ts: string): boolean => {
    const ms = Date.parse(ts);
    return !Number.isNaN(ms) && agora - ms <= recenteMs;
  };
  const tasks = t.sprints.flatMap((s) => s.fases.flatMap((f) => f.tasks));
  const emAndamento = tasks.filter((x) => x.status === "em_andamento");
  const algumaIniciada = tasks.some((x) => x.status !== "pendente");
  const tipos = new Set(t.violacoes.map((x) => x.tipo));

  // ---- vermelho
  const abertos = t.bloqueios.filter((b) => b.aberto);
  if (abertos.length > 0) vermelhos.push(`bloqueio aberto: ${abertos.map((b) => b.id).join(", ")}`);
  if (eventos.some((e) => e.evento === "acao_bloqueada" && recente(e.ts))) vermelhos.push("acao bloqueada por hook recentemente");
  if (t.entrega?.portao === "bloqueado") vermelhos.push("portao de prontidao da entrega bloqueado");
  if (t.veredito_qa === "reprovado") vermelhos.push("QA reprovado");
  if (tipos.has("ciclo_dependencia")) vermelhos.push("ciclo de dependencia no plano");
  if (tipos.has("dependencia_inexistente")) vermelhos.push("dependencia inexistente no plano");
  if (tipos.has("concluida_sem_verde")) vermelhos.push("task concluida sem suite verde");
  if (t.veredito_auditoria === "nao" && algumaIniciada) vermelhos.push("auditoria disse NAO e a execucao seguiu sem replanejar");

  // ---- amarelo (aguardando humano ou sinal de atenção)
  if (t.veredito_auditoria === "nao" && !algumaIniciada) amarelos.push("auditoria reprovou o plano: replanejar antes de executar");
  if (t.prodx && t.prodx.veredito && !t.prodx.assinado) amarelos.push("veredito do prodx aguarda assinatura humana");
  if (t.prodx && t.prodx.assinado && !t.prodx.briefing && (t.prodx.veredito === "fazer" || t.prodx.veredito === "fazer_outra_coisa")) {
    amarelos.push("veredito assinado sem briefing gerado");
  }
  if (t.raio && t.raio.faixa === "alto" && !t.raio.aprovado) amarelos.push("raio ALTO sem aprovacao humana registrada");
  if (t.entrega?.pr_estado === "aberto") amarelos.push("pull request aberto aguardando revisao");
  if (t.decisoes_pendentes > 0) amarelos.push(`${t.decisoes_pendentes} decisao(oes) pendente(s) aguardando resposta`);
  if (eventos.some((e) => e.evento === "regra_violada" && recente(e.ts))) amarelos.push("regra violada recentemente (hook em aviso)");
  if (tasks.some((x) => x.suite === "vermelha" && x.status !== "concluida")) amarelos.push("suite vermelha em task aberta");
  if (t.features.some((f) => f.status === "bloqueada")) amarelos.push("ha feature bloqueada no projeto");
  if (emAndamento.length > 0 && ultimoEvento !== null && agora - ultimoEvento > paradaMs) {
    amarelos.push(`task ${emAndamento[0]?.id ?? ""} em andamento sem evento ha ${duracaoTexto(agora - ultimoEvento)} (tempo de parede, nao esforco)`);
  }

  const resultado = (cor: CorSinaleira, motivos: string[]): Sinaleira => ({ cor, motivo: motivos[0] ?? "", motivos });
  if (vermelhos.length > 0) return resultado("vermelho", [...vermelhos, ...amarelos]);
  if (amarelos.length > 0) return resultado("amarelo", amarelos);
  if (t.status === "concluido") return resultado("verde", ["trabalho concluido"]);
  if (t.status === "nao_iniciado") return resultado("cinza", ["trabalho nao iniciado"]);

  // ---- verde (em andamento, sem alertas) ou cinza (parado)
  if (ultima !== null && agora - ultima <= recenteMs) {
    return resultado("verde", [emAndamento.length > 0 ? `em andamento: ${emAndamento[0]?.id ?? ""} em execucao, atividade recente` : "em andamento, atividade recente, sem alertas"]);
  }
  return resultado("cinza", [ultima === null ? "sem atividade registrada" : `sem atividade ha ${duracaoTexto(agora - ultima)}`]);
}
