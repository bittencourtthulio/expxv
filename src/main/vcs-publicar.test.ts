// Commit e push / Enviar PR no main: repositórios LOCAIS temporários (git init + bare local como destino do push do `origin` via pushInsteadOf), `gh` FALSO de tests/fixtures
// e dublês do serviço de Panes. Nunca push/PR reais e nenhuma rede (a URL do origin parece github.com, mas o git a redireciona para a pasta local).
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FerramentaDetectada } from "../compartilhado/terminais";
import type { OpcoesPublicacao, PedidoEnviarInstrucao } from "../compartilhado/vcs-publicar";
import { criarRepoGit, criarTmp, git, limpar, novoBanco } from "../../tests/fixtures/dominio/ambiente";
import { criarFake, type Fake } from "../../tests/fixtures/forge/ajudante";
import { PaneNaoAceitaComandoErro } from "../nucleo/missoes/panes";
import { PRODUTO } from "../nucleo/produto";
import { criarVcsMain, type VcsMain } from "./vcs";
import { decidirBotoes } from "../nucleo/vcs/publicar";
import { criarVcsPublicar, TTL_GH_MS, type VcsPublicar } from "./vcs-publicar";

const WS = "ws_01J8ZXAMPLE0000000000000A1";
const URL_GITHUB = "https://github.com/dono/repo.git";
const abertos: VcsMain[] = [];
const fakes: Fake[] = [];
afterEach(async () => {
  while (abertos.length) await abertos.pop()?.encerrar();
  while (fakes.length) fakes.pop()?.limpar();
  limpar();
});

const GH_OK = [
  { quando: ["--version"], saida: "gh version 2.60.0 (2025-01-01)\n" },
  { quando: ["auth", "status"], saida: "github.com\n  ✓ Logged in to github.com account ana (keyring)\n  - Active account: true\n  - Git operations protocol: https\n" },
  { regex: "^pr list", saida: [{ number: 42, title: "Meu PR", state: "OPEN", isDraft: false, author: { login: "ana" }, headRefName: "feat/x", baseRefName: "main", url: "https://github.com/dono/repo/pull/42", createdAt: "d", updatedAt: "d", labels: [], reviewDecision: "", statusCheckRollup: [] }] },
];
const GH_SEM_LOGIN = [GH_OK[0]!, { quando: ["auth", "status"], stderr: "You are not logged into any GitHub hosts. To log in, run: gh auth login\n", codigo: 1 }];

interface PaneFalso { id: string; workspace_id: string; cli: string | null; estado: string; sessao_pty_id: string | null; encerrado_motivo: string | null; mission_id?: string | null; cwd?: string | null }

function montar(o: { remoto?: string | null; gh?: "ok" | "sem_login" | "ausente"; ferramentas?: string[]; confirmarMs?: number } = {}) {
  const { raiz, pai } = criarRepoGit();
  const bare = join(pai, "origin.git");
  git(pai, "init", "-q", "--bare", "-b", "main", bare);
  const remoto = o.remoto === undefined ? URL_GITHUB : o.remoto;
  if (remoto !== null) {
    git(raiz, "remote", "add", "origin", remoto);
    // só o PUSH é redirecionado à pasta local (o `get-url` continua mostrando a URL do GitHub); nada de rede em nenhum teste
    if (remoto === URL_GITHUB) {
      git(raiz, "config", `url.${bare}.pushInsteadOf`, URL_GITHUB);
      git(raiz, "push", "-q", "-u", "origin", "main");
    }
  }
  const fk = criarFake((o.gh ?? "ok") === "sem_login" ? GH_SEM_LOGIN : GH_OK);
  fakes.push(fk);
  const { banco } = novoBanco();
  const vcs = criarVcsMain({
    workspaces: { obter: (id) => (id === WS ? { id: WS, raiz } : undefined) },
    missoes: { obter: () => undefined },
    banco,
    emitir: () => undefined,
    janelaEmFoco: () => false,
    moverParaLixeira: async () => undefined,
    pastaSeguranca: criarTmp("seg-"),
    consultarPr: false,
    opcoesForge: { executaveis: { gh: o.gh === "ausente" ? join(pai, "nao-existe-gh") : fk.gh }, env: fk.env, executor: fk.executor },
  });
  abertos.push(vcs);

  const panes = new Map<string, PaneFalso>();
  const porSessao = new Map<string, string>();
  const chamadas = { abrir: [] as Array<Record<string, unknown>>, enviar: [] as Array<{ id: string; texto: string }> };
  let estadoDoNovo = "pronto";
  let motivoDoNovo: string | null = null;
  const addPane = (p: Partial<PaneFalso> & { id: string; sessao_pty_id: string }): void => {
    panes.set(p.id, { workspace_id: WS, cli: "claude", estado: "pronto", encerrado_motivo: null, ...p });
    porSessao.set(p.sessao_pty_id, p.id);
  };
  const ferramenta = (id: string): FerramentaDetectada => ({ id, nome: id, descricao: "", instalado: true, executavel_id: `exe_${id}`, modo_lancamento: "direto", erro_codigo: null, versao: "1", recursos: { prompt_inicial: true, retomar: false, mcp: false, hook: false } }) as FerramentaDetectada;
  let t = 1_000_000;
  const pub: VcsPublicar = criarVcsPublicar({
    vcs,
    workspaces: { obter: (id) => (id === WS ? { id: WS, raiz } : undefined) },
    banco: { executar: banco.executar.bind(banco), consultarUm: ((sql: string, p: unknown[]) => (porSessao.has(String(p[0])) ? { id: porSessao.get(String(p[0])) } : undefined)) as never },
    repos: { pane: { obter: (id: string) => panes.get(id) as never } } as never,
    panes: {
      abrirPane: (async (p: Record<string, unknown>) => {
        chamadas.abrir.push(p);
        const row: PaneFalso = { id: "pane_novo", workspace_id: WS, cli: String(p["cli"]), estado: estadoDoNovo, sessao_pty_id: "ses_novo", encerrado_motivo: motivoDoNovo };
        panes.set(row.id, row);
        return { pane: row, sessao_id: "ses_novo" };
      }) as never,
      enviarComando: (async (id: string, texto: string) => {
        const p = panes.get(id);
        if (p?.estado !== "pronto") throw new PaneNaoAceitaComandoErro((p?.estado ?? "encerrado") as never);
        chamadas.enviar.push({ id, texto });
      }) as never,
    },
    detector: { detectar: async () => (o.ferramentas ?? ["claude", "codex"]).map(ferramenta) },
    abrirExterno: () => undefined,
    agora: () => (t += 1),
    confirmarEntregaMs: o.confirmarMs ?? 0,
    esperaGhMs: 5_000,
  });
  const relogio = { avancar: (ms: number) => void (t += ms) };
  return { raiz, pai, bare, vcs, pub, fk, panes, addPane, chamadas, banco, relogio, definirNovo: (estado: string, motivo: string | null = null) => { estadoDoNovo = estado; motivoDoNovo = motivo; } };
}

const estado = (m: ReturnType<typeof montar>, consultar_pr = false) => m.pub.estado({ workspace_id: WS, consultar_pr });
const escrever = (raiz: string, rel: string, c = "x\n") => { mkdirSync(join(raiz, rel, ".."), { recursive: true }); writeFileSync(join(raiz, rel), c); };
const opcoes = (p: Partial<OpcoesPublicacao> = {}): OpcoesPublicacao => ({ criar_ramo: true, nome_ramo: "feat/algo", incluir_nao_rastreados: true, incluir_suite: false, mensagem: { modo: "agente", texto: null }, pr: null, confirmar_padrao: null, ...p });
const pedido = (p: Partial<PedidoEnviarInstrucao> = {}): PedidoEnviarInstrucao => ({ workspace_id: WS, tipo: "commit_push", opcoes: opcoes(), sessao_foco: null, cli: null, modo_painel: "auto", ...p });
const eventos = (m: ReturnType<typeof montar>) => m.banco.consultar<{ tipo: string; payload_json: string }>("SELECT tipo, payload_json FROM evento_dominio ORDER BY rowid").filter((e) => e.tipo === "vcs.publicar");
const instrucoes = (raiz: string): string[] => { const d = join(raiz, PRODUTO.pastaNoProjeto, "publicar"); return existsSync(d) ? readdirSync(d) : []; };

describe("fatos locais do estado (D-630/D-631)", () => {
  it("repo com origin no GitHub e gh autenticado: branch padrão, alterações contadas sem a pasta do produto nem segredos", async () => {
    const m = montar();
    escrever(m.raiz, "src/a.ts");
    escrever(m.raiz, `${PRODUTO.pastaNoProjeto}/x.md`);
    escrever(m.raiz, ".env.local", "SEGREDO=1\n");
    writeFileSync(join(m.raiz, "README.md"), "# mudou\n");
    const e = await estado(m);
    expect(e).toMatchObject({ git: true, remoto_github: true, repo: "dono/repo", gh: "ok", branch: "main", ramo_padrao: "main", no_padrao: true, alteradas: 1, novas: 1, suite: { itens: 1, caminhos: [`${PRODUTO.pastaNoProjeto}/`] }, atras: 0, upstream: "origin/main", a_frente: 0, tem_upstream: true, operacao_em_curso: false, pr: null });
    expect(e.oid).toMatch(/^[0-9a-f]{7}$/);
    expect(JSON.stringify(e)).not.toContain(m.raiz);
  });
  it("branch de trabalho: commits à frente da base e do upstream, sem upstream ainda", async () => {
    const m = montar();
    git(m.raiz, "switch", "-q", "-c", "feat/x");
    escrever(m.raiz, "a.ts");
    git(m.raiz, "add", ".");
    git(m.raiz, "commit", "-q", "-m", "feat: a");
    const e = await estado(m);
    expect(e).toMatchObject({ branch: "feat/x", no_padrao: false, alteradas: 0, novas: 0, suite: { itens: 0, caminhos: [] }, atras: 0, upstream: null, a_frente_base: 1, tem_upstream: false });
  });
  it("commits locais não enviados no branch com upstream: a_frente conta", async () => {
    const m = montar();
    escrever(m.raiz, "a.ts");
    git(m.raiz, "add", ".");
    git(m.raiz, "commit", "-q", "-m", "feat: a");
    expect(await estado(m)).toMatchObject({ a_frente: 1, alteradas: 0 });
  });
  it("origin que não é GitHub, sem origin e fora de git: sem botões", async () => {
    for (const remoto of ["git@gitlab.com:dono/repo.git", "https://github.empresa.com/dono/repo.git", null]) {
      const m = montar({ remoto });
      expect((await estado(m)).remoto_github, String(remoto)).toBe(false);
    }
  });
  it("gh ausente, sem login e com login (verificação local, em cache curto)", async () => {
    expect((await estado(montar({ gh: "ausente" }))).gh).toBe("ausente");
    expect((await estado(montar({ gh: "sem_login" }))).gh).toBe("nao_autenticado");
    const m = montar();
    expect((await estado(m)).gh).toBe("ok");
    await estado(m);
    const verificacoes = () => m.fk.chamadas().filter((c) => c.argv[0] === "auth").length;
    expect(verificacoes()).toBe(1);
    m.relogio.avancar(TTL_GH_MS + 10);
    await estado(m);
    expect(verificacoes()).toBe(2);
  });
  it("o PR só é consultado quando pedido (uma vez, depois do push) e só devolve URL https://github.com", async () => {
    const m = montar();
    git(m.raiz, "switch", "-q", "-c", "feat/x");
    expect((await estado(m)).pr).toBeNull();
    expect(m.fk.chamadas().some((c) => c.argv[0] === "pr")).toBe(false);
    const e = await estado(m, true);
    expect(e.pr).toEqual({ numero: 42, url: "https://github.com/dono/repo/pull/42", estado: "aberto" });
    expect(m.fk.chamadas().filter((c) => c.argv[0] === "pr")).toHaveLength(1);
  });
  it("não é git: nada a mostrar", async () => {
    const sem = criarTmp("sem-git-");
    const { banco } = novoBanco();
    const vcs = criarVcsMain({ workspaces: { obter: () => ({ id: WS, raiz: sem }) }, missoes: { obter: () => undefined }, banco, emitir: () => undefined, janelaEmFoco: () => false, moverParaLixeira: async () => undefined, pastaSeguranca: criarTmp("seg-"), consultarPr: false });
    abertos.push(vcs);
    const pub = criarVcsPublicar({ vcs, workspaces: { obter: () => ({ id: WS, raiz: sem }) }, banco: {} as never, repos: {} as never, panes: {} as never, detector: { detectar: async () => [] }, abrirExterno: () => undefined });
    expect(await pub.estado({ workspace_id: WS, consultar_pr: false })).toMatchObject({ git: false, remoto_github: false });
  });
});

describe("preparo do diálogo (D-632/D-633)", () => {
  it("resumo só com NOMES: 8 primeiros, 'mais N', +A/−R, segredos separados, sugestão de branch, CLIs; nunca conteúdo nem caminho absoluto", async () => {
    const m = montar();
    for (let i = 1; i <= 11; i++) escrever(m.raiz, `src/renderer/arq${String(i).padStart(2, "0")}.ts`, `CONTEUDO_SECRETO_${i}\nlinha2\n`);
    for (let i = 1; i <= 9; i++) escrever(m.raiz, `solto${i}.ts`, "x\n");
    writeFileSync(join(m.raiz, "README.md"), "# teste\nnova linha\n");
    escrever(m.raiz, ".env", "TOKEN=abc\n");
    escrever(m.raiz, "certs/server.pem", "-----BEGIN-----\n");
    const p = await m.pub.preparar("commit_push", { workspace_id: WS, sessao_foco: null });
    expect(p).toMatchObject({ tipo: "commit_push", branch: "main", remoto: "origin", repo: "dono/repo", ramo_padrao: "main", no_padrao: true, total_arquivos: 1, novos: 10, mais: 3, cli_padrao: "claude", cli_foco: null });
    expect(p.arquivos).toHaveLength(8);
    expect(p.arquivos.every((a) => !a.sensivel)).toBe(true);
    expect(p.sensiveis.sort()).toEqual([".env", "certs/server.pem"].sort());
    expect(p.arquivos.map((a) => a.caminho)).not.toContain(".env");
    expect(p.adicionadas).toBeGreaterThanOrEqual(1);
    expect(p.removidas).toBe(0);
    expect(p.sugestao_ramo).toMatch(/^feat\/[a-z0-9-]+-\d{4}$/);
    expect(p.clis.map((c) => c.id)).toEqual(["claude", "codex"]);
    const json = JSON.stringify(p);
    expect(json).not.toContain("CONTEUDO_SECRETO");
    expect(json).not.toContain("TOKEN=abc");
    expect(json).not.toContain(m.raiz);
  });
  it("cli_foco só quando o painel em foco é CLI de IA deste workspace", async () => {
    const m = montar();
    escrever(m.raiz, "a.ts");
    m.addPane({ id: "pane_1", sessao_pty_id: "ses_1", cli: "codex" });
    m.addPane({ id: "pane_2", sessao_pty_id: "ses_2", cli: "terminal" });
    m.addPane({ id: "pane_3", sessao_pty_id: "ses_3", workspace_id: "ws_outro" });
    m.addPane({ id: "pane_4", sessao_pty_id: "ses_4", mission_id: "mis_1" });
    expect((await m.pub.preparar("commit_push", { workspace_id: WS, sessao_foco: "ses_1" })).cli_foco).toBe("codex");
    expect((await m.pub.preparar("commit_push", { workspace_id: WS, sessao_foco: "ses_2" })).cli_foco).toBeNull();
    expect((await m.pub.preparar("commit_push", { workspace_id: WS, sessao_foco: "ses_3" })).cli_foco).toBeNull();
    expect((await m.pub.preparar("commit_push", { workspace_id: WS, sessao_foco: "ses_x" })).cli_foco).toBeNull();
    expect((await m.pub.preparar("commit_push", { workspace_id: WS, sessao_foco: "ses_4" })).cli_foco).toBeNull();
  });
  it("remoto que não é GitHub recusa o preparo", async () => {
    const m = montar({ remoto: "git@gitlab.com:a/b.git" });
    await expect(m.pub.preparar("pr", { workspace_id: WS, sessao_foco: null })).rejects.toThrow(/GitHub/);
  });
});

describe("envio da instrução (D-634/D-635): defesas e entrega", () => {
  it("branch padrão sem criar branch e sem a frase digitada: recusa e não toca em nenhum painel", async () => {
    const m = montar();
    escrever(m.raiz, "a.ts");
    const r = await m.pub.enviar(pedido({ opcoes: opcoes({ criar_ramo: false, nome_ramo: null }) }));
    expect(r).toMatchObject({ estado: "falhou" });
    expect(r.motivo).toMatch(/push na main/);
    expect(m.chamadas.abrir).toHaveLength(0);
    expect(m.chamadas.enviar).toHaveLength(0);
    expect(instrucoes(m.raiz)).toHaveLength(0);
  });
  it("frase errada também recusa; a frase exata libera (e fica só no bloco de dados)", async () => {
    const m = montar();
    escrever(m.raiz, "a.ts");
    for (const frase of ["push na master", "push na main ", "PUSH NA MAIN", ""]) expect((await m.pub.enviar(pedido({ opcoes: opcoes({ criar_ramo: false, nome_ramo: null, confirmar_padrao: frase }) }))).estado, frase).toBe("falhou");
    const r = await m.pub.enviar(pedido({ opcoes: opcoes({ criar_ramo: false, nome_ramo: null, confirmar_padrao: "push na main" }) }));
    expect(r.estado).toBe("entregue");
    expect(eventos(m)[0]?.payload_json).toContain('"push_no_padrao_confirmado":true');
  });
  it("criar branch com nome inválido ou igual ao padrão: recusa", async () => {
    const m = montar();
    escrever(m.raiz, "a.ts");
    for (const nome of ["x; rm -rf ~", "-f", "a..b", "main", "master", "develop", "$(id)"]) {
      const r = await m.pub.enviar(pedido({ opcoes: opcoes({ nome_ramo: nome }) }));
      expect(r.estado, nome).toBe("falhou");
    }
    expect(m.chamadas.abrir).toHaveLength(0);
  });
  it("sem alterações e sem commits à frente: 'Nada para commitar'", async () => {
    const m = montar();
    expect((await m.pub.enviar(pedido())).motivo).toBe("Nada para commitar.");
  });
  it("sem sessão em foco: abre Pane novo com a CLI padrão e a linha como prompt inicial; a instrução fica na pasta do produto, sem conteúdo de arquivos", async () => {
    const m = montar();
    escrever(m.raiz, "src/a.ts", "CORPO_DO_ARQUIVO_NAO_PODE_VAZAR\n");
    escrever(m.raiz, ".env", "TOKEN=abc\n");
    const r = await m.pub.enviar(pedido());
    expect(r).toMatchObject({ estado: "entregue", entrega: "prompt_inicial", pane_id: "pane_novo", sessao_id: "ses_novo", motivo: null });
    expect(m.chamadas.abrir).toHaveLength(1);
    const abrir = m.chamadas.abrir[0]!;
    expect(abrir).toMatchObject({ workspace_id: WS, cli: "claude", papel: "nenhum" });
    const linha = String(abrir["prompt_inicial"]);
    expect(linha).toContain(r.instrucao_rel ?? "?");
    expect(linha).not.toMatch(/[\r\n]/);
    expect(r.instrucao_rel).toMatch(new RegExp(`^\\${PRODUTO.pastaNoProjeto}/publicar/.+-commit-push\\.md$`));
    const arquivo = readFileSync(join(m.raiz, r.instrucao_rel ?? ""), "utf8");
    expect(arquivo).toContain("git push -u origin feat/algo");
    expect(arquivo).toContain("git switch -c feat/algo");
    expect(arquivo).toContain('"src/a.ts"');
    expect(arquivo).not.toContain("CORPO_DO_ARQUIVO_NAO_PODE_VAZAR");
    expect(arquivo).not.toContain("TOKEN=abc");
    expect(arquivo).toContain("`.env`");
    expect(arquivo).not.toContain(m.raiz);
    // auditoria sem conteúdo: só contagens e flags
    const ev = eventos(m);
    expect(ev).toHaveLength(1);
    const payload = JSON.parse(ev[0]!.payload_json) as Record<string, unknown>;
    expect(payload).toMatchObject({ acao: "commit_push", estado: "entregue", entrega: "prompt_inicial", arquivos: 0, novos: 1, suite_itens: 0, incluir_suite: false, sensiveis_excluidos: 1, criar_ramo: true });
    expect(ev[0]!.payload_json).not.toContain("feat/algo");
    expect(ev[0]!.payload_json).not.toContain("src/a.ts");
  });
  it("painel em foco pronto (CLI de IA do workspace): escreve a linha nele", async () => {
    const m = montar();
    escrever(m.raiz, "a.ts");
    m.addPane({ id: "pane_1", sessao_pty_id: "ses_1", cli: "claude", estado: "pronto" });
    const r = await m.pub.enviar(pedido({ sessao_foco: "ses_1" }));
    expect(r).toMatchObject({ estado: "entregue", entrega: "escrita", pane_id: "pane_1", sessao_id: "ses_1" });
    expect(m.chamadas.enviar).toHaveLength(1);
    expect(m.chamadas.enviar[0]!.texto).toContain(r.instrucao_rel ?? "?");
    expect(m.chamadas.abrir).toHaveLength(0);
  });
  it("painel ocupado: pergunta (nada escrito, nada aberto, arquivo descartado); respondendo 'novo' abre um Pane", async () => {
    const m = montar();
    escrever(m.raiz, "a.ts");
    m.addPane({ id: "pane_1", sessao_pty_id: "ses_1", estado: "trabalhando" });
    const r = await m.pub.enviar(pedido({ sessao_foco: "ses_1" }));
    expect(r).toMatchObject({ estado: "ocupado", instrucao_rel: null });
    expect(r.motivo).toBe("O agente está trabalhando. Abrir um painel novo para isto?");
    expect(m.chamadas.enviar).toHaveLength(0);
    expect(m.chamadas.abrir).toHaveLength(0);
    expect(instrucoes(m.raiz)).toHaveLength(0);
    const r2 = await m.pub.enviar(pedido({ sessao_foco: "ses_1", modo_painel: "novo" }));
    expect(r2).toMatchObject({ estado: "entregue", entrega: "prompt_inicial" });
    expect(m.chamadas.abrir).toHaveLength(1);
  });
  it("CLI que morre na largada: falhou com motivo, sem arquivo e sem entrega", async () => {
    const m = montar();
    escrever(m.raiz, "a.ts");
    m.definirNovo("encerrado", "processo_encerrado");
    const r = await m.pub.enviar(pedido());
    expect(r).toMatchObject({ estado: "falhou", entrega: null, instrucao_rel: null });
    expect(r.motivo).toMatch(/saiu antes de receber a instrução/);
    expect(instrucoes(m.raiz)).toHaveLength(0);
    expect(JSON.parse(eventos(m)[0]!.payload_json)).toMatchObject({ estado: "falhou" });
  });
  it("sem nenhuma CLI de IA instalada: falhou com o motivo", async () => {
    const m = montar({ ferramentas: [] });
    escrever(m.raiz, "a.ts");
    const r = await m.pub.enviar(pedido());
    expect(r.estado).toBe("falhou");
    expect(r.motivo).toMatch(/Nenhuma CLI de IA/);
  });
  it("PR: gh sem login recusa; branch padrão recusa; branch com commits gera a instrução com gh pr create", async () => {
    const sem = montar({ gh: "sem_login" });
    git(sem.raiz, "switch", "-q", "-c", "feat/x");
    expect((await sem.pub.enviar(pedido({ tipo: "pr", opcoes: opcoes({ criar_ramo: false, nome_ramo: null, pr: { titulo: { modo: "agente", texto: null }, descricao: { modo: "agente", texto: null }, rascunho: false, base: null, revisores: [] } }) }))).motivo).toMatch(/gh auth login/);

    const m = montar();
    const pr = { titulo: { modo: "agente" as const, texto: null }, descricao: { modo: "agente" as const, texto: null }, rascunho: true, base: null, revisores: ["maria-dev"] };
    expect((await m.pub.enviar(pedido({ tipo: "pr", opcoes: opcoes({ criar_ramo: false, nome_ramo: null, pr }) }))).motivo).toMatch(/Crie um branch primeiro/);
    git(m.raiz, "switch", "-q", "-c", "feat/x");
    escrever(m.raiz, "a.ts");
    git(m.raiz, "add", ".");
    git(m.raiz, "commit", "-q", "-m", "feat: a");
    const r = await m.pub.enviar(pedido({ tipo: "pr", opcoes: opcoes({ criar_ramo: false, nome_ramo: null, pr }) }));
    expect(r.estado).toBe("entregue");
    const texto = readFileSync(join(m.raiz, r.instrucao_rel ?? ""), "utf8");
    expect(texto).toContain("gh pr create --repo dono/repo --base main --head feat/x --title <título> --body-file <arquivo> --draft --reviewer maria-dev");
    expect(r.instrucao_rel).toMatch(/-pr\.md$/);
  });
  it("PR: branch sem commits além da base e sem upstream é recusado no preparo do botão (tabela) e o envio não finge", async () => {
    const m = montar();
    git(m.raiz, "switch", "-q", "-c", "feat/vazio");
    const e = await estado(m);
    expect(e).toMatchObject({ a_frente_base: 0, tem_upstream: false });
  });
  it("merge em andamento recusa", async () => {
    const m = montar();
    git(m.raiz, "switch", "-q", "-c", "feat/a");
    writeFileSync(join(m.raiz, "README.md"), "a\n");
    git(m.raiz, "commit", "-qam", "a");
    git(m.raiz, "switch", "-q", "main");
    writeFileSync(join(m.raiz, "README.md"), "b\n");
    git(m.raiz, "commit", "-qam", "b");
    try { git(m.raiz, "merge", "feat/a"); } catch { /* conflito esperado */ }
    const r = await m.pub.enviar(pedido());
    expect(r.motivo).toMatch(/merge\/rebase em andamento/);
  });
  it("instrução usa os assuntos recentes e a pasta do produto continua fora do git", async () => {
    const m = montar();
    escrever(m.raiz, "a.ts");
    const r = await m.pub.enviar(pedido());
    const texto = readFileSync(join(m.raiz, r.instrucao_rel ?? ""), "utf8");
    expect(texto).toContain("inicial");
    expect(git(m.raiz, "status", "--short")).not.toContain(PRODUTO.pastaNoProjeto);
  });
  it("abrirUrl só abre https://github.com", async () => {
    const m = montar();
    expect(await m.pub.abrirUrl({ workspace_id: WS, url: "https://github.com/dono/repo/pull/42" })).toBe(true);
    for (const url of ["http://github.com/a/b", "https://evil.io/pull/1", "file:///etc/passwd", "https://u:p@github.com/a"]) expect(await m.pub.abrirUrl({ workspace_id: WS, url }), url).toBe(false);
    await expect(m.pub.abrirUrl({ workspace_id: "ws_01J8ZXAMPLE0000000000000Z9", url: "https://github.com/a/b" })).rejects.toThrow(/Workspace/);
  });
});

// ---- contagem honesta e pastas da suíte (D-691/D-692) --------------------------------------------------------------------------------

/** Reproduz o repositório do dono (expxplay): 3 pastas não rastreadas escritas pela suíte e pelo app, 403 arquivos no `-uall`, e NADA mais para commitar. */
function popularSuite(raiz: string): void {
  for (let i = 0; i < 352; i++) escrever(raiz, `.expx/regras/r${i}.md`, `r${i}\n`);
  for (let i = 0; i < 50; i++) escrever(raiz, `.opencode/agents/a${i}.md`, `a${i}\n`);
  escrever(raiz, `${PRODUTO.pastaNoProjeto}/estado.json`, "{}\n");
}

describe("contagem honesta: a suíte não conta (D-691)", () => {
  it("3 pastas não rastreadas (403 arquivos) e nada mais: 0 alteradas, 0 novas, suíte 3; botão 'Nada para commitar' e sem badge", async () => {
    const m = montar();
    popularSuite(m.raiz);
    expect(git(m.raiz, "status", "--porcelain", "-uall").split("\n").filter(Boolean)).toHaveLength(403);
    expect(git(m.raiz, "status", "--porcelain").split("\n").filter(Boolean)).toHaveLength(3);
    const e = await estado(m);
    expect(e).toMatchObject({ alteradas: 0, novas: 0, a_frente: 0, atras: 0 });
    expect(e.suite.itens).toBe(3);
    expect(e.suite.caminhos.sort()).toEqual([".expx/", ".opencode/", `${PRODUTO.pastaNoProjeto}/`].sort());
    const b = decidirBotoes({ tela: "terminais", fatos: e }).commit;
    expect(b).toMatchObject({ visivel: true, habilitado: false, badge: null, abreMesmoDesabilitado: true });
    expect(b.tooltip).toMatch(/^Nada para commitar\./);
    expect(b.tooltip).toContain("3 pastas da suíte não rastreadas");
    const r = await m.pub.enviar(pedido());
    expect(r).toMatchObject({ estado: "falhou", motivo: "Nada para commitar." });
  });
  it("trabalho real + suíte: o badge conta só o trabalho (modificado 1 + pasta nova 1); a pasta nova vale 1 como no git", async () => {
    const m = montar();
    popularSuite(m.raiz);
    writeFileSync(join(m.raiz, "README.md"), "# mudou\n");
    for (let i = 0; i < 30; i++) escrever(m.raiz, `src/novo/f${i}.ts`);
    const e = await estado(m);
    expect(e).toMatchObject({ alteradas: 1, novas: 1 });
    expect(e.suite.itens).toBe(3);
    const b = decidirBotoes({ tela: "terminais", fatos: e }).commit;
    expect(b).toMatchObject({ habilitado: true, badge: "2" });
    expect(b.tooltip).toContain("1 arquivo alterado e 1 pasta/arquivo novo");
    const p = await m.pub.preparar("commit_push", { workspace_id: WS, sessao_foco: null });
    expect(p).toMatchObject({ total_arquivos: 1, novos: 1 });
    expect(p.suite).toMatchObject({ itens: 3, incluiveis: 2 });
  });
  it("depois do commit e do push só sobra a suíte: volta a 'Nada para commitar' (sem 402 para sempre)", async () => {
    const m = montar();
    popularSuite(m.raiz);
    escrever(m.raiz, "src/a.ts");
    expect((await estado(m)).novas).toBe(1);
    git(m.raiz, "add", "src/a.ts");
    git(m.raiz, "commit", "-q", "-m", "feat: a");
    git(m.raiz, "push", "-q", "origin", "main");
    const e = await estado(m);
    expect(e).toMatchObject({ alteradas: 0, novas: 0, a_frente: 0 });
    expect(decidirBotoes({ tela: "terminais", fatos: e }).commit).toMatchObject({ habilitado: false, badge: null });
  });
  it("arquivo solto da suíte (dentro de pasta já rastreada) também é da suíte, não do trabalho", async () => {
    const m = montar();
    escrever(m.raiz, ".claude/keep.md");
    git(m.raiz, "add", ".claude/keep.md");
    git(m.raiz, "commit", "-q", "-m", "claude");
    escrever(m.raiz, ".claude/skills/x/SKILL.md");
    const e = await estado(m);
    expect(e).toMatchObject({ alteradas: 0, novas: 0 });
    expect(e.suite.caminhos).toEqual([".claude/skills/"]);
  });
  it("'Incluir no commit': a instrução recebe a lista (sem a pasta do produto) e o commit é permitido só com a suíte; padrão desmarcado proíbe git add nelas", async () => {
    const m = montar();
    popularSuite(m.raiz);
    const r = await m.pub.enviar(pedido({ opcoes: opcoes({ incluir_suite: true }) }));
    expect(r.estado).toBe("entregue");
    const incluir = readFileSync(join(m.raiz, r.instrucao_rel ?? ""), "utf8");
    expect(incluir).toContain("INCLUIR");
    expect(incluir).toContain("suite_a_incluir");
    expect(incluir).toContain('".expx/"');
    expect(incluir).toContain('".opencode/"');
    expect(incluir).not.toMatch(new RegExp(`"suite_a_incluir"[\\s\\S]*${PRODUTO.pastaNoProjeto}/"[\\s\\S]*</dados`));
    expect(JSON.parse(eventos(m)[0]!.payload_json)).toMatchObject({ incluir_suite: true, suite_itens: 3 });
    // com trabalho real e a suíte desmarcada: a instrução manda deixar a suíte de fora
    escrever(m.raiz, "a.ts");
    const r2 = await m.pub.enviar(pedido());
    const ignorar = readFileSync(join(m.raiz, r2.instrucao_rel ?? ""), "utf8");
    expect(ignorar).toContain("FORA do commit");
    expect(ignorar).not.toContain("suite_a_incluir");
  });
  it("sem 'Incluir' e sem trabalho real: recusa (a suíte sozinha nunca habilita o commit)", async () => {
    const m = montar();
    popularSuite(m.raiz);
    expect((await m.pub.enviar(pedido({ opcoes: opcoes({ incluir_suite: false }) }))).estado).toBe("falhou");
    expect(instrucoes(m.raiz)).toEqual([]);
  });
});

describe("ignorar a suíte neste computador (D-692)", () => {
  it("acrescenta linhas ancoradas em .git/info/exclude (local), não toca o .gitignore e zera a suíte; idempotente", async () => {
    const m = montar();
    popularSuite(m.raiz);
    escrever(m.raiz, "src/a.ts");
    const antes = existsSync(join(m.raiz, ".gitignore")) ? readFileSync(join(m.raiz, ".gitignore"), "utf8") : null;
    const r = await m.pub.ignorarSuite({ workspace_id: WS });
    expect(r).toEqual({ estado: "ok", linhas: 3 });
    const exclude = readFileSync(join(m.raiz, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain("/.expx/\n");
    expect(exclude).toContain("/.opencode/\n");
    expect(exclude).toContain(`/${PRODUTO.pastaNoProjeto}/\n`);
    expect(exclude.endsWith("\n")).toBe(true);
    expect(existsSync(join(m.raiz, ".gitignore")) ? readFileSync(join(m.raiz, ".gitignore"), "utf8") : null).toBe(antes);
    expect(git(m.raiz, "status", "--porcelain").trim()).toBe("?? src/");
    expect(await m.pub.ignorarSuite({ workspace_id: WS })).toEqual({ estado: "nada", linhas: 0 });
    expect(readFileSync(join(m.raiz, ".git", "info", "exclude"), "utf8")).toBe(exclude);
    const ev = m.banco.consultar<{ payload_json: string }>("SELECT payload_json FROM evento_dominio WHERE tipo = 'vcs.publicar'");
    expect(ev.map((e) => JSON.parse(e.payload_json))).toEqual([expect.objectContaining({ acao: "ignorar_suite", linhas: 3, itens: 3 })]);
  });
  it("preserva o exclude que já existia e funciona em worktree (diretório comum do git)", async () => {
    const m = montar();
    mkdirSync(join(m.raiz, ".git", "info"), { recursive: true });
    writeFileSync(join(m.raiz, ".git", "info", "exclude"), "# meu\n*.log");
    escrever(m.raiz, ".expx/a.md");
    expect((await m.pub.ignorarSuite({ workspace_id: WS })).estado).toBe("ok");
    const exclude = readFileSync(join(m.raiz, ".git", "info", "exclude"), "utf8");
    expect(exclude.startsWith("# meu\n*.log\n")).toBe(true);
    expect(exclude).toContain("/.expx/\n");
  });
  it("nada da suíte: nada a fazer, nenhum arquivo criado", async () => {
    const m = montar();
    escrever(m.raiz, "src/a.ts");
    expect(await m.pub.ignorarSuite({ workspace_id: WS })).toEqual({ estado: "nada", linhas: 0 });
  });
});

// ---- Atualizar / pull (D-693) -------------------------------------------------------------------------------------------------------

/** O remoto avança por um segundo clone local; `insteadOf` manda o `origin` (com cara de github.com) para o bare local: nenhuma rede. */
function montarComRemoto() {
  const m = montar();
  git(m.raiz, "config", `url.${m.bare}.insteadOf`, URL_GITHUB);
  const outro = join(m.pai, "outro");
  git(m.pai, "clone", "-q", m.bare, outro);
  git(outro, "config", "user.name", "Outro");
  git(outro, "config", "user.email", "outro@example.invalid");
  git(outro, "config", "commit.gpgsign", "false");
  const remotoCommita = (arquivo: string, conteudo = "remoto\n", msg = "feat: remoto"): void => {
    escrever(outro, arquivo, conteudo);
    git(outro, "add", arquivo);
    git(outro, "commit", "-q", "-m", msg);
    git(outro, "push", "-q", "origin", "main");
  };
  return { ...m, remotoCommita };
}
const buscar = (m: { pub: VcsPublicar }, forcar = false) => m.pub.buscarRemoto({ workspace_id: WS, forcar });

describe("buscar o remoto (fetch silencioso, throttle de 60 s)", () => {
  it("só com remoto github.com: sem origin nenhum fetch", async () => {
    const m = montar({ remoto: null });
    expect(await buscar(m)).toEqual({ buscou: false, atras: 0, erro: null });
  });
  it("busca, conta o que falta (↓N) e não repete antes de 60 s; o clique (forcar) ignora o intervalo", async () => {
    const m = montarComRemoto();
    expect((await estado(m)).atras).toBe(0);
    m.remotoCommita("a.txt");
    m.remotoCommita("b.txt", "b\n", "feat: b");
    expect(await buscar(m)).toEqual({ buscou: true, atras: 2, erro: null });
    expect((await estado(m)).atras).toBe(2);
    m.remotoCommita("c.txt", "c\n", "feat: c");
    expect(await buscar(m)).toMatchObject({ buscou: false, atras: 2 });
    m.relogio.avancar(61_000);
    expect(await buscar(m)).toMatchObject({ buscou: true, atras: 3 });
    m.remotoCommita("d.txt", "d\n", "feat: d");
    expect(await buscar(m, true)).toMatchObject({ buscou: true, atras: 4 });
  });
  it("falha de rede vira texto PT-BR sem caminho; nunca lança", async () => {
    const m = montarComRemoto();
    renameSync(m.bare, `${m.bare}-sumiu`);
    const r = await buscar(m, true);
    expect(r.buscou).toBe(false);
    expect(typeof r.erro).toBe("string");
    expect(r.erro).not.toContain(m.pai);
  });
});

describe("preparar e executar o pull (git pull --ff-only; D-36)", () => {
  it("preparo: commits, arquivos tocados (só nomes) e assuntos; sem upstream recusa", async () => {
    const m = montarComRemoto();
    m.remotoCommita("src/a.ts");
    m.remotoCommita("src/b.ts", "b\n", "feat: b");
    await buscar(m, true);
    const p = await m.pub.prepararAtualizar({ workspace_id: WS, sessao_foco: null });
    expect(p).toMatchObject({ branch: "main", upstream: "origin/main", repo: "dono/repo", commits: 2, a_frente: 0, arquivos_tocados: 2, divergiu: false, conflita: [], operacao_em_curso: false });
    expect(p.arquivos.sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(p.assuntos).toEqual(["feat: b", "feat: remoto"]);
    expect(JSON.stringify(p)).not.toContain(m.raiz);
    git(m.raiz, "switch", "-q", "-c", "sem-upstream");
    await expect(m.pub.prepararAtualizar({ workspace_id: WS, sessao_foco: null })).rejects.toThrow(/upstream/);
  });
  it("fast-forward: traz os commits, atualiza o estado (↓0) e audita só contagens", async () => {
    const m = montarComRemoto();
    m.remotoCommita("a.txt");
    m.remotoCommita("b.txt", "b\n", "feat: b");
    await buscar(m, true);
    expect(decidirBotoes({ tela: "terminais", fatos: await estado(m) }).atualizar).toMatchObject({ habilitado: true, badge: "↓2" });
    const r = await m.pub.atualizar({ workspace_id: WS });
    expect(r).toEqual({ estado: "ok", motivo: null, trouxe: 2, sugerir_commitar: false });
    expect(existsSync(join(m.raiz, "a.txt"))).toBe(true);
    const e = await estado(m);
    expect(e.atras).toBe(0);
    expect(decidirBotoes({ tela: "terminais", fatos: e }).atualizar).toMatchObject({ habilitado: false, badge: null, tooltip: "Já está atualizado" });
    const ev = m.banco.consultar<{ payload_json: string }>("SELECT payload_json FROM evento_dominio WHERE tipo = 'vcs.publicar'").map((x) => JSON.parse(x.payload_json));
    expect(ev).toEqual([expect.objectContaining({ acao: "atualizar", estado: "ok", trouxe: 2 })]);
    expect(JSON.stringify(ev)).not.toContain("a.txt");
  });
  it("já atualizado: não roda pull", async () => {
    const m = montarComRemoto();
    expect(await m.pub.atualizar({ workspace_id: WS })).toMatchObject({ estado: "ja_atualizado", trouxe: 0 });
  });
  it("árvore suja SEM conflito com o remoto: o pull avança e preserva o trabalho local", async () => {
    const m = montarComRemoto();
    m.remotoCommita("remoto.txt");
    await buscar(m, true);
    writeFileSync(join(m.raiz, "README.md"), "# local\n");
    expect(await m.pub.atualizar({ workspace_id: WS })).toMatchObject({ estado: "ok", trouxe: 1 });
    expect(readFileSync(join(m.raiz, "README.md"), "utf8")).toBe("# local\n");
  });
  it("árvore suja que CONFLITA com o remoto: recusa, mostra o motivo, sugere commitar e não mexe em nada", async () => {
    const m = montarComRemoto();
    m.remotoCommita("README.md", "# do remoto\n", "docs: remoto");
    await buscar(m, true);
    writeFileSync(join(m.raiz, "README.md"), "# local\n");
    const p = await m.pub.prepararAtualizar({ workspace_id: WS, sessao_foco: null });
    expect(p.conflita).toEqual(["README.md"]);
    const r = await m.pub.atualizar({ workspace_id: WS });
    expect(r).toMatchObject({ estado: "recusado", trouxe: 0, sugerir_commitar: true });
    expect(r.motivo).toMatch(/README\.md/);
    expect(r.motivo).toMatch(/commit|stash/);
    expect(readFileSync(join(m.raiz, "README.md"), "utf8")).toBe("# local\n");
    expect(git(m.raiz, "rev-parse", "HEAD")).not.toContain("remoto");
  });
  it("divergiu (commit local + commit remoto): nunca merge nem rebase; explica e a instrução de merge vai ao agente", async () => {
    const m = montarComRemoto();
    m.remotoCommita("remoto.txt");
    escrever(m.raiz, "local.txt");
    git(m.raiz, "add", "local.txt");
    git(m.raiz, "commit", "-q", "-m", "feat: local");
    await buscar(m, true);
    const antes = git(m.raiz, "rev-parse", "HEAD").trim();
    const p = await m.pub.prepararAtualizar({ workspace_id: WS, sessao_foco: null });
    expect(p).toMatchObject({ divergiu: true, a_frente: 1, commits: 1 });
    const r = await m.pub.atualizar({ workspace_id: WS });
    expect(r).toMatchObject({ estado: "divergiu", trouxe: 0 });
    expect(r.motivo).toMatch(/divergiu/);
    expect(git(m.raiz, "rev-parse", "HEAD").trim()).toBe(antes);
    const merge = await m.pub.pedirMerge({ workspace_id: WS, sessao_foco: null, cli: null, modo_painel: "auto" });
    expect(merge).toMatchObject({ estado: "entregue", entrega: "prompt_inicial" });
    const texto = readFileSync(join(m.raiz, merge.instrucao_rel ?? ""), "utf8");
    expect(texto).toContain("git merge --no-edit origin/main");
    expect(texto).toContain("NÃO use `rebase`");
    expect(texto).toContain("remoto.txt");
    expect(String(m.chamadas.abrir[0]?.["prompt_inicial"])).toContain("@direto");
    expect(texto).not.toContain(m.raiz);
  });
  it("merge/rebase em andamento recusa; sem GitHub recusa", async () => {
    const m = montar({ remoto: "git@gitlab.com:dono/repo.git" });
    expect(await m.pub.atualizar({ workspace_id: WS })).toMatchObject({ estado: "recusado" });
    await expect(m.pub.prepararAtualizar({ workspace_id: WS, sessao_foco: null })).rejects.toThrow(/GitHub/);
    expect(await m.pub.pedirMerge({ workspace_id: WS, sessao_foco: null, cli: null, modo_painel: "auto" })).toMatchObject({ estado: "falhou" });
  });
});
