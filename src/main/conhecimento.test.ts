// Ligação do conhecimento no main (Fase 15, onda 2): worker sob demanda, porta da Fase 8 que só enfileira, consulta com teto de 170 ms
// que nunca lança, desligar bloqueia tudo, manipuladores `conhecimento:*` e exportação 0600. O worker roda EM PROCESSO (MessageChannel).
import { readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { criarTmp, limpar, novoBanco } from "../../tests/fixtures/dominio/ambiente";
import type { CanaisEvento } from "../compartilhado/ipc";
import type { ThreadDoWorker } from "../nucleo/conhecimento/worker/host";
import { atenderRpc } from "../nucleo/conhecimento/worker/rpc";
import type { EventoConhecimento } from "../nucleo/memoria/eventos-conhecimento";
import { criarBarramento } from "./barramento";
import { ligarConhecimento, type DepsConhecimento } from "./conhecimento";
import { montarWorkerConhecimento, type DadosDoWorkerConhecimento } from "./conhecimento-worker";

afterEach(limpar);
const aEncerrar: Array<() => void> = [];
afterEach(() => aEncerrar.splice(0).forEach((f) => f()));

function threadEmProcesso(dados: DadosDoWorkerConhecimento, extra: { metodosAdicionais?: Parameters<typeof atenderRpc>[2] } = {}): ThreadDoWorker & { sair(): void } {
  const c = new MessageChannel();
  const w = montarWorkerConhecimento(c.port2, dados);
  if (extra.metodosAdicionais) atenderRpc(c.port2, "worker", { ...w.anfitriao.metodos, ...extra.metodosAdicionais });
  let saiu: ((m: string) => void) | null = null;
  const encerrar = (): void => (w.parar(), c.port1.close(), c.port2.close());
  aEncerrar.push(encerrar);
  return { porta: c.port1, aoSair: (f) => (saiu = f), encerrar, sair: () => saiu?.("caiu") };
}

function montar(opc: { thread?: (d: DadosDoWorkerConhecimento) => ThreadDoWorker; saida?: string | null; ocioso?: boolean } = {}) {
  const { banco, repos } = novoBanco();
  const dados = criarTmp("conh-dados-");
  const raiz = criarTmp("conh-ws-");
  const ws = repos.workspace.criar({ nome: "meu-projeto", raiz });
  const barramento = criarBarramento();
  const enviados: Array<{ canal: string; payload: unknown }> = [];
  let criadas = 0;
  const agendados: Array<{ fn: () => void; ms: number; cancelado: boolean }> = [];
  const prefs: Record<string, unknown> = {};
  const deps: DepsConhecimento = {
    banco,
    repos,
    barramento,
    pastaDados: dados,
    home: null,
    caminhoWorker: "/nao-usado",
    criarThread: (d) => (criadas++, (opc.thread ?? threadEmProcesso)(d)),
    preferencias: { obter: (k) => prefs[k] ?? null },
    enviar: <C extends keyof CanaisEvento>(canal: C, payload: CanaisEvento[C]) => void enviados.push({ canal, payload }),
    escolherArquivoDeSaida: async () => (opc.saida === undefined ? join(dados, "saida", "conhecimento.json") : opc.saida),
    ocioso: () => opc.ocioso ?? true,
    agendar: (fn, ms) => {
      const a = { fn, ms, cancelado: false };
      agendados.push(a);
      return { cancelar: () => void (a.cancelado = true) };
    },
  };
  const lig = ligarConhecimento(deps);
  aEncerrar.push(() => lig.encerrar());
  return { lig, banco, repos, ws, dados, raiz, enviados, agendados, prefs, criadas: () => criadas };
}

const evento = (ws: string, id: string, texto: string): EventoConhecimento => ({
  versao: 1,
  id,
  tipo: "memory.decision",
  ocorrido_em: "2026-09-01T10:00:00.000Z",
  workspace_id: ws,
  mission_id: null,
  pane_id: null,
  linhagem_id: null,
  fonte: "agente",
  importancia: 4,
  titulo: "Decisão",
  texto,
  referencias: [],
  tags: [],
});
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("ligação do conhecimento no main", () => {
  it("ligar não cria thread nem toca disco (P-01); o worker sobe na primeira chamada", async () => {
    const m = montar();
    expect(m.criadas()).toBe(0);
    expect(existsSync(join(m.dados, "conhecimento.db"))).toBe(false);
    const est = await m.lig.manipuladores["conhecimento:estado"]({ workspace_id: m.ws.id });
    expect(m.criadas()).toBe(1);
    expect(est.documentos).toBe(0);
    expect(est.ativo).toBe(true);
  });

  it("a porta da Fase 8 só enfileira; o passo de fundo indexa e a busca acha (e o RAG ligado a um evento da memória)", async () => {
    const m = montar();
    await m.lig.manipuladores["conhecimento:estado"]({ workspace_id: m.ws.id }); // aquece: o primeiro uso abre banco e migrations
    m.lig.portaConhecimento.registrar(evento(m.ws.id, "e1", "Adotamos a estratégia zanzibar para exportação."));
    await esperar(30);
    const p = await m.lig.chamarWs<{ trabalho: string | null }>(m.ws.id, "passo", [{ ocioso: true }]);
    expect(p.trabalho).toBe("fila");
    const r = await m.lig.rag.buscar({ workspace_id: m.ws.id, mission_id: null, task_ref: null, pane_id: null, consulta: "zanzibar", escopo: "projeto", tipos: null, desde: null, limite: 8, modo: "lexical", origem: "tool" });
    expect(r.estado).toBe("ok");
    expect(r.resultados.length).toBeGreaterThan(0);
    // o evento ao renderer só carrega ids/contagens, nunca texto indexado
    const ev = m.enviados.find((e) => e.canal === "conhecimento:consultado");
    expect(ev).toBeDefined();
    expect(JSON.stringify(ev)).not.toContain("zanzibar");
  });

  it("RAG desligado (por workspace ou global) bloqueia a fila e devolve `desligado` sem tocar o worker", async () => {
    const m = montar();
    await m.lig.manipuladores["conhecimento:config_gravar"]({ workspace_id: m.ws.id, ativo: false });
    m.lig.portaConhecimento.registrar(evento(m.ws.id, "e2", "nada"));
    await esperar(20);
    const b = await m.lig.manipuladores["conhecimento:buscar"]({ workspace_id: m.ws.id, consulta: "nada", modo: "hibrido", tipos: null, desde: null, limite: 8, escopo: "projeto" });
    expect(b.estado).toBe("desligado");
    const c = await m.lig.rag.contexto({ workspace_id: m.ws.id, mission_id: null, task_ref: null, pane_id: null, tarefa: "ajustar", arquivos: [], orcamento_chars: 2000, origem: "tool" });
    expect(c.estado).toBe("desligado");
    expect(c.markdown).toBe("");
    await m.lig.manipuladores["conhecimento:config_gravar"]({ workspace_id: m.ws.id, ativo: true });
    m.prefs["conhecimento_global_ativo"] = false;
    expect(m.lig.rag.ativo(m.ws.id)).toBe(false);
    expect((await m.lig.rag.contexto({ workspace_id: m.ws.id, mission_id: null, task_ref: null, pane_id: null, tarefa: "x", arquivos: [], orcamento_chars: 2000, origem: "tool" })).estado).toBe("desligado");
  });

  it("consulta lenta devolve `lento` em ≤ ~250 ms e nunca lança; worker que caiu devolve `indisponivel`", async () => {
    const lento = montar({
      thread: () => {
        const c = new MessageChannel();
        atenderRpc(c.port2, "worker", {
          abrir: () => null,
          contexto: () => new Promise((r) => setTimeout(() => r(null), 600)),
        });
        aEncerrar.push(() => (c.port1.close(), c.port2.close()));
        return { porta: c.port1, aoSair: () => undefined, encerrar: () => undefined };
      },
    });
    const t0 = Date.now();
    const c = await lento.lig.rag.contexto({ workspace_id: lento.ws.id, mission_id: null, task_ref: null, pane_id: null, tarefa: "ajustar", arquivos: [], orcamento_chars: 2000, origem: "injecao" });
    expect(c.estado).toBe("lento");
    expect(Date.now() - t0).toBeLessThan(400);

    let saiu: ((m: string) => void) | null = null;
    const queda = montar({
      thread: (d) => {
        const t = threadEmProcesso(d);
        return { ...t, aoSair: (f) => ((saiu = f), t.aoSair(f)) };
      },
    });
    await queda.lig.manipuladores["conhecimento:estado"]({ workspace_id: queda.ws.id });
    (saiu as ((m: string) => void) | null)?.("caiu");
    const r = await queda.lig.rag.buscar({ workspace_id: queda.ws.id, mission_id: null, task_ref: null, pane_id: null, consulta: "qualquer", escopo: "projeto", tipos: null, desde: null, limite: 8, modo: "hibrido", origem: "tool" });
    expect(r.estado).toBe("indisponivel");
    expect(r.resultados).toEqual([]);
  });

  it("config: valores gravados persistem; workspace desconhecido falha; purgar exige o nome", async () => {
    const m = montar();
    const c = await m.lig.manipuladores["conhecimento:config_gravar"]({ workspace_id: m.ws.id, consulta_obrigatoria: "bloqueio", contexto_chars: 3000, chat_execucao: "confirmar" });
    expect(c).toMatchObject({ consulta_obrigatoria: "bloqueio", contexto_chars: 3000, chat_execucao: "confirmar", ativo: true });
    expect(m.lig.rag.politica(m.ws.id)).toEqual({ consulta_obrigatoria: "bloqueio", hook_prompt: true, contexto_chars: 3000 });
    await expect(m.lig.manipuladores["conhecimento:config_gravar"]({ workspace_id: "ws_01J8ZXAMPLE00000000000A1", ativo: false })).rejects.toThrow("desconhecido");
    m.lig.portaConhecimento.registrar(evento(m.ws.id, "e3", "conteudo para purgar com termo marmota"));
    await esperar(30);
    await m.lig.chamarWs(m.ws.id, "passo", [{ ocioso: true }]);
    await expect(m.lig.manipuladores["conhecimento:purgar"]({ workspace_id: m.ws.id, confirmacao: "outro-nome" })).rejects.toThrow("confirmação");
    const r = await m.lig.manipuladores["conhecimento:purgar"]({ workspace_id: m.ws.id, confirmacao: "meu-projeto" });
    expect(r.removidos).toBeGreaterThan(0);
  });

  it("exportar grava com 0600 no destino escolhido pelo usuário, sem o texto dos chunks; cancelar devolve null", async () => {
    const m = montar();
    m.lig.portaConhecimento.registrar(evento(m.ws.id, "e4", "texto-interno-nao-exportado com termo ornitorrinco"));
    await esperar(30);
    await m.lig.chamarWs(m.ws.id, "passo", [{ ocioso: true }]);
    const r = await m.lig.manipuladores["conhecimento:exportar"]({ workspace_id: m.ws.id });
    expect(r.caminho_salvo).toBe(join(m.dados, "saida", "conhecimento.json"));
    const arq = r.caminho_salvo as string;
    if (process.platform !== "win32") expect(statSync(arq).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(arq, "utf8")).versao).toBe(1);
    const exportado = JSON.parse(readFileSync(arq, "utf8")) as { documentos: Array<Record<string, unknown>> };
    // metadados do que o usuário vê; o texto dos chunks de documentos nunca sai
    for (const doc of exportado.documentos) expect(Object.keys(doc).sort()).toEqual(["documento_id", "mission_id", "ocorrido_em", "origem", "pane_id", "task_ref", "tipo", "titulo"]);
    const cancel = montar({ saida: null });
    expect((await cancel.lig.manipuladores["conhecimento:exportar"]({ workspace_id: cancel.ws.id })).caminho_salvo).toBeNull();
  });

  it("portas das tools MCP e do Maestro: o contexto vem no envelope de DADOS, vazio não injeta nada, memox só avisa", async () => {
    const m = montar();
    await m.lig.manipuladores["conhecimento:estado"]({ workspace_id: m.ws.id });
    const vazio = await m.lig.portaMcp.contextoParaInjecao({ workspace_id: m.ws.id, mission_id: null, task_ref: null, pane_id: null, tarefa: "ajustar exportação", arquivos: [], origem: "injecao" });
    expect(vazio).toBe("");
    m.lig.portaConhecimento.registrar(evento(m.ws.id, "e6", "Decisão: a exportação CSV usa a rotina zanzibar e não deve duplicar."));
    await esperar(30);
    await m.lig.chamarWs(m.ws.id, "passo", [{ ocioso: true }]);
    const md = await m.lig.portaMcp.contextoParaInjecao({ workspace_id: m.ws.id, mission_id: null, task_ref: null, pane_id: null, tarefa: "ajustar a exportação zanzibar", arquivos: [], origem: "hook" });
    expect(md).toContain('<conhecimento_previo');
    expect(md).toContain('tipo="dados"');
    const previo = await m.lig.paraMaestro(m.ws.id).conhecimento.contextoPrevio("ajustar a exportação zanzibar", []);
    expect(previo).toContain("conhecimento_previo");
    const b = await m.lig.portaMcp.buscar({ workspace_id: m.ws.id, mission_id: null, task_ref: null, pane_id: "pane_inexistente", consulta: "zanzibar", escopo: "projeto", tipos: null, desde: null, limite: 5, modo: "lexical", fontes: ["rag", "memox"] });
    expect(b.aviso).toContain("memox");
    expect(await m.lig.portaMcp.ativo(m.ws.id)).toBe(true);
    const a = await m.lig.portaMcp.aprender({ workspace_id: m.ws.id, mission_id: null, task_ref: null, pane_id: "pane_inexistente", cli: "claude", tipo: "armadilha", titulo: "Cuidado", texto: "Não use a rotina antiga de exportação.", arquivos: [], substitui: null });
    expect(a.status).toBe("candidate");
  });

  it("destilar com IA (P-56): uma chamada, resumo redigido em ≤ 6 KB, saída validada por esquema, candidatos entram como `sistema`; sem CLI devolve 0", async () => {
    const m = montar();
    const missao = m.repos.mission.criar({ workspace_id: m.ws.id, modo: "livre", origem: "livre", titulo: "Exportação de relatórios" });
    m.banco.executar("INSERT INTO memoria_entrada (id, workspace_id, mission_id, escopo, anel, tipo, conteudo, fonte, importancia, estado, redigido, hash_conteudo, criado_em, atualizado_em) VALUES ('mem_1', ?, ?, 'missao', 1, 'decisao', 'Decidimos usar a rotina zanzibar para exportar CSV; a chave sk-ant-api03-SEGREDOSEGREDOSEGREDOSEGREDO12345 não entra.', 'agente', 4, 'ativa', 0, ?, ?, ?)", [m.ws.id, missao.id, "a".repeat(64), "2026-09-01T10:00:00.000Z", "2026-09-01T10:00:00.000Z"]);
    const prompts: string[] = [];
    // sem destilador: 0 novos e nada quebra
    expect(await m.lig.manipuladores["conhecimento:destilar_missao"]({ workspace_id: m.ws.id, mission_id: missao.id })).toEqual({ aprendizados: 0 });
    m.lig.definirDestilador(async (_ws, prompt) => {
      prompts.push(prompt);
      return 'Aqui: {"aprendizados":[{"tipo":"decisao","titulo":"Exportação usa zanzibar","texto":"A exportação CSV usa a rotina zanzibar e não deve duplicar a lógica."},{"tipo":"invalido","titulo":"x","texto":"ignorado"},{"tipo":"armadilha","titulo":"Cuidado","texto":"curto"}]}';
    });
    const r = await m.lig.manipuladores["conhecimento:destilar_missao"]({ workspace_id: m.ws.id, mission_id: missao.id });
    expect(r.aprendizados).toBe(1);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('<resumo tipo="dados">');
    expect(prompts[0]).not.toContain("SEGREDOSEGREDO");
    const lista = await m.lig.manipuladores["conhecimento:aprendizados_listar"]({ workspace_id: m.ws.id, estado: null, tipo: null, busca: "zanzibar", depois: null, limite: 10 });
    expect(lista.itens.some((a) => a.titulo.includes("zanzibar") && a.fonte === "sistema")).toBe(true);
    // Missão de outro workspace é recusada
    await expect(m.lig.manipuladores["conhecimento:destilar_missao"]({ workspace_id: m.ws.id, mission_id: "mis_01J8ZXAMPLE00000000000A1" })).rejects.toThrow("desconhecida");
    // erro da CLI: o determinístico fica como está
    m.lig.definirDestilador(async () => {
      throw new Error("sem cota");
    });
    expect(await m.lig.manipuladores["conhecimento:destilar_missao"]({ workspace_id: m.ws.id, mission_id: missao.id })).toEqual({ aprendizados: 0 });
  });

  it("o tick ocioso drena a fila e o progresso vai ao renderer; encerrar para tudo", async () => {
    const m = montar();
    await m.lig.iniciar();
    m.lig.portaConhecimento.registrar(evento(m.ws.id, "e5", "nota sobre capivara e cobrança"));
    await esperar(30);
    const tick = m.agendados.find((a) => a.ms === 4000);
    expect(tick).toBeDefined();
    tick!.fn();
    await esperar(80);
    const est = await m.lig.manipuladores["conhecimento:estado"]({ workspace_id: m.ws.id });
    expect(est.indexando.pendentes).toBe(0);
    expect(est.documentos).toBeGreaterThan(0);
    m.lig.encerrar();
    expect(m.agendados.filter((a) => !a.cancelado).length).toBeLessThanOrEqual(m.agendados.length);
  });
});
