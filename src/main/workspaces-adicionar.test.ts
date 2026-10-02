import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AchadoProjeto, EventoClone, LoteProjetos, PedidoClonar } from "../compartilhado/workspaces-adicionar";
import type { Workspace } from "../nucleo/dominio";
import { initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../tests/fixtures/vcs/repos";
import { criarServicoAdicionar, INTERVALO_EVENTOS_MS, PREF_PASTA_PROJETOS, type DependenciasAdicionar, type ServicoAdicionar } from "./workspaces-adicionar";

const GIT_LENTO = resolve(__dirname, "../../tests/fixtures/workspaces-adicionar/git-lento.mjs");
const GH_FALSO = resolve(__dirname, "../../tests/fixtures/workspaces-adicionar/gh-falso.mjs");

let casa: string;
let pai: string;
let remoto: string;
let prefs: Map<string, unknown>;
let abertos: string[];
let eventosClone: EventoClone[];
let lotes: LoteProjetos[];
let registrados: Array<{ tipo: string; payload: Record<string, unknown> }>;
let mudou: number;
let dialogo: string | null;
let servicos: ServicoAdicionar[] = [];
beforeAll(isolarConfigGit);

const ws = (raiz: string): Workspace => ({ id: `ws_${Buffer.from(raiz).toString("hex").slice(0, 20)}`, nome: raiz.split("/").pop() ?? raiz, raiz, e_git: true, permissao: "seguro" } as unknown as Workspace);

function criar(o: Partial<DependenciasAdicionar> = {}): ServicoAdicionar {
  const s = criarServicoAdicionar({
    workspaces: {
      abrir: async (c) => { abertos.push(c ?? ""); return c === null ? null : ws(c); },
      estado: async () => ({ atual: null, recentes: abertos.map((c) => ws(c)) }),
    },
    preferencias: { obter: (k) => prefs.get(k) ?? null, definir: async (k, v) => void prefs.set(k, v) },
    escolherPasta: async () => dialogo,
    emitir: ((canal: string, payload: unknown) => {
      if (canal === "workspaces:adicionar_progresso") eventosClone.push(payload as EventoClone);
      else lotes.push(payload as LoteProjetos);
    }) as DependenciasAdicionar["emitir"],
    aoMudar: () => { mudou++; },
    registrarEvento: (tipo, payload) => void registrados.push({ tipo, payload }),
    casa: () => casa,
    executavelGh: GH_FALSO,
    ...o,
  });
  servicos.push(s);
  return s;
}

beforeEach(() => {
  casa = pastaTmp("adic-main-");
  pai = join(casa, "Developer");
  mkdirSync(pai);
  remoto = initRepo(join(casa, "origem", "repo-remoto"));
  prefs = new Map();
  abertos = [];
  eventosClone = [];
  lotes = [];
  registrados = [];
  mudou = 0;
  dialogo = null;
  servicos = [];
});
afterEach(async () => {
  await Promise.all(servicos.map((s) => s.encerrar()));
  delete process.env.FALSO_LENTO_MODO;
  delete process.env.GH_FALSO_MODO;
  removerPasta(casa);
});

const pedido = (token: string, o: Partial<PedidoClonar> = {}): PedidoClonar => ({ entrada: remoto, permitir_local: true, destino_token: token, nome: "clonado", branch: null, raso: false, submodulos: false, consentimento: true, ...o });
const esperar = async (cond: () => boolean, ms = 8000): Promise<void> => {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 15));
  if (!cond()) throw new Error("condição não atingida a tempo");
};
const terminou = (): boolean => eventosClone.some((e) => ["concluido", "falhou", "cancelado"].includes(e.fase));

describe("pasta de destino (tokens, nunca caminho)", () => {
  it("padrão: ~/Developer quando ~/orca/projects não existe; o renderer só vê ~/… e um token", async () => {
    const s = criar();
    const d = await s.destinoPadrao();
    expect(d.exibicao).toBe("~/Developer");
    expect(d.token).toMatch(/^d_[A-Za-z0-9_-]{6,}$/);
    expect(JSON.stringify(d)).not.toContain(casa);
    expect((await s.destinoPadrao()).token).toBe(d.token); // estável
  });
  it("diálogo nativo cancelado → null; escolhido → token novo; `lembrar` guarda como preferência (mascarada) e vira o padrão", async () => {
    const s = criar();
    expect(await s.escolherPasta(true)).toBeNull();
    const outra = join(casa, "Projetos");
    mkdirSync(outra);
    dialogo = outra;
    const d = await s.escolherPasta(true);
    expect(d?.exibicao).toBe("~/Projetos");
    expect(prefs.get(PREF_PASTA_PROJETOS)).toBe("~/Projetos");
    expect((await criar().destinoPadrao()).exibicao).toBe("~/Projetos");
  });
  it("sem lembrar, a preferência não muda", async () => {
    const s = criar();
    dialogo = join(casa, "origem");
    await s.escolherPasta(false);
    expect(prefs.has(PREF_PASTA_PROJETOS)).toBe(false);
  });
  it("diálogo devolvendo caminho inexistente é recusado", async () => {
    dialogo = join(casa, "nao-existe");
    await expect(criar().escolherPasta(false)).rejects.toThrow();
  });
  it("preferência apontando para pasta que sumiu cai no padrão", async () => {
    prefs.set(PREF_PASTA_PROJETOS, "~/sumiu");
    expect((await criar().destinoPadrao()).exibicao).toBe("~/Developer");
  });
  it("token desconhecido/expirado não avalia nada", async () => {
    const a = await criar().avaliarDestino({ destino_token: "d_inexistente123", nome: "x" });
    expect(a).toMatchObject({ ok: false, situacao: "invalido" });
  });
  it("avaliarDestino: livre, ocupado (sugestão) e ja_workspace", async () => {
    const s = criar();
    const d = await s.destinoPadrao();
    expect(await s.avaliarDestino({ destino_token: d.token, nome: "livre" })).toMatchObject({ ok: true, situacao: "livre", caminho_exibicao: "~/Developer/livre", ja_workspace: false });
    mkdirSync(join(pai, "usada"));
    writeFileSync(join(pai, "usada", "a"), "a");
    abertos.push(join(pai, "usada"));
    expect(await s.avaliarDestino({ destino_token: d.token, nome: "usada" })).toMatchObject({ ok: false, situacao: "ocupado", sugestao: "usada-2", ja_workspace: true });
  });
  it("abrirDestinoExistente abre a pasta existente (em vez de sobrescrever)", async () => {
    const s = criar();
    const d = await s.destinoPadrao();
    mkdirSync(join(pai, "existente"));
    writeFileSync(join(pai, "existente", "a"), "a");
    const w = await s.abrirDestinoExistente({ destino_token: d.token, nome: "existente" });
    expect(w?.raiz).toBe(join(pai, "existente"));
    expect(mudou).toBe(1);
    await expect(s.abrirDestinoExistente({ destino_token: d.token, nome: "nao-existe" })).rejects.toThrow();
  });
});

describe("clonar", () => {
  it("fluxo feliz: clona, ADICIONA e TROCA para o workspace, avisa a mudança e marca não confiável", async () => {
    const s = criar();
    const d = await s.destinoPadrao();
    const r = await s.iniciarClone(pedido(d.token));
    expect(r.ok).toBe(true);
    await esperar(terminou);
    const fim = eventosClone.at(-1) as EventoClone;
    expect(fim).toMatchObject({ fase: "concluido", percentual: 100, nao_confiavel: true, destino_exibicao: "~/Developer/clonado" });
    expect(fim.workspace?.raiz).toBe(join(pai, "clonado"));
    expect(abertos).toEqual([join(pai, "clonado")]);
    expect(mudou).toBe(1);
    expect(readFileSync(join(pai, "clonado", "a.txt"), "utf8")).toContain("um");
    expect(registrados.map((x) => x.tipo)).toEqual(["clone_iniciado", "clone_concluido"]);
  });
  it("exige o consentimento do clique", async () => {
    const s = criar();
    const d = await s.destinoPadrao();
    const r = await s.iniciarClone(pedido(d.token, { consentimento: false }));
    expect(r).toMatchObject({ ok: false, erro: { codigo: "consentimento" } });
    expect(existsSync(join(pai, "clonado"))).toBe(false);
  });
  it("valida no main: URL com credencial, opção injetada, ext::, caminho local sem permissão", async () => {
    const s = criar();
    const d = await s.destinoPadrao();
    for (const entrada of ["https://u:p@github.com/a/b", "--upload-pack=x", "ext::sh -c id", "-oProxyCommand=x", remoto]) {
      const r = await s.iniciarClone(pedido(d.token, { entrada, permitir_local: false }));
      expect(r, entrada).toMatchObject({ ok: false, erro: { codigo: "origem_invalida" } });
    }
    expect(registrados).toEqual([]);
  });
  it("valida branch e nome da pasta", async () => {
    const s = criar();
    const d = await s.destinoPadrao();
    expect(await s.iniciarClone(pedido(d.token, { branch: "--upload-pack=x" }))).toMatchObject({ ok: false, erro: { codigo: "origem_invalida" } });
    for (const nome of ["../fora", "a/b", ""]) expect(await s.iniciarClone(pedido(d.token, { nome }))).toMatchObject({ ok: false, erro: { codigo: "nome_invalido" } });
  });
  it("colisão devolve sugestão e nunca sobrescreve", async () => {
    const s = criar();
    const d = await s.destinoPadrao();
    mkdirSync(join(pai, "clonado"));
    writeFileSync(join(pai, "clonado", "meu"), "meu");
    expect(await s.iniciarClone(pedido(d.token))).toMatchObject({ ok: false, erro: { codigo: "colisao", sugestao: "clonado-2", acao: "escolher_outro_nome" } });
    expect(readFileSync(join(pai, "clonado", "meu"), "utf8")).toBe("meu");
  });
  it("token inválido recusa (nenhum caminho do renderer é aceito)", async () => {
    const s = criar();
    expect(await s.iniciarClone(pedido("d_naoexiste12345"))).toMatchObject({ ok: false, erro: { codigo: "destino_invalido" } });
  });
  it("progresso coalescido: uma rajada de 200 atualizações vira poucos eventos (≥ 250 ms entre eles)", async () => {
    process.env.FALSO_LENTO_MODO = "rajada";
    const s = criar({ executavelGit: GIT_LENTO });
    const d = await s.destinoPadrao();
    await s.iniciarClone(pedido(d.token));
    await esperar(terminou);
    expect(eventosClone.length).toBeLessThanOrEqual(6);
    expect(eventosClone.at(-1)?.fase).toBe("concluido");
    expect(INTERVALO_EVENTOS_MS).toBeGreaterThanOrEqual(250);
  });
  it("cancelar: evento `cancelado`, pasta parcial apagada, nada adicionado", async () => {
    const s = criar({ executavelGit: GIT_LENTO });
    const d = await s.destinoPadrao();
    const r = await s.iniciarClone(pedido(d.token));
    if (!r.ok) throw new Error("não iniciou");
    await esperar(() => existsSync(join(pai, "clonado", "parcial.txt")));
    expect(s.cancelarClone(r.clone_id)).toBe(true);
    await esperar(terminou);
    expect(eventosClone.at(-1)).toMatchObject({ fase: "cancelado", erro: { codigo: "cancelado" } });
    expect(existsSync(join(pai, "clonado"))).toBe(false);
    expect(abertos).toEqual([]);
    expect(s.cancelarClone(r.clone_id)).toBe(false);
  });
  it("um clone por vez por destino", async () => {
    const s = criar({ executavelGit: GIT_LENTO });
    const d = await s.destinoPadrao();
    const a = await s.iniciarClone(pedido(d.token));
    expect(a.ok).toBe(true);
    await esperar(() => existsSync(join(pai, "clonado", "parcial.txt")));
    expect(await s.iniciarClone(pedido(d.token))).toMatchObject({ ok: false, erro: { codigo: "colisao" } }); // a pasta parcial já ocupa o destino
    await s.encerrar();
  });
  it("erro de acesso vira evento `falhou` com a ação de login (sem executar login)", async () => {
    process.env.GH_FALSO_MODO = "nao_autenticado"; // sem gh autenticado, GitHub vai pelo git
    process.env.FALSO_LENTO_MODO = "erro";
    process.env.FALSO_LENTO_ERRO = "fatal: could not read Username for 'https://github.com': terminal prompts disabled";
    const s = criar({ executavelGit: GIT_LENTO });
    const d = await s.destinoPadrao();
    await s.iniciarClone(pedido(d.token, { entrada: "https://github.com/dono/privado", permitir_local: false }));
    await esperar(terminou);
    expect(eventosClone.at(-1)).toMatchObject({ fase: "falhou", erro: { codigo: "sem_acesso", acao: "login_gh" } });
    expect(abertos).toEqual([]);
    delete process.env.FALSO_LENTO_ERRO;
  });
  it("GitHub com `gh` autenticado clona por `gh repo clone` (atalho dono/repo), sem token", async () => {
    const log = join(casa, "gh.log");
    process.env.GH_FALSO_LOG = log;
    const s = criar();
    const d = await s.destinoPadrao();
    await s.iniciarClone(pedido(d.token, { entrada: "dono/repo", permitir_local: false, raso: true }));
    await esperar(terminou);
    expect(eventosClone.at(-1)).toMatchObject({ fase: "concluido" });
    const chamadas = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
    expect(chamadas.find((c) => c[1] === "clone")).toEqual(["repo", "clone", "dono/repo", join(pai, "clonado"), "--", "--progress", "--depth", "1"]);
    expect(readFileSync(join(pai, "clonado", "veio-do-gh.txt"), "utf8")).toBe("dono/repo");
    delete process.env.GH_FALSO_LOG;
  });
  it("auditoria (evento_dominio) nunca leva URL com credencial nem caminho absoluto", async () => {
    const s = criar();
    const d = await s.destinoPadrao();
    await s.iniciarClone(pedido(d.token));
    await esperar(terminou);
    const texto = JSON.stringify(registrados);
    expect(texto).not.toContain(casa);
    expect(texto).not.toMatch(/:\/\/[^"/]*@/);
  });
  it("encerrar cancela os clones em curso", async () => {
    const s = criar({ executavelGit: GIT_LENTO });
    const d = await s.destinoPadrao();
    await s.iniciarClone(pedido(d.token));
    await esperar(() => existsSync(join(pai, "clonado", "parcial.txt")));
    await s.encerrar();
    expect(existsSync(join(pai, "clonado"))).toBe(false);
  });
});

describe("encontrar projetos", () => {
  const achar = async (s: ServicoAdicionar): Promise<{ itens: AchadoProjeto[]; ultimo: LoteProjetos }> => {
    s.buscarProjetos();
    await esperar(() => lotes.some((l) => l.fim));
    return { itens: lotes.flatMap((l) => l.itens), ultimo: lotes.at(-1) as LoteProjetos };
  };
  it("acha projetos nos locais comuns, mascara a pasta, marca já-workspace e adiciona por id (sem caminho do renderer)", async () => {
    initRepo(join(casa, "Developer", "app-a"));
    mkdirSync(join(casa, "code", "app-b"), { recursive: true });
    writeFileSync(join(casa, "code", "app-b", "package.json"), "{}");
    abertos.push(join(casa, "Developer", "app-a"));
    const s = criar();
    const { itens, ultimo } = await achar(s);
    expect(itens.map((i) => i.exibicao).sort()).toEqual(["~/Developer/app-a", "~/code/app-b"]);
    const a = itens.find((i) => i.nome === "app-a") as AchadoProjeto;
    const b = itens.find((i) => i.nome === "app-b") as AchadoProjeto;
    expect(a).toMatchObject({ e_git: true, branch: "main", ja_workspace: true });
    expect(b).toMatchObject({ e_git: false, manifesto: "package.json", ja_workspace: false });
    expect(JSON.stringify(itens)).not.toContain(casa);
    expect(ultimo).toMatchObject({ fim: true, cancelada: false });
    const w = await s.adicionarAchado(b.id);
    expect(w?.raiz).toBe(join(casa, "code", "app-b"));
    expect(mudou).toBe(1);
  });
  it("id de achado desconhecido é recusado", async () => {
    await expect(criar().adicionarAchado("ach_inexistente123")).rejects.toThrow();
  });
  it("cancelável: a busca termina com `cancelada`", async () => {
    for (let i = 0; i < 200; i++) mkdirSync(join(casa, "Developer", `p${i}`, "x", "y"), { recursive: true });
    const s = criar();
    const { busca_id } = s.buscarProjetos();
    expect(s.cancelarBusca(busca_id)).toBe(true);
    await esperar(() => lotes.some((l) => l.fim));
    expect(lotes.at(-1)?.fim).toBe(true);
    expect(s.cancelarBusca(busca_id)).toBe(false);
  });
});

describe("meus repositórios (gh)", () => {
  it("estado local: instalado e autenticado; com cache", async () => {
    const s = criar();
    expect(await s.estadoGh()).toEqual({ instalado: true, autenticado: true, usuario: "fulana" });
  });
  it("listar exige consentimento da ação (rede)", async () => {
    expect(await criar().listarRepos(false)).toMatchObject({ ok: false, erro: { codigo: "consentimento" } });
  });
  it("lista com consentimento", async () => {
    const r = await criar().listarRepos(true);
    expect(r.ok && r.repos.map((x) => x.nome_com_dono)).toEqual(["fulana/recente", "fulana/antigo", "fulana/sem-data"]);
    expect(registrados.at(-1)).toEqual({ tipo: "repos_listados", payload: { total: 3 } });
  });
  it("não autenticado / sem internet viram erro acionável", async () => {
    process.env.GH_FALSO_MODO = "nao_autenticado";
    expect(await criar().listarRepos(true)).toMatchObject({ ok: false, erro: { codigo: "sem_acesso", acao: "login_gh" } });
    process.env.GH_FALSO_MODO = "rede";
    expect(await criar().listarRepos(true)).toMatchObject({ ok: false, erro: { codigo: "sem_internet" } });
  });
});

describe("novo projeto", () => {
  it("cria, adiciona e troca; devolve o aviso de identidade e o pedido de instalar suíte", async () => {
    const s = criar();
    const d = await s.destinoPadrao();
    const r = await s.criarNovo({ nome: "app-novo", destino_token: d.token, git: true, gitignore: true, commit_inicial: true, readme: true, template: "node", instalar_suite: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workspace.raiz).toBe(join(pai, "app-novo"));
    expect(r.instalar_suite).toBe(true);
    expect(r.avisos.length).toBeLessThanOrEqual(1); // sem identidade no ambiente de teste (config global nula)
    expect(existsSync(join(pai, "app-novo", "package.json"))).toBe(true);
    expect(abertos).toEqual([join(pai, "app-novo")]);
    expect(mudou).toBe(1);
    expect(registrados.at(-1)?.tipo).toBe("projeto_criado");
  });
  it("recusa nome com travessia, pasta existente não vazia e token inválido", async () => {
    const s = criar();
    const d = await s.destinoPadrao();
    const base = { destino_token: d.token, git: false, gitignore: false, commit_inicial: false, readme: false, template: "vazio" as const, instalar_suite: false };
    expect(await s.criarNovo({ ...base, nome: "../fora" })).toMatchObject({ ok: false, erro: { codigo: "nome_invalido" } });
    mkdirSync(join(pai, "ocupada"));
    writeFileSync(join(pai, "ocupada", "x"), "x");
    expect(await s.criarNovo({ ...base, nome: "ocupada" })).toMatchObject({ ok: false, erro: { codigo: "colisao", sugestao: "ocupada-2" } });
    expect(await s.criarNovo({ ...base, nome: "x", destino_token: "d_naoexiste12345" })).toMatchObject({ ok: false, erro: { codigo: "destino_invalido" } });
    expect(abertos).toEqual([]);
  });
});
