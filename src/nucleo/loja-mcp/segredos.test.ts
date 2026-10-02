import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NOME_VALIDO } from "../cofre";
import { carregarCatalogo } from "./catalogo";
import { criarSegredosMcp, criarServicoSegredos, nomeCofre, validarValor, variaveisExigidas, variaveisFaltando } from "./segredos";
import { catalogoFalso, cofreDeTeste, limparPastas, novaPasta, SEED } from "../../../tests/fixtures/mcp-loja/apoio-ciclo";

afterEach(limparPastas);
const SEGREDO = "SENTINELA-mcp-segredo-7c1e-nunca-vazar";

describe("nome no cofre", () => {
  it("todas as variáveis do seed viram nome UPPER_SNAKE válido (≤ 64) e único", () => {
    const cat = carregarCatalogo(SEED);
    const nomes: string[] = [];
    for (const x of cat.entradas) for (const v of x.entrada.variaveis) nomes.push(nomeCofre(x.entrada.id, v.nome));
    expect(nomes.length).toBeGreaterThan(50);
    expect(nomes.every((n) => NOME_VALIDO.test(n))).toBe(true);
    expect(new Set(nomes).size).toBe(nomes.length);
  });

  it("nome longo é cortado com sufixo estável e continua distinto entre servidores de mesmo prefixo", () => {
    const longo = "a".repeat(40);
    const a = nomeCofre(`${longo}-um`, "VARIAVEL_MUITO_LONGA_DE_TESTE");
    const b = nomeCofre(`${longo}-dois`, "VARIAVEL_MUITO_LONGA_DE_TESTE");
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a).not.toBe(b);
    expect(nomeCofre(`${longo}-um`, "VARIAVEL_MUITO_LONGA_DE_TESTE")).toBe(a);
    expect(NOME_VALIDO.test(a)).toBe(true);
  });
});

describe("valor da variável", () => {
  it("recusa vazio, > 4 KB e quebra de linha", () => {
    expect(validarValor("")).toBe("valor_vazio");
    expect(validarValor("   ")).toBe("valor_vazio");
    expect(validarValor("x".repeat(4097))).toBe("valor_grande");
    expect(validarValor("a\nb")).toBe("quebra_de_linha");
    expect(validarValor("a\0b")).toBe("quebra_de_linha");
    expect(validarValor("ok")).toBeNull();
    expect(validarValor(42)).toBe("valor_vazio");
  });
});

describe("segredos sobre o cofre real", () => {
  const cat = catalogoFalso();
  const chave = cat.porId.get("falso-chave")!.entrada;
  const publica = cat.porId.get("falso-publica")!.entrada;

  it("grava, diz que está definida, devolve o valor só ao main e separa secreto de público", async () => {
    const dir = novaPasta();
    const cofre = cofreDeTeste(dir);
    const s = criarSegredosMcp(cofre);
    expect(await s.definidas(chave)).toEqual(new Set());
    expect(await s.gravar(chave, "FALSO_API_KEY", SEGREDO)).toEqual({ ok: true, codigo: null });
    expect(await s.gravar(publica, "FALSO_PROJETO", "proj-1")).toEqual({ ok: true, codigo: null });
    expect(await s.definidas(chave)).toEqual(new Set(["FALSO_API_KEY"]));
    expect((await s.valores(chave)).secretos).toEqual({ FALSO_API_KEY: SEGREDO });
    expect(await s.valores(publica)).toEqual({ secretos: {}, publicos: { FALSO_PROJETO: "proj-1" } });
    const meta = JSON.stringify(await cofre.listar());
    expect(meta).not.toContain(SEGREDO);
    const entradas = await cofre.listar();
    expect(entradas.find((e) => e.nome === nomeCofre("falso-chave", "FALSO_API_KEY"))!.sensivel).toBe(true);
    expect(entradas.find((e) => e.nome === nomeCofre("falso-publica", "FALSO_PROJETO"))!.sensivel).toBe(false);
    // o arquivo do cofre não guarda o valor em claro
    expect(readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("")).not.toContain(SEGREDO);
  });

  it("regravar atualiza a mesma entrada (sem duplicar); variável não declarada e valor inválido são recusados", async () => {
    const cofre = cofreDeTeste(novaPasta());
    const s = criarSegredosMcp(cofre);
    await s.gravar(chave, "FALSO_API_KEY", "um");
    await s.gravar(chave, "FALSO_API_KEY", "dois");
    expect((await cofre.listar()).filter((e) => e.nome === nomeCofre("falso-chave", "FALSO_API_KEY"))).toHaveLength(1);
    expect((await s.valores(chave)).secretos["FALSO_API_KEY"]).toBe("dois");
    expect(await s.gravar(chave, "OUTRA", "x")).toEqual({ ok: false, codigo: "variavel_desconhecida" });
    expect(await s.gravar(chave, "FALSO_API_KEY", "a\nb")).toEqual({ ok: false, codigo: "quebra_de_linha" });
    expect(await s.gravar(chave, "FALSO_API_KEY", "")).toEqual({ ok: false, codigo: "valor_vazio" });
  });

  it("apagar e apagarServidor removem só as variáveis daquele servidor", async () => {
    const cofre = cofreDeTeste(novaPasta());
    const s = criarSegredosMcp(cofre);
    await s.gravar(chave, "FALSO_API_KEY", "um");
    await s.gravar(publica, "FALSO_PROJETO", "p");
    expect(await s.apagar(chave, "FALSO_API_KEY")).toBe(true);
    expect(await s.existe(chave, "FALSO_API_KEY")).toBe(false);
    expect(await s.existe(publica, "FALSO_PROJETO")).toBe(true);
    await s.gravar(chave, "FALSO_API_KEY", "um");
    expect(await s.apagarServidor(chave)).toBe(1);
    expect(await s.existe(publica, "FALSO_PROJETO")).toBe(true);
  });

  it("cofre indisponível: grava com código nominal e nada é lido", async () => {
    const dir = novaPasta();
    const { criarCofre, criarMotorSafeStorage } = await import("../cofre");
    const cofre = criarCofre({ arquivo: join(dir, "c.json"), motor: criarMotorSafeStorage({ disponivel: () => false, backend: () => null, cifrar: () => Buffer.alloc(0), decifrar: () => "" }) });
    const s = criarSegredosMcp(cofre);
    expect(await s.gravar(chave, "FALSO_API_KEY", SEGREDO)).toEqual({ ok: false, codigo: "cofre_indisponivel" });
    expect((await s.valores(chave)).secretos).toEqual({});
  });
});

describe("variáveis exigidas", () => {
  const cat = carregarCatalogo(SEED);
  it("inclui as obrigatórias e as citadas por {{SEGREDO:X}} nos args (mesmo opcionais)", () => {
    expect(variaveisExigidas(cat.porId.get("stripe-npm")!.entrada)).toEqual(["STRIPE_SECRET_KEY"]);
    expect(variaveisExigidas(cat.porId.get("redis-mcp")!.entrada)).toContain("REDIS_URL");
    expect(variaveisExigidas(cat.porId.get("context7")!.entrada)).toEqual([]);
    expect(variaveisFaltando(cat.porId.get("sentry-stdio")!.entrada, new Set())).toContain("SENTRY_ACCESS_TOKEN");
    expect(variaveisFaltando(cat.porId.get("sentry-stdio")!.entrada, new Set(["SENTRY_ACCESS_TOKEN"]))).toEqual([]);
  });
});

describe("serviço da rota /loja/segredos", () => {
  const cat = catalogoFalso();
  async function montar(permitidos: Record<string, string[]>, limite = 5, agora = () => 1_000_000) {
    const cofre = cofreDeTeste(novaPasta());
    const segredos = criarSegredosMcp(cofre);
    await segredos.gravar(cat.porId.get("falso-chave")!.entrada, "FALSO_API_KEY", SEGREDO);
    await segredos.gravar(cat.porId.get("falso-publica")!.entrada, "FALSO_PROJETO", "p1");
    return criarServicoSegredos({ segredos, catalogo: cat, permitidosDoToken: (t) => (permitidos[t] ? new Set(permitidos[t]) : null), limitePorMinuto: limite, agora });
  }

  it("200 só com as variáveis declaradas do servidor permitido ao Pane", async () => {
    const svc = await montar({ T1: ["falso-chave", "falso-publica"] });
    expect(await svc.resolver("T1", "falso-chave")).toEqual({ status: 200, env: { FALSO_API_KEY: SEGREDO } });
    expect(await svc.resolver("T1", "falso-publica")).toEqual({ status: 200, env: { FALSO_PROJETO: "p1" } });
  });

  it("401 token inválido; 403 servidor fora da política (sem vazar nada); 400 id malformado; 404 desconhecido", async () => {
    const svc = await montar({ T1: ["falso-publica", "nao-existe"] });
    expect(await svc.resolver("X", "falso-chave")).toEqual({ status: 401, erro: "unauthorized" });
    expect(await svc.resolver("", "falso-chave")).toEqual({ status: 401, erro: "unauthorized" });
    expect(await svc.resolver("T1", "falso-chave")).toEqual({ status: 403, erro: "server_not_allowed" });
    expect(await svc.resolver("T1", "../etc")).toEqual({ status: 400, erro: "bad_request" });
    expect(await svc.resolver("T1", 42)).toEqual({ status: 400, erro: "bad_request" });
    expect(await svc.resolver("T1", "nao-existe")).toEqual({ status: 404, erro: "not_found" });
  });

  it("a 6ª chamada no minuto vira 429; a janela anda; o limite é por Pane", async () => {
    let t = 1_000_000;
    const svc = await montar({ T1: ["falso-publica"], T2: ["falso-publica"] }, 5, () => t);
    for (let i = 0; i < 5; i++) expect((await svc.resolver("T1", "falso-publica")).status).toBe(200);
    expect(await svc.resolver("T1", "falso-publica")).toEqual({ status: 429, erro: "rate_limited" });
    expect((await svc.resolver("T2", "falso-publica")).status).toBe(200);
    t += 61_000;
    expect((await svc.resolver("T1", "falso-publica")).status).toBe(200);
  });

  it("com `comando`, o 200 traz o comando resolvido (token repassado); falha do resolvedor vira 500 sem texto de erro", async () => {
    const cofre = cofreDeTeste(novaPasta("cofre-"));
    const cat = catalogoFalso();
    const segredos = criarSegredosMcp(cofre);
    await segredos.gravar(cat.porId.get("falso-chave")!.entrada, "FALSO_API_KEY", SEGREDO);
    const vistos: string[] = [];
    let falhar = false;
    const svc = criarServicoSegredos({
      segredos, catalogo: cat, permitidosDoToken: (t) => (t === "T" ? new Set(["falso-chave"]) : null),
      comando: (_e, v, token) => { vistos.push(token); if (falhar) throw new Error("/caminho/secreto/na/mensagem"); return { executavel: "/bin/node", args: ["x"], env: { FALSO_API_KEY: v.secretos["FALSO_API_KEY"]! }, cwd: null }; },
    });
    expect(await svc.resolver("T", "falso-chave")).toEqual({ status: 200, env: { FALSO_API_KEY: SEGREDO }, comando: { executavel: "/bin/node", args: ["x"], env: { FALSO_API_KEY: SEGREDO }, cwd: null } });
    expect(vistos).toEqual(["T"]);
    falhar = true;
    const r = await svc.resolver("T", "falso-chave");
    expect(r).toEqual({ status: 500, erro: "command_unavailable" });
    expect(JSON.stringify(r)).not.toContain("caminho");
  });
});
