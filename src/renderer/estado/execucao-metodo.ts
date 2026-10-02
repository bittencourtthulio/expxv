// "Ir para o Pane ao disparar" (D-610/D-611): depois que um gesto do Método envia um comando a um terminal, o app leva a pessoa à tela Terminais e foca o painel
// que recebeu o comando. Este store guarda (1) o que está em execução, para a faixa "Executando: …" da tela Terminais; (2) a preferência "Ir para o terminal ao
// disparar" (padrão ligado; chave `metodo_ir_ao_terminal`); (3) o rascunho do pedido por workspace, para "Voltar ao Método" não perder o que foi digitado.
// A navegação reutiliza `pedirFocoSessao`/`pedirTela` (a tela Terminais decide onde o painel está; o isolamento por workspace é dela).
import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import type { ResultadoDisparo } from "../../compartilhado/dominio";
import { PRODUTO } from "../../nucleo/produto";
import { ade } from "../ade";
import { pedirFocoSessao, pedirTela } from "./navegacao";

export const CHAVE_IR_AO_TERMINAL = "metodo_ir_ao_terminal";
const CHAVE_RASCUNHO = `${PRODUTO.id}.metodo.rascunho.`;
const RESUMO_MAX = 90;

/** D-620: só "entregue" conta como enviado (o Pane criado não basta). Sem `estado` (dublê antigo), vale `ok`. */
export const entregue = (r: Pick<ResultadoDisparo, "ok" | "estado">): boolean => (r.estado !== undefined ? r.estado === "entregue" : r.ok);

export interface ExecucaoMetodo {
  workspaceId: string;
  /** nome do gesto na voz da tela: "Nova feature", "Gerar convenções"… */
  rotulo: string;
  /** o pedido, resumido em uma linha (null quando o gesto não tem pedido) */
  resumo: string | null;
  comando: string | null;
  paneId: string | null;
  sessaoId: string | null;
}

export interface RascunhoPedido { texto: string; gesto: string }

/** Uma entrega ao agente, contada como mensagem da conversa do Método (só desta sessão do app; nada é gravado em disco). */
export interface MensagemPedido {
  id: number;
  workspaceId: string;
  gesto: string | null;
  rotulo: string;
  /** o pedido completo como a pessoa escreveu (null quando o gesto não tem pedido) */
  pedido: string | null;
  comando: string | null;
  paneId: string | null;
  sessaoId: string | null;
  /** epoch ms do envio */
  em: number;
}

export const MAX_HISTORICO = 60;

export interface EstadoExecucaoMetodo {
  execucao: ExecucaoMetodo | null;
  irAoTerminal: boolean;
  /** contador: cada "foi enviado, estou indo ao terminal" (aria-live da tela Método) */
  anuncio: string;
  /** conversa do Método: pedidos entregues nesta sessão, do mais antigo ao mais novo */
  historico: readonly MensagemPedido[];
  /** pedido de outra tela ("Novo pedido" em Trabalhos): o composer adota este gesto; `n` muda a cada pedido */
  gestoSolicitado: { gesto: string; n: number } | null;
}

export interface OpcoesExecucao {
  config?: () => ApiAde["config"] | undefined;
  irParaSessao?: (sessaoId: string) => void;
  irParaTerminais?: () => void;
  irParaMetodo?: () => void;
  armazem?: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
}

/** Uma linha, no máximo ~90 caracteres, para a faixa. */
export function resumirPedido(texto: string | null | undefined): string | null {
  const t = (texto ?? "").replace(/\s+/g, " ").trim();
  if (t === "") return null;
  return t.length > RESUMO_MAX ? `${t.slice(0, RESUMO_MAX - 1).trimEnd()}…` : t;
}

export function criarStoreExecucaoMetodo(op: OpcoesExecucao = {}) {
  const config = op.config ?? (() => ade()?.config);
  const irParaTerminais = op.irParaTerminais ?? (() => pedirTela("terminais"));
  const irParaSessao = op.irParaSessao ?? pedirFocoSessao;
  const irParaMetodo = op.irParaMetodo ?? (() => pedirTela("metodo"));
  const armazem = op.armazem ?? (() => { try { return globalThis.localStorage; } catch { return undefined; } });
  const ouvintes = new Set<() => void>();
  let estado: EstadoExecucaoMetodo = { execucao: null, irAoTerminal: true, anuncio: "", historico: [], gestoSolicitado: null };
  let seq = 0;
  const rascunhos = new Map<string, RascunhoPedido>();
  let preferenciaLida = false;
  const publicar = (p: Partial<EstadoExecucaoMetodo>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };

  return {
    obter: (): EstadoExecucaoMetodo => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },

    /** Lê a preferência uma vez (leve; só com a API presente). Falha de leitura mantém o padrão ligado. */
    async carregarPreferencia(): Promise<void> {
      if (preferenciaLida) return;
      const a = config();
      if (a === undefined) return;
      preferenciaLida = true;
      try {
        const v = await a.ler(CHAVE_IR_AO_TERMINAL);
        if (typeof v === "boolean") publicar({ irAoTerminal: v });
      } catch { preferenciaLida = false; }
    },
    async definirIrAoTerminal(v: boolean): Promise<void> {
      publicar({ irAoTerminal: v });
      preferenciaLida = true;
      try { await config()?.gravar(CHAVE_IR_AO_TERMINAL, v); } catch { /* a escolha vale nesta sessão mesmo sem gravar */ }
    },

    /**
     * Registra o que foi enviado e, se pedido (`ir`, senão a preferência), navega: tela Terminais e foco no painel da sessão. Devolve `true` quando navegou.
     * Só chamar com disparo bem-sucedido: falha nunca navega.
     */
    registrar(r: ResultadoDisparo, info: { workspaceId: string; rotulo: string; pedido?: string | null; gesto?: string }, ir?: boolean): boolean {
      if (!entregue(r)) return false;
      const execucao: ExecucaoMetodo = { workspaceId: info.workspaceId, rotulo: info.rotulo, resumo: resumirPedido(info.pedido), comando: r.comando, paneId: r.pane_id, sessaoId: r.sessao_id ?? null };
      const navegar = ir ?? estado.irAoTerminal;
      const texto = (info.pedido ?? "").trim();
      const msg: MensagemPedido = { id: ++seq, workspaceId: info.workspaceId, gesto: info.gesto ?? null, rotulo: info.rotulo, pedido: texto === "" ? null : texto, comando: r.comando, paneId: r.pane_id, sessaoId: r.sessao_id ?? null, em: Date.now() };
      publicar({ execucao, historico: [...estado.historico, msg].slice(-MAX_HISTORICO), anuncio: navegar ? "Comando enviado; abrindo o terminal" : "Comando enviado ao Pane" });
      if (!navegar) return false;
      if (execucao.sessaoId !== null) irParaSessao(execucao.sessaoId);
      else irParaTerminais();
      return true;
    },
    /** "Ir para o terminal" de uma mensagem da conversa: foca a sessão que recebeu o comando (ou só abre Terminais). */
    irAoTerminalDe(m: Pick<MensagemPedido, "sessaoId">): void {
      if (m.sessaoId !== null) irParaSessao(m.sessaoId); else irParaTerminais();
    },
    /** Outra tela pede o Método com este gesto escolhido: o composer adota o gesto e a tela abre. */
    abrirComGesto(gesto: string): void {
      publicar({ gestoSolicitado: { gesto, n: (estado.gestoSolicitado?.n ?? 0) + 1 } });
      irParaMetodo();
    },
    consumirGestoSolicitado(): void { if (estado.gestoSolicitado !== null) publicar({ gestoSolicitado: null }); },
    dispensar(): void { if (estado.execucao !== null) publicar({ execucao: null }); },
    voltarAoMetodo(): void { irParaMetodo(); },
    /** limpa o aviso lido pelo aria-live (para o mesmo texto ser anunciado de novo no próximo envio) */
    limparAnuncio(): void { if (estado.anuncio !== "") publicar({ anuncio: "" }); },

    rascunho(workspaceId: string): RascunhoPedido {
      const em = rascunhos.get(workspaceId);
      if (em !== undefined) return em;
      let lido: RascunhoPedido = { texto: "", gesto: "nova_feature" };
      try {
        const bruto = armazem()?.getItem(CHAVE_RASCUNHO + workspaceId);
        if (typeof bruto === "string") {
          const j = JSON.parse(bruto) as Partial<RascunhoPedido>;
          if (typeof j.texto === "string") lido = { texto: j.texto.slice(0, 4_000), gesto: typeof j.gesto === "string" ? j.gesto : "nova_feature" };
        }
      } catch { /* rascunho ilegível: começa vazio */ }
      rascunhos.set(workspaceId, lido);
      return lido;
    },
    salvarRascunho(workspaceId: string, r: RascunhoPedido): void {
      rascunhos.set(workspaceId, r);
      try {
        const a = armazem();
        if (a === undefined) return;
        if (r.texto.trim() === "") a.removeItem(CHAVE_RASCUNHO + workspaceId);
        else a.setItem(CHAVE_RASCUNHO + workspaceId, JSON.stringify(r));
      } catch { /* sem armazenamento: o rascunho vale enquanto o app está aberto */ }
    },
    /** testes */
    _reiniciar(): void { estado = { execucao: null, irAoTerminal: true, anuncio: "", historico: [], gestoSolicitado: null }; seq = 0; rascunhos.clear(); preferenciaLida = false; ouvintes.forEach((o) => o()); },
  };
}
export type StoreExecucaoMetodo = ReturnType<typeof criarStoreExecucaoMetodo>;
export const storeExecucaoMetodo: StoreExecucaoMetodo = criarStoreExecucaoMetodo();

export function useExecucaoMetodo(store: StoreExecucaoMetodo = storeExecucaoMetodo): EstadoExecucaoMetodo {
  return useSyncExternalStore(store.assinar, store.obter);
}
