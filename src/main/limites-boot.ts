// Ligação do motor de limites ao boot do main (T-09.08/T-09.09, onda 2). Nada aqui roda na onda 1.
// Junta: `criarLimitesMain` (serviço + adaptadores), `registrarIpcLimites` (canais `limites:*`), a cópia idempotente do
// `statusline-claude.mjs` para userData, o complemento de lançamento do Claude (`statuslineDoPane`) e a assinatura da
// saída dos PTYs (detecção de "limite atingido"). Electron entra por injeção (foco, emissão, sessões), então é testável.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EventoTerminal } from "../compartilhado/terminais";
import { CONFIG_CLAUDE_STATUSLINE, statuslineDoPane } from "../nucleo/limites/statusline";
import type { ServicosDominio } from "./servicos";
import type { Barramento } from "./barramento";
import { registrarIpcLimites, type HistoricoLimitesIpc } from "./ipc/limites";
import type { RegistroIpc } from "./ipc/registro";
import { criarLimitesMain, type DependenciasLimitesMain, type LimitesMain } from "./limites";
import { CONFIG_META_SEMANAL, criarHistoricoLimites, type HistoricoLimitesMain } from "./limites-historico";

/** Nome do script de statusline dentro de `<userData>/limites/bin/`. */
export const NOME_SCRIPT_STATUSLINE = "statusline-claude.mjs";

/**
 * Copia o script (idempotente: só reescreve se o conteúdo mudou) para fora do asar, em `<userData>/limites/bin/`.
 * Devolve o caminho absoluto de destino ou `null` se a origem não existe/não pôde ser copiada.
 */
export function copiarStatusline(origem: string, pastaDeDados: string): string | null {
  try {
    if (!existsSync(origem)) return null;
    const dir = join(pastaDeDados, "limites", "bin");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const destino = join(dir, NOME_SCRIPT_STATUSLINE);
    const igual = existsSync(destino) && readFileSync(destino).equals(readFileSync(origem));
    if (!igual) {
      copyFileSync(origem, destino);
      try {
        chmodSync(destino, 0o600);
      } catch {
        /* Windows */
      }
    }
    return destino;
  } catch {
    return null;
  }
}

/** Onde mora o script de origem: `dist/` (copiado por scripts/copiar-ativos.mjs; no pacote fica fora do asar) ou `src/` em dev. */
export function origemDaStatusline(o: { dirMain: string; empacotado: boolean; existe?: (c: string) => boolean }): string {
  const existe = o.existe ?? existsSync;
  const rel = ["nucleo", "limites", "scripts", NOME_SCRIPT_STATUSLINE];
  const dist = join(o.dirMain, "..", ...rel);
  const escolhido = o.empacotado || existe(dist) ? dist : join(o.dirMain, "..", "..", "src", ...rel);
  return o.empacotado ? escolhido.replace(/app\.asar(?=[\\/])/, "app.asar.unpacked") : escolhido;
}

export interface SessoesAssinaveis {
  assinar(fn: (evento: EventoTerminal) => void): () => void;
}

export interface EntradaLigarLimites {
  registro: RegistroIpc;
  dominio: Pick<ServicosDominio, "repos" | "contas" | "panes">;
  /** Consulta o pane pela sessão (SQL) — mesma consulta que a orquestração usa. */
  paneDaSessao(sessaoId: string): string | null;
  barramento: Pick<Barramento, "emitir">;
  emitirRenderer: DependenciasLimitesMain["emitirRenderer"];
  pastaDeDados: string;
  foco(): boolean;
  sessoes(): Promise<SessoesAssinaveis>;
  /** `statusline-claude.mjs` de origem (dist/ ou src/). */
  origemStatusline: string;
  /** Executável do Node para o `statusLine.command` (padrão `node`). */
  node?: string;
  historico?: HistoricoLimitesIpc;
  avisar?(mensagem: string): void;
  /** Passagem direta ao `criarLimitesMain` (testes: relógio, agendador, observação). */
  extras?: Partial<Pick<DependenciasLimitesMain, "agora" | "agendador" | "observarPasta" | "fonteOficial" | "consumoObservado" | "fonteEstimativa" | "adaptadoresExtras">>;
}

export interface LimitesLigados {
  limites: LimitesMain;
  /** Caminho do script copiado (null = sem statusline; o Pane abre normalmente). */
  script: string | null;
  encerrar(): void;
}

export async function ligarLimites(e: EntradaLigarLimites): Promise<LimitesLigados> {
  const { repos, contas, panes } = e.dominio;
  const script = copiarStatusline(e.origemStatusline, e.pastaDeDados);
  if (script === null) e.avisar?.("statusline de limites indisponível (script não copiado); o Claude abre sem ela.");

  // histórico/previsão/eficiência/alertas (T-09.09): nasce depois do serviço; cada `atualizado` grava as amostras que mudaram (sem timer próprio)
  let historicoLigado: HistoricoLimitesMain | null = null;
  const limites = criarLimitesMain({
    repos,
    contas,
    barramento: e.barramento,
    emitirRenderer: (evento) => {
      e.emitirRenderer(evento);
      if (evento.tipo === "atualizado") historicoLigado?.registrar();
    },
    pastaDeDados: e.pastaDeDados,
    foco: e.foco,
    ...(e.avisar === undefined ? {} : { aviso: e.avisar }),
    ...(e.extras ?? {}),
  });
  historicoLigado = criarHistoricoLimites({
    repo: repos.limiteAmostra,
    snapshot: () => limites.servico.snapshot(),
    rotulos: () => Object.fromEntries(contas.listar().map((c) => [c.id, c.rotulo])),
    metaSemanalPct: () => {
      const v = repos.config.obter<number>(CONFIG_META_SEMANAL);
      return typeof v === "number" && v >= 1 && v <= 100 ? v : null;
    },
    ...(e.extras?.agora === undefined ? {} : { agora: e.extras.agora }),
    ...(e.avisar === undefined ? {} : { aviso: e.avisar }),
  });
  registrarIpcLimites({ registro: e.registro, servico: limites.servico, manual: limites.manual, historico: e.historico ?? historicoLigado });

  // statusline por Pane: só Claude com conta; opt-out `limites.claude_statusline = false`; nunca impede o Pane de abrir
  panes.definirComplemento(async ({ pane, ferramenta }) => {
    if (script === null || ferramenta.id !== "claude" || pane.conta_id === null) return null;
    if (repos.config.obter<boolean>(CONFIG_CLAUDE_STATUSLINE) === false) return null;
    return statuslineDoPane({ script, ...(e.node === undefined ? {} : { node: e.node }), pastaDeDados: e.pastaDeDados, contaId: pane.conta_id });
  });

  limites.iniciar();

  // saída do PTY -> detector de limite (por Pane); encerramento do Pane libera o detector e marca a conta suja
  const panesVistos = new Map<string, string>();
  const paneDe = (sessaoId: string): string | null => {
    const c = panesVistos.get(sessaoId);
    if (c !== undefined) return c;
    const achado = e.paneDaSessao(sessaoId);
    if (achado !== null) panesVistos.set(sessaoId, achado);
    return achado;
  };
  let desassinar: (() => void) | null = null;
  try {
    const g = await e.sessoes();
    desassinar = g.assinar((ev) => {
      try {
        if (ev.tipo !== "saida" && ev.tipo !== "encerramento") return;
        const paneId = paneDe(ev.sessao_id);
        if (paneId === null) return;
        const pane = repos.pane.obter(paneId);
        if (pane === undefined) return;
        if (ev.tipo === "encerramento") {
          limites.liberarPane(paneId);
          panesVistos.delete(ev.sessao_id);
          if (pane.conta_id !== null) limites.aoPaneMudar(pane.conta_id);
          return;
        }
        limites.aoSaidaDoPane({ pane_id: paneId, conta_id: pane.conta_id, provedor: pane.cli ?? "" }, ev.dados);
      } catch {
        /* a detecção nunca derruba o fluxo de saída do terminal */
      }
    });
  } catch (erro) {
    e.avisar?.(`detecção de limite pela saída do PTY indisponível: ${erro instanceof Error ? erro.message : "erro"}`);
  }

  return {
    limites,
    script,
    encerrar() {
      desassinar?.();
      desassinar = null;
      panes.definirComplemento(null);
      limites.encerrar();
    },
  };
}
