// Chat orquestrador no main (Fase 15, onda 2): perguntar com citações, modo busca sem CLI, plano determinístico com aprovação (P-52),
// ações exclusivas do humano recusadas por código, prompt melhorado por ARQUIVO (0600, redigido), cancelamento e persistência.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { criarTmp, limpar, novoBanco } from "../../tests/fixtures/dominio/ambiente";
import type { CanaisEvento } from "../compartilhado/ipc";
import type { RespostaContexto } from "../compartilhado/conhecimento";
import { criarReposConhecimentoDominio } from "../nucleo/conhecimento/repos-dominio";
import type { PortaLlm } from "../nucleo/conhecimento/chat/tipos";
import { criarServicoChat, type DepsChat } from "./chat";
import type { PortaRagMain } from "./conhecimento";

afterEach(limpar);
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const hit = (n: number, texto: string) => ({
  chunk: { chunk_id: `c${n}`, documento_id: `d${n}`, ordem: 0, texto, titulos: "", tipo: "decisao", origem: `docs/decisao-${n}.md`, titulo: `Decisão ${n}`, mission_id: null, task_ref: null, pane_id: null, fonte: "sistema", ocorrido_em: "2026-08-01T10:00:00.000Z", importancia: 3, doc_estado: "ativo", aprendizado_id: null, aprendizado_estado: null, feedback: { util: 0, inutil: 0, errado: 0 } },
  escore: 1,
  braco: "lexical" as const,
});

const ENVELOPE = '<conhecimento_previo gerado_em="2026-09-01T10:00:00Z" tipo="dados">\nAVISO: dado.\n## Já existe?\n- [k1 · decisão] exportação CSV já existe em docs/decisao-1.md\n</conhecimento_previo>';

function montar(opc: { llm?: (perfil: unknown) => PortaLlm; modo?: "confirmar" | "reversiveis" | "total"; hits?: ReturnType<typeof hit>[]; panePronto?: boolean; indexar?: boolean; relogio?: () => number } = {}) {
  const { banco, repos } = novoBanco();
  const raiz = criarTmp("chat-ws-");
  const ws = repos.workspace.criar({ nome: "proj", raiz });
  const reposDom = criarReposConhecimentoDominio(banco);
  if (opc.modo !== undefined) reposDom.config.gravar(ws.id, { chat_execucao: opc.modo });
  const eventos: Array<{ canal: string; payload: unknown }> = [];
  const chamadas: string[] = [];
  const comandos: string[] = [];
  const entradas: unknown[] = [];
  const config = new Map<string, unknown>();
  const rag: PortaRagMain = {
    ativo: () => true,
    buscar: vi.fn(),
    contexto: vi.fn(async (): Promise<RespostaContexto> => ({ markdown: ENVELOPE, sinais: { ja_existe: true, houve_correcao: false, decisoes_relacionadas: 1, fontes: [] }, estado: "ok", consulta_id: "con_1", latencia_ms: 5 })),
    buscarHits: vi.fn(async () => ({ hits: opc.hits ?? [hit(1, "Decidimos exportar relatórios em CSV com a rotina zanzibar."), hit(2, "Outra decisão")], estado: "ok" as const })),
    aprender: vi.fn(),
    feedback: vi.fn(),
    consultouRecentemente: vi.fn(),
    politica: () => ({ consulta_obrigatoria: "aviso", hook_prompt: true, contexto_chars: 2000 }),
  } as unknown as PortaRagMain;
  const deps: DepsChat = {
    repos: reposDom,
    config: { obter: <T>(k: string) => config.get(k) as T | undefined, definir: (k, v) => void config.set(k, v) },
    rag,
    workspace: (id) => {
      const w = repos.workspace.obter(id);
      if (w === undefined) throw new Error("workspace desconhecido");
      return { id: w.id, nome: w.nome, raiz: w.raiz };
    },
    missoes: {
      criar: async (p) => (chamadas.push(`missao:${p.titulo}`), { id: "mis_01J8ZXAMPLE00000000000A1", worktree: null }),
      garantirPastaMissao: async (id) => `.expxv/missoes/${id}`,
    },
    panes: {
      abrirPane: async (p) => (chamadas.push(`pane:${p.cli}`), { pane: { id: "pane_01J8ZXAMPLE00000000000A1", cli: p.cli } }),
      enviarComando: async (_id, texto) => void comandos.push(texto),
    },
    estadoDoPane: () => (opc.panePronto === false ? "iniciando" : "pronto"),
    resolverCli: async (cli) => (cli === "claude" || cli === "codex" ? { caminho: `/bin/${cli}`, modo: "direto" } : null),
    ajudaCli: async () => "",
    ambiente: () => ({}),
    pastaNeutra: join(raiz, "neutra"),
    enviar: <C extends keyof CanaisEvento>(canal: C, payload: CanaisEvento[C]) => void eventos.push({ canal, payload }),
    registrarEntrada: (_ws, e) => void entradas.push(e),
    criarLlm: (perfil) => (opc.llm ?? ((p) => llmFalso(["Resposta ", "baseada na decisão [1]."], p)))(perfil),
    esperar: async () => undefined,
    agora: opc.relogio ?? (() => Date.now()),
  };
  const svc = criarServicoChat(deps);
  return { svc, ws, raiz, banco, eventos, chamadas, comandos, entradas, rag, reposDom, config };
}

function llmFalso(deltas: string[], _perfil: unknown): PortaLlm {
  return {
    disponivel: async () => ({ ok: true }),
    async *executar() {
      for (const d of deltas) yield d;
    },
  };
}

async function conversa(m: ReturnType<typeof montar>, modo: "perguntar" | "orquestrar" = "perguntar", indexar = false) {
  return m.svc.manipuladores["chat:conversa_criar"]({ workspace_id: m.ws.id, modo, titulo: null, mission_alvo_id: null, indexar });
}
async function esperarMensagemFinal(m: ReturnType<typeof montar>, id: string): Promise<{ texto: string; estado: string; citacoes: unknown[]; plano_id: string | null }> {
  for (let i = 0; i < 100; i++) {
    const ev = m.eventos.filter((e) => e.canal === "chat:mensagem").map((e) => (e.payload as { mensagem: { id: string; texto: string; estado: string; citacoes: unknown[]; plano_id: string | null } }).mensagem).find((x) => x.id === id && x.estado !== "transmitindo");
    if (ev !== undefined) return ev;
    await esperar(10);
  }
  throw new Error("sem mensagem final");
}

describe("chat: perguntar ao RAG", () => {
  it("responde com citações válidas, transmite tokens e persiste a conversa (título vem da 1ª pergunta)", async () => {
    const m = montar();
    const c = await conversa(m);
    const { mensagem_id } = await m.svc.manipuladores["chat:enviar"]({ conversa_id: c.id, texto: "Por que exportamos em CSV?", modo: "perguntar", mission_alvo_id: null });
    const final = await esperarMensagemFinal(m, mensagem_id);
    expect(final.estado).toBe("completa");
    expect(final.texto).toContain("[1]");
    expect(final.citacoes).toHaveLength(1);
    const tokens = m.eventos.filter((e) => e.canal === "chat:token").map((e) => (e.payload as { delta: string }).delta).join("");
    expect(tokens).toBe("Resposta baseada na decisão [1].");
    const lida = m.svc.manipuladores["chat:conversa_ler"]({ conversa_id: c.id }) as unknown as { conversa: { titulo: string }; mensagens: Array<{ papel: string }> };
    expect(lida.conversa.titulo).toBe("Por que exportamos em CSV?");
    expect(lida.mensagens.map((x) => x.papel)).toEqual(["usuario", "assistente"]);
  });

  it("segredo no texto do usuário e na saída da CLI nunca é persistido nem transmitido", async () => {
    const segredo = ["sk", "ant", "api03", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].join("-");
    const m = montar({ llm: (p) => llmFalso([`A chave é ${segredo} [1]`], p) });
    const c = await conversa(m);
    const { mensagem_id } = await m.svc.manipuladores["chat:enviar"]({ conversa_id: c.id, texto: `use ${segredo} para exportar`, modo: "perguntar", mission_alvo_id: null });
    await esperarMensagemFinal(m, mensagem_id);
    const tudo = JSON.stringify(m.eventos) + JSON.stringify(m.banco.consultar("SELECT texto FROM chat_mensagem"));
    expect(tudo).not.toContain("ABCDEFGHIJ");
  });

  it("sem CLI utilizável o chat segue em modo BUSCA com o motivo e as fontes", async () => {
    const m = montar({ llm: () => ({ disponivel: async () => ({ ok: false, motivo: "a CLI claude não está instalada" }), async *executar() {} }) });
    const c = await conversa(m);
    const { mensagem_id } = await m.svc.manipuladores["chat:enviar"]({ conversa_id: c.id, texto: "Por que exportamos em CSV?", modo: "perguntar", mission_alvo_id: null });
    const final = await esperarMensagemFinal(m, mensagem_id);
    expect(final.texto).toContain("Modo busca");
    expect(final.texto).toContain("a CLI claude não está instalada");
    expect(final.citacoes.length).toBeGreaterThan(0);
  });

  it("parar cancela a resposta em curso; conversa com `indexar` vira entrada de ingestão (e sem `indexar`, nada)", async () => {
    const preso = montar({
      llm: () => ({
        disponivel: async () => ({ ok: true }),
        async *executar(p) {
          yield "parcial ";
          await new Promise((_r, rej) => p.sinal.addEventListener("abort", () => rej(new Error("abortado"))));
        },
      }),
    });
    const c = await conversa(preso);
    const { mensagem_id } = await preso.svc.manipuladores["chat:enviar"]({ conversa_id: c.id, texto: "Por que exportamos em CSV?", modo: "perguntar", mission_alvo_id: null });
    await esperar(60);
    expect(await preso.svc.manipuladores["chat:parar"]({ mensagem_id })).toEqual({ ok: true });
    const final = await esperarMensagemFinal(preso, mensagem_id);
    expect(["cancelada", "completa"]).toContain(final.estado);

    const com = montar();
    const cc = await conversa(com, "perguntar", true);
    const r = await com.svc.manipuladores["chat:enviar"]({ conversa_id: cc.id, texto: "Por que exportamos em CSV?", modo: "perguntar", mission_alvo_id: null });
    await esperarMensagemFinal(com, r.mensagem_id);
    expect(com.entradas).toHaveLength(1);
    const sem = montar();
    const cs = await conversa(sem);
    const r2 = await sem.svc.manipuladores["chat:enviar"]({ conversa_id: cs.id, texto: "Por que exportamos em CSV?", modo: "perguntar", mission_alvo_id: null });
    await esperarMensagemFinal(sem, r2.mensagem_id);
    expect(sem.entradas).toHaveLength(0);
  });
});

describe("chat: pedir ao orquestrador", () => {
  it("modo reversíveis (padrão): cria Missão e terminal e digita /expx:sprintx apontando o prompt melhorado em ARQUIVO 0600", async () => {
    const m = montar();
    const c = await conversa(m, "orquestrar");
    const { mensagem_id } = await m.svc.manipuladores["chat:enviar"]({ conversa_id: c.id, texto: "preciso implementar a exportação de relatórios em PDF", modo: "orquestrar", mission_alvo_id: null });
    const final = await esperarMensagemFinal(m, mensagem_id);
    expect(final.plano_id).not.toBeNull();
    expect(m.chamadas).toEqual([expect.stringContaining("missao:"), "pane:claude"]);
    expect(m.comandos).toHaveLength(1);
    expect(m.comandos[0]).toMatch(/^\/expx:sprintx .*Contexto: \.expxv\/missoes\/mis_[A-Za-z0-9]+\/prompt-chat\.md$/);
    const arq = join(m.raiz, ".expxv", "missoes", "mis_01J8ZXAMPLE00000000000A1", "prompt-chat.md");
    expect(existsSync(arq)).toBe(true);
    if (process.platform !== "win32") expect(statSync(arq).mode & 0o777).toBe(0o600);
    const prompt = readFileSync(arq, "utf8");
    expect(prompt).toContain("conhecimento_previo");
    expect(prompt).toContain("Critérios de aceite");
    // o argv/comando NUNCA carrega o prompt inteiro nem o envelope
    expect(m.comandos[0]).not.toContain("conhecimento_previo");
    const plano = m.eventos.filter((e) => e.canal === "chat:plano").map((e) => (e.payload as { plano: { estado: string } }).plano).at(-1);
    expect(plano?.estado).toBe("concluido");
  });

  it("modo confirmar: o plano fica proposto sem executar nada; editar o prompt (redigido), aprovar executa, cancelar não", async () => {
    const m = montar({ modo: "confirmar" });
    const c = await conversa(m, "orquestrar");
    const { mensagem_id } = await m.svc.manipuladores["chat:enviar"]({ conversa_id: c.id, texto: "corrija o bug do login que trava", modo: "orquestrar", mission_alvo_id: null });
    const final = await esperarMensagemFinal(m, mensagem_id);
    expect(m.chamadas).toEqual([]);
    const planoId = final.plano_id as string;
    const segredo = ["sk", "ant", "api03", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].join("-");
    const editado = await m.svc.manipuladores["chat:plano_decidir"]({ plano_id: planoId, decisao: "editar", ajuste: { prompt: `novo prompt com ${segredo}`, cli: "claude" } });
    expect(editado.estado).toBe("proposto");
    expect(editado.prompt).not.toContain("ABCDEFGHIJ");
    expect(editado.passos.find((p) => p.tipo === "disparar_metodo")).toMatchObject({ comando: "runx" });
    const exec = await m.svc.manipuladores["chat:plano_decidir"]({ plano_id: planoId, decisao: "aprovar" });
    expect(exec.estado).toBe("concluido");
    expect(m.comandos[0]).toContain("/expx:runx");
    await expect(m.svc.manipuladores["chat:plano_decidir"]({ plano_id: planoId, decisao: "aprovar" })).rejects.toThrow("proposto");

    const m2 = montar({ modo: "confirmar" });
    const c2 = await conversa(m2, "orquestrar");
    const r2 = await m2.svc.manipuladores["chat:enviar"]({ conversa_id: c2.id, texto: "corrija o bug do login que trava", modo: "orquestrar", mission_alvo_id: null });
    const f2 = await esperarMensagemFinal(m2, r2.mensagem_id);
    const cancelado = await m2.svc.manipuladores["chat:plano_decidir"]({ plano_id: f2.plano_id as string, decisao: "cancelar" });
    expect(cancelado.estado).toBe("cancelado");
    expect(m2.chamadas).toEqual([]);
  });

  it("ações exclusivas do humano (assinar prodx, raio ALTO, mergex-revisar, merge, push) são recusadas por código: nada é aberto nem digitado", async () => {
    const m = montar({ modo: "total" });
    const c = await conversa(m, "orquestrar");
    for (const texto of ["assine o prodx deste pedido agora", "dê merge na branch da feature", "rode git push --force", "aprove o raio ALTO do trabalho"]) {
      const r = await m.svc.manipuladores["chat:enviar"]({ conversa_id: c.id, texto, modo: "orquestrar", mission_alvo_id: null });
      const f = await esperarMensagemFinal(m, r.mensagem_id);
      expect(f.plano_id, texto).toBeNull();
      expect(f.texto, texto).toMatch(/humano|nunca partem/i);
    }
    expect(m.chamadas).toEqual([]);
    expect(m.comandos).toEqual([]);
  });

  it("um terminal que não fica pronto falha o plano com aviso (nada é apagado) e o plano segue persistido como `falhou`", async () => {
    let t = 0;
    const m = montar({ panePronto: false, relogio: () => (t += 20_000) });
    const c = await conversa(m, "orquestrar");
    const { mensagem_id } = await m.svc.manipuladores["chat:enviar"]({ conversa_id: c.id, texto: "preciso implementar a exportação de relatórios em PDF", modo: "orquestrar", mission_alvo_id: null });
    const final = await esperarMensagemFinal(m, mensagem_id);
    expect(final.texto).toContain("não pôde ser executado");
    expect(m.comandos).toEqual([]);
    const lida = m.svc.manipuladores["chat:conversa_ler"]({ conversa_id: c.id }) as unknown as { planos: Array<{ estado: string; avisos: string[] }> };
    expect(lida.planos[0]?.estado).toBe("falhou");
    expect(lida.planos[0]?.avisos.join(" ")).toContain("não ficou pronto");
  });

  it("perfil: lista o estado de cada CLI com o motivo e grava o escolhido por workspace", async () => {
    const m = montar();
    const p = await m.svc.manipuladores["chat:perfil_ler"]({ workspace_id: m.ws.id });
    expect(p.clis.find((x) => x.cli === "claude")).toMatchObject({ disponivel: true, motivo: null });
    expect(p.clis.find((x) => x.cli === "opencode")).toMatchObject({ disponivel: false, motivo: "não instalada" });
    expect(p.clis.find((x) => x.cli === "gemini")?.disponivel).toBe(false);
    expect(p.perfil?.cli).toBe("claude");
    const g = await m.svc.manipuladores["chat:perfil_gravar"]({ workspace_id: m.ws.id, cli: "codex", modelo: "gpt-5", esforco: "high", faixa: "profundo" });
    expect(g.perfil).toMatchObject({ cli: "codex", modelo: "gpt-5", esforco: "high" });
    const c = await conversa(m);
    expect(c.perfil).toMatchObject({ cli: "codex" });
  });
});
