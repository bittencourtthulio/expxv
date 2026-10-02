// Máquina de ciclo de vida do painel de progresso (PURA: relógio entra como `agora`; efeitos saem como dados). Regras (D-662):
//  - ABRE quando um progresso passa a "em andamento"/"aguardando" e fica fixo enquanto executa;
//  - concluído: mostra o resumo por `RESUMO_MS`, anima o fechamento e FECHA sozinho, deixando um toast "Ver resumo" (leitura por `LEITURA_MS`);
//  - falha ou aguardando humano: NÃO fecha sozinho (fica até o dono dispensar); cancelado e progresso que sumiu fecham em silêncio;
//  - "Fixar aberto" mantém o resumo à vista; dispensar vale só para aquele progresso; feature desligada esconde tudo;
//  - só o workspace atual aparece; os demais seguem acompanhados em segundo plano.
import { ANIMACAO_FECHAR_MS, LEITURA_MS, RESUMO_MS, type Progresso } from "../../compartilhado/progresso";
import { resumoDoProgresso } from "./formato";

export type FaseCiclo = "ativo" | "resumo" | "falha" | "fechando" | "leitura" | "oculto";

export interface EntradaCiclo {
  progresso: Progresso;
  fase: FaseCiclo;
  fixado: boolean;
  recolhido: boolean;
  dispensado: boolean;
  /** prazo (ms) da próxima transição automática; `null` = nenhuma. */
  ate: number | null;
  /** fecha sem toast (cancelado, sumiu, segundo plano, fim da leitura). */
  silencioso: boolean;
}
export interface EstadoCiclo {
  ligado: boolean;
  workspace_id: string | null;
  itens: Readonly<Record<string, EntradaCiclo>>;
}
export type EventoCiclo =
  | { tipo: "estado"; progressos: readonly Progresso[]; agora: number }
  | { tipo: "tick"; agora: number }
  | { tipo: "dispensar"; id: string }
  | { tipo: "fixar"; id: string; fixado: boolean; agora: number }
  | { tipo: "recolher"; id: string; recolhido: boolean }
  | { tipo: "ligar"; ligado: boolean }
  | { tipo: "workspace"; id: string | null }
  | { tipo: "ver_resumo"; id: string; agora: number };
export interface EfeitoToast {
  tipo: "toast";
  id: string;
  texto: string;
}
export interface SaidaCiclo {
  estado: EstadoCiclo;
  efeitos: EfeitoToast[];
}

export const CICLO_INICIAL: EstadoCiclo = { ligado: true, workspace_id: null, itens: {} };

const viva = (p: Progresso): boolean => p.resultado === "em_andamento" || p.resultado === "aguardando";

function nova(p: Progresso, agora: number): EntradaCiclo | null {
  const base = { progresso: p, fixado: p.fixado === true, recolhido: false, dispensado: p.dispensado === true, silencioso: false };
  if (base.dispensado) return { ...base, fase: "oculto", ate: null };
  if (viva(p)) return { ...base, fase: "ativo", ate: null };
  if (p.resultado === "falhou") return { ...base, fase: "falha", ate: null };
  if (p.resultado === "concluido") return { ...base, fase: "resumo", ate: base.fixado ? null : agora + RESUMO_MS };
  return null; // cancelado e primeiro avistamento: nada a mostrar
}

function atualizar(c: EntradaCiclo, p: Progresso, agora: number): EntradaCiclo {
  const e: EntradaCiclo = { ...c, progresso: p };
  if (c.dispensado) return { ...e, fase: "oculto", ate: null };
  switch (c.fase) {
    case "ativo":
      if (p.resultado === "concluido") return { ...e, fase: "resumo", ate: c.fixado ? null : agora + RESUMO_MS };
      if (p.resultado === "falhou") return { ...e, fase: "falha", ate: null };
      if (p.resultado === "cancelado") return { ...e, fase: "fechando", ate: agora + ANIMACAO_FECHAR_MS, silencioso: true };
      return e;
    case "falha":
      if (viva(p)) return { ...e, fase: "ativo", ate: null };
      if (p.resultado === "concluido") return { ...e, fase: "resumo", ate: c.fixado ? null : agora + RESUMO_MS };
      return e;
    default:
      // resumo, fechando, leitura, oculto: só volta se o progresso recomeçou (etapa reaberta, nova rodada)
      return viva(p) ? { ...e, fase: "ativo", ate: null, silencioso: false } : e;
  }
}

export function reduzir(estado: EstadoCiclo, ev: EventoCiclo): SaidaCiclo {
  const efeitos: EfeitoToast[] = [];
  const com = (itens: Record<string, EntradaCiclo>): SaidaCiclo => ({ estado: { ...estado, itens }, efeitos });
  const itens: Record<string, EntradaCiclo> = { ...estado.itens };
  switch (ev.tipo) {
    case "estado": {
      const vistos = new Set<string>();
      for (const p of ev.progressos) {
        vistos.add(p.id);
        const atual = itens[p.id];
        if (atual === undefined) {
          const n = nova(p, ev.agora);
          if (n !== null) itens[p.id] = n;
        } else itens[p.id] = atualizar(atual, p, ev.agora);
      }
      for (const [id, c] of Object.entries(itens)) {
        if (vistos.has(id)) continue;
        if (c.fase === "oculto") delete itens[id];
        else if (c.fase === "ativo" || c.fase === "falha") itens[id] = { ...c, fase: "fechando", ate: ev.agora + ANIMACAO_FECHAR_MS, silencioso: true };
      }
      return com(itens);
    }
    case "tick": {
      for (const [id, c] of Object.entries(itens)) {
        if (c.ate === null || ev.agora < c.ate) continue;
        if (c.fase === "resumo") itens[id] = { ...c, fase: "fechando", ate: ev.agora + ANIMACAO_FECHAR_MS };
        else if (c.fase === "leitura") itens[id] = { ...c, fase: "fechando", ate: ev.agora + ANIMACAO_FECHAR_MS, silencioso: true };
        else if (c.fase === "fechando") {
          itens[id] = { ...c, fase: "oculto", ate: null };
          if (!c.silencioso && c.progresso.resultado === "concluido" && c.progresso.workspace_id === estado.workspace_id) {
            efeitos.push({ tipo: "toast", id, texto: `${c.progresso.titulo} · ${resumoDoProgresso(c.progresso)}` });
          }
        } else itens[id] = { ...c, ate: null };
      }
      return com(itens);
    }
    case "dispensar": {
      const c = itens[ev.id];
      if (c !== undefined) itens[ev.id] = { ...c, fase: "oculto", dispensado: true, ate: null };
      return com(itens);
    }
    case "fixar": {
      const c = itens[ev.id];
      if (c === undefined) return com(itens);
      let ate = c.ate;
      if (c.fase === "resumo") ate = ev.fixado ? null : ev.agora + RESUMO_MS;
      itens[ev.id] = { ...c, fixado: ev.fixado, ate };
      return com(itens);
    }
    case "recolher": {
      const c = itens[ev.id];
      if (c !== undefined) itens[ev.id] = { ...c, recolhido: ev.recolhido };
      return com(itens);
    }
    case "ver_resumo": {
      const c = itens[ev.id];
      if (c !== undefined && !c.dispensado) itens[ev.id] = { ...c, fase: "leitura", ate: ev.agora + LEITURA_MS, silencioso: true, recolhido: false };
      return com(itens);
    }
    case "ligar":
      return { estado: { ...estado, ligado: ev.ligado }, efeitos };
    case "workspace":
      return { estado: { ...estado, workspace_id: ev.id }, efeitos };
  }
}

/** Quando a máquina precisa do próximo `tick` (o menor prazo pendente); `null` = nenhum timer deve existir. */
export function proximoPrazo(estado: EstadoCiclo): number | null {
  let menor: number | null = null;
  for (const c of Object.values(estado.itens)) if (c.ate !== null && (menor === null || c.ate < menor)) menor = c.ate;
  return menor;
}

/** O que a tela mostra: workspace atual, feature ligada, fase diferente de oculto; ordem de chegada. */
export function visiveis(estado: EstadoCiclo): EntradaCiclo[] {
  if (!estado.ligado) return [];
  return Object.values(estado.itens)
    .filter((c) => c.fase !== "oculto" && c.progresso.workspace_id === estado.workspace_id)
    .sort((a, b) => a.progresso.iniciado_em - b.progresso.iniciado_em || (a.progresso.id < b.progresso.id ? -1 : 1));
}

/** Etapa N/M de um workspace para o indicador do card ("etapa 4/9"): o progresso vivo mais antigo; `null` = nenhum. */
export function indicadorDoWorkspace(estado: EstadoCiclo, workspaceId: string): { feitos: number; total: number; aguardando: boolean; falhou: boolean } | null {
  if (!estado.ligado) return null;
  const vivos = Object.values(estado.itens).filter((c) => c.progresso.workspace_id === workspaceId && (c.fase === "ativo" || c.fase === "falha"));
  const c = vivos.sort((a, b) => a.progresso.iniciado_em - b.progresso.iniciado_em)[0];
  if (c === undefined) return null;
  const aplicaveis = c.progresso.itens.filter((i) => i.estado !== "pulado");
  return { feitos: aplicaveis.filter((i) => i.estado === "concluido").length, total: aplicaveis.length, aguardando: c.progresso.resultado === "aguardando", falhou: c.progresso.resultado === "falhou" };
}
