import { describe, expect, it } from "vitest";
import type { MetadadosSessao } from "../../compartilhado/terminais";
import type { Mission, Pane } from "../dominio";
import { agregarResumo, limparLinhaSaida, mascararCaminho, TAMANHO_LINHA, type EntradaResumo } from "./resumo";

const ws = (id: string, nome: string, raiz: string) => ({ id, nome, raiz });
const sessao = (id: string, ws_id: string | null, extra: Partial<MetadadosSessao> = {}): MetadadosSessao => ({
  sessao_id: id, ferramenta_id: "claude", estado: "executando", workspace_id: ws_id, criada_em: "2026-01-01T00:00:00.000Z", persistente: true, ...extra,
});
const pane = (id: string, wsId: string, extra: Partial<Pane> = {}): Pane => ({
  id, workspace_id: wsId, mission_id: null, display_id: 1, tipo: "cli", cli: "claude", executavel_id: null, conta_id: null, modelo: null, esforco: null,
  papel: "nenhum", eh_piloto: false, estado: "pronto", sessao_pty_id: null, respawn_de: null, cwd: null, encerrado_motivo: null, criado_em: "", atualizado_em: "", ...extra,
} as Pane);
const missao = (id: string, wsId: string, extra: Partial<Mission> = {}): Mission => ({
  id, workspace_id: wsId, modo: "livre", origem: "livre", trabalho_id: null, titulo: "Corrigir login", estado: "executando", worktree: null, branch: null, piloto_pane_id: null, concluida_em: null, criado_em: "", atualizado_em: "", ...extra,
} as Mission);

function entrada(p: Partial<EntradaResumo> = {}): EntradaResumo {
  return {
    workspaces: [ws("ws_A", "alfa", "/Users/ana/proj/alfa"), ws("ws_B", "beta", "/Users/ana/proj/beta")],
    atualId: "ws_A", home: "/Users/ana", sessoes: [], panes: [], missoes: [], execucoes: [], ramos: {}, sujos: {}, tempo: {}, nomeFerramenta: (id) => id, agora: 1_000, ...p,
  };
}

describe("mascararCaminho", () => {
  it("troca a pasta pessoal por ~ e normaliza separadores", () => {
    expect(mascararCaminho("/Users/ana/proj/alfa", "/Users/ana")).toBe("~/proj/alfa");
    expect(mascararCaminho("C:\\Users\\ana\\proj", "C:\\Users\\ana")).toBe("~/proj");
    expect(mascararCaminho("/Users/ana", "/Users/ana")).toBe("~");
  });
  it("não mascara prefixo parcial nem sem home", () => {
    expect(mascararCaminho("/Users/analu/x", "/Users/ana")).toBe("/Users/analu/x");
    expect(mascararCaminho("/srv/x", "")).toBe("/srv/x");
  });
});

describe("limparLinhaSaida", () => {
  it("remove ANSI/OSC e devolve a última linha com conteúdo", () => {
    expect(limparLinhaSaida("\u001b[1mAntes\u001b[0m\r\n\u001b[32mEditando src/app.ts\u001b[0m\r\n\u001b]0;titulo\u0007")).toBe("Editando src/app.ts");
  });
  it("ignora linhas só de moldura, prompt vazio e controle", () => {
    expect(limparLinhaSaida("rodando testes\n╭──────╮\n│      │\n╰──────╯\n")).toBe("rodando testes");
    expect(limparLinhaSaida("\u0000\u0007\n  \n")).toBeNull();
  });
  it("trunca em ~80 caracteres com reticências", () => {
    const r = limparLinhaSaida("palavra ".repeat(40));
    expect(r !== null && [...r].length).toBeLessThanOrEqual(TAMANHO_LINHA);
    expect(r?.endsWith("…")).toBe(true);
  });
  it("redige segredo conhecido pelo scrubber e sequências que parecem token", () => {
    expect(limparLinhaSaida("usando MINHA-CHAVE agora", (t) => t.replace("MINHA-CHAVE", "[oculto]"))).toBe("usando [oculto] agora");
    const longo = "abcdefghijklmnopqrstuvwxyz0123456789";
    expect(limparLinhaSaida(`export TOKEN=${"sk-"}${longo}`)).not.toContain(longo);
    expect(limparLinhaSaida("Authorization: Bearer abc.def.ghi-0123456789ABCDEFGH")).not.toContain("0123456789ABCDEFGH");
  });
  it("se o scrubber falhar, não devolve a linha crua", () => {
    expect(limparLinhaSaida("segredo", () => { throw new Error("x"); })).toBeNull();
  });
});

describe("agregarResumo", () => {
  it("atribui cada sessão ao workspace da Pane, ou da sessão, e deixa 2 workspaces independentes", () => {
    const r = agregarResumo(entrada({
      sessoes: [sessao("s1", "ws_A"), sessao("s2", "ws_B"), sessao("s3", null)],
      panes: [pane("pane_1", "ws_B", { sessao_pty_id: "s1" })],
    }));
    const a = r.itens.find((i) => i.id === "ws_A");
    const b = r.itens.find((i) => i.id === "ws_B");
    expect(b?.agentes.map((x) => x.sessao_id).sort()).toEqual(["s1", "s2"]); // Pane manda mais que o metadado
    expect(a?.agentes.map((x) => x.sessao_id)).toEqual(["s3"]); // sem workspace: cai no atual
  });
  it("só conta sessão viva; encerrada some; erro vira contagem de erro", () => {
    const r = agregarResumo(entrada({ sessoes: [sessao("s1", "ws_A", { estado: "encerrada" }), sessao("s2", "ws_A", { estado: "erro" }), sessao("s3", "ws_A", { estado: "iniciando" })] }));
    const a = r.itens[0]!;
    expect(a.agentes.map((x) => x.estado).sort()).toEqual(["erro", "iniciando"]);
    expect(a.contagens.erro).toBe(1);
  });
  it("shell comum não é agente: vira só contagem de terminais", () => {
    const r = agregarResumo(entrada({ sessoes: [sessao("s1", "ws_A", { ferramenta_id: "terminal" }), sessao("s2", "ws_A")] }));
    expect(r.itens[0]!.agentes.map((x) => x.sessao_id)).toEqual(["s2"]);
    expect(r.itens[0]!.contagens.terminais).toBe(1);
  });
  it("sessão de execução do projeto vira o nó de execução, nunca um agente", () => {
    const r = agregarResumo(entrada({
      sessoes: [sessao("run1", "ws_A", { ferramenta_id: "personalizado" }), sessao("s2", "ws_A")],
      execucoes: [{ workspace_id: "ws_A", fase: "rodando", nome: "dev", porta: 5173, sessao_id: "run1", iniciado_em: 500 }],
    }));
    const a = r.itens[0]!;
    expect(a.agentes.map((x) => x.sessao_id)).toEqual(["s2"]);
    expect(a.execucao).toEqual({ fase: "rodando", nome: "dev", porta: 5173, sessao_id: "run1", iniciado_em: 500 });
  });
  it("execução ociosa ou concluída não aparece", () => {
    const r = agregarResumo(entrada({ execucoes: [{ workspace_id: "ws_A", fase: "ocioso", nome: null, porta: null, sessao_id: null, iniciado_em: null }] }));
    expect(r.itens[0]!.execucao).toBeNull();
  });
  it("monta a árvore: piloto na raiz, workers como filhos com profundidade 1", () => {
    const r = agregarResumo(entrada({
      sessoes: [sessao("sw1", "ws_A", { ferramenta_id: "codex" }), sessao("sp", "ws_A"), sessao("sw2", "ws_A")],
      missoes: [missao("mis_1", "ws_A", { piloto_pane_id: "pane_p", modo: "squad" })],
      panes: [
        pane("pane_p", "ws_A", { mission_id: "mis_1", eh_piloto: true, papel: "piloto", sessao_pty_id: "sp" }),
        pane("pane_w1", "ws_A", { mission_id: "mis_1", papel: "executor", display_id: 2, cli: "codex", sessao_pty_id: "sw1" }),
        pane("pane_w2", "ws_A", { mission_id: "mis_1", papel: "revisor", display_id: 3, sessao_pty_id: "sw2" }),
      ],
    }));
    const a = r.itens[0]!;
    expect(a.missao).toMatchObject({ id: "mis_1", titulo: "Corrigir login", modo: "squad", piloto_sessao_id: "sp" });
    const por = Object.fromEntries(a.agentes.map((x) => [x.sessao_id, x]));
    expect(por["sp"]).toMatchObject({ pai_sessao_id: null, profundidade: 0, piloto: true });
    expect(por["sw1"]).toMatchObject({ pai_sessao_id: "sp", profundidade: 1 });
    expect(por["sw1"]!.titulo).toBe("codex · executor #2");
    expect(a.agentes[0]!.sessao_id).toBe("sp"); // pai antes dos filhos
  });
  it("Missão encerrada não aparece; várias ativas viram contagem", () => {
    const r = agregarResumo(entrada({ missoes: [missao("mis_1", "ws_A", { estado: "concluida" }), missao("mis_2", "ws_A"), missao("mis_3", "ws_A")] }));
    expect(r.itens[0]!.missao?.id).toBe("mis_2");
    expect(r.itens[0]!.missoes_ativas).toBe(1);
  });
  it("deriva estado e contagens da atividade; sem hook = ocioso", () => {
    const r = agregarResumo(entrada({
      sessoes: [sessao("s1", "ws_A"), sessao("s2", "ws_A"), sessao("s3", "ws_A")],
      tempo: { s1: { atividade: "trabalhando", atividade_em: 900, linha: "rodando testes", subagentes: { total: 3, ativos: 1 } }, s2: { atividade: "aguardando", atividade_em: 950, linha: null, subagentes: null } },
    }));
    const a = r.itens[0]!;
    expect(a.agentes.map((x) => x.estado)).toEqual(["trabalhando", "aguardando", "ocioso"]);
    expect(a.contagens).toMatchObject({ agentes: 3, trabalhando: 1, aguardando: 1, subagentes: 1 });
    expect(a.agentes[0]).toMatchObject({ linha: "rodando testes", subagentes: { total: 3, ativos: 1 } });
  });
  it("desde vem de criada_em; ramo e sujo vêm só do que já se conhece", () => {
    const r = agregarResumo(entrada({ sessoes: [sessao("s1", "ws_A")], ramos: { ws_A: "main" }, sujos: { ws_A: true } }));
    expect(r.itens[0]!.agentes[0]!.desde).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(r.itens[0]).toMatchObject({ branch: "main", sujo: true, atual: true, pasta_mascarada: "~/proj/alfa" });
    expect(r.itens[1]).toMatchObject({ branch: null, sujo: null, atual: false });
  });
  it("sessão de workspace desconhecido (removido da lista) é ignorada", () => {
    const r = agregarResumo(entrada({ sessoes: [sessao("s1", "ws_X")] }));
    expect(r.itens.flatMap((i) => i.agentes)).toEqual([]);
  });
  it("devolve só campos esperados (nada de caminho absoluto nem cwd)", () => {
    const r = agregarResumo(entrada({ sessoes: [sessao("s1", "ws_A")], panes: [pane("pane_1", "ws_A", { sessao_pty_id: "s1", cwd: "/Users/ana/proj/alfa/segredo" })] }));
    expect(JSON.stringify(r)).not.toContain("/Users/ana");
  });
});
