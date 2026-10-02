// Integração da ligação de limites no boot (onda 3-A): dublês de Electron/sessões, banco em memória, IPC real do registro.
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventoLimites } from "../compartilhado/limites";
import type { EventoTerminal } from "../compartilhado/terminais";
import { abrirBanco, migrar, type Banco } from "../nucleo/banco";
import { criarRepositorios } from "../nucleo/banco/repos";
import { VARIAVEL_ARQUIVO_STATUSLINE } from "../nucleo/limites/statusline";
import type { Agendador } from "../nucleo/limites/servico";
import type { PreparadorDePane } from "../nucleo/missoes/panes";
import { criarBarramento } from "./barramento";
import { copiarStatusline, ligarLimites, NOME_SCRIPT_STATUSLINE, origemDaStatusline } from "./limites-boot";
import { criarRegistroIpc, type IpcMainLike } from "./ipc/registro";

const RAIZ = resolve(__dirname, "../..");
const ORIGEM = join(RAIZ, "src/nucleo/limites/scripts", NOME_SCRIPT_STATUSLINE);
const FRASE = readFileSync(join(RAIZ, "tests/fixtures/limites/pty-claude-limite.txt"), "utf8");
const T0 = Date.parse("2026-10-01T12:00:00.000Z");

const bancos: Banco[] = [];
const pastas: string[] = [];
const servicos: Array<{ aguardarLeituras(): Promise<void> }> = [];
afterEach(async () => {
  for (const sv of servicos.splice(0)) await sv.aguardarLeituras(); // leituras do boot terminam antes de fechar o banco
  bancos.splice(0).forEach((b) => b.fechar());
  pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});

const agendadorMudo: Agendador = { setTimeout: () => 0, clearTimeout: () => undefined };

async function montar(opc: { origem?: string; sessoesFalham?: boolean } = {}) {
  const banco = abrirBanco(":memory:");
  bancos.push(banco);
  migrar(banco);
  const repos = criarRepositorios(banco);
  const pastaDeDados = mkdtempSync(join(tmpdir(), "ade-limites-boot-"));
  pastas.push(pastaDeDados);
  const conta = repos.conta.criar({ provedor: "claude", rotulo: "cl·1" });
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true });
  const barramento = criarBarramento(agendadorMudo);
  const noBarramento: Array<[string, unknown]> = [];
  barramento.assinar("limit.reached", (p) => noBarramento.push(["limit.reached", p]));
  const noRenderer: EventoLimites[] = [];
  let complemento: PreparadorDePane | null = null;
  const definirComplemento = vi.fn((fn: PreparadorDePane | null) => void (complemento = fn));
  const assinantes = new Set<(ev: EventoTerminal) => void>();
  const pane = { id: "pane_1", conta_id: conta.id as string | null, cli: "claude" };
  const reposComPane = { ...repos, pane: { obter: (id: string) => (id === pane.id ? pane : undefined) } } as unknown as typeof repos;
  const contas = { listar: () => repos.conta.listar({ limite: 500 }).itens, configDirAbsoluto: () => null };
  const ligados = await ligarLimites({
    registro,
    dominio: { repos: reposComPane, contas, panes: { definirComplemento } } as never,
    paneDaSessao: (s) => (s === "ses_1" ? pane.id : null),
    barramento,
    emitirRenderer: (e) => noRenderer.push(e),
    pastaDeDados,
    foco: () => true,
    sessoes: async () => {
      if (opc.sessoesFalham) throw new Error("sem sessões");
      return { assinar: (fn) => (assinantes.add(fn), () => assinantes.delete(fn)) };
    },
    origemStatusline: opc.origem ?? ORIGEM,
    extras: { agora: () => T0, agendador: agendadorMudo, observarPasta: () => ({ fechar: () => undefined }) },
  });
  servicos.push(ligados.limites.servico);
  const emitir = (ev: EventoTerminal): void => assinantes.forEach((f) => f(ev));
  return { ligados, conta, handlers, noBarramento, noRenderer, definirComplemento, pastaDeDados, pane, emitir, assinantes, repos: reposComPane, complemento: () => complemento };
}

const saida = (dados: string): EventoTerminal => ({ tipo: "saida", sessao_id: "ses_1", dados }) as unknown as EventoTerminal;

describe("ligarLimites (onda 2 do boot)", () => {
  it("registra os canais limites:* e o snapshot responde com a conta", async () => {
    const m = await montar();
    for (const c of ["limites:snapshot", "limites:atualizar", "limites:manual_definir", "limites:manual_limpar"]) expect(m.handlers.has(c), c).toBe(true);
    const r = (await m.handlers.get("limites:snapshot")!({}, {})) as { contas: Array<{ account_id: string }> };
    expect(r.contas.map((c) => c.account_id)).toEqual([m.conta.id]);
    m.ligados.encerrar();
  });

  it("copia o statusline para userData de forma idempotente e entrega argv/ambiente só ao Claude com conta", async () => {
    const m = await montar();
    const destino = join(m.pastaDeDados, "limites", "bin", NOME_SCRIPT_STATUSLINE);
    expect(m.ligados.script).toBe(destino);
    expect(readFileSync(destino, "utf8")).toBe(readFileSync(ORIGEM, "utf8"));
    const mtime = statSync(destino).mtimeMs;
    utimesSync(destino, new Date(1_000), new Date(1_000));
    expect(copiarStatusline(ORIGEM, m.pastaDeDados)).toBe(destino);
    expect(statSync(destino).mtimeMs).toBe(1_000); // igual: não reescreve
    expect(mtime).not.toBe(1_000);

    const comp = m.complemento()!;
    const preparo = await comp({ pane: m.pane, ferramenta: { id: "claude" } } as never);
    expect(preparo?.argumentos[0]).toBe("--settings");
    expect(JSON.parse(preparo!.argumentos[1] as string).statusLine.command).toContain(destino);
    expect(preparo?.ambiente[VARIAVEL_ARQUIVO_STATUSLINE]).toBe(join(m.pastaDeDados, "limites", "claude", `${m.conta.id}.json`));
    expect(await comp({ pane: m.pane, ferramenta: { id: "codex" } } as never)).toBeNull();
    expect(await comp({ pane: { ...m.pane, conta_id: null }, ferramenta: { id: "claude" } } as never)).toBeNull();
    m.repos.config.definir("limites.claude_statusline", false);
    expect(await comp({ pane: m.pane, ferramenta: { id: "claude" } } as never)).toBeNull(); // opt-out
    m.ligados.encerrar();
    expect(m.definirComplemento).toHaveBeenLastCalledWith(null);
  });

  it("saída do PTY com a frase de limite vira limit.reached e limites:evento (com o Pane)", async () => {
    const m = await montar();
    m.emitir(saida("texto comum sem nada\r\n"));
    expect(m.noBarramento).toEqual([]);
    m.emitir(saida(FRASE));
    expect(m.noBarramento).toEqual([["limit.reached", { conta_id: m.conta.id, janela: "weekly", pane_id: "pane_1", fonte: "saida_do_pty" }]]);
    expect(m.noRenderer.some((e) => e.tipo === "limite_atingido")).toBe(true);
    // sessão desconhecida e encerramento não quebram nem repetem
    m.emitir({ tipo: "saida", sessao_id: "ses_x", dados: FRASE } as never);
    m.emitir({ tipo: "encerramento", sessao_id: "ses_1", codigo: 0, sinal: null } as never);
    expect(m.noBarramento).toHaveLength(1);
    m.ligados.encerrar();
    expect(m.assinantes.size).toBe(0);
  });

  it("origem do script ausente ou sessões indisponíveis: avisa e segue sem derrubar o boot", async () => {
    const m = await montar({ origem: join(tmpdir(), "nao-existe", "x.mjs"), sessoesFalham: true });
    expect(m.ligados.script).toBeNull();
    expect(await m.complemento()!({ pane: m.pane, ferramenta: { id: "claude" } } as never)).toBeNull();
    expect(m.handlers.has("limites:snapshot")).toBe(true);
    m.ligados.encerrar();
  });
});

describe("origemDaStatusline", () => {
  it("dev cai em src/ quando dist/ não tem o script; empacotado usa dist/ fora do asar", () => {
    const dirMain = "/app/dist/main";
    expect(origemDaStatusline({ dirMain, empacotado: false, existe: () => false })).toBe(join("/app/src/nucleo/limites/scripts", NOME_SCRIPT_STATUSLINE));
    expect(origemDaStatusline({ dirMain, empacotado: false, existe: () => true })).toBe(join("/app/dist/nucleo/limites/scripts", NOME_SCRIPT_STATUSLINE));
    expect(origemDaStatusline({ dirMain: "/R/app.asar/dist/main", empacotado: true })).toBe(join("/R/app.asar.unpacked/dist/nucleo/limites/scripts", NOME_SCRIPT_STATUSLINE));
  });
});
