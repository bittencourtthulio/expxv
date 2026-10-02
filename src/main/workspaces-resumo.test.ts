import { describe, expect, it, vi } from "vitest";
import type { EventoTerminal, MetadadosSessao } from "../compartilhado/terminais";
import type { ResumoWorkspaces } from "../compartilhado/workspaces-resumo";
import type { Mission, Pane } from "../nucleo/dominio";
import { criarServicoResumoWorkspaces, type DependenciasResumo } from "./workspaces-resumo";

const WS = [{ id: "ws_A", nome: "alfa", raiz: "/h/alfa" }, { id: "ws_B", nome: "beta", raiz: "/h/beta" }];
const meta = (id: string, ws: string | null, extra: Partial<MetadadosSessao> = {}): MetadadosSessao => ({ sessao_id: id, ferramenta_id: "claude", estado: "executando", workspace_id: ws, criada_em: "2026-01-01T00:00:00.000Z", persistente: true, ...extra });
const pane = (id: string, ws: string, sessao: string): Pane => ({ id, workspace_id: ws, mission_id: null, display_id: 1, tipo: "cli", cli: "claude", papel: "nenhum", eh_piloto: false, estado: "pronto", sessao_pty_id: sessao } as unknown as Pane);

let relogio = 1_000;
function montar(extra: Partial<DependenciasResumo> = {}) {
  let sessoes = [meta("s1", "ws_A"), meta("s2", "ws_B"), meta("s3", "ws_B")];
  const ouvintes = new Set<(e: EventoTerminal) => void>();
  const encerrar = vi.fn((id: string) => { sessoes = sessoes.map((s) => (s.sessao_id === id ? { ...s, estado: "encerrada" as const } : s)); return true; });
  const topicos = new Map<string, Set<(p: never) => void>>();
  const emitidos: ResumoWorkspaces[] = [];
  const agendados: Array<() => void> = [];
  const encerrarPane = vi.fn(async () => undefined);
  const panes = [pane("pane_3", "ws_B", "s3")];
  const d: DependenciasResumo = {
    workspaces: { atual: () => WS[0]!, todos: () => WS, obter: (id) => WS.find((w) => w.id === id) },
    sessoes: async () => ({ listarMetadados: () => sessoes, assinar: (fn) => { ouvintes.add(fn); return () => void ouvintes.delete(fn); }, encerrar }),
    panes: { encerrarPane },
    repos: {
      pane: { listarPorWorkspace: (id) => ({ itens: panes.filter((p) => p.workspace_id === id), proximo: null }) },
      mission: { listarPorWorkspace: () => ({ itens: [] as Mission[], proximo: null }) },
    },
    execucoes: () => [],
    barramento: { assinar: (t, f) => { const c = topicos.get(t) ?? new Set(); c.add(f as never); topicos.set(t, c); return () => void c.delete(f as never); } },
    emitir: (r) => emitidos.push(r),
    ramoDe: async (raiz) => (raiz.endsWith("alfa") ? "main" : null),
    home: "/h", agora: () => (relogio += 500), atrasoMs: 300,
    agendar: (fn) => { agendados.push(fn); return agendados.length; },
    cancelar: () => undefined,
    revelar: vi.fn(),
    copiar: vi.fn(),
    ...extra,
  };
  const emitirSessao = (e: EventoTerminal): void => ouvintes.forEach((f) => f(e));
  const rodar = async (): Promise<void> => { const f = agendados.splice(0); f.forEach((x) => x()); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };
  return { d, svc: criarServicoResumoWorkspaces(d), encerrar, encerrarPane, emitidos, ouvintes, topicos, emitirSessao, rodar, agendados, setSessoes: (s: MetadadosSessao[]) => { sessoes = s; } };
}

describe("serviço do resumo de workspaces", () => {
  it("resumo agrega os 2 workspaces com ramo e sem ativar nada", async () => {
    const m = montar();
    const r = await m.svc.resumo();
    expect(r.itens.map((i) => [i.id, i.agentes.map((a) => a.sessao_id)])).toEqual([["ws_A", ["s1"]], ["ws_B", ["s2", "s3"]]]);
    expect(r.itens[0]!.branch).toBe("main");
    expect(m.ouvintes.size).toBe(0); // nada assinado até ativar
    expect(m.topicos.size).toBe(0);
  });

  it("desativado: eventos não geram trabalho nem emissão; ativo: assina e desassina", async () => {
    const m = montar();
    expect(await m.svc.ativar(true)).toBe(true);
    expect(m.ouvintes.size).toBe(1);
    await m.svc.ativar(false);
    expect(m.ouvintes.size).toBe(0);
    m.emitirSessao({ versao: 1, sequencia: 1, sessao_id: "s1", tipo: "atividade", atividade: "trabalhando" });
    expect(m.agendados.length).toBe(0);
  });

  it("coalesce uma rajada de eventos numa só emissão e só emite quando algo mudou", async () => {
    const m = montar();
    await m.svc.ativar(true);
    for (let i = 0; i < 50; i += 1) m.emitirSessao({ versao: 1, sequencia: i, sessao_id: "s1", tipo: "saida", dados: `linha ${i}\n` });
    m.emitirSessao({ versao: 1, sequencia: 99, sessao_id: "s1", tipo: "atividade", atividade: "trabalhando" });
    expect(m.agendados.length).toBe(1);
    await m.rodar();
    expect(m.emitidos.length).toBe(1);
    const a = m.emitidos[0]!.itens[0]!.agentes[0]!;
    expect(a).toMatchObject({ estado: "trabalhando", linha: "linha 49", atividade: "trabalhando" });
    // mesmo conteúdo outra vez: sem nova emissão
    m.emitirSessao({ versao: 1, sequencia: 100, sessao_id: "s1", tipo: "estado", estado: "executando", erro_codigo: null, mensagem: null });
    await m.rodar();
    expect(m.emitidos.length).toBe(1);
  });

  it("a última linha passa pelo scrubber do cofre antes de sair", async () => {
    const m = montar({ scrub: async () => (t) => t.replace("SEGREDO", "[oculto]") });
    await m.svc.ativar(true);
    m.emitirSessao({ versao: 1, sequencia: 1, sessao_id: "s1", tipo: "saida", dados: "usando SEGREDO no teste\n" });
    await m.rodar();
    expect(m.emitidos[0]!.itens[0]!.agentes[0]!.linha).toBe("usando [oculto] no teste");
  });

  it("conta subagentes internos pelos eventos, sem tratá-los como terminais", async () => {
    const m = montar();
    await m.svc.ativar(true);
    m.emitirSessao({ versao: 1, sequencia: 1, sessao_id: "s1", tipo: "subagente_iniciado", subagente_id: "x", rotulo: "Explore", descricao: null });
    m.emitirSessao({ versao: 1, sequencia: 2, sessao_id: "s1", tipo: "subagente_iniciado", subagente_id: "y", rotulo: "Plan", descricao: null });
    m.emitirSessao({ versao: 1, sequencia: 3, sessao_id: "s1", tipo: "subagente_concluido", subagente_id: "x" });
    await m.rodar();
    expect(m.emitidos[0]!.itens[0]!.agentes[0]!.subagentes).toEqual({ total: 2, ativos: 1 });
    expect(m.emitidos[0]!.itens[0]!.agentes).toHaveLength(1);
  });

  it("vcs:mudou alimenta o indicador de alterações (sem consultar git)", async () => {
    const m = montar();
    await m.svc.ativar(true);
    [...(m.topicos.get("vcs:mudou") ?? [])].forEach((f) => (f as (p: unknown) => void)({ workspace_id: "ws_A", mission_id: null, resumo: { sujo: true } }));
    await m.rodar();
    expect(m.emitidos[0]!.itens[0]!.sujo).toBe(true);
  });

  describe("encerrar agente", () => {
    it("encerra só a sessão pedida e deixa as outras vivas (2 workspaces)", async () => {
      const m = montar();
      expect(await m.svc.encerrarAgente({ workspace_id: "ws_B", sessao_id: "s2" })).toEqual({ ok: true, motivo: "encerrado" });
      expect(m.encerrar).toHaveBeenCalledTimes(1);
      expect(m.encerrar).toHaveBeenCalledWith("s2");
      const r = await m.svc.resumo();
      expect(r.itens.flatMap((i) => i.agentes.map((a) => a.sessao_id)).sort()).toEqual(["s1", "s3"]);
    });
    it("agente de Pane usa o encerramento do Pane", async () => {
      const m = montar();
      expect((await m.svc.encerrarAgente({ workspace_id: "ws_B", sessao_id: "s3" })).ok).toBe(true);
      expect(m.encerrarPane).toHaveBeenCalledWith("pane_3", expect.any(String));
      expect(m.encerrar).not.toHaveBeenCalled();
    });
    it("recusa sessão de outro workspace, desconhecida ou de execução, sem encerrar nada", async () => {
      const m = montar();
      expect(await m.svc.encerrarAgente({ workspace_id: "ws_A", sessao_id: "s2" })).toEqual({ ok: false, motivo: "outro_workspace" });
      expect(await m.svc.encerrarAgente({ workspace_id: "ws_A", sessao_id: "nao-existe" })).toEqual({ ok: false, motivo: "desconhecido" });
      expect(await m.svc.encerrarAgente({ workspace_id: "ws_X", sessao_id: "s1" })).toEqual({ ok: false, motivo: "desconhecido" });
      expect(m.encerrar).not.toHaveBeenCalled();
      expect(m.encerrarPane).not.toHaveBeenCalled();
    });
    it("trocar de workspace (só muda o atual) não encerra nada", async () => {
      let atual = WS[0]!;
      const m = montar({ workspaces: { atual: () => atual, todos: () => WS, obter: (id) => WS.find((w) => w.id === id) } });
      const contar = (itens: ResumoWorkspaces["itens"]) => Object.fromEntries(itens.map((i) => [i.id, i.agentes.length]));
      const antes = contar((await m.svc.resumo()).itens);
      atual = WS[1]!;
      const depois = (await m.svc.resumo()).itens;
      expect(contar(depois)).toEqual(antes);
      expect(depois.find((i) => i.atual)?.id).toBe("ws_B");
      expect(m.encerrar).not.toHaveBeenCalled();
    });
  });

  it("revelar usa o caminho do workspace conhecido pelo id; id desconhecido é recusado", () => {
    const m = montar();
    expect(m.svc.revelar("ws_A")).toBe(true);
    expect(m.d.revelar).toHaveBeenCalledWith("/h/alfa");
    expect(m.svc.revelar("ws_X")).toBe(false);
    expect(m.svc.copiarCaminho("ws_B")).toBe(true);
    expect(m.d.copiar).toHaveBeenCalledWith("/h/beta");
    expect(m.svc.copiarCaminho("ws_X")).toBe(false);
  });
});
