// Cliente de feed e download verificado contra o servidor FALSO (loopback), usando o cliente de rede REAL do app (consentimento, host fixo,
// sem redirecionamento a outro host, teto de bytes). Cobre AU-03, AU-04, AU-14, AU-23 e AU-24.
import { monitorEventLoopDelay } from "node:perf_hooks";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { artefatoSintetico, sha512Hex } from "../../../../tests/fixtures/atualizacao/manifestos";
import { subirFeedFalso, type Cenario, type FeedFalso, type OpcoesFeedFalso } from "../../../../tests/fixtures/atualizacao/servidor-falso";
import { criarClienteRede, criarRegistroConsentimento } from "../../rede";
import { AtualizacaoErro } from "./erros";
import { criarClienteFeed } from "./feed";
import { transporteDoClienteRede, type Transporte } from "./transporte";
import { baixarEVerificar, reverificarArquivo } from "./verificador";

const feeds: FeedFalso[] = [];
let pasta = "";
beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), "atualizador-io-"));
});
afterEach(async () => {
  while (feeds.length) await (feeds.pop() as FeedFalso).fechar();
  rmSync(pasta, { recursive: true, force: true });
});

async function ambiente(op: OpcoesFeedFalso = {}): Promise<{ feed: FeedFalso; transporte: Transporte }> {
  const feed = await subirFeedFalso(op);
  feeds.push(feed);
  const consentimento = criarRegistroConsentimento();
  consentimento.permitirHost(feed.host);
  const token = consentimento.conceder(feed.host, { permanente: true });
  const cliente = criarClienteRede({ consentimento, permitirLoopbackHttp: true });
  return { feed, transporte: transporteDoClienteRede(cliente, { host: feed.host, porta: feed.porta, token }) };
}
const motivoDe = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "NAO_FALHOU";
  } catch (e) {
    return e instanceof AtualizacaoErro ? e.motivo : `outro:${String(e)}`;
  }
};
const FATOR = Number(process.env.EXPXV_PERF_FATOR ?? "1");

describe("cliente de feed (T-21.14)", () => {
  it("baixa manifesto e assinatura; só envia Accept e If-None-Match, sem cookie, credencial nem identificador (au24_sem_identificador_na_rede)", async () => {
    const { feed, transporte } = await ambiente();
    const cf = criarClienteFeed({ transporte, caminhoBase: "/" });
    const r = await cf.obterManifesto("stable", { etag: null });
    expect(r.tipo === "ok" && r.bytes.length > 10 && r.assinatura.length > 60).toBe(true);
    const segunda = await cf.obterManifesto("stable", { etag: feed.etag });
    expect(segunda.tipo).toBe("ok"); // cenário normal não implementa 304
    for (const req of feed.servidor.requisicoes) {
      const nomes = Object.keys(req.cabecalhos);
      for (const proibido of ["cookie", "authorization", "referer", "user-agent", "x-api-key", "origin"]) expect(nomes, proibido).not.toContain(proibido);
      expect(nomes.filter((n) => n.startsWith("x-"))).toEqual([]);
      expect(req.metodo).toBe("GET");
      expect(req.corpo).toBe("");
    }
  });

  it("au23_sem_token_no_pacote: cabeçalho de credencial passado ao transporte é descartado; o código do atualizador não tem Authorization", async () => {
    const { feed, transporte } = await ambiente();
    await transporte.requisitar({ caminho: "/stable/manifesto.json", cabecalhos: { Authorization: "Bearer SENTINELA-token-1234", Cookie: "s=1", "X-Id": "abc", Accept: "application/json" } });
    const vistas = feed.servidor.requisicoes.map((r) => JSON.stringify(r.cabecalhos).toLowerCase()).join("\n");
    expect(vistas).not.toContain("sentinela");
    expect(vistas).not.toContain("authorization");
    expect(vistas).not.toContain("cookie");
    const fontes = ["io/transporte.ts", "io/feed.ts", "io/verificador.ts", "backends/manual.ts", "backends/electron-updater.ts", "backends/download-verificado.ts", "servico.ts"].map((f) => readFileSync(join(__dirname, "..", f), "utf8")).join("\n");
    expect(fontes).not.toMatch(/authorization|bearer |github_pat|ghp_/i);
    const dist = readFileSync(join(__dirname, "..", "..", "..", "..", "build", "distribuicao.json"), "utf8");
    expect(dist).not.toMatch(/token|authorization|bearer/i);
  });

  it("caminho com query, fragmento ou .. nunca vira pedido", async () => {
    const { transporte } = await ambiente();
    for (const c of ["/a?x=1", "/a#b", "/../x", "//host/x", "x", "/a b"]) await expect(transporte.requisitar({ caminho: c }), c).rejects.toThrow();
  });

  it("au04_redirecionamento_recusado: redirecionamento a outro host e laço de 3xx falham com código nominal", async () => {
    const a = await ambiente({ cenario: "redirecionamento" });
    expect(await motivoDe(criarClienteFeed({ transporte: a.transporte, caminhoBase: "/" }).obterManifesto("stable"))).toBe("redirecionamento_recusado");
    const b = await ambiente({ cenario: "laco_3xx" });
    expect(await motivoDe(criarClienteFeed({ transporte: b.transporte, caminhoBase: "/" }).obterManifesto("stable"))).toBe("redirecionamento_recusado");
  });

  it("au14_servidor_hostil (manifesto): infinito, lento (nunca termina) e cabeçalho enorme ⇒ falha limpa, rápida e sem travar o event loop", async () => {
    const histograma = monitorEventLoopDelay({ resolution: 10 });
    histograma.enable();
    const res: Record<string, string> = {};
    for (const c of ["infinito", "lento", "cabecalho_enorme"] as Cenario[]) {
      const { transporte } = await ambiente({ cenario: c });
      const t0 = Date.now();
      res[c] = await motivoDe(criarClienteFeed({ transporte, caminhoBase: "/", timeoutMs: 400 }).obterManifesto("stable"));
      expect(Date.now() - t0, c).toBeLessThan(3000);
    }
    histograma.disable();
    expect(res.infinito).toBe("servidor_hostil");
    expect(res.lento).toBe("servidor_hostil");
    expect(res.cabecalho_enorme).toMatch(/falha_de_rede|servidor_hostil/);
    expect(histograma.max / 1e6, "maior atraso do event loop (ms)").toBeLessThan(50 * FATOR + 100);
  });

  it("cancelamento do pedido de manifesto devolve `cancelado`", async () => {
    const { transporte } = await ambiente({ cenario: "lento" });
    const c = new AbortController();
    const p = criarClienteFeed({ transporte, caminhoBase: "/", timeoutMs: 5000 }).obterManifesto("stable", { sinal: c.signal });
    setTimeout(() => c.abort(), 80);
    expect(await motivoDe(p)).toBe("cancelado");
  });

  it("304 sem If-None-Match enviado é resposta inventada: servidor_hostil; 404 da assinatura = assinatura_ausente", async () => {
    const falso: Transporte = {
      async requisitar(p) {
        if (p.caminho.endsWith(".json")) return { status: 304, cabecalhos: {}, corpo: Buffer.alloc(0) };
        return { status: 404, cabecalhos: {}, corpo: Buffer.alloc(0) };
      },
      async stream() {
        throw new Error("não usado");
      },
    };
    expect(await motivoDe(criarClienteFeed({ transporte: falso, caminhoBase: "/" }).obterManifesto("stable", { etag: null }))).toBe("servidor_hostil");
    const semSig: Transporte = {
      ...falso,
      async requisitar(p) {
        return p.caminho.endsWith(".json") ? { status: 200, cabecalhos: {}, corpo: Buffer.from("{}") } : { status: 404, cabecalhos: {}, corpo: Buffer.alloc(0) };
      },
    };
    expect(await motivoDe(criarClienteFeed({ transporte: semSig, caminhoBase: "/" }).obterManifesto("stable"))).toBe("assinatura_ausente");
    const condicional: Transporte = { ...falso, async requisitar() { return { status: 304, cabecalhos: {}, corpo: Buffer.alloc(0) }; } };
    expect((await criarClienteFeed({ transporte: condicional, caminhoBase: "/" }).obterManifesto("stable", { etag: '"abc"' })).tipo).toBe("nao_modificado");
  });
});

describe("download verificado (T-21.14)", () => {
  it("baixa, confere tamanho e sha512 em streaming e deixa só o arquivo final", async () => {
    const { feed, transporte } = await ambiente();
    const progresso: number[] = [];
    const r = await baixarEVerificar({ transporte, caminhoBase: "/", artefato: feed.manifesto.artefatos[0]!, destinoDir: pasta, onProgresso: (f) => progresso.push(f) });
    expect(readFileSync(r.caminho).equals(feed.artefato)).toBe(true);
    expect(r.sha512).toBe(sha512Hex(feed.artefato));
    expect(readdirSync(pasta)).toEqual(["app-universal.dmg"]);
    expect(progresso.at(-1)).toBe(1);
    await expect(reverificarArquivo(r.caminho, feed.manifesto.artefatos[0]!)).resolves.toBeUndefined();
  });

  it("au03_hash_errado_apaga: conteúdo diferente do assinado ⇒ hash_diferente e NADA fica no disco", async () => {
    const { feed, transporte } = await ambiente({ cenario: "hash_errado" });
    expect(await motivoDe(baixarEVerificar({ transporte, caminhoBase: "/", artefato: feed.manifesto.artefatos[0]!, destinoDir: pasta }))).toBe("hash_diferente");
    expect(readdirSync(pasta)).toEqual([]);
  });

  it("au14_servidor_hostil (artefato): maior que o `tamanho` assinado e infinito ⇒ aborta no ato e apaga o parcial", async () => {
    for (const c of ["gigante", "infinito"] as Cenario[]) {
      const { feed, transporte } = await ambiente({ cenario: c });
      const t0 = Date.now();
      // o cliente de rede já corta no teto de bytes (= tamanho assinado) e o verificador conta por conta própria: as duas camadas são hostis-seguras
      expect(await motivoDe(baixarEVerificar({ transporte, caminhoBase: "/", artefato: feed.manifesto.artefatos[0]!, destinoDir: pasta })), c).toMatch(/^(tamanho_diferente|servidor_hostil)$/);
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(readdirSync(pasta), c).toEqual([]);
    }
  });

  it("au14_servidor_hostil (lento): corpo que trava ⇒ tempo ocioso estoura e o parcial some", async () => {
    const { feed, transporte } = await ambiente({ cenario: "lento" });
    expect(await motivoDe(baixarEVerificar({ transporte, caminhoBase: "/", artefato: feed.manifesto.artefatos[0]!, destinoDir: pasta, ociosoMs: 300 }))).toBe("servidor_hostil");
    expect(readdirSync(pasta)).toEqual([]);
  });

  it("cancelável: abortar no meio do download devolve `cancelado` e apaga o parcial", async () => {
    const { feed, transporte } = await ambiente({ cenario: "lento" });
    const c = new AbortController();
    const p = baixarEVerificar({ transporte, caminhoBase: "/", artefato: feed.manifesto.artefatos[0]!, destinoDir: pasta, sinal: c.signal, ociosoMs: 5000 });
    setTimeout(() => c.abort(), 100);
    expect(await motivoDe(p)).toBe("cancelado");
    expect(readdirSync(pasta)).toEqual([]);
  });

  it("arquivo menor que o assinado é recusado (truncado)", async () => {
    const { feed, transporte } = await ambiente();
    const maior = { ...feed.manifesto.artefatos[0]!, tamanho: feed.artefato.length + 10 };
    expect(await motivoDe(baixarEVerificar({ transporte, caminhoBase: "/", artefato: maior, destinoDir: pasta }))).toMatch(/tamanho_diferente|servidor_hostil|falha_de_rede/);
    expect(readdirSync(pasta)).toEqual([]);
  });

  it("reverificarArquivo apaga o arquivo adulterado depois do download (TOCTOU, au26)", async () => {
    const { feed, transporte } = await ambiente();
    const art = feed.manifesto.artefatos[0]!;
    const r = await baixarEVerificar({ transporte, caminhoBase: "/", artefato: art, destinoDir: pasta });
    const { writeFileSync } = await import("node:fs");
    const adulterado = Buffer.from(feed.artefato);
    adulterado[3] = (adulterado[3] as number) ^ 1;
    writeFileSync(r.caminho, adulterado);
    expect(await motivoDe(reverificarArquivo(r.caminho, art))).toBe("hash_diferente");
    expect(existsSync(r.caminho)).toBe(false);
  });

  it("nome de arquivo derivado do manifesto é saneado (sem diretório nem escape)", async () => {
    const { feed, transporte } = await ambiente();
    const ruim = { ...feed.manifesto.artefatos[0]!, url_relativa: "stable/1.1.0/.." };
    expect(await motivoDe(baixarEVerificar({ transporte, caminhoBase: "/", artefato: ruim, destinoDir: pasta }))).toBe("manifesto_invalido");
  });

  it("P-156: artefato de 24 MB baixa e confere com o event loop livre (maior atraso < 50 ms × fator + folga) e sem copiar o arquivo inteiro na memória", async () => {
    const grande = artefatoSintetico(24 * 1024 * 1024);
    const { feed, transporte } = await ambiente({ artefato: grande });
    const histograma = monitorEventLoopDelay({ resolution: 10 });
    const antes = process.memoryUsage().rss;
    histograma.enable();
    const eventos: number[] = [];
    const t0 = Date.now();
    const r = await baixarEVerificar({ transporte, caminhoBase: "/", artefato: feed.manifesto.artefatos[0]!, destinoDir: pasta, onProgresso: () => eventos.push(Date.now()) });
    const ms = Date.now() - t0;
    histograma.disable();
    expect(r.bytes).toBe(grande.length);
    expect(histograma.max / 1e6).toBeLessThan(50 * FATOR + 100);
    // guarda grossa (rss inclui lixo ainda não coletado dos pedaços de 64 KiB): nunca mais que ~2× o arquivo; o orçamento de +30 MB com GC é medido em perf:pacote (T-21.26)
    expect(process.memoryUsage().rss - antes).toBeLessThan(2 * grande.length);
    // progresso coalescido: ≤ 4 eventos por segundo (+ o final)
    expect(eventos.length).toBeLessThanOrEqual(Math.ceil((ms / 1000) * 4) + 2);
  }, 30_000);
});
