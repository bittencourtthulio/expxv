// Store de "Commit e push" / "Enviar PR" (D-630..D-639). O botão NÃO executa git: abre um diálogo com o resumo local, pede ao main que monte e ENTREGUE a instrução ao agente
// (contrato de entrega confirmada D-620) e depois ACOMPANHA o repositório sem polling novo: cada `vcs:mudou` (observador do Versionamento) refaz os fatos, e a comparação com a
// fotografia do clique diz se o commit saiu, se o branch foi publicado e (uma consulta limitada ao `gh`, só depois do push) se o PR existe.
// Também cuida do "Atualizar" (pull, D-693) e das pastas da suíte (ignorar neste computador, D-692). Ao ver o commit/push o acompanhamento refaz o resumo na hora (D-691).
import { useSyncExternalStore } from "react";
import type { ApiVcsPublicar, EstadoPublicacao, OpcoesPublicacao, PreparoAtualizar, PreparoPublicacao, ResultadoEnviarInstrucao, TipoPublicacao } from "../../compartilhado/vcs-publicar";
import { detectarMarcos, textoDoMarco, type Fotografia } from "../../nucleo/vcs/publicar/acompanhar";
import type { BotoesDecididos } from "../../nucleo/vcs/publicar/visibilidade";
import { ade } from "../ade";
import { avisar as avisarPadrao, type TomAviso } from "./avisos";
import { paneEmFoco } from "./foco-pane";
import { pedirFocoSessao } from "./navegacao";
import { storeVcs } from "./vcs";

export type FaseDialogo = "carregando" | "pronto" | "enviando" | "ocupado" | "confirmar_padrao" | "erro";

export interface DialogoPublicar {
  tipo: TipoPublicacao;
  fase: FaseDialogo;
  preparo: PreparoPublicacao | null;
  /** erro do preparo ou do envio (PT-BR, sem caminho). A tela do diálogo continua aberta. */
  erro: string | null;
  /** opções e CLI guardadas enquanto o diálogo pergunta "abrir painel novo?" ou pede a frase digitada. */
  pendente: { opcoes: OpcoesPublicacao; cli: string | null } | null;
}

export type FaseAtualizar = "carregando" | "pronto" | "executando" | "divergiu" | "recusado" | "erro" | "ocupado";

export interface DialogoAtualizar {
  fase: FaseAtualizar;
  preparo: PreparoAtualizar | null;
  /** motivo (PT-BR, sem caminho) quando `recusado`, `divergiu` ou `erro`. */
  erro: string | null;
  /** o motivo se resolve commitando/guardando: o diálogo sugere. */
  sugerirCommitar: boolean;
  /** CLI escolhida enquanto o diálogo pergunta "abrir painel novo?" no pedido de merge. */
  pendente: { cli: string | null } | null;
}

export interface FaixaEnviado {
  tipo: TipoPublicacao | "merge";
  texto: string;
  sessaoId: string | null;
}

export interface EstadoPublicarUI {
  workspaceId: string | null;
  fatos: EstadoPublicacao | null;
  dialogo: DialogoPublicar | null;
  faixa: FaixaEnviado | null;
  /** há acompanhamento em curso (o componente mantém o observador ligado mesmo fora da tela Terminais). */
  seguindo: boolean;
  /** o que os botões mostram agora (o cabeçalho publica; a paleta ⌘K lê). null = botões ocultos. */
  botoes: BotoesDecididos | null;
  /** diálogo do "Atualizar" (pull). */
  atualizar: DialogoAtualizar | null;
  /** um `git pull --ff-only` está rodando (o botão fica desabilitado). */
  atualizando: boolean;
}

interface Seguindo {
  tipo: TipoPublicacao;
  workspaceId: string;
  baseline: Fotografia;
  ramoAlvo: string | null;
  desde: number;
  comitou: boolean;
  publicou: boolean;
  tentativasPr: number;
  cancelarPr: (() => void) | null;
}

export const DURACAO_ACOMPANHAMENTO_MS = 20 * 60_000;
/** Tentativas (limitadas) de achar o PR com o `gh`, depois do push (ou depois da entrega, se o branch já estava publicado). Nunca polling contínuo. */
export const ESPERAS_PR_MS = [6_000, 15_000, 30_000] as const;
export const ESPERAS_PR_JA_PUBLICADO_MS = [20_000, 60_000, 120_000] as const;

export interface DepsStorePublicar {
  api: () => ApiVcsPublicar | undefined;
  agora?: () => number;
  /** agenda e devolve o cancelamento */
  agendar?: (fn: () => void, ms: number) => () => void;
  avisar?: (texto: string, tom?: TomAviso, acao?: { rotulo: string; executar: () => void }) => number;
  focar?: (sessaoId: string) => void;
  sessaoEmFoco?: () => string | null;
  /** refaz o resumo do Versionamento na hora (padrão: `storeVcs.atualizar`). */
  atualizarResumo?: (workspaceId: string) => void;
}

/** Intervalo mínimo entre dois pedidos de fetch silencioso (o main também limita a 60 s). */
export const INTERVALO_FETCH_MS = 60_000;

const fotografiaDe = (f: EstadoPublicacao): Fotografia => ({ branch: f.branch, oid: f.oid, a_frente: f.a_frente, tem_upstream: f.tem_upstream, alteradas: f.alteradas + f.novas });
const mensagemDe = (e: unknown): string => (e instanceof Error ? e.message.replace(/^\[[^\]]+\]\s*/, "") : "Não foi possível concluir.");

export function criarStorePublicar(deps: DepsStorePublicar) {
  const agora = deps.agora ?? Date.now;
  const agendar = deps.agendar ?? ((fn: () => void, ms: number) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
  const avisar = deps.avisar ?? avisarPadrao;
  const focar = deps.focar ?? pedirFocoSessao;
  const sessaoEmFoco = deps.sessaoEmFoco ?? paneEmFoco;
  const atualizarResumo = deps.atualizarResumo ?? ((id: string) => void storeVcs.atualizar({ workspace_id: id, mission_id: null }));
  const ouvintes = new Set<() => void>();
  let estado: EstadoPublicarUI = { workspaceId: null, fatos: null, dialogo: null, faixa: null, seguindo: false, botoes: null, atualizar: null, atualizando: false };
  let ultimoFetch = -Infinity;
  let seguindo: Seguindo | null = null;
  let emVoo: Promise<void> | null = null;
  let refazer = false;
  let cancelarGh: (() => void) | null = null;

  const publicar = (p: Partial<EstadoPublicarUI>): void => {
    estado = { ...estado, ...p };
    ouvintes.forEach((o) => o());
  };
  const ws = (): string | null => estado.workspaceId;

  // ---- acompanhamento -------------------------------------------------------------------------------------------------------------

  function parar(): void {
    seguindo?.cancelarPr?.();
    seguindo = null;
    if (estado.seguindo) publicar({ seguindo: false });
  }

  function urlDoBranch(f: EstadoPublicacao, branch: string): string | null {
    return f.repo === null || !/^[A-Za-z0-9._/-]+$/.test(branch) ? null : `https://github.com/${f.repo}/tree/${branch}`;
  }

  function abrirNoNavegador(url: string): void {
    const id = ws();
    if (id !== null) void deps.api()?.abrirUrl(id, url).catch(() => undefined);
  }

  function agendarPr(s: Seguindo, esperas: readonly number[]): void {
    s.cancelarPr?.();
    if (s.tentativasPr >= esperas.length) return;
    const espera = esperas[s.tentativasPr] as number;
    s.cancelarPr = agendar(() => {
      s.cancelarPr = null;
      if (seguindo !== s) return;
      s.tentativasPr++;
      const api = deps.api();
      if (api === undefined) return;
      void api.estado(s.workspaceId, true).then((f) => {
        if (seguindo !== s) return;
        if (f.pr !== null) {
          const url = f.pr.url;
          avisar(`PR #${f.pr.numero} criado`, "sucesso", { rotulo: "Abrir no navegador", executar: () => abrirNoNavegador(url) });
          publicar({ fatos: f, faixa: null });
          parar();
        } else agendarPr(s, esperas);
      }, () => { if (seguindo === s) agendarPr(s, esperas); });
    }, espera);
  }

  function aoFatos(f: EstadoPublicacao): void {
    const s = seguindo;
    if (s === null || s.workspaceId !== ws()) return;
    if (agora() - s.desde > DURACAO_ACOMPANHAMENTO_MS) { parar(); publicar({ faixa: null }); return; }
    const marcos = detectarMarcos(s.baseline, fotografiaDe(f), s.ramoAlvo);
    // viu o commit/push: o resumo do Versionamento (badge, rodapé) se atualiza JÁ, sem esperar o observador (D-691)
    if (marcos.some((m) => (m.tipo === "commit" && !s.comitou) || (m.tipo === "push" && !s.publicou))) atualizarResumo(s.workspaceId);
    for (const m of marcos) {
      if (m.tipo === "commit" && !s.comitou) {
        s.comitou = true;
        avisar(textoDoMarco(m), "info");
        if (s.tipo === "commit_push" && estado.faixa !== null) publicar({ faixa: { ...estado.faixa, texto: `Commit ${m.oid} criado; aguardando o push…` } });
      } else if (m.tipo === "push" && !s.publicou) {
        s.publicou = true;
        if (s.tipo === "pr") {
          agendarPr(s, ESPERAS_PR_MS);
        } else {
          const url = urlDoBranch(f, m.branch);
          avisar(`${textoDoMarco(m)}.`, "sucesso", url === null ? undefined : { rotulo: "Abrir no navegador", executar: () => abrirNoNavegador(url) });
          publicar({ faixa: null });
          parar();
        }
      }
    }
  }

  // ---- fatos -----------------------------------------------------------------------------------------------------------------------

  async function buscar(): Promise<void> {
    const id = ws();
    const api = deps.api();
    if (id === null || api === undefined) return;
    try {
      const f = await api.estado(id, false);
      if (ws() !== id) return;
      publicar({ fatos: f });
      aoFatos(f);
      cancelarGh?.();
      cancelarGh = null;
      if (f.gh === "desconhecido" && f.remoto_github) cancelarGh = agendar(() => { cancelarGh = null; void api_atualizar(); }, 3_000);
      buscarRemotoSilencioso(id, f);
    } catch {
      if (ws() === id) publicar({ fatos: null });
    }
  }
  const api_atualizar = (): Promise<void> => atualizar();

  /** `git fetch --prune` silencioso (só remoto github.com, no máximo a cada 60 s): é o que mantém o `↓N` do "Atualizar" honesto. Falha nunca aparece. */
  function buscarRemotoSilencioso(id: string, f: EstadoPublicacao): void {
    const api = deps.api();
    if (api === undefined || !f.git || !f.remoto_github || !f.tem_upstream || agora() - ultimoFetch < INTERVALO_FETCH_MS) return;
    ultimoFetch = agora();
    void api.buscarRemoto(id, false).then((r) => { if (r.buscou && ws() === id) void atualizar(); }, () => undefined);
  }

  /** Refaz os fatos (coalesce: uma chamada em voo + uma de reserva). */
  function atualizar(): Promise<void> {
    if (emVoo !== null) { refazer = true; return emVoo; }
    emVoo = buscar().finally(() => {
      emVoo = null;
      if (refazer) { refazer = false; void atualizar(); }
    });
    return emVoo;
  }

  // ---- diálogo e envio ----------------------------------------------------------------------------------------------------------------

  async function abrir(tipo: TipoPublicacao): Promise<void> {
    const id = ws();
    const api = deps.api();
    if (id === null || api === undefined) return;
    publicar({ dialogo: { tipo, fase: "carregando", preparo: null, erro: null, pendente: null } });
    try {
      const p = await (tipo === "pr" ? api.prepararPr(id, sessaoEmFoco()) : api.prepararCommitPush(id, sessaoEmFoco()));
      if (estado.dialogo?.tipo !== tipo || ws() !== id) return;
      publicar({ dialogo: { tipo, fase: "pronto", preparo: p, erro: null, pendente: null } });
    } catch (e) {
      if (estado.dialogo?.tipo === tipo) publicar({ dialogo: { tipo, fase: "erro", preparo: null, erro: mensagemDe(e), pendente: null } });
    }
  }

  function fechar(): void {
    if (estado.dialogo !== null) publicar({ dialogo: null });
  }

  async function disparar(tipo: TipoPublicacao, opcoes: OpcoesPublicacao, cli: string | null, modo: "auto" | "novo"): Promise<void> {
    const id = ws();
    const api = deps.api();
    const d = estado.dialogo;
    if (id === null || api === undefined || d === null) return;
    publicar({ dialogo: { ...d, fase: "enviando", erro: null, pendente: { opcoes, cli } } });
    const baseline = estado.fatos === null ? null : fotografiaDe(estado.fatos);
    const jaPublicado = estado.fatos !== null && estado.fatos.tem_upstream && estado.fatos.a_frente === 0;
    let r: ResultadoEnviarInstrucao;
    try {
      r = await api.enviarInstrucao({ workspace_id: id, tipo, opcoes, sessao_foco: sessaoEmFoco(), cli, modo_painel: modo });
    } catch (e) {
      if (estado.dialogo !== null) publicar({ dialogo: { ...estado.dialogo, fase: "erro", erro: mensagemDe(e) } });
      return;
    }
    if (estado.dialogo === null) return;
    if (r.estado === "ocupado") { publicar({ dialogo: { ...estado.dialogo, fase: "ocupado", erro: null } }); return; }
    if (r.estado === "falhou") { publicar({ dialogo: { ...estado.dialogo, fase: "erro", erro: r.motivo ?? "Não foi possível enviar a instrução ao agente." } }); return; }
    // entregue: foca o painel (já estamos na tela Terminais) e abre o acompanhamento
    const texto = tipo === "pr" ? "Pedido de PR enviado ao agente…" : "Commit e push enviado ao agente…";
    parar();
    if (baseline !== null) {
      const ramoAlvo = opcoes.criar_ramo ? opcoes.nome_ramo : null;
      const s: Seguindo = { tipo, workspaceId: id, baseline, ramoAlvo, desde: agora(), comitou: false, publicou: false, tentativasPr: 0, cancelarPr: null };
      seguindo = s;
      if (tipo === "pr" && jaPublicado) agendarPr(s, ESPERAS_PR_JA_PUBLICADO_MS);
    }
    publicar({ dialogo: null, faixa: { tipo, texto, sessaoId: r.sessao_id }, seguindo: seguindo !== null });
    if (r.sessao_id !== null) focar(r.sessao_id);
  }

  /** o branch divergiu: entrega ao agente a instrução de MERGE (mesma entrega do Commit e push). */
  async function pedirMerge(cli: string | null, modo: "auto" | "novo" = "auto"): Promise<void> {
    const id = ws();
    const api = deps.api();
    const d = estado.atualizar;
    if (id === null || api === undefined || d === null) return;
    publicar({ atualizar: { ...d, fase: "executando", erro: null, pendente: { cli } } });
    try {
      const r = await api.pedirMerge({ workspace_id: id, sessao_foco: sessaoEmFoco(), cli, modo_painel: modo });
      const atual = estado.atualizar;
      if (atual === null) return;
      if (r.estado === "ocupado") { publicar({ atualizar: { ...atual, fase: "ocupado", erro: null } }); return; }
      if (r.estado === "falhou") { publicar({ atualizar: { ...atual, fase: "divergiu", erro: r.motivo ?? "Não foi possível enviar a instrução ao agente." } }); return; }
      publicar({ atualizar: null, faixa: { tipo: "merge", texto: "Pedido de merge enviado ao agente…", sessaoId: r.sessao_id } });
      if (r.sessao_id !== null) focar(r.sessao_id);
    } catch (e) {
      if (estado.atualizar !== null) publicar({ atualizar: { ...estado.atualizar, fase: "divergiu", erro: mensagemDe(e) } });
    }
  }

  return {
    obter: (): EstadoPublicarUI => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    definirWorkspace(id: string | null): void {
      if (estado.workspaceId === id) return;
      parar();
      cancelarGh?.();
      cancelarGh = null;
      ultimoFetch = -Infinity;
      publicar({ workspaceId: id, fatos: null, dialogo: null, faixa: null, atualizar: null, atualizando: false });
    },
    definirBotoes(b: EstadoPublicarUI["botoes"]): void {
      if (JSON.stringify(b) !== JSON.stringify(estado.botoes)) publicar({ botoes: b });
    },
    atualizar,
    abrir,
    fechar,
    /** botão primário do diálogo: respeita a regra do branch padrão (frase digitada em diálogo à parte). */
    enviar(opcoes: OpcoesPublicacao, cli: string | null): Promise<void> {
      const d = estado.dialogo;
      if (d === null || d.preparo === null) return Promise.resolve();
      if (!opcoes.criar_ramo && d.preparo.no_padrao && opcoes.confirmar_padrao === null) {
        publicar({ dialogo: { ...d, fase: "confirmar_padrao", pendente: { opcoes, cli }, erro: null } });
        return Promise.resolve();
      }
      return disparar(d.tipo, opcoes, cli, "auto");
    },
    /** resposta ao "O agente está trabalhando. Abrir um painel novo para isto?" */
    responderOcupado(abrirNovo: boolean): Promise<void> {
      const d = estado.dialogo;
      if (d === null || d.pendente === null) return Promise.resolve();
      if (!abrirNovo) { publicar({ dialogo: { ...d, fase: "pronto" } }); return Promise.resolve(); }
      return disparar(d.tipo, d.pendente.opcoes, d.pendente.cli, "novo");
    },
    /** frase digitada em diálogo à parte */
    confirmarPadrao(frase: string): Promise<void> {
      const d = estado.dialogo;
      if (d === null || d.pendente === null) return Promise.resolve();
      return disparar(d.tipo, { ...d.pendente.opcoes, confirmar_padrao: frase }, d.pendente.cli, "auto");
    },
    cancelarConfirmacao(): void {
      const d = estado.dialogo;
      if (d !== null && d.fase !== "carregando") publicar({ dialogo: { ...d, fase: "pronto", erro: null } });
    },
    // ---- Atualizar (pull) (D-693) ----
    async abrirAtualizar(): Promise<void> {
      const id = ws();
      const api = deps.api();
      if (id === null || api === undefined) return;
      publicar({ atualizar: { fase: "carregando", preparo: null, erro: null, sugerirCommitar: false, pendente: null } });
      try {
        await api.buscarRemoto(id, true).catch(() => undefined); // por clique: o número do diálogo é o de agora
        ultimoFetch = agora();
        const p = await api.prepararAtualizar(id, sessaoEmFoco());
        if (estado.atualizar === null || ws() !== id) return;
        publicar({ atualizar: { fase: "pronto", preparo: p, erro: null, sugerirCommitar: false, pendente: null } });
        void atualizar();
      } catch (e) {
        if (estado.atualizar !== null) publicar({ atualizar: { fase: "erro", preparo: null, erro: mensagemDe(e), sugerirCommitar: false, pendente: null } });
      }
    },
    fecharAtualizar(): void {
      if (estado.atualizar !== null && estado.atualizar.fase !== "executando") publicar({ atualizar: null });
    },
    /** botão primário do diálogo: `git pull --ff-only` pelo executor do VCS (nunca por agente). */
    async confirmarAtualizar(): Promise<void> {
      const id = ws();
      const api = deps.api();
      const d = estado.atualizar;
      if (id === null || api === undefined || d === null || d.fase === "executando") return;
      publicar({ atualizar: { ...d, fase: "executando", erro: null }, atualizando: true });
      try {
        const r = await api.atualizar(id);
        publicar({ atualizando: false });
        if (ws() !== id) return;
        if (r.estado === "ok") {
          avisar(`Trouxe ${r.trouxe} ${r.trouxe === 1 ? "commit" : "commits"}`, "sucesso");
          publicar({ atualizar: null });
          atualizarResumo(id);
          void atualizar();
        } else if (r.estado === "ja_atualizado") {
          avisar("Já está atualizado", "info");
          publicar({ atualizar: null });
          void atualizar();
        } else if (estado.atualizar !== null) {
          const fase: FaseAtualizar = r.estado === "divergiu" ? "divergiu" : r.estado === "recusado" ? "recusado" : "erro";
          publicar({ atualizar: { ...estado.atualizar, fase, erro: r.motivo ?? "Não foi possível atualizar.", sugerirCommitar: r.sugerir_commitar } });
        }
      } catch (e) {
        publicar({ atualizando: false });
        if (estado.atualizar !== null) publicar({ atualizar: { ...estado.atualizar, fase: "erro", erro: mensagemDe(e), sugerirCommitar: false } });
      }
    },
    pedirMerge,
    /** resposta ao "O agente está trabalhando. Abrir um painel novo para isto?" do pedido de merge. */
    responderOcupadoMerge(abrirNovo: boolean): Promise<void> {
      const d = estado.atualizar;
      if (d === null || d.pendente === null) return Promise.resolve();
      if (!abrirNovo) { publicar({ atualizar: { ...d, fase: "divergiu" } }); return Promise.resolve(); }
      return pedirMerge(d.pendente.cli, "novo");
    },
    // ---- pastas da suíte (D-692) ----
    /** "Ignorar neste computador": acrescenta em `.git/info/exclude` (local). Atualiza fatos, resumo e o preparo do diálogo aberto. */
    async ignorarSuite(): Promise<boolean> {
      const id = ws();
      const api = deps.api();
      if (id === null || api === undefined) return false;
      try {
        const r = await api.ignorarSuite(id);
        avisar(r.estado === "ok" ? `Ignorei ${r.linhas} ${r.linhas === 1 ? "pasta" : "pastas"} da suíte neste computador` : "Nada da suíte para ignorar", r.estado === "ok" ? "sucesso" : "info");
        atualizarResumo(id);
        await atualizar();
        const d = estado.dialogo;
        if (d !== null && d.preparo !== null && ws() === id) {
          const p = await (d.tipo === "pr" ? api.prepararPr(id, sessaoEmFoco()) : api.prepararCommitPush(id, sessaoEmFoco())).catch(() => null);
          if (p !== null && estado.dialogo !== null) publicar({ dialogo: { ...estado.dialogo, preparo: p } });
        }
        return true;
      } catch (e) {
        avisar(mensagemDe(e), "erro");
        return false;
      }
    },
    focarAgente(): void {
      const f = estado.faixa;
      if (f?.sessaoId != null) focar(f.sessaoId);
    },
    dispensarFaixa(): void {
      if (estado.faixa !== null) publicar({ faixa: null });
    },
  };
}

export type StorePublicar = ReturnType<typeof criarStorePublicar>;
export const storePublicar: StorePublicar = criarStorePublicar({ api: () => ade()?.vcsPublicar });

export function usePublicar(store: StorePublicar = storePublicar): EstadoPublicarUI {
  return useSyncExternalStore(store.assinar, store.obter);
}
