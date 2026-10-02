import { afterEach, describe, expect, it } from "vitest";
import { CHAVE_SEMENTE, criarAmbienteRag } from "../../../../tests/fixtures/rag/ambiente";
import { subirStubRag, type StubRag } from "../../../../tests/fixtures/rag/servidor-stub";
import { RedeErro } from "../../rede/erros";
import type { ClienteRede } from "../../rede/cliente-http";
import { criarRegistroConsentimento } from "../../rede/consentimento";
import { criarTransporteRag, type PedidoRag } from "./transporte";

const abertos: StubRag[] = [];
afterEach(async () => {
  while (abertos.length) await (abertos.pop() as StubRag).fechar();
});
const subir = async (modo: Partial<Parameters<typeof subirStubRag>[0]["modo"] & object> = {}): Promise<StubRag> => {
  const s = await subirStubRag({ provedor: "qdrant", chave: CHAVE_SEMENTE, modo });
  abertos.push(s);
  return s;
};
const pedido = (s: StubRag, extra: Partial<PedidoRag> = {}): PedidoRag => ({ url: `${s.url}/collections`, metodo: "GET", cabecalhos: { "api-key": CHAVE_SEMENTE }, ...extra });
const codigo = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "NAO_FALHOU";
  } catch (e) {
    return e instanceof RedeErro ? e.codigo : e instanceof Error ? e.name : "?";
  }
};

describe("transporte autenticado: consentimento", () => {
  it("sem consentimento do host: consent_required e ZERO conexões", async () => {
    const s = await subir();
    const amb = criarAmbienteRag();
    expect(await codigo(amb.transporte(pedido(s)))).toBe("consent_required");
    expect(s.conexoes()).toBe(0);
    expect(s.requisicoes).toHaveLength(0);
  });
  it("com consentimento a chamada vai; revogar o host barra a próxima sem abrir socket", async () => {
    const s = await subir();
    const amb = criarAmbienteRag();
    amb.consentir();
    const r = await amb.transporte(pedido(s));
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.cabecalho("content-type")).toContain("json");
    expect(s.requisicoes).toHaveLength(1);
    expect(s.requisicoes[0]?.cabecalhos["api-key"]).toBe(CHAVE_SEMENTE);
    amb.revogar();
    expect(await codigo(amb.transporte(pedido(s)))).toBe("consent_required");
    expect(s.requisicoes).toHaveLength(1);
  });
  it("token permanente só é emitido com o host consentido (registro de consentimento vazio antes)", async () => {
    const s = await subir();
    const amb = criarAmbienteRag();
    expect(amb.consentimento.hosts()).toEqual([]);
    await codigo(amb.transporte(pedido(s)));
    expect(amb.consentimento.hosts()).toEqual([]);
    amb.consentir();
    await amb.transporte(pedido(s));
    expect(amb.consentimento.hosts()).toEqual(["127.0.0.1"]);
  });
  it("URL com credencial embutida, http em host público, esquema estranho: recusados sem conexão", async () => {
    const s = await subir();
    const amb = criarAmbienteRag();
    amb.consentir();
    amb.consentir("exemplo.com");
    expect(await codigo(amb.transporte({ url: `http://usuario:senha@127.0.0.1:${s.porta}/collections`, metodo: "GET" }))).toBe("requisicao_invalida");
    expect(await codigo(amb.transporte({ url: "http://exemplo.com/collections", metodo: "GET" }))).toBe("https_obrigatorio");
    expect(await codigo(amb.transporte({ url: "ftp://exemplo.com/x", metodo: "GET" }))).toBe("requisicao_invalida");
    expect(await codigo(amb.transporte({ url: "lixo", metodo: "GET" }))).toBe("requisicao_invalida");
    expect(s.conexoes()).toBe(0);
  });
  it("redirecionamento para outro host/porta NÃO é seguido (o destino não recebe nada)", async () => {
    const destino = await subir();
    const origem = await subir({ redirecionarPara: `${destino.url}/collections` });
    const amb = criarAmbienteRag();
    amb.consentir();
    expect(await codigo(amb.transporte(pedido(origem)))).toBe("redirect_outro_host");
    expect(destino.conexoes()).toBe(0);
  });
});

describe("transporte autenticado: backoff, abortos e erros", () => {
  it("429 e 5xx intermitentes: repete com backoff exponencial e jitter (injetáveis) e conclui", async () => {
    const s = await subir({ falhasIniciais: { status: 429, quantas: 2 } });
    const esperas: number[] = [];
    const amb = criarAmbienteRag({ dormir: async (ms) => void esperas.push(ms), aleatorio: () => 0.5, esperaBaseMs: 100 });
    amb.consentir();
    // `retry-after: 0` do stub vence o cálculo; remove para provar o exponencial
    s.modo.falhasIniciais = { status: 503, quantas: 3 };
    const r = await amb.transporte(pedido(s));
    expect(r.ok).toBe(true);
    expect(esperas).toEqual([75, 150, 300]); // 100*2^n * (0.5 + 0.5*0.5)
    expect(s.requisicoes).toHaveLength(4);
  });
  it("esgotadas as tentativas devolve a última resposta (ok=false) sem lançar", async () => {
    const s = await subir({ falhasIniciais: { status: 500, quantas: 99 } });
    const amb = criarAmbienteRag({ tentativas: 3 });
    amb.consentir();
    const r = await amb.transporte(pedido(s));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
    expect(s.requisicoes).toHaveLength(3);
  });
  it("401 não é repetido", async () => {
    const s = await subir();
    const amb = criarAmbienteRag();
    amb.consentir();
    const r = await amb.transporte(pedido(s, { cabecalhos: { "api-key": "errada-errada" } }));
    expect(r.status).toBe(401);
    expect(s.requisicoes).toHaveLength(1);
  });
  it("AbortSignal: já abortado não abre socket; abortar durante a espera interrompe", async () => {
    const s = await subir({ latenciaMs: 400 });
    const amb = criarAmbienteRag();
    amb.consentir();
    const c1 = new AbortController();
    c1.abort();
    expect(await codigo(amb.transporte(pedido(s, { sinal: c1.signal })))).toBe("AbortError");
    expect(s.conexoes()).toBe(0);
    const c2 = new AbortController();
    const p = amb.transporte(pedido(s, { sinal: c2.signal }));
    setTimeout(() => c2.abort(), 30);
    const t0 = performance.now();
    expect(await codigo(p)).toBe("AbortError");
    expect(performance.now() - t0).toBeLessThan(300);
  });
  it("queda de conexão: repete e por fim lança erro SEM chave nem URL com credencial", async () => {
    const s = await subir();
    s.derrubar();
    const amb = criarAmbienteRag({ tentativas: 2 });
    amb.consentir();
    let msg = "";
    try {
      await amb.transporte(pedido(s));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("falha_rede");
    expect(msg).not.toContain(CHAVE_SEMENTE);
    expect(s.requisicoes.length).toBe(2); // duas tentativas (o stub registra e derruba a conexão)
  });
  it("nunca registra cabeçalho, corpo nem chave nos logs do cliente", async () => {
    const s = await subir();
    const amb = criarAmbienteRag();
    amb.consentir();
    await amb.transporte(pedido(s, { metodo: "POST", url: `${s.url}/collections/x/points/count?chave=${CHAVE_SEMENTE}`, corpo: JSON.stringify({ segredo: CHAVE_SEMENTE }) }));
    expect(amb.logs.length).toBeGreaterThan(0);
    expect(amb.logs.join("\n")).not.toContain(CHAVE_SEMENTE);
  });
  it("cliente falso: o pedido ao ClienteRede leva host, caminho, porta e token permanente (nada de URL completa)", async () => {
    const chamadas: Array<Record<string, unknown>> = [];
    const rede: ClienteRede = {
      requisitar: async (p) => {
        chamadas.push(p as unknown as Record<string, unknown>);
        return { status: 200, cabecalhos: { "content-range": "0-0/7" }, corpo: Buffer.from("{}"), texto: () => "{}", json: <T,>() => ({}) as T };
      },
      stream: async () => {
        throw new Error("não usado");
      },
    };
    const consentimento = criarRegistroConsentimento();
    const t = criarTransporteRag({ rede, consentimento, hostsConsentidos: ["Qdrant.Exemplo.com"] });
    const r = await t({ url: "https://qdrant.exemplo.com:6333/collections/a?x=1", metodo: "POST", corpo: "{}", timeoutMs: 1234 });
    expect(r.cabecalho("Content-Range")).toBe("0-0/7");
    expect(chamadas[0]).toMatchObject({ host: "qdrant.exemplo.com", caminho: "/collections/a?x=1", porta: 6333, metodo: "POST", timeout_ms: 1234 });
    expect(consentimento.valido(chamadas[0]?.tokenDeConsentimento, "qdrant.exemplo.com")).toBe(true);
    expect(await codigo(t({ url: "https://outro.exemplo.com/x", metodo: "GET" }))).toBe("consent_required");
    expect(chamadas).toHaveLength(1);
  });
});
