// Máquina de humor do Bichinho (D-464): PURA, sem relógio, sem timer, sem I/O. Recebe eventos que o app já produz (Pane, Missão, Executar, cota,
// alertas) e responde "qual o humor agora?" e "quando ele muda sozinho?". Quem agenda (um único setTimeout por workspace) é o serviço.
// Adaptada da máquina `Rastro`/`humorDe` do personagem de referência (conjuntos de trabalhando/aguardando, janela de comemoração, sono),
// ampliada com pensando, curioso e preocupado, e com debounce por "segurar" (o trabalho não pisca entre dois turnos colados).
import type { HumorId } from "../../compartilhado/bichinho";

/** Só dorme depois de inatividade REAL (sem saída, entrada nem consumo): 5 min. Qualquer pulso de atividade renova o relógio. */
export const DORMIR_APOS_MS = 5 * 60_000;
/** Quanto o fluxo de saída (nível ≥ 2) sustenta o humor "trabalhando" sem precisar do estado do Pane (CLI sem adaptador). */
export const FLUXO_SEGURA_MS = 2_500;
export const COMEMORAR_PANE_MS = 2_500;
export const COMEMORAR_MISSAO_MS = 6_000;
/** Só comemora o Pane que trabalhou pelo menos isso (o histórico reexibido em rajada ao abrir o app não conta). */
export const TRABALHO_MINIMO_MS = 3_000;
export const PREOCUPADO_MS = 90_000;
export const PENSANDO_MS = 20_000;
export const CURIOSO_MS = 2_500;
/** Debounce: depois do último Pane parar de trabalhar o humor segue "trabalhando" por este tempo (turnos colados não piscam). */
export const SEGURAR_TRABALHO_MS = 800;
/** Cota ≥ este percentual = sinal de saúde "doente" (Fase 9); expira se nenhum aviso novo chegar. */
export const LIMITE_DOENTE_PCT = 85;
export const DOENTE_EXPIRA_MS = 30 * 60_000;

export type EstadoPaneEvento = "iniciando" | "pronto" | "trabalhando" | "aguardando" | "bloqueado" | "encerrado";

export type EventoHumor =
  | { tipo: "pane"; id: string; estado: EstadoPaneEvento }
  | { tipo: "pane_fechado"; id: string; motivo: string }
  | { tipo: "missao"; resultado: "iniciada" | "concluida" | "falhou" | "abortada" }
  | { tipo: "execucao"; resultado: "iniciada" | "sucesso" | "falha" | "parada" }
  | { tipo: "limite"; pct: number }
  | { tipo: "alerta"; severidade: "info" | "sucesso" | "aviso" | "critico" }
  /** pulso de atividade medido (saída do PTY, entrada, tokens): nível instantâneo 0–4 e se há fluxo de verdade (nível bruto ≥ 2). `atividade_em` = último instante com saída/entrada/consumo (0 = nenhum). */
  | { tipo: "pulso"; nivel: number; fluxo: boolean; atividade_em: number }
  /** clique ou foco no bichinho / troca de workspace: acorda e fica curioso por um instante. */
  | { tipo: "atencao" };

export interface Rastro {
  trabalhando: ReadonlySet<string>;
  aguardando: ReadonlySet<string>;
  inicio: ReadonlyMap<string, number>;
  segurarAte: number;
  pensandoAte: number;
  celebrarAte: number;
  preocupadoAte: number;
  curiosoAte: number;
  doenteAte: number;
  ultimaAtividade: number;
  /** o fluxo de saída sustenta "trabalhando" até aqui (CLI sem adaptador de atividade). */
  fluxoAte: number;
  /** nível de esforço atual (0–4, já com histerese). */
  esforco: number;
}

export const rastroInicial = (agora: number): Rastro => ({
  trabalhando: new Set(), aguardando: new Set(), inicio: new Map(), segurarAte: 0, pensandoAte: 0, celebrarAte: 0, preocupadoAte: 0, curiosoAte: 0, doenteAte: 0, ultimaAtividade: agora, fluxoAte: 0, esforco: 0,
});

const FALHAS_DE_PANE = /^(falha_ao_abrir|sessao_morreu|erro)/;

/** Nova leitura do rastro depois de um evento; devolve o MESMO objeto quando o evento não muda nada. */
export function aplicar(r: Rastro, e: EventoHumor, agora: number): Rastro {
  const trabalhando = new Set(r.trabalhando);
  const aguardando = new Set(r.aguardando);
  const inicio = new Map(r.inicio);
  const n = { ...r, trabalhando, aguardando, inicio };
  switch (e.tipo) {
    case "pane": {
      n.ultimaAtividade = agora;
      if (e.estado === "trabalhando") {
        trabalhando.add(e.id);
        aguardando.delete(e.id);
        if (!inicio.has(e.id)) inicio.set(e.id, agora);
        n.pensandoAte = 0;
      } else if (e.estado === "aguardando" || e.estado === "bloqueado") {
        trabalhando.delete(e.id);
        aguardando.add(e.id);
      } else if (e.estado === "iniciando") {
        n.pensandoAte = agora + PENSANDO_MS;
      } else {
        const veio = trabalhando.has(e.id);
        const desde = inicio.get(e.id);
        if (e.estado === "pronto" && (veio || aguardando.has(e.id)) && desde !== undefined && agora - desde >= TRABALHO_MINIMO_MS) {
          n.celebrarAte = Math.max(n.celebrarAte, agora + COMEMORAR_PANE_MS);
          n.preocupadoAte = 0;
        }
        if (veio) n.segurarAte = Math.max(n.segurarAte, agora + SEGURAR_TRABALHO_MS);
        trabalhando.delete(e.id);
        aguardando.delete(e.id);
        inicio.delete(e.id);
      }
      break;
    }
    case "pane_fechado": {
      n.ultimaAtividade = agora;
      const tinha = trabalhando.has(e.id) || aguardando.has(e.id);
      trabalhando.delete(e.id);
      aguardando.delete(e.id);
      inicio.delete(e.id);
      if (FALHAS_DE_PANE.test(e.motivo)) n.preocupadoAte = agora + PREOCUPADO_MS;
      else if (!tinha) return r;
      break;
    }
    case "missao":
      n.ultimaAtividade = agora;
      if (e.resultado === "concluida") { n.celebrarAte = Math.max(n.celebrarAte, agora + COMEMORAR_MISSAO_MS); n.preocupadoAte = 0; }
      else if (e.resultado === "falhou") n.preocupadoAte = agora + PREOCUPADO_MS;
      else if (e.resultado === "iniciada") n.pensandoAte = agora + PENSANDO_MS;
      break;
    case "execucao":
      n.ultimaAtividade = agora;
      if (e.resultado === "sucesso") { n.celebrarAte = Math.max(n.celebrarAte, agora + COMEMORAR_PANE_MS); n.preocupadoAte = 0; }
      else if (e.resultado === "falha") n.preocupadoAte = agora + PREOCUPADO_MS;
      else if (e.resultado === "iniciada") n.pensandoAte = agora + PENSANDO_MS;
      break;
    case "limite":
      if (e.pct >= LIMITE_DOENTE_PCT) n.doenteAte = agora + DOENTE_EXPIRA_MS;
      else if (r.doenteAte === 0) return r;
      else n.doenteAte = 0;
      break;
    case "alerta":
      if (e.severidade !== "critico") return r;
      n.ultimaAtividade = agora;
      n.preocupadoAte = agora + PREOCUPADO_MS;
      break;
    case "pulso": {
      const atividade = Math.max(r.ultimaAtividade, e.atividade_em);
      const fluxoAte = e.fluxo ? Math.max(r.fluxoAte, agora + FLUXO_SEGURA_MS) : r.fluxoAte;
      if (atividade === r.ultimaAtividade && fluxoAte === r.fluxoAte && e.nivel === r.esforco) return r;
      n.ultimaAtividade = atividade;
      n.fluxoAte = fluxoAte;
      n.esforco = e.nivel;
      break;
    }
    case "atencao":
      n.ultimaAtividade = agora;
      n.curiosoAte = agora + CURIOSO_MS;
      break;
  }
  return n;
}

/**
 * O humor num instante. Prioridade: aguardando (a pessoa é necessária) > preocupado > trabalhando > pensando > comemorando > curioso > dormindo > ocioso.
 * (Não-trabalho nunca esconde pedido de atenção; erro agudo vence o trabalho para o dono ver que algo quebrou.)
 */
export function humorDe(r: Rastro, agora: number): HumorId {
  if (r.aguardando.size > 0) return "aguardando";
  if (agora < r.preocupadoAte) return "preocupado";
  if (r.trabalhando.size > 0 || agora < r.segurarAte || agora < r.fluxoAte) return "trabalhando";
  if (agora < r.pensandoAte) return "pensando";
  if (agora < r.celebrarAte) return "comemorando";
  if (agora < r.curiosoAte) return "curioso";
  if (r.esforco === 0 && agora - r.ultimaAtividade >= DORMIR_APOS_MS) return "dormindo";
  return "ocioso";
}

export const estaDoente = (r: Rastro, agora: number): boolean => agora < r.doenteAte;

/** Próximo instante em que o humor (ou a saúde) muda sozinho; `null` se nada vai mudar sem novo evento. */
export function proximaMudanca(r: Rastro, agora: number): number | null {
  const candidatos = [r.fluxoAte, r.segurarAte, r.pensandoAte, r.celebrarAte, r.preocupadoAte, r.curiosoAte, r.doenteAte, r.ultimaAtividade + DORMIR_APOS_MS].filter((t) => t > agora);
  if (r.aguardando.size > 0 || r.trabalhando.size > 0) {
    const sem = candidatos.filter((t) => t === r.doenteAte || t === r.preocupadoAte);
    return sem.length === 0 ? null : Math.min(...sem);
  }
  return candidatos.length === 0 ? null : Math.min(...candidatos);
}
