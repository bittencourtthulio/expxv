// Ligação do LimitsService no main (T-09.08). Só ESTE módulo toca o disco das CLIs (via adaptadores) e só ele decide
// o foco/observação de arquivos. Nada importa Electron: foco, observação, relógio e fonte oficial entram por injeção.
// Boot na onda 2: `criarLimitesMain(...).iniciar()`. Watchers de arquivo só MARCAM a conta "suja" (debounce 300 ms);
// a leitura obedece a regra de 60 s e ao foco. Fechar a janela principal (foco falso) para o ciclo.
import { mkdirSync } from "node:fs";
import { watch } from "node:fs";
import { join } from "node:path";
import type { EventoLimites } from "../compartilhado/limites";
import { criarAdaptadorClaudeStatusline } from "../nucleo/limites/adaptadores/claude-statusline";
import { criarAdaptadorCodexRollout } from "../nucleo/limites/adaptadores/codex-rollout";
import { criarAdaptadorEstimado, type FonteEstimativa } from "../nucleo/limites/adaptadores/estimado";
import { criarAdaptadorManual } from "../nucleo/limites/adaptadores/manual";
import { chaveConfigPrecisao, criarAdaptadorPrecisaoMaxima, type FonteOficial } from "../nucleo/limites/adaptadores/precisao-maxima";
import type { AdaptadorLimite, ContaLimite } from "../nucleo/limites/adaptadores/adaptador";
import { criarDetectorLimite, type DetectorLimite } from "../nucleo/limites/padroes-limite";
import { agendadorReal, criarLimitsService, type Agendador, type LimitsService } from "../nucleo/limites/servico";
import { CONFIG_CLAUDE_STATUSLINE } from "../nucleo/limites/statusline";
import type { ServicoContas } from "../nucleo/provedores/contas";
import type { Repositorios } from "../nucleo/banco/repos";
import type { Barramento } from "./barramento";

export const DEBOUNCE_WATCHER_MS = 300;
export const CONFIG_LIMIAR_TROCA = "limites.limiar_troca_pct";
export const CONFIG_LIMIAR_ESGOTAMENTO = "limites.limiar_esgotamento_pct";

export interface ObservadorDePasta {
  fechar(): void;
}
export type ObservarPasta = (dir: string, aoArquivo: (nome: string) => void) => ObservadorDePasta;

/** Observação nativa e leve (um único diretório, sem recursão). Falha ao observar = sem observação (o ciclo cobre). */
export const observarPastaNativa: ObservarPasta = (dir, aoArquivo) => {
  try {
    const w = watch(dir, { persistent: false }, (_ev, nome) => {
      if (typeof nome === "string") aoArquivo(nome);
    });
    w.on("error", () => undefined);
    return { fechar: () => w.close() };
  } catch {
    return { fechar: () => undefined };
  }
};

export interface DependenciasLimitesMain {
  repos: Pick<Repositorios, "limiteManual" | "contaRoteamento" | "config">;
  contas: Pick<ServicoContas, "listar" | "configDirAbsoluto"> & Partial<Pick<ServicoContas, "configDirEfetivo">>;
  barramento: Pick<Barramento, "emitir">;
  /** Envia `limites:evento` ao renderer (no-op sem janela). */
  emitirRenderer(evento: EventoLimites): void;
  /** userData do app. */
  pastaDeDados: string;
  /** A janela principal está em foco? */
  foco(): boolean;
  agora?: () => number;
  agendador?: Agendador;
  observarPasta?: ObservarPasta;
  /** P-27: fontes oficiais por provedor (o main as implementa; sem entrada = modo indisponível para o provedor). */
  fonteOficial?: Readonly<Record<string, FonteOficial>>;
  /** Fase 10: consumo observado (tokens) para a fonte `estimado`. Ausente = sem estimativa. */
  consumoObservado?: FonteEstimativa["consumo"];
  /** Fase 10 (T-10.22): fonte completa da estimativa (tetos, último reset medido e consumo por ciclo, do agregado por conta). Vence `consumoObservado`. Ausente = como antes. */
  fonteEstimativa?: FonteEstimativa;
  /** Fontes extras ligadas pelo main (ex.: crédito do OpenRouter, Fase 9 T-09.26). */
  adaptadoresExtras?: readonly AdaptadorLimite[];
  aviso?(mensagem: string): void;
}

export interface LimitesMain {
  servico: LimitsService;
  /** Manipuladores do limite manual para o IPC. */
  manual: {
    definir(contaId: string, janela: "five_hour" | "weekly" | "monthly", usadoPct: number, reiniciaEm: string | null): unknown;
    limpar(contaId: string, janela?: "five_hour" | "weekly" | "monthly"): unknown;
  };
  iniciar(): void;
  encerrar(): void;
  /** Foco da janela mudou (borda de subida lê quem passou de 60 s). */
  aoFocoMudar(emFoco: boolean): void;
  /** Conta criada/removida/habilitada: reidrata. */
  aoContasMudarem(): void;
  /** Um Pane da conta abriu ou fechou: o arquivo dela pode ter mudado. */
  aoPaneMudar(contaId: string): void;
  /** Saída do PTY de um Pane (mesmo fluxo que o serviço de terminais já lê). */
  aoSaidaDoPane(pane: { pane_id: string; conta_id: string | null; provedor: string }, chunk: string): void;
  /** O usuário enviou texto ao Pane (ecos deixam de contar como limite). */
  aoEnvioAoPane(paneId: string, texto: string): void;
  liberarPane(paneId: string): void;
}

const limiarValido = (v: unknown, min: number, max: number, padrao: number): number => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : padrao);

export function criarLimitesMain(d: DependenciasLimitesMain): LimitesMain {
  const agora = d.agora ?? (() => Date.now());
  const ag = d.agendador ?? agendadorReal;
  const { repos } = d;

  const adaptadores: AdaptadorLimite[] = [
    criarAdaptadorClaudeStatusline({ pastaDeDados: d.pastaDeDados, habilitado: () => repos.config.obter<boolean>(CONFIG_CLAUDE_STATUSLINE) !== false }),
    criarAdaptadorCodexRollout(),
    criarAdaptadorManual({ listar: (id) => repos.limiteManual.listar(id) }),
    criarAdaptadorEstimado(
      d.fonteEstimativa ?? {
        tetos: (id) => {
          const r = repos.contaRoteamento.obter(id);
          return { cinco_horas: r?.teto_tokens_5h ?? null, semana: r?.teto_tokens_semana ?? null };
        },
        consumo: (id, ms) => d.consumoObservado?.(id, ms) ?? null,
      },
    ),
  ];
  adaptadores.push(...(d.adaptadoresExtras ?? []));
  // P-27: só entram provedores com fonte oficial injetada; o portão do consentimento está no próprio adaptador
  for (const [provedor, fonte] of Object.entries(d.fonteOficial ?? {})) {
    adaptadores.push(criarAdaptadorPrecisaoMaxima({ provedor, config: () => repos.config.obter(chaveConfigPrecisao(provedor)), fonte }));
  }

  const servico = criarLimitsService({
    contas: (): ContaLimite[] =>
      d.contas.listar().map((c) => ({ id: c.id, provedor: c.provedor, rotulo: c.rotulo, config_dir: d.contas.configDirEfetivo?.(c) ?? d.contas.configDirAbsoluto(c), habilitada: c.habilitada })),
    adaptadores,
    agora,
    agendador: ag,
    foco: d.foco,
    limiares: () => ({
      troca: limiarValido(repos.config.obter(CONFIG_LIMIAR_TROCA), 50, 99, 85),
      esgotamento: limiarValido(repos.config.obter(CONFIG_LIMIAR_ESGOTAMENTO), 51, 100, 100),
    }),
    marcarCooldown: (contaId, ate) => {
      try {
        repos.contaRoteamento.definirCooldown(contaId, ate);
      } catch {
        /* conta removida entre a frase e a gravação */
      }
    },
    ...(d.aviso === undefined ? {} : { aviso: d.aviso }),
    emitir(evento) {
      d.emitirRenderer(evento);
      // eventos de domínio usados pelo roteamento (troca automática) e pelos alertas
      if (evento.tipo === "atualizado") d.barramento.emitir("limits.updated", { contas: evento.contas });
      else if (evento.tipo === "consumo_alto") d.barramento.emitir("limit.high", { conta_id: evento.conta_id, janela: evento.janela, used_pct: evento.used_pct });
      else if (evento.tipo === "limite_atingido") d.barramento.emitir("limit.reached", { conta_id: evento.conta_id, janela: evento.janela, pane_id: evento.pane_id, fonte: evento.fonte });
    },
  });

  // ---- watcher da statusline do Claude: só marca a conta suja (debounce 300 ms)
  const pendentesWatcher = new Map<string, unknown>();
  let observador: ObservadorDePasta | null = null;
  const aoArquivoDaStatusline = (nome: string): void => {
    const m = /^([A-Za-z0-9_-]{1,80})\.json$/.exec(nome);
    if (m === null) return; // ignora .tmp e o que não é arquivo de conta
    const id = m[1] as string;
    if (pendentesWatcher.has(id)) return;
    pendentesWatcher.set(id, ag.setTimeout(() => {
      pendentesWatcher.delete(id);
      servico.marcarSuja(id);
    }, DEBOUNCE_WATCHER_MS));
  };

  const detectores = new Map<string, { detector: DetectorLimite; conta_id: string }>();

  return {
    servico,
    manual: {
      definir: (contaId, janela, usadoPct, reiniciaEm) => repos.limiteManual.definir(contaId, janela, usadoPct, reiniciaEm),
      limpar: (contaId, janela) => (janela === undefined ? repos.limiteManual.limpar(contaId) : repos.limiteManual.limpar(contaId, janela)),
    },
    iniciar() {
      try {
        repos.limiteManual.limparVencidos(new Date(agora()).toISOString());
      } catch {
        /* sem tabela/banco: o adaptador também filtra vencidos */
      }
      try {
        const dir = join(d.pastaDeDados, "limites", "claude");
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        observador = (d.observarPasta ?? observarPastaNativa)(dir, aoArquivoDaStatusline);
      } catch (e) {
        d.aviso?.(`observação da statusline indisponível: ${e instanceof Error ? e.message : "erro"}`);
      }
      servico.iniciar();
    },
    encerrar() {
      servico.parar();
      for (const t of pendentesWatcher.values()) ag.clearTimeout(t);
      pendentesWatcher.clear();
      observador?.fechar();
      observador = null;
      detectores.clear();
    },
    aoFocoMudar: (emFoco) => servico.aoFocoMudar(emFoco),
    aoContasMudarem: () => servico.contasMudaram(),
    aoPaneMudar: (contaId) => servico.marcarSuja(contaId),
    aoSaidaDoPane(pane, chunk) {
      if (pane.conta_id === null) return;
      let e = detectores.get(pane.pane_id);
      if (e === undefined) {
        const detector = criarDetectorLimite(pane.provedor);
        if (detector === null) return;
        e = { detector, conta_id: pane.conta_id };
        detectores.set(pane.pane_id, e);
      }
      const r = e.detector.processar(chunk, agora());
      if (r !== null) servico.registrarLimiteDoPty({ conta_id: e.conta_id, pane_id: pane.pane_id, reinicia_em: r.reinicia_em });
    },
    aoEnvioAoPane(paneId, texto) {
      detectores.get(paneId)?.detector.registrarEnvio(texto);
    },
    liberarPane: (paneId) => void detectores.delete(paneId),
  };
}
