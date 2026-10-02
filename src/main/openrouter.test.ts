import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../nucleo/banco";
import { criarRepositorios } from "../nucleo/banco/repos";
import { criarCofre, criarMotorSafeStorage, type PortaSafeStorage } from "../nucleo/cofre";
import { ErroMcp } from "../nucleo/mcp/erros";
import { OpenRouterErro, nomeCofreDaConta } from "../nucleo/openrouter";
import { criarBarramento } from "./barramento";
import { criarOpenRouterMain, erroMcpDoOpenRouter } from "./openrouter";

const CHAVE = "sk-or-v1-SENTINELA-main-openrouter-3c5e7a91";
const bancos: Banco[] = [];
const pastas: string[] = [];
afterEach(() => {
  bancos.splice(0).forEach((b) => b.fechar());
  pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});
const porta: PortaSafeStorage = {
  disponivel: () => true,
  backend: () => null,
  cifrar: (t) => Buffer.from(`enc:${Buffer.from(t).reverse().toString("base64")}`),
  decifrar: (b) => Buffer.from(Buffer.from(b).toString().slice(4), "base64").reverse().toString(),
};

async function montar(o: { consentir?: boolean; habilitarModelo?: boolean; instaladas?: string[] } = {}) {
  const banco = abrirBanco(":memory:");
  bancos.push(banco);
  migrar(banco);
  const repos = criarRepositorios(banco);
  const dir = mkdtempSync(join(tmpdir(), "ade-or-main-"));
  pastas.push(dir);
  const ws = repos.workspace.criar({ nome: "w", raiz: "/w" });
  const cofre = criarCofre({ arquivo: join(dir, "cofre.json"), motor: criarMotorSafeStorage(porta) });
  const conta = repos.conta.criar({ provedor: "openrouter", rotulo: "or·1" });
  const nome = nomeCofreDaConta(conta.id);
  await cofre.guardar({ id: null, nome, escopo: "global", workspace_id: null, sensivel: true, valor: CHAVE });
  repos.contaOpenrouter.gravar({ conta_id: conta.id, cofre_entrada_id: nome, ultimos4: CHAVE.slice(-4) });
  repos.openrouterModelo.sincronizar([{ id: "anthropic/claude-x", nome: "Claude X" }]);
  if (o.habilitarModelo !== false) repos.openrouterModelo.gravarClassificacao({ id: "anthropic/claude-x", habilitado: true, faixa: "alto", tipos_permitidos: [], ordem: 1 });
  if (o.consentir !== false) repos.config.definir("openrouter", { habilitado: true, consentimento_em: "2026-10-01T10:00:00.000Z", clis_preferidas: ["opencode", "aider"], atualizar_saldo: true });
  const instaladas = o.instaladas ?? ["opencode", "claude"];
  const eventos: Array<[string, unknown]> = [];
  const barramento = criarBarramento();
  const main = criarOpenRouterMain({
    repos,
    banco,
    cofre: async () => cofre,
    provedores: { listar: async () => instaladas.map((id) => ({ ferramenta: { id, instalado: true } })) as never },
    barramento,
    rede: { requisitar: async () => { throw new Error("a rede NÃO deveria ser usada"); }, stream: async () => { throw new Error("rede"); } },
  });
  barramento.assinar("openrouter.models_updated", (p) => eventos.push(["openrouter.models_updated", p]));
  return { main, repos, ws, conta, banco, eventos };
}

describe("OpenRouter no main", () => {
  it("provedor virtual: habilitado só com consentimento + modelo habilitado, e traz o motivo quando desligado", async () => {
    expect(await (await montar()).main.porta.provedor()).toMatchObject({ provedor: "openrouter", cli: "opencode", habilitado: true, clis: ["opencode"] });
    expect(await (await montar({ consentir: false })).main.porta.provedor()).toMatchObject({ habilitado: false, motivo_desabilitado: "openrouter_not_consented" });
    expect(await (await montar({ habilitarModelo: false })).main.porta.provedor()).toMatchObject({ habilitado: false, motivo_desabilitado: "model_not_enabled" });
  });

  it("modelos: só os habilitados, com a faixa do dono", async () => {
    const m = await montar();
    expect(await m.main.porta.modelos()).toEqual([{ modelo: "anthropic/claude-x", niveis_esforco: [], faixa: "alto" }]);
  });

  it("lançamento padrão (modo a): argv do adaptador e AMBIENTE VAZIO — a chave do cofre não vai ao Pane sem opt-in do workspace", async () => {
    const m = await montar();
    const l = await m.main.porta.lancar({ workspace_id: m.ws.id, cli: null, modelo: "anthropic/claude-x", conta_id: null });
    expect(l).toMatchObject({ cli: "opencode", modelo: "anthropic/claude-x", faixa: "alto", argumentos: ["--model", "openrouter/anthropic/claude-x"], ambiente: {} });
    expect(JSON.stringify(l)).not.toContain(CHAVE);
  });

  it("com `injetar_cofre_no_env` do workspace (P-319, modo b) a chave vai só por ambiente; nunca em argv", async () => {
    const m = await montar();
    m.repos.harnessWorkspace.gravar({ ...m.repos.harnessWorkspace.obter(m.ws.id), injetar_cofre_no_env: true });
    const l = await m.main.porta.lancar({ workspace_id: m.ws.id, cli: "opencode", modelo: "anthropic/claude-x", conta_id: m.conta.id });
    expect(l.ambiente).toEqual({ OPENROUTER_API_KEY: CHAVE });
    expect(l.argumentos.join(" ")).not.toContain(CHAVE);
  });

  it("recusas viram ErroMcp nominal do contrato", async () => {
    const corpo = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as ErroMcp).corpo();
    const m = await montar();
    expect(await corpo(m.main.porta.lancar({ workspace_id: m.ws.id, cli: null, modelo: "meta/outro", conta_id: null }))).toMatchObject({ code: "rule_violation", subcode: "model_not_enabled" });
    expect(await corpo(m.main.porta.lancar({ workspace_id: m.ws.id, cli: "codex", modelo: "anthropic/claude-x", conta_id: null }))).toMatchObject({ code: "unavailable", subcode: "no_compatible_cli" });
    const sem = await montar({ consentir: false });
    expect(await corpo(sem.main.porta.lancar({ workspace_id: sem.ws.id, cli: null, modelo: "anthropic/claude-x", conta_id: null }))).toMatchObject({ code: "rule_violation", subcode: "openrouter_not_consented" });
    expect(erroMcpDoOpenRouter(new OpenRouterErro("indisponivel")).corpo()).toMatchObject({ code: "unavailable" });
    expect(erroMcpDoOpenRouter(new Error("detalhe interno com /caminho")).corpo().message).not.toContain("caminho");
  });

  it("paneVivo: só com Pane não encerrado cuja rota é openrouter (decide o saldo automático)", async () => {
    const m = await montar();
    expect(m.main.paneVivo()).toBe(false);
    const pane = m.repos.pane.criar({ workspace_id: m.ws.id, tipo: "cli", cli: "opencode", papel: "executor" });
    m.repos.paneRota.gravar({ pane_id: pane.id, perfil: { agente_id: null, provider: "claude", cli: "claude", modelo: null, esforco: null, faixa: "medio" } });
    expect(m.main.paneVivo()).toBe(false);
    m.repos.paneRota.gravar({ pane_id: pane.id, perfil: { agente_id: null, provider: "openrouter", cli: "opencode", modelo: "anthropic/claude-x", esforco: null, faixa: "alto" } });
    expect(m.main.paneVivo()).toBe(true);
    m.repos.pane.encerrar(pane.id, "teste");
    expect(m.main.paneVivo()).toBe(false);
  });

  it("zero rede: provedor, modelos, lançamento e iniciar() não tocam a rede (a injetada lançaria)", async () => {
    const m = await montar();
    m.main.iniciar();
    await m.main.porta.provedor();
    await m.main.porta.modelos();
    await m.main.porta.lancar({ workspace_id: m.ws.id, cli: null, modelo: "anthropic/claude-x", conta_id: null });
    expect(await m.main.servico.estado()).toMatchObject({ habilitado: true });
  });
});
