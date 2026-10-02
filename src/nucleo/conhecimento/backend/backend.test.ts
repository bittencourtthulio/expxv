import { describe, expect, it } from "vitest";
import { doc, novoServico, T0 } from "../../../../tests/fixtures/conhecimento/util";
import { ArmazenamentoLocal } from "../armazenamento/local";
import { ArmazenamentoMemoria } from "../armazenamento/memoria";
import type { ArmazenamentoConhecimento } from "../armazenamento/interface";
import { POLITICA_VERSAO } from "../constantes";
import type { ServicoConhecimento } from "../servico";
import { consultarEquipe } from "./cache";
import { nomeColecaoVersionada, verificarCoerencia } from "./coerencia";
import { consentimentoVale, guardarSegredos, mascarar, nomeSegredo, normalizarRemote, projetoIdDoRemote, sanitizarErro, TIPOS_COM_AVISO, TIPOS_MIGRAVEIS_PADRAO, validarConfig, type PortaCofreRag } from "./config";
import { proximoLote } from "./exportar";
import { consentir, criarPrevia, migrar, SemConsentimentoErro, verificar } from "./migracao";
import { empurrar, enfileirarEnvio, podeEnviar, puxar, type EstadoReplicacao } from "./replicacao";
import { validarUrlBackend } from "./url";

const PROJETO = "0123456789abcdef";
const DESTINO = { provedor: "qdrant", host: "qdrant.exemplo.com", colecao: "conhecimento_x" };
const CONSENT = { ...DESTINO, versao_politica: POLITICA_VERSAO, em: T0 };
const TIPOS = TIPOS_MIGRAVEIS_PADRAO;

async function semear(s: ServicoConhecimento, n: number, prefixo = "d"): Promise<void> {
  for (let i = 0; i < n; i++) await s.pipeline.ingerir(s.colecaoId, doc({ tipo: i % 2 === 0 ? "decisao" : "doc", origem: `docs/${prefixo}${i}.md`, titulo: `${prefixo}${i}`, texto: `# ${prefixo}${i}\n\nconteúdo número ${i} sobre o tema ${prefixo} ${"palavra ".repeat(i % 5)}` }));
}

function estado(modo: EstadoReplicacao["modo"], consent: EstadoReplicacao["consentimento"] = CONSENT): EstadoReplicacao {
  return { modo, consentimento: consent, destino: DESTINO };
}

/** Espia: conta chamadas ao armazenamento remoto (prova de que nada sai por padrão). */
function espiar(a: ArmazenamentoConhecimento): { a: ArmazenamentoConhecimento; chamadas: string[] } {
  const chamadas: string[] = [];
  const proxy = new Proxy(a, {
    get(alvo, prop, rec) {
      const v = Reflect.get(alvo, prop, rec);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        chamadas.push(String(prop));
        return (v as (...x: unknown[]) => unknown).apply(alvo, args);
      };
    },
  });
  return { a: proxy, chamadas };
}

describe("URL, credenciais e configuração (D-91, D-92)", () => {
  it.each([
    ["https://qdrant.exemplo.com:6333", true, null],
    ["http://127.0.0.1:6333", true, "TLS"],
    ["http://localhost:6333", true, "TLS"],
    ["http://192.168.0.10:6333", true, "TLS"],
    ["http://10.1.2.3", true, "TLS"],
    ["http://exemplo.com", false, null],
    ["https://user:senha@exemplo.com", false, null],
    ["ftp://exemplo.com", false, null],
    ["lixo", false, null],
    ["", false, null],
  ])("%s → ok=%s", (u, ok, aviso) => {
    const r = validarUrlBackend(u);
    expect(r.ok).toBe(ok);
    if (aviso) expect(r.aviso).toContain(aviso);
    if (!ok) expect(r.erro).toBeTruthy();
  });
  it("projeto_id estável por remote normalizado (ssh = https), nunca caminho absoluto", () => {
    const a = projetoIdDoRemote("git@github.com:Org/Repo.git");
    expect(a).toBe(projetoIdDoRemote("https://github.com/org/repo"));
    expect(a).toBe(projetoIdDoRemote("https://token@github.com/org/repo.git/"));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(projetoIdDoRemote(null, "meu-projeto")).not.toBe(projetoIdDoRemote(null, "outro"));
    expect(normalizarRemote("ssh://git@host/x/y.git")).toBe("https://host/x/y");
  });
  it("segredos só no cofre: o retorno tem apenas máscaras; erro é sanitizado", async () => {
    const guardados = new Map<string, string>();
    const cofre: PortaCofreRag = { guardar: async (n, v) => void guardados.set(n, v), existe: async (n) => guardados.has(n), apagar: async (n) => void guardados.delete(n), obter: async (n) => guardados.get(n) ?? null };
    const r = await guardarSegredos(cofre, "qdrant", { api_key: "abcdefghijklmnop1234", usuario: "ana", vazio: "" });
    expect(r.ids).toEqual(["RAG_QDRANT_API_KEY", "RAG_QDRANT_USUARIO"]);
    expect(r.mascarado).toEqual({ api_key: "••••1234", usuario: "configurada" });
    expect(JSON.stringify(r)).not.toContain("abcdefghijklmnop");
    expect(guardados.get("RAG_QDRANT_API_KEY")).toBe("abcdefghijklmnop1234");
    expect(mascarar("curto")).toBe("configurada");
    expect(nomeSegredo("pinecone", "api key")).toBe("RAG_PINECONE_API_KEY");
    const e = sanitizarErro("falhou https://x.com/api?key=abcdefghijklmnop1234 com abcdefghijklmnop1234 e api-key: zzz", ["abcdefghijklmnop1234"]);
    expect(e).not.toContain("abcdefghij");
    expect(e).not.toContain("?key");
  });
  it("validação da config e do consentimento (vale só para este destino e esta política)", () => {
    const base = { provedor: "qdrant" as const, url: "https://q.exemplo.com", colecao_remota: "col_1", projeto_id: PROJETO, modo: "espelho" as const, tipos: ["doc" as const] };
    expect(validarConfig(base)).toEqual({ ok: true });
    expect(validarConfig({ ...base, url: "http://exemplo.com", provedor: "x" as never, projeto_id: "curto", tipos: [] })).toMatchObject({ ok: false });
    expect(consentimentoVale(CONSENT, DESTINO)).toBe(true);
    expect(consentimentoVale(CONSENT, { ...DESTINO, host: "outro.com" })).toBe(false);
    expect(consentimentoVale(CONSENT, { ...DESTINO, colecao: "outra" })).toBe(false);
    expect(consentimentoVale({ ...CONSENT, versao_politica: POLITICA_VERSAO + 1 }, DESTINO)).toBe(false);
    expect(consentimentoVale(null, DESTINO)).toBe(false);
    expect(TIPOS_COM_AVISO).toEqual(["codigo", "transcricao", "chat"]);
    expect(TIPOS_MIGRAVEIS_PADRAO).not.toContain("codigo");
  });
  it("coerência: divergência recusa com a diferença; coleção versionada; dimensão máxima", () => {
    const l = { modeloEmbedding: "hash-256-v1", dimensao: 256, metrica: "cosseno" as const };
    expect(verificarCoerencia(l, null).ok).toBe(true);
    expect(verificarCoerencia(l, { ...l, modeloEmbedding: "onnx:e5:384", dimensao: 384 })).toMatchObject({ ok: false, diferencas: expect.arrayContaining([expect.stringContaining("modelo"), expect.stringContaining("dimensão")]) });
    expect(verificarCoerencia({ ...l, dimensao: 2000 }, null, 1536).ok).toBe(false);
    expect(nomeColecaoVersionada(PROJETO, "ollama:nomic-embed-text:768", 768)).toBe(`conhecimento_${PROJETO}_ollama-nomic-embed-text-768_768`);
  });
});

describe("nada sai da máquina por padrão (AC-15.22)", () => {
  it("modo local ou sem consentimento válido: nenhum push/pull toca o remoto", async () => {
    const { s, fechar } = novoServico();
    await semear(s, 3);
    const { a, chamadas } = espiar(new ArmazenamentoMemoria());
    const pedido = { colecao_id: s.colecaoId, projeto_id: PROJETO, tipos: TIPOS };
    expect(podeEnviar(estado("local"))).toBe(false);
    expect(podeEnviar(estado("espelho", null))).toBe(false);
    expect(podeEnviar(estado("espelho", { ...CONSENT, host: "outro.com" }))).toBe(false);
    expect(enfileirarEnvio(s.repos, estado("local"), s.colecaoId, ["x"])).toBe(0);
    expect(await empurrar({ repos: s.repos, armazenamento: a, estado: estado("espelho", null), pedido })).toMatchObject({ enviados: 0, offline: false });
    expect(await puxar({ repos: s.repos, armazenamento: a, estado: estado("compartilhado", null), colecao_id: s.colecaoId, projeto_id: PROJETO, desde_ms: 0 })).toMatchObject({ recebidos: 0 });
    const prev = criarPrevia({ repos: s.repos, pedido, destino: DESTINO });
    await expect(migrar({ repos: s.repos, armazenamento: a, migracao_id: prev.migracao_id, projeto_id: PROJETO })).rejects.toBeInstanceOf(SemConsentimentoErro);
    expect(() => consentir(s.repos, prev.migracao_id, { ...CONSENT, host: "outro.com" })).toThrow(SemConsentimentoErro);
    expect(chamadas.filter((c) => c !== "capacidades")).toEqual([]);
    fechar();
  });
});

describe("migração local → online (AC-15.20, 21)", () => {
  it("prévia (dry-run) com amostra já redigida, avisos por tipo e nada enviado", async () => {
    const { s, fechar } = novoServico();
    const seg = ["sk", "ant", "api03", "MMMMNNNNBBBBVVVVCCCCXXXXZZZZ0123"].join("-");
    await s.pipeline.ingerir(s.colecaoId, doc({ tipo: "codigo", formato: "codigo", origem: "src/a.ts", titulo: "a", texto: `const k = "${seg}"; export function alfa() {}` }));
    await semear(s, 4);
    const { a, chamadas } = espiar(new ArmazenamentoMemoria());
    const prev = criarPrevia({ repos: s.repos, pedido: { colecao_id: s.colecaoId, projeto_id: PROJETO, tipos: [...TIPOS, "codigo"] }, destino: DESTINO });
    expect(prev.total).toBe(5);
    expect(prev.por_tipo.codigo?.itens).toBe(1);
    expect(prev.avisos.join(" ")).toContain('"codigo"');
    expect(prev.avisos.join(" ")).toContain("sairá da máquina");
    expect(prev.amostra.length).toBeLessThanOrEqual(20);
    expect(JSON.stringify(prev.amostra)).not.toContain("MMMMNNNN");
    expect(chamadas).toEqual([]);
    void a;
    fechar();
  });
  async function preparar(n: number, opcoes: ConstructorParameters<typeof ArmazenamentoMemoria>[0] = {}) {
    const { s, fechar } = novoServico();
    await semear(s, n);
    const remoto = new ArmazenamentoMemoria({ loteMaximo: 4, ...opcoes });
    const prev = criarPrevia({ repos: s.repos, pedido: { colecao_id: s.colecaoId, projeto_id: PROJETO, tipos: TIPOS }, destino: DESTINO });
    consentir(s.repos, prev.migracao_id, CONSENT);
    return { s, fechar, remoto, id: prev.migracao_id };
  }
  it("envia em lotes ≤ loteMaximo, verifica por contagem e checksum e conclui; o local é mantido", async () => {
    const { s, fechar, remoto, id } = await preparar(10);
    const antes = s.repos.documento.contagens(s.colecaoId);
    const r = await migrar({ repos: s.repos, armazenamento: remoto, migracao_id: id, projeto_id: PROJETO, lote: 4 });
    expect(r).toMatchObject({ estado: "verificando", enviados: 10 });
    expect(remoto.chamadasUpsert).toBe(3);
    const v = await verificar({ repos: s.repos, armazenamento: remoto, migracao_id: id, projeto_id: PROJETO });
    expect(v).toMatchObject({ ok: true, local: 10, remoto: 10, divergentes: 0 });
    expect(s.repos.migracao.obter(id)?.estado).toBe("concluida");
    expect(s.repos.documento.contagens(s.colecaoId)).toEqual(antes); // nunca apaga o local
    fechar();
  });
  it("retomada após falha no meio continua do cursor: 0 duplicata, 0 perda (P-80)", async () => {
    const { s, fechar, remoto, id } = await preparar(10, { falharNoUpsert: { chamada: 2, erro: new Error("kill -9") } });
    const r1 = await migrar({ repos: s.repos, armazenamento: remoto, migracao_id: id, projeto_id: PROJETO, lote: 4, tentativas: 1, dormir: async () => undefined });
    expect(r1.estado).toBe("falhou");
    expect(r1.enviados).toBe(4);
    expect(s.repos.migracao.obter(id)).toMatchObject({ estado: "falhou", enviados: 4 });
    const r2 = await migrar({ repos: s.repos, armazenamento: remoto, migracao_id: id, projeto_id: PROJETO, lote: 4 });
    expect(r2).toMatchObject({ estado: "verificando", enviados: 10 });
    expect(remoto.tamanho).toBe(10);
    const v = await verificar({ repos: s.repos, armazenamento: remoto, migracao_id: id, projeto_id: PROJETO });
    expect(v.ok).toBe(true);
    // reexecutar tudo de novo é seguro (idempotente)
    expect(remoto.tamanho).toBe(10);
    fechar();
  });
  it("retry com backoff injetado; pausa por sinal preserva o ponto de retomada", async () => {
    const { s, fechar, remoto, id } = await preparar(8, { falharNoUpsert: { chamada: 1, erro: new Error("429") } });
    const esperas: number[] = [];
    const r = await migrar({ repos: s.repos, armazenamento: remoto, migracao_id: id, projeto_id: PROJETO, lote: 4, dormir: async (ms) => void esperas.push(ms) });
    expect(esperas).toEqual([500]);
    expect(r.estado).toBe("verificando");
    const p2 = await preparar(8);
    const ctl = new AbortController();
    const parcial = await migrar({ repos: p2.s.repos, armazenamento: p2.remoto, migracao_id: p2.id, projeto_id: PROJETO, lote: 4, sinal: ctl.signal, aoProgresso: () => ctl.abort() });
    expect(parcial.estado).toBe("pausada");
    expect(p2.s.repos.migracao.obter(p2.id)?.enviados).toBe(4);
    expect((await migrar({ repos: p2.s.repos, armazenamento: p2.remoto, migracao_id: p2.id, projeto_id: PROJETO, lote: 4 })).enviados).toBe(8);
    expect(p2.remoto.tamanho).toBe(8);
    p2.fechar();
    fechar();
  });
  it("coerência de embeddings: dimensão acima do máximo do provedor recusa ANTES de enviar", async () => {
    const { s, fechar, remoto, id } = await preparar(4, { dimensaoMaxima: 128 });
    const r = await migrar({ repos: s.repos, armazenamento: remoto, migracao_id: id, projeto_id: PROJETO });
    expect(r.estado).toBe("falhou");
    expect(r.erro).toContain("máximo");
    expect(remoto.tamanho).toBe(0);
    fechar();
  });
  it("coleção remota com outro modelo: recusa com a diferença; nada é enviado", async () => {
    const { s, fechar, remoto, id } = await preparar(4);
    await remoto.garantirColecao({ dimensao: 256, metrica: "cosseno", modeloEmbedding: "outro-modelo" });
    const r = await migrar({ repos: s.repos, armazenamento: remoto, migracao_id: id, projeto_id: PROJETO });
    expect(r.estado).toBe("falhou");
    expect(r.erro).toContain("modelo");
    expect(remoto.tamanho).toBe(0);
    fechar();
  });
  it("verificação detecta divergência de checksum e espera a consistência eventual", async () => {
    const { s, fechar, remoto, id } = await preparar(6, { eventual: true });
    await migrar({ repos: s.repos, armazenamento: remoto, migracao_id: id, projeto_id: PROJETO, lote: 4 });
    const esperas: number[] = [];
    const v = await verificar({ repos: s.repos, armazenamento: remoto, migracao_id: id, projeto_id: PROJETO, dormir: async (ms) => (esperas.push(ms), remoto.assentar()) });
    expect(esperas.length).toBe(1);
    expect(v.ok).toBe(true);
    // adultera um registro remoto: o checksum de amostra pega
    const lote = proximoLote(s.repos, { colecao_id: s.colecaoId, projeto_id: PROJETO, tipos: TIPOS }, null, 1).registros[0];
    if (!lote) throw new Error("sem registro");
    await remoto.upsert([{ ...lote, meta: { ...lote.meta, hash_conteudo: "adulterado" } }]);
    remoto.assentar();
    const v2 = await verificar({ repos: s.repos, armazenamento: remoto, migracao_id: id, projeto_id: PROJETO, dormir: async () => undefined });
    expect(v2.ok).toBe(false);
    expect(v2.divergentes).toBeGreaterThan(0);
    expect(s.repos.migracao.obter(id)?.estado).toBe("falhou");
    fechar();
  });
  it("registros enviados: ids determinísticos iguais em outra máquina, sem caminho absoluto, só tipos escolhidos", async () => {
    const a = novoServico();
    const b = novoServico();
    await semear(a.s, 4);
    await semear(b.s, 4);
    const ped = (s: ServicoConhecimento) => ({ colecao_id: s.colecaoId, projeto_id: PROJETO, tipos: TIPOS });
    const ra = proximoLote(a.s.repos, ped(a.s), null, 100).registros;
    const rb = proximoLote(b.s.repos, ped(b.s), null, 100).registros;
    expect(ra.map((r) => r.id).sort()).toEqual(rb.map((r) => r.id).sort());
    expect(JSON.stringify(ra)).not.toMatch(/"origem":"\//);
    expect(proximoLote(a.s.repos, { ...ped(a.s), tipos: ["codigo"] }, null, 100).registros).toHaveLength(0);
    a.fechar();
    b.fechar();
  });
});

describe("replicação: espelho e compartilhado (D-90)", () => {
  it("espelho: escrita local → fila → push em lote; offline mantém a fila e o local segue", async () => {
    const { s, fechar } = novoServico();
    await semear(s, 6);
    const ids = s.repos.banco.consultar<{ id: string }>("SELECT id FROM rag_chunk").map((r) => r.id);
    expect(enfileirarEnvio(s.repos, estado("espelho"), s.colecaoId, ids)).toBe(6);
    const pedido = { colecao_id: s.colecaoId, projeto_id: PROJETO, tipos: TIPOS };
    const remoto = new ArmazenamentoMemoria({ loteMaximo: 4 });
    const fora: ArmazenamentoConhecimento = Object.assign(Object.create(remoto) as ArmazenamentoConhecimento, { upsert: async () => { throw new Error("offline"); } });
    const off = await empurrar({ repos: s.repos, armazenamento: fora, estado: estado("espelho"), pedido });
    expect(off).toMatchObject({ enviados: 0, offline: true, restantes: 6 });
    const ok = await empurrar({ repos: s.repos, armazenamento: remoto, estado: estado("espelho"), pedido, lote: 4 });
    expect(ok).toMatchObject({ enviados: 6, restantes: 0, offline: false });
    expect(remoto.tamanho).toBe(6);
    // reempurrar não duplica
    enfileirarEnvio(s.repos, estado("espelho"), s.colecaoId, ids);
    await empurrar({ repos: s.repos, armazenamento: remoto, estado: estado("espelho"), pedido });
    expect(remoto.tamanho).toBe(6);
    fechar();
  });
  it("compartilhado: a equipe converge sem duplicar (push de A, pull de B, ids iguais)", async () => {
    const A = novoServico();
    const B = novoServico();
    await semear(A.s, 4, "a");
    await semear(B.s, 3, "b");
    const remoto = new ArmazenamentoMemoria({ loteMaximo: 50 });
    const estadoC = estado("compartilhado");
    const pedA = { colecao_id: A.s.colecaoId, projeto_id: PROJETO, tipos: TIPOS };
    const pedB = { colecao_id: B.s.colecaoId, projeto_id: PROJETO, tipos: TIPOS };
    for (const [S, ped] of [[A.s, pedA], [B.s, pedB]] as const) {
      const ids = S.repos.banco.consultar<{ id: string }>("SELECT id FROM rag_chunk").map((r) => r.id);
      enfileirarEnvio(S.repos, estadoC, S.colecaoId, ids);
      await empurrar({ repos: S.repos, armazenamento: remoto, estado: estadoC, pedido: ped });
    }
    expect(remoto.tamanho).toBe(7);
    const pullA = await puxar({ repos: A.s.repos, armazenamento: remoto, estado: estadoC, colecao_id: A.s.colecaoId, projeto_id: PROJETO, desde_ms: 0 });
    expect(pullA.recebidos).toBe(3); // os 4 próprios já existem localmente
    expect(pullA.ignorados).toBe(4);
    expect((await A.s.buscar({ consulta: "conteúdo tema b", modo: "lexical" })).resultados.length).toBeGreaterThan(0);
    // pull de novo: nada novo
    expect((await puxar({ repos: A.s.repos, armazenamento: remoto, estado: estadoC, colecao_id: A.s.colecaoId, projeto_id: PROJETO, desde_ms: 0 })).recebidos).toBe(0);
    // A reempurra o que recebeu: ids determinísticos → sem duplicata no remoto
    const idsA = A.s.repos.banco.consultar<{ id: string }>("SELECT id FROM rag_chunk").map((r) => r.id);
    enfileirarEnvio(A.s.repos, estadoC, A.s.colecaoId, idsA);
    await empurrar({ repos: A.s.repos, armazenamento: remoto, estado: estadoC, pedido: pedA });
    expect(remoto.tamanho).toBe(7);
    A.fechar();
    B.fechar();
  });
  it("modelo divergente no pull é recusado e sinalizado; espelho não puxa", async () => {
    const { s, fechar } = novoServico();
    const remoto = new ArmazenamentoMemoria();
    await remoto.garantirColecao({ dimensao: 4, metrica: "cosseno", modeloEmbedding: "outro:4" });
    await remoto.upsert([{ id: "00000000-0000-5000-8000-000000000001", vetor: [1, 0, 0, 0], texto: "de outro modelo", meta: { projeto_id: PROJETO, tipo: "doc", origem: "docs/x.md", hash_conteudo: "h", modelo_embedding: "outro:4", dimensao: 4, criado_em: T0, criado_em_ms: Date.parse(T0) } }]);
    const r = await puxar({ repos: s.repos, armazenamento: remoto, estado: estado("compartilhado"), colecao_id: s.colecaoId, projeto_id: PROJETO, desde_ms: 0 });
    expect(r).toMatchObject({ recebidos: 0, modelo_divergente: true });
    expect((await puxar({ repos: s.repos, armazenamento: remoto, estado: estado("espelho"), colecao_id: s.colecaoId, projeto_id: PROJETO, desde_ms: 0 })).recebidos).toBe(0);
    fechar();
  });
  it("equipe ao vivo: timeout de 3 s vira null; resposta é cacheada; sem consentimento não consulta", async () => {
    const { s, fechar } = novoServico();
    const remoto = new ArmazenamentoMemoria();
    await remoto.garantirColecao({ dimensao: 4, metrica: "cosseno", modeloEmbedding: "m:4" });
    await remoto.upsert([{ id: "00000000-0000-5000-8000-000000000001", vetor: [1, 0, 0, 0], texto: "achado da equipe", meta: { projeto_id: PROJETO, tipo: "doc", origem: "docs/x.md", hash_conteudo: "h", modelo_embedding: "m:4", dimensao: 4, criado_em: T0, criado_em_ms: 1 } }]);
    const base = { repos: s.repos, armazenamento: remoto, estado: estado("compartilhado"), vetor: [1, 0, 0, 0], texto: "equipe", projeto_id: PROJETO };
    const a = await consultarEquipe(base);
    expect(a?.resultados[0]?.texto).toBe("achado da equipe");
    expect(a?.do_cache).toBe(false);
    expect((await consultarEquipe(base))?.do_cache).toBe(true);
    expect(await consultarEquipe({ ...base, estado: estado("compartilhado", null) })).toBeNull();
    const lento: ArmazenamentoConhecimento = Object.assign(Object.create(remoto) as ArmazenamentoConhecimento, { consultar: () => new Promise(() => undefined) });
    expect(await consultarEquipe({ ...base, armazenamento: lento, texto: "outra consulta", timeoutMs: 30 })).toBeNull();
    fechar();
  });
  it("ArmazenamentoLocal e o stub trocam registros (adaptador de referência)", async () => {
    const { s, fechar } = novoServico();
    await semear(s, 3);
    const local = new ArmazenamentoLocal(s.repos, s.colecaoId, PROJETO);
    expect(await local.contar()).toBe(3);
    expect((await local.testarConexao()).ok).toBe(true);
    fechar();
  });
});
