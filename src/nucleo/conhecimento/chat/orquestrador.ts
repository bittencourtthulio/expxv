// Orquestrador do chat (T-15.33): MÁQUINA DE ESTADOS com portas. Fluxo: sanear → (ações exclusivas do humano) → intenção por regras →
// consultar o RAG → melhorar o prompt → plano determinístico → (aprovação conforme P-52) → executar pelas tools de orquestração.
// O LLM nunca decide ação. Perguntas e histórico vão para `perguntar`. Nada é apagado; nada sai da máquina.
import type { RespostaContexto } from "../../../compartilhado/conhecimento";
import { redigir } from "../chunking/comum";
import { acoesExclusivasDoHumano, intencaoPorRegras, type PortaIntencao } from "./intencao";
import { executarPlano, montarPlano, transicionar, type EventoProgresso } from "./plano";
import { melhorarPrompt } from "./prompt";
import { perguntar, type PortaBusca, type RespostaPergunta } from "./perguntar";
import type { ModoChat, ModoExecucaoChat, PerfilChat, PlanoChat, PortaLlm, PortaOrquestracao } from "./tipos";

export const TEXTO_CHAT_MAX = 8000;

export interface PortaContextoRag {
  contexto(p: { tarefa: string; arquivos?: readonly string[]; orcamento_chars?: number; origem: "chat" }): Promise<RespostaContexto>;
}

export interface DepsOrquestrador {
  intencao?: PortaIntencao;
  rag: PortaContextoRag;
  busca: PortaBusca;
  /** `null` = sem CLI utilizável → modo busca. */
  llm: () => PortaLlm | null;
  orquestracao: PortaOrquestracao;
  /** perfil do terminal por intenção (Fase 9 `resolverPerfil` / Fase 16). */
  perfilDestino: (intencao: string) => PerfilChat;
  modoExecucao: () => ModoExecucaoChat;
  onProgresso?: (e: EventoProgresso) => void;
}

export type ResultadoChat =
  | { tipo: "resposta"; resposta: RespostaPergunta }
  | { tipo: "plano"; plano: PlanoChat }
  | { tipo: "recusa"; mensagem: string; acoes_humanas: string[] };

export class OrquestradorChat {
  private readonly planos = new Map<string, PlanoChat>();
  constructor(private readonly d: DepsOrquestrador) {}

  plano(id: string): PlanoChat | undefined {
    return this.planos.get(id);
  }

  async processar(p: { texto: string; modo: ModoChat; mission_alvo_id?: string | null; arquivos?: readonly string[]; historico?: readonly string[]; sinal?: AbortSignal; aoToken?: (d: string) => void }): Promise<ResultadoChat> {
    const texto = redigir(p.texto.replace(/\u0000/g, "")).trim().slice(0, TEXTO_CHAT_MAX);
    if (texto === "") return { tipo: "recusa", mensagem: "Mensagem vazia.", acoes_humanas: [] };
    const humanas = acoesExclusivasDoHumano(texto);
    const classif = await Promise.resolve((this.d.intencao ?? intencaoPorRegras)(texto)).catch(() => ({ intencao: "pedido_cru" as const, confianca: 0 }));

    const ehDuvida = p.modo === "perguntar" || classif.intencao === "duvida" || classif.intencao === "consulta_historico";
    if (ehDuvida && humanas.length === 0) {
      const resposta = await perguntar({ pergunta: texto, busca: this.d.busca, llm: this.d.llm(), ...(p.historico ? { historico: p.historico } : {}), ...(p.sinal ? { sinal: p.sinal } : {}), ...(p.aoToken ? { aoToken: p.aoToken } : {}) });
      return { tipo: "resposta", resposta };
    }
    if (humanas.length > 0 && ["duvida", "consulta_historico", "entrega", "pedido_cru"].includes(classif.intencao)) {
      return { tipo: "recusa", mensagem: "Isso é uma ação exclusiva do humano; o chat não a executa.", acoes_humanas: humanas.map((h) => h.descricao) };
    }

    let ctx: RespostaContexto | null = null;
    try {
      ctx = await this.d.rag.contexto({ tarefa: texto, arquivos: p.arquivos ?? [], origem: "chat" });
    } catch {
      ctx = null; // RAG fora nunca bloqueia o pedido
    }
    const pm = melhorarPrompt({ pedido: texto, intencao: classif.intencao, contexto_rag: ctx?.markdown ?? "", arquivos: [...(p.arquivos ?? []), ...(ctx?.sinais.fontes.filter((f) => f.tipo === "codigo").map((f) => f.origem) ?? [])] });
    const plano = montarPlano({
      intencao: classif.intencao,
      pedido_titulo: texto.split("\n")[0]?.slice(0, 100) ?? texto.slice(0, 100),
      prompt: pm.texto,
      uma_linha: pm.uma_linha,
      criterios_aceite: pm.criterios_aceite,
      arquivos_provaveis: pm.arquivos_provaveis,
      perfil_destino: this.d.perfilDestino(classif.intencao),
      mission_alvo_id: p.mission_alvo_id ?? null,
      acoes_humanas: humanas,
      rag_consulta_id: ctx?.consulta_id ?? null,
      modo_execucao: this.d.modoExecucao(),
    });
    if (plano === null) return { tipo: "recusa", mensagem: "Não há ação a executar para esse pedido.", acoes_humanas: humanas.map((h) => h.descricao) };
    this.planos.set(plano.id, plano);
    if (plano.exige_aprovacao) return { tipo: "plano", plano };
    return { tipo: "plano", plano: await this.aprovarEExecutar(plano.id, undefined, p.sinal) };
  }

  /** Readota um plano persistido (o orquestrador é efêmero; o plano vive no banco). Só aceita plano ainda não terminal. */
  adotarPlano(plano: PlanoChat): void {
    this.planos.set(plano.id, plano);
  }

  /** Edição humana de um plano `proposto` (título do passo, perfil do terminal e prompt). Não aprova nem executa. */
  editarPlano(id: string, ajuste: { titulo?: string; cli?: PerfilChat["cli"]; modelo?: string | null; esforco?: string | null; prompt?: string }): PlanoChat {
    const plano = this.planos.get(id);
    if (!plano) throw new Error("plano inexistente");
    if (plano.estado !== "proposto") throw new Error("só um plano proposto pode ser editado");
    const novo: PlanoChat = {
      ...plano,
      ...(ajuste.prompt !== undefined ? { prompt: redigir(ajuste.prompt).replace(/\u0000/g, "").slice(0, 20_000) } : {}),
      passos: plano.passos.map((s) => {
        if (s.tipo === "abrir_pane") {
          return { ...s, ...(ajuste.titulo !== undefined ? { titulo: ajuste.titulo.slice(0, 120) } : {}), perfil: { ...s.perfil, ...(ajuste.cli ? { cli: ajuste.cli } : {}), ...(ajuste.modelo !== undefined ? { modelo: ajuste.modelo } : {}), ...(ajuste.esforco !== undefined ? { esforco: ajuste.esforco } : {}) } };
        }
        return s;
      }),
    };
    this.planos.set(id, novo);
    return novo;
  }

  /** Aprova (humano) e executa. */
  async aprovarEExecutar(id: string, ajuste?: { cli?: PerfilChat["cli"]; modelo?: string | null; esforco?: string | null }, sinal?: AbortSignal): Promise<PlanoChat> {
    let plano = this.planos.get(id);
    if (!plano) throw new Error("plano inexistente");
    if (ajuste) {
      plano = { ...plano, passos: plano.passos.map((s) => (s.tipo === "abrir_pane" ? { ...s, perfil: { ...s.perfil, ...(ajuste.cli ? { cli: ajuste.cli } : {}), ...(ajuste.modelo !== undefined ? { modelo: ajuste.modelo } : {}), ...(ajuste.esforco !== undefined ? { esforco: ajuste.esforco } : {}) } } : s)) };
    }
    plano = { ...plano, estado: transicionar(plano.estado, "aprovado") };
    const r = await executarPlano(plano, this.d.orquestracao, this.d.onProgresso, sinal);
    this.planos.set(id, r);
    return r;
  }

  cancelar(id: string): PlanoChat {
    const plano = this.planos.get(id);
    if (!plano) throw new Error("plano inexistente");
    const r = { ...plano, estado: transicionar(plano.estado, "cancelado") };
    this.planos.set(id, r);
    return r;
  }
}
