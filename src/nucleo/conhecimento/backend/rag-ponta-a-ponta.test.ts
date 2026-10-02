// Ponta a ponta do backend online: núcleo local (SQLite) → migração/replicação → adaptadores HTTP reais → stub dos provedores em loopback.
// Prévia → consentir → migrar → queda no meio → retomar sem duplicata e sem perda → verificar; push/pull incremental; offline; modelo divergente.
import { afterEach, describe, expect, it } from "vitest";
import { doc, novoServico, T0 } from "../../../../tests/fixtures/conhecimento/util";
import { criarArmazenamentoStub, type ArmazenamentoStub } from "../../../../tests/fixtures/rag/ambiente";
import type { ProvedorStub } from "../../../../tests/fixtures/rag/servidor-stub";
import { POLITICA_VERSAO } from "../constantes";
import type { ServicoConhecimento } from "../servico";
import { TIPOS_MIGRAVEIS_PADRAO } from "./config";
import { proximoLote } from "./exportar";
import { consentir, criarPrevia, migrar, SemConsentimentoErro, verificar } from "./migracao";
import { empurrar, enfileirarEnvio, puxar, type EstadoReplicacao } from "./replicacao";

const PROVS: readonly ProvedorStub[] = ["qdrant", "supabase", "upstash", "pinecone"];
const PROJETO = "0123456789abcdef";
const TIPOS = TIPOS_MIGRAVEIS_PADRAO;
const nada = async (): Promise<void> => undefined;

const abertos: ArmazenamentoStub[] = [];
const fechaveis: Array<() => void> = [];
afterEach(async () => {
  while (abertos.length) await (abertos.pop() as ArmazenamentoStub).limpar();
  while (fechaveis.length) (fechaveis.pop() as () => void)();
});

async function semear(s: ServicoConhecimento, n: number, prefixo = "d", ocorrido = T0): Promise<void> {
  for (let i = 0; i < n; i++) await s.pipeline.ingerir(s.colecaoId, doc({ tipo: i % 2 === 0 ? "decisao" : "doc", origem: `docs/${prefixo}${i}.md`, titulo: `${prefixo}${i}`, ocorrido_em: ocorrido, texto: `# ${prefixo}${i}\n\nconteúdo número ${i} sobre o tema ${prefixo} ${"palavra ".repeat(i % 5)}` }));
}
function servico(): ServicoConhecimento {
  const n = novoServico();
  fechaveis.push(n.fechar);
  return n.s;
}
async function alvo(p: ProvedorStub, o: { loteMaximo?: number; eventual?: boolean; semConsentimento?: boolean } = {}): Promise<ArmazenamentoStub> {
  // dimensão 256 = a do embedding local de teste (hash-256-v1)
  const a = await criarArmazenamentoStub(p, { stub: { dimensao: 256, ...(o.eventual === true ? { modo: { eventual: true } } : {}) }, loteMaximo: o.loteMaximo ?? 4, ...(o.semConsentimento === true ? { semConsentimento: true } : {}) });
  abertos.push(a);
  return a;
}
const destinoDe = (a: ArmazenamentoStub): { provedor: string; host: string; colecao: string } => ({ provedor: a.stub.provedor, host: a.stub.host, colecao: a.stub.provedor === "supabase" ? "rag_conhecimento" : "col_teste" });
const consentimentoDe = (d: ReturnType<typeof destinoDe>) => ({ ...d, versao_politica: POLITICA_VERSAO, em: T0 });
const estado = (a: ArmazenamentoStub, modo: EstadoReplicacao["modo"]): EstadoReplicacao => ({ modo, consentimento: consentimentoDe(destinoDe(a)), destino: destinoDe(a) });
const idsLocais = (s: ServicoConhecimento): string[] => proximoLote(s.repos, { colecao_id: s.colecaoId, projeto_id: PROJETO, tipos: TIPOS }, null, 1000).registros.map((r) => r.id).sort();

describe.each(PROVS)("%s: migração local → online (ponta a ponta)", (p) => {
  const eventual = p === "upstash" || p === "pinecone";

  it("prévia (nada sai) → consentir → migrar → queda no meio → retomar → verificar: 0 duplicata, 0 perda", async () => {
    const s = servico();
    await semear(s, 12);
    const a = await alvo(p, { eventual });
    const d = destinoDe(a);
    const prev = criarPrevia({ repos: s.repos, pedido: { colecao_id: s.colecaoId, projeto_id: PROJETO, tipos: TIPOS }, destino: d });
    expect(prev.total).toBe(12);
    expect(a.stub.requisicoes).toHaveLength(0); // dry-run não toca o remoto
    await expect(migrar({ repos: s.repos, armazenamento: a.armazenamento, migracao_id: prev.migracao_id, projeto_id: PROJETO })).rejects.toBeInstanceOf(SemConsentimentoErro);
    expect(a.stub.requisicoes).toHaveLength(0);
    consentir(s.repos, prev.migracao_id, consentimentoDe(d));

    a.stub.modo.quedaAposUpserts = 3; // config + 2 lotes; depois o servidor "morre"
    const r1 = await migrar({ repos: s.repos, armazenamento: a.armazenamento, migracao_id: prev.migracao_id, projeto_id: PROJETO, lote: 4, tentativas: 1, dormir: nada });
    expect(r1.estado).toBe("falhou");
    expect(r1.enviados).toBeGreaterThan(0);
    expect(r1.enviados).toBeLessThan(12);
    expect(s.repos.migracao.obter(prev.migracao_id)).toMatchObject({ estado: "falhou", enviados: r1.enviados });
    expect(r1.erro).not.toContain("SENTINELA");
    const parcial = a.stub.registros().length;
    expect(parcial).toBeGreaterThanOrEqual(r1.enviados);

    a.stub.religar();
    const r2 = await migrar({ repos: s.repos, armazenamento: a.armazenamento, migracao_id: prev.migracao_id, projeto_id: PROJETO, lote: 4 });
    expect(r2).toMatchObject({ estado: "verificando", enviados: 12 });
    const remotos = a.stub.registros().map((r) => r.id);
    expect(new Set(remotos).size).toBe(remotos.length); // 0 duplicata
    expect(remotos.sort()).toEqual(idsLocais(s)); // 0 perda
    const v = await verificar({ repos: s.repos, armazenamento: a.armazenamento, migracao_id: prev.migracao_id, projeto_id: PROJETO, dormir: async () => a.assentar() });
    expect(v).toMatchObject({ ok: true, local: 12, remoto: 12, divergentes: 0 });
    expect(s.repos.migracao.obter(prev.migracao_id)?.estado).toBe("concluida");
    // reexecutar tudo de novo é seguro
    await migrar({ repos: s.repos, armazenamento: a.armazenamento, migracao_id: prev.migracao_id, projeto_id: PROJETO, lote: 4 }).catch(() => undefined);
    expect(a.stub.registros()).toHaveLength(12);
  });

  it("pausa por sinal no meio preserva o cursor e retoma até o fim", async () => {
    const s = servico();
    await semear(s, 10);
    const a = await alvo(p, { eventual });
    const d = destinoDe(a);
    const prev = criarPrevia({ repos: s.repos, pedido: { colecao_id: s.colecaoId, projeto_id: PROJETO, tipos: TIPOS }, destino: d });
    consentir(s.repos, prev.migracao_id, consentimentoDe(d));
    const ctl = new AbortController();
    const r1 = await migrar({ repos: s.repos, armazenamento: a.armazenamento, migracao_id: prev.migracao_id, projeto_id: PROJETO, lote: 4, sinal: ctl.signal, aoProgresso: () => ctl.abort() });
    expect(r1.estado).toBe("pausada");
    expect(s.repos.migracao.obter(prev.migracao_id)?.enviados).toBe(4);
    expect(a.stub.registros()).toHaveLength(4);
    const r2 = await migrar({ repos: s.repos, armazenamento: a.armazenamento, migracao_id: prev.migracao_id, projeto_id: PROJETO, lote: 4 });
    expect(r2.enviados).toBe(10);
    expect(a.stub.registros().map((r) => r.id).sort()).toEqual(idsLocais(s));
  });

  it("429/5xx intermitentes do provedor: o transporte repete e a migração conclui sem perda", async () => {
    const s = servico();
    await semear(s, 9);
    const a = await alvo(p, { eventual });
    a.stub.modo.falhaIntermitente = { status: p === "qdrant" ? 429 : 503, cada: 3 };
    const d = destinoDe(a);
    const prev = criarPrevia({ repos: s.repos, pedido: { colecao_id: s.colecaoId, projeto_id: PROJETO, tipos: TIPOS }, destino: d });
    consentir(s.repos, prev.migracao_id, consentimentoDe(d));
    const r = await migrar({ repos: s.repos, armazenamento: a.armazenamento, migracao_id: prev.migracao_id, projeto_id: PROJETO, lote: 4 });
    expect(r.estado).toBe("verificando");
    expect(a.stub.registros().map((x) => x.id).sort()).toEqual(idsLocais(s));
  });

  it("consentimento gravado mas host não consentido no transporte: nada sai (zero conexões)", async () => {
    const s = servico();
    await semear(s, 4);
    const a = await alvo(p, { semConsentimento: true });
    const d = destinoDe(a);
    const prev = criarPrevia({ repos: s.repos, pedido: { colecao_id: s.colecaoId, projeto_id: PROJETO, tipos: TIPOS }, destino: d });
    consentir(s.repos, prev.migracao_id, consentimentoDe(d));
    const r = await migrar({ repos: s.repos, armazenamento: a.armazenamento, migracao_id: prev.migracao_id, projeto_id: PROJETO, tentativas: 1, dormir: nada });
    expect(r.estado).toBe("falhou");
    expect(r.erro).toBeTruthy();
    expect(a.stub.conexoes()).toBe(0);
    expect(a.stub.requisicoes).toHaveLength(0);
  });

  it("coleção remota com outro modelo: recusada com a diferença; nada é enviado", async () => {
    const s = servico();
    await semear(s, 4);
    const a = await alvo(p);
    await a.novoCliente().armazenamento.garantirColecao({ dimensao: 256, metrica: "cosseno", modeloEmbedding: "outro-modelo" });
    const d = destinoDe(a);
    const prev = criarPrevia({ repos: s.repos, pedido: { colecao_id: s.colecaoId, projeto_id: PROJETO, tipos: TIPOS }, destino: d });
    consentir(s.repos, prev.migracao_id, consentimentoDe(d));
    const r = await migrar({ repos: s.repos, armazenamento: a.armazenamento, migracao_id: prev.migracao_id, projeto_id: PROJETO });
    expect(r.estado).toBe("falhou");
    expect(r.erro).toMatch(/modelo/);
    expect(a.stub.registros()).toHaveLength(0);
  });
});

describe.each(PROVS)("%s: replicação (espelho e compartilhado)", (p) => {
  const eventual = p === "upstash" || p === "pinecone";

  it("compartilhado: A empurra, B puxa de forma incremental; reempurrar não duplica; ids iguais", async () => {
    const A = servico();
    const B = servico();
    await semear(A, 5, "a");
    await semear(B, 3, "b");
    const a = await alvo(p, { eventual, loteMaximo: 50 });
    const est = estado(a, "compartilhado");
    const pedA = { colecao_id: A.colecaoId, projeto_id: PROJETO, tipos: TIPOS };
    const pedB = { colecao_id: B.colecaoId, projeto_id: PROJETO, tipos: TIPOS };
    for (const [S, ped] of [[A, pedA], [B, pedB]] as const) {
      enfileirarEnvio(S.repos, est, S.colecaoId, S.repos.banco.consultar<{ id: string }>("SELECT id FROM rag_chunk").map((r) => r.id));
      expect((await empurrar({ repos: S.repos, armazenamento: a.armazenamento, estado: est, pedido: ped })).offline).toBe(false);
    }
    expect(a.stub.registros()).toHaveLength(8);
    const pull = await puxar({ repos: A.repos, armazenamento: a.armazenamento, estado: est, colecao_id: A.colecaoId, projeto_id: PROJETO, desde_ms: 0 });
    expect(pull).toMatchObject({ recebidos: 3, ignorados: 5, modelo_divergente: false });
    // incremental: só o que for mais novo que `ultimo_ms`
    const T1 = "2026-09-05T10:00:00.000Z";
    await semear(B, 2, "novo", T1);
    enfileirarEnvio(B.repos, est, B.colecaoId, B.repos.banco.consultar<{ id: string }>("SELECT id FROM rag_chunk").map((r) => r.id));
    await empurrar({ repos: B.repos, armazenamento: a.armazenamento, estado: est, pedido: pedB });
    expect(a.stub.registros()).toHaveLength(10);
    const incr = await puxar({ repos: A.repos, armazenamento: a.armazenamento, estado: est, colecao_id: A.colecaoId, projeto_id: PROJETO, desde_ms: Date.parse(T0) });
    expect(incr.recebidos).toBe(2);
    expect((await puxar({ repos: A.repos, armazenamento: a.armazenamento, estado: est, colecao_id: A.colecaoId, projeto_id: PROJETO, desde_ms: Date.parse(T1) })).recebidos).toBe(0);
    // reempurrar tudo de A: sem duplicata
    enfileirarEnvio(A.repos, est, A.colecaoId, A.repos.banco.consultar<{ id: string }>("SELECT id FROM rag_chunk").map((r) => r.id));
    await empurrar({ repos: A.repos, armazenamento: a.armazenamento, estado: est, pedido: pedA });
    expect(a.stub.registros()).toHaveLength(10);
  });

  it("offline: o push falha sem perder a fila e sem tocar no local; ao voltar a rede a fila escoa", async () => {
    const S = servico();
    await semear(S, 6);
    const a = await alvo(p, { eventual, loteMaximo: 50 });
    const est = estado(a, "espelho");
    const ped = { colecao_id: S.colecaoId, projeto_id: PROJETO, tipos: TIPOS };
    enfileirarEnvio(S.repos, est, S.colecaoId, S.repos.banco.consultar<{ id: string }>("SELECT id FROM rag_chunk").map((r) => r.id));
    a.stub.derrubar();
    const off = await empurrar({ repos: S.repos, armazenamento: a.armazenamento, estado: est, pedido: ped });
    expect(off).toMatchObject({ enviados: 0, offline: true, restantes: 6 });
    a.stub.religar();
    const ok = await empurrar({ repos: S.repos, armazenamento: a.armazenamento, estado: est, pedido: ped });
    expect(ok).toMatchObject({ enviados: 6, restantes: 0, offline: false });
    expect(a.stub.registros()).toHaveLength(6);
  });

  it("modelo divergente no pull é recusado e sinalizado", async () => {
    const S = servico();
    const a = await alvo(p, { loteMaximo: 50 });
    const outro = a.novoCliente().armazenamento;
    await outro.garantirColecao({ dimensao: 256, metrica: "cosseno", modeloEmbedding: "outro:256" });
    await outro.upsert([{ id: "00000000-0000-5000-8000-000000000001", vetor: Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0)), texto: "de outro modelo", meta: { projeto_id: PROJETO, tipo: "doc", origem: "docs/x.md", hash_conteudo: "h", modelo_embedding: "outro:256", dimensao: 256, criado_em: T0, criado_em_ms: Date.parse(T0) } }]);
    a.assentar();
    const r = await puxar({ repos: S.repos, armazenamento: a.armazenamento, estado: estado(a, "compartilhado"), colecao_id: S.colecaoId, projeto_id: PROJETO, desde_ms: 0 });
    expect(r).toMatchObject({ recebidos: 0, modelo_divergente: true });
  });
});

describe("P-80: migração online com lote de 200 (qdrant + stub)", () => {
  it("main sem tarefa > 50 ms durante a migração, lote de 200, retomada continua do cursor", async () => {
    const fator = Number(process.env.EXPXV_PERF_FATOR ?? 1);
    const s = servico();
    await semear(s, 260);
    const a = await criarArmazenamentoStub("qdrant", { loteMaximo: 200 });
    abertos.push(a);
    const d = destinoDe(a);
    const prev = criarPrevia({ repos: s.repos, pedido: { colecao_id: s.colecaoId, projeto_id: PROJETO, tipos: TIPOS }, destino: d });
    consentir(s.repos, prev.migracao_id, consentimentoDe(d));
    let maior = 0;
    let ultimo = performance.now();
    const t = setInterval(() => {
      const agora = performance.now();
      maior = Math.max(maior, agora - ultimo - 5);
      ultimo = agora;
    }, 5);
    const antes = process.memoryUsage();
    a.stub.modo.quedaAposUpserts = 2; // config + 1º lote de 200; cai antes do 2º
    const r1 = await migrar({ repos: s.repos, armazenamento: a.armazenamento, migracao_id: prev.migracao_id, projeto_id: PROJETO, lote: 200, tentativas: 1, dormir: nada });
    expect(r1.estado).toBe("falhou");
    expect(r1.enviados).toBe(200);
    a.stub.religar();
    const r2 = await migrar({ repos: s.repos, armazenamento: a.armazenamento, migracao_id: prev.migracao_id, projeto_id: PROJETO, lote: 200 });
    clearInterval(t);
    expect(r2).toMatchObject({ estado: "verificando", enviados: 260 });
    const remotos = a.stub.registros().map((r) => r.id);
    expect(new Set(remotos).size).toBe(260);
    expect(remotos.sort()).toEqual(idsLocais(s));
    expect(maior).toBeLessThanOrEqual(50 * fator);
    // RSS extra ≤ 30 MB (o RSS do worker de teste oscila com a carga da máquina: vale também o heap, que mede o que a migração retém)
    const depois = process.memoryUsage();
    const teto = 30 * 1024 * 1024 * fator;
    expect(Math.min(depois.rss - antes.rss, depois.heapUsed - antes.heapUsed)).toBeLessThanOrEqual(teto);
  });
});
