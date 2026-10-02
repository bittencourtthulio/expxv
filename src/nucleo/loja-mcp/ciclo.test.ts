import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarBloqueio } from "./bloqueio";
import { criarCicloLoja, type CicloLoja, type DepsCiclo } from "./ciclo";
import type { CatalogoCarregado } from "./catalogo";
import { criarRepoMemoria, type RepoLojaMcp } from "./repositorio";
import { criarSegredosMcp, nomeCofre } from "./segredos";
import { configuracaoDeMcpLoja } from "./injecao";
import { catalogoFalso, cofreDeTeste, entradaNpmFalsa, executorNpmFalso, limparPastas, novaPasta, type ExecutorFalso } from "../../../tests/fixtures/mcp-loja/apoio-ciclo";
import { derrubarTodos } from "../../../tests/fixtures/mcp-loja/servidores";

afterEach(async () => { limparPastas(); await derrubarTodos(); });

const DIAG = { npm: { ok: true, versao: "10.0.0" }, node: { ok: true, versao: "v22.0.0" }, cofre: { disponivel: true } };
const SEGREDO_OK = "chave-valida";
const SEGREDO_RUIM = "SENTINELA-chave-errada-3b9e-nunca-vazar";

interface Montagem {
  ciclo: CicloLoja; repo: RepoLojaMcp; ex: ExecutorFalso; ud: string; eventos: Array<[string, Record<string, unknown>]>;
  cofreDir: string; deps: DepsCiclo; cat: CatalogoCarregado;
}
function montar(opcoes: { cat?: CatalogoCarregado; repo?: RepoLojaMcp; ud?: string; cofreDir?: string; ex?: ExecutorFalso; deps?: Partial<DepsCiclo> } = {}): Montagem {
  const ud = opcoes.ud ?? novaPasta();
  const cofreDir = opcoes.cofreDir ?? novaPasta("cofre-");
  const repo = opcoes.repo ?? criarRepoMemoria();
  const ex = opcoes.ex ?? executorNpmFalso();
  const cat = opcoes.cat ?? catalogoFalso();
  const eventos: Montagem["eventos"] = [];
  let u = 0;
  const deps: DepsCiclo = {
    repo, catalogo: cat, segredos: criarSegredosMcp(cofreDeTeste(cofreDir)), executor: ex, userData: ud, diagnostico: async () => DIAG,
    instalacao: { binarios: { npm: "/falso/npm", node: process.execPath } }, node: process.execPath, plataforma: process.platform,
    evento: (n, p) => eventos.push([n, p]), timeoutSaudeMs: 2500, ulid: () => `u${++u}`, ...opcoes.deps,
  };
  return { ciclo: criarCicloLoja(deps), repo, ex, ud, eventos, cofreDir, deps, cat };
}
async function instalar(m: Montagem, id: string): Promise<void> {
  const p = await m.ciclo.planoInstalacao(id);
  if (!p.ok) throw new Error(`plano recusado: ${p.bloqueio.codigo}`);
  expect(await m.ciclo.instalar(id, { aceito: true, comando_hash: p.plano.comando_hash })).toEqual({ ok: true });
}
const processosFalsos = (): string => { try { return execFileSync("ps", ["-axo", "command="], { encoding: "utf8" }); } catch { return ""; } };

describe("fluxo de um clique: plano → consentimento → instalar → testar → habilitar → Pane", () => {
  it("caminho feliz com servidor MCP falso real", async () => {
    const m = montar();
    const p = await m.ciclo.planoInstalacao("falso-ok");
    if (!p.ok) throw new Error("plano");
    expect(m.ex.chamadas).toHaveLength(0); // planejar não executa nada
    expect(await m.ciclo.instalar("falso-ok", { aceito: true, comando_hash: p.plano.comando_hash })).toEqual({ ok: true });
    const reg = m.repo.obterInstalado("falso-ok")!;
    expect(reg).toMatchObject({ estado: "instalado", versao: "1.0.0", metodo: "npm", nivel_verificacao: "padrao", pasta_rel: "mcp/falso-ok", comando_hash: p.plano.comando_hash, seed_versao: "teste.1", erro_codigo: null });
    const cons = m.repo.consentimentosDe("falso-ok");
    expect(cons).toHaveLength(1);
    expect(cons[0]).toMatchObject({ origem: "loja", comando_hash: p.plano.comando_hash, versao: "1.0.0" });
    expect(JSON.parse(cons[0]!.permissoes_json)).toMatchObject({ pasta: join(m.ud, "mcp", "falso-ok"), nivel: "padrao" });
    expect(m.eventos.map(([n]) => n)).toEqual(["mcp_store.install_started", "mcp_store.consent_recorded", "mcp_store.install_finished"]);

    const t = await m.ciclo.testar("falso-ok");
    expect(t).toMatchObject({ estado: "ok", n_ferramentas: 3, erro: null });
    expect(t.latencia_ms).toBeLessThan(3000);
    expect(m.repo.ferramentasDe("falso-ok").map((f) => f.nome)).toEqual(["eco", "soma", "hora_falsa"]);
    expect(m.repo.obterSaude("falso-ok")).toMatchObject({ estado: "ok", n_ferramentas: 3 });

    expect(await m.ciclo.habilitar("falso-ok", "workspace", "w1", true)).toEqual({ ok: true });
    const { politica, servidores } = await m.ciclo.servidoresDoPane({ workspace: "w1" });
    expect(politica.servidores).toEqual(["falso-ok"]);
    const cfg = configuracaoDeMcpLoja("claude", servidores, { userData: m.ud, plataforma: process.platform, node: process.execPath, lancador: { script: "/x/mcp-run.mjs", variavelUrl: "U", variavelToken: "T" } }, "/p/mcp.json")!;
    expect(cfg.servidores).toEqual(["falso-ok"]);
    expect(m.eventos.map(([n]) => n)).toContain("mcp_store.enabled");
    expect(processosFalsos()).not.toContain("falso-ok/node_modules"); // nenhum servidor ficou vivo
  });

  it("consentimento inválido (não aceito, hash velho) não executa nada nem grava nada", async () => {
    const m = montar();
    const p = await m.ciclo.planoInstalacao("falso-ok");
    if (!p.ok) throw new Error("plano");
    expect(await m.ciclo.instalar("falso-ok", { aceito: false, comando_hash: p.plano.comando_hash })).toMatchObject({ ok: false, codigo: "consentimento_invalido" });
    expect(await m.ciclo.instalar("falso-ok", { aceito: true, comando_hash: "0".repeat(64) })).toMatchObject({ ok: false, codigo: "consentimento_invalido" });
    expect(await m.ciclo.instalar("falso-ok", { aceito: "sim" as unknown as boolean, comando_hash: p.plano.comando_hash })).toMatchObject({ ok: false, codigo: "consentimento_invalido" });
    expect(m.ex.chamadas).toHaveLength(0);
    expect(m.repo.obterInstalado("falso-ok")).toBeNull();
    expect(existsSync(join(m.ud, "mcp", "falso-ok"))).toBe(false);
  });

  it("entrada desconhecida, não confirmada ou bloqueada nunca instala", async () => {
    const m = montar();
    expect(await m.ciclo.instalar("nao-existe", { aceito: true, comando_hash: "x" })).toMatchObject({ ok: false, codigo: "catalogo_desconhecido" });
    const naoConf = entradaNpmFalsa("falso-nc", "@falso/ok", { confirmado: false });
    naoConf.instalacao = { ...naoConf.instalacao, versao: null, integridade: null };
    const m2 = montar({ cat: catalogoFalso([naoConf]) });
    expect(await m2.ciclo.instalar("falso-nc", { aceito: true, comando_hash: "x" })).toMatchObject({ ok: false, codigo: "plano_recusado", detalhe: "nao_confirmado" });
    const m3 = montar({ deps: { bloqueio: criarBloqueio({ schema_version: 1, regras: [{ id: "falso-ok", motivo: "comprometido", desde: "2026-10-01" }] }) } });
    expect(await m3.ciclo.instalar("falso-ok", { aceito: true, comando_hash: "x" })).toMatchObject({ ok: false, codigo: "plano_recusado", detalhe: "bloqueado" });
    expect([m, m2, m3].every((x) => x.ex.chamadas.length === 0)).toBe(true);
  });

  it("pré-requisito ausente (sem npm): plano recusa com instrução e nada executa", async () => {
    const m = montar({ deps: { diagnostico: async () => ({ cofre: { disponivel: true } }) } });
    const p = await m.ciclo.planoInstalacao("falso-ok");
    expect(p).toMatchObject({ ok: false, bloqueio: { codigo: "prerequisito_ausente" } });
    expect(await m.ciclo.instalar("falso-ok", { aceito: true, comando_hash: "x" })).toMatchObject({ ok: false, codigo: "plano_recusado" });
    expect(m.ex.chamadas).toHaveLength(0);
  });

  it("falha na instalação: estado 'falhou' com código nominal, evento, log; tentar de novo funciona; já instalado recusa", async () => {
    const m = montar();
    const p = await m.ciclo.planoInstalacao("falso-ok");
    if (!p.ok) throw new Error("plano");
    m.ex.proximo.push({ codigo: 1 });
    expect(await m.ciclo.instalar("falso-ok", { aceito: true, comando_hash: p.plano.comando_hash })).toMatchObject({ ok: false, codigo: "falha_instalacao" });
    expect(m.repo.obterInstalado("falso-ok")).toMatchObject({ estado: "falhou", erro_codigo: "falha_instalacao" });
    expect(m.repo.logsDe("falso-ok").map((l) => l.evento)).toContain("instalacao_falhou");
    expect(m.eventos.map(([n]) => n)).toContain("mcp_store.install_failed");
    expect(existsSync(join(m.ud, "mcp", "falso-ok"))).toBe(false);
    expect(await m.ciclo.instalar("falso-ok", { aceito: true, comando_hash: p.plano.comando_hash })).toEqual({ ok: true });
    expect(m.repo.obterInstalado("falso-ok")!.estado).toBe("instalado");
    expect(await m.ciclo.instalar("falso-ok", { aceito: true, comando_hash: p.plano.comando_hash })).toMatchObject({ ok: false, codigo: "ja_instalado" });
  });

  it("integridade divergente: nada fica instalado e o código é nominal", async () => {
    const m = montar();
    m.ex.integridadeGravada = "sha512-" + "B".repeat(86) + "==";
    const p = await m.ciclo.planoInstalacao("falso-ok");
    if (!p.ok) throw new Error("plano");
    expect(await m.ciclo.instalar("falso-ok", { aceito: true, comando_hash: p.plano.comando_hash })).toMatchObject({ ok: false, codigo: "integridade_divergente" });
    expect(existsSync(join(m.ud, "mcp", "falso-ok"))).toBe(false);
  });

  it("nada acontece sozinho: criar o ciclo, planejar, consultar política e saúde passiva não executam nem testam nada", async () => {
    let buscas = 0;
    const m = montar({ deps: { fetch: (async () => { buscas++; return new Response("{}"); }) as typeof fetch } });
    await m.ciclo.planoInstalacao("falso-ok");
    await m.ciclo.servidoresDoPane({ workspace: "w" });
    await m.ciclo.saudePassiva();
    m.ciclo.aplicarBloqueio();
    expect(m.ex.chamadas).toHaveLength(0);
    expect(buscas).toBe(0);
    expect(m.eventos).toEqual([]);
  });
});

describe("variáveis, segredos e saúde", () => {
  async function comChave(): Promise<Montagem> {
    const m = montar();
    await instalar(m, "falso-chave");
    return m;
  }

  it("sem a variável obrigatória: testar → nao_configurado e habilitar recusa", async () => {
    const m = await comChave();
    expect(await m.ciclo.variaveisEstado("falso-chave")).toEqual([{ nome: "FALSO_API_KEY", obrigatoria: true, secreta: true, definida: false }]);
    expect(await m.ciclo.testar("falso-chave")).toMatchObject({ estado: "indisponivel", erro: "nao_configurado", variaveis_faltando: ["FALSO_API_KEY"] });
    expect(await m.ciclo.habilitar("falso-chave", "workspace", "w1", true)).toMatchObject({ ok: false, codigo: "nao_configurado" });
    expect(m.repo.listarHabilitacoes()).toEqual([]);
  });

  it("chave errada → nao_autorizado SEM eco do valor; chave certa → ok; habilitar libera; apagar tira da política na hora", async () => {
    const m = await comChave();
    expect(await m.ciclo.gravarVariavel("falso-chave", "FALSO_API_KEY", SEGREDO_RUIM)).toEqual({ ok: true, codigo: null });
    const ruim = await m.ciclo.testar("falso-chave");
    expect(ruim).toMatchObject({ estado: "indisponivel" });
    expect(JSON.stringify(ruim)).not.toContain(SEGREDO_RUIM);
    expect(m.repo.obterSaude("falso-chave")).toMatchObject({ estado: "indisponivel" });

    await m.ciclo.gravarVariavel("falso-chave", "FALSO_API_KEY", SEGREDO_OK);
    expect(await m.ciclo.testar("falso-chave")).toMatchObject({ estado: "ok", erro: null });
    expect(await m.ciclo.habilitar("falso-chave", "workspace", "w1", true)).toEqual({ ok: true });
    expect((await m.ciclo.servidoresDoPane({ workspace: "w1" })).politica.servidores).toEqual(["falso-chave"]);
    await m.ciclo.apagarVariavel("falso-chave", "FALSO_API_KEY");
    const depois = await m.ciclo.servidoresDoPane({ workspace: "w1" });
    expect(depois.politica.servidores).toEqual([]);
    expect(depois.politica.excluidos).toEqual([{ id: "falso-chave", motivo: "nao_configurado" }]);
  });

  it("o valor do segredo nunca aparece no repositório, nos logs, nos eventos, no plano nem nos resultados", async () => {
    const m = await comChave();
    await m.ciclo.gravarVariavel("falso-chave", "FALSO_API_KEY", SEGREDO_RUIM);
    const resultados = [await m.ciclo.testar("falso-chave"), await m.ciclo.planoInstalacao("falso-chave"), await m.ciclo.variaveisEstado("falso-chave")];
    await m.ciclo.habilitar("falso-chave", "workspace", "w1", true);
    const { servidores } = await m.ciclo.servidoresDoPane({ workspace: "w1" });
    const cfg = ["claude", "codex", "opencode"].map((cli) => configuracaoDeMcpLoja(cli, servidores, { userData: m.ud, node: process.execPath, lancador: { script: "/x/mcp-run.mjs", variavelUrl: "U", variavelToken: "T" } }, "/p/mcp.json"));
    const tudo = JSON.stringify([
      m.repo.listarInstalados(), m.repo.consentimentosDe("falso-chave"), m.repo.variaveisDe("falso-chave"), m.repo.listarHabilitacoes(), m.repo.obterSaude("falso-chave"),
      m.repo.ferramentasDe("falso-chave"), m.repo.logsDe("falso-chave", 500), m.eventos, resultados, cfg,
    ]);
    expect(tudo).not.toContain(SEGREDO_RUIM);
    expect(m.repo.variaveisDe("falso-chave")).toEqual([{ servidor_id: "falso-chave", nome: "FALSO_API_KEY", definida: true, atualizada_em: expect.any(String) }]);
  });

  it("valor inválido e variável desconhecida são recusados com código nominal", async () => {
    const m = await comChave();
    expect(await m.ciclo.gravarVariavel("falso-chave", "FALSO_API_KEY", "a\nb")).toEqual({ ok: false, codigo: "quebra_de_linha" });
    expect(await m.ciclo.gravarVariavel("falso-chave", "OUTRA", "x")).toEqual({ ok: false, codigo: "variavel_desconhecida" });
    expect(await m.ciclo.gravarVariavel("fantasma", "X", "x")).toMatchObject({ ok: false, codigo: "catalogo_desconhecido" });
  });

  it("servidor lento estoura o timeout, vira indisponível e o processo morre", async () => {
    const m = montar({ deps: { timeoutSaudeMs: 600 } });
    await instalar(m, "falso-lento");
    const t0 = Date.now();
    const t = await m.ciclo.testar("falso-lento");
    expect(t).toMatchObject({ estado: "indisponivel", erro: "timeout" });
    expect(Date.now() - t0).toBeLessThan(2500);
    await new Promise((r) => setTimeout(r, 300));
    expect(processosFalsos()).not.toMatch(/falso-lento\/node_modules/);
  });

  it("servidor que cai ou vem vazio: indisponível com erro nominal", async () => {
    const m = montar();
    await instalar(m, "falso-crash"); await instalar(m, "falso-vazio");
    expect((await m.ciclo.testar("falso-crash")).estado).toBe("indisponivel");
    expect(await m.ciclo.testar("falso-vazio")).toMatchObject({ estado: "indisponivel", erro: "sem_ferramentas" });
  });

  it("o servidor de teste só enxerga a allowlist + variáveis declaradas (eco-ambiente)", async () => {
    const m = montar();
    process.env["ANTHROPIC_API_KEY"] = "nao-pode-vazar";
    try {
      await instalar(m, "falso-eco");
      const t = await m.ciclo.testar("falso-eco");
      expect(t.estado).toBe("ok");
      expect(JSON.stringify(m.repo.logsDe("falso-eco", 50))).not.toContain("nao-pode-vazar");
    } finally { delete process.env["ANTHROPIC_API_KEY"]; }
  });

  it("não testa servidor que não está instalado", async () => {
    const m = montar();
    expect(await m.ciclo.testar("falso-ok")).toMatchObject({ estado: "indisponivel", erro: "nao_instalado" });
    expect(m.ex.chamadas).toHaveLength(0);
  });
});

describe("habilitação", () => {
  it("só habilita instalado, configurado e não bloqueado; desabilitar é sempre permitido; alvo é validado", async () => {
    const m = montar();
    expect(await m.ciclo.habilitar("falso-ok", "workspace", "w1", true)).toMatchObject({ ok: false, codigo: "nao_instalado" });
    expect(await m.ciclo.habilitar("fantasma", "workspace", "w1", true)).toMatchObject({ ok: false, codigo: "catalogo_desconhecido" });
    await instalar(m, "falso-ok");
    expect(await m.ciclo.habilitar("falso-ok", "workspace", "", true)).toMatchObject({ ok: false, codigo: "alvo_invalido" });
    expect(await m.ciclo.habilitar("falso-ok", "mundo" as never, "x", true)).toMatchObject({ ok: false, codigo: "alvo_invalido" });
    expect(await m.ciclo.habilitar("falso-ok", "workspace", "w1", true)).toEqual({ ok: true });
    expect(await m.ciclo.habilitar("falso-ok", "workspace", "w1", false)).toEqual({ ok: true });
    expect(m.eventos.map(([n]) => n).filter((n) => n.includes("abled"))).toEqual(["mcp_store.enabled", "mcp_store.disabled"]);
    expect(m.ciclo.habilitacoes("w1")[0]).toMatchObject({ habilitado: false, isolamento: { claude: "duro", codex: "parcial", opencode: "parcial", gemini: "nenhum" } });
  });

  it("bloqueado depois de instalado: desabilita em todo alvo e deixa de entrar no Pane", async () => {
    const m = montar();
    await instalar(m, "falso-ok");
    await m.ciclo.habilitar("falso-ok", "workspace", "w1", true);
    await m.ciclo.habilitar("falso-ok", "agente", "a1", true);
    const bloqueado = montar({ repo: m.repo, ud: m.ud, cofreDir: m.cofreDir, deps: { bloqueio: criarBloqueio({ schema_version: 1, regras: [{ id: "falso-ok", motivo: "comprometido", desde: "2026-10-01" }] }) } });
    expect(bloqueado.ciclo.aplicarBloqueio()).toEqual(["falso-ok"]);
    expect(m.repo.listarHabilitacoes({ servidor_id: "falso-ok" }).every((h) => !h.habilitado)).toBe(true);
    expect((await bloqueado.ciclo.servidoresDoPane({ workspace: "w1" })).politica.servidores).toEqual([]);
    expect(await bloqueado.ciclo.habilitar("falso-ok", "workspace", "w1", true)).toMatchObject({ ok: false, codigo: "bloqueado" });
    expect(m.repo.logsDe("falso-ok").map((l) => l.evento)).toContain("bloqueado_desabilitado");
  });

  it("Missão squad sem allow-list: nenhum servidor da Loja (deny-by-default)", async () => {
    const m = montar();
    await instalar(m, "falso-ok");
    await m.ciclo.habilitar("falso-ok", "workspace", "w1", true);
    expect((await m.ciclo.servidoresDoPane({ workspace: "w1", missao: "m1", modo: "squad" })).servidores).toEqual([]);
    await m.ciclo.habilitar("falso-ok", "missao", "m1", true);
    expect((await m.ciclo.servidoresDoPane({ workspace: "w1", missao: "m1", modo: "squad" })).servidores).toHaveLength(1);
  });
});

describe("atualizar (nunca automático, com diff e restauração)", () => {
  const v2 = (): CatalogoCarregado => { const e = entradaNpmFalsa("falso-ok", "@falso/ok"); e.instalacao.versao = "1.1.0"; e.variaveis = [{ nome: "FALSO_NOVA", obrigatoria: false, secreta: false, ajuda: "nova", onde_conseguir: null }]; e.riscos = ["rede_saida", "escrita_remota"]; return catalogoFalso([e], "teste.2"); };

  it("sem mudança no seed não há atualização", async () => {
    const m = montar();
    await instalar(m, "falso-ok");
    expect(await m.ciclo.planoAtualizacao("falso-ok")).toMatchObject({ disponivel: false });
    expect(await m.ciclo.atualizar("falso-ok", { aceito: true, comando_hash: "x" })).toMatchObject({ ok: false, codigo: "sem_atualizacao" });
  });

  it("seed novo: o diff mostra versão, variáveis e riscos; sem consentimento do hash novo nada roda; com ele troca e apaga a antiga", async () => {
    const m = montar();
    await instalar(m, "falso-ok");
    writeFileSync(join(m.ud, "mcp", "falso-ok", "VERSAO-ANTIGA"), "1");
    const n = montar({ cat: v2(), repo: m.repo, ud: m.ud, cofreDir: m.cofreDir });
    const diff = (await n.ciclo.planoAtualizacao("falso-ok"))!;
    expect(diff).toMatchObject({ disponivel: true, versao_de: "1.0.0", versao_para: "1.1.0" });
    expect(diff.variaveis.adicionadas).toEqual(["FALSO_NOVA"]);
    expect(diff.riscos.adicionados).toEqual(["escrita_remota"]);
    expect(diff.comando.antes).not.toBeNull();
    const chamadasAntes = n.ex.chamadas.length;
    expect(await n.ciclo.atualizar("falso-ok", { aceito: true, comando_hash: m.repo.obterInstalado("falso-ok")!.comando_hash })).toMatchObject({ ok: false, codigo: "consentimento_invalido" });
    expect(await n.ciclo.atualizar("falso-ok", { aceito: false, comando_hash: diff.comando_hash })).toMatchObject({ ok: false, codigo: "consentimento_invalido" });
    expect(n.ex.chamadas.length).toBe(chamadasAntes);
    expect(await n.ciclo.atualizar("falso-ok", { aceito: true, comando_hash: diff.comando_hash })).toEqual({ ok: true });
    expect(m.repo.obterInstalado("falso-ok")).toMatchObject({ versao: "1.1.0", seed_versao: "teste.2", comando_hash: diff.comando_hash });
    expect(existsSync(join(m.ud, "mcp", "falso-ok", "VERSAO-ANTIGA"))).toBe(false);
    expect(readdirSync(join(m.ud, "mcp", ".old"))).toEqual([]);
    expect(m.repo.consentimentosDe("falso-ok").map((c) => c.origem)).toEqual(["loja", "atualizacao"]);
    expect((await n.ciclo.planoAtualizacao("falso-ok"))!.disponivel).toBe(false);
  });

  it("atualização que quebra a saúde RESTAURA a versão anterior e o registro antigo", async () => {
    const m = montar();
    await instalar(m, "falso-ok");
    writeFileSync(join(m.ud, "mcp", "falso-ok", "VERSAO-ANTIGA"), "1");
    const ruim = entradaNpmFalsa("falso-ok", "@falso/crash"); ruim.instalacao.versao = "2.0.0";
    const n = montar({ cat: catalogoFalso([ruim], "teste.3"), repo: m.repo, ud: m.ud, cofreDir: m.cofreDir });
    const diff = (await n.ciclo.planoAtualizacao("falso-ok"))!;
    const antes = m.repo.obterInstalado("falso-ok")!;
    expect(await n.ciclo.atualizar("falso-ok", { aceito: true, comando_hash: diff.comando_hash })).toMatchObject({ ok: false, codigo: "saude_falhou_restaurado" });
    expect(existsSync(join(m.ud, "mcp", "falso-ok", "VERSAO-ANTIGA"))).toBe(true);
    expect(m.repo.obterInstalado("falso-ok")).toEqual(antes);
    expect(m.repo.logsDe("falso-ok").map((l) => l.evento)).toContain("atualizacao_revertida");
  });

  it("falha do instalador na atualização deixa a versão anterior intacta", async () => {
    const m = montar();
    await instalar(m, "falso-ok");
    writeFileSync(join(m.ud, "mcp", "falso-ok", "VERSAO-ANTIGA"), "1");
    const n = montar({ cat: v2(), repo: m.repo, ud: m.ud, cofreDir: m.cofreDir });
    const diff = (await n.ciclo.planoAtualizacao("falso-ok"))!;
    n.ex.proximo.push({ codigo: 1 });
    expect(await n.ciclo.atualizar("falso-ok", { aceito: true, comando_hash: diff.comando_hash })).toMatchObject({ ok: false, codigo: "falha_instalacao" });
    expect(existsSync(join(m.ud, "mcp", "falso-ok", "VERSAO-ANTIGA"))).toBe(true);
    expect(m.repo.obterInstalado("falso-ok")!.versao).toBe("1.0.0");
  });
});

describe("desinstalar", () => {
  it("recusa com Pane ativo ('em uso') e não remove nada", async () => {
    const m = montar({ deps: { emUso: (id) => id === "falso-ok" } });
    await instalar(m, "falso-ok");
    expect(await m.ciclo.desinstalar("falso-ok", { apagar_segredos: false })).toMatchObject({ ok: false, codigo: "em_uso" });
    expect(existsSync(join(m.ud, "mcp", "falso-ok"))).toBe(true);
    expect(m.repo.obterInstalado("falso-ok")!.estado).toBe("instalado");
  });

  it("zero resíduos: pasta, banco, habilitações, .old/.tmp; segredos só se a pessoa pedir", async () => {
    for (const apagar of [false, true]) {
      const removidas: string[] = [];
      const m = montar({ deps: { cliUsuario: { instalar: async () => ({ ok: true }), remover: async (id, cli) => { removidas.push(`${id}:${cli}`); return { ok: true }; } } } });
      await instalar(m, "falso-chave");
      await m.ciclo.gravarVariavel("falso-chave", "FALSO_API_KEY", SEGREDO_OK);
      await m.ciclo.habilitar("falso-chave", "workspace", "w1", true);
      m.repo.cliInstalacaoGravar({ servidor_id: "falso-chave", cli: "claude", nome_na_cli: "ev_falso_chave", escopo: "user", criado_em: "t" });
      mkdirSync(join(m.ud, "mcp", ".old", "falso-chave-xx"), { recursive: true });
      const r = await m.ciclo.desinstalar("falso-chave", { apagar_segredos: apagar });
      expect(r).toEqual({ ok: true, residuos: [] });
      expect(readdirSync(join(m.ud, "mcp")).filter((n) => n === "falso-chave")).toEqual([]);
      expect(readdirSync(join(m.ud, "mcp", ".old"))).toEqual([]);
      expect(m.repo.obterInstalado("falso-chave")).toBeNull();
      expect(m.repo.listarHabilitacoes()).toEqual([]);
      expect(removidas).toEqual(["falso-chave:claude"]);
      const cofre = cofreDeTeste(m.cofreDir);
      expect(await cofre.existe(nomeCofre("falso-chave", "FALSO_API_KEY"))).toBe(!apagar);
      expect(m.eventos.map(([n]) => n)).toContain("mcp_store.removed");
    }
  });

  it("P-99: pasta com 2 000 arquivos some em ≤ 500 ms com 0 resíduos", async () => {
    const m = montar();
    await instalar(m, "falso-ok");
    const dir = join(m.ud, "mcp", "falso-ok", "node_modules", "lixo");
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 2000; i++) writeFileSync(join(dir, `f${i}.js`), "x");
    const t0 = performance.now();
    const r = await m.ciclo.desinstalar("falso-ok", { apagar_segredos: false });
    expect(performance.now() - t0).toBeLessThan(500 * Number(process.env["EXPXV_PERF_FATOR"] ?? 1));
    expect(r).toEqual({ ok: true, residuos: [] });
  });

  it("desinstalar o que não está instalado: nao_instalado", async () => {
    expect(await montar().ciclo.desinstalar("falso-ok", { apagar_segredos: false })).toMatchObject({ ok: false, codigo: "nao_instalado" });
  });
});

describe("servidor remoto", () => {
  it("instala sem executar nada, testa por HTTP com fetch injetado e some do Pane se desabilitado", async () => {
    const chamadas: string[] = [];
    const fetchFalso = (async (_url: string, init: RequestInit) => {
      const corpo = JSON.parse(String(init.body)) as { method: string; id?: number };
      chamadas.push(corpo.method);
      const json = (r: unknown): Response => new Response(JSON.stringify({ jsonrpc: "2.0", id: corpo.id, result: r }), { headers: { "content-type": "application/json", "mcp-session-id": "s1" } });
      if (corpo.method === "initialize") return json({ protocolVersion: "2025-06-18", serverInfo: { name: "remoto-falso", version: "9" }, capabilities: {} });
      if (corpo.method === "tools/list") return json({ tools: [{ name: "pergunta", description: "faz pergunta\u0007" }] });
      return new Response("", { status: 202 });
    }) as unknown as typeof fetch;
    const m = montar({ deps: { fetch: fetchFalso } });
    await instalar(m, "falso-remoto");
    expect(m.ex.chamadas).toHaveLength(0);
    expect(m.repo.obterInstalado("falso-remoto")).toMatchObject({ metodo: "remoto", nivel_verificacao: "remoto", pasta_rel: null });
    expect(chamadas).toEqual([]); // instalar remoto não usa a rede
    expect(await m.ciclo.testar("falso-remoto")).toMatchObject({ estado: "ok", n_ferramentas: 1 });
    expect(chamadas).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(m.repo.ferramentasDe("falso-remoto")[0]!.descricao).toBe("faz pergunta");
    await m.ciclo.habilitar("falso-remoto", "workspace", "w1", true);
    expect((await m.ciclo.servidoresDoPane({ workspace: "w1" })).politica.servidores).toEqual(["falso-remoto"]);
  });

  it("401 do servidor remoto vira nao_autorizado; timeout vira timeout", async () => {
    const m = montar({ deps: { fetch: (async () => new Response("", { status: 401 })) as unknown as typeof fetch } });
    await instalar(m, "falso-remoto");
    expect(await m.ciclo.testar("falso-remoto")).toMatchObject({ estado: "indisponivel", erro: "nao_autorizado" });
    const lento = montar({ deps: { timeoutSaudeMs: 200, fetch: ((_u: string, i: RequestInit) => new Promise((_ok, rej) => { i.signal!.addEventListener("abort", () => rej(new Error("abort"))); })) as unknown as typeof fetch } });
    await instalar(lento, "falso-remoto");
    expect(await lento.ciclo.testar("falso-remoto")).toMatchObject({ estado: "indisponivel", erro: "timeout" });
  });
});

describe("saúde passiva e limpeza", () => {
  it("passiva: pasta, executável, hash do comando e atualização; sem iniciar processo", async () => {
    const m = montar();
    await instalar(m, "falso-ok");
    expect(await m.ciclo.saudePassiva()).toEqual([{ id: "falso-ok", pasta_ok: true, executavel_ok: true, comando_hash_ok: true, atualizacao_disponivel: false, bloqueado: false }]);
    await import("node:fs/promises").then((f) => f.rm(join(m.ud, "mcp", "falso-ok"), { recursive: true }));
    expect((await m.ciclo.saudePassiva())[0]).toMatchObject({ pasta_ok: false, executavel_ok: false });
    const n = montar({ cat: catalogoFalso([Object.assign(entradaNpmFalsa("falso-ok", "@falso/ok"), { instalacao: { ...entradaNpmFalsa("falso-ok", "@falso/ok").instalacao, versao: "9.9.9" } })]), repo: m.repo, ud: m.ud, cofreDir: m.cofreDir });
    expect((await n.ciclo.saudePassiva())[0]).toMatchObject({ comando_hash_ok: false, atualizacao_disponivel: true });
  });

  it("limparTmpOrfaos: apaga só o que passou de 1 h", async () => {
    const m = montar();
    const tmp = join(m.ud, "mcp", ".tmp");
    mkdirSync(join(tmp, "velho-1"), { recursive: true }); mkdirSync(join(tmp, "novo-1"), { recursive: true });
    const velho = new Date(Date.now() - 2 * 3_600_000);
    utimesSync(join(tmp, "velho-1"), velho, velho);
    expect(await m.ciclo.limparTmpOrfaos()).toBe(1);
    expect(readdirSync(tmp)).toEqual(["novo-1"]);
  });
});
