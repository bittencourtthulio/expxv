// Bichinho do workspace no main (D-466): monta o serviço do núcleo com as portas reais (banco, disco confinado, mapa de código, RAG) e liga os
// eventos de domínio que o app JÁ produz no barramento (Pane, Missão, Executar, cota, alertas). Nasce sob demanda (nada no boot); sem polling;
// o evento ao renderer é coalescido por workspace (a subida de estágio nunca se perde na junção).
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EventoBichinhoMudou } from "../compartilhado/bichinho";
import type { Banco } from "../nucleo/banco/banco";
import { criarRepoBichinho } from "../nucleo/bichinho/repo";
import { criarServicoBichinho, type ServicoBichinho } from "../nucleo/bichinho/servico";
import type { EstadoPaneEvento } from "../nucleo/bichinho/humor";
import { nomeSeguro, type LeitorProjeto } from "../nucleo/bichinho/sinais";
import { criarLeitorTokensGrok, portasDeDisco, type LeitorTokensGrok } from "../nucleo/bichinho/tokens-grok";
import type { Barramento } from "./barramento";

const TAMANHO_MAX_LEITURA = 128 * 1024;
const MAX_ITENS_PASTA = 400;
const ESTADOS_PANE: readonly string[] = ["iniciando", "pronto", "trabalhando", "aguardando", "bloqueado", "encerrado"];

/** Leitor confinado à raiz do workspace: só caminhos relativos sem `..`, só arquivos regulares (nunca symlink), até 128 KB, nunca nomes de ambiente/segredo. */
export function leitorDeDisco(raiz: string): LeitorProjeto {
  const resolver = (rel: string): string | null => {
    if (rel.startsWith("/") || rel.includes("\\") || rel.split("/").some((p) => p === ".." || (p !== "" && !nomeSeguro(p)))) return null;
    return rel === "" ? raiz : join(raiz, rel);
  };
  return {
    ler(rel) {
      const c = resolver(rel);
      if (c === null || rel === "") return null;
      try {
        const st = lstatSync(c);
        return st.isFile() && st.size <= TAMANHO_MAX_LEITURA ? readFileSync(c, "utf8") : null;
      } catch {
        return null;
      }
    },
    existe(rel) {
      const c = resolver(rel);
      if (c === null) return false;
      try {
        return !lstatSync(c).isSymbolicLink();
      } catch {
        return false;
      }
    },
    listar(rel) {
      const c = resolver(rel);
      if (c === null) return [];
      try {
        return readdirSync(c, { withFileTypes: true }).filter((e) => !e.isSymbolicLink() && nomeSeguro(e.name)).slice(0, MAX_ITENS_PASTA).map((e) => e.name);
      } catch {
        return [];
      }
    },
  };
}

export interface DepsBichinhoMain {
  banco: Banco;
  barramento: Barramento;
  /** envia ao renderer (já com a janela verificada). */
  enviar: (evento: EventoBichinhoMudou) => void;
  /** linguagens do mapa de código se já indexado; `null` caso contrário (nunca dispara análise). */
  linguagensDoMapa?: (workspaceId: string) => Promise<ReadonlyArray<{ linguagem: string; arquivos: number; loc: number }> | null>;
  /** chunks do RAG se o conhecimento está ativo no workspace; `null` caso contrário. */
  chunksDoRag?: (workspaceId: string) => Promise<number | null>;
  /** preferências lidas na hora de usar: "Sem repetir espécie" (padrão ligada) e a meta de tarefas do ovo (2 a 6, padrão 4). */
  prefs?: () => { semRepetir?: boolean | undefined; metaOvo?: number | undefined };
  atrasoEmitirMs?: number;
  /** leitor de contagens do Grok (injetável nos testes); padrão: `<GROK_HOME ou ~/.grok>/sessions/**\/usage.json`, só dois números por arquivo. */
  leitorGrok?: LeitorTokensGrok;
  agendar?: (fn: () => void, ms: number) => { cancelar(): void };
}

/** Pulso de atividade do PTY (D-500): o main só informa tamanhos, nunca o texto. */
export interface PulsoPty {
  aoSaida(i: { sessao_id: string; workspace_id: string | null; ferramenta_id: string; dados: string }): void;
  aoEntrada(i: { workspace_id: string | null }): void;
  aoSessaoEncerrada(i: { sessao_id: string; workspace_id: string | null }): void;
}

/** Quanto depois da última saída do Grok o `usage.json` é relido (a CLI grava ao fim da chamada), e o intervalo entre leituras durante o fluxo. */
export const GROK_LER_APOS_MS = 3_000;

export function contarLinhas(texto: string): number {
  let n = 0;
  for (let i = texto.indexOf("\n"); i !== -1; i = texto.indexOf("\n", i + 1)) n++;
  return n;
}

export interface BichinhoMain {
  servico: ServicoBichinho;
  pulso: PulsoPty;
  encerrar(): void;
}

export function criarBichinhoMain(d: DepsBichinhoMain): BichinhoMain {
  const atraso = d.atrasoEmitirMs ?? 120;
  const pendentes = new Map<string, { evento: EventoBichinhoMudou; timer: ReturnType<typeof setTimeout> }>();
  const emitir = (e: EventoBichinhoMudou): void => {
    const p = pendentes.get(e.workspace_id);
    if (p !== undefined) {
      p.evento = { workspace_id: e.workspace_id, visao: e.visao, estagio_novo: p.evento.estagio_novo || e.estagio_novo, ...(p.evento.nasceu === true || e.nasceu === true ? { nasceu: true } : {}) };
      return;
    }
    const timer = setTimeout(() => {
      const atual = pendentes.get(e.workspace_id);
      pendentes.delete(e.workspace_id);
      if (atual !== undefined) d.enviar(atual.evento);
    }, atraso);
    timer.unref?.();
    pendentes.set(e.workspace_id, { evento: e, timer });
  };

  const servico = criarServicoBichinho({
    repo: criarRepoBichinho(d.banco),
    leitorProjeto: leitorDeDisco,
    ...(d.linguagensDoMapa === undefined ? {} : { linguagensDoMapa: d.linguagensDoMapa }),
    ...(d.chunksDoRag === undefined ? {} : { chunksDoRag: d.chunksDoRag }),
    ...(d.prefs === undefined ? {} : { prefs: d.prefs }),
    emitir,
    panesVivos: () => d.banco.consultar<{ id: string; workspace_id: string; estado: string }>("SELECT id, workspace_id, estado FROM pane WHERE estado IN ('trabalhando','aguardando','bloqueado')")
      .map((p) => ({ workspace_id: p.workspace_id, pane_id: p.id, estado: p.estado as EstadoPaneEvento })),
  });

  const wsDoPane = (paneId: unknown): string | null => {
    if (typeof paneId !== "string") return null;
    return d.banco.consultarUm<{ workspace_id: string }>("SELECT workspace_id FROM pane WHERE id = ?", [paneId])?.workspace_id ?? null;
  };
  const texto = (v: unknown): string | null => (typeof v === "string" && v.length > 0 && v.length <= 80 ? v : null);
  const protegido = <T>(f: (p: T) => void) => (p: T): void => { try { f(p); } catch { /* o bichinho nunca derruba o barramento */ } };

  // ---- Grok (sem adaptador de atividade): lê só a contagem de tokens, em lotes, enquanto a saída do PTY do Grok flui
  const grok = d.leitorGrok ?? criarLeitorTokensGrok({ home: process.env["GROK_HOME"] ?? join(homedir(), ".grok"), portas: portasDeDisco() });
  const agendarTimer = d.agendar ?? ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return { cancelar: () => clearTimeout(t) }; });
  const agoraMs = Date.now;
  const leituraGrok = new Map<string, { timer: { cancelar(): void } | null; ultimaSaida: number }>();
  const lerGrok = (ws: string): void => {
    const est = leituraGrok.get(ws);
    if (est === undefined) return;
    est.timer = null;
    const raiz = d.banco.consultarUm<{ raiz: string }>("SELECT raiz FROM workspace WHERE id = ?", [ws])?.raiz;
    if (raiz === undefined) return;
    void grok.delta(raiz).then((delta) => {
      if (delta > 0) servico.aoTokens(ws, delta);
      if (leituraGrok.get(ws) === est && est.timer === null && agoraMs() - est.ultimaSaida < GROK_LER_APOS_MS + 500) est.timer = agendarTimer(() => lerGrok(ws), GROK_LER_APOS_MS);
    }).catch(() => undefined);
  };
  const pulso: PulsoPty = {
    aoSaida: protegido((i) => {
      if (i.workspace_id === null) return;
      servico.aoSaida(i.workspace_id, i.sessao_id, i.dados.length, contarLinhas(i.dados));
      if (i.ferramenta_id !== "grok") return;
      let est = leituraGrok.get(i.workspace_id);
      if (est === undefined) { est = { timer: null, ultimaSaida: 0 }; leituraGrok.set(i.workspace_id, est); }
      est.ultimaSaida = agoraMs();
      const ws = i.workspace_id;
      est.timer ??= agendarTimer(() => lerGrok(ws), GROK_LER_APOS_MS);
    }),
    aoEntrada: protegido((i) => { if (i.workspace_id !== null) servico.aoEntrada(i.workspace_id); }),
    aoSessaoEncerrada: protegido((i) => { if (i.workspace_id !== null) servico.aoSessaoEncerrada(i.workspace_id, i.sessao_id); }),
  };

  const desligar: Array<() => void> = [
    d.barramento.assinar<{ escopos?: unknown }>("cost.updated", protegido((p) => {
      if (!Array.isArray(p.escopos)) return;
      for (const e of p.escopos as Array<{ escopo?: unknown; chave?: unknown }>) if (e.escopo === "workspace" && typeof e.chave === "string") servico.aoCustoAtualizado(e.chave);
    })),
    d.barramento.assinar<{ pane_id?: unknown; estado?: unknown }>("pane.state_changed", protegido((p) => {
      const ws = wsDoPane(p.pane_id);
      if (ws === null || typeof p.estado !== "string" || !ESTADOS_PANE.includes(p.estado)) return;
      servico.aoEvento(ws, { tipo: "pane", id: p.pane_id as string, estado: p.estado as EstadoPaneEvento });
    })),
    d.barramento.assinar<{ pane_id?: unknown; reason?: unknown }>("pane.closed", protegido((p) => {
      const ws = wsDoPane(p.pane_id);
      if (ws === null) return;
      servico.aoEvento(ws, { tipo: "pane_fechado", id: p.pane_id as string, motivo: typeof p.reason === "string" ? p.reason.slice(0, 40) : "" });
    })),
    // tarefa entregue/validada: conta para o ovo (D-671); o recálculo é coalescido no serviço
    d.barramento.assinar<{ workspace_id?: unknown; estado?: unknown }>("task.updated", protegido((p) => {
      const ws = texto(p.workspace_id);
      if (ws !== null && (p.estado === "entregue" || p.estado === "validada")) servico.aoTarefa(ws);
    })),
    d.barramento.assinar<{ workspace_id?: unknown; estado?: unknown }>("mission.closed", protegido((p) => {
      const ws = texto(p.workspace_id);
      if (ws === null || (p.estado !== "concluida" && p.estado !== "falhou" && p.estado !== "abortada")) return;
      servico.aoEvento(ws, { tipo: "missao", resultado: p.estado });
    })),
    d.barramento.assinar<{ workspace_id?: unknown }>("run.started", protegido((p) => { const ws = texto(p.workspace_id); if (ws !== null) servico.aoEvento(ws, { tipo: "execucao", resultado: "iniciada" }); })),
    d.barramento.assinar<{ workspace_id?: unknown }>("run.failed", protegido((p) => { const ws = texto(p.workspace_id); if (ws !== null) servico.aoEvento(ws, { tipo: "execucao", resultado: "falha" }); })),
    d.barramento.assinar<{ workspace_id?: unknown; resultado?: unknown }>("run.stopped", protegido((p) => {
      const ws = texto(p.workspace_id);
      if (ws !== null) servico.aoEvento(ws, { tipo: "execucao", resultado: p.resultado === "sucesso" ? "sucesso" : "parada" });
    })),
    d.barramento.assinar<{ used_pct?: unknown }>("limit.high", protegido((p) => { if (typeof p.used_pct === "number" && Number.isFinite(p.used_pct)) servico.aoLimite(p.used_pct); })),
    d.barramento.assinar("limit.reached", protegido(() => servico.aoLimite(100))),
    d.barramento.assinar<{ workspace_id?: unknown; severidade?: unknown }>("alert.created", protegido((p) => {
      const ws = texto(p.workspace_id);
      if (ws !== null && p.severidade === "critico") servico.aoEvento(ws, { tipo: "alerta", severidade: "critico" });
    })),
  ];

  return {
    servico,
    pulso,
    encerrar() {
      for (const f of desligar) f();
      for (const e of leituraGrok.values()) e.timer?.cancelar();
      leituraGrok.clear();
      for (const p of pendentes.values()) clearTimeout(p.timer);
      pendentes.clear();
      servico.encerrar();
    },
  };
}
