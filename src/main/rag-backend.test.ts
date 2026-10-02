// Backend online do RAG no main (Fase 15, D-90..D-92), de PONTA A PONTA sem rede real: worker em processo, cliente de rede real em loopback,
// stub do Qdrant. Prova: nada sai sem consentimento; segredo só no cofre (nunca na config, no evento nem no log); consentimento por destino;
// migração retomável e verificada; espelho; voltar para local; apagar remoto com confirmação digitada.
import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { criarTmp, limpar, novoBanco } from "../../tests/fixtures/dominio/ambiente";
import { CHAVE_SEMENTE } from "../../tests/fixtures/rag/ambiente";
import { subirStubRag, type StubRag } from "../../tests/fixtures/rag/servidor-stub";
import type { CanaisEvento } from "../compartilhado/ipc";
import { POLITICA_VERSAO } from "../nucleo/conhecimento/constantes";
import type { PortaCofreRag } from "../nucleo/conhecimento/backend/config";
import type { ThreadDoWorker } from "../nucleo/conhecimento/worker/host";
import type { EventoConhecimento } from "../nucleo/memoria/eventos-conhecimento";
import { criarClienteRede } from "../nucleo/rede/cliente-http";
import { criarRegistroConsentimento } from "../nucleo/rede/consentimento";
import { criarBarramento } from "./barramento";
import { ligarConhecimento } from "./conhecimento";
import { montarWorkerConhecimento, type DadosDoWorkerConhecimento } from "./conhecimento-worker";
import { criarRagBackend } from "./rag-backend";

afterEach(limpar);
const fecharTudo: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (fecharTudo.length) await (fecharTudo.pop() as () => void | Promise<void>)();
});
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function cofreFalso(): PortaCofreRag & { dados: Map<string, string> } {
  const dados = new Map<string, string>();
  return { dados, guardar: async (n, v) => void dados.set(n, v), existe: async (n) => dados.has(n), apagar: async (n) => void dados.delete(n), obter: async (n) => dados.get(n) ?? null };
}

const evento = (ws: string, id: string, texto: string, titulo = "Decisão"): EventoConhecimento => ({ versao: 1, id, tipo: "memory.decision", ocorrido_em: "2026-09-01T10:00:00.000Z", workspace_id: ws, mission_id: null, pane_id: null, linhagem_id: null, fonte: "agente", importancia: 4, titulo, texto, referencias: [], tags: [] });

async function montar() {
  const stub: StubRag = await subirStubRag({ provedor: "qdrant", chave: CHAVE_SEMENTE, dimensao: 256 });
  fecharTudo.push(() => stub.fechar());
  const { banco, repos } = novoBanco();
  const dados = criarTmp("rag-dados-");
  const raiz = criarTmp("rag-ws-");
  const ws = repos.workspace.criar({ nome: "meu-projeto", raiz });
  const metodosDoMain: Record<string, (a: unknown[], s: AbortSignal) => unknown> = {};
  const enviados: Array<{ canal: string; payload: unknown }> = [];
  const enviar = <C extends keyof CanaisEvento>(canal: C, payload: CanaisEvento[C]): void => void enviados.push({ canal, payload });
  const lig = ligarConhecimento({
    banco,
    repos,
    barramento: criarBarramento(),
    pastaDados: dados,
    home: null,
    caminhoWorker: "/nao-usado",
    criarThread: (d: DadosDoWorkerConhecimento): ThreadDoWorker => {
      const c = new MessageChannel();
      const w = montarWorkerConhecimento(c.port2, d);
      fecharTudo.push(() => (w.parar(), c.port1.close(), c.port2.close()));
      return { porta: c.port1, aoSair: () => undefined, encerrar: () => undefined };
    },
    preferencias: { obter: () => null },
    enviar,
    escolherArquivoDeSaida: async () => null,
    ocioso: () => true,
    metodosDoMain,
  });
  fecharTudo.push(() => lig.encerrar());
  const consentimento = criarRegistroConsentimento();
  const cofre = cofreFalso();
  const logs: string[] = [];
  const rag = criarRagBackend({
    lig,
    config: repos.config,
    cofre,
    rede: criarClienteRede({ consentimento, permitirLoopbackHttp: true, log: (l) => logs.push(l) }),
    consentimento,
    enviar,
    remoteGit: async () => null,
    agendar: (fn, ms) => {
      const t = setInterval(fn, Math.min(ms, 50));
      return { cancelar: () => clearInterval(t) };
    },
  });
  Object.assign(metodosDoMain, rag.metodosDoMain);
  lig.aoAbrirWorkspace(rag.aoAbrir);
  fecharTudo.push(() => rag.encerrar());
  const m = rag.manipuladores;
  const configurar = {
    workspace_id: ws.id,
    provedor: "qdrant" as const,
    url: stub.url,
    colecao_remota: "col_teste",
    campos_secretos: { api_key: CHAVE_SEMENTE },
    modo: "espelho" as const,
    tipos: ["aprendizado", "decisao", "doc"] as Array<"aprendizado" | "decisao" | "doc">,
  };
  const semear = async (n: number, prefixo = "e"): Promise<void> => {
    for (let i = 0; i < n; i++) lig.portaConhecimento.registrar(evento(ws.id, `${prefixo}${i}`, `Decisão ${prefixo}${i}: a rotina zanzibar${i} cuida da exportação número ${i}.`, `Decisão ${prefixo}${i}`));
    await esperar(40);
    for (let i = 0; i < 20; i++) {
      const p = await lig.chamarWs<{ pendentes: number }>(ws.id, "passo", [{ ocioso: true }]);
      if (p.pendentes === 0) break;
    }
  };
  return { stub, repos, ws, lig, rag, m, cofre, enviados, logs, configurar, semear, consentimento };
}

const consent = (stub: StubRag, colecao = "col_teste", host: string = stub.host) => ({ provedor: "qdrant", host, colecao, versao_politica: POLITICA_VERSAO });
async function aguardarEstado(m: Awaited<ReturnType<typeof montar>>, migracao: string, estados: string[]): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const e = await m.m["rag:backend_estado"]({ workspace_id: m.ws.id });
    if (e.migracao_ativa?.migracao_id === migracao && estados.includes(e.migracao_ativa.estado)) return e.migracao_ativa.estado;
    await esperar(25);
  }
  const dbg = await m.lig.chamarWs(m.ws.id, "ragMigracao", [migracao]);
  throw new Error(`migração não chegou ao estado esperado: ${JSON.stringify(dbg)} ${JSON.stringify(m.stub.requisicoes.slice(0, 3))}`);
}

describe("backend online do RAG (ponta a ponta, sem rede real)", () => {
  it("configurar guarda o segredo SÓ no cofre (a config e o estado só têm a máscara) e nada sai sem consentimento", async () => {
    const m = await montar();
    await m.semear(6);
    const r = await m.m["rag:backend_configurar"](m.configurar);
    expect(r.ok).toBe(true);
    expect(r.mascarado["api_key"]).toMatch(/^••••/);
    expect([...m.cofre.dados.values()]).toContain(CHAVE_SEMENTE);
    const gravado = JSON.stringify(m.repos.config.listar());
    expect(gravado).not.toContain(CHAVE_SEMENTE);
    const est = await m.m["rag:backend_estado"]({ workspace_id: m.ws.id });
    expect(JSON.stringify(est)).not.toContain(CHAVE_SEMENTE);
    expect(est).toMatchObject({ provedor: "qdrant", modo: "espelho", consentimento: null });
    // modo espelho SEM consentimento válido: nada é enfileirado nem enviado
    await m.semear(2, "x");
    expect(await m.m["rag:sincronizar"]({ workspace_id: m.ws.id })).toEqual({ enviados: 0, recebidos: 0 });
    expect(m.stub.requisicoes).toHaveLength(0);
    expect(m.stub.registros()).toHaveLength(0);
  });

  it("testar (usar o salvo) autentica com a chave certa, sem gravar nem criar coleção", async () => {
    const m = await montar();
    await m.m["rag:backend_configurar"](m.configurar);
    const t = await m.m["rag:backend_testar"]({ workspace_id: m.ws.id, usar_salvo: true });
    expect(t.ok).toBe(true);
    expect(m.stub.registros()).toHaveLength(0);
    expect(m.stub.colecoes()).toEqual([]);
    expect(m.stub.requisicoes.length).toBeGreaterThan(0);
    // chave errada → 401 traduzido em motivo SEM a credencial
    const ruim = await m.m["rag:backend_testar"]({ ...m.configurar, campos_secretos: { api_key: "chave-errada-9999" } });
    expect(ruim.ok).toBe(false);
    expect(JSON.stringify(ruim)).not.toContain("chave-errada-9999");
  });

  it("prévia (nada sai) → consentimento do destino certo → migração → verificar; consentimento de outro destino é recusado", async () => {
    const m = await montar();
    await m.semear(8);
    await m.m["rag:backend_configurar"]({ ...m.configurar, modo: "local" });
    const previa = await m.m["rag:migracao_previa"]({ workspace_id: m.ws.id, tipos: ["aprendizado", "decisao", "doc"] });
    expect(previa.total).toBeGreaterThan(0);
    expect(previa.amostra.length).toBeGreaterThan(0);
    expect(previa.avisos.join(" ")).toContain("sairá da máquina");
    expect(previa.destino).toMatchObject({ provedor: "qdrant", host: "127.0.0.1", colecao: "col_teste", versao_politica: POLITICA_VERSAO });
    expect(m.stub.registros()).toHaveLength(0);
    await expect(m.m["rag:migracao_iniciar"]({ workspace_id: m.ws.id, previa_id: previa.previa_id, consentimento: consent(m.stub, "outra_colecao") })).rejects.toThrow("não corresponde");
    await expect(m.m["rag:migracao_iniciar"]({ workspace_id: m.ws.id, previa_id: previa.previa_id, consentimento: { ...consent(m.stub), versao_politica: POLITICA_VERSAO + 1 } })).rejects.toThrow("não corresponde");
    expect(m.stub.registros()).toHaveLength(0);
    const { migracao_id } = await m.m["rag:migracao_iniciar"]({ workspace_id: m.ws.id, previa_id: previa.previa_id, consentimento: consent(m.stub) });
    await aguardarEstado(m, migracao_id, ["verificando", "concluida"]);
    const v = await m.m["rag:migracao_verificar"]({ migracao_id });
    expect(v).toMatchObject({ ok: true, divergentes: 0 });
    expect(m.stub.registros().length).toBe(previa.total);
    // a chave só foi no cabeçalho: nunca em evento nem no log do cliente de rede; o texto indexado já estava redigido
    expect(JSON.stringify(m.enviados)).not.toContain(CHAVE_SEMENTE);
    expect(m.logs.join("\n")).not.toContain(CHAVE_SEMENTE);
    expect(m.enviados.some((e) => e.canal === "rag:migracao_progresso")).toBe(true);
    const est = await m.m["rag:backend_estado"]({ workspace_id: m.ws.id });
    expect(est.consentimento).toMatchObject({ host: "127.0.0.1", colecao: "col_teste", versao_politica: POLITICA_VERSAO });
  });

  it("espelho com consentimento: conhecimento novo entra na fila e sobe ao sincronizar; voltar para local revoga e para de enviar", async () => {
    const m = await montar();
    await m.semear(4);
    await m.m["rag:backend_configurar"](m.configurar);
    const previa = await m.m["rag:migracao_previa"]({ workspace_id: m.ws.id, tipos: m.configurar.tipos });
    const { migracao_id } = await m.m["rag:migracao_iniciar"]({ workspace_id: m.ws.id, previa_id: previa.previa_id, consentimento: consent(m.stub) });
    await aguardarEstado(m, migracao_id, ["verificando", "concluida"]);
    const antes = m.stub.registros().length;
    await m.semear(3, "novo");
    const est = await m.m["rag:backend_estado"]({ workspace_id: m.ws.id });
    expect(est.pendentes_envio).toBeGreaterThan(0);
    const s = await m.m["rag:sincronizar"]({ workspace_id: m.ws.id });
    expect(s.enviados).toBeGreaterThan(0);
    expect(m.stub.registros().length).toBeGreaterThan(antes);
    // voltar para local: o modo muda, o consentimento é revogado, nada local nem remoto é apagado
    await m.m["rag:voltar_para_local"]({ workspace_id: m.ws.id, baixar_do_remoto: false });
    const local = await m.m["rag:backend_estado"]({ workspace_id: m.ws.id });
    expect(local).toMatchObject({ modo: "local", consentimento: null, pendentes_envio: 0 });
    const depois = m.stub.registros().length;
    await m.semear(2, "pos");
    expect(await m.m["rag:sincronizar"]({ workspace_id: m.ws.id })).toEqual({ enviados: 0, recebidos: 0 });
    expect(m.stub.registros().length).toBe(depois);
    expect(((await m.lig.manipuladores["conhecimento:estado"]({ workspace_id: m.ws.id })).documentos)).toBeGreaterThan(0);
  });

  it("a ponte `rede.rag` recusa host diferente do configurado, e sem consentimento válido não abre socket", async () => {
    const m = await montar();
    await m.m["rag:backend_configurar"](m.configurar);
    const ponte = m.rag.metodosDoMain["rede.rag"] as (a: unknown[], s: AbortSignal) => Promise<unknown>;
    const sinal = new AbortController().signal;
    await expect(ponte([{ ws: m.ws.id, host: "127.0.0.1", caminho: "/collections", metodo: "GET" }], sinal)).rejects.toThrow("consent_required");
    await expect(ponte([{ ws: m.ws.id, host: "evil.example.com", caminho: "/x", metodo: "GET" }], sinal)).rejects.toThrow("consent_required");
    await expect(ponte([{ ws: "ws_01J8ZXAMPLE00000000000A1", host: "127.0.0.1", caminho: "/x", metodo: "GET" }], sinal)).rejects.toThrow("consent_required");
    expect(m.stub.requisicoes).toHaveLength(0);
  });

  it("apagar remoto exige o nome da coleção digitado e consentimento válido; só apaga o projeto", async () => {
    const m = await montar();
    await m.semear(3);
    await m.m["rag:backend_configurar"]({ ...m.configurar, modo: "local" });
    await expect(m.m["rag:remoto_apagar"]({ workspace_id: m.ws.id, confirmacao: "col_teste" })).rejects.toThrow("consentimento");
    const previa = await m.m["rag:migracao_previa"]({ workspace_id: m.ws.id, tipos: m.configurar.tipos });
    const { migracao_id } = await m.m["rag:migracao_iniciar"]({ workspace_id: m.ws.id, previa_id: previa.previa_id, consentimento: consent(m.stub) });
    await aguardarEstado(m, migracao_id, ["verificando", "concluida"]);
    expect(m.stub.registros().length).toBeGreaterThan(0);
    await expect(m.m["rag:remoto_apagar"]({ workspace_id: m.ws.id, confirmacao: "errado" })).rejects.toThrow("confirmação");
    await m.m["rag:remoto_apagar"]({ workspace_id: m.ws.id, confirmacao: "col_teste" });
    expect(m.stub.registros()).toHaveLength(0);
  });

  it("trocar o destino invalida o consentimento (pede de novo) e esquecer o segredo apaga do cofre", async () => {
    const m = await montar();
    await m.semear(3);
    await m.m["rag:backend_configurar"](m.configurar);
    const previa = await m.m["rag:migracao_previa"]({ workspace_id: m.ws.id, tipos: m.configurar.tipos });
    const { migracao_id } = await m.m["rag:migracao_iniciar"]({ workspace_id: m.ws.id, previa_id: previa.previa_id, consentimento: consent(m.stub) });
    await aguardarEstado(m, migracao_id, ["verificando", "concluida"]);
    await m.m["rag:backend_configurar"]({ ...m.configurar, colecao_remota: "outra_colecao", campos_secretos: {} });
    expect((await m.m["rag:backend_estado"]({ workspace_id: m.ws.id })).consentimento).toBeNull();
    const antes = m.stub.requisicoes.length;
    expect(await m.m["rag:sincronizar"]({ workspace_id: m.ws.id })).toEqual({ enviados: 0, recebidos: 0 });
    expect(m.stub.requisicoes.length).toBe(antes);
    await m.m["rag:backend_esquecer_segredo"]({ provedor: "qdrant" });
    expect(m.cofre.dados.size).toBe(0);
    expect((await m.m["rag:backend_estado"]({ workspace_id: m.ws.id })).segredos).toEqual({});
  });
});
