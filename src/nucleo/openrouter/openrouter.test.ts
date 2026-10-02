import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { subirServidorFalso, type ServidorFalso } from "../../../tests/fixtures/rede/servidor-falso";
import { abrirBanco, migrar, type Banco } from "../banco";
import { criarRepositorios, type Repositorios } from "../banco/repos";
import { criarCofre, criarMotorSafeStorage, type Cofre, type PortaSafeStorage } from "../cofre";
import { criarAdaptadorOpenRouterSaldo } from "../limites/adaptadores/openrouter-saldo";
import { derivarUso } from "../limites/derivar";
import { criarLimitsService } from "../limites/servico";
import { criarClienteRede, criarRegistroConsentimento } from "../rede";
import { ADAPTADORES_CLI, adaptadorDaCli, clisUtilizaveis, criarServicoOpenRouter, nomeCofreDaConta, OpenRouterErro, precoPorMtok, sugerirFaixa, traduzirModeloDaApi, type ServicoOpenRouter } from "./index";

const CHAVE = "sk-or-v1-SENTINELA-openrouter-4f9a1c7e2d8b";
const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const bancos: Banco[] = [];
const pastas: string[] = [];
const servidores: ServidorFalso[] = [];
afterEach(async () => {
  bancos.splice(0).forEach((b) => b.fechar());
  pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
  while (servidores.length) await (servidores.pop() as ServidorFalso).fechar();
});

const portaFalsa = (): PortaSafeStorage => ({
  disponivel: () => true,
  backend: () => null,
  cifrar: (t) => Buffer.from(`enc:${Buffer.from(t).reverse().toString("base64")}`),
  decifrar: (b) => Buffer.from(Buffer.from(b).toString().slice(4), "base64").reverse().toString(),
});

const MODELOS = {
  data: [
    { id: "anthropic/claude-x", name: "Claude X", context_length: 200000, pricing: { prompt: "0.000003", completion: "0.000015" }, supported_parameters: ["tools", "temperature"], architecture: { input_modalities: ["text", "image"] } },
    { id: "meta/llama-gratis:free", name: "Llama", context_length: 8192, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["temperature"] },
    { id: "openrouter/auto", name: "Auto", pricing: { prompt: "-1", completion: "-1" } },
    { id: "", name: "sem id" },
    { id: "anthropic/claude-x", name: "duplicado" },
  ],
};
const RESP_KEY = { data: { label: "k", limit: 10, usage: 9, limit_remaining: 1, is_free_tier: false } };
const json = (r: import("node:http").ServerResponse, corpo: unknown, status = 200): void => {
  r.statusCode = status;
  r.setHeader("content-type", "application/json");
  r.end(JSON.stringify(corpo));
};

async function montar(o: { instaladas?: string[]; roteador?: (caminho: string, auth: string | undefined) => { status?: number; corpo: unknown } } = {}) {
  const banco = abrirBanco(":memory:");
  bancos.push(banco);
  migrar(banco);
  const repos: Repositorios = criarRepositorios(banco);
  const dir = mkdtempSync(join(tmpdir(), "ade-openrouter-"));
  pastas.push(dir);
  const roteador = o.roteador ?? ((c) => (c.startsWith("/api/v1/models") ? { corpo: MODELOS } : c.startsWith("/api/v1/key") ? { corpo: RESP_KEY } : { status: 404, corpo: {} }));
  const servidor = await subirServidorFalso((q, r) => {
    const x = roteador(q.url ?? "", q.headers.authorization);
    json(r, x.corpo, x.status ?? 200);
  });
  servidores.push(servidor);
  const consentimento = criarRegistroConsentimento();
  const rede = criarClienteRede({ consentimento, permitirLoopbackHttp: true });
  const cofre: Cofre = criarCofre({ arquivo: join(dir, "cofre.json"), motor: criarMotorSafeStorage(portaFalsa()) });
  const eventos: Array<[string, unknown]> = [];
  const saldos: string[] = [];
  let relogio = T0;
  const s: ServicoOpenRouter = criarServicoOpenRouter({
    repos,
    cofre: async () => cofre,
    rede: () => rede,
    consentimento,
    destino: { host: servidor.host, porta: servidor.porta },
    instaladas: async () => o.instaladas ?? ["opencode", "aider", "codex", "claude"],
    agora: () => relogio,
    emitir: (t, p) => eventos.push([t, p]),
    aoSaldoAtualizado: (id) => saldos.push(id),
  });
  return { banco, repos, dir, servidor, consentimento, cofre, s, eventos, saldos, avancar: (ms: number) => (relogio += ms), arquivoCofre: () => join(dir, "cofre.json") };
}
const consentir = (s: ServicoOpenRouter) => s.consentir("v1");
const chaveDe = (s: ServicoOpenRouter, rotulo = "or·1") => s.gravarChave({ rotulo, chave: CHAVE });
const lerCofre = (m: { arquivoCofre(): string }): string => readFileSync(m.arquivoCofre(), "utf8");
const dumpBanco = (b: Banco): string => JSON.stringify(["conta", "conta_openrouter", "openrouter_modelo", "config"].map((t) => b.consultar(`SELECT * FROM ${t}`)));

describe("sem consentimento: zero rede (CT-9.27)", () => {
  it("instalação nova: estado sem rede; testar/modelos/saldo recusados; nenhuma conexão aberta", async () => {
    const m = await montar();
    const est = await m.s.estado();
    expect(est).toMatchObject({ habilitado: false, consentimento_em: null, contas: [], proxy: { ativo: false } });
    await chaveDe(m.s); // guardar a chave é local: não abre socket
    expect(await m.s.testar({})).toMatchObject({ ok: false, motivo: "sem_consentimento" });
    expect(await m.s.testar({ chave: CHAVE })).toMatchObject({ ok: false, motivo: "sem_consentimento" });
    await expect(m.s.atualizarModelos()).rejects.toMatchObject({ codigo: "sem_consentimento" });
    await expect(m.s.atualizarSaldo()).rejects.toMatchObject({ codigo: "sem_consentimento" });
    await expect(m.s.consultarSaldoPeriodico((await m.s.estado()).contas[0]!.conta_id)).resolves.toBeUndefined();
    expect(m.servidor.conexoes()).toBe(0);
  });

  it("consentir libera; revogar fecha de novo, mantendo contas e modelos", async () => {
    const m = await montar();
    await consentir(m.s);
    const c = await chaveDe(m.s);
    await m.s.atualizarModelos(c.conta_id);
    expect(m.servidor.conexoes()).toBeGreaterThan(0);
    const antes = m.servidor.requisicoes.length;
    const e = await m.s.revogar();
    expect(e).toMatchObject({ habilitado: false, consentimento_em: null });
    expect(e.contas).toHaveLength(1);
    expect(e.modelos.total).toBe(3);
    await expect(m.s.atualizarModelos()).rejects.toMatchObject({ codigo: "sem_consentimento" });
    expect(m.servidor.requisicoes.length).toBe(antes);
    expect(m.consentimento.hostPermitido(m.servidor.host)).toBe(false);
  });
});

describe("chave só no cofre (CT-9.30)", () => {
  it("gravar: entrada sensível no cofre cifrado, só ultimos4 no banco/retorno; nada da chave fora do cofre.json (e dele só cifrada)", async () => {
    const m = await montar();
    const c = await chaveDe(m.s);
    expect(c).toMatchObject({ rotulo: "or·1", ultimos4: CHAVE.slice(-4), tipo: "desconhecido", limite_usd: null, saldo_usd: null });
    expect(JSON.stringify(c)).not.toContain(CHAVE);
    expect(JSON.stringify(await m.s.estado())).not.toContain(CHAVE);
    expect(dumpBanco(m.banco)).not.toContain(CHAVE);
    expect(lerCofre(m)).not.toContain(CHAVE); // cifrada em repouso
    const entradas = await m.cofre.listar();
    expect(entradas).toHaveLength(1);
    expect(entradas[0]).toMatchObject({ nome: nomeCofreDaConta(c.conta_id), sensivel: true, escopo: "global" });
    expect(entradas[0]!.nome).toMatch(/^OPENROUTER_KEY_[A-Z0-9]{16}$/);
    expect(await m.cofre.obter(entradas[0]!.nome)).toBe(CHAVE);
    expect(m.repos.conta.obter(c.conta_id)).toMatchObject({ provedor: "openrouter", config_dir_ref: null });
  });

  it("regravar na mesma conta troca a chave; apagar remove a entrada do cofre e a conta", async () => {
    const m = await montar();
    const c = await chaveDe(m.s);
    await m.s.gravarChave({ conta_id: c.conta_id, rotulo: "or·1", chave: "sk-or-v1-OUTRA-chave-000011112222" });
    expect(await m.cofre.obter(nomeCofreDaConta(c.conta_id))).toBe("sk-or-v1-OUTRA-chave-000011112222");
    expect((await m.s.estado()).contas[0]!.ultimos4).toBe("2222");
    expect(await m.s.apagarChave(c.conta_id)).toBe(true);
    expect(await m.cofre.listar()).toHaveLength(0);
    expect((await m.s.estado()).contas).toHaveLength(0);
    expect(m.repos.conta.obter(c.conta_id)).toBeUndefined();
    expect(await m.s.apagarChave(c.conta_id)).toBe(false);
  });

  it("chave curta demais é recusada sem eco do valor", async () => {
    const m = await montar();
    const erro = await m.s.gravarChave({ rotulo: "x", chave: "curta" }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(OpenRouterErro);
    expect(String((erro as Error).message)).not.toContain("curta");
  });
});

describe("testar chave (clique)", () => {
  it("com conta_id usa a chave do cofre, mede limite/saldo e grava; o upstream recebe a chave real", async () => {
    const m = await montar();
    await consentir(m.s);
    const c = await chaveDe(m.s);
    const r = await m.s.testar({ conta_id: c.conta_id });
    expect(r).toMatchObject({ ok: true, tipo: "pago", limite_usd: 10, saldo_usd: 1 });
    expect(r.latencia_ms).toBeGreaterThanOrEqual(0);
    expect(m.servidor.requisicoes[0]!.cabecalhos["authorization"]).toBe(`Bearer ${CHAVE}`);
    expect(m.servidor.requisicoes[0]!.caminho).toBe("/api/v1/key");
    expect((await m.s.estado()).contas[0]).toMatchObject({ tipo: "pago", limite_usd: 10, saldo_usd: 1 });
    expect(m.saldos).toEqual([c.conta_id]);
  });

  it("testar SEM salvar: cofre.json e banco ficam byte a byte iguais; a chave não aparece no retorno", async () => {
    const m = await montar();
    await consentir(m.s);
    await chaveDe(m.s);
    const cofreAntes = createHash("sha256").update(lerCofre(m)).digest("hex");
    const bancoAntes = dumpBanco(m.banco);
    const r = await m.s.testar({ chave: "sk-or-v1-OUTRA-sem-salvar-99998888" });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain("OUTRA");
    expect(m.servidor.requisicoes[0]!.cabecalhos["authorization"]).toBe("Bearer sk-or-v1-OUTRA-sem-salvar-99998888");
    expect(createHash("sha256").update(lerCofre(m)).digest("hex")).toBe(cofreAntes);
    expect(dumpBanco(m.banco)).toBe(bancoAntes);
  });

  it("chave recusada (401) e upstream fora do ar viram motivo nominal, sem eco da chave", async () => {
    const m401 = await montar({ roteador: () => ({ status: 401, corpo: { error: { message: `chave ${CHAVE} inválida` } } }) });
    await consentir(m401.s);
    const r = await m401.s.testar({ chave: CHAVE });
    expect(r).toMatchObject({ ok: false, motivo: "chave_invalida" });
    expect(JSON.stringify(r)).not.toContain(CHAVE);
    const m500 = await montar({ roteador: () => ({ status: 503, corpo: {} }) });
    await consentir(m500.s);
    expect(await m500.s.testar({ chave: CHAVE })).toMatchObject({ ok: false, motivo: "indisponivel" });
  });

  it("sem limite informado a chave ainda mostra saldo pela rota de créditos", async () => {
    const m = await montar({
      roteador: (c) => (c.startsWith("/api/v1/key") ? { corpo: { data: { limit: null, usage: 3.5, is_free_tier: false } } } : c.startsWith("/api/v1/credits") ? { corpo: { data: { total_credits: 20, total_usage: 3.5 } } } : { status: 404, corpo: {} }),
    });
    await consentir(m.s);
    const r = await m.s.testar({ chave: CHAVE });
    expect(r).toMatchObject({ ok: true, limite_usd: null, saldo_usd: 16.5 });
  });
});

describe("modelos: só por clique, lotes, preço da API (CT-9.28; P-111)", () => {
  it("atualiza: preço por Mtok, tools, nulos sem preço; novos/removidos; evento; preserva habilitação do dono", async () => {
    const m = await montar();
    await consentir(m.s);
    const c = await chaveDe(m.s);
    const r1 = await m.s.atualizarModelos(c.conta_id);
    expect(r1).toEqual({ total: 3, novos: 3, removidos: 0 });
    const pag = m.s.listarModelos({});
    const x = pag.itens.find((i) => i.id === "anthropic/claude-x")!;
    expect(x).toMatchObject({ nome: "Claude X", contexto: 200000, suporta_tools: true, preco_entrada_por_mtok: 3, preco_saida_por_mtok: 15, habilitado: false, faixa: null });
    expect(pag.itens.find((i) => i.id === "meta/llama-gratis:free")).toMatchObject({ suporta_tools: false, preco_entrada_por_mtok: 0 });
    expect(pag.itens.find((i) => i.id === "openrouter/auto")).toMatchObject({ preco_entrada_por_mtok: null, preco_saida_por_mtok: null, suporta_tools: null });
    expect(m.eventos).toContainEqual(["openrouter.models_updated", { total: 3, novos: 3, removidos: 0 }]);
    expect(m.servidor.requisicoes[0]!.cabecalhos["authorization"]).toBe(`Bearer ${CHAVE}`);
    // o dono habilita; a próxima atualização preserva
    const g = m.s.gravarModelo({ id: "anthropic/claude-x", habilitado: true, faixa: "topo", tipos_permitidos: ["implementar"], ordem: 1 });
    expect(g).toMatchObject({ habilitado: true, faixa: "topo", tipos_permitidos: ["implementar"] });
    const r2 = await m.s.atualizarModelos(c.conta_id);
    expect(r2).toEqual({ total: 3, novos: 0, removidos: 0 });
    expect(m.s.listarModelos({ so_habilitados: true }).itens.map((i) => i.id)).toEqual(["anthropic/claude-x"]);
    expect(m.s.listarModelos({ busca: "LLAMA" }).total).toBe(1);
  });

  it("sem chave guardada: erro nominal e nenhuma conexão; nunca no boot (estado/iniciar não tocam a rede)", async () => {
    const m = await montar();
    await consentir(m.s);
    m.s.iniciar();
    await m.s.estado();
    await expect(m.s.atualizarModelos()).rejects.toMatchObject({ codigo: "sem_chave" });
    expect(m.servidor.conexoes()).toBe(0);
  });

  it("resposta inesperada vira resposta_invalida", async () => {
    const m = await montar({ roteador: () => ({ corpo: { data: "nada" } }) });
    await consentir(m.s);
    const c = await chaveDe(m.s);
    await expect(m.s.atualizarModelos(c.conta_id)).rejects.toMatchObject({ codigo: "resposta_invalida" });
  });

  it("traduz modelo da API; descarta item sem id; preço negativo vira null", () => {
    expect(traduzirModeloDaApi({ name: "x" })).toBeNull();
    expect(traduzirModeloDaApi({ id: "a/b", pricing: { prompt: "-1", completion: "0.000001" } })).toMatchObject({ preco_entrada_por_mtok: null, preco_saida_por_mtok: 1, nome: "a/b" });
    expect(precoPorMtok("0.0000025")).toBe(2.5);
    expect(precoPorMtok(undefined)).toBeNull();
  });

  it("faixa sugerida por preço de saída; sem preço = sem sugestão", () => {
    expect(sugerirFaixa({ preco_saida_por_mtok: 75 })).toBe("topo");
    expect(sugerirFaixa({ preco_saida_por_mtok: 15 })).toBe("alto");
    expect(sugerirFaixa({ preco_saida_por_mtok: 3 })).toBe("medio");
    expect(sugerirFaixa({ preco_saida_por_mtok: 0.4 })).toBe("rapido");
    expect(sugerirFaixa({ preco_saida_por_mtok: null })).toBeNull();
  });
});

describe("saldo (CT-9.34; P-104)", () => {
  it("clique: ≤ 1 por conta a cada 5 s; recarrega a fonte de limite", async () => {
    const m = await montar();
    await consentir(m.s);
    const c = await chaveDe(m.s);
    await m.s.atualizarSaldo(c.conta_id);
    const n = m.servidor.requisicoes.length;
    await m.s.atualizarSaldo(c.conta_id); // dentro dos 5 s: sem rede
    expect(m.servidor.requisicoes.length).toBe(n);
    m.avancar(6_000);
    await m.s.atualizarSaldo(c.conta_id);
    expect(m.servidor.requisicoes.length).toBeGreaterThan(n);
    expect(m.saldos.length).toBe(2);
  });

  it("adaptador de limite: US$ 10 de limite e US$ 9 usados ⇒ 90%; sem limite ⇒ used_pct null (nunca 0)", async () => {
    const m = await montar();
    const c = await chaveDe(m.s);
    const conta = { id: c.conta_id, provedor: "openrouter", rotulo: "or·1", config_dir: null, habilitada: true };
    let vivo = false;
    const ad = criarAdaptadorOpenRouterSaldo({
      saldoDe: (id) => m.repos.contaOpenrouter.obter(id),
      consentido: () => m.s.consentido(),
      paneVivo: () => vivo,
      consultar: async (id) => m.s.consultarSaldoPeriodico(id),
    });
    expect(ad).toMatchObject({ id: "openrouter", fonte: "openrouter_api", rede: true, intervalo_min_s: 300, provedores: ["openrouter"] });
    const ctx = { sinal: new AbortController().signal, agora: T0 };
    expect(await ad.ler(conta, ctx)).toBeNull(); // nunca consultada
    m.repos.contaOpenrouter.atualizarSaldo(c.conta_id, { tipo: "pago", limite_usd: 10, usado_usd: 9, saldo_usd: 1, saldo_em: "2026-10-01T11:58:00.000Z" });
    const s = (await ad.ler(conta, ctx)) as import("../../compartilhado/limites").LimitSnapshot;
    expect(s).toMatchObject({ fonte: "openrouter_api", confianca: "medido", credit: { limit_usd: 10, used_usd: 9, remaining_usd: 1 } });
    const u = derivarUso(s, T0);
    expect(u.windows[0]).toMatchObject({ kind: "credit", used_pct: 90, resets_at: null });
    expect(u.bottleneck).toBe("credit");
    m.repos.contaOpenrouter.atualizarSaldo(c.conta_id, { tipo: "pago", limite_usd: null, usado_usd: 3, saldo_usd: 7.1, saldo_em: "2026-10-01T11:58:00.000Z" });
    const sem = derivarUso((await ad.ler(conta, ctx)) as import("../../compartilhado/limites").LimitSnapshot, T0);
    expect(sem.windows[0]!.used_pct).toBeNull();
    expect(sem.slack_pct).toBeNull();
    expect(sem.credit?.remaining_usd).toBe(7.1);
    // sem Pane vivo a rede nunca é tocada, nem por `aplicavel`
    expect(ad.aplicavel(conta)).toBe(false);
    vivo = true;
    expect(ad.aplicavel(conta)).toBe(false); // sem consentimento
    expect(m.servidor.conexoes()).toBe(0);
    await consentir(m.s);
    expect(ad.aplicavel(conta)).toBe(true);
    expect(ad.aplicavel({ ...conta, provedor: "claude" })).toBe(false);
  });

  it("consulta periódica (token permanente) só com consentimento e `atualizar_saldo` ligado", async () => {
    const m = await montar();
    const c = await chaveDe(m.s);
    await consentir(m.s);
    await m.s.consultarSaldoPeriodico(c.conta_id);
    expect(m.servidor.requisicoes.length).toBeGreaterThan(0);
    expect(m.repos.contaOpenrouter.obter(c.conta_id)).toMatchObject({ limite_usd: 10, usado_usd: 9 });
    m.repos.config.definir("openrouter", { habilitado: true, consentimento_em: "2026-10-01T00:00:00.000Z", clis_preferidas: ["opencode"], atualizar_saldo: false });
    const n = m.servidor.requisicoes.length;
    await m.s.consultarSaldoPeriodico(c.conta_id);
    expect(m.servidor.requisicoes.length).toBe(n);
  });
});

describe("lançamento do Pane: adaptadores e preparo (CT-9.32, CT-9.35)", () => {
  async function comModelo(o: Parameters<typeof montar>[0] = {}) {
    const m = await montar(o);
    await consentir(m.s);
    const c = await chaveDe(m.s);
    await m.s.atualizarModelos(c.conta_id);
    m.s.gravarModelo({ id: "anthropic/claude-x", habilitado: true, faixa: "topo", tipos_permitidos: [], ordem: 1 });
    return { ...m, contaId: c.conta_id };
  }

  it("CLIs utilizáveis: só adaptador verificado e instalado; codex a_verificar e goose desligado ficam de fora; preferência manda", () => {
    expect(ADAPTADORES_CLI.map((a) => [a.cli, a.status])).toEqual([["opencode", "verificado"], ["aider", "verificado"], ["codex", "a_verificar"], ["goose", "desligado"]]);
    expect(clisUtilizaveis(["codex", "goose", "aider", "opencode", "claude"])).toEqual(["opencode", "aider"]);
    expect(clisUtilizaveis(["aider", "opencode"], ["aider"])).toEqual(["aider", "opencode"]);
    expect(clisUtilizaveis(["codex", "goose"])).toEqual([]);
  });

  it("estado lista as CLIs com instalada/status", async () => {
    const m = await montar({ instaladas: ["opencode", "codex"] });
    expect((await m.s.estado()).clis).toEqual([
      { cli: "opencode", instalada: true, status: "verificado" },
      { cli: "aider", instalada: false, status: "verificado" },
      { cli: "codex", instalada: true, status: "a_verificar" },
      { cli: "goose", instalada: false, status: "desligado" },
    ]);
  });

  it("modelo habilitado + CLI compatível: argv só com --model, SEM chave (modo a: o usuário autentica a CLI)", async () => {
    const m = await comModelo();
    const l = await m.s.preparar({ cli: null, modelo: "anthropic/claude-x", conta_id: null, injetar_chave: false });
    expect(l).toMatchObject({ cli: "opencode", modelo: "anthropic/claude-x", modo: "usuario_autentica", argumentos: ["--model", "openrouter/anthropic/claude-x"], ambiente: {} });
    const a = await m.s.preparar({ cli: "aider", modelo: "anthropic/claude-x", conta_id: m.contaId, injetar_chave: false });
    expect(a).toMatchObject({ cli: "aider", argumentos: ["--model", "openrouter/anthropic/claude-x"], ambiente: {} });
    expect(JSON.stringify(l) + JSON.stringify(a)).not.toContain(CHAVE);
  });

  it("injetar_chave (modo b, opt-in): a chave do cofre vai SÓ por variável de ambiente, nunca em argv", async () => {
    const m = await comModelo();
    const l = await m.s.preparar({ cli: "opencode", modelo: "anthropic/claude-x", conta_id: m.contaId, injetar_chave: true });
    expect(l.modo).toBe("cofre_no_env");
    expect(l.ambiente).toEqual({ OPENROUTER_API_KEY: CHAVE });
    expect(l.argumentos.join(" ")).not.toContain(CHAVE);
    expect(l.conta_id).toBe(m.contaId);
  });

  it("recusas nominais: sem consentimento, modelo não habilitado/desconhecido, CLI incompatível", async () => {
    const m = await comModelo();
    await expect(m.s.preparar({ cli: null, modelo: "meta/llama-gratis:free", conta_id: null, injetar_chave: false })).rejects.toMatchObject({ codigo: "modelo_nao_habilitado" });
    await expect(m.s.preparar({ cli: null, modelo: "nao/existe", conta_id: null, injetar_chave: false })).rejects.toMatchObject({ codigo: "modelo_nao_habilitado" });
    await expect(m.s.preparar({ cli: null, modelo: null, conta_id: null, injetar_chave: false })).rejects.toMatchObject({ codigo: "modelo_nao_habilitado" });
    await expect(m.s.preparar({ cli: "codex", modelo: "anthropic/claude-x", conta_id: null, injetar_chave: false })).rejects.toMatchObject({ codigo: "sem_cli_compativel" });
    await expect(m.s.preparar({ cli: "goose", modelo: "anthropic/claude-x", conta_id: null, injetar_chave: false })).rejects.toMatchObject({ codigo: "sem_cli_compativel" });
    await m.s.revogar();
    await expect(m.s.preparar({ cli: null, modelo: "anthropic/claude-x", conta_id: null, injetar_chave: false })).rejects.toMatchObject({ codigo: "sem_consentimento" });
    const semCli = await comModelo({ instaladas: ["claude"] });
    await expect(semCli.s.preparar({ cli: null, modelo: "anthropic/claude-x", conta_id: null, injetar_chave: false })).rejects.toMatchObject({ codigo: "sem_cli_compativel" });
  });

  it("montar é pura: não toca configuração global da CLI (hash idêntico) e não deixa a chave em argv", () => {
    const dir = mkdtempSync(join(tmpdir(), "ade-cfg-cli-"));
    pastas.push(dir);
    const arq = join(dir, "opencode.json");
    writeFileSync(arq, '{"theme":"x"}');
    const antes = createHash("sha256").update(readFileSync(arq)).digest("hex");
    for (const a of ADAPTADORES_CLI) {
      const r = a.montar({ modelo: "anthropic/claude-x", chave: CHAVE });
      expect(r.argumentos.join(" ")).not.toContain(CHAVE);
      expect(r.arquivo_temporario).toBeUndefined();
    }
    expect(createHash("sha256").update(readFileSync(arq)).digest("hex")).toBe(antes);
  });

  it("modo proxy (token do Pane no lugar da chave): aider e opencode apontam para a base URL local", () => {
    const e = { modelo: "anthropic/claude-x", baseUrl: "http://127.0.0.1:5555/p/tok/v1", tokenPane: "tok" };
    expect(adaptadorDaCli("aider")!.montar(e)).toEqual({ argumentos: ["--model", "openai/anthropic/claude-x"], ambiente: { OPENAI_API_BASE: e.baseUrl, OPENAI_API_KEY: "tok" } });
    const o = adaptadorDaCli("opencode")!.montar(e);
    expect(o.argumentos).toEqual(["--model", "openrouter/anthropic/claude-x"]);
    expect(JSON.parse(o.ambiente["OPENCODE_CONFIG_CONTENT"]!)).toEqual({ provider: { openrouter: { options: { baseURL: e.baseUrl, apiKey: "tok" } } } });
  });

  it("resumo para o roteamento: indisponível sem consentimento ou sem modelo habilitado", async () => {
    const m = await montar();
    expect(await m.s.resumo()).toMatchObject({ consentido: false, motivo_indisponivel: "openrouter_not_consented" });
    await consentir(m.s);
    expect(await m.s.resumo()).toMatchObject({ consentido: true, modelos_habilitados: 0, motivo_indisponivel: "model_not_enabled", clis: ["opencode", "aider"] });
    const c = await chaveDe(m.s);
    await m.s.atualizarModelos(c.conta_id);
    m.s.gravarModelo({ id: "anthropic/claude-x", habilitado: true, faixa: "alto", tipos_permitidos: [], ordem: 1 });
    expect(await m.s.resumo()).toMatchObject({ modelos_habilitados: 1, motivo_indisponivel: null, contas: [c.conta_id] });
  });
});

describe("integração com o LimitsService (T-09.26)", () => {
  it("saldo por clique → recarregar a fonte `openrouter` → conta de crédito com 90% (nível quente) no snapshot; sem Pane vivo nenhuma leitura automática de rede", async () => {
    const m = await montar();
    await consentir(m.s);
    const c = await chaveDe(m.s);
    const conta = { id: c.conta_id, provedor: "openrouter", rotulo: "or·1", config_dir: null, habilitada: true };
    const adaptador = criarAdaptadorOpenRouterSaldo({
      saldoDe: (id) => m.repos.contaOpenrouter.obter(id),
      consentido: () => m.s.consentido(),
      paneVivo: () => false,
      consultar: async (id) => m.s.consultarSaldoPeriodico(id),
    });
    const servico = criarLimitsService({ contas: () => [conta], adaptadores: [adaptador], agora: () => T0, foco: () => true, emitir: () => undefined });
    expect(servico.snapshot().contas[0]!.windows).toEqual([]); // nunca lida: "sem dado" (não 0%)
    await servico.atualizar(c.conta_id); // sem Pane vivo `aplicavel` é falso: nada lê, nada vai à rede
    expect(m.servidor.conexoes()).toBe(0);
    await m.s.atualizarSaldo(c.conta_id); // o clique consulta a API (limite 10, usado 9) e grava
    const uso = await servico.recarregarFonte(c.conta_id, "openrouter");
    expect(uso).toMatchObject({ fonte: "openrouter_api", confianca: "medido", bottleneck: "credit", slack_pct: 10 });
    expect(uso.windows[0]).toMatchObject({ kind: "credit", used_pct: 90, resets_at: null });
    expect(uso.credit).toEqual({ limit_usd: 10, used_usd: 9, remaining_usd: 1 });
  });
});
