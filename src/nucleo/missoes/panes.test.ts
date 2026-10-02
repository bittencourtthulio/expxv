import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NaoEncontradoErro } from "../dominio";
import { criarArmazemLayout } from "../terminais/layout";
import { criarServicoContas } from "../provedores/contas";
import { criarTmp, detectorFalso, ferramenta, limpar, novoBanco, sessoesFalsas } from "../../../tests/fixtures/dominio/ambiente";
import { CliIndisponivelErro, ContaInvalidaErro, PaneNaoAceitaComandoErro, PaneAtivoErro, criarServicoPanes } from "./panes";

afterEach(limpar);

function montar(opcoes: { atrasosRestauracaoMs?: number[]; vivas?: string[]; ferramentas?: ReturnType<typeof ferramenta>[]; sessoes?: ReturnType<typeof sessoesFalsas>; bancoExistente?: ReturnType<typeof novoBanco>; dados?: string } = {}) {
  const b = opcoes.bancoExistente ?? novoBanco();
  const { banco, repos } = b;
  const dados = opcoes.dados ?? criarTmp("dados-");
  const sessoes = opcoes.sessoes ?? sessoesFalsas({ vivasNaRecuperacao: opcoes.vivas ?? [] });
  const eventos: Array<{ workspace_id: string; mission_id: string | null }> = [];
  const contas = criarServicoContas({ banco, repos, pastaDeDados: dados });
  const raiz = opcoes.bancoExistente ? (repos.workspace.listar().itens[0]?.raiz as string) : criarTmp("ws-");
  const ws = repos.workspace.obterPorRaiz(raiz) ?? repos.workspace.criar({ nome: "ws", raiz });
  const panes = criarServicoPanes({
    banco,
    repos,
    workspaces: { exigir: (id) => repos.workspace.exigir(id) },
    sessoes: async () => sessoes as never,
    detector: detectorFalso(opcoes.ferramentas),
    contas,
    armazemLayout: (w) => criarArmazemLayout(dados, w),
    aoMudar: (e) => void eventos.push(e),
    atrasosRestauracaoMs: opcoes.atrasosRestauracaoMs ?? [],
  });
  return { banco, repos, dados, sessoes, contas, panes, ws, raiz, eventos };
}

describe("abrirPane", () => {
  it("usa o worktree da Missão como cwd e grava pane + sessão", async () => {
    const { repos, panes, ws, raiz, sessoes } = montar();
    const wt = join(raiz, "..", `${raiz.split("/").pop()}--x`);
    mkdirSync(wt);
    const m = repos.mission.criar({ workspace_id: ws.id, modo: "agentico", origem: "feature", titulo: "Minha feature", worktree: `../${raiz.split("/").pop()}--x`, branch: "feature/x" });
    const r = await panes.abrirPane({ missao_id: m.id, cli: "claude", papel: "piloto" });
    expect(sessoes.sessoes.get(r.sessao_id)?.cwd).toBe(wt);
    expect(r.pane).toMatchObject({ mission_id: m.id, cli: "claude", papel: "piloto", eh_piloto: true, estado: "iniciando", sessao_pty_id: r.sessao_id, display_id: 1, cwd: `../${raiz.split("/").pop()}--x` });
    expect(repos.pane.ultimaSessao(r.pane.id)).toBeDefined();
    expect(repos.mission.exigir(m.id).piloto_pane_id).toBe(r.pane.id);
    expect(sessoes.sessoes.get(r.sessao_id)?.pedido).toMatchObject({ ferramenta_id: "claude", executavel_id: "exe_claude", workspace_id: ws.id });
  });

  it("sem Missão (ou Missão sem worktree) o cwd é a raiz do workspace", async () => {
    const { repos, panes, ws, raiz, sessoes } = montar();
    const a = await panes.abrirPane({ workspace_id: ws.id, cli: "terminal" });
    expect(sessoes.sessoes.get(a.sessao_id)?.cwd).toBe(raiz);
    expect(a.pane).toMatchObject({ tipo: "shell", cwd: ".", papel: "nenhum", mission_id: null });
    const m = repos.mission.criar({ workspace_id: ws.id, modo: "livre", origem: "livre", titulo: "L" });
    const b = await panes.abrirPane({ missao_id: m.id, cli: "codex", papel: "executor" });
    expect(sessoes.sessoes.get(b.sessao_id)?.cwd).toBe(raiz);
    expect(b.pane.tipo).toBe("cli");
  });

  it("display_id é persistido e nunca reutilizado, mesmo depois de encerrar", async () => {
    const { panes, ws } = montar();
    const a = await panes.abrirPane({ workspace_id: ws.id, cli: "terminal" });
    const b = await panes.abrirPane({ workspace_id: ws.id, cli: "terminal" });
    await panes.encerrarPane(b.pane.id, "teste");
    const c = await panes.abrirPane({ workspace_id: ws.id, cli: "terminal" });
    expect([a.pane.display_id, b.pane.display_id, c.pane.display_id]).toEqual([1, 2, 3]);
  });

  it("rótulo #<display_id> · <CLI> · <papel> · <missão>", async () => {
    const { repos, panes, ws } = montar();
    const m = repos.mission.criar({ workspace_id: ws.id, modo: "squad", origem: "livre", titulo: "Refatorar login" });
    const r = await panes.abrirPane({ missao_id: m.id, cli: "claude", papel: "revisor" });
    expect(panes.rotulo(r.pane)).toBe("#1 · Claude Code · revisor · Refatorar login");
    const s = await panes.abrirPane({ workspace_id: ws.id, cli: "terminal" });
    expect(panes.rotulo(s.pane)).toBe("#2 · Terminal · nenhum · sem missão");
  });

  it("a conta passa o config dir isolado como ambiente da sessão", async () => {
    const { contas, panes, ws, sessoes, dados } = montar();
    const c = contas.criar("claude", "Trabalho");
    const r = await panes.abrirPane({ workspace_id: ws.id, cli: "claude", conta_id: c.id });
    expect(sessoes.sessoes.get(r.sessao_id)?.ambiente).toEqual({ CLAUDE_CONFIG_DIR: join(dados, "contas", c.id) });
    expect(r.pane.conta_id).toBe(c.id);
  });

  it("conta desabilitada, de outro provedor ou inexistente é recusada antes de abrir sessão", async () => {
    const { contas, panes, ws, sessoes } = montar();
    const parada = contas.criar("claude", "Parada");
    contas.habilitar(parada.id, false);
    const codex = contas.criar("codex", "Cx");
    await expect(panes.abrirPane({ workspace_id: ws.id, cli: "claude", conta_id: parada.id })).rejects.toBeInstanceOf(ContaInvalidaErro);
    await expect(panes.abrirPane({ workspace_id: ws.id, cli: "claude", conta_id: codex.id })).rejects.toBeInstanceOf(ContaInvalidaErro);
    await expect(panes.abrirPane({ workspace_id: ws.id, cli: "claude", conta_id: "conta_nada" })).rejects.toBeInstanceOf(ContaInvalidaErro);
    expect(sessoes.sessoes.size).toBe(0);
  });

  it("CLI não instalada ou desconhecida: erro nominal e nada gravado", async () => {
    const { repos, panes, ws } = montar({ ferramentas: [ferramenta("claude", false), ferramenta("terminal")] });
    await expect(panes.abrirPane({ workspace_id: ws.id, cli: "claude" })).rejects.toBeInstanceOf(CliIndisponivelErro);
    await expect(panes.abrirPane({ workspace_id: ws.id, cli: "inexistente" })).rejects.toBeInstanceOf(CliIndisponivelErro);
    expect(repos.pane.listarPorWorkspace(ws.id).itens).toHaveLength(0);
  });

  it("workspace ou Missão inexistente é erro nominal", async () => {
    const { panes } = montar();
    await expect(panes.abrirPane({ workspace_id: "ws_nada", cli: "terminal" })).rejects.toBeInstanceOf(NaoEncontradoErro);
    await expect(panes.abrirPane({ missao_id: "mis_nada", cli: "terminal" })).rejects.toBeInstanceOf(NaoEncontradoErro);
  });

  it("se a sessão falha ao abrir, o Pane fica encerrado com o motivo (não fica 'iniciando' para sempre)", async () => {
    const sessoes = sessoesFalsas();
    sessoes.abrir = () => { throw new Error("Não foi possível iniciar o terminal."); };
    const { repos, panes, ws } = montar({ sessoes });
    await expect(panes.abrirPane({ workspace_id: ws.id, cli: "claude" })).rejects.toThrow("Não foi possível iniciar");
    const [p] = repos.pane.listarPorWorkspace(ws.id).itens;
    expect(p).toMatchObject({ estado: "encerrado", encerrado_motivo: "falha_ao_abrir" });
  });

  it("prompt inicial vai no pedido quando a CLI aceita", async () => {
    const { panes, ws, sessoes } = montar();
    const r = await panes.abrirPane({ workspace_id: ws.id, cli: "claude", prompt_inicial: "/expx:sprintx pedido" });
    expect(sessoes.sessoes.get(r.sessao_id)?.pedido["prompt_inicial"]).toBe("/expx:sprintx pedido");
  });
});

describe("preparador de lançamento (orquestração)", () => {
  it("soma argumentos e ambiente ao pedido, substitui o prompt inicial e recebe o Pane já criado", async () => {
    const { panes, ws, sessoes, repos } = montar();
    const vistos: Array<{ pane: string; papel: string; contexto: unknown }> = [];
    panes.definirPreparador(async (e) => {
      vistos.push({ pane: e.pane.id, papel: e.pane.papel, contexto: e.pedido.contexto });
      return { argumentos: ["--mcp-config", "/x/mcp.json", "fim"], ambiente: { TOKEN_DO_PANE: "abc" }, prompt_embutido: true };
    });
    const r = await panes.abrirPane({ workspace_id: ws.id, cli: "claude", papel: "executor", argumentos: ["--antes"], prompt_inicial: "ignorado", contexto: { task: "t1" } });
    const s = sessoes.sessoes.get(r.sessao_id);
    expect(s?.pedido["argumentos"]).toEqual(["--antes", "--mcp-config", "/x/mcp.json", "fim"]);
    expect(s?.pedido["prompt_inicial"]).toBeUndefined();
    expect(s?.ambiente).toMatchObject({ TOKEN_DO_PANE: "abc" });
    expect(vistos).toEqual([{ pane: r.pane.id, papel: "executor", contexto: { task: "t1" } }]);
    expect(repos.pane.exigir(r.pane.id).sessao_pty_id).toBe(r.sessao_id);
  });

  it("a permissão efetiva do preparador (agente de squad) chega às sessões; sem ela nada é enviado", async () => {
    const { panes, ws, sessoes } = montar();
    panes.definirPreparador(async (e) => (e.pedido.cli === "claude" ? { argumentos: [], ambiente: {}, permissao: "seguro" } : { argumentos: [], ambiente: {} }));
    const a = await panes.abrirPane({ workspace_id: ws.id, cli: "claude", papel: "executor" });
    const b = await panes.abrirPane({ workspace_id: ws.id, cli: "terminal" });
    expect(sessoes.sessoes.get(a.sessao_id)?.permissao).toBe("seguro");
    expect(sessoes.sessoes.get(b.sessao_id)?.permissao).toBeUndefined();
  });

  it("causa do 'pane vazio': preparo SEM prompt embutido (Pane livre com MCP/settings) não pode engolir o prompt inicial do disparo", async () => {
    const { panes, ws, sessoes } = montar();
    panes.definirPreparador(async () => ({ argumentos: ["--mcp-config", "/x/mcp.json", "--settings", "/x/s.json"], ambiente: {} }));
    const r = await panes.abrirPane({ workspace_id: ws.id, cli: "claude", prompt_inicial: "/expx:prodx pedido" });
    const s = sessoes.sessoes.get(r.sessao_id);
    expect(s?.pedido["prompt_inicial"]).toBe("/expx:prodx pedido");
    expect(s?.pedido["argumentos"]).toEqual(["--mcp-config", "/x/mcp.json", "--settings", "/x/s.json"]);
  });

  it("preparador que devolve null mantém o lançamento comum (com prompt inicial)", async () => {
    const { panes, ws, sessoes } = montar();
    panes.definirPreparador(async () => null);
    const r = await panes.abrirPane({ workspace_id: ws.id, cli: "claude", prompt_inicial: "oi" });
    expect(sessoes.sessoes.get(r.sessao_id)?.pedido["prompt_inicial"]).toBe("oi");
  });

  it("preparador que falha encerra o Pane com falha_ao_abrir e propaga o erro; removê-lo volta ao normal", async () => {
    const { panes, ws, repos, sessoes } = montar();
    panes.definirPreparador(async () => { throw new Error("sem servidor"); });
    await expect(panes.abrirPane({ workspace_id: ws.id, cli: "claude" })).rejects.toThrow("sem servidor");
    expect(repos.pane.listarPorWorkspace(ws.id).itens[0]).toMatchObject({ estado: "encerrado", encerrado_motivo: "falha_ao_abrir" });
    expect(sessoes.sessoes.size).toBe(0);
    panes.definirPreparador(null);
    await expect(panes.abrirPane({ workspace_id: ws.id, cli: "claude" })).resolves.toBeDefined();
  });
});

describe("eventos da sessão → estado do Pane", () => {
  it("atividade e encerramento atualizam o Pane e avisam a UI", async () => {
    const { repos, panes, ws, sessoes, eventos } = montar();
    const r = await panes.abrirPane({ workspace_id: ws.id, cli: "claude" });
    sessoes.emitir(r.sessao_id, { tipo: "estado", estado: "executando", erro_codigo: null, mensagem: null });
    expect(repos.pane.exigir(r.pane.id).estado).toBe("pronto");
    sessoes.emitir(r.sessao_id, { tipo: "atividade", atividade: "trabalhando" });
    expect(repos.pane.exigir(r.pane.id).estado).toBe("trabalhando");
    sessoes.emitir(r.sessao_id, { tipo: "atividade", atividade: "aguardando" });
    expect(repos.pane.exigir(r.pane.id).estado).toBe("aguardando");
    sessoes.emitir(r.sessao_id, { tipo: "conversa", conversa_id: "conv_1" });
    expect(repos.pane.ultimaSessao(r.pane.id)?.cli_ref_conversa).toBe("conv_1");
    sessoes.emitir(r.sessao_id, { tipo: "encerramento", codigo: 0, sinal: null });
    expect(repos.pane.exigir(r.pane.id)).toMatchObject({ estado: "encerrado", encerrado_motivo: "processo_encerrado" });
    expect(eventos.length).toBeGreaterThan(3);
  });

  it("depois de encerrado, um evento atrasado não ressuscita o Pane", async () => {
    const { repos, panes, ws, sessoes } = montar();
    const r = await panes.abrirPane({ workspace_id: ws.id, cli: "claude" });
    await panes.encerrarPane(r.pane.id, "usuario");
    sessoes.emitir(r.sessao_id, { tipo: "atividade", atividade: "trabalhando" });
    expect(repos.pane.exigir(r.pane.id).estado).toBe("encerrado");
    expect(sessoes.sessoes.get(r.sessao_id)?.estado).toBe("encerrada");
  });
});

describe("restaurar ao reabrir o app", () => {
  it("8 Panes vivos religam e continuam como estavam (P-13)", async () => {
    const primeira = montar();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await primeira.panes.abrirPane({ workspace_id: primeira.ws.id, cli: "claude" });
      ids.push(r.sessao_id);
      primeira.repos.pane.atualizar(r.pane.id, { estado: i % 2 === 0 ? "pronto" : "trabalhando" });
    }
    // "reabre o app": mesmo banco e mesma pasta de dados, gerenciador novo que recupera as sessões do daemon
    const segunda = montar({ bancoExistente: primeira, dados: primeira.dados, vivas: ids });
    const r = await segunda.panes.restaurar(); // o tempo (P-13) é medido em tests/perf; aqui só a correção, sem limite de tempo
    expect(r.religados).toHaveLength(8);
    expect(r.encerrados).toEqual([]);
    const ativos = segunda.repos.pane.listarPorWorkspace(segunda.ws.id, { somenteAtivos: true }).itens;
    expect(ativos.map((p) => p.estado).sort()).toEqual([...Array(4).fill("pronto"), ...Array(4).fill("trabalhando")]);
    // e o Pane religado volta a reagir aos eventos da sessão
    segunda.sessoes.emitir(ids[0] as string, { tipo: "atividade", atividade: "aguardando" });
    expect(segunda.repos.pane.listarPorWorkspace(segunda.ws.id).itens.find((p) => p.sessao_pty_id === ids[0])?.estado).toBe("aguardando");
  });

  it("Pane cuja sessão morreu vira encerrado e sai do layout", async () => {
    const primeira = montar();
    const abertos = [];
    for (let i = 0; i < 3; i++) abertos.push(await primeira.panes.abrirPane({ workspace_id: primeira.ws.id, cli: "claude" }));
    const layout = criarArmazemLayout(primeira.dados, primeira.ws.id);
    layout.gravar({
      versao: 2,
      ativa: abertos[0]?.sessao_id as string,
      abas: [
        { arvore: { tipo: "divisao", orientacao: "horizontal", primeiro: { tipo: "terminal", sessao_id: abertos[0]?.sessao_id as string }, segundo: { tipo: "terminal", sessao_id: abertos[1]?.sessao_id as string } } },
        { arvore: { tipo: "terminal", sessao_id: abertos[2]?.sessao_id as string } },
      ],
      fixadas: [],
    });
    const vivas = [abertos[0]?.sessao_id as string, abertos[2]?.sessao_id as string];
    const segunda = montar({ bancoExistente: primeira, dados: primeira.dados, vivas });
    const r = await segunda.panes.restaurar();
    expect(r.encerrados).toEqual([abertos[1]?.pane.id]);
    expect(segunda.repos.pane.exigir(abertos[1]?.pane.id as string)).toMatchObject({ estado: "encerrado", encerrado_motivo: "sessao_morreu" });
    const depois = criarArmazemLayout(primeira.dados, primeira.ws.id).ler();
    expect(JSON.stringify(depois)).not.toContain(abertos[1]?.sessao_id as string);
    expect(depois?.abas).toHaveLength(2);
    expect(depois?.abas[0]?.arvore).toEqual({ tipo: "terminal", sessao_id: abertos[0]?.sessao_id });
  });

  it("Pane encerrado não é religado e sessão sem Pane no banco é ignorada", async () => {
    const primeira = montar();
    const a = await primeira.panes.abrirPane({ workspace_id: primeira.ws.id, cli: "claude" });
    await primeira.panes.encerrarPane(a.pane.id, "usuario");
    const segunda = montar({ bancoExistente: primeira, dados: primeira.dados, vivas: [a.sessao_id, "sessao_orfa"] });
    const r = await segunda.panes.restaurar();
    expect(r).toEqual({ religados: [], encerrados: [] });
    expect(segunda.repos.pane.exigir(a.pane.id).encerrado_motivo).toBe("usuario");
  });

  it("AUD-10: daemon que demora a responder: tenta de novo e religa os Panes vivos (nenhum vira encerrado)", async () => {
    const primeira = montar();
    const a = await primeira.panes.abrirPane({ workspace_id: primeira.ws.id, cli: "claude" });
    const sessoes = sessoesFalsas({ vivasNaRecuperacao: [a.sessao_id] });
    const recuperar = sessoes.recuperar;
    let chamadas = 0;
    sessoes.recuperar = async () => { if (++chamadas < 3) throw new Error("daemon indisponível"); return recuperar(); };
    const segunda = montar({ bancoExistente: primeira, dados: primeira.dados, sessoes, atrasosRestauracaoMs: [1, 1, 1] });
    const r = await segunda.panes.restaurar();
    expect(chamadas).toBe(3);
    expect(r).toEqual({ religados: [a.pane.id], encerrados: [] });
    expect(segunda.repos.pane.exigir(a.pane.id).estado).not.toBe("encerrado");
  });

  it("AUD-10: daemon que não responde de jeito nenhum NÃO encerra Pane algum (a decisão é irreversível; fica indeterminado)", async () => {
    const primeira = montar();
    const a = await primeira.panes.abrirPane({ workspace_id: primeira.ws.id, cli: "claude" });
    const sessoes = sessoesFalsas({ vivasNaRecuperacao: [a.sessao_id] });
    sessoes.recuperar = async () => { throw new Error("daemon indisponível"); };
    const segunda = montar({ bancoExistente: primeira, dados: primeira.dados, sessoes, atrasosRestauracaoMs: [1, 1] });
    const r = await segunda.panes.restaurar();
    expect(r).toEqual({ religados: [], encerrados: [], indeterminado: true });
    expect(segunda.repos.pane.exigir(a.pane.id).estado).not.toBe("encerrado");
    // quando o daemon volta, a próxima restauração resolve normalmente
    sessoes.recuperar = async () => [];
    sessoes.sessoes.set(a.sessao_id, { id: a.sessao_id, cwd: "/r", pedido: {}, ambiente: {}, escritas: [], estado: "executando" });
    expect(await segunda.panes.restaurar()).toEqual({ religados: [a.pane.id], encerrados: [] });
  });

  it("piloto cuja sessão morreu libera o posto na Missão", async () => {
    const primeira = montar();
    const m = primeira.repos.mission.criar({ workspace_id: primeira.ws.id, modo: "agentico", origem: "livre", titulo: "M" });
    const p = await primeira.panes.abrirPane({ missao_id: m.id, cli: "claude", papel: "piloto" });
    const segunda = montar({ bancoExistente: primeira, dados: primeira.dados, vivas: [] });
    await segunda.panes.restaurar();
    expect(segunda.repos.mission.exigir(m.id).piloto_pane_id).toBeNull();
    const novo = await segunda.panes.respawn(p.pane.id);
    expect(novo.pane.eh_piloto).toBe(true);
  });
});

describe("respawn", () => {
  it("preserva a linhagem (respawn_de), a Missão, a CLI e o papel; display_id novo", async () => {
    const { repos, panes, ws } = montar();
    const m = repos.mission.criar({ workspace_id: ws.id, modo: "squad", origem: "livre", titulo: "M" });
    const a = await panes.abrirPane({ missao_id: m.id, cli: "claude", papel: "executor", modelo: "opus" });
    await panes.encerrarPane(a.pane.id, "travou");
    const b = await panes.respawn(a.pane.id);
    expect(b.pane).toMatchObject({ respawn_de: a.pane.id, mission_id: m.id, cli: "claude", papel: "executor", modelo: "opus", display_id: 2 });
    const c = await panes.respawn(b.pane.id).catch((e: unknown) => e);
    expect(c).toBeInstanceOf(PaneAtivoErro); // o b ainda vive: só se renasce o que morreu
  });

  it("Pane inexistente é erro nominal", async () => {
    const { panes } = montar();
    await expect(panes.respawn("pane_nada")).rejects.toBeInstanceOf(NaoEncontradoErro);
  });

  it("Fase 8: `opcoes.prompt_inicial` chega à sessão (Pane livre) e `opcoes.contexto` ao preparador; nada é persistido", async () => {
    const { repos, panes, ws, sessoes, banco } = montar();
    const a = await panes.abrirPane({ workspace_id: ws.id, cli: "claude" });
    await panes.encerrarPane(a.pane.id, "fim");
    const vistos: unknown[] = [];
    panes.definirPreparador(async (e) => {
      vistos.push(e.pedido.contexto);
      return null;
    });
    const b = await panes.respawn(a.pane.id, { contexto: { brief: "BRIEF-X" }, prompt_inicial: "BRIEF-X" });
    expect(vistos).toEqual([{ brief: "BRIEF-X" }]);
    expect(sessoes.sessoes.get(b.sessao_id)?.pedido.prompt_inicial).toBe("BRIEF-X");
    const dump = JSON.stringify(banco.consultar("SELECT * FROM pane")) + JSON.stringify(banco.consultar("SELECT * FROM sessao"));
    expect(dump).not.toContain("BRIEF-X");
    expect(repos.pane.exigir(b.pane.id).respawn_de).toBe(a.pane.id);
  });

  it("índice único `ux_pane_respawn_vivo`: um segundo filho vivo do mesmo Pane é recusado pelo banco", async () => {
    const { panes, ws, repos } = montar();
    const a = await panes.abrirPane({ workspace_id: ws.id, cli: "claude" });
    await panes.encerrarPane(a.pane.id, "fim");
    await panes.respawn(a.pane.id);
    expect(() => repos.pane.criar({ workspace_id: ws.id, tipo: "cli", cli: "claude", respawn_de: a.pane.id })).toThrow(/UNIQUE|ux_pane_respawn_vivo|respawn_de/);
  });
});

describe("enviarComando", () => {
  it("digita o comando com Enter no Pane pronto", async () => {
    const { panes, ws, sessoes } = montar();
    const r = await panes.abrirPane({ workspace_id: ws.id, cli: "claude" });
    sessoes.emitir(r.sessao_id, { tipo: "estado", estado: "executando", erro_codigo: null, mensagem: null });
    await panes.enviarComando(r.pane.id, "/expx:sprintx pedido");
    expect(sessoes.sessoes.get(r.sessao_id)?.escritas).toEqual(["/expx:sprintx pedido\r"]);
  });

  it("Pane aguardando não recebe reenvio", async () => {
    const { panes, ws, sessoes } = montar();
    const r = await panes.abrirPane({ workspace_id: ws.id, cli: "claude" });
    sessoes.emitir(r.sessao_id, { tipo: "atividade", atividade: "aguardando" });
    await expect(panes.enviarComando(r.pane.id, "/expx:sprintx x")).rejects.toMatchObject({ motivo: "aguardando" });
    expect(sessoes.sessoes.get(r.sessao_id)?.escritas).toEqual([]);
  });

  it("Pane trabalhando ou encerrado também não recebe", async () => {
    const { panes, ws, sessoes } = montar();
    const r = await panes.abrirPane({ workspace_id: ws.id, cli: "claude" });
    sessoes.emitir(r.sessao_id, { tipo: "atividade", atividade: "trabalhando" });
    await expect(panes.enviarComando(r.pane.id, "x")).rejects.toBeInstanceOf(PaneNaoAceitaComandoErro);
    await panes.encerrarPane(r.pane.id, "u");
    await expect(panes.enviarComando(r.pane.id, "x")).rejects.toMatchObject({ motivo: "encerrado" });
  });

  it("nunca mais de uma entrada automática por vez", async () => {
    const { panes, ws, sessoes } = montar();
    const r = await panes.abrirPane({ workspace_id: ws.id, cli: "claude" });
    sessoes.emitir(r.sessao_id, { tipo: "estado", estado: "executando", erro_codigo: null, mensagem: null });
    await panes.enviarComando(r.pane.id, "/expx:sprintx um");
    await expect(panes.enviarComando(r.pane.id, "/expx:sprintx dois")).rejects.toMatchObject({ motivo: "entrada_pendente" });
    sessoes.emitir(r.sessao_id, { tipo: "atividade", atividade: "trabalhando" });
    sessoes.emitir(r.sessao_id, { tipo: "atividade", atividade: "pronto" });
    await panes.enviarComando(r.pane.id, "/expx:sprintx tres");
    expect(sessoes.sessoes.get(r.sessao_id)?.escritas).toHaveLength(2);
  });

  it("recusa texto com quebra de linha ou controle (uma linha só, nunca várias entradas)", async () => {
    const { panes, ws, sessoes } = montar();
    const r = await panes.abrirPane({ workspace_id: ws.id, cli: "claude" });
    sessoes.emitir(r.sessao_id, { tipo: "estado", estado: "executando", erro_codigo: null, mensagem: null });
    await expect(panes.enviarComando(r.pane.id, "a\nb")).rejects.toMatchObject({ motivo: "texto_invalido" });
    await expect(panes.enviarComando(r.pane.id, "a\u001b[31m")).rejects.toMatchObject({ motivo: "texto_invalido" });
    await expect(panes.enviarComando(r.pane.id, "")).rejects.toMatchObject({ motivo: "texto_invalido" });
  });
});

describe("modelo do Pane vira --model", () => {
  it("claude com modelo 'opus' abre com --model opus; sem modelo ou 'default' não há flag; terminal ignora", async () => {
    const { panes, ws, sessoes } = montar();
    const argv = (id: string) => (sessoes.sessoes.get(id)?.pedido["argumentos"] ?? []) as string[];
    const a = await panes.abrirPane({ workspace_id: ws.id, cli: "claude", modelo: "opus" });
    expect(argv(a.sessao_id)).toEqual(["--model", "opus"]);
    const b = await panes.abrirPane({ workspace_id: ws.id, cli: "claude" });
    expect(argv(b.sessao_id)).toEqual([]);
    const c = await panes.abrirPane({ workspace_id: ws.id, cli: "claude", modelo: "default" });
    expect(argv(c.sessao_id)).toEqual([]);
    const d = await panes.abrirPane({ workspace_id: ws.id, cli: "terminal", modelo: "opus" });
    expect(argv(d.sessao_id)).toEqual([]);
  });
});

describe("marcarDescartada (terminais.descartar)", () => {
  it("encerra o Pane da sessão com motivo 'descartado', limpa o piloto da Missão e avisa", async () => {
    const { repos, panes, ws, eventos } = montar();
    const m = repos.mission.criar({ workspace_id: ws.id, modo: "agentico", origem: "livre", titulo: "M" });
    const r = await panes.abrirPane({ missao_id: m.id, cli: "claude", papel: "piloto" });
    eventos.length = 0;
    const p = panes.marcarDescartada(r.sessao_id);
    expect(p).toMatchObject({ id: r.pane.id, estado: "encerrado", encerrado_motivo: "descartado" });
    expect(repos.pane.exigir(r.pane.id).estado).toBe("encerrado");
    expect(repos.mission.exigir(m.id).piloto_pane_id).toBeNull();
    expect(eventos).toEqual([{ workspace_id: ws.id, mission_id: m.id }]);
  });

  it("sessão sem Pane (ou Pane já encerrado) devolve null e não avisa", async () => {
    const { panes, ws, eventos } = montar();
    expect(panes.marcarDescartada("sessao_inexistente")).toBeNull();
    const r = await panes.abrirPane({ workspace_id: ws.id, cli: "terminal" });
    await panes.encerrarPane(r.pane.id, "usuario");
    eventos.length = 0;
    expect(panes.marcarDescartada(r.sessao_id)).toBeNull();
    expect(eventos).toEqual([]);
  });
});
