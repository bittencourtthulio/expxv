import { createContext, useContext } from "react";
import type { Mission } from "../../../compartilhado/dominio";
import type { AlvoVcs, ApiVcs, EstadoVcs } from "../../../compartilhado/vcs";

export interface CtxVcs {
  api: ApiVcs;
  alvo: AlvoVcs;
  estado: EstadoVcs;
  /** Recarrega o estado completo (as ações já chamam depois de escrever). */
  recarregar: () => Promise<void>;
  /** Roda uma ação do usuário: erro vira faixa `role="alert"`; devolve undefined em falha. */
  rodar: <T>(f: () => Promise<T>) => Promise<T | undefined>;
  /** Mensagem informativa (região viva). */
  avisar: (texto: string) => void;
  /** Missão da árvore escolhida (null = árvore do workspace). */
  missao: Mission | null;
  /** Abre o visualizador de diff de um commit (ex.: clique no histórico ou na Missão). */
  abrirCommit: (hash: string) => void;
  /** Muda de aba por código. */
  irPara: (aba: AbaVcs) => void;
}

export type AbaVcs = "mudancas" | "branches" | "historico" | "prs" | "conflitos";

export const Ctx = createContext<CtxVcs | null>(null);

export function useVcs(): CtxVcs {
  const c = useContext(Ctx);
  if (c === null) throw new Error("useVcs fora do provedor da tela Versionamento");
  return c;
}

export const mensagemDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));
