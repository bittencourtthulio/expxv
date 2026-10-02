// T-16.26 · ServicoMaestro: pedir → classificar (regras; decisor opcional) → plano (proposto) → confirmar → um terminal por etapa → disco avança → próxima.
// Tudo por PORTAS injetadas (persistência, leitura do método, Panes, harness, hooks.json, decisor, relógio, notificação): nenhum acoplamento ao main nem ao banco.
// Implementa a `PortaMaestro` (a mesma que o chat da Fase 15 e o Telegram da Fase 20 usam). O decisor externo NUNCA fica no caminho de conta/troca (D-53).
import { createHash } from "node:crypto";
import { INTENCOES_ACIONAVEIS, VIAS_REMOTAS, type EtapaExec, type EtapaId, type Intencao, type NivelRigidez, type PedidoMaestro, type PipelineEstado, type PipelineResumo, type PlanoMaestro, type PortaMaestro, type ReciboMaestro, type ResultadoClassificacao, type ViaMaestro } from "../../compartilhado/maestro";
import { resumirParaDecisor } from "../harness/decisor/resumo";
import { PRODUTO } from "../produto";
import { CONFIG_MAESTRO_PADRAO, type ConfigMaestro } from "./config";
import { despachar, type PortasDoDespachante } from "./despachante";
import { SONDA_VAZIA, type SondaDeDisco, type TrabalhoParaMaestro } from "./etapas/conclusao";
import { criarGuardas, ehDireto, ehMarcadorDoMaestro, ehSlashCommand, type Guardas } from "./guardas";
import { classificarIntencao } from "./intencao/classificar";
import { combinarRegraEDecisor, deveConsultarDecisor } from "./intencao/combinar";
import type { DecisorDeIntencao } from "./decisor/cliente";
import { aplicarAcaoDoUsuario, avancar, novoPipeline, resumoDoPipeline, type Acao, type AcaoDoUsuario, type MotivoNotificacao } from "./maquina";
import { planejar } from "./planejar";
import { DECIDIDOR_REGRA, montarRecibo, reciboParaMarkdown } from "./recibo";
import { aplicarHooks, reverterHooks, type PortaArquivosHooks, type ResultadoAplicarHooks } from "./rigidez/hooks";
import { resolverNivel, replanejarExecs, type LeitoresDeNivel } from "./rigidez/escopos";
import { caminhoRelatorioRapido } from "./rigidez/instrucoes";
import { type EvidenciaDoDisco, planoDeEtapas } from "./rigidez/plano-de-etapas";
import { resumoDoPiso, type ItemDePiso } from "./rigidez/piso";
import { avaliarMudancaDeNivel, exigeConfirmacao, nivelMinimoTravado, type EntradaLogRigidez, type ContextoTrava } from "./rigidez/travas";
import { lerRelatorioRapido, redigirSegredosNoTexto } from "./rigidez/piso";

// ---------------------------------------------------------------- portas
export interface ContextoDoMetodo {
  trabalho: TrabalhoParaMaestro | null;
  sondas: SondaDeDisco;
  evidencia: EvidenciaDoDisco;
  ultima_task_concluida_ms: number | null;
  ultima_mudanca_ms: number | null;
  branch: string | null;
}
export interface PortaLeituraDoMetodo {
  contexto(workspace_id: string, p: { trabalho_id: string | null; pipeline_id: PipelineEstado["pipeline_id"] | null }): Promise<ContextoDoMetodo>;
  slugsAbertos(workspace_id: string): Promise<string[]>;
  acharTrabalho(workspace_id: string, ref: { tipo: string; id: string }): Promise<{ trabalho: TrabalhoParaMaestro; sondas: SondaDeDisco } | null>;
  /** acha o trabalho criado pela etapa 1 (OC-ID/slug/PD-ID) depois do início do pipeline. */
  descobrirTrabalho(workspace_id: string, p: PipelineEstado, desde_ms: number): Promise<string | null>;
}
export interface DadosDoRecibo {
  workspace_id: string;
  via: ViaMaestro;
  sinais: string[];
  resumo_enviado: string | null;
  resumo_hash: string | null;
  criado_em: string;
}
export interface PortaPersistencia {
  salvar(p: PipelineEstado): Promise<void>;
  carregar(id: string): Promise<PipelineEstado | null>;
  listarAtivos(workspace_id: string | null): Promise<PipelineEstado[]>;
  salvarRecibo(r: ReciboMaestro, dados: DadosDoRecibo): Promise<void>;
  lerRecibo?(pipeline_id: string): Promise<ReciboMaestro | null>;
  registrarRigidezLog?(e: EntradaLogRigidez & { workspace_id: string; pipeline_id: string; etapa_atual: string | null; escopo: "workspace" | "missao" | "pedido"; hooks_escritos: boolean; ts: string }): Promise<void>;
}
export interface NotificacaoMaestro {
  workspace_id: string;
  pipeline_id: string;
  motivo: MotivoNotificacao;
  etapa_id: EtapaId | null;
  detalhe: string;
}
export interface PortaArquivosDoPipeline {
  gravar(workspace_id: string, rel: string, texto: string): Promise<void>;
  ler(workspace_id: string, rel: string): Promise<string | null>;
}
export interface PortasServico {
  relogio: { agora(): number };
  novoId(prefixo: string): string;
  persistencia: PortaPersistencia;
  metodo: PortaLeituraDoMetodo;
  niveis: LeitoresDeNivel;
  config(workspace_id: string): ConfigMaestro | Promise<ConfigMaestro>;
  despachante: PortasDoDespachante;
  arquivos: PortaArquivosDoPipeline;
  /** `hooks.json` do diretório onde as etapas rodam; `null` = sem permissão/sem diretório. */
  hooks?(workspace_id: string, p: PipelineEstado | null): PortaArquivosHooks | null;
  decisor?: DecisorDeIntencao | null;
  piso?(p: PipelineEstado, ctx: ContextoDoMetodo): Promise<readonly ItemDePiso[]>;
  /** estados atuais dos Panes (id → estado). */
  estadosDosPanes(ids: readonly string[]): Record<string, { estado: import("../dominio/enums").EstadoPane }>;
  fecharPane?(pane_id: string): Promise<void>;
  /** cria a Missão do pipeline; devolve o id. */
  criarMissao?(p: PipelineEstado): Promise<string | null>;
  consultar?(workspace_id: string, etapa_id: EtapaId, texto: string): Promise<void>;
  aprender?(p: PipelineEstado): Promise<void>;
  restaurarNivel?(p: PipelineEstado): Promise<void>;
  notificar?(n: NotificacaoMaestro): void | Promise<void>;
  evento?(e: { tipo: string; pipeline_id: string | null; detalhe?: string }): void;
  /** módulos da suíte desligados no workspace (D-480): síncrono e barato; ausente = nenhum desligado. */
  modulosDesligados?(workspace_id: string): ReadonlySet<string>;
}

export type CodigoDeErro = "module_disabled" | "invalid_argument" | "loop_guard" | "taxa_excedida" | "ignorado" | "plano_inexistente" | "estado_invalido" | "plano_expirado" | "abaixo_do_minimo" | "confirmacao_necessaria" | "canal_remoto_nao_baixa" | "canal_remoto_nao_sobrescreve_trava" | "indisponivel";
export class MaestroErro extends Error {
  constructor(readonly codigo: CodigoDeErro, mensagem: string) {
    super(mensagem);
    this.name = "MaestroErro";
  }
}
export interface AjustesDeConfirmacao {
  nivel?: NivelRigidez;
  etapas_desligadas?: string[];
  intencao?: Intencao;
  justificativa?: string;
  confirmacao_digitada?: string;
}
export interface ResultadoMudancaDeNivel {
  efetivo: NivelRigidez;
  hooks: { escrito: boolean; agendado: boolean; arquivo: string | null; aviso: string | null };
  adicionadas: EtapaExec["etapa_id"][];
  puladas: EtapaExec["etapa_id"][];
}

const TEXTO_MAX = 4000;
const hashTexto = (t: string): string => createHash("sha256").update(t, "utf8").digest("hex");
const iso = (ms: number): string => new Date(ms).toISOString();

export function criarServicoMaestro(portas: PortasServico): ServicoMaestro {
  return new ServicoMaestro(portas);
}

export class ServicoMaestro implements PortaMaestro {
  private readonly guardas: Guardas;
  private readonly recibos = new Map<string, ReciboMaestro>();
  private readonly pedidos = new Map<string, string>();
  private readonly filas = new Map<string, Promise<unknown>>();
  private readonly panesDoMaestro = new Set<string>();

  constructor(private readonly p: PortasServico) {
    this.guardas = criarGuardas({ agora: () => p.relogio.agora(), ehPaneDoMaestro: (id) => this.panesDoMaestro.has(id) });
  }

  /** Módulos desligados do workspace (D-480); nunca lança. */
  private desligados(ws: string): ReadonlySet<string> {
    try { return this.p.modulosDesligados?.(ws) ?? new Set(); } catch { return new Set(); }
  }

  private async cfg(ws: string): Promise<ConfigMaestro> {
    try {
      return await this.p.config(ws);
    } catch {
      return CONFIG_MAESTRO_PADRAO;
    }
  }
  private serial<T>(id: string, f: () => Promise<T>): Promise<T> {
    const anterior = this.filas.get(id) ?? Promise.resolve();
    const prox = anterior.then(f, f);
    const limpo = prox.catch(() => undefined);
    this.filas.set(id, limpo);
    void limpo.then(() => {
      if (this.filas.get(id) === limpo) this.filas.delete(id);
    });
    return prox;
  }
  /** Panes abertos pelo Maestro: sem `maestro_request` nem hook (anti-loop). */
  registrarPaneDoMaestro(id: string): void {
    this.panesDoMaestro.add(id);
  }
  ehPaneDoMaestro(id: string): boolean {
    return this.panesDoMaestro.has(id);
  }
  registrarEco(pane_id: string, texto: string): void {
    this.guardas.registrarEco(pane_id, texto);
  }

  // ---------------------------------------------------------------- PortaMaestro
  async classificar(texto: string, ctx: { workspace_id: string; contexto: PedidoMaestro["contexto"] }): Promise<ResultadoClassificacao> {
    const slugs = await this.p.metodo.slugsAbertos(ctx.workspace_id).catch(() => []);
    return classificarIntencao(typeof texto === "string" ? texto : "", { slugs_abertos: slugs });
  }

  async pedir(pedido: PedidoMaestro): Promise<{ plano: PlanoMaestro; recibo: ReciboMaestro }> {
    const bruto = typeof pedido.texto === "string" ? pedido.texto.trim().slice(0, TEXTO_MAX) : "";
    if (bruto === "") throw new MaestroErro("invalid_argument", "pedido vazio");
    // segredo colado no pedido nunca vai ao terminal, ao pedido.md, ao hash nem ao banco (AGENTS.md regra 3): o resto do texto fica como está
    const { texto, redigiu: segredoRedigido } = redigirSegredosNoTexto(bruto);
    const paneId = pedido.contexto?.pane_id ?? null;
    const g = this.guardas.avaliar({ texto, pane_id: paneId, via: pedido.via });
    if (g.acao === "loop_guard") throw new MaestroErro("loop_guard", "Pane de etapa do Maestro não pede ao Maestro");
    if (g.acao === "taxa_excedida") throw new MaestroErro("taxa_excedida", "pedidos demais deste painel; espere um minuto");
    if (g.acao === "marcador_maestro" || g.acao === "passa_direto" || g.acao === "eco") throw new MaestroErro("ignorado", g.acao);
    if (g.acao === "idempotente") {
      const existente = await this.p.persistencia.carregar(g.plano_id);
      const recibo = this.recibos.get(g.plano_id) ?? (await this.p.persistencia.lerRecibo?.(g.plano_id)) ?? null;
      if (existente !== null && recibo !== null) return { plano: existente.plano, recibo };
    }
    const ws = pedido.workspace_id;
    const cfg = await this.cfg(ws);
    const agora = this.p.relogio.agora();
    this.p.evento?.({ tipo: "maestro.requested", pipeline_id: null, detalhe: pedido.via });

    // 1. regra (+ decisor opcional)
    const regra = await this.classificar(texto, { workspace_id: ws, contexto: pedido.contexto });
    let intencao: Intencao = regra.intencao;
    let confianca = regra.confianca;
    let fonte = regra.fonte as PlanoMaestro["fonte"];
    let divergiu = false;
    let escolhaDecisor: Intencao | null = null;
    let decididor = DECIDIDOR_REGRA;
    let resumoEnviado: string | null = null;
    let resumoHash: string | null = null;
    let decisorLigado = false;
    if (regra.fonte === "regra" && this.p.decisor != null && deveConsultarDecisor(regra.confianca)) {
      decisorLigado = this.p.decisor.habilitadoEfetivo();
      const r = await this.p.decisor.consultar(texto, pedido.via);
      const d = r.ok ? r.decisao : null;
      const comb = combinarRegraEDecisor({ intencao: regra.intencao, confianca: regra.confianca }, d === null ? null : { intencao: d.intencao, confianca: d.confianca }, r.ok || r.tentado);
      intencao = comb.intencao;
      confianca = comb.confianca;
      fonte = comb.fonte;
      divergiu = comb.divergiu;
      escolhaDecisor = d?.intencao ?? null;
      if (d !== null) {
        decididor = { tipo: d.tipo, modelo: d.modelo, endpoint_host: d.endpoint_host, latencia_ms: d.latencia_ms, custo_usd: d.custo_usd };
        resumoEnviado = d.resumo_enviado;
        resumoHash = d.resumo_hash;
      } else if (r.ok === false && r.tentado) resumoEnviado = null;
    }

    // 2. nível de rigidez efetivo (pedido > Missão > squad > workspace > padrão) com trava
    const retomar = regra.retomar;
    const achado = retomar === null ? null : await this.p.metodo.acharTrabalho(ws, retomar).catch(() => null);
    const ctxMetodo = await this.p.metodo.contexto(ws, { trabalho_id: achado?.trabalho.id ?? pedido.contexto?.trabalho_id ?? null, pipeline_id: null }).catch(() => null);
    const evidencia: EvidenciaDoDisco = ctxMetodo?.evidencia ?? { legado: false, convencoes: false, design_system: false, produto: true, raio: null };
    const raioFaixa = achado?.trabalho.raio?.faixa ?? ctxMetodo?.trabalho?.raio?.faixa ?? null;
    const [wsNivel, missaoNivel] = await Promise.all([this.p.niveis.workspace(ws).catch(() => null), pedido.contexto?.mission_id == null ? Promise.resolve(null) : this.p.niveis.missao(pedido.contexto.mission_id).catch(() => null)]);
    const base = resolverNivel({ workspace: wsNivel, missao: missaoNivel });
    const remoto = VIAS_REMOTAS.includes(pedido.via);
    // canal remoto só SOBE a rigidez
    const nivelPedido = pedido.nivel_pedido !== null && (!remoto || pedido.nivel_pedido > base.efetivo) ? pedido.nivel_pedido : null;
    const minimo = nivelMinimoTravado({ raio_faixa: raioFaixa });
    const efetivo = resolverNivel({ pedido: nivelPedido, missao: missaoNivel, workspace: wsNivel, minimo_travado: minimo.minimo, motivo_trava: minimo.motivo });
    const ctxTrava: ContextoTrava = { raio_faixa: raioFaixa, branch: ctxMetodo?.branch ?? null, branches_protegidas: cfg.branches_protegidas, producao: cfg.producao };
    const exigeBaixa = exigeConfirmacao(ctxTrava, efetivo.efetivo);

    // 3. plano
    const id = this.p.novoId("mpl");
    const ativos = await this.p.persistencia.listarAtivos(ws).catch(() => []);
    const ativoNoAlvo = ativos.some((a) => (achado !== null && a.trabalho_id === achado.trabalho.id) || (pedido.contexto?.mission_id != null && a.mission_id === pedido.contexto.mission_id));
    const plano = planejar(
      { intencao, confianca, candidatas: regra.candidatas, retomar, fonte, ...(regra.so_humano === true ? { so_humano: true } : {}) },
      efetivo.efetivo,
      {
        id, agora_ms: agora, evidencia, fontes: this.p.despachante.fontes(ws), permissao: cfg.permissao, nivel_origem: nivelPedido !== null ? "pedido" : efetivo.origem, modulos_desligados: this.desligados(ws),
        trava: minimo.motivo === null ? null : { minimo: minimo.minimo, motivo: minimo.motivo }, trabalho: achado, pipeline_ativo_no_alvo: ativoNoAlvo, expira_min: cfg.proposta_expira_min,
        executar_direto_permitido: !cfg.confirmar_plano && pedido.executar_direto !== false, via: pedido.via, branch_protegida: exigeBaixa.exige, confirmou_rigidez_baixa: false,
      },
    );
    // módulo desligado (D-480): pedido de AGENTE (tool/hook/squad/API) é recusado com a causa nomeada; o humano vê o plano indisponível e a confirmação recusa
    if (plano.modulos_desligados !== undefined && ["mcp", "hook", "squad", "api"].includes(pedido.via)) {
      throw new MaestroErro("module_disabled", `módulo desligado neste projeto: ${plano.modulos_desligados.join(", ")}`);
    }
    if (exigeBaixa.exige) plano.avisos.push(`Alvo em ${exigeBaixa.trava === "producao" ? "produção" : "branch protegida"} com rigidez baixa: ao executar, digite "${exigeBaixa.frase}" para confirmar.`);
    if (efetivo.elevado_pela_trava && minimo.motivo !== null) plano.avisos.push(`${minimo.motivo}: o nível foi elevado para ${efetivo.efetivo}.`);
    if (segredoRedigido) plano.avisos.push("O pedido tinha algo com cara de chave ou senha: foi trocado por [segredo] antes de ir ao terminal e aos arquivos.");

    // 4. recibo + persistência (exatamente 1 recibo por pedido)
    const recibo = montarRecibo({ id: this.p.novoId("mrc"), pipeline_id: id, pipeline: plano.pipeline_id, intencao, confianca, fonte, decididor, escolha_regra: regra.intencao, escolha_decisor: escolhaDecisor, divergiu, nivel: plano.nivel, sinais: regra.sinais, etapas: plano.etapas, decisor_ligado: decisorLigado });
    const estado = novoPipeline(
      {
        id, workspace_id: ws, mission_id: pedido.contexto?.mission_id ?? null, trabalho_id: achado?.trabalho.id ?? null, pipeline_id: plano.pipeline_id, intencao, via: pedido.via, origem_pane_id: paneId,
        texto_hash: hashTexto(texto), texto_resumo: resumirParaDecisor(texto, { max: 200 }), nivel_base: plano.nivel, nivel_atual: plano.nivel, nivel_pedido: nivelPedido, executar_direto: plano.executar_direto,
        voltar_ao_padrao: nivelPedido !== null, plano, criado_em: iso(agora), atualizado_em: iso(agora), override_trava: false,
      } as Parameters<typeof novoPipeline>[0],
      agora,
    );
    this.pedidos.set(id, texto);
    this.recibos.set(id, recibo);
    await this.p.persistencia.salvar(estado);
    await this.p.persistencia.salvarRecibo(recibo, { workspace_id: ws, via: pedido.via, sinais: regra.sinais, resumo_enviado: resumoEnviado, resumo_hash: resumoHash, criado_em: iso(agora) });
    this.guardas.registrarPlano(texto, paneId, id);
    this.p.evento?.({ tipo: "maestro.plan_proposed", pipeline_id: id });
    this.p.evento?.({ tipo: "maestro.intent_decided", pipeline_id: id, detalhe: `${fonte}${divergiu ? ":divergiu" : ""}` });

    // "executar direto" (opt-in do workspace; nunca com baixa confiança, trava, etapa humana imediata…)
    if (plano.executar_direto && INTENCOES_ACIONAVEIS.includes(plano.intencao) && !cfg.confirmar_plano) await this.confirmar(id);
    return { plano: plano, recibo };
  }

  async confirmar(plano_id: string, ajustes: AjustesDeConfirmacao = {}): Promise<PipelineResumo> {
    return this.serial(plano_id, async () => {
      let pe = await this.p.persistencia.carregar(plano_id);
      if (pe === null) throw new MaestroErro("plano_inexistente", "plano não encontrado");
      if (pe.estado !== "proposto") throw new MaestroErro("estado_invalido", "o plano já foi confirmado ou terminou");
      if (pe.plano.modulos_desligados !== undefined && pe.plano.modulos_desligados.length > 0) {
        const ainda = pe.plano.modulos_desligados.filter((m) => this.desligados(pe!.workspace_id).has(m));
        if (ainda.length > 0) throw new MaestroErro("module_disabled", `ative o módulo ${ainda.join(", ")} em Método › Módulos da suíte para executar este plano`);
      }
      const agora = this.p.relogio.agora();
      if (agora > Date.parse(pe.plano.expira_em)) {
        await this.p.persistencia.salvar({ ...pe, estado: "expirado", motivo_fim: "proposta expirou sem confirmação", concluido_em: iso(agora), atualizado_em: iso(agora) });
        throw new MaestroErro("plano_expirado", "a proposta expirou: peça de novo");
      }
      const cfg = await this.cfg(pe.workspace_id);
      let nivel = pe.nivel_atual;
      const ctxMetodo = await this.p.metodo.contexto(pe.workspace_id, { trabalho_id: pe.trabalho_id, pipeline_id: null }).catch(() => null);
      const ctxTrava: ContextoTrava = { raio_faixa: ctxMetodo?.trabalho?.raio?.faixa ?? (pe.plano.trava?.motivo.includes("ALTO") === true ? "alto" : null), branch: ctxMetodo?.branch ?? null, branches_protegidas: cfg.branches_protegidas, producao: cfg.producao };
      let override = false;
      const quer = ajustes.nivel ?? nivel;
      const m = avaliarMudancaDeNivel({ via: "ui", de: pe.nivel_atual === quer && ajustes.nivel === undefined ? null : pe.nivel_atual, para: quer, ctx: ctxTrava, justificativa: ajustes.justificativa ?? null, confirmacao_digitada: ajustes.confirmacao_digitada ?? null });
      if (!m.ok) throw new MaestroErro(m.erro, m.mensagem);
      override = m.log.trava === "raio_alto";
      nivel = quer;
      const mudouPlano = ajustes.nivel !== undefined || ajustes.intencao !== undefined || (ajustes.etapas_desligadas?.length ?? 0) > 0;
      if (mudouPlano) {
        const evidencia = ctxMetodo?.evidencia ?? { legado: false, convencoes: false, design_system: false, produto: true, raio: null };
        const plano = planejar(
          { intencao: ajustes.intencao ?? pe.intencao, confianca: pe.plano.confianca, candidatas: pe.plano.candidatas ?? [], retomar: null, fonte: ajustes.intencao !== undefined ? "explicito" : pe.plano.fonte },
          nivel,
          { id: pe.id, agora_ms: agora, evidencia, fontes: this.p.despachante.fontes(pe.workspace_id), permissao: cfg.permissao, nivel_origem: ajustes.nivel !== undefined ? "pedido" : pe.plano.nivel_origem, modulos_desligados: this.desligados(pe.workspace_id), trava: pe.plano.trava, override_trava: override, desligadas: new Set((ajustes.etapas_desligadas ?? []) as EtapaId[]), expira_min: cfg.proposta_expira_min },
        );
        const novo = novoPipeline({ ...pe, plano, nivel_atual: nivel, nivel_pedido: ajustes.nivel ?? pe.nivel_pedido, pipeline_id: plano.pipeline_id, intencao: plano.intencao, override_trava: override } as Parameters<typeof novoPipeline>[0], agora);
        pe = { ...novo, estado: "proposto" };
      } else if (override) pe = { ...pe, override_trava: true };

      // depois de replanejar (nível/intenção/etapas mudaram), o plano novo já reflete os módulos de AGORA
      if (mudouPlano && pe.plano.modulos_desligados !== undefined && pe.plano.modulos_desligados.length > 0) throw new MaestroErro("module_disabled", `ative o módulo ${pe.plano.modulos_desligados.join(", ")} em Método › Módulos da suíte para executar este plano`);
      // única escrita em área do método: por ação do usuário, com backup (D-221)
      let hooks: ResultadoAplicarHooks | null = null;
      const porta = this.p.hooks?.(pe.workspace_id, pe) ?? null;
      if (porta !== null && cfg.escrever_hooks) {
        hooks = await aplicarHooks(porta, nivel, { legado: (ctxMetodo?.evidencia.legado ?? false) || pe.pipeline_id === "sprintx_legadox", escrever_hooks: cfg.escrever_hooks, agendar: false }).catch(() => null);
        if (hooks?.escrito === true) this.p.evento?.({ tipo: "maestro.hooks_written", pipeline_id: pe.id });
        await this.p.persistencia.registrarRigidezLog?.({ de: null, para: nivel, por: "usuario", trava: m.log.trava, justificativa: m.log.justificativa, workspace_id: pe.workspace_id, pipeline_id: pe.id, etapa_atual: null, escopo: ajustes.nivel !== undefined ? "pedido" : "workspace", hooks_escritos: hooks?.escrito === true, ts: iso(agora) }).catch(() => undefined);
      }
      const texto = this.pedidos.get(pe.id);
      if (texto !== undefined) await this.p.arquivos.gravar(pe.workspace_id, `${PRODUTO.pastaNoProjeto}/maestro/${pe.id}/pedido.md`, `${texto}\n`).catch(() => undefined);
      const recibo = this.recibos.get(pe.id);
      if (recibo !== undefined) await this.p.arquivos.gravar(pe.workspace_id, `${PRODUTO.pastaNoProjeto}/maestro/${pe.id}/recibo.md`, reciboParaMarkdown(recibo, [])).catch(() => undefined);
      const missao = pe.mission_id ?? (await this.p.criarMissao?.(pe).catch(() => null)) ?? null;
      pe = { ...pe, mission_id: missao, estado: "executando", atualizado_em: iso(agora) };
      await this.p.persistencia.salvar(pe);
      this.p.evento?.({ tipo: "maestro.pipeline_started", pipeline_id: pe.id });
      await this.avancarSemFila(pe.id);
      return resumoDoPipeline((await this.p.persistencia.carregar(pe.id)) ?? pe);
    });
  }

  async cancelar(id: string): Promise<void> {
    await this.serial(id, async () => {
      const pe = await this.p.persistencia.carregar(id);
      if (pe === null) throw new MaestroErro("plano_inexistente", "pipeline não encontrado");
      const r = aplicarAcaoDoUsuario(pe, "cancelar", null, this.p.relogio.agora());
      if (r.erro === null) {
        await this.p.persistencia.salvar(r.pipeline);
        this.p.evento?.({ tipo: "maestro.pipeline_cancelled", pipeline_id: id });
      }
    });
  }

  /** "Tratar neste painel": descarta o plano; o painel segue normal. */
  async tratarNestePainel(plano_id: string): Promise<void> {
    await this.serial(plano_id, async () => {
      const pe = await this.p.persistencia.carregar(plano_id);
      if (pe === null || pe.estado !== "proposto") return;
      const agora = this.p.relogio.agora();
      await this.p.persistencia.salvar({ ...pe, estado: "cancelado", motivo_fim: "tratado neste painel", concluido_em: iso(agora), atualizado_em: iso(agora) });
    });
  }

  async acao(id: string, acao: AcaoDoUsuario, etapa: EtapaId | null): Promise<PipelineResumo> {
    return this.serial(id, async () => {
      const pe = await this.p.persistencia.carregar(id);
      if (pe === null) throw new MaestroErro("plano_inexistente", "pipeline não encontrado");
      const r = aplicarAcaoDoUsuario(pe, acao, etapa, this.p.relogio.agora());
      if (r.erro !== null) throw new MaestroErro("estado_invalido", r.erro);
      await this.p.persistencia.salvar(r.pipeline);
      if (acao !== "pausar" && acao !== "cancelar") await this.avancarSemFila(id);
      return resumoDoPipeline((await this.p.persistencia.carregar(id)) ?? r.pipeline);
    });
  }

  // ---------------------------------------------------------------- andamento
  /** Chamado por `method.changed`, `pane.state_changed` e pelo temporizador de 30 s (`sem_progresso`). Idempotente. */
  avancarPipeline(id: string): Promise<void> {
    return this.serial(id, () => this.avancarSemFila(id));
  }
  /** Reinício do app: reconstrói do banco + disco e segue, sem duplicar despacho. */
  async retomarAposReinicio(): Promise<number> {
    const ativos = await this.p.persistencia.listarAtivos(null);
    for (const a of ativos) for (const e of a.execs) if (e.pane_id !== null) this.panesDoMaestro.add(e.pane_id);
    for (const a of ativos) if (a.estado !== "proposto" && a.estado !== "pausado") await this.avancarPipeline(a.id);
    return ativos.length;
  }
  async tick(): Promise<void> {
    for (const a of await this.p.persistencia.listarAtivos(null)) if (a.estado === "executando" || a.estado.startsWith("aguardando") || a.estado.startsWith("bloqueado")) await this.avancarPipeline(a.id);
  }

  private async avancarSemFila(id: string): Promise<void> {
    let pe = await this.p.persistencia.carregar(id);
    if (pe === null) return;
    const ws = pe.workspace_id;
    const cfg = await this.cfg(ws);
    const agora = this.p.relogio.agora();
    let ctx = await this.p.metodo.contexto(ws, { trabalho_id: pe.trabalho_id, pipeline_id: pe.pipeline_id }).catch(() => null);
    if (ctx === null) return;
    if (pe.trabalho_id === null) {
      const inicio = pe.execs.map((e) => (e.inicio_em === null ? Infinity : Date.parse(e.inicio_em))).reduce((a, b) => Math.min(a, b), Infinity);
      const achado = Number.isFinite(inicio) ? await this.p.metodo.descobrirTrabalho(ws, pe, inicio).catch(() => null) : null;
      if (achado !== null) {
        pe = { ...pe, trabalho_id: achado };
        ctx = (await this.p.metodo.contexto(ws, { trabalho_id: achado, pipeline_id: pe.pipeline_id }).catch(() => null)) ?? ctx;
      }
    }
    const ids = pe.execs.map((e) => e.pane_id).filter((x): x is string => x !== null);
    const emRapido = pe.execs.find((e) => e.etapa_id === "rapido.executar" && e.estado !== "pendente");
    const relatorio = emRapido === undefined ? null : lerRelatorioRapido(await this.p.arquivos.ler(ws, caminhoRelatorioRapido(pe.id)).catch(() => null));
    const piso = this.p.piso === undefined ? [] : await this.p.piso(pe, ctx).catch(() => []);
    const r = avancar(pe, {
      agora_ms: agora, trabalho: ctx.trabalho, sondas: ctx.sondas ?? SONDA_VAZIA, panes: this.p.estadosDosPanes(ids), rapido_relatorio: relatorio, ultima_task_concluida_ms: ctx.ultima_task_concluida_ms, ultima_mudanca_ms: ctx.ultima_mudanca_ms,
      piso, permissao: cfg.permissao, max_terminais: PARAMETROS_MAX(pe.nivel_atual, cfg.max_terminais), timeout_sem_progresso_ms: cfg.timeout_sem_progresso_min * 60_000, fechar_concluidos: cfg.fechar_concluidos,
    });
    let novo = r.pipeline;
    const pedido = this.pedidos.get(pe.id) ?? (await this.p.arquivos.ler(ws, `${PRODUTO.pastaNoProjeto}/maestro/${pe.id}/pedido.md`).catch(() => null))?.trim() ?? null;
    for (const a of r.acoes) novo = await this.executarAcao(novo, a, ctx, pedido, piso);
    if (r.mudou || novo !== r.pipeline || novo.trabalho_id !== pe.trabalho_id) await this.p.persistencia.salvar(novo);
    if (r.mudou) this.p.evento?.({ tipo: "maestro.stage_changed", pipeline_id: pe.id, detalhe: novo.estado });
  }

  private async executarAcao(pe: PipelineEstado, a: Acao, ctx: ContextoDoMetodo, pedido: string | null, piso: readonly ItemDePiso[]): Promise<PipelineEstado> {
    switch (a.tipo) {
      case "despachar": {
        // erro inesperado do despacho (disco cheio, pasta do produto indisponível…) vira falha da etapa COM aviso, nunca exceção silenciosa que o temporizador repete
        const res = await despachar(pe, a, { pedido, trabalho: ctx.trabalho }, { ...this.p.despachante, registrarEco: (pane, t) => this.guardas.registrarEco(pane, t) }).catch(
          (e: unknown): Awaited<ReturnType<typeof despachar>> => ({ ok: false, motivo: "arquivos_indisponiveis", detalhe: `falha ao preparar a etapa: ${e instanceof Error ? e.message.slice(0, 160) : "erro desconhecido"}` }),
        );
        const execs = pe.execs.map((e) => ({ ...e }));
        const e = execs[a.indice] as EtapaExec;
        if (res.ok) {
          e.estado = "executando";
          e.pane_id = res.pane_id;
          e.perfil = res.perfil;
          e.comando = res.comando;
          e.reutilizou_pane = res.reutilizou;
          this.panesDoMaestro.add(res.pane_id);
          this.p.evento?.({ tipo: "maestro.stage_started", pipeline_id: pe.id, detalhe: a.etapa_id });
          return { ...pe, execs };
        }
        e.estado = res.motivo === "pane_nao_abriu" || res.motivo === "avaliador_igual_ao_implementador" ? "falhou" : "aguardando_usuario";
        e.detalhe = res.detalhe;
        e.fim_em = e.estado === "falhou" ? iso(this.p.relogio.agora()) : null;
        await this.notificar(pe, "falhou", a.etapa_id, res.detalhe);
        return { ...pe, execs, estado: e.estado === "falhou" ? "falhou" : "aguardando_usuario", motivo_fim: e.estado === "falhou" ? res.detalhe : null };
      }
      case "consultar":
        await this.p.consultar?.(pe.workspace_id, a.etapa_id, pedido ?? "").catch(() => undefined);
        return pe;
      case "notificar":
        await this.notificar(pe, a.motivo, a.etapa_id, a.detalhe);
        if (a.motivo === "humano" || a.motivo === "raio_alto") this.p.evento?.({ tipo: "maestro.human_required", pipeline_id: pe.id, detalhe: a.etapa_id ?? "" });
        if (a.motivo === "confirmacao") this.p.evento?.({ tipo: "maestro.confirm_required", pipeline_id: pe.id, detalhe: a.etapa_id ?? "" });
        if (a.motivo === "piso") this.p.evento?.({ tipo: "maestro.piso_violated", pipeline_id: pe.id, detalhe: piso.filter((i) => i.estado === "violado").map((i) => i.id).join(",") });
        return pe;
      case "fechar_pane":
        await this.p.fecharPane?.(a.pane_id).catch(() => undefined);
        return pe;
      case "oferecer_retomada":
        return pe;
      case "aprendizado":
        await this.p.aprender?.(pe).catch(() => undefined);
        this.p.evento?.({ tipo: resumoDoPiso(piso) === "violado" ? "maestro.pipeline_failed" : "maestro.pipeline_completed", pipeline_id: pe.id });
        return pe;
      case "voltar_ao_padrao":
        await this.p.restaurarNivel?.(pe).catch(() => undefined);
        return pe;
    }
  }
  private async notificar(pe: PipelineEstado, motivo: MotivoNotificacao, etapa_id: EtapaId | null, detalhe: string): Promise<void> {
    try {
      await this.p.notificar?.({ workspace_id: pe.workspace_id, pipeline_id: pe.id, motivo, etapa_id, detalhe });
    } catch {
      /* notificação nunca derruba o pipeline */
    }
  }

  // ---------------------------------------------------------------- rigidez no meio do pipeline
  /** Vale a partir da PRÓXIMA etapa: a em execução não é tocada; pendentes replanejadas; hooks agendados (salvo `aplicar_hooks_ja`). */
  async mudarNivel(id: string, para: NivelRigidez, o: { via?: ViaMaestro | "ui"; justificativa?: string | null; confirmacao_digitada?: string | null; aplicar_hooks_ja?: boolean } = {}): Promise<ResultadoMudancaDeNivel> {
    return this.serial(id, async () => {
      const pe = await this.p.persistencia.carregar(id);
      if (pe === null) throw new MaestroErro("plano_inexistente", "pipeline não encontrado");
      if (pe.estado === "concluido" || pe.estado === "concluido_parcial" || pe.estado === "falhou" || pe.estado === "cancelado" || pe.estado === "expirado") throw new MaestroErro("estado_invalido", "o pipeline já terminou");
      const cfg = await this.cfg(pe.workspace_id);
      const ctx = await this.p.metodo.contexto(pe.workspace_id, { trabalho_id: pe.trabalho_id, pipeline_id: pe.pipeline_id });
      const ctxTrava: ContextoTrava = { raio_faixa: ctx.trabalho?.raio?.faixa ?? null, branch: ctx.branch, branches_protegidas: cfg.branches_protegidas, producao: cfg.producao };
      const m = avaliarMudancaDeNivel({ via: o.via ?? "ui", de: pe.nivel_atual, para, ctx: ctxTrava, justificativa: o.justificativa ?? null, confirmacao_digitada: o.confirmacao_digitada ?? null });
      if (!m.ok) throw new MaestroErro(m.erro, m.mensagem);
      const agora = this.p.relogio.agora();
      const rep = replanejarExecs(pe.execs, pe.pipeline_id, para, { evidencia: ctx.evidencia, permissao: cfg.permissao }, iso(agora));
      const etapasNovas = planoDeEtapas(pe.pipeline_id, para, { evidencia: ctx.evidencia, permissao: cfg.permissao });
      const novo: PipelineEstado = { ...pe, execs: rep.execs, nivel_atual: para, override_trava: pe.override_trava || m.log.trava === "raio_alto", plano: { ...pe.plano, nivel: para, etapas: etapasNovas }, atualizado_em: iso(agora) };
      let hooks: ResultadoMudancaDeNivel["hooks"] = { escrito: false, agendado: false, arquivo: null, aviso: null };
      const porta = this.p.hooks?.(pe.workspace_id, novo) ?? null;
      if (porta !== null && cfg.escrever_hooks) {
        const emAndamento = novo.execs.some((e) => e.estado === "executando" || e.estado === "despachando");
        const h = await aplicarHooks(porta, para, { legado: ctx.evidencia.legado, escrever_hooks: true, agendar: emAndamento && o.aplicar_hooks_ja !== true && !cfg.hooks_aplicar_ja }).catch(() => null);
        if (h !== null) hooks = { escrito: h.escrito, agendado: h.agendado, arquivo: h.arquivo, aviso: h.aviso };
        this.p.evento?.({ tipo: h?.agendado === true ? "maestro.hooks_scheduled" : "maestro.hooks_written", pipeline_id: id });
      }
      await this.p.persistencia.salvar(novo);
      await this.p.persistencia.registrarRigidezLog?.({ ...m.log, workspace_id: pe.workspace_id, pipeline_id: id, etapa_atual: novo.execs.find((e) => e.estado === "executando")?.etapa_id ?? null, escopo: "pedido", hooks_escritos: hooks.escrito, ts: iso(agora) }).catch(() => undefined);
      this.p.evento?.({ tipo: "maestro.rigidez_changed", pipeline_id: id, detalhe: `${pe.nivel_atual}->${para}` });
      if (m.log.trava !== null) this.p.evento?.({ tipo: "maestro.trava_override", pipeline_id: id, detalhe: m.log.trava });
      await this.avancarSemFila(id);
      return { efetivo: para, hooks, adicionadas: rep.adicionadas, puladas: rep.puladas };
    });
  }

  /**
   * Troca de conta no meio da etapa (Fase 9, `account.switched`): a etapa em andamento passa a apontar para o NOVO Pane (mesma etapa, mesma tentativa,
   * `reutilizou_pane=false`), sem despachar de novo (o Pane novo já recebeu o brief da Fase 9). O decisor externo nunca participa (D-53).
   * Devolve `false` se nenhum pipeline ativo tinha esse Pane numa etapa viva.
   */
  async adotarNovoPane(pane_antigo: string, pane_novo: string): Promise<boolean> {
    const ativos = await this.p.persistencia.listarAtivos(null);
    const alvo = ativos.find((a) => a.execs.some((e) => e.pane_id === pane_antigo));
    if (alvo === undefined) return false;
    return this.serial(alvo.id, async () => {
      const pe = await this.p.persistencia.carregar(alvo.id);
      if (pe === null) return false;
      let mudou = false;
      const execs = pe.execs.map((e) => {
        if (e.pane_id !== pane_antigo || !(e.estado === "executando" || e.estado === "despachando" || e.estado === "aguardando_usuario" || e.estado === "sem_progresso")) return e;
        mudou = true;
        return { ...e, pane_id: pane_novo, reutilizou_pane: false, detalhe: "conta trocada no meio da etapa: o trabalho segue no novo terminal" };
      });
      if (!mudou) return false;
      this.panesDoMaestro.add(pane_novo);
      await this.p.persistencia.salvar({ ...pe, execs, atualizado_em: iso(this.p.relogio.agora()) });
      this.p.evento?.({ tipo: "maestro.account_switched", pipeline_id: pe.id, detalhe: pe.execs.find((e) => e.pane_id === pane_antigo)?.etapa_id ?? "" });
      return true;
    });
  }

  /** Reverte só o que o ADE escreveu no `hooks.json` (ação do usuário). */
  async reverterHooks(workspace_id: string, p: PipelineEstado | null = null): Promise<string[]> {
    const porta = this.p.hooks?.(workspace_id, p) ?? null;
    if (porta === null) return [];
    const r = await reverterHooks(porta);
    if (r.escrito) this.p.evento?.({ tipo: "maestro.hooks_reverted", pipeline_id: p?.id ?? null });
    return r.revertidas;
  }

  async estado(id: string): Promise<PipelineEstado | null> {
    return this.p.persistencia.carregar(id);
  }
  async status(workspace_id: string): Promise<PipelineResumo[]> {
    return (await this.p.persistencia.listarAtivos(workspace_id)).map(resumoDoPipeline);
  }
}

const PARAMETROS_MAX = (nivel: NivelRigidez, cfg: number): number => (nivel === 5 ? Math.max(cfg, 6) : nivel === 1 ? 1 : nivel === 2 ? Math.min(cfg, 2) : cfg);

// reexporta utilitários usados pelos chamadores que só têm o serviço
export { ehDireto, ehMarcadorDoMaestro, ehSlashCommand };

/** Persistência em memória (testes e protótipo; o banco real vem do coordenador). */
export function criarPersistenciaEmMemoria(): PortaPersistencia & { todos(): PipelineEstado[]; recibos(): ReciboMaestro[] } {
  const m = new Map<string, PipelineEstado>();
  const r = new Map<string, ReciboMaestro>();
  const porPipeline = new Map<string, string>();
  const terminal = (e: string): boolean => ["concluido", "concluido_parcial", "falhou", "cancelado", "expirado"].includes(e);
  return {
    async salvar(p) {
      m.set(p.id, structuredClone(p));
    },
    async carregar(id) {
      const x = m.get(id);
      return x === undefined ? null : structuredClone(x);
    },
    async listarAtivos(ws) {
      return [...m.values()].filter((p) => !terminal(p.estado) && (ws === null || p.workspace_id === ws)).map((p) => structuredClone(p));
    },
    async salvarRecibo(rec) {
      r.set(rec.id, structuredClone(rec));
      if (rec.pipeline_id !== null) porPipeline.set(rec.pipeline_id, rec.id);
    },
    async lerRecibo(pipeline_id) {
      const id = porPipeline.get(pipeline_id);
      return id === undefined ? null : structuredClone(r.get(id) ?? null);
    },
    todos: () => [...m.values()].map((p) => structuredClone(p)),
    recibos: () => [...r.values()].map((x) => structuredClone(x)),
  };
}
