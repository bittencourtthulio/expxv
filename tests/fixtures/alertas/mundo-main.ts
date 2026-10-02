// Mundo de teste da ligação de alertas no MAIN (Fase 20, onda 2): banco SQLite real (memória), Missão/Pane/card reais, cofre em memória, barramento real e um
// relógio controlável. O Telegram (quando usado) é o servidor FALSO local. Nada de rede externa, bot real, Electron ou CLI paga.
import { vi } from "vitest";
import type { Cofre } from "../../../src/nucleo/cofre";
import { criarRegistroConsentimento } from "../../../src/nucleo/rede";
import { criarServicoPortoes } from "../../../src/nucleo/orquestracao/portoes";
import { criarBarramento } from "../../../src/main/barramento";
import { ligarAlertas, type DepsAlertas, type LigacaoAlertas } from "../../../src/main/alertas";
import { variavelDeAmbiente } from "../../../src/nucleo/produto";
import { criarTmp, novoBanco } from "../dominio/ambiente";
import { relogioFalso, type RelogioFalso } from "./ajudas";

/** relógio que ANDA com o tempo real (os timers reais do entregador/poller convergem) e ainda aceita `avancar(ms)`: para os testes com o servidor Telegram falso, que carimba `date` com o relógio real. */
export function relogioVivo(): RelogioFalso {
  let deslocamento = 0;
  return { agora: () => Date.now() + deslocamento, avancar: (ms) => void (deslocamento += ms), definir: (ms) => void (deslocamento = ms - Date.now()) };
}

/** cofre mínimo em memória: só o que o Telegram usa (estado, existe, obter, guardar, listar, apagar). */
export function cofreEmMemoria(): Cofre & { valores: Map<string, string>; disponivel: boolean } {
  const valores = new Map<string, string>();
  const ids = new Map<string, string>();
  const c = {
    valores,
    disponivel: true,
    async estado() {
      return { ok: c.disponivel, backend: c.disponivel ? "safe_storage" : "indisponivel", bloqueado: false };
    },
    async existe(nome: string) {
      return valores.has(nome);
    },
    async obter(nome: string) {
      const v = valores.get(nome);
      if (v === undefined) throw new Error("ausente");
      return v;
    },
    async guardar(p: { nome: string; valor: string }) {
      valores.set(p.nome, p.valor);
      ids.set(p.nome, `cof_${p.nome}`);
      return { id: `cof_${p.nome}`, nome: p.nome } as never;
    },
    async listar() {
      return [...valores.keys()].map((nome) => ({ id: ids.get(nome) as string, nome })) as never;
    },
    async apagar(id: string) {
      for (const [n, i] of ids) if (i === id) (valores.delete(n), ids.delete(n));
      return true;
    },
    scrubSincrono: (t: string) => t,
  };
  return c as unknown as Cofre & { valores: Map<string, string>; disponivel: boolean };
}

export interface MundoMain {
  l: LigacaoAlertas;
  banco: ReturnType<typeof novoBanco>["banco"];
  repos: ReturnType<typeof novoBanco>["repos"];
  ws: { id: string; nome: string };
  barramento: ReturnType<typeof criarBarramento>;
  relogio: RelogioFalso;
  cofre: ReturnType<typeof cofreEmMemoria>;
  renderer: Array<{ canal: string; payload: unknown }>;
  notificacoesSo: Array<{ title: string; body: string; silent: boolean }>;
  avisos: string[];
  consentimento: ReturnType<typeof criarRegistroConsentimento>;
  /** altera o estado da janela. */
  foco: { emFoco: boolean; notificacoes: boolean };
  deps: DepsAlertas;
}

export function montarMain(o: Partial<DepsAlertas> & { telegramPorta?: number; vivo?: boolean } = {}): MundoMain {
  const { banco, repos } = novoBanco();
  const ws = repos.workspace.criar({ nome: "app-web", raiz: criarTmp("alertas-main-") });
  const barramento = criarBarramento();
  const relogio = o.vivo === true ? relogioVivo() : relogioFalso();
  const cofre = cofreEmMemoria();
  const renderer: MundoMain["renderer"] = [];
  const notificacoesSo: MundoMain["notificacoesSo"] = [];
  const avisos: string[] = [];
  const foco = { emFoco: false, notificacoes: true };
  const consentimento = criarRegistroConsentimento();
  const { telegramPorta, vivo: _vivo, ...resto } = o;
  void _vivo;
  const deps: DepsAlertas = {
    banco,
    barramento,
    config: repos.config,
    portoes: criarServicoPortoes({ repos, banco, aoMudar: () => undefined }),
    emitirRenderer: (canal, payload) => void renderer.push({ canal, payload }),
    workspaces: { obter: (id) => repos.workspace.obter(id), permissaoDe: () => "seguro" },
    cofre: async () => cofre,
    consentimento,
    mostrarNotificacaoSo: (n) => void notificacoesSo.push(n),
    janelaEmFoco: () => foco.emFoco,
    notificacoesAtivas: () => foco.notificacoes,
    maestro: () => null,
    indiceMetodo: () => null,
    cotaGeralPct: () => null,
    escolherArquivoDeSaida: async () => null,
    aviso: (m) => void avisos.push(m),
    relogio,
    env: { NODE_ENV: "test", ...(telegramPorta === undefined ? {} : { [variavelDeAmbiente("TELEGRAM_BASE")]: `http://127.0.0.1:${telegramPorta}` }) },
    ...resto,
  };
  const l = ligarAlertas(deps);
  return { l, banco, repos, ws: { id: ws.id, nome: ws.nome }, barramento, relogio, cofre, renderer, notificacoesSo, avisos, consentimento, foco, deps };
}

/** cria Missão + card + Pane livres de teste e devolve os ids. */
export function criarCard(m: MundoMain, o: { titulo?: string; task_ref?: string; mission_titulo?: string; trabalho_id?: string } = {}): { mission_id: string; task_id: string; task_ref: string; pane_id: string } {
  const mis = m.repos.mission.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "feature", titulo: o.mission_titulo ?? "Corrigir o login", trabalho_id: o.trabalho_id ?? "OC-1" });
  const pane = m.repos.pane.criar({ workspace_id: m.ws.id, mission_id: mis.id, tipo: "cli", cli: "claude", papel: "executor", modelo: "sonnet" });
  const task = m.repos.task.criar({ mission_id: mis.id, task_ref: o.task_ref ?? "T-1.1", titulo: o.titulo ?? "Corrigir botão", papel: "executor" });
  return { mission_id: mis.id, task_id: task.id, task_ref: task.task_ref, pane_id: pane.id };
}

export const esperarMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const espiar = vi.fn;
