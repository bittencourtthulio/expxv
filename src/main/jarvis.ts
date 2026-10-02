// Ligação do Jarvis e do controle remoto no main (Fase 13). SOB DEMANDA: nada no boot, nenhum socket, nenhum timer até o primeiro uso de um canal `jarvis:*`/`remoto:*`;
// o servidor local só escuta depois de `remoto:ligar` com consentimento e nunca persiste "ligado". Os núcleos entram por `import()` dinâmico. As portas reusam os adaptadores do
// Telegram (Maestro/orquestrador por regras, portões de intake, consultas): a MESMA política de segurança, sem duplicar. Credenciais (identidade do servidor) só no cofre.
import { networkInterfaces } from "node:os";
import { CONFIG_JARVIS_PADRAO, CONFIG_REMOTO_PADRAO, ACOES_JARVIS, RISCO_DA_ACAO, type AcaoTipada, type ApiJarvis, type ApiRemoto, type ConfigJarvis, type ConfigRemoto, type EstadoJarvis } from "../compartilhado/jarvis";
import type { PipelineResumo } from "../compartilhado/maestro";
import type { Banco } from "../nucleo/banco";
import type { RepoConfig } from "../nucleo/banco/repos/config";
import type { PortaSegredos } from "../nucleo/remoto/identidade";
import type { ServicoPortoes } from "../nucleo/orquestracao/portoes";
import type { ServicoJarvis } from "../nucleo/jarvis/servico";
import type { ServicoRemoto } from "../nucleo/remoto/servico";
import { criarConsultaTelegram, criarGatesTelegram } from "./alertas-consulta";
import { criarOrquestradorTelegram, criarRigidezTelegram, type MaestroParaTelegram } from "./alertas-orquestrador";

export interface PreferenciasLigacaoJarvis {
  obter(chave: string): unknown;
  definir(chave: string, valor: unknown): Promise<void>;
}
export interface DepsLigacaoJarvis {
  banco: Banco;
  config: Pick<RepoConfig, "obter">;
  portoes: ServicoPortoes;
  prefs: PreferenciasLigacaoJarvis;
  emitirRenderer(canal: "jarvis:evento" | "remoto:evento" | "jarvis:abrir_pane", payload: unknown): void;
  workspaceAtualId(): string | null;
  /** workspaces visíveis ao assistente (atual + recentes). */
  workspaceIds(): string[];
  nomeWorkspace(id: string): string | null;
  workspaceAutomatico(id: string): boolean;
  maestro(): MaestroParaTelegram | null;
  listarPipelines(workspace_id: string): Promise<PipelineResumo[]>;
  cotaGeralPct(): number | null;
  criticosNaoLidos(): number;
  consumo?(): Promise<Array<{ conta: string; provedor: string; pct: number | null }>>;
  segredos: PortaSegredos;
  scrub?: (t: string) => string;
  interfaces?: () => Array<{ nome: string; ip: string }>;
  aviso?: (m: string) => void;
}

export interface LigacaoJarvis {
  jarvis: ApiJarvis;
  remoto: ApiRemoto;
  telaBloqueada(b: boolean): void;
  /** Fase 22: o serviço remoto da Fase 13 (carrega o núcleo sob demanda); o relay o usa por uma porta estreita, sem LAN. */
  remotoNucleo(): Promise<ServicoRemoto>;
  /** o servidor está escutando? (bandeja/rodapé). */
  remotoLigado(): boolean;
  /** kill-switch da bandeja: fecha o servidor, derruba canais e cancela pendências (os pareamentos ficam). */
  desligarRemoto(): Promise<void>;
  /** pânico: igual ao kill-switch e ainda revoga TODOS os dispositivos. */
  panicoRemoto(): Promise<void>;
  encerrar(): Promise<void>;
}

const ENTRE = (v: unknown, a: number, b: number, padrao: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(Math.round(v), a), b) : padrao);

export function lerConfigJarvis(bruto: unknown): ConfigJarvis {
  const o = typeof bruto === "object" && bruto !== null ? (bruto as Record<string, unknown>) : {};
  return {
    ligado: o["ligado"] === true,
    llm_ligado: o["llm_ligado"] === true,
    llm_consentimento: o["llm_consentimento"] === true,
    confirmacao_ttl_s: ENTRE(o["confirmacao_ttl_s"], 10, 120, CONFIG_JARVIS_PADRAO.confirmacao_ttl_s),
  };
}
export function lerConfigRemoto(bruto: unknown): ConfigRemoto {
  const o = typeof bruto === "object" && bruto !== null ? (bruto as Record<string, unknown>) : {};
  return {
    interface: typeof o["interface"] === "string" && /^(auto|[0-9a-fA-F:.]{3,45})$/.test(o["interface"]) ? o["interface"] : "auto",
    porta: o["porta"] === 0 ? 0 : ENTRE(o["porta"], 1024, 65535, 0),
    ocioso_min: ENTRE(o["ocioso_min"], 1, 1440, CONFIG_REMOTO_PADRAO.ocioso_min),
    validade_dispositivo_dias: ENTRE(o["validade_dispositivo_dias"], 1, 365, CONFIG_REMOTO_PADRAO.validade_dispositivo_dias),
    hosts_extras: Array.isArray(o["hosts_extras"]) ? o["hosts_extras"].filter((h): h is string => typeof h === "string" && /^[A-Za-z0-9.-]{1,120}(?::\d{1,5})?$/.test(h)).slice(0, 5) : [],
    permitir_cgnat: o["permitir_cgnat"] === true,
  };
}

function interfacesDoSistema(): Array<{ nome: string; ip: string }> {
  const saida: Array<{ nome: string; ip: string }> = [];
  for (const [nome, lista] of Object.entries(networkInterfaces())) for (const i of lista ?? []) if (i.family === "IPv4" && !i.internal) saida.push({ nome, ip: i.address });
  return saida;
}

interface Nucleo {
  jarvis: ServicoJarvis;
  remoto: ServicoRemoto;
  auditoria: import("../nucleo/jarvis/auditoria").AuditoriaJarvis;
}

export function ligarJarvis(d: DepsLigacaoJarvis): LigacaoJarvis {
  let nucleo: Promise<Nucleo> | null = null;
  let pronto: Nucleo | null = null;
  let bloqueada = false;
  let temporizador: ReturnType<typeof setInterval> | null = null;
  const cfgJ = (): ConfigJarvis => lerConfigJarvis(d.prefs.obter("jarvis_config"));
  const cfgR = (): ConfigRemoto => lerConfigRemoto(d.prefs.obter("remoto_config"));

  async function montar(): Promise<Nucleo> {
    const [{ criarServicoJarvis }, { criarAuditoriaJarvis, criarIdempotencia }, { criarArmazemDispositivos, carregarIdentidade, criarServicoRemoto }] = await Promise.all([
      import("../nucleo/jarvis/servico"),
      import("../nucleo/jarvis/auditoria"),
      import("../nucleo/remoto"),
    ]);
    const relogio = { agora: () => Date.now() };
    const auditoria = criarAuditoriaJarvis({ banco: d.banco, relogio, ...(d.scrub === undefined ? {} : { scrub: d.scrub }) });
    auditoria.limparAntigas();
    const consulta = criarConsultaTelegram({
      banco: d.banco,
      nomeWorkspace: d.nomeWorkspace,
      dadosDaTask: () => ({ tempo_trabalho_ms: null, tokens: null, story_points: null, atraso_ms: null, limite_ms: null }),
      cotaGeralPct: d.cotaGeralPct,
      criticosNaoLidos: d.criticosNaoLidos,
      ...(d.consumo === undefined ? {} : { consumo: d.consumo }),
    });
    const gates = criarGatesTelegram({ banco: d.banco, config: d.config, portoes: d.portoes });
    const orq = criarOrquestradorTelegram({ maestro: d.maestro, nomeWorkspace: d.nomeWorkspace, workspaceAutomatico: d.workspaceAutomatico });
    const rigidez = criarRigidezTelegram({ maestro: d.maestro, maximoRemoto: () => 3 });
    const emitirJ = (tipo: "estado" | "confirmacao_pendente" | "resolvida"): void => d.emitirRenderer("jarvis:evento", { tipo });
    const jarvis = criarServicoJarvis({
      relogio,
      auditoria,
      idempotencia: criarIdempotencia({ banco: d.banco, relogio }),
      config: cfgJ,
      workspaceAtual: d.workspaceAtualId,
      workspaces: d.workspaceIds,
      consulta: () => consulta,
      gates: () => gates,
      rigidez: () => rigidez,
      orquestrador: () => ({ ...orq, proporPlano: (p) => orq.proporPlano({ ...p, origem: "telegram" }) }),
      paineis: () => ({
        // sem cauda de terminal: só rótulo e estado (o resumo nunca expõe saída bruta)
        listar: async () => {
          const ids = d.workspaceIds();
          if (ids.length === 0) return [];
          return d.banco
            .consultar<{ id: string; display_id: number; papel: string; cli: string | null; tipo: string; estado: string; atualizado_em: string }>(
              `SELECT id, display_id, papel, cli, tipo, estado, atualizado_em FROM pane WHERE workspace_id IN (${ids.map(() => "?").join(",")}) AND estado <> 'encerrado' ORDER BY atualizado_em DESC LIMIT 60`,
              ids,
            )
            .map((p) => ({ pane_id: p.id, display_id: String(p.display_id), label: `${p.papel} · ${p.cli ?? p.tipo}`, estado: p.estado, ultima_mensagem: null, pergunta_pendente: null, atualizado_em: p.atualizado_em }));
        },
      }),
      controle: () => ({
        async alvos() {
          const lotes = await Promise.all(d.workspaceIds().map((ws) => d.listarPipelines(ws).catch(() => [] as PipelineResumo[])));
          return lotes.flat().filter((p) => !["concluido", "cancelado", "falhou"].includes(p.estado)).slice(0, 30).map((p) => ({ id: p.id, rotulo: `${p.pipeline_id} · ${p.etapa_atual ?? p.estado}`, estado: p.estado }));
        },
        async pausar(id) {
          const m = d.maestro();
          if (m === null) return false;
          await m.pausar(id);
          return true;
        },
        parar: (id) => orq.pararPlano(id),
      }),
      navegacao: () => ({
        async abrirPane(ref) {
          const ws = d.workspaceAtualId();
          if (ws === null) return { ok: false };
          const linha = /^\d{1,6}$/.test(ref)
            ? d.banco.consultarUm<{ display_id: number }>("SELECT display_id FROM pane WHERE workspace_id = ? AND display_id = ? AND estado <> 'encerrado'", [ws, Number(ref)])
            : ref.toLowerCase() === "piloto"
              ? d.banco.consultarUm<{ display_id: number }>("SELECT display_id FROM pane WHERE workspace_id = ? AND eh_piloto = 1 AND estado <> 'encerrado' LIMIT 1", [ws])
              : undefined;
          if (linha === undefined) return { ok: false };
          d.emitirRenderer("jarvis:abrir_pane", { ref: String(linha.display_id) });
          return { ok: true };
        },
      }),
      telaBloqueada: () => bloqueada,
      ...(d.scrub === undefined ? {} : { scrub: d.scrub }),
      ttlConfirmacaoMs: (ator) => (ator === "remoto" ? 30_000 : cfgJ().confirmacao_ttl_s * 1000),
      aoMudar: emitirJ,
    });
    const remoto = criarServicoRemoto({
      relogio,
      jarvis,
      dispositivos: criarArmazemDispositivos({ banco: d.banco, relogio, validade_dias: () => cfgR().validade_dispositivo_dias }),
      auditoria,
      identidade: () => carregarIdentidade(d.segredos),
      config: cfgR,
      gravarConfig: (patch) => void d.prefs.definir("remoto_config", { ...cfgR(), ...patch }),
      interfaces: d.interfaces ?? interfacesDoSistema,
      telaBloqueada: () => bloqueada,
      aoMudar: (tipo) => d.emitirRenderer("remoto:evento", { tipo }),
    });
    // varredura barata (expira confirmações e sessões ociosas); só existe depois do primeiro uso e morre no encerramento
    temporizador = setInterval(() => void Promise.all([jarvis.varrer(), remoto.varrer()]).catch(() => undefined), 10_000);
    temporizador.unref?.();
    return { jarvis, remoto, auditoria };
  }
  const obter = (): Promise<Nucleo> => (nucleo ??= montar().then((n) => (pronto = n), (e: unknown) => {
    nucleo = null;
    throw e;
  }));

  const entrada = { ator: "jarvis" as const, permissao: null, dispositivo: null };
  async function estadoJarvis(): Promise<EstadoJarvis> {
    const n = await obter();
    return { config: cfgJ(), confirmacoes: n.jarvis.confirmacoes().filter((c) => c.ator === "jarvis"), turnos: n.jarvis.turnos(), acoes: ACOES_JARVIS.map((a) => ({ acao: a, risco: RISCO_DA_ACAO[a] })) };
  }

  const jarvis: ApiJarvis = {
    estado: estadoJarvis,
    async configGravar(patch) {
      const atual = cfgJ();
      const prox = lerConfigJarvis({ ...atual, ...patch });
      // a LLM só liga com consentimento explícito (o texto REDIGIDO sai da máquina); desligar o consentimento desliga a LLM
      if (!prox.llm_consentimento) prox.llm_ligado = false;
      await d.prefs.definir("jarvis_config", prox);
      d.emitirRenderer("jarvis:evento", { tipo: "estado" });
      return estadoJarvis();
    },
    async enviar(texto) {
      const n = await obter();
      return n.jarvis.processarTexto({ ...entrada, origem: "fala_do_usuario", texto });
    },
    async acao(acao: AcaoTipada) {
      const n = await obter();
      return n.jarvis.executarAcao({ ...entrada, origem: "ui", acao });
    },
    async confirmar(id, aprovado) {
      const n = await obter();
      return n.jarvis.resolverConfirmacao(id, aprovado, "ui");
    },
    async historico(depois) {
      const n = await obter();
      return n.auditoria.listar("jarvis", depois, 50);
    },
    async limparConversa() {
      const n = await obter();
      n.jarvis.limparTurnos();
      return estadoJarvis();
    },
    assinar: () => () => undefined, // o renderer assina pelo preload; estas pontas só existem para o contrato
    assinarNavegacao: () => () => undefined,
  };
  const R = async <T>(f: (r: ServicoRemoto) => T | Promise<T>): Promise<T> => f((await obter()).remoto);
  const remoto: ApiRemoto = {
    estado: () => R((r) => r.estado()),
    ligar: (p) => R((r) => r.ligar(p)),
    desligar: () => R((r) => r.desligar("usuario")),
    configGravar: (patch) => R((r) => r.configGravar(patch)),
    parearIniciar: (p) => R((r) => r.parearIniciar(p)),
    parearCancelar: () => R((r) => r.parearCancelar()),
    parearConfirmarSas: (p) => R((r) => r.parearConfirmarSas(p)),
    revogar: (id) => R((r) => r.revogar(id)),
    permissaoDefinir: (p) => R((r) => r.permissaoDefinir(p)),
    aprovarPedido: (id, ok) => R((r) => r.aprovarPedido(id, ok)),
    panico: () => R((r) => r.panico()),
    auditoria: (depois) => R((r) => r.auditoria(depois)),
    assinar: () => () => undefined,
  };

  return {
    jarvis,
    remoto,
    telaBloqueada: (b) => void (bloqueada = b),
    remotoNucleo: async () => (await obter()).remoto,
    remotoLigado: () => pronto?.remoto.estado().transporte.ligado === true,
    async desligarRemoto() {
      if (nucleo === null) return;
      await (await nucleo).remoto.desligar("bandeja");
    },
    async panicoRemoto() {
      if (nucleo === null) return; // nada foi montado: nada escuta
      await (await nucleo).remoto.panico();
    },
    async encerrar() {
      if (temporizador !== null) clearInterval(temporizador);
      temporizador = null;
      if (nucleo === null) return;
      const n = await nucleo.catch(() => null);
      nucleo = null;
      pronto = null;
      await n?.remoto.desligar("encerramento"); // o servidor nunca sobrevive ao app
      await n?.jarvis.anularTodas();
    },
  };
}
