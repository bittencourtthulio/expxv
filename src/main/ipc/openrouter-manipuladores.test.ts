import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { subirServidorFalso, type ServidorFalso } from "../../../tests/fixtures/rede/servidor-falso";
import { abrirBanco, migrar, type Banco } from "../../nucleo/banco";
import { criarRepositorios } from "../../nucleo/banco/repos";
import { criarCofre, criarMotorSafeStorage, type PortaSafeStorage } from "../../nucleo/cofre";
import { criarServicoOpenRouter, OpenRouterErro } from "../../nucleo/openrouter";
import { criarClienteRede, criarRegistroConsentimento } from "../../nucleo/rede";
import { CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import { registrarIpcOpenRouter, sanearErroOpenRouter } from "./openrouter";
import { CanalRecusadoErro, criarRegistroIpc, type IpcMainLike } from "./registro";

const CHAVE = "sk-or-v1-SENTINELA-ipc-openrouter-b7e1d3a9";
const bancos: Banco[] = [];
const pastas: string[] = [];
const servidores: ServidorFalso[] = [];
afterEach(async () => {
  bancos.splice(0).forEach((b) => b.fechar());
  pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
  while (servidores.length) await (servidores.pop() as ServidorFalso).fechar();
});

const porta: PortaSafeStorage = {
  disponivel: () => true,
  backend: () => null,
  cifrar: (t) => Buffer.from(`enc:${Buffer.from(t).reverse().toString("base64")}`),
  decifrar: (b) => Buffer.from(Buffer.from(b).toString().slice(4), "base64").reverse().toString(),
};

async function montar() {
  const banco = abrirBanco(":memory:");
  bancos.push(banco);
  migrar(banco);
  const repos = criarRepositorios(banco);
  const dir = mkdtempSync(join(tmpdir(), "ipc-openrouter-"));
  pastas.push(dir);
  const servidor = await subirServidorFalso((q, r) => {
    r.setHeader("content-type", "application/json");
    if ((q.url ?? "").startsWith("/api/v1/models")) r.end(JSON.stringify({ data: [{ id: "anthropic/claude-x", name: "Claude X", pricing: { prompt: "0.000003", completion: "0.000015" } }] }));
    else if ((q.url ?? "").startsWith("/api/v1/key")) r.end(JSON.stringify({ data: { limit: 10, usage: 2, limit_remaining: 8, is_free_tier: false } }));
    else {
      r.statusCode = 404;
      r.end("{}");
    }
  });
  servidores.push(servidor);
  const consentimento = criarRegistroConsentimento();
  const cofre = criarCofre({ arquivo: join(dir, "cofre.json"), motor: criarMotorSafeStorage(porta) });
  let aberturas = 0;
  const servico = criarServicoOpenRouter({
    repos,
    cofre: async () => cofre,
    rede: () => {
      aberturas++;
      return criarClienteRede({ consentimento, permitirLoopbackHttp: true });
    },
    consentimento,
    destino: { host: servidor.host, porta: servidor.porta },
    instaladas: async () => ["opencode"],
  });
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const logs: string[] = [];
  const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true, log: (l) => logs.push(l), logarPayload: true });
  let criacoesDoServico = 0;
  registrarIpcOpenRouter({ registro, servico: () => ((criacoesDoServico++), servico) });
  const chamar = (canal: string, payload: unknown = {}): Promise<unknown> => (handlers.get(canal) as (e: unknown, ...a: unknown[]) => Promise<unknown>)({}, payload);
  return { chamar, handlers, logs, servidor, aberturasDeRede: () => aberturas, usosDoServico: () => criacoesDoServico };
}

describe("manipuladores provedores:openrouter_*", () => {
  it("registra os 10 canais do contrato e não instancia nada no registro (sob demanda)", async () => {
    const m = await montar();
    expect([...m.handlers.keys()].sort()).toEqual(
      ["estado", "consentir", "revogar", "chave_gravar", "chave_apagar", "testar", "modelos_atualizar", "modelos_listar", "modelo_gravar", "saldo_atualizar"].map((n) => `provedores:openrouter_${n}`).sort(),
    );
    expect(m.usosDoServico()).toBe(0);
    expect(m.aberturasDeRede()).toBe(0);
  });

  it("instalação nova: estado sem rede; atualizar modelos sem consentir é recusado e abre ZERO conexões", async () => {
    const m = await montar();
    expect(await m.chamar("provedores:openrouter_estado")).toMatchObject({ habilitado: false, contas: [], modelos: { total: 0, habilitados: 0 } });
    await m.chamar("provedores:openrouter_chave_gravar", { rotulo: "or·1", chave: CHAVE });
    const erro = await m.chamar("provedores:openrouter_modelos_atualizar", {}).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(OpenRouterErro);
    expect((erro as OpenRouterErro).codigo).toBe("sem_consentimento");
    expect(await m.chamar("provedores:openrouter_testar", { chave: CHAVE })).toMatchObject({ ok: false, motivo: "sem_consentimento" });
    expect(m.servidor.conexoes()).toBe(0);
    expect(m.aberturasDeRede()).toBe(0);
  });

  it("fluxo completo por clique: consentir, gravar, testar, atualizar modelos, habilitar, saldo; a chave nunca volta nem é logada", async () => {
    const m = await montar();
    await m.chamar("provedores:openrouter_consentir", { consentimento: true, versao_texto: "v1" });
    const conta = (await m.chamar("provedores:openrouter_chave_gravar", { rotulo: "or·1", chave: CHAVE })) as { conta_id: string; ultimos4: string };
    expect(conta.ultimos4).toBe(CHAVE.slice(-4));
    expect(await m.chamar("provedores:openrouter_testar", { conta_id: conta.conta_id })).toMatchObject({ ok: true, tipo: "pago", limite_usd: 10, saldo_usd: 8 });
    expect(await m.chamar("provedores:openrouter_modelos_atualizar", { conta_id: conta.conta_id })).toEqual({ total: 1, novos: 1, removidos: 0 });
    expect(await m.chamar("provedores:openrouter_modelo_gravar", { id: "anthropic/claude-x", habilitado: true, faixa: "alto", tipos_permitidos: [], ordem: 1 })).toMatchObject({ habilitado: true, faixa: "alto" });
    expect(await m.chamar("provedores:openrouter_modelos_listar", { so_habilitados: true })).toMatchObject({ total: 1, proximo: null });
    const estado = await m.chamar("provedores:openrouter_saldo_atualizar", { conta_id: conta.conta_id });
    expect(estado).toMatchObject({ habilitado: true, modelos: { total: 1, habilitados: 1 } });
    expect(JSON.stringify(estado)).not.toContain(CHAVE);
    expect(m.logs.join("\n")).not.toContain(CHAVE);
    expect(m.logs.filter((l) => l.includes("chave_gravar") || l.includes("openrouter_testar")).every((l) => l.includes("payload omitido"))).toBe(true);
    expect(await m.chamar("provedores:openrouter_chave_apagar", { conta_id: conta.conta_id })).toBe(true);
    const revogado = (await m.chamar("provedores:openrouter_revogar", {})) as { habilitado: boolean; modelos: { total: number } };
    expect(revogado).toMatchObject({ habilitado: false, modelos: { total: 1 } });
  });

  it("payload inválido (conta_id e chave juntos) é recusado antes do manipulador; erro estranho vira texto genérico", async () => {
    const m = await montar();
    await expect(m.chamar("provedores:openrouter_testar", { conta_id: "conta_01HZZZZZZZZZ", chave: CHAVE })).rejects.toBeInstanceOf(CanalRecusadoErro);
    const erro = sanearErroOpenRouter(new Error(`falha lendo ${CHAVE} em /Users/x/cofre.json`));
    expect(erro.message).toBe("falha no OpenRouter");
    expect(sanearErroOpenRouter(new OpenRouterErro("sem_chave")).message).toContain("sem_chave");
  });

  it("os canais que carregam chave estão marcados como sensíveis", () => {
    for (const c of ["provedores:openrouter_chave_gravar", "provedores:openrouter_testar"]) expect(CANAIS_SENSIVEIS as readonly string[]).toContain(c);
  });
});
