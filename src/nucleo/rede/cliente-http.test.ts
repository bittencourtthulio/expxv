import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { subirServidorFalso, type ServidorFalso } from "../../../tests/fixtures/rede/servidor-falso";
import { casaRedirect } from "./cliente-http";
import { criarClienteRede, criarRegistroConsentimento, RedeErro, type ClienteRede, type RegistroConsentimento } from "./index";

const SENTINELA = "SENTINELA-rede-5d2b8e04-chave-de-api";
const servidores: ServidorFalso[] = [];
const extras: Array<() => void> = [];
afterEach(async () => {
  while (servidores.length) await (servidores.pop() as ServidorFalso).fechar();
  while (extras.length) (extras.pop() as () => void)();
});
const subir = async (m: Parameters<typeof subirServidorFalso>[0]): Promise<ServidorFalso> => {
  const s = await subirServidorFalso(m);
  servidores.push(s);
  return s;
};

interface Ambiente {
  cliente: ClienteRede;
  consentimento: RegistroConsentimento;
  logs: string[];
}
function ambiente(extra: Partial<Parameters<typeof criarClienteRede>[0]> = {}): Ambiente {
  const consentimento = criarRegistroConsentimento();
  const logs: string[] = [];
  const cliente = criarClienteRede({ consentimento, permitirLoopbackHttp: true, log: (l) => logs.push(l), ...extra });
  return { cliente, consentimento, logs };
}
const codigo = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "NAO_FALHOU";
  } catch (e) {
    return e instanceof RedeErro ? e.codigo : `outro:${String(e)}`;
  }
};

describe("consentimento: rede só por ação do usuário", () => {
  it("sem token: consent_required e ZERO conexões", async () => {
    const s = await subir((_q, r) => void r.end("ok"));
    const { cliente, consentimento } = ambiente();
    consentimento.permitirHost(s.host);
    const base = { host: s.host, caminho: "/x", porta: s.porta };
    expect(await codigo(cliente.requisitar({ ...base, tokenDeConsentimento: "" }))).toBe("consent_required");
    expect(await codigo(cliente.requisitar({ ...base, tokenDeConsentimento: "ctk_inventado" }))).toBe("consent_required");
    expect(await codigo(cliente.requisitar({ ...base } as never))).toBe("consent_required");
    expect(await codigo(cliente.stream({ ...base, tokenDeConsentimento: "x" }))).toBe("consent_required");
    expect(s.conexoes()).toBe(0);
  });

  it("token de outro host, expirado, esgotado ou revogado não vale (zero conexões)", async () => {
    const s = await subir((_q, r) => void r.end("ok"));
    let agora = 1_000;
    const consentimento = criarRegistroConsentimento({ agora: () => agora });
    const cliente = criarClienteRede({ consentimento, permitirLoopbackHttp: true });
    consentimento.permitirHost(s.host);
    const pedido = (t: string) => ({ host: s.host, caminho: "/x", porta: s.porta, tokenDeConsentimento: t });
    expect(await codigo(cliente.requisitar(pedido(consentimento.conceder("outro.exemplo"))))).toBe("consent_required");
    const expira = consentimento.conceder(s.host, { validade_ms: 500 });
    agora += 501;
    expect(await codigo(cliente.requisitar(pedido(expira)))).toBe("consent_required");
    const uso = consentimento.conceder(s.host);
    expect((await cliente.requisitar(pedido(uso))).status).toBe(200);
    expect(await codigo(cliente.requisitar(pedido(uso)))).toBe("consent_required"); // uso único
    const revogado = consentimento.conceder(s.host);
    consentimento.revogar(revogado);
    expect(await codigo(cliente.requisitar(pedido(revogado)))).toBe("consent_required");
    expect(s.conexoes()).toBe(1);
  });

  it("token permanente (consentimento gravado) serve várias chamadas até revogar o host", async () => {
    const s = await subir((_q, r) => void r.end("ok"));
    const { cliente, consentimento } = ambiente();
    consentimento.permitirHost(s.host);
    const t = consentimento.conceder(s.host, { permanente: true });
    for (let i = 0; i < 3; i++) expect((await cliente.requisitar({ host: s.host, caminho: "/x", porta: s.porta, tokenDeConsentimento: t })).status).toBe(200);
    consentimento.revogarHost(s.host);
    expect(await codigo(cliente.requisitar({ host: s.host, caminho: "/x", porta: s.porta, tokenDeConsentimento: t }))).toBe("consent_required");
    expect(s.conexoes()).toBe(3);
  });
});

describe("allowlist e https", () => {
  it("host fora da allowlist, IP literal, rede interna e loopback sem a opção de teste são recusados antes do socket", async () => {
    const s = await subir((_q, r) => void r.end("ok"));
    const { cliente, consentimento } = ambiente();
    // host com token mas sem consentimento gravado
    const t1 = consentimento.conceder(s.host);
    expect(await codigo(cliente.requisitar({ host: s.host, caminho: "/", porta: s.porta, tokenDeConsentimento: t1 }))).toBe("host_nao_permitido");
    for (const h of ["10.0.0.5", "169.254.169.254", "192.168.1.1", "::1x", "intranet.local", "api.internal", "a b"]) {
      consentimento.permitirHost(h);
      expect(await codigo(cliente.requisitar({ host: h, caminho: "/", tokenDeConsentimento: consentimento.conceder(h) })), h).toBe("host_nao_permitido");
    }
    // produção: sem a opção de teste, até o loopback é recusado
    const producao = criarClienteRede({ consentimento });
    consentimento.permitirHost(s.host);
    expect(await codigo(producao.requisitar({ host: s.host, caminho: "/", porta: s.porta, tokenDeConsentimento: consentimento.conceder(s.host) }))).toBe("host_nao_permitido");
    expect(s.conexoes()).toBe(0);
  });

  it("caminho e cabeçalhos inválidos (CRLF, cookie, referer, //) são recusados", async () => {
    const s = await subir((_q, r) => void r.end("ok"));
    const { cliente, consentimento } = ambiente();
    consentimento.permitirHost(s.host);
    const base = (extra: object) => ({ host: s.host, porta: s.porta, caminho: "/", tokenDeConsentimento: consentimento.conceder(s.host), ...extra });
    expect(await codigo(cliente.requisitar(base({ caminho: "/a\r\nX: y" })))).toBe("requisicao_invalida");
    expect(await codigo(cliente.requisitar(base({ caminho: "//outro.host/x" })))).toBe("requisicao_invalida");
    expect(await codigo(cliente.requisitar(base({ cabecalhos: { Cookie: "a=b" } })))).toBe("requisicao_invalida");
    expect(await codigo(cliente.requisitar(base({ cabecalhos: { referer: "https://x" } })))).toBe("requisicao_invalida");
    expect(await codigo(cliente.requisitar(base({ cabecalhos: { "x-a": "b\r\nx-c: d" } })))).toBe("requisicao_invalida");
    expect(await codigo(cliente.requisitar(base({ metodo: "TRACE" })))).toBe("requisicao_invalida");
    expect(s.conexoes()).toBe(0);
  });
});

describe("transporte", () => {
  it("GET/POST: cabeçalho de chave chega ao servidor; resposta tipada; log sem cabeçalho, corpo nem query", async () => {
    const s = await subir((_q, r) => {
      r.setHeader("content-type", "application/json");
      r.setHeader("set-cookie", "sessao=1");
      r.end(JSON.stringify({ ok: true }));
    });
    const { cliente, consentimento, logs } = ambiente();
    consentimento.permitirHost(s.host);
    const r = await cliente.requisitar({
      host: s.host, porta: s.porta, metodo: "POST", caminho: `/v1/decidir?k=${SENTINELA}`,
      cabecalhos: { authorization: `Bearer ${SENTINELA}`, "content-type": "application/json" },
      corpo: JSON.stringify({ segredo: SENTINELA }),
      tokenDeConsentimento: consentimento.conceder(s.host),
    });
    expect(r.status).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    const visto = s.requisicoes[0];
    expect(visto?.cabecalhos.authorization).toBe(`Bearer ${SENTINELA}`);
    expect(visto?.cabecalhos.cookie).toBeUndefined();
    expect(visto?.cabecalhos.referer).toBeUndefined();
    expect(visto?.cabecalhos["accept-encoding"]).toBe("identity");
    expect(visto?.corpo).toContain(SENTINELA);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^rede POST 127\.0\.0\.1\/v1\/decidir -> 200 \d+ms$/);
    expect(logs.join()).not.toContain(SENTINELA);
  });

  it("redirecionamento no mesmo host é seguido; para outro host é recusado sem tocar o destino", async () => {
    const alvo = await subir((_q, r) => void r.end("não deveria ser chamado"));
    const s = await subir((q, r) => {
      if (q.url === "/ok") return void r.end("fim");
      if (q.url === "/volta") {
        r.statusCode = 302;
        r.setHeader("location", "/ok");
        return void r.end();
      }
      if (q.url === "/laco") {
        r.statusCode = 302;
        r.setHeader("location", "/laco");
        return void r.end();
      }
      r.statusCode = 302;
      r.setHeader("location", `http://localhost:${alvo.porta}/roubo`);
      r.end();
    });
    const { cliente, consentimento } = ambiente();
    consentimento.permitirHost(s.host);
    consentimento.permitirHost("localhost"); // mesmo consentido, o salto de host não é automático
    const pedido = (caminho: string) => ({ host: s.host, porta: s.porta, caminho, cabecalhos: { authorization: `Bearer ${SENTINELA}` }, tokenDeConsentimento: consentimento.conceder(s.host) });
    expect((await cliente.requisitar(pedido("/volta"))).texto()).toBe("fim");
    expect(await codigo(cliente.requisitar(pedido("/fora")))).toBe("redirect_outro_host");
    expect(await codigo(cliente.requisitar(pedido("/laco")))).toBe("redirect_demais");
    expect(alvo.conexoes()).toBe(0);
    expect(JSON.stringify(alvo.requisicoes)).not.toContain(SENTINELA);
  });

  it("resposta acima do teto é abortada (declarada e em fluxo)", async () => {
    const s = await subir((q, r) => {
      if (q.url === "/declarada") {
        r.setHeader("content-length", "5000000");
        r.write("x");
        return;
      }
      r.write(Buffer.alloc(64 * 1024, 97));
      const t = setInterval(() => r.write(Buffer.alloc(64 * 1024, 97)), 2);
      r.on("close", () => clearInterval(t));
    });
    const { cliente, consentimento } = ambiente();
    consentimento.permitirHost(s.host);
    const p = (caminho: string) => ({ host: s.host, porta: s.porta, caminho, max_bytes: 100_000, tokenDeConsentimento: consentimento.conceder(s.host) });
    expect(await codigo(cliente.requisitar(p("/declarada")))).toBe("resposta_grande_demais");
    expect(await codigo(cliente.requisitar(p("/fluxo")))).toBe("resposta_grande_demais");
  });

  it("timeout aborta a chamada que não responde", async () => {
    const s = await subir(() => undefined);
    const { cliente, consentimento } = ambiente();
    consentimento.permitirHost(s.host);
    const t0 = performance.now();
    expect(await codigo(cliente.requisitar({ host: s.host, porta: s.porta, caminho: "/", timeout_ms: 150, tokenDeConsentimento: consentimento.conceder(s.host) }))).toBe("timeout");
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it("erro de conexão tem texto fixo: sem chave, sem cabeçalho, sem query; log idem", async () => {
    const s = await subir((_q, r) => void r.end("x"));
    const porta = s.porta;
    await s.fechar();
    servidores.pop();
    const { cliente, consentimento, logs } = ambiente();
    consentimento.permitirHost("127.0.0.1");
    let msg = "";
    try {
      await cliente.requisitar({ host: "127.0.0.1", porta, caminho: `/x?k=${SENTINELA}`, cabecalhos: { authorization: `Bearer ${SENTINELA}` }, corpo: SENTINELA, metodo: "POST", tokenDeConsentimento: consentimento.conceder("127.0.0.1") });
    } catch (e) {
      msg = (e as Error).message;
      expect((e as RedeErro).codigo).toBe("falha_rede");
    }
    expect(msg).not.toBe("");
    expect(msg).not.toContain(SENTINELA);
    expect(logs.join()).not.toContain(SENTINELA);
  });

  it("stream: entrega pedaços, respeita teto e cancelar", async () => {
    const s = await subir((_q, r) => {
      r.write("a".repeat(10));
      setTimeout(() => {
        r.write("b".repeat(10));
        r.end();
      }, 20);
    });
    const { cliente, consentimento } = ambiente();
    consentimento.permitirHost(s.host);
    const resp = await cliente.stream({ host: s.host, porta: s.porta, caminho: "/", tokenDeConsentimento: consentimento.conceder(s.host) });
    let texto = "";
    for await (const p of resp.corpo) texto += p.toString();
    expect(resp.status).toBe(200);
    expect(texto).toBe("a".repeat(10) + "b".repeat(10));
    const curta = await cliente.stream({ host: s.host, porta: s.porta, caminho: "/", max_bytes: 12, tokenDeConsentimento: consentimento.conceder(s.host) });
    let falhou = "";
    try {
      for await (const _p of curta.corpo) void _p;
    } catch (e) {
      falhou = (e as RedeErro).codigo;
    }
    expect(falhou).toBe("resposta_grande_demais");
  });

  it("proxy do sistema é respeitado: alvo https vai por CONNECT; loopback nunca usa proxy", async () => {
    const conectou: string[] = [];
    const sockets = new Set<Duplex>();
    const proxy = createServer();
    proxy.on("connect", (req, socket) => {
      conectou.push(req.url ?? "");
      sockets.add(socket);
      socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    });
    await new Promise<void>((ok) => proxy.listen(0, "127.0.0.1", ok));
    extras.push(() => {
      for (const s of sockets) s.destroy();
      proxy.close();
    });
    const portaProxy = (proxy.address() as { port: number }).port;
    const consentimento = criarRegistroConsentimento();
    const consultas: string[] = [];
    const cliente = criarClienteRede({
      consentimento,
      permitirLoopbackHttp: true,
      resolverProxy: (url) => {
        consultas.push(url);
        return `PROXY 127.0.0.1:${portaProxy}`;
      },
    });
    consentimento.permitirHost("api.exemplo.test");
    expect(await codigo(cliente.requisitar({ host: "api.exemplo.test", caminho: "/v1", tokenDeConsentimento: consentimento.conceder("api.exemplo.test") }))).toBe("proxy_falhou");
    expect(conectou).toEqual(["api.exemplo.test:443"]);
    const s = await subir((_q, r) => void r.end("direto"));
    consentimento.permitirHost(s.host);
    expect((await cliente.requisitar({ host: s.host, porta: s.porta, caminho: "/", tokenDeConsentimento: consentimento.conceder(s.host) })).texto()).toBe("direto");
    expect(conectou).toHaveLength(1);
  });
});

describe("AbortSignal por pedido (Fase 20): aborto REAL do socket, inclusive antes dos cabeçalhos", () => {
  it("abortar durante a espera (long polling) destrói a conexão no servidor e rejeita com falha_rede", async () => {
    let fechouNoServidor = false;
    const s = await subir((req, _r) => {
      req.socket.once("close", () => (fechouNoServidor = true));
    });
    const { cliente, consentimento } = ambiente();
    consentimento.permitirHost(s.host);
    const ctl = new AbortController();
    const p = cliente.requisitar({ host: s.host, caminho: "/bot{x}/getUpdates", porta: s.porta, tokenDeConsentimento: consentimento.conceder(s.host), timeout_ms: 20_000, sinal: ctl.signal });
    setTimeout(() => ctl.abort(), 40);
    expect(await codigo(p)).toBe("falha_rede");
    await new Promise((r) => setTimeout(r, 80));
    expect(fechouNoServidor).toBe(true);
  });

  it("sinal já abortado: nenhuma resposta e o erro não cita o caminho", async () => {
    const s = await subir((_q, r) => void r.end("ok"));
    const { cliente, consentimento } = ambiente();
    consentimento.permitirHost(s.host);
    const ctl = new AbortController();
    ctl.abort();
    try {
      await cliente.stream({ host: s.host, caminho: "/bot123:SEGREDO/getMe", porta: s.porta, tokenDeConsentimento: consentimento.conceder(s.host), sinal: ctl.signal });
      throw new Error("deveria falhar");
    } catch (e) {
      expect(e).toBeInstanceOf(RedeErro);
      expect(String((e as Error).message)).not.toContain("SEGREDO");
    }
  });

  it("stream: abortar com o corpo em andamento interrompe a iteração", async () => {
    const s = await subir((_q, r) => {
      r.writeHead(200);
      r.write("a");
    });
    const { cliente, consentimento } = ambiente();
    consentimento.permitirHost(s.host);
    const ctl = new AbortController();
    const resp = await cliente.stream({ host: s.host, caminho: "/x", porta: s.porta, tokenDeConsentimento: consentimento.conceder(s.host), sinal: ctl.signal });
    setTimeout(() => ctl.abort(), 30);
    let erro = "";
    try {
      for await (const _ of resp.corpo) void _;
    } catch (e) {
      erro = e instanceof RedeErro ? e.codigo : "outro";
    }
    expect(erro).toBe("falha_rede");
  });
});

describe("redirecionar_para (aditivo, voz local): salto para a CDN do catálogo", () => {
  it("só segue o salto para host listado; Range e demais cabeçalhos chegam ao destino; sem lista continua recusado", async () => {
    const cdn = await subir((q, r) => {
      r.statusCode = q.headers.range === undefined ? 200 : 206;
      r.end("arquivo");
    });
    const origem = await subir((_q, r) => {
      r.statusCode = 302;
      r.setHeader("location", `http://127.0.0.1:${cdn.porta}/blob`);
      r.end();
    });
    const { cliente, consentimento } = ambiente();
    consentimento.permitirHost(origem.host);
    const base = { host: origem.host, porta: origem.porta, caminho: "/f", cabecalhos: { range: "bytes=0-" } };
    expect(await codigo(cliente.requisitar({ ...base, tokenDeConsentimento: consentimento.conceder(origem.host) }))).toBe("redirect_outro_host");
    expect(await codigo(cliente.requisitar({ ...base, redirecionar_para: ["exemplo.org"], tokenDeConsentimento: consentimento.conceder(origem.host) }))).toBe("redirect_outro_host");
    expect(cdn.conexoes()).toBe(0);
    const r = await cliente.requisitar({ ...base, redirecionar_para: ["127.0.0.1"], tokenDeConsentimento: consentimento.conceder(origem.host) });
    expect(r.status).toBe(206);
    expect(r.texto()).toBe("arquivo");
    expect(cdn.requisicoes[0]?.cabecalhos.range).toBe("bytes=0-");
  });

  it("padrões inválidos (curinga de TLD, domínio com caminho, lista enorme) são recusados antes do socket", async () => {
    const s = await subir((_q, r) => void r.end("ok"));
    const { cliente, consentimento } = ambiente();
    consentimento.permitirHost(s.host);
    for (const lista of [["*.com"], ["*"], ["a.b/c"], ["https://x.y"], ["*.exemplo.com", "*..x.com"], Array.from({ length: 9 }, (_, i) => `h${i}.exemplo.com`)]) {
      expect(await codigo(cliente.requisitar({ host: s.host, porta: s.porta, caminho: "/", redirecionar_para: lista, tokenDeConsentimento: consentimento.conceder(s.host) }))).toBe("requisicao_invalida");
    }
    expect(s.conexoes()).toBe(0);
  });

  it("casaRedirect: curinga de sufixo não casa o domínio nu nem sufixo parcial", () => {
    expect(casaRedirect("us.aws.cdn.hf.co", ["*.hf.co"])).toBe(true);
    expect(casaRedirect("hf.co", ["*.hf.co"])).toBe(false);
    expect(casaRedirect("evilhf.co", ["*.hf.co"])).toBe(false);
    expect(casaRedirect("hf.co.evil.com", ["*.hf.co"])).toBe(false);
    expect(casaRedirect("huggingface.co", ["huggingface.co"])).toBe(true);
    expect(casaRedirect("x.huggingface.co", ["huggingface.co"])).toBe(false);
  });
});
