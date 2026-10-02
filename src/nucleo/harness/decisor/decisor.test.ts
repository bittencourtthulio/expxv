import { afterEach, describe, expect, it } from "vitest";
import type { ConfigDecisor, DecisaoEntrada, ModoDecisor } from "../../../compartilhado/harness";
import { subirJevFalso, type CenarioJev, type ServidorJev } from "../../../../tests/fixtures/rede/servidor-jev";
import { criarClienteRede, criarRegistroConsentimento, type ClienteRede, type PedidoRede, type RegistroConsentimento } from "../../rede";
import { criarBreaker } from "./breaker";
import { criarDecisor, consentimentoValido, destinoDoDecisor, DecisorErro, exigirConsentimentoDecisor, type Decisor, type PedidoDecisao } from "./cliente";
import { decidirPorRegras } from "./regras";

const CHAVE = "SENTINELA-decisor-77c1d9aa-chave-do-jev";
const servidores: ServidorJev[] = [];
afterEach(async () => {
  while (servidores.length) await (servidores.pop() as ServidorJev).fechar();
});

const OPCOES = [
  { id: "bug", description: "defeito em algo existente" },
  { id: "feature", description: "funcionalidade nova" },
  { id: "duvida", description: "pergunta" },
];

interface Amb {
  jev: ServidorJev;
  decisor: Decisor;
  consentimento: RegistroConsentimento;
  gravadas: DecisaoEntrada[];
  avisos: { pausas: Array<{ ate: string; motivo: string }>; alertas: number };
  config: ConfigDecisor;
  relogio: { t: number };
  chavesLidas: number;
  cfg(extra: Partial<ConfigDecisor>): void;
  chamadasRede: PedidoRede[];
}

/** envolve o cliente real: `openrouter.ai` é desviado para o servidor falso local (nunca rede real), registrando o host pedido. */
function comDesvio(real: ClienteRede, consentimento: RegistroConsentimento, porta: number, vistos: PedidoRede[]): ClienteRede {
  return {
    stream: real.stream.bind(real),
    requisitar: (p) => {
      vistos.push(p);
      if (p.host !== "openrouter.ai") return real.requisitar(p);
      if (!consentimento.valido(p.tokenDeConsentimento, "openrouter.ai")) return real.requisitar({ ...p, host: "openrouter.ai" }); // erro nominal
      return real.requisitar({ ...p, host: "127.0.0.1", porta, tokenDeConsentimento: consentimento.conceder("127.0.0.1") });
    },
  };
}

async function montar(modo: ModoDecisor = "jev_direto", cenario: CenarioJev = "ok", escolha: string | null = "feature", extra: Partial<ConfigDecisor> = {}, opc: { precoModelo?: boolean; obterChave?: () => Promise<string> } = {}): Promise<Amb> {
  const jev = await subirJevFalso(cenario, escolha);
  servidores.push(jev);
  const consentimento = criarRegistroConsentimento();
  consentimento.permitirHost("127.0.0.1");
  consentimento.permitirHost("openrouter.ai");
  const real = criarClienteRede({ consentimento, permitirLoopbackHttp: true });
  const chamadasRede: PedidoRede[] = [];
  const relogio = { t: 1_000_000 };
  const direto = modo !== "jev_openrouter";
  let config: ConfigDecisor = {
    habilitado: true,
    modo,
    formato: modo === "jev_direto" ? "probs_json" : "openai_chat",
    endpoint: direto ? `https://127.0.0.1:${jev.porta}/v1/decidir` : null,
    cabecalho_chave: modo === "jev_direto" ? "x-api-key" : "Authorization",
    prefixo_chave: modo === "jev_direto" ? null : "Bearer ",
    modelo: direto && modo === "jev_direto" ? null : "vendor/modelo-falso",
    conta_openrouter_id: modo === "jev_openrouter" ? "cta_01HAAAAAAAAAAAAAAAAAAAAAAA" : null,
    chave_ref: "JEV_KEY",
    usar_para: { task_type: true, modelo_esforco: true, intencao: true },
    confianca_minima: 0.5,
    timeout_ms: 1000,
    custo_por_decisao_usd: null,
    alerta_diario: 1000,
    consentimento: { host: direto ? "127.0.0.1" : "openrouter.ai", modo, em: "2026-10-01T00:00:00.000Z" },
    ...extra,
  };
  const gravadas: DecisaoEntrada[] = [];
  const avisos = { pausas: [] as Array<{ ate: string; motivo: string }>, alertas: 0 };
  const amb = { jev, consentimento, gravadas, avisos, relogio, chavesLidas: 0, chamadasRede } as unknown as Amb;
  const decisor = criarDecisor({
    config: () => config,
    rede: comDesvio(real, consentimento, jev.porta, chamadasRede),
    obterChave: async () => {
      amb.chavesLidas++;
      return opc.obterChave ? opc.obterChave() : CHAVE;
    },
    tokenDeConsentimento: (host) => consentimento.conceder(host, { permanente: true }),
    breaker: criarBreaker({ agora: () => relogio.t }),
    agora: () => relogio.t,
    ...(opc.precoModelo ? { precoModelo: () => ({ entrada_por_mtok: 1, saida_por_mtok: 2 }) } : {}),
    gravarDecisao: (d) => {
      gravadas.push(d);
      return { id: `dec_${gravadas.length}` };
    },
    aoPausar: (i) => avisos.pausas.push(i),
    aoAlertar: () => avisos.alertas++,
  });
  Object.assign(amb, { decisor, get config() { return config; }, cfg: (e: Partial<ConfigDecisor>) => { config = { ...config, ...e }; } });
  return amb;
}

const pedido = (texto = "o botão salvar não funciona, corrija", extra: Partial<PedidoDecisao> = {}): PedidoDecisao => ({
  proposito: "intencao",
  usar_para: "intencao",
  kind: "intencao",
  texto,
  opcoes: OPCOES,
  regra: decidirPorRegras(texto, OPCOES),
  ...extra,
});

describe("decisor desligado, sem consentimento e instalação nova", () => {
  it("padrão (desligado, consentimento null): regras, ZERO chamadas de rede, ZERO leitura de chave", async () => {
    const a = await montar("jev_direto", "ok", "feature", { habilitado: false, consentimento: null });
    const r = await a.decisor.decidir(pedido());
    expect(r.fonte).toBe("regra");
    expect(a.jev.conexoes()).toBe(0);
    expect(a.chamadasRede).toHaveLength(0);
    expect(a.chavesLidas).toBe(0);
    expect(a.decisor.estado()).toMatchObject({ habilitado: false, breaker_aberto: false, consultas_hoje: 0 });
  });

  it("habilitado sem consentimento válido: regras, sem rede; gravar habilitado sem consentimento é erro", async () => {
    const a = await montar("jev_direto", "ok", "feature", { consentimento: null });
    expect((await a.decisor.decidir(pedido())).motivo_fallback).toBe("sem_consentimento");
    a.cfg({ consentimento: { host: "outro.exemplo", modo: "jev_direto", em: "x" } });
    expect((await a.decisor.decidir(pedido())).fonte).toBe("regra");
    a.cfg({ consentimento: { host: "127.0.0.1", modo: "openai_compat", em: "x" } });
    expect((await a.decisor.decidir(pedido())).fonte).toBe("regra");
    expect(a.jev.conexoes()).toBe(0);
    expect(() => exigirConsentimentoDecisor({ habilitado: true, modo: "jev_direto", endpoint: "https://api.exemplo.com/x", consentimento: null })).toThrow(DecisorErro);
    expect(() => exigirConsentimentoDecisor({ habilitado: true, modo: "jev_direto", endpoint: "https://api.exemplo.com/x", consentimento: { host: "api.exemplo.com", modo: "jev_direto", em: "x" } })).not.toThrow();
    expect(() => exigirConsentimentoDecisor({ habilitado: false, modo: "jev_direto", endpoint: null, consentimento: null })).not.toThrow();
    expect(() => exigirConsentimentoDecisor({ habilitado: true, modo: "jev_openrouter", endpoint: null, consentimento: { host: "openrouter.ai", modo: "jev_openrouter", em: "x" } })).not.toThrow();
    await expect(a.decisor.ask({ kind: "k", question: "q", options: OPCOES })).rejects.toMatchObject({ motivo: "sem_consentimento" });
  });

  it("usar_para desligado para o propósito: regras, sem rede", async () => {
    const a = await montar("jev_direto", "ok", "feature", { usar_para: { task_type: true, modelo_esforco: true, intencao: false } });
    expect((await a.decisor.decidir(pedido())).fonte).toBe("regra");
    expect(a.jev.conexoes()).toBe(0);
  });

  it("destino: endpoint https obrigatório; modo OpenRouter fixa o host", () => {
    const base = { modo: "jev_direto", endpoint: "http://x.com/a", consentimento: null } as unknown as ConfigDecisor;
    expect(destinoDoDecisor(base)).toBeNull();
    expect(destinoDoDecisor({ ...base, endpoint: "https://u:p@x.com/a" })).toBeNull();
    expect(destinoDoDecisor({ ...base, endpoint: "https://Api.Exemplo.com:8443/v1/d?x=1" })).toEqual({ host: "api.exemplo.com", caminho: "/v1/d?x=1", porta: 8443 });
    expect(destinoDoDecisor({ ...base, modo: "jev_openrouter", endpoint: null })).toEqual({ host: "openrouter.ai", caminho: "/api/v1/chat/completions" });
    expect(consentimentoValido({ ...base, endpoint: "https://x.com/a", consentimento: { host: "X.com", modo: "jev_direto", em: "" } })).toBe(true);
  });
});

describe("os 3 modos contra o JEV falso", () => {
  it("jev_direto (probs_json): classifica entre opções fechadas; cabeçalho configurável; só o resumo redigido sai; Decisão sem chave", async () => {
    const a = await montar("jev_direto", "ok", "feature");
    const texto = `corrija o login do cliente joao@exemplo.com em /Users/joao/projeto/app.ts token sk-or-v1-abcdef1234567890abcdef`;
    const r = await a.decisor.decidir(pedido(texto));
    expect(r.fonte).toBe("decisor");
    expect(r.escolhida).toBe("feature");
    expect(r.confianca).toBeCloseTo(0.8, 5);
    const visto = a.jev.requisicoes[0];
    expect(visto?.caminho).toBe("/v1/decidir");
    expect(visto?.cabecalhos["x-api-key"]).toBe(CHAVE);
    const corpo = JSON.parse(visto?.corpo ?? "{}");
    expect(Object.keys(corpo).sort()).toEqual(["kind", "options", "purpose", "question"]);
    expect(corpo.options.map((o: { id: string }) => o.id)).toEqual(["bug", "feature", "duvida"]);
    expect(visto?.corpo).not.toMatch(/joao@|\/Users\/|sk-or-/);
    const d = a.gravadas[0] as DecisaoEntrada;
    expect(d.fonte).toBe("decisor");
    expect(d.proposito).toBe("intencao");
    expect(d.decisor).toEqual({ modo: "jev_direto", host: "127.0.0.1", modelo: null });
    expect((d.resumo_enviado ?? "").length).toBeLessThanOrEqual(500);
    expect(d.resumo_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(d.escolha_regra).toBe("bug");
    expect(d.divergiu).toBe(true);
    expect(JSON.stringify(a.gravadas)).not.toContain(CHAVE);
    expect(JSON.stringify(r)).not.toContain(CHAVE);
  });

  it("jev_openrouter (openai_chat): host openrouter.ai, modelo configurável, chave no cabeçalho, JSON em bloco de código aceito", async () => {
    const a = await montar("jev_openrouter", "ok", "duvida");
    const r = await a.decisor.decidir(pedido("o que significa esse erro?"));
    expect(r).toMatchObject({ fonte: "decisor", escolhida: "duvida" });
    expect(a.chamadasRede[0]).toMatchObject({ host: "openrouter.ai", caminho: "/api/v1/chat/completions", metodo: "POST" });
    const visto = a.jev.requisicoes[0];
    expect(visto?.cabecalhos.authorization).toBe(`Bearer ${CHAVE}`);
    const corpo = JSON.parse(visto?.corpo ?? "{}");
    expect(corpo.model).toBe("vendor/modelo-falso");
    expect(corpo.temperature).toBe(0);
    expect(corpo.messages[0].role).toBe("system");
    expect(a.gravadas[0]?.decisor).toEqual({ modo: "jev_openrouter", host: "openrouter.ai", modelo: "vendor/modelo-falso" });
  });

  it("openai_compat: endpoint genérico com nome de cabeçalho e prefixo configuráveis", async () => {
    const a = await montar("openai_compat", "ok", "bug", { endpoint: null, cabecalho_chave: "api-key", prefixo_chave: "Token " });
    a.cfg({ endpoint: `https://127.0.0.1:${a.jev.porta}/v1/chat/completions` });
    const r = await a.decisor.decidir(pedido());
    expect(r.fonte).toBe("decisor");
    expect(a.jev.requisicoes[0]?.cabecalhos["api-key"]).toBe(`Token ${CHAVE}`);
    expect(a.jev.requisicoes[0]?.caminho).toBe("/v1/chat/completions");
  });

  it("custo por decisão: resposta → tabela → informado → desconhecido (nunca 0 por omissão)", async () => {
    const a = await montar("jev_direto", "ok_com_custo");
    expect(await a.decisor.decidir(pedido())).toMatchObject({ custo_usd: 0.00042, custo_origem: "resposta" });
    const t = await montar("jev_openrouter", "ok", "bug", {}, { precoModelo: true });
    expect(await t.decisor.decidir(pedido())).toMatchObject({ custo_origem: "tabela", custo_usd: (1000 * 1 + 20 * 2) / 1_000_000 });
    const i = await montar("jev_direto", "ok", "bug", { custo_por_decisao_usd: 0.01 });
    expect(await i.decisor.decidir(pedido())).toMatchObject({ custo_origem: "informado", custo_usd: 0.01 });
    const d = await montar("jev_direto", "ok", "bug");
    const r = await d.decisor.decidir(pedido());
    expect(r.custo_usd).toBeNull();
    expect(r.custo_origem).toBe("desconhecido");
    expect(d.gravadas[0]?.custo_usd).toBeNull();
  });

  it("confiança abaixo do mínimo: usa a regra, fonte fallback, divergência registrada", async () => {
    const a = await montar("jev_direto", "ok", "feature", { confianca_minima: 0.9 });
    const r = await a.decisor.decidir(pedido());
    expect(r).toMatchObject({ fonte: "fallback", escolhida: "bug", motivo_fallback: "confianca_baixa" });
    expect(a.gravadas[0]).toMatchObject({ fonte: "fallback", divergiu: true, escolha_regra: "bug" });
  });

  it("alerta diário (não bloqueia) e contador zera no dia seguinte", async () => {
    const a = await montar("jev_direto", "ok", "bug", { alerta_diario: 2 });
    for (let i = 0; i < 3; i++) expect((await a.decisor.decidir(pedido())).fonte).toBe("decisor");
    expect(a.avisos.alertas).toBe(1);
    expect(a.decisor.estado().consultas_hoje).toBe(3);
    a.relogio.t += 24 * 3600_000;
    await a.decisor.decidir(pedido());
    expect(a.decisor.estado().consultas_hoje).toBe(1);
  });
});

describe("falhas viram fallback determinístico (sem erro ao usuário) + circuit breaker", () => {
  it.each([["402"], ["429"], ["500"]] as const)("HTTP %s: regra, breaker de 5 min, nenhuma nova chamada enquanto aberto, fecha depois", async (cenario) => {
    const a = await montar("jev_direto", cenario);
    const r = await a.decisor.decidir(pedido());
    expect(r).toMatchObject({ fonte: "fallback", escolhida: "bug" });
    expect(a.avisos.pausas).toHaveLength(1);
    expect(new Date(a.avisos.pausas[0]?.ate ?? "").getTime()).toBe(a.relogio.t + 5 * 60_000);
    expect(a.decisor.estado().breaker_aberto).toBe(true);
    const chamadas = a.jev.chamadas();
    expect((await a.decisor.decidir(pedido())).motivo_fallback).toBe("breaker_aberto");
    expect(a.jev.chamadas()).toBe(chamadas);
    a.relogio.t += 5 * 60_000 + 1;
    a.jev.definir("ok", "feature");
    expect((await a.decisor.decidir(pedido())).fonte).toBe("decisor");
    expect(a.decisor.estado().breaker_aberto).toBe(false);
  });

  it("timeout: regra dentro do tempo e breaker aberto", async () => {
    const a = await montar("jev_direto", "timeout", null, { timeout_ms: 200 });
    const t0 = performance.now();
    const r = await a.decisor.decidir(pedido());
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(r).toMatchObject({ fonte: "fallback", motivo_fallback: "timeout" });
    expect(a.decisor.estado().breaker_aberto).toBe(true);
  });

  it("JSON lixo: 1 retry; repetido abre o breaker; lixo uma vez só é recuperado pelo retry", async () => {
    const a = await montar("jev_direto", "lixo");
    expect((await a.decisor.decidir(pedido())).fonte).toBe("fallback");
    expect(a.jev.chamadas()).toBe(2); // tentativa + 1 retry
    expect(a.decisor.estado().breaker_aberto).toBe(false);
    await a.decisor.decidir(pedido());
    expect(a.decisor.estado().breaker_aberto).toBe(true);
    const b = await montar("jev_direto", "lixo_uma_vez", "feature");
    expect((await b.decisor.decidir(pedido())).fonte).toBe("decisor");
    expect(b.jev.chamadas()).toBe(2);
  });

  it.each([["inconsistente"], ["inventada"], ["fora_do_esquema"]] as const)("resposta %s é descartada (sem retry): regra vence", async (cenario) => {
    const a = await montar("jev_direto", cenario);
    const r = await a.decisor.decidir(pedido());
    expect(r).toMatchObject({ fonte: "fallback", escolhida: "bug" });
    expect(["bug", "feature", "duvida"]).toContain(r.escolhida);
    expect(a.jev.chamadas()).toBe(1);
  });

  it("opção inventada também é descartada no formato openai_chat", async () => {
    const a = await montar("jev_openrouter", "inventada");
    const r = await a.decisor.decidir(pedido());
    expect(r.fonte).toBe("fallback");
    expect(OPCOES.map((o) => o.id)).toContain(r.escolhida);
  });

  it("chave ausente/cofre bloqueado: regra, sem nenhuma chamada de rede, sem repassar a mensagem do erro", async () => {
    const a = await montar("jev_direto", "ok", "feature", {}, { obterChave: () => Promise.reject(new Error(`cofre trancado ${CHAVE}`)) });
    const r = await a.decisor.decidir(pedido());
    expect(r).toMatchObject({ fonte: "fallback", motivo_fallback: "chave_ausente" });
    expect(a.jev.conexoes()).toBe(0);
    expect(JSON.stringify([r, a.gravadas])).not.toContain(CHAVE);
  });
});

describe("testar (botão)", () => {
  it("com chave digitada usa o valor uma vez, sem ler o cofre e sem tocar o breaker", async () => {
    const a = await montar("jev_direto", "ok", "sim");
    const token = a.consentimento.conceder("127.0.0.1");
    const r = await a.decisor.testar({ chave: "chave-digitada-no-teste-1", token });
    expect(r.ok).toBe(true);
    expect(a.chavesLidas).toBe(0);
    expect(a.jev.requisicoes[0]?.cabecalhos["x-api-key"]).toBe("chave-digitada-no-teste-1");
    expect(a.gravadas).toHaveLength(0);
    a.jev.definir("402");
    const ruim = await a.decisor.testar({ chave: "chave-digitada-no-teste-1", token: a.consentimento.conceder("127.0.0.1") });
    expect(ruim).toEqual({ ok: false, latencia_ms: null, motivo: "http_402" });
    expect(a.decisor.estado().breaker_aberto).toBe(false);
  });

  it("sem token do clique: nenhuma chamada", async () => {
    const a = await montar("jev_direto", "ok");
    const r = await a.decisor.testar({ chave: "chave-digitada-no-teste-1", token: "ctk_falso" });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe("sem_consentimento");
    expect(a.jev.conexoes()).toBe(0);
  });
});
