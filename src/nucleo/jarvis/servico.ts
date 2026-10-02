// Serviço do Jarvis (T-13.08, núcleo): texto -> classificação (regras; LLM opcional só para INTENÇÃO) -> matriz ator/origem/permissão -> preparação (plano, portão, alvo) ->
// confirmação de uso único atrelada a `args_hash` (quando é escrita) -> execução por PORTAS injetadas -> auditoria. A LLM nunca executa nem decide aprovação humana (D-21):
// gate `exige_humano`, merge, assinatura do prodx e raio ALTO nunca passam por aqui, e conteúdo externo nunca autoriza escrita.
import {
  CONFIG_JARVIS_PADRAO,
  RISCO_DA_ACAO,
  type AcaoTipada,
  type AtorJarvis,
  type CodigoRecusaJarvis,
  type ConfigJarvis,
  type ConfirmacaoVisao,
  type OrigemJarvis,
  type PermissaoRemota,
  type RespostaJarvis,
  type ResultadoJarvis,
  type TurnoJarvis,
} from "../../compartilhado/jarvis";
import { hashArgs } from "../alertas/texto";
import { avaliarPlano, podeExecutarDireto } from "../telegram/politica";
import { requisitoDaAcao, resumoDaAcao, rotuloSeguro, validarAcaoTipada } from "./acoes";
import type { AuditoriaJarvis, Idempotencia } from "./auditoria";
import { classificarComLlm, classificarPorRegras, type PortaClassificadorLlm } from "./classificador";
import { criarArmazemConfirmacoes, type ConfirmacaoPendente, type RelogioJarvis } from "./confirmacao";
import type { PortaConsulta, PortaControle, PortaGates, PortaNavegacao, PortaOrquestradorJarvis, PortaPaineis, PortaRigidez } from "./portas";
import { limparTexto, montarSnapshot } from "./snapshot";

export interface DepsServicoJarvis {
  relogio: RelogioJarvis;
  auditoria: AuditoriaJarvis;
  idempotencia?: Idempotencia;
  config?: () => ConfigJarvis;
  workspaceAtual: () => string | null;
  workspaces: () => string[];
  consulta?: () => PortaConsulta | null;
  paineis?: () => PortaPaineis | null;
  orquestrador?: () => PortaOrquestradorJarvis | null;
  gates?: () => PortaGates | null;
  controle?: () => PortaControle | null;
  navegacao?: () => PortaNavegacao | null;
  rigidez?: () => PortaRigidez | null;
  llm?: () => PortaClassificadorLlm | null;
  /** tela bloqueada: escrita REMOTA fica suspensa (a pessoa não está presente para confirmar). */
  telaBloqueada?: () => boolean;
  suspenderAoBloquear?: () => boolean;
  scrub?: (t: string) => string;
  ttlConfirmacaoMs?: (ator: AtorJarvis) => number;
  aoMudar?: (tipo: "estado" | "confirmacao_pendente" | "resolvida") => void;
  novoId?: () => string;
}

export interface EntradaTexto {
  texto: string;
  ator: AtorJarvis;
  origem: OrigemJarvis;
  permissao?: PermissaoRemota | null;
  dispositivo?: { id: string; nome: string } | null;
  client_request_id?: string | null;
}
export interface EntradaAcao extends Omit<EntradaTexto, "texto"> {
  acao: unknown;
}

export interface ServicoJarvis {
  processarTexto(e: EntradaTexto): Promise<ResultadoJarvis>;
  executarAcao(e: EntradaAcao): Promise<ResultadoJarvis>;
  resolverConfirmacao(id: string, aprovado: boolean, por: string): Promise<{ ok: boolean; resultado: ResultadoJarvis | null; codigo: CodigoRecusaJarvis | null }>;
  confirmacoes(): ConfirmacaoVisao[];
  confirmacao(id: string): ConfirmacaoVisao | null;
  /** destino de uma confirmação já resolvida (últimas 50): só o texto curto do resultado, nunca o payload. */
  resolucao(id: string): { estado: "executada" | "negada" | "expirada" | "recusada"; texto: string } | null;
  /** remove as vencidas e cancela o que estiver preso (plano proposto). */
  varrer(): Promise<number>;
  anularDoDispositivo(dispositivo_id: string): Promise<number>;
  anularTodas(): Promise<number>;
  turnos(): TurnoJarvis[];
  limparTurnos(): void;
}

const recusa = (codigo: CodigoRecusaJarvis, texto: string): ResultadoJarvis => ({ tipo: "recusado", codigo, texto });
const resposta = (texto: string, linhas: RespostaJarvis["linhas"] = [], nao_confiavel = false): ResultadoJarvis => ({ tipo: "resposta", resposta: { texto, linhas, nao_confiavel } });

const TEXTO_RECUSA: Record<CodigoRecusaJarvis, string> = {
  sem_intencao: "Não entendi. Tente: status, listar missões, listar painéis, consumo, ou «diga ao maestro: …».",
  gesto_proibido: "Isso é um gesto que só a pessoa faz no app (merge, apagar, assinar, raio alto…). Faça no desktop.",
  origem_nao_confiavel: "Conteúdo de painel, issue ou web é só dado: não autoriza ação.",
  permissao_insuficiente: "Este dispositivo não tem permissão para essa ação.",
  acao_fora_da_lista: "Ação fora da lista permitida.",
  acao_humana_so_no_desktop: "Esta aprovação é humana e só vale no desktop.",
  so_no_desktop: "Isso exige o desktop (rigidez, raio ou branch protegida).",
  confirmacao_expirada: "A confirmação expirou. Peça de novo.",
  confirmacao_invalida: "Confirmação inválida ou já usada.",
  plano_alterado: "O plano mudou desde a proposta. Peça de novo.",
  indisponivel: "Serviço indisponível agora.",
  limite_de_taxa: "Devagar: muitos pedidos em pouco tempo.",
  duplicado: "Pedido repetido: já foi tratado.",
  alvo_nao_encontrado: "Não encontrei o alvo.",
  desligado: "O Jarvis está desligado.",
  falhou: "Não foi possível concluir.",
};

export function criarServicoJarvis(d: DepsServicoJarvis): ServicoJarvis {
  const config = (): ConfigJarvis => d.config?.() ?? CONFIG_JARVIS_PADRAO;
  const armazem = criarArmazemConfirmacoes({
    relogio: d.relogio,
    ttl_ms: 30_000,
    ...(d.novoId === undefined ? {} : { novoId: d.novoId }),
  });
  const turnos: TurnoJarvis[] = [];
  const resolucoes = new Map<string, { estado: "executada" | "negada" | "expirada" | "recusada"; texto: string }>();
  const registrarResolucao = (id: string, estado: "executada" | "negada" | "expirada" | "recusada", texto: string): void => {
    resolucoes.set(id, { estado, texto: limparTexto(texto, 200, d.scrub) });
    if (resolucoes.size > 50) {
      const velho = resolucoes.keys().next().value;
      if (velho !== undefined) resolucoes.delete(velho);
    }
  };
  let seq = 0;
  const turno = (papel: TurnoJarvis["papel"], texto: string, resultado: TurnoJarvis["resultado"]): void => {
    turnos.push({ id: `t${++seq}`, em: new Date(d.relogio.agora()).toISOString(), papel, texto: limparTexto(texto, 400, d.scrub), resultado });
    if (turnos.length > 60) turnos.splice(0, turnos.length - 60);
  };
  const resumoResultado = (r: ResultadoJarvis): string =>
    r.tipo === "resposta" ? r.resposta.texto : r.tipo === "confirmacao" ? `Confirme: ${r.confirmacao.resumo}` : r.texto;
  const usuarioRef = (e: { ator: AtorJarvis; dispositivo?: { id: string } | null }): string => `${e.ator}${e.dispositivo === undefined || e.dispositivo === null ? "" : `:${e.dispositivo.id}`}`;

  async function cancelarPlanoPreso(c: ConfirmacaoPendente): Promise<void> {
    const id = c.payload["plano_id"];
    if (c.acao !== "enviar_prompt" || typeof id !== "string") return;
    try {
      await d.orquestrador?.()?.pararPlano(id);
    } catch {
      /* melhor esforço */
    }
  }

  const auditar = (e: EntradaTexto | EntradaAcao, acao: AcaoTipada | null, ok: boolean, codigo: string | null, evento: string, extra: { resumo?: string; args_hash?: string; confirmado_por?: "ui" | "desktop"; t0?: number } = {}): void => {
    d.auditoria.registrar({
      ator: e.ator,
      dispositivo_id: e.dispositivo?.id ?? null,
      evento,
      acao: acao?.acao ?? null,
      risco: acao === null ? null : RISCO_DA_ACAO[acao.acao],
      origem: e.origem,
      confirmado_por: extra.confirmado_por ?? "nenhum",
      ok,
      codigo,
      args_hash: extra.args_hash ?? null,
      resumo: extra.resumo ?? (acao === null ? null : resumoDaAcao(acao)),
      latencia_ms: extra.t0 === undefined ? null : d.relogio.agora() - extra.t0,
    });
  };

  // -------------------------------------------------------------- leituras
  async function lerStatus(): Promise<ResultadoJarvis> {
    const ws = d.workspaces();
    const c = d.consulta?.() ?? null;
    if (c === null) return recusa("indisponivel", TEXTO_RECUSA.indisponivel);
    const [missoes, gates, panes] = await Promise.all([c.missoesAtivas(ws).catch(() => []), d.gates?.()?.pendentes(ws).catch(() => []) ?? Promise.resolve([]), d.paineis?.()?.listar().catch(() => []) ?? Promise.resolve([])]);
    const aguardando = panes.filter((p) => p.estado === "aguardando").length;
    const cota = c.cotaGeralPct();
    const linhas: RespostaJarvis["linhas"] = [
      { rotulo: "Missões ativas", detalhe: String(missoes.length) },
      { rotulo: "Painéis aguardando você", detalhe: String(aguardando) },
      { rotulo: "Portões pendentes", detalhe: `${gates.length}${gates.some((g) => g.exige_humano) ? " (alguns só no desktop)" : ""}` },
      { rotulo: "Cota geral", detalhe: cota === null ? "sem fonte" : `${Math.round(cota)}%` },
      { rotulo: "Alertas críticos não lidos", detalhe: String(c.alertasCriticosNaoLidos()) },
    ];
    return resposta(`${missoes.length} Missão(ões) ativa(s), ${aguardando} painel(is) aguardando.`, linhas);
  }
  async function lerMissoes(): Promise<ResultadoJarvis> {
    const c = d.consulta?.() ?? null;
    if (c === null) return recusa("indisponivel", TEXTO_RECUSA.indisponivel);
    const m = await c.missoesAtivas(d.workspaces());
    if (m.length === 0) return resposta("Nenhuma Missão ativa.");
    return resposta(`${m.length} Missão(ões) ativa(s).`, m.slice(0, 10).map((x) => ({ rotulo: limparTexto(x.titulo, 60, d.scrub), detalhe: `${x.panes_trabalhando} trabalhando, ${x.panes_aguardando} aguardando` })), true);
  }
  async function lerPaineis(): Promise<ResultadoJarvis> {
    const p = d.paineis?.() ?? null;
    if (p === null) return recusa("indisponivel", TEXTO_RECUSA.indisponivel);
    const s = montarSnapshot(await p.listar(), d.scrub === undefined ? {} : { scrub: d.scrub });
    if (s.length === 0) return resposta("Nenhum painel aberto.");
    return resposta(`${s.length} painel(is).`, s.map((x) => ({ rotulo: `#${x.display_id} · ${x.label} · ${x.estado}`, detalhe: x.pending_question ?? x.last_message })), true);
  }
  async function lerConsumo(): Promise<ResultadoJarvis> {
    const c = d.consulta?.() ?? null;
    if (c === null) return recusa("indisponivel", TEXTO_RECUSA.indisponivel);
    const itens = (await c.consumo?.()) ?? [];
    const geral = c.cotaGeralPct();
    return resposta(`Cota geral: ${geral === null ? "sem fonte" : `${Math.round(geral)}%`}.`, itens.slice(0, 10).map((x) => ({ rotulo: `${limparTexto(x.conta, 30, d.scrub)} (${limparTexto(x.provedor, 20)})`, detalhe: x.pct === null ? "sem fonte" : `${Math.round(x.pct)}%` })));
  }

  // -------------------------------------------------------------- escrita: preparação
  type Preparo = { tipo: "ok"; resumo: string; payload: Record<string, unknown>; pode_direto: boolean } | { tipo: "recusa"; codigo: CodigoRecusaJarvis; texto?: string };
  const falhaPlano = (e: EntradaTexto | EntradaAcao, motivo: string): { codigo: CodigoRecusaJarvis } => ({ codigo: motivo.includes("humana") ? "acao_humana_so_no_desktop" : "so_no_desktop" });

  function avaliar(plano: import("../../compartilhado/alertas").PlanoRemoto, ator: AtorJarvis, direto: boolean): { permitido: boolean; direto: boolean; motivo: string } {
    const ctx = { modo: direto ? ("direto" as const) : ("aprovar" as const), rigidez: d.rigidez?.() ?? null };
    const r = avaliarPlano(plano, ctx);
    // Jarvis (desktop presente) aceita "desktop"; o remoto só o que a política libera para canais remotos
    const ok = ator === "jarvis" ? r.permitido !== "bloqueado" : r.permitido === "telegram";
    return { permitido: ok, direto: ok && direto && podeExecutarDireto(plano, ctx), motivo: r.motivo };
  }

  async function prepararEnviar(e: EntradaTexto | EntradaAcao, a: Extract<AcaoTipada, { acao: "enviar_prompt" }>, quer_direto: boolean): Promise<Preparo> {
    const orq = d.orquestrador?.() ?? null;
    const ws = d.workspaceAtual();
    if (orq === null) return { tipo: "recusa", codigo: "indisponivel" };
    if (ws === null) return { tipo: "recusa", codigo: "alvo_nao_encontrado", texto: "Nenhum workspace aberto para receber o pedido." };
    const texto = a.destino === "squad" ? `[squad ${a.squad ?? ""}] ${a.texto}` : a.texto;
    const plano = await orq.proporPlano({ workspace_id: ws, texto_redigido: texto, origem: e.ator === "jarvis" ? "jarvis" : "remoto", usuario_ref: usuarioRef(e) });
    if ("recusado" in plano) return { tipo: "recusa", codigo: plano.recusado === "bloqueado" ? "so_no_desktop" : "indisponivel" };
    const av = avaliar(plano, e.ator, quer_direto);
    if (!av.permitido) {
      await orq.pararPlano(plano.plano_id).catch(() => false);
      return { tipo: "recusa", ...falhaPlano(e, av.motivo) };
    }
    const resumoPlano = `${plano.pipeline.skill}, ${plano.paineis_estimados} painel(is), rigidez ${plano.rigidez}, raio ${plano.raio}`;
    return { tipo: "ok", resumo: resumoDaAcao(a, { plano: resumoPlano }), payload: { acao: a, plano_id: plano.plano_id, plano_hash: plano.args_hash, workspace_id: ws }, pode_direto: av.direto };
  }

  async function prepararGate(a: Extract<AcaoTipada, { acao: "aprovar_gate" }>): Promise<Preparo> {
    const g = d.gates?.() ?? null;
    if (g === null) return { tipo: "recusa", codigo: "indisponivel" };
    const alvo = (await g.pendentes(d.workspaces())).find((x) => x.id.toLowerCase() === a.gate_id.toLowerCase());
    if (alvo === undefined) return { tipo: "recusa", codigo: "alvo_nao_encontrado" };
    if (alvo.exige_humano) return { tipo: "recusa", codigo: "acao_humana_so_no_desktop" };
    const titulo = limparTexto(alvo.titulo, 80, d.scrub);
    return { tipo: "ok", resumo: resumoDaAcao(a, { gate_titulo: titulo }), payload: { acao: a, gate_id: alvo.id, titulo }, pode_direto: false };
  }

  async function prepararControle(a: Extract<AcaoTipada, { acao: "pausar" | "parar" }>): Promise<Preparo> {
    const c = d.controle?.() ?? null;
    if (c === null) return { tipo: "recusa", codigo: "indisponivel" };
    const todos = await c.alvos();
    const q = a.alvo.toLowerCase();
    const achados = q === "tudo" || q === "todos" ? todos : todos.filter((x) => x.id.toLowerCase() === q).length > 0 ? todos.filter((x) => x.id.toLowerCase() === q) : todos.filter((x) => x.rotulo.toLowerCase().includes(q));
    if (achados.length === 0) return { tipo: "recusa", codigo: "alvo_nao_encontrado" };
    if (achados.length > 1 && q !== "tudo" && q !== "todos") return { tipo: "recusa", codigo: "alvo_nao_encontrado", texto: `Mais de um alvo combina com «${rotuloSeguro(a.alvo, 40)}»: ${achados.slice(0, 5).map((x) => limparTexto(x.rotulo, 30)).join(", ")}.` };
    const rotulo = achados.length === 1 ? limparTexto((achados[0] as { rotulo: string }).rotulo, 60, d.scrub) : `${achados.length} alvos`;
    return { tipo: "ok", resumo: resumoDaAcao(a, { alvo_rotulo: rotulo }), payload: { acao: a, ids: achados.map((x) => x.id), rotulo }, pode_direto: false };
  }

  // -------------------------------------------------------------- escrita: execução (depois da confirmação ou direta)
  async function executarPreparo(e: { ator: AtorJarvis; dispositivo?: { id: string; nome: string } | null }, payload: Readonly<Record<string, unknown>>): Promise<ResultadoJarvis> {
    const a = payload["acao"] as AcaoTipada;
    if (a.acao === "enviar_prompt") {
      const orq = d.orquestrador?.() ?? null;
      if (orq === null) return recusa("indisponivel", TEXTO_RECUSA.indisponivel);
      const id = payload["plano_id"] as string;
      const atual = await orq.planoAtual(id);
      if (atual === null || atual.args_hash !== payload["plano_hash"]) return recusa("plano_alterado", TEXTO_RECUSA.plano_alterado);
      const av = avaliar(atual, e.ator, false);
      if (!av.permitido) {
        await orq.pararPlano(id).catch(() => false);
        return recusa(falhaPlano(e as EntradaTexto, av.motivo).codigo, TEXTO_RECUSA[falhaPlano(e as EntradaTexto, av.motivo).codigo]);
      }
      const r = await orq.executarPlano(id, { aprovado_por: `jarvis:${usuarioRef(e)}`, args_hash: atual.args_hash });
      if (!r.iniciado) return recusa(r.motivo === "plano_alterado" ? "plano_alterado" : "falhou", `Não iniciou${r.motivo === undefined ? "" : ` (${rotuloSeguro(r.motivo, 40)})`}.`);
      return resposta(`Pedido enviado ao ${a.destino === "maestro" ? "Maestro" : `squad ${a.squad ?? ""}`}.`, r.mission_id === undefined ? [] : [{ rotulo: "Missão", detalhe: r.mission_id }]);
    }
    if (a.acao === "aprovar_gate") {
      const g = d.gates?.() ?? null;
      if (g === null) return recusa("indisponivel", TEXTO_RECUSA.indisponivel);
      const alvo = (await g.pendentes(d.workspaces())).find((x) => x.id === payload["gate_id"]);
      if (alvo === undefined) return recusa("alvo_nao_encontrado", TEXTO_RECUSA.alvo_nao_encontrado);
      if (alvo.exige_humano) return recusa("acao_humana_so_no_desktop", TEXTO_RECUSA.acao_humana_so_no_desktop);
      const r = await g.decidir(alvo.id, a.decisao, `jarvis:${usuarioRef(e)}`);
      return r.ok ? resposta(a.decisao === "aprovar" ? "Portão aprovado." : "Portão recusado.") : recusa("falhou", TEXTO_RECUSA.falhou);
    }
    if (a.acao === "pausar" || a.acao === "parar") {
      const c = d.controle?.() ?? null;
      if (c === null) return recusa("indisponivel", TEXTO_RECUSA.indisponivel);
      let feitos = 0;
      for (const id of payload["ids"] as string[]) if (await (a.acao === "pausar" ? c.pausar(id) : c.parar(id)).catch(() => false)) feitos++;
      return feitos > 0 ? resposta(`${a.acao === "pausar" ? "Pausado" : "Parado"}: ${feitos} alvo(s). Nada foi apagado.`) : recusa("falhou", TEXTO_RECUSA.falhou);
    }
    return recusa("acao_fora_da_lista", TEXTO_RECUSA.acao_fora_da_lista);
  }

  // -------------------------------------------------------------- entrada de ação tipada
  async function executarAcao(e: EntradaAcao): Promise<ResultadoJarvis> {
    const t0 = d.relogio.agora();
    await varrer();
    const v = validarAcaoTipada(e.acao);
    if (!v.ok) {
      auditar(e, null, false, "acao_fora_da_lista", "acao_recusada");
      return recusa("acao_fora_da_lista", TEXTO_RECUSA.acao_fora_da_lista);
    }
    const a = v.acao;
    if (e.ator === "jarvis" && !config().ligado) {
      auditar(e, a, false, "desligado", "acao_recusada");
      return recusa("desligado", TEXTO_RECUSA.desligado);
    }
    const req = requisitoDaAcao({ ator: e.ator, permissao: e.permissao ?? null, origem: e.origem, acao: a.acao });
    if (!req.permitido) {
      auditar(e, a, false, req.codigo ?? "permissao_insuficiente", "acao_recusada", { t0 });
      return recusa(req.codigo ?? "permissao_insuficiente", TEXTO_RECUSA[req.codigo ?? "permissao_insuficiente"]);
    }
    const risco = RISCO_DA_ACAO[a.acao];
    if (e.ator === "remoto" && risco !== "leitura" && d.telaBloqueada?.() === true && d.suspenderAoBloquear?.() !== false) {
      auditar(e, a, false, "so_no_desktop", "escrita_suspensa_tela_bloqueada", { t0 });
      return recusa("so_no_desktop", "Escrita remota suspensa: a tela está bloqueada.");
    }
    // idempotência (AC-21): o mesmo pedido repetido não duplica
    const rid = e.client_request_id ?? null;
    if (rid !== null && risco !== "leitura") {
      const guardado = d.idempotencia?.obter(e.ator, e.dispositivo?.id ?? null, rid) as { confirmacao_id?: string; resultado?: ResultadoJarvis } | null | undefined;
      if (guardado !== null && guardado !== undefined) {
        const pend = guardado.confirmacao_id === undefined ? null : armazem.obter(guardado.confirmacao_id);
        if (pend !== null) return { tipo: "confirmacao", confirmacao: armazem.visao(pend) };
        auditar(e, a, false, "duplicado", "acao_recusada", { t0 });
        return recusa("duplicado", TEXTO_RECUSA.duplicado);
      }
    }
    try {
      if (risco === "leitura") {
        const r = a.acao === "status" ? await lerStatus() : a.acao === "listar_missoes" ? await lerMissoes() : a.acao === "listar_paineis" ? await lerPaineis() : await lerConsumo();
        auditar(e, a, r.tipo === "resposta", r.tipo === "recusado" ? r.codigo : null, "acao_executada", { t0 });
        return r;
      }
      if (a.acao === "abrir_pane") {
        const nav = d.navegacao?.() ?? null;
        const r = nav === null ? { ok: false } : await nav.abrirPane(a.pane);
        auditar(e, a, r.ok, r.ok ? null : "alvo_nao_encontrado", "acao_executada", { t0 });
        return r.ok ? resposta(`Painel ${rotuloSeguro(a.pane, 20)} em foco.`) : recusa("alvo_nao_encontrado", `Não achei o painel ${rotuloSeguro(a.pane, 20)}.`);
      }
      const preparo = a.acao === "enviar_prompt" ? await prepararEnviar(e, a, req.confirmacao === "nenhuma") : a.acao === "aprovar_gate" ? await prepararGate(a) : await prepararControle(a as Extract<AcaoTipada, { acao: "pausar" | "parar" }>);
      if (preparo.tipo === "recusa") {
        auditar(e, a, false, preparo.codigo, "acao_recusada", { t0 });
        return recusa(preparo.codigo, preparo.texto ?? TEXTO_RECUSA[preparo.codigo]);
      }
      if (req.confirmacao === "nenhuma" && preparo.pode_direto) {
        const r = await executarPreparo(e, preparo.payload);
        if (rid !== null) d.idempotencia?.gravar(e.ator, e.dispositivo?.id ?? null, rid, { resultado: r.tipo });
        auditar(e, a, r.tipo === "resposta", r.tipo === "recusado" ? r.codigo : null, "acao_executada_direta", { t0, resumo: preparo.resumo });
        return r;
      }
      const ttl = d.ttlConfirmacaoMs?.(e.ator);
      const c = armazem.criar({ ator: e.ator, dispositivo_id: e.dispositivo?.id ?? null, dispositivo_nome: e.dispositivo?.nome ?? null, acao: a.acao, resumo: preparo.resumo, payload: preparo.payload, ...(ttl === undefined ? {} : { ttl_ms: ttl }) });
      if (rid !== null) d.idempotencia?.gravar(e.ator, e.dispositivo?.id ?? null, rid, { confirmacao_id: c.id });
      auditar(e, a, true, null, "confirmacao_pedida", { t0, args_hash: c.args_hash, resumo: preparo.resumo });
      d.aoMudar?.("confirmacao_pendente");
      return { tipo: "confirmacao", confirmacao: armazem.visao(c) };
    } catch (erro) {
      auditar(e, a, false, "falhou", "acao_falhou", { t0, resumo: erro instanceof Error ? erro.name : "erro" });
      return recusa("falhou", TEXTO_RECUSA.falhou);
    }
  }

  // -------------------------------------------------------------- entrada de texto
  async function processarTexto(e: EntradaTexto): Promise<ResultadoJarvis> {
    const t0 = d.relogio.agora();
    turno("usuario", e.texto, null);
    const fim = (r: ResultadoJarvis): ResultadoJarvis => {
      turno("jarvis", resumoResultado(r), r.tipo);
      return r;
    };
    if (e.ator === "jarvis" && !config().ligado) {
      auditar(e, null, false, "desligado", "texto_recusado");
      return fim(recusa("desligado", TEXTO_RECUSA.desligado));
    }
    // conteúdo externo (painel, issue, web, saída de terminal) NUNCA é interpretado como comando
    if (e.origem === "conteudo_externo") {
      auditar(e, null, false, "origem_nao_confiavel", "texto_recusado");
      return fim(recusa("origem_nao_confiavel", TEXTO_RECUSA.origem_nao_confiavel));
    }
    let c = classificarPorRegras(e.texto);
    if (c.tipo === "sem_intencao" && e.ator === "jarvis") {
      const cfg = config();
      const porta = cfg.llm_ligado && cfg.llm_consentimento ? (d.llm?.() ?? null) : null;
      if (porta !== null) c = await classificarComLlm(e.texto, porta);
    }
    if (c.tipo === "recusado") {
      auditar(e, null, false, "gesto_proibido", "texto_recusado", { resumo: c.gesto, t0 });
      return fim(recusa("gesto_proibido", TEXTO_RECUSA.gesto_proibido));
    }
    if (c.tipo === "sem_intencao") {
      auditar(e, null, false, "sem_intencao", "texto_sem_intencao", { t0 });
      return fim({ tipo: "sem_intencao", texto: TEXTO_RECUSA.sem_intencao });
    }
    const r = await executarAcao({ ator: e.ator, origem: e.origem, permissao: e.permissao ?? null, dispositivo: e.dispositivo ?? null, client_request_id: e.client_request_id ?? null, acao: c.acao });
    return fim(r);
  }

  async function varrer(): Promise<number> {
    const vencidas = armazem.expirar();
    for (const c of vencidas) {
      registrarResolucao(c.id, "expirada", TEXTO_RECUSA.confirmacao_expirada);
      await cancelarPlanoPreso(c);
      d.auditoria.registrar({ ator: c.ator, dispositivo_id: c.dispositivo_id, evento: "confirmacao_expirou", acao: c.acao, risco: RISCO_DA_ACAO[c.acao], ok: false, codigo: "confirmacao_expirada", args_hash: c.args_hash, resumo: c.resumo });
    }
    if (vencidas.length > 0) d.aoMudar?.("resolvida");
    return vencidas.length;
  }

  return {
    processarTexto,
    executarAcao,
    async resolverConfirmacao(id, aprovado, por) {
      const pend = armazem.obter(id);
      const r = armazem.resolver(id, { aprovado, por });
      if (!r.ok) {
        if (pend !== null) {
          registrarResolucao(id, r.codigo === "confirmacao_expirada" ? "expirada" : "recusada", TEXTO_RECUSA[r.codigo]);
          await cancelarPlanoPreso(pend);
        }
        d.auditoria.registrar({ ator: pend?.ator ?? "jarvis", dispositivo_id: pend?.dispositivo_id ?? null, evento: "confirmacao_recusada", acao: pend?.acao ?? null, ok: false, codigo: r.codigo, args_hash: pend?.args_hash ?? null });
        d.aoMudar?.("resolvida");
        return { ok: false, resultado: null, codigo: r.codigo };
      }
      const c = r.confirmacao;
      const base = { ator: c.ator, dispositivo_id: c.dispositivo_id, acao: c.acao, risco: RISCO_DA_ACAO[c.acao], args_hash: c.args_hash, resumo: c.resumo };
      if (!r.aprovado) {
        registrarResolucao(c.id, "negada", "Cancelado. Nada foi feito.");
        await cancelarPlanoPreso(c);
        d.auditoria.registrar({ ...base, evento: "confirmacao_negada", ok: true, confirmado_por: por === "ui" ? "ui" : "desktop" });
        d.aoMudar?.("resolvida");
        return { ok: true, resultado: resposta("Cancelado. Nada foi feito."), codigo: null };
      }
      if (c.ator === "remoto" && d.telaBloqueada?.() === true && d.suspenderAoBloquear?.() !== false) {
        registrarResolucao(c.id, "recusada", "Escrita remota suspensa: a tela está bloqueada.");
        await cancelarPlanoPreso(c);
        d.auditoria.registrar({ ...base, evento: "escrita_suspensa_tela_bloqueada", ok: false, codigo: "so_no_desktop" });
        d.aoMudar?.("resolvida");
        return { ok: true, resultado: recusa("so_no_desktop", "Escrita remota suspensa: a tela está bloqueada."), codigo: null };
      }
      const t0 = d.relogio.agora();
      let res: ResultadoJarvis;
      try {
        res = await executarPreparo({ ator: c.ator, dispositivo: c.dispositivo_id === null ? null : { id: c.dispositivo_id, nome: c.dispositivo_nome ?? "" } }, c.payload);
      } catch {
        res = recusa("falhou", TEXTO_RECUSA.falhou);
      }
      registrarResolucao(c.id, res.tipo === "resposta" ? "executada" : "recusada", resumoResultado(res));
      d.auditoria.registrar({ ...base, evento: "confirmacao_executada", ok: res.tipo === "resposta", codigo: res.tipo === "recusado" ? res.codigo : null, confirmado_por: por === "ui" ? "ui" : "desktop", latencia_ms: d.relogio.agora() - t0 });
      d.aoMudar?.("resolvida");
      return { ok: true, resultado: res, codigo: null };
    },
    confirmacoes: () => armazem.listar().map((c) => armazem.visao(c)),
    confirmacao: (id) => {
      const c = armazem.obter(id);
      return c === null ? null : armazem.visao(c);
    },
    resolucao: (id) => resolucoes.get(id) ?? null,
    varrer,
    async anularDoDispositivo(dispositivo_id) {
      const fora = armazem.anularTodas((c) => c.dispositivo_id === dispositivo_id);
      for (const c of fora) {
        registrarResolucao(c.id, "recusada", "Dispositivo revogado.");
        await cancelarPlanoPreso(c);
      }
      if (fora.length > 0) d.aoMudar?.("resolvida");
      return fora.length;
    },
    async anularTodas() {
      const fora = armazem.anularTodas();
      for (const c of fora) {
        registrarResolucao(c.id, "recusada", "Cancelado pelo pânico.");
        await cancelarPlanoPreso(c);
      }
      if (fora.length > 0) d.aoMudar?.("resolvida");
      return fora.length;
    },
    turnos: () => [...turnos],
    limparTurnos: () => void turnos.splice(0, turnos.length),
  };
}

export { hashArgs };
