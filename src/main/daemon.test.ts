import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InfoSessaoDaemon } from "../daemon/protocolo";
import type { AdaptadorPty } from "../nucleo/terminais/lancamento";
import { criarServicoDaemon, OCIOSO_E2E_MS, scriptDoDaemon, type ClienteDaemonUsado } from "./daemon";

const reserva: AdaptadorPty = { spawn: () => { throw new Error("reserva"); } };
const pastas: string[] = [];
afterEach(() => { while (pastas.length > 0) rmSync(pastas.pop() as string, { recursive: true, force: true }); });

function info(estado: InfoSessaoDaemon["estado"]): InfoSessaoDaemon {
  return { sessao_id: "sessao_x", estado, codigo: null, sinal: null, ferramenta_id: "terminal", executavel_id: "exe_x", argumentos: [], raiz: "/", workspace_id: null, colunas: 80, linhas: 24, criada_em: 0 };
}

function montar(sessoes: InfoSessaoDaemon[], extra: Partial<Parameters<typeof criarServicoDaemon>[0]> = {}) {
  const dadosApp = mkdtempSync(join(tmpdir(), "svc-daemon-"));
  pastas.push(dadosApp);
  const cliente = {
    persistente: true,
    estado: "conectado",
    pronto: Promise.resolve(true),
    spawn: vi.fn(),
    listar: vi.fn(async () => sessoes),
    encerrarTudo: vi.fn(async () => undefined),
    fechar: vi.fn(async () => undefined),
  } as unknown as ClienteDaemonUsado;
  const criarCliente = vi.fn(() => cliente);
  const lancar = vi.fn();
  const servico = criarServicoDaemon({ dadosApp, executavel: "/app/electron", script: "/app/dist/daemon/main-daemon.js", reserva, criarCliente, lancar, ...extra });
  return { servico, cliente, criarCliente, lancar };
}

describe("serviço do daemon (onda 2)", () => {
  it("criar o serviço não sobe nada; só iniciar() cria o cliente (uma vez)", () => {
    const { servico, criarCliente } = montar([]);
    expect(criarCliente).not.toHaveBeenCalled();
    expect(servico.adaptador()).toBe(reserva);
    servico.iniciar();
    servico.iniciar();
    expect(criarCliente).toHaveBeenCalledTimes(1);
  });

  it("o daemon roda o executável do app apontando para o script, com ocioso curto só no e2e", () => {
    for (const e2e of [false, true]) {
      const { servico, criarCliente, lancar } = montar([], { e2e });
      servico.iniciar();
      const op = (criarCliente.mock.calls[0] as unknown as [{ iniciarDaemon: () => void }])[0];
      op.iniciarDaemon();
      const chamada = (lancar.mock.calls[0] as unknown as [Record<string, unknown>])[0];
      expect(chamada["executavel"]).toBe("/app/electron");
      expect(chamada["script"]).toBe("/app/dist/daemon/main-daemon.js");
      expect(chamada["ocioso_ms"]).toBe(e2e ? OCIOSO_E2E_MS : undefined);
    }
  });

  it("desligado (sem daemon): usa a reserva e não cria cliente", () => {
    const { servico, criarCliente } = montar([], { desligado: true });
    servico.iniciar();
    expect(criarCliente).not.toHaveBeenCalled();
    expect(servico.adaptador()).toBe(reserva);
  });

  it("com sessão viva ao sair: PRESERVA (não manda encerrar) e só fecha a conexão", async () => {
    const { servico, cliente } = montar([info("executando"), info("encerrada")]);
    servico.iniciar();
    const r = await servico.aoSairDoApp();
    expect(r).toEqual({ preservou: true, vivas: 1 });
    expect(cliente.encerrarTudo).not.toHaveBeenCalled();
    expect(cliente.fechar).toHaveBeenCalledTimes(1);
  });

  it("sem sessão viva ao sair: encerra o daemon e fecha a conexão", async () => {
    const { servico, cliente } = montar([info("encerrada")]);
    servico.iniciar();
    const r = await servico.aoSairDoApp();
    expect(r.preservou).toBe(false);
    expect(cliente.encerrarTudo).toHaveBeenCalledTimes(1);
    expect(cliente.fechar).toHaveBeenCalledTimes(1);
  });

  it("em dúvida (não conseguiu contar) preserva", async () => {
    const { servico, cliente } = montar([]);
    (cliente.listar as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("queda"));
    servico.iniciar();
    // sessoesVivas absorve o erro (0), mas aoSairDoApp usa a contagem crua: erro = dúvida
    const r = await servico.aoSairDoApp();
    expect(r.preservou).toBe(true);
    expect(cliente.encerrarTudo).not.toHaveBeenCalled();
  });

  it("encerrarTudo explícito manda o daemon matar tudo", async () => {
    const { servico, cliente } = montar([info("executando")]);
    servico.iniciar();
    await servico.encerrarTudo();
    expect(cliente.encerrarTudo).toHaveBeenCalledTimes(1);
  });

  it("em pacote o script sai de app.asar para app.asar.unpacked", () => {
    expect(scriptDoDaemon("/Apps/X.app/Contents/Resources/app.asar/dist/main", true)).toBe("/Apps/X.app/Contents/Resources/app.asar.unpacked/dist/daemon/main-daemon.js");
    expect(scriptDoDaemon("/repo/dist/main", false)).toBe("/repo/dist/daemon/main-daemon.js");
  });
});
