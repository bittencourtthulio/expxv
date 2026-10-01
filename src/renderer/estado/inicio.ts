import { useSyncExternalStore } from "react";
import type { Mission } from "../../compartilhado/dominio";
import type { TelaId } from "../casca/telas";
import { missaoTerminal, storeMissoes, type EstadoMis } from "./missoes";
import { storeMetodo, type EstadoMetodo } from "./metodo";
import { storeTerminais, type EstadoTerminais } from "./terminais";
import { storeWorkspaces, type EstadoWs } from "./workspaces";

const TETO = 6;

export interface ItemInicio {
  id: string;
  titulo: string;
  detalhe: string;
  /** tela para onde o item leva. */
  destino: TelaId;
}

export type PassoPrimeiroUso = "projeto" | "metodo" | "missao";

export interface DadosInicio {
  /** há workspace aberto. */
  temProjeto: boolean;
  /** primeiro uso: passo que falta (null = já está em uso). */
  proximoPasso: PassoPrimeiroUso | null;
  missoes: ItemInicio[];
  aguardando: ItemInicio[];
  bloqueios: ItemInicio[];
  eventos: ItemInicio[];
  /** o método ainda não respondeu (dados parciais). */
  carregando: boolean;
}

interface Fonte<T> { obter(): T; assinar(o: () => void): () => void }
export interface Fontes {
  terminais: Fonte<Pick<EstadoTerminais, "sessoes" | "ferramentas">>;
  missoes: Fonte<Pick<EstadoMis, "itens" | "carregado">>;
  metodo: Fonte<Pick<EstadoMetodo, "indice" | "carregado">>;
  workspaces: Fonte<Pick<EstadoWs, "atual" | "carregado">>;
}

const PR_ENCERRADO = /merg|clos|fechad|conclu/i;
const limitar = <T,>(l: T[]): T[] => l.slice(0, TETO);

export function derivarInicio(t: ReturnType<Fontes["terminais"]["obter"]>, m: ReturnType<Fontes["missoes"]["obter"]>, x: ReturnType<Fontes["metodo"]["obter"]>, w: ReturnType<Fontes["workspaces"]["obter"]>): DadosInicio {
  const ativas: Mission[] = m.itens.filter((i) => !missaoTerminal(i.estado));
  const trabalhos = x.indice?.trabalhos ?? [];

  const aguardando: ItemInicio[] = [];
  for (const s of t.sessoes) {
    if (s.estado === "executando" && s.atividade === "aguardando") {
      const nome = t.ferramentas?.find((f) => f.id === s.ferramenta_id)?.nome ?? s.ferramenta_id;
      aguardando.push({ id: `painel-${s.sessao_id}`, titulo: `Painel #${s.numero} · ${nome}`, detalhe: "Aguarda você", destino: "terminais" });
    }
  }
  for (const tr of trabalhos) {
    if (tr.prodx !== null && tr.prodx.veredito !== null && !tr.prodx.assinado) {
      aguardando.push({ id: `veredito-${tr.id}`, titulo: `Veredito sem assinatura · ${tr.titulo}`, detalhe: `Veredito: ${tr.prodx.veredito}`, destino: "metodo" });
    }
    if (tr.entrega?.pr_url && !PR_ENCERRADO.test(tr.entrega.pr_estado ?? "")) {
      aguardando.push({ id: `pr-${tr.id}`, titulo: `PR aberto · ${tr.titulo}`, detalhe: tr.entrega.branch ?? tr.entrega.pr_url, destino: "metodo" });
    }
  }

  const bloqueios: ItemInicio[] = trabalhos.flatMap((tr) =>
    tr.bloqueios.filter((b) => b.aberto).map((b) => ({ id: `bloqueio-${tr.id}-${b.id}`, titulo: `${b.id} · ${tr.titulo}`, detalhe: b.descricao, destino: "metodo" as const })));

  const eventos: ItemInicio[] = trabalhos
    .filter((tr) => tr.ultima_atividade !== null)
    .sort((a, b) => (b.ultima_atividade as string).localeCompare(a.ultima_atividade as string))
    .map((tr) => ({ id: `evento-${tr.id}`, titulo: tr.titulo, detalhe: `${tr.ferramenta} · estágio ${tr.estagio} · ${tr.ultima_atividade}`, destino: "metodo" as const }));

  const temProjeto = w.atual !== null;
  const metodoInstalado = x.indice?.camadas.lock === true;
  let proximoPasso: PassoPrimeiroUso | null = null;
  if (w.carregado) {
    if (!temProjeto) proximoPasso = "projeto";
    else if (x.carregado && !metodoInstalado) proximoPasso = "metodo";
    else if (x.carregado && m.carregado && m.itens.length === 0 && trabalhos.length === 0) proximoPasso = "missao";
  }

  return {
    temProjeto,
    proximoPasso,
    missoes: limitar(ativas.map((i) => ({ id: i.id, titulo: i.titulo, detalhe: i.estado, destino: "missoes" as const }))),
    aguardando: limitar(aguardando),
    bloqueios: limitar(bloqueios),
    eventos: limitar(eventos),
    carregando: temProjeto && !x.carregado,
  };
}

/** Store derivado: assina as fontes só enquanto há ouvinte; nada de consulta própria (dados por eventos dos stores). */
export function criarStoreInicio(f: Fontes) {
  const ouvintes = new Set<() => void>();
  let cancelar: (() => void)[] = [];
  let ultimo = "";
  let dados: DadosInicio = derivarInicio(f.terminais.obter(), f.missoes.obter(), f.metodo.obter(), f.workspaces.obter());
  ultimo = JSON.stringify(dados);

  const recalcular = (): boolean => {
    const novo = derivarInicio(f.terminais.obter(), f.missoes.obter(), f.metodo.obter(), f.workspaces.obter());
    const assinatura = JSON.stringify(novo);
    if (assinatura === ultimo) return false;
    ultimo = assinatura;
    dados = novo;
    return true;
  };
  const aoMudar = () => { if (recalcular()) ouvintes.forEach((o) => o()); };

  return {
    obter: (): DadosInicio => { if (ouvintes.size === 0) recalcular(); return dados; },
    assinar(o: () => void): () => void {
      if (ouvintes.size === 0) {
        recalcular();
        cancelar = [f.terminais.assinar(aoMudar), f.missoes.assinar(aoMudar), f.metodo.assinar(aoMudar), f.workspaces.assinar(aoMudar)];
      }
      ouvintes.add(o);
      return () => {
        ouvintes.delete(o);
        if (ouvintes.size === 0) { cancelar.forEach((c) => c()); cancelar = []; }
      };
    },
  };
}

export type StoreInicio = ReturnType<typeof criarStoreInicio>;
export const storeInicio: StoreInicio = criarStoreInicio({ terminais: storeTerminais, missoes: storeMissoes, metodo: storeMetodo, workspaces: storeWorkspaces });

export function useInicio(store: StoreInicio = storeInicio): DadosInicio {
  return useSyncExternalStore(store.assinar, store.obter);
}
