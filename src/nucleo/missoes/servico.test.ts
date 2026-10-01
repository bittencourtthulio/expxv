import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PedidoCriarMissao } from "../../compartilhado/dominio";
import { NaoEncontradoErro, TransicaoMissaoInvalidaErro, ValorInvalidoErro } from "../dominio";
import { criarServicoContas } from "../provedores/contas";
import { criarServicoWorkspaces } from "../workspaces/servico";
import { criarRepoGit, criarTmp, detectorFalso, ferramenta, git, limpar, novoBanco, sessoesFalsas } from "../../../tests/fixtures/dominio/ambiente";
import { criarServicoPanes, CliIndisponivelErro } from "./panes";
import { ArvoreOcupadaErro, PilotoObrigatorioErro, criarServicoMissoes } from "./servico";

afterEach(limpar);

function montar(opcoes: { ferramentas?: ReturnType<typeof ferramenta>[]; comandoInicial?: boolean } = {}) {
  const { banco, repos } = novoBanco();
  const dados = criarTmp("dados-");
  const sessoes = sessoesFalsas();
  const eventos: Array<{ workspace_id: string; mission_id: string | null }> = [];
  const dominio: Array<{ tipo: string; payload: Record<string, unknown> }> = [];
  const workspaces = criarServicoWorkspaces({ repos, escolherPasta: async () => null });
  const contas = criarServicoContas({ banco, repos, pastaDeDados: dados });
  const panes = criarServicoPanes({
    banco, repos, workspaces, sessoes: async () => sessoes as never, detector: detectorFalso(opcoes.ferramentas), contas,
    aoMudar: () => undefined,
  });
  const missoes = criarServicoMissoes({
    banco, repos, workspaces, panes,
    aoMudar: (e) => void eventos.push(e),
    aoEventoDominio: (tipo, payload) => void dominio.push({ tipo, payload }),
    ...(opcoes.comandoInicial
      ? { comandoInicial: ({ origem, pedido, cli }: { origem: string; pedido: string; cli: string }) => (cli === "claude" && origem === "feature" ? `/expx:sprintx ${pedido}` : null) }
      : {}),
  });
  return { banco, repos, sessoes, eventos, dominio, workspaces, panes, missoes };
}

/** Sem CLIs o modo padrão é `livre` (squad/agentico exigem piloto); com CLIs, `agentico`. */
const pedido = (ws: string, extra: Partial<PedidoCriarMissao> = {}): PedidoCriarMissao => ({
  workspace_id: ws, modo: extra.clis !== undefined && Object.keys(extra.clis).length === 0 ? "livre" : "agentico", origem: "feature",
  titulo: "Cobrança via PIX", pedido: "quero cobrar por pix", clis: { piloto: "claude" }, ...extra,
});

describe("criar Missão", () => {
  it("Missão livre não cria worktree nem Pane sem CLIs", async () => {
    const { missoes, workspaces, sessoes } = montar();
    const ws = await workspaces.abrir(criarRepoGit().raiz);
    const m = await missoes.criar(pedido(ws?.id as string, { modo: "livre", origem: "livre", clis: {}, pedido: "" }));
    expect(m).toMatchObject({ estado: "intake", worktree: null, branch: null, modo: "livre", origem: "livre", trabalho_id: null });
    expect(sessoes.sessoes.size).toBe(0);
  });

  it("squad e agentico exigem piloto (erro nominal, nada criado)", async () => {
    const { missoes, workspaces, repos } = montar();
    const ws = await workspaces.abrir(criarTmp());
    await expect(missoes.criar(pedido(ws?.id as string, { modo: "squad", clis: {} }))).rejects.toBeInstanceOf(PilotoObrigatorioErro);
    await expect(missoes.criar(pedido(ws?.id as string, { modo: "agentico", clis: { executor: "claude" } }))).rejects.toBeInstanceOf(PilotoObrigatorioErro);
    expect(repos.mission.listarPorWorkspace(ws?.id as string).itens).toHaveLength(0);
  });

  it("Missão de feature em repo git: worktree ../<repo>--<slug>, branch feature/<slug> e Pane aberto NELE", async () => {
    const { missoes, workspaces, sessoes, repos } = montar({ comandoInicial: true });
    const { raiz, pai } = criarRepoGit();
    const ws = await workspaces.abrir(raiz);
    const m = await missoes.criar(pedido(ws?.id as string));
    expect(m).toMatchObject({ worktree: "../repo--cobranca-via-pix", branch: "feature/cobranca-via-pix", origem: "feature" });
    const wt = join(pai, "repo--cobranca-via-pix");
    expect(existsSync(wt)).toBe(true);
    expect(git(raiz, "worktree", "list")).toContain("feature/cobranca-via-pix");
    const [pane] = repos.pane.listarPorMissao(m.id);
    expect(pane).toMatchObject({ papel: "piloto", cli: "claude", cwd: "../repo--cobranca-via-pix" });
    const sessao = sessoes.sessoes.get(pane?.sessao_pty_id as string);
    expect(sessao?.cwd).toBe(wt);
    expect(sessao?.pedido["prompt_inicial"]).toBe("/expx:sprintx quero cobrar por pix");
    expect(repos.mission.exigir(m.id).piloto_pane_id).toBe(pane?.id);
  });

  it("ocorrência com OC-ID: fix/<OC-ID>-<slug>; tipo chore: chore/<OC-ID>-<slug>", async () => {
    const { missoes, workspaces } = montar();
    const ws = await workspaces.abrir(criarRepoGit().raiz);
    const a = await missoes.criar(pedido(ws?.id as string, { origem: "ocorrencia", titulo: "Frete errado", clis: {} }), { oc_id: "OC-2026-0142" });
    expect(a.branch).toBe("fix/OC-2026-0142-frete-errado");
    const b = await missoes.criar(pedido(ws?.id as string, { origem: "ocorrencia", titulo: "Limpar logs", clis: {} }), { oc_id: "OC-2026-0143", tipo_ocorrencia: "chore" });
    expect(b.branch).toBe("chore/OC-2026-0143-limpar-logs");
  });

  it("workspace que não é git não cria worktree (a Missão usa a raiz)", async () => {
    const { missoes, workspaces } = montar();
    const ws = await workspaces.abrir(criarTmp());
    const m = await missoes.criar(pedido(ws?.id as string, { clis: {} }));
    expect(m).toMatchObject({ worktree: null, branch: null });
  });

  it("uma Missão por árvore: a 2ª na mesma raiz é recusada com erro nominal; liberada ao encerrar", async () => {
    const { missoes, workspaces } = montar();
    const ws = await workspaces.abrir(criarTmp());
    const a = await missoes.criar(pedido(ws?.id as string, { clis: {}, titulo: "A" }));
    const erro = await missoes.criar(pedido(ws?.id as string, { clis: {}, titulo: "B" })).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ArvoreOcupadaErro);
    expect((erro as ArvoreOcupadaErro).missionId).toBe(a.id);
    await missoes.abortar(a.id);
    await expect(missoes.criar(pedido(ws?.id as string, { clis: {}, titulo: "B" }))).resolves.toBeDefined();
  });

  it("duas Missões de feature em repo git convivem (cada uma no seu worktree)", async () => {
    const { missoes, workspaces } = montar();
    const ws = await workspaces.abrir(criarRepoGit().raiz);
    const a = await missoes.criar(pedido(ws?.id as string, { clis: {}, titulo: "Um" }));
    const b = await missoes.criar(pedido(ws?.id as string, { clis: {}, titulo: "Dois" }));
    expect(a.worktree).not.toBe(b.worktree);
  });

  it("CLI indisponível falha ANTES de criar worktree ou Missão", async () => {
    const { missoes, workspaces, repos } = montar({ ferramentas: [ferramenta("claude", false)] });
    const { raiz, pai } = criarRepoGit();
    const ws = await workspaces.abrir(raiz);
    await expect(missoes.criar(pedido(ws?.id as string))).rejects.toBeInstanceOf(CliIndisponivelErro);
    expect(repos.mission.listarPorWorkspace(ws?.id as string).itens).toHaveLength(0);
    expect(existsSync(join(pai, "repo--cobranca-via-pix"))).toBe(false);
  });

  it("validações: workspace inexistente, título vazio, CLI com papel inválido", async () => {
    const { missoes, workspaces } = montar();
    const ws = await workspaces.abrir(criarTmp());
    await expect(missoes.criar(pedido("ws_nada"))).rejects.toBeInstanceOf(NaoEncontradoErro);
    await expect(missoes.criar(pedido(ws?.id as string, { titulo: "  ", clis: {} }))).rejects.toBeInstanceOf(ValorInvalidoErro);
    await expect(missoes.criar(pedido(ws?.id as string, { clis: { piloto: "claude", inventado: "claude" } as never }))).rejects.toBeInstanceOf(ValorInvalidoErro);
  });

  it("a Missão nasce com brief em <pastaNoProjeto>/missoes/<id>/ só quando há pedido; pasta tem .gitignore interno", async () => {
    const { missoes, workspaces } = montar();
    const raiz = criarTmp();
    const ws = await workspaces.abrir(raiz);
    const com = await missoes.criar(pedido(ws?.id as string, { clis: {}, pedido: "texto do pedido" }));
    const dir = join(raiz, ".expxv", "missoes", com.id);
    expect(readFileSync(join(dir, "brief.md"), "utf8")).toContain("texto do pedido");
    expect(readFileSync(join(raiz, ".expxv", ".gitignore"), "utf8").trim()).toBe("*");
    await missoes.abortar(com.id);
    const sem = await missoes.criar(pedido(ws?.id as string, { clis: {}, pedido: "", titulo: "outra" }));
    expect(existsSync(join(raiz, ".expxv", "missoes", sem.id))).toBe(false);
    const rel = await missoes.garantirPastaMissao(sem.id);
    expect(rel).toBe(`.expxv/missoes/${sem.id}`);
    expect(existsSync(join(raiz, rel))).toBe(true);
  });

  it("avisa a UI (missoes:mudou) com workspace e Missão", async () => {
    const { missoes, workspaces, eventos } = montar();
    const ws = await workspaces.abrir(criarTmp());
    const m = await missoes.criar(pedido(ws?.id as string, { clis: {} }));
    expect(eventos).toContainEqual({ workspace_id: ws?.id, mission_id: m.id });
  });
});

describe("estados, encerrar e abortar", () => {
  it("transições inválidas são recusadas com erro nominal", async () => {
    const { missoes, workspaces } = montar();
    const ws = await workspaces.abrir(criarTmp());
    const m = await missoes.criar(pedido(ws?.id as string, { clis: {} }));
    await expect(missoes.transicionar(m.id, "concluida")).rejects.toBeInstanceOf(TransicaoMissaoInvalidaErro);
    expect((await missoes.transicionar(m.id, "planejando")).estado).toBe("planejando");
    await expect(missoes.transicionar("mis_nada", "planejando")).rejects.toBeInstanceOf(NaoEncontradoErro);
  });

  it("encerrar conclui pela ordem dos estados, fecha os Panes e NÃO apaga o worktree", async () => {
    const { missoes, workspaces, repos, sessoes } = montar();
    const { raiz, pai } = criarRepoGit();
    const ws = await workspaces.abrir(raiz);
    const m = await missoes.criar(pedido(ws?.id as string));
    const fim = await missoes.encerrar(m.id);
    expect(fim).toMatchObject({ estado: "concluida" });
    expect(fim?.concluida_em).not.toBeNull();
    expect(fim?.worktree).toBe("../repo--cobranca-via-pix");
    expect(existsSync(join(pai, "repo--cobranca-via-pix"))).toBe(true);
    const [pane] = repos.pane.listarPorMissao(m.id);
    expect(pane).toMatchObject({ estado: "encerrado", encerrado_motivo: "missao_encerrada" });
    expect(sessoes.sessoes.get(pane?.sessao_pty_id as string)?.estado).toBe("encerrada");
    await expect(missoes.encerrar(m.id)).rejects.toBeInstanceOf(TransicaoMissaoInvalidaErro);
    expect(await missoes.encerrar("mis_nada")).toBeNull();
  });

  it("abortar mantém o worktree e REGISTRA (evento de domínio + tabela)", async () => {
    const { missoes, workspaces, banco, dominio } = montar();
    const { raiz, pai } = criarRepoGit();
    const ws = await workspaces.abrir(raiz);
    const m = await missoes.criar(pedido(ws?.id as string, { clis: {} }));
    const fim = await missoes.abortar(m.id);
    expect(fim).toMatchObject({ estado: "abortada", worktree: "../repo--cobranca-via-pix", branch: "feature/cobranca-via-pix" });
    expect(existsSync(join(pai, "repo--cobranca-via-pix"))).toBe(true);
    expect(dominio).toContainEqual({ tipo: "mission.closed", payload: expect.objectContaining({ mission_id: m.id, estado: "abortada", worktree_mantido: true }) });
    const linhas = banco.consultar<{ tipo: string; payload_json: string }>("SELECT tipo, payload_json FROM evento_dominio WHERE tipo = 'mission.closed'");
    expect(linhas).toHaveLength(1);
    expect(JSON.parse(linhas[0]?.payload_json as string)).toMatchObject({ mission_id: m.id, estado: "abortada", worktree_mantido: true });
    await expect(missoes.abortar(m.id)).rejects.toBeInstanceOf(TransicaoMissaoInvalidaErro);
  });
});

describe("listar e detalhe", () => {
  it("lista por workspace (mais nova primeiro), filtra por estado e pagina por cursor", async () => {
    const { missoes, workspaces } = montar();
    const base = criarTmp();
    const ws = await workspaces.abrir(base);
    const feitas = [];
    for (let i = 0; i < 3; i++) feitas.push(await missoes.criar(pedido(ws?.id as string, { modo: "livre", origem: "livre", clis: {}, titulo: `M${i}`, pedido: "" })));
    await missoes.abortar((feitas[0] as { id: string }).id);
    const todas = await missoes.listar(ws?.id as string, null, null);
    expect(todas.itens.map((m) => m.titulo)).toEqual(["M2", "M1", "M0"]);
    expect((await missoes.listar(ws?.id as string, "abortada", null)).itens.map((m) => m.titulo)).toEqual(["M0"]);
    expect((await missoes.listar(ws?.id as string, "intake", null)).itens).toHaveLength(2);
  });

  it("detalhe traz Panes, tasks e handoffs; id desconhecido devolve null", async () => {
    const { missoes, workspaces, repos } = montar();
    const ws = await workspaces.abrir(criarTmp());
    const m = await missoes.criar(pedido(ws?.id as string, { clis: { piloto: "claude" } }));
    const t = repos.task.criar({ mission_id: m.id, task_ref: "T-01.01", titulo: "x", papel: "executor" });
    const d = await missoes.detalhe(m.id);
    expect(d?.mission.id).toBe(m.id);
    expect(d?.panes).toHaveLength(1);
    expect(d?.tasks.map((x) => x.id)).toEqual([t.id]);
    expect(d?.handoffs).toEqual([]);
    expect(await missoes.detalhe("mis_nada")).toBeNull();
  });

  it("definirTrabalho liga o trabalho à Missão e recusa ligar o mesmo trabalho a duas", async () => {
    const { missoes, workspaces } = montar();
    const base = criarTmp();
    mkdirSync(join(base, "x"));
    const ws = await workspaces.abrir(base);
    const a = await missoes.criar(pedido(ws?.id as string, { modo: "livre", origem: "livre", clis: {}, titulo: "A", pedido: "" }));
    const b = await missoes.criar(pedido(ws?.id as string, { modo: "livre", origem: "livre", clis: {}, titulo: "B", pedido: "" }));
    expect((await missoes.definirTrabalho(a.id, "cobranca-pix")).trabalho_id).toBe("cobranca-pix");
    await expect(missoes.definirTrabalho(b.id, "cobranca-pix")).rejects.toThrow(/já está ligado/);
    await expect(missoes.definirTrabalho(a.id, "../x")).rejects.toBeInstanceOf(ValorInvalidoErro);
  });
});
