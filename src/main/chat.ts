// Chat orquestrador (Fase 15, onda 2) no main: conversas persistidas (`chat_*`), orquestrador por mensagem (efêmero; o plano vive no banco),
// executor headless da CLI do usuário (assinatura dele; nunca chave própria), tools de orquestração por porta (Missão, Pane, `/expx:<comando>`)
// e eventos `chat:*` ao renderer. O LLM NUNCA decide ação: o plano é montado por código; assinar prodx, aprovar raio ALTO, mergex-revisar,
// merge e push são detectados por código e ficam com o humano (D-21). Sem CLI utilizável o chat segue em modo BUSCA (resultados com fontes).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CitacaoChat, ConversaChatDto, ConversaCompleta, EstadoCliChat, MensagemChatDto, PerfilChatDto, PerfilChatEstado, PlanoChatDto } from "../compartilhado/chat";
import type { CanaisEvento } from "../compartilhado/ipc";
import { redigir } from "../nucleo/conhecimento/chunking/comum";
import type { HitBusca } from "../nucleo/conhecimento/busca/buscador";
import { criarExecutorHeadless, type CliResolvida, type Spawner } from "../nucleo/conhecimento/chat/executor";
import { resumirHistorico, trocaParaIngestao } from "../nucleo/conhecimento/chat/historico";
import { OrquestradorChat, TEXTO_CHAT_MAX } from "../nucleo/conhecimento/chat/orquestrador";
import { perfilPadrao, resolverPerfilChat, type PortaRoteamento } from "../nucleo/conhecimento/chat/perfil";
import type { EventoProgresso } from "../nucleo/conhecimento/chat/plano";
import type { PerfilChat, PlanoChat, PortaLlm, PortaOrquestracao } from "../nucleo/conhecimento/chat/tipos";
import type { ConversaChat, MensagemChat, PlanoPersistido, ReposConhecimentoDominio } from "../nucleo/conhecimento/repos-dominio";
import type { EntradaConhecimento } from "../nucleo/conhecimento/tipos";
import { comandoDeSkill } from "../nucleo/metodo/comandos";
import type { RepoConfig } from "../nucleo/banco/repos/config";
import type { ManipuladoresChat } from "./ipc/conhecimento";
import type { PortaRagMain } from "./conhecimento";

const CLIS_CHAT = ["claude", "codex", "opencode", "gemini"] as const;
/** CLIs em que o método (`/expx:<skill>`) existe: o terminal aberto pelo chat é sempre de uma delas. */
const CLIS_COM_METODO = ["claude", "opencode"] as const;
const ESPERA_PRONTO_MS = 30_000;
const INTERVALO_TOKEN_MS = 40;

export interface DepsChat {
  repos: ReposConhecimentoDominio;
  config: Pick<RepoConfig, "obter" | "definir">;
  rag: PortaRagMain;
  workspace(id: string): { id: string; nome: string; raiz: string };
  missoes: { criar(p: { workspace_id: string; modo: "livre"; origem: "livre"; titulo: string; pedido: string; clis: Record<string, never> }): Promise<{ id: string; worktree: string | null }>; garantirPastaMissao(id: string): Promise<string> };
  panes: { abrirPane(p: { missao_id: string; cli: string; papel?: "nenhum"; modelo?: string | null; esforco?: string | null }): Promise<{ pane: { id: string; cli: string | null } }>; enviarComando(paneId: string, texto: string): Promise<void> };
  estadoDoPane(paneId: string): string | null;
  /** detecção das CLIs (terminais): caminho real e modo de lançamento; `null` = não instalada. */
  resolverCli(cli: string): Promise<CliResolvida | null>;
  ajudaCli(cli: string, caminho: string): Promise<string | null>;
  ambiente(caminho: string): Record<string, string>;
  pastaNeutra: string;
  /** Fase 9: troca por consumo (outra conta/modelo). Ausente = o perfil escolhido vale. */
  roteamento?: PortaRoteamento | null;
  enviar: <C extends keyof CanaisEvento>(canal: C, payload: CanaisEvento[C]) => void;
  /** conversa com `indexar` ligado vira entrada de ingestão (tipo `chat`, desligado por padrão). */
  registrarEntrada?: (workspaceId: string, entrada: EntradaConhecimento) => void;
  spawn?: Spawner;
  /** teste: troca o executor headless. */
  criarLlm?: (perfil: () => PerfilChat | null) => PortaLlm;
  agora?: () => number;
  esperar?: (ms: number) => Promise<void>;
  aviso?: (m: string) => void;
}

export interface ServicoChat {
  manipuladores: ManipuladoresChat;
  /** destilação por IA (P-56): uma chamada ao perfil do chat (faixa rápida). */
  destilar(workspaceId: string, resumo: string, sinal: AbortSignal): Promise<string>;
  /** aborta tudo que está em curso (encerramento do app). */
  encerrar(): void;
}

const parse = <T>(json: string | null): T | null => {
  if (json === null) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
};

export function criarServicoChat(d: DepsChat): ServicoChat {
  const agora = d.agora ?? Date.now;
  const esperar = d.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const ativas = new Map<string, AbortController>(); // mensagem_id → cancelamento
  const planosAtivos = new Map<string, AbortController>(); // plano_id → cancelamento da execução

  // ---------------------------------------------------------------- perfil (por workspace; a conversa guarda o que usou)
  const chavePerfil = (ws: string): string => `chat.perfil.${ws}`;

  async function estadoDasClis(): Promise<EstadoCliChat[]> {
    const saida: EstadoCliChat[] = [];
    for (const cli of CLIS_CHAT) {
      if (cli === "gemini") {
        saida.push({ cli, disponivel: false, motivo: "adaptador experimental: desligado até a verificação das flags numa máquina que tenha o Gemini" });
        continue;
      }
      const r = await d.resolverCli(cli).catch(() => null);
      if (r === null) saida.push({ cli, disponivel: false, motivo: "não instalada" });
      else if (r.modo !== null && r.modo !== "direto") saida.push({ cli, disponivel: false, motivo: "wrapper de Windows: o chat headless não executa sem shell" });
      else saida.push({ cli, disponivel: true, motivo: null });
    }
    return saida;
  }

  async function perfilEstado(ws: string): Promise<PerfilChatEstado> {
    d.workspace(ws);
    const clis = await estadoDasClis();
    const salvo = d.config.obter<PerfilChatDto>(chavePerfil(ws));
    const perfil = salvo ?? perfilPadrao(clis.map((c) => ({ cli: c.cli, disponivel: c.disponivel })), "medio");
    return { perfil: perfil ?? null, clis };
  }

  // ---------------------------------------------------------------- DTOs
  const paraConversa = (c: ConversaChat): ConversaChatDto => ({ id: c.id, workspace_id: c.workspace_id, titulo: c.titulo, modo: c.modo, perfil: parse<PerfilChatDto>(c.perfil_json), mission_alvo_id: c.mission_alvo_id, indexar: c.indexar, criado_em: c.criado_em, atualizado_em: c.atualizado_em });
  const paraMensagem = (m: MensagemChat): MensagemChatDto => ({ id: m.id, conversa_id: m.conversa_id, papel: m.papel, texto: m.texto, citacoes: parse<CitacaoChat[]>(m.citacoes_json) ?? [], plano_id: m.plano_id, estado: m.estado, criado_em: m.criado_em });
  const paraPlano = (conversaId: string, p: PlanoChat): PlanoChatDto => ({
    id: p.id,
    conversa_id: conversaId,
    intencao: p.intencao,
    resumo: p.resumo,
    passos: p.passos,
    prompt: p.prompt,
    criterios_aceite: p.criterios_aceite,
    arquivos_provaveis: p.arquivos_provaveis,
    acoes_humanas: p.acoes_humanas,
    avisos: p.avisos,
    mission_alvo_id: p.mission_alvo_id,
    mission_id: p.mission_id,
    pane_ids: p.pane_ids,
    estado: p.estado,
    exige_aprovacao: p.exige_aprovacao,
  });
  const planoDoBanco = (p: PlanoPersistido): PlanoChat | null => parse<PlanoChat>(p.plano_json);

  function persistirPlano(conversaId: string, plano: PlanoChat): PlanoChatDto {
    d.repos.plano.gravar({ id: plano.id, conversa_id: conversaId, intencao: plano.intencao, plano_json: JSON.stringify(plano), estado: plano.estado, mission_id: plano.mission_id, pane_ids_json: JSON.stringify(plano.pane_ids) });
    const dto = paraPlano(conversaId, plano);
    d.enviar("chat:plano", { plano: dto });
    return dto;
  }

  // ---------------------------------------------------------------- portas do orquestrador (efêmeras por mensagem/decisão)
  async function esperarPane(paneId: string): Promise<void> {
    const limite = agora() + ESPERA_PRONTO_MS;
    for (;;) {
      const e = d.estadoDoPane(paneId);
      if (e === "pronto" || e === "aguardando") return;
      if (e === "encerrado" || e === null) throw new Error("o terminal fechou antes de ficar pronto");
      if (agora() >= limite) throw new Error("o terminal não ficou pronto a tempo");
      await esperar(250);
    }
  }

  function portaOrquestracao(ws: string): PortaOrquestracao {
    const clisPane = new Map<string, string>();
    return {
      async criarMissao({ titulo }) {
        const m = await d.missoes.criar({ workspace_id: ws, modo: "livre", origem: "livre", titulo: titulo.slice(0, 120), pedido: titulo, clis: {} });
        ultimaMissaoCriada.set(ws, { id: m.id, worktree: m.worktree });
        return { mission_id: m.id };
      },
      async abrirPane({ mission_id, perfil }) {
        const cli = (CLIS_COM_METODO as readonly string[]).includes(perfil.cli) ? perfil.cli : "claude";
        const r = await d.panes.abrirPane({ missao_id: mission_id, cli, papel: "nenhum", modelo: cli === perfil.cli ? perfil.modelo : null, esforco: cli === perfil.cli ? perfil.esforco : null });
        clisPane.set(r.pane.id, cli);
        return { pane_id: r.pane.id };
      },
      async dispararMetodo({ pane_id, comando, argumento, prompt }) {
        await esperarPane(pane_id);
        let arg = argumento;
        if (prompt !== undefined && prompt.trim() !== "") {
          // o prompt melhorado vai por ARQUIVO do trabalho (nunca no argv nem digitado): o comando só aponta para ele
          const rel = await gravarPrompt(ws, prompt);
          if (rel !== null) arg = `${argumento} — Contexto: ${rel}`;
        }
        const c = comandoDeSkill(comando, arg, clisPane.get(pane_id) ?? "claude");
        if (c.comando === "") throw new Error(c.motivo_bloqueio ?? "comando bloqueado");
        await d.panes.enviarComando(pane_id, c.comando);
      },
      async enviarPrompt({ pane_id, texto }) {
        await esperarPane(pane_id);
        await d.panes.enviarComando(pane_id, texto);
      },
    };
  }

  /** Grava o prompt melhorado em `<pasta do trabalho>/prompt-chat.md` (0600; relativo ao workspace). `null` = não deu para gravar. */
  async function gravarPrompt(ws: string, prompt: string): Promise<string | null> {
    try {
      const w = d.workspace(ws);
      const missao = ultimaMissaoCriada.get(ws);
      if (missao === undefined) return null;
      const rel = await d.missoes.garantirPastaMissao(missao.id);
      const base = missao.worktree === null ? w.raiz : resolve(w.raiz, missao.worktree);
      const alvo = join(base, rel, "prompt-chat.md");
      mkdirSync(dirname(alvo), { recursive: true });
      writeFileSync(alvo, `${redigir(prompt)}\n`, { mode: 0o600 });
      const relativoAoWorkspace = (missao.worktree === null ? rel : join(missao.worktree, rel)).split("\\").join("/");
      return `${relativoAoWorkspace}/prompt-chat.md`;
    } catch {
      return null;
    }
  }
  // a Missão criada pelo plano em curso (guardada para gravar o prompt melhorado dentro dela)
  const ultimaMissaoCriada = new Map<string, { id: string; worktree: string | null }>();

  function criarLlmParaPerfil(perfil: () => PerfilChat | null): PortaLlm {
    if (d.criarLlm !== undefined) return d.criarLlm(perfil);
    return criarExecutorHeadless({
      perfil,
      resolverCli: (cli) => d.resolverCli(cli),
      ajuda: (cli, caminho) => d.ajudaCli(cli, caminho),
      ambiente: (caminho) => d.ambiente(caminho),
      pastaNeutra: d.pastaNeutra,
      ...(d.spawn === undefined ? {} : { spawn: d.spawn }),
    });
  }

  /** Perfil do terminal que executa o método: o do chat se for CLI com método; senão a primeira CLI com método instalada. */
  function perfilDestinoDe(perfil: PerfilChat | null): PerfilChat {
    if (perfil !== null && (CLIS_COM_METODO as readonly string[]).includes(perfil.cli)) return { ...perfil, faixa: "profundo" };
    return { cli: "claude", modelo: null, esforco: null, faixa: "profundo" };
  }

  async function criarOrquestrador(ws: string, perfilConversa: PerfilChat | null, onProgresso: (e: EventoProgresso) => void): Promise<OrquestradorChat> {
    const efetivo = await resolverPerfilChat(perfilConversa, d.roteamento ?? null);
    const cfg = d.repos.config.ler(ws);
    const llm = efetivo === null ? null : criarLlmParaPerfil(() => efetivo);
    return new OrquestradorChat({
      rag: { contexto: (p) => d.rag.contexto({ workspace_id: ws, mission_id: null, task_ref: null, pane_id: null, tarefa: p.tarefa, arquivos: [...(p.arquivos ?? [])], orcamento_chars: p.orcamento_chars ?? cfg.contexto_chars, origem: "chat" }) },
      busca: { buscar: async ({ consulta, k }) => {
        const r = await d.rag.buscarHits(ws, { consulta, k });
        return { hits: r.hits as HitBusca[], estado: r.estado };
      } },
      llm: () => llm,
      orquestracao: portaOrquestracao(ws),
      perfilDestino: () => perfilDestinoDe(efetivo ?? perfilConversa),
      modoExecucao: () => d.repos.config.ler(ws).chat_execucao,
      onProgresso,
    });
  }

  const progressoDe = () => (e: EventoProgresso): void => {
    d.enviar("chat:progresso", { plano_id: e.plano_id, pane_id: e.pane_id, estado: String(e.estado), resumo: e.resumo });
  };

  // ---------------------------------------------------------------- enviar (a resposta chega por eventos)
  async function processarEmSegundoPlano(conversa: ConversaChat, msgAssistente: MensagemChat, texto: string, modo: "perguntar" | "orquestrar", missaoAlvo: string | null, ctl: AbortController): Promise<void> {
    const ws = conversa.workspace_id;
    let buffer = "";
    let acumulado = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soltar = (): void => {
      timer = null;
      if (buffer === "") return;
      const delta = buffer;
      buffer = "";
      d.enviar("chat:token", { mensagem_id: msgAssistente.id, delta });
    };
    const aoToken = (delta: string): void => {
      const limpo = redigir(delta); // nenhum segredo atravessa para a UI nem para o banco, nem mesmo em streaming
      buffer += limpo;
      acumulado += limpo;
      timer ??= setTimeout(soltar, INTERVALO_TOKEN_MS);
    };
    const finalizar = (patch: { texto?: string; estado: MensagemChat["estado"]; citacoes?: CitacaoChat[]; plano_id?: string | null }): MensagemChatDto => {
      if (timer !== null) clearTimeout(timer);
      soltar();
      d.repos.mensagem.atualizar(msgAssistente.id, { ...(patch.texto === undefined ? {} : { texto: patch.texto }), estado: patch.estado, ...(patch.citacoes === undefined ? {} : { citacoes_json: JSON.stringify(patch.citacoes) }) });
      if (patch.plano_id !== undefined && patch.plano_id !== null) d.repos.mensagem.definirPlano(msgAssistente.id, patch.plano_id);
      const atual = d.repos.mensagem.listar(conversa.id).find((m) => m.id === msgAssistente.id) ?? msgAssistente;
      const dto = paraMensagem(atual);
      d.enviar("chat:mensagem", { mensagem: dto });
      return dto;
    };
    try {
      const historico = resumirHistorico(d.repos.mensagem.listar(conversa.id).filter((m) => m.id !== msgAssistente.id));
      const perfil = parse<PerfilChatDto>(conversa.perfil_json);
      const orq = await criarOrquestrador(ws, perfil, progressoDe());
      const r = await orq.processar({ texto, modo, mission_alvo_id: missaoAlvo, historico, sinal: ctl.signal, aoToken });
      if (r.tipo === "resposta") {
        const rotulo = r.resposta.modo === "busca" && r.resposta.motivo_busca !== null ? `\n\n_Modo busca (sem modelo de linguagem): ${r.resposta.motivo_busca}._` : "";
        const dto = finalizar({ texto: `${r.resposta.texto}${rotulo}`.slice(0, 20_000), estado: "completa", citacoes: r.resposta.citacoes });
        indexarTroca(conversa, texto, dto.texto);
      } else if (r.tipo === "plano") {
        persistirPlano(conversa.id, r.plano);
        const nota = r.plano.exige_aprovacao ? "Montei um plano. Revise e aprove para eu executar." : r.plano.estado === "falhou" ? "O plano não pôde ser executado por completo; veja o progresso." : "Plano executado: o terminal está trabalhando.";
        finalizar({ texto: nota, estado: "completa", plano_id: r.plano.id });
      } else {
        const humanas = r.acoes_humanas.length > 0 ? `\n${r.acoes_humanas.map((a) => `- ${a}`).join("\n")}` : "";
        finalizar({ texto: `${r.mensagem}${humanas}`, estado: "completa" });
      }
    } catch (erro) {
      const cancelado = ctl.signal.aborted;
      finalizar({ texto: cancelado ? acumulado : "Não consegui concluir esta resposta. Tente de novo ou use o modo busca.", estado: cancelado ? "cancelada" : "erro" });
      if (!cancelado) d.aviso?.(`chat: falha ao processar (${erro instanceof Error ? erro.message.slice(0, 120) : "erro"})`);
    } finally {
      ativas.delete(msgAssistente.id);
    }
  }

  function indexarTroca(conversa: ConversaChat, pergunta: string, resposta: string): void {
    if (!conversa.indexar || d.registrarEntrada === undefined) return;
    try {
      const indice = d.repos.mensagem.listar(conversa.id).filter((m) => m.papel === "usuario").length;
      const e = trocaParaIngestao({ workspace_id: conversa.workspace_id, conversa_id: conversa.id, indice, pergunta, resposta, quando: new Date(agora()).toISOString(), indexar: true });
      if (e !== null) d.registrarEntrada(conversa.workspace_id, e);
    } catch {
      /* indexar o chat é opcional */
    }
  }

  // ---------------------------------------------------------------- manipuladores `chat:*`
  const exigirConversa = (id: string): ConversaChat => {
    const c = d.repos.conversa.obter(id);
    if (c === undefined) throw new Error("conversa inexistente");
    return c;
  };
  const exigirPlano = (id: string): { persistido: PlanoPersistido; plano: PlanoChat; conversa: ConversaChat } => {
    const persistido = d.repos.plano.obter(id);
    if (persistido === undefined) throw new Error("plano inexistente");
    const plano = planoDoBanco(persistido);
    if (plano === null) throw new Error("plano ilegível");
    return { persistido, plano: { ...plano, estado: persistido.estado }, conversa: exigirConversa(persistido.conversa_id) };
  };

  const manipuladores: ManipuladoresChat = {
    "chat:conversas_listar": ({ workspace_id }) => {
      d.workspace(workspace_id);
      return d.repos.conversa.listar(workspace_id).map(paraConversa);
    },
    "chat:conversa_criar": async ({ workspace_id, modo, titulo, mission_alvo_id, indexar }) => {
      d.workspace(workspace_id);
      const { perfil } = await perfilEstado(workspace_id);
      const c = d.repos.conversa.criar({ workspace_id, titulo: titulo ?? "Nova conversa", modo, perfil_json: JSON.stringify(perfil), mission_alvo_id, indexar });
      return paraConversa(c);
    },
    "chat:conversa_ler": ({ conversa_id }): ConversaCompleta | null => {
      const c = d.repos.conversa.obter(conversa_id);
      if (c === undefined) return null;
      const planos = d.repos.plano.listarPorConversa(conversa_id).flatMap((p) => {
        const pl = planoDoBanco(p);
        return pl === null ? [] : [paraPlano(conversa_id, { ...pl, estado: p.estado })];
      });
      return { conversa: paraConversa(c), mensagens: d.repos.mensagem.listar(conversa_id).map(paraMensagem), planos };
    },
    "chat:conversa_apagar": ({ conversa_id }) => {
      const c = d.repos.conversa.obter(conversa_id);
      if (c === undefined) return { ok: false };
      for (const [id, ctl] of ativas) if (d.repos.mensagem.listar(conversa_id).some((m) => m.id === id)) ctl.abort();
      d.repos.conversa.apagar(conversa_id);
      return { ok: true };
    },
    "chat:perfil_ler": ({ workspace_id }) => perfilEstado(workspace_id),
    "chat:perfil_gravar": async ({ workspace_id, cli, modelo, esforco, faixa, agente_id }) => {
      d.workspace(workspace_id);
      const perfil: PerfilChatDto = { cli, modelo, esforco, faixa, ...(agente_id === undefined ? {} : { agente_id }) };
      d.config.definir(chavePerfil(workspace_id), perfil);
      return perfilEstado(workspace_id);
    },
    "chat:enviar": ({ conversa_id, texto, modo, mission_alvo_id }) => {
      const conversa = exigirConversa(conversa_id);
      const limpo = redigir(texto.replace(/\u0000/g, "")).trim().slice(0, TEXTO_CHAT_MAX);
      if (limpo === "") throw new Error("Mensagem vazia.");
      const usuario = d.repos.mensagem.adicionar({ conversa_id, papel: "usuario", texto: limpo });
      d.enviar("chat:mensagem", { mensagem: paraMensagem(usuario) });
      if (conversa.titulo === "Nova conversa") d.repos.conversa.renomear(conversa_id, limpo.split("\n")[0]?.slice(0, 80) ?? "Conversa");
      const assistente = d.repos.mensagem.adicionar({ conversa_id, papel: "assistente", texto: "", estado: "transmitindo" });
      const ctl = new AbortController();
      ativas.set(assistente.id, ctl);
      void processarEmSegundoPlano(conversa, assistente, limpo, modo, mission_alvo_id, ctl);
      return { mensagem_id: assistente.id };
    },
    "chat:parar": ({ mensagem_id }) => {
      const ctl = ativas.get(mensagem_id);
      ctl?.abort();
      return { ok: ctl !== undefined };
    },
    "chat:plano_decidir": async ({ plano_id, decisao, ajuste }) => {
      const { plano, conversa } = exigirPlano(plano_id);
      const perfil = parse<PerfilChatDto>(conversa.perfil_json);
      const orq = await criarOrquestrador(conversa.workspace_id, perfil, progressoDe());
      orq.adotarPlano(plano);
      if (decisao === "cancelar") return persistirPlano(conversa.id, orq.cancelar(plano_id));
      if (decisao === "editar") {
        if (ajuste === undefined) throw new Error("Informe o que mudar no plano.");
        return persistirPlano(conversa.id, orq.editarPlano(plano_id, ajuste));
      }
      if (plano.estado !== "proposto") throw new Error("Só um plano proposto pode ser aprovado.");
      const ctl = new AbortController();
      planosAtivos.set(plano_id, ctl);
      try {
        const executando = await orq.aprovarEExecutar(plano_id, ajuste === undefined ? undefined : { ...(ajuste.cli ? { cli: ajuste.cli } : {}), ...(ajuste.modelo !== undefined ? { modelo: ajuste.modelo } : {}), ...(ajuste.esforco !== undefined ? { esforco: ajuste.esforco } : {}) }, ctl.signal);
        return persistirPlano(conversa.id, executando);
      } finally {
        planosAtivos.delete(plano_id);
      }
    },
    "chat:plano_parar": ({ plano_id }) => {
      const ctl = planosAtivos.get(plano_id);
      ctl?.abort();
      return { ok: ctl !== undefined };
    },
  };

  return {
    manipuladores,
    async destilar(workspaceId, resumo, sinal) {
      const { perfil } = await perfilEstado(workspaceId);
      const efetivo = await resolverPerfilChat(perfil === null ? null : { ...perfil, faixa: "rapido" }, d.roteamento ?? null);
      if (efetivo === null) throw new Error("nenhuma CLI configurada ou com cota para destilar");
      const llm = criarLlmParaPerfil(() => efetivo);
      let texto = "";
      for await (const delta of llm.executar({ sistema: "Você extrai aprendizados de uma Missão encerrada e responde só com JSON.", prompt: resumo, sinal })) texto += delta;
      return texto;
    },
    encerrar() {
      for (const c of ativas.values()) c.abort();
      for (const c of planosAtivos.values()) c.abort();
      ativas.clear();
      planosAtivos.clear();
    },
  };
}
