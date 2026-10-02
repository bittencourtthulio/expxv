// Serviço da Loja de MCPs no main (Fase 7B, onda C): banco SQLite real (migrations), catálogo e executor de npm FALSOS, cofre real com
// cifrador falso, servidores MCP falsos de verdade. Nenhum pacote real, nenhuma rede; nenhum processo sobra.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EventoLojaMcp } from "../compartilhado/loja-mcp";
import { SEGREDO_VAZADO_SENTINELA, aguardar, montarLoja } from "../../tests/fixtures/mcp-loja/apoio-main";
import { pastaDaLojaMcp, varrerArquivosOrfaosDaLoja } from "./loja-mcp";
import { limparPastas, novaPasta } from "../../tests/fixtures/mcp-loja/apoio-ciclo";
import { derrubarTodos } from "../../tests/fixtures/mcp-loja/servidores";

afterEach(async () => { limparPastas(); await derrubarTodos(); });

describe("pasta de recursos", () => {
  it("empacotado lê <resources>/mcp; em desenvolvimento, <app>/resources/mcp; sem pasta = null", () => {
    expect(pastaDaLojaMcp({ empacotado: true, resourcesPath: "/R", appPath: "/A", existe: (c) => c === "/R/mcp" })).toBe("/R/mcp");
    expect(pastaDaLojaMcp({ empacotado: false, resourcesPath: "/R", appPath: "/A", existe: (c) => c === "/A/resources/mcp" })).toBe("/A/resources/mcp");
    expect(pastaDaLojaMcp({ empacotado: false, resourcesPath: "/R", appPath: "/A", existe: () => false })).toBeNull();
  });
});

describe("serviço: listar, plano e instalar", () => {
  it("listar não abre o cofre, não roda processo e marca o Kit; sem registro o cartão é `Instalar`", async () => {
    const m = montarLoja();
    const l = await m.loja.listar();
    expect(m.cofreAbertoVezes()).toBe(0);
    expect(m.executor.chamadas).toHaveLength(0);
    expect(l.somente_leitura).toBe(false);
    const c7 = l.entradas.find((e) => e.id === "context7")!;
    expect(c7).toMatchObject({ instalado: null, no_kit: true, instalavel: true });
    expect(l.entradas.find((e) => e.id === "falso-ok")).toMatchObject({ instalado: null, no_kit: false });
  });

  it("instalar com o hash do plano: eventos estado→instalado e saúde; consentimento gravado; o renderer nunca recebe valor", async () => {
    const m = montarLoja();
    const plano = await m.loja.planoInstalacao(["falso-ok", "nao-existe"], null);
    expect(plano.planos.map((p) => p.id)).toEqual(["falso-ok"]);
    expect(plano.bloqueios).toEqual([{ id: "nao-existe", codigo: "nao_confirmado", motivo: expect.any(String), acao: null }]);
    expect(m.executor.chamadas).toHaveLength(0);
    const { instalacao_id } = await m.loja.instalar({ ids: ["falso-ok"], consentimento: { aceito: true, comando_hashes: { "falso-ok": plano.planos[0]!.comando_hash } }, workspace_id: null });
    expect(instalacao_id).toMatch(/^inst_[0-9a-f]{16}$/);
    await aguardar(() => m.eventos.some((e) => e.tipo === "saude"));
    expect(m.eventos.filter((e) => e.tipo === "estado").map((e) => (e as Extract<EventoLojaMcp, { tipo: "estado" }>).estado)).toEqual(["instalando", "instalado"]);
    expect(m.eventos.find((e) => e.tipo === "saude")).toMatchObject({ id: "falso-ok", estado: "ok", n_ferramentas: expect.any(Number) });
    expect(m.repo.obterInstalado("falso-ok")?.estado).toBe("instalado");
    expect(m.repo.consentimentosDe("falso-ok")).toHaveLength(1);
    expect(m.barramento.map(([n]) => n)).toContain("mcp_store.install_finished");
    const l = await m.loja.listar();
    expect(l.entradas.find((e) => e.id === "falso-ok")).toMatchObject({ instalado: { estado: "instalado", atualizacao_disponivel: false }, saude: { estado: "ok" } });
  });

  it("hash errado ou ausente: nada instala (consentimento_invalido) e nada é executado", async () => {
    const m = montarLoja();
    await m.loja.instalar({ ids: ["falso-ok", "falso-publica"], consentimento: { aceito: true, comando_hashes: { "falso-ok": "0".repeat(64) } }, workspace_id: null });
    await aguardar(() => m.eventos.filter((e) => e.tipo === "estado" && (e as { estado: string }).estado === "falhou").length === 2);
    expect(m.eventos.filter((e) => e.tipo === "estado" && (e as { estado: string }).estado === "falhou").map((e) => (e as { erro_codigo: string }).erro_codigo)).toEqual(["consentimento_invalido", "consentimento_invalido"]);
    expect(m.executor.chamadas).toHaveLength(0);
    expect(m.repo.listarInstalados()).toEqual([]);
  });

  it("cancelar aborta a instalação em andamento; id desconhecido devolve ok:false", async () => {
    const m = montarLoja();
    const plano = await m.loja.planoInstalacao(["falso-ok"], null);
    const { instalacao_id } = await m.loja.instalar({ ids: ["falso-ok"], consentimento: { aceito: true, comando_hashes: { "falso-ok": plano.planos[0]!.comando_hash } }, workspace_id: null });
    expect(await m.loja.cancelar(instalacao_id)).toEqual({ ok: true });
    expect(await m.loja.cancelar("inst_naoexiste00")).toEqual({ ok: false });
    await aguardar(() => m.eventos.some((e) => e.tipo === "estado" && e.id === "falso-ok" && e.estado === "falhou"));
    expect(m.eventos.find((e) => e.tipo === "estado" && e.estado === "falhou")).toMatchObject({ erro_codigo: "cancelado" });
    expect(m.executor.chamadas).toHaveLength(0);
    expect(m.repo.listarInstalados()).toEqual([]);
  });
});

describe("variáveis e habilitação", () => {
  it("segredo grava no cofre; habilitar sem configurar recusa; depois habilita; o valor não aparece em evento, log, detalhe nem listagem", async () => {
    const m = montarLoja();
    await m.instalar("falso-chave");
    expect(await m.loja.habilitar("falso-chave", "workspace", m.ws, true)).toMatchObject({ ok: false, codigo: "nao_configurado" });
    expect(await m.loja.variaveisEstado("falso-chave")).toEqual([{ nome: "FALSO_API_KEY", obrigatoria: true, secreta: true, definida: false }]);
    expect(await m.loja.gravarVariavel("falso-chave", "FALSO_API_KEY", SEGREDO_VAZADO_SENTINELA)).toEqual({ ok: true, codigo: null });
    expect(await m.loja.gravarVariavel("falso-chave", "OUTRA", "x")).toEqual({ ok: false, codigo: "variavel_desconhecida" });
    expect(await m.loja.habilitar("falso-chave", "workspace", m.ws, true)).toEqual({ ok: true, codigo: null, detalhe: null });
    expect(await m.loja.habilitar("falso-chave", "workspace", "ws_inexistente", true)).toMatchObject({ ok: false, codigo: "alvo_invalido" });
    const tudo = JSON.stringify([m.eventos, m.barramento, await m.loja.listar(), await m.loja.detalhe("falso-chave", m.ws), await m.loja.logs("falso-chave", 50), await m.loja.habilitacoes(m.ws), m.repoTexto()]);
    expect(tudo).not.toContain(SEGREDO_VAZADO_SENTINELA);
    expect((await m.loja.habilitacoes(m.ws)).map((h) => h.alvo_valor)).toEqual([m.ws]);
  });

  it("testar com chave: handshake pelo ambiente por allowlist; detalhe traz permissões (comando exato) e variáveis só por nome", async () => {
    const m = montarLoja();
    await m.instalar("falso-chave");
    expect((await m.loja.testar("falso-chave", m.ws)).erro).toBe("nao_configurado");
    await m.loja.gravarVariavel("falso-chave", "FALSO_API_KEY", "chave-valida");
    expect(await m.loja.testar("falso-chave", m.ws)).toMatchObject({ estado: "ok", erro: null });
    const det = await m.loja.detalhe("falso-chave", m.ws);
    expect(det?.permissoes?.comando_exato).toContain("falso-chave");
    expect(det?.variaveis).toEqual([{ nome: "FALSO_API_KEY", obrigatoria: true, secreta: true, definida: true }]);
    expect(det?.ferramentas.length).toBeGreaterThan(0);
    expect(await m.loja.detalhe("nao-existe", null)).toBeNull();
  });
});

describe("injeção por Pane, segredos e gate", () => {
  it("sem habilitação: resolver devolve null SEM carregar catálogo nem abrir o cofre", async () => {
    const m = montarLoja();
    expect(await m.loja.resolver(m.alvo("pane_1"))).toBeNull();
    expect(m.cofreAbertoVezes()).toBe(0);
    expect(m.executor.chamadas).toHaveLength(0);
  });

  it("Pane livre com servidor configurado e habilitado: Claude recebe --mcp-config sem segredo; snapshot, gate, rota de segredos e liberar", async () => {
    const m = montarLoja();
    await m.instalar("falso-chave");
    await m.loja.gravarVariavel("falso-chave", "FALSO_API_KEY", SEGREDO_VAZADO_SENTINELA);
    await m.instalar("falso-ok");
    await m.loja.habilitar("falso-chave", "workspace", m.ws, true);
    await m.loja.habilitar("falso-ok", "workspace", m.ws, true);
    m.vivos.add("pane_1");
    const inj = await m.loja.resolver(m.alvo("pane_1"));
    expect(inj?.ids.sort()).toEqual(["falso-chave", "falso-ok"]);
    const conf = inj!.configurar("claude", "/x/panes/pane_1/mcp.json")!;
    expect(conf.argumentos).toEqual(["--mcp-config", "/x/panes/pane_1/mcp.json"]);
    expect(conf.ambiente_requerido.length).toBe(2);
    expect(conf.arquivo).not.toContain(SEGREDO_VAZADO_SENTINELA);
    expect(JSON.stringify(conf.argumentos)).not.toContain(SEGREDO_VAZADO_SENTINELA);
    const mcp = JSON.parse(conf.arquivo!).mcpServers as Record<string, { command: string; args: string[] }>;
    expect(Object.keys(mcp).sort()).toEqual(["ev_falso_chave", "ev_falso_ok"]);
    expect(mcp["ev_falso_chave"]!.args.slice(1)).toEqual(["--servidor", "falso-chave"]); // com segredo: pelo lançador
    expect(mcp["ev_falso_ok"]!.args.join(" ")).not.toContain("mcp-run"); // sem segredo: direto
    expect(inj!.configurar("gemini", "/x")).toBeNull();
    // gate: só o snapshot do Pane
    expect(m.loja.gate("pane_1", "mcp__ev_falso_ok__eco")).toEqual({ permitido: true, motivo: null });
    expect(m.loja.gate("pane_1", "mcp__ev_deepwiki__ask").permitido).toBe(false);
    expect(m.loja.gate("pane_2", "mcp__ev_falso_ok__eco").permitido).toBe(false);
    expect(m.loja.gate("pane_2", "Bash").permitido).toBe(true);
    // rota de segredos: o comando resolvido só sai para o Pane com o servidor no snapshot
    const r = await m.loja.segredos("pane_1", "falso-chave");
    expect(r.status).toBe(200);
    expect((r.corpo as { comando: { env: Record<string, string> } }).comando.env["FALSO_API_KEY"]).toBe(SEGREDO_VAZADO_SENTINELA);
    expect((await m.loja.segredos("pane_2", "falso-chave")).status).toBe(401);
    expect((await m.loja.segredos("pane_1", "deepwiki")).status).toBe(403);
    // desinstalar com Pane vivo recusa; Pane encerrado libera
    expect(await m.loja.desinstalar("falso-ok", false)).toMatchObject({ ok: false, codigo: "em_uso" });
    m.vivos.delete("pane_1");
    expect(m.loja.emUso("falso-ok")).toBe(false);
    expect(m.loja.gate("pane_1", "mcp__ev_falso_ok__eco").permitido).toBe(false);
    expect(await m.loja.desinstalar("falso-ok", false)).toEqual({ ok: true, codigo: null, residuos: [] });
  });

  it("mcp_store_list (listarHabilitados): só o snapshot do PRÓPRIO Pane, sem URL/args/variáveis; some ao desinstalar, ao encerrar o Pane e para Pane alheio", async () => {
    const m = montarLoja();
    await m.instalar("falso-chave");
    await m.loja.gravarVariavel("falso-chave", "FALSO_API_KEY", SEGREDO_VAZADO_SENTINELA);
    await m.instalar("falso-ok");
    await m.loja.habilitar("falso-chave", "workspace", m.ws, true);
    await m.loja.habilitar("falso-ok", "workspace", m.ws, true);
    m.vivos.add("pane_1");
    m.vivos.add("pane_2");
    expect((await m.loja.listarHabilitados("pane_1", { query: null, category: null, limit: 25 })).servers).toEqual([]); // sem snapshot ainda
    await m.loja.resolver(m.alvo("pane_1"));
    const r = await m.loja.listarHabilitados("pane_1", { query: null, category: null, limit: 25 });
    expect(r.servers.map((x) => x.id).sort()).toEqual(["falso-chave", "falso-ok"]);
    for (const x of r.servers) expect(Object.keys(x).sort()).toEqual(["category", "enabled_for_you", "id", "name", "tools", "transport"]);
    expect(JSON.stringify(r)).not.toContain(SEGREDO_VAZADO_SENTINELA);
    expect(JSON.stringify(r)).not.toMatch(/mcp-run|node_modules|--servidor/);
    expect((await m.loja.listarHabilitados("pane_1", { query: "ok", category: null, limit: 25 })).servers.map((x) => x.id)).toEqual(["falso-ok"]);
    expect((await m.loja.listarHabilitados("pane_2", { query: null, category: null, limit: 25 })).servers).toEqual([]); // Pane alheio nunca vê o snapshot de outro
    m.vivos.delete("pane_1");
    expect((await m.loja.listarHabilitados("pane_1", { query: null, category: null, limit: 25 })).servers).toEqual([]); // Pane encerrado
  });

  it("instalar na minha CLI recusa servidor que entrou na lista de bloqueio DEPOIS de instalado (achado A-2) e nunca roda a CLI", async () => {
    const antes = montarLoja();
    await antes.instalar("falso-ok");
    expect(await antes.loja.previaCliUsuario("falso-ok", "claude", null)).toMatchObject({ ok: true });
    // mesma instalação (banco e pasta), mas agora o servidor está na lista de bloqueio
    const depois = montarLoja({ repo: antes.repo, userData: antes.userData, bloqueios: [{ id: "falso-ok", motivo: "comprometido", desde: "2026-10-01" }] });
    const r = await depois.loja.instalarNaCli("falso-ok", "claude", "ev_falso_ok", null);
    expect(r).toMatchObject({ ok: false, codigo: "bloqueado" });
    expect(depois.executor.chamadas.filter((c) => /claude|codex|gemini/.test(c.exe))).toHaveLength(0);
  });

  it("depois de um restart do app (snapshots só em memória) o Pane que sobreviveu NÃO recebe segredo nem passa no gate: 401 e deny, falha fechada (achado A-3, residual documentado)", async () => {
    const m = montarLoja();
    await m.instalar("falso-ok");
    await m.loja.habilitar("falso-ok", "workspace", m.ws, true);
    m.vivos.add("pane_1");
    await m.loja.resolver(m.alvo("pane_1"));
    expect((await m.loja.segredos("pane_1", "falso-ok")).status).toBe(200);
    expect(m.loja.gate("pane_1", "mcp__ev_falso_ok__eco").permitido).toBe(true);
    // "restart": nova instância sobre o MESMO banco e a mesma userData; o Pane segue vivo (daemon), mas o snapshot não existe mais
    const depois = montarLoja({ repo: m.repo, userData: m.userData, paneAtivo: () => true });
    expect((await depois.loja.segredos("pane_1", "falso-ok")).status).toBe(401);
    expect(depois.loja.gate("pane_1", "mcp__ev_falso_ok__eco")).toMatchObject({ permitido: false });
    expect(await depois.loja.listarHabilitados("pane_1", { query: null, category: null, limit: 25 })).toEqual({ servers: [] });
  });

  it("Missão squad sem allow-list: 0 servidores e nada no snapshot; com allow-list da Missão, entra", async () => {
    const m = montarLoja();
    await m.instalar("falso-ok");
    await m.loja.habilitar("falso-ok", "workspace", m.ws, true);
    m.vivos.add("pane_s");
    expect(await m.loja.resolver({ ...m.alvo("pane_s"), missao_id: "mis_1", modo: "squad" })).toBeNull();
    expect(m.loja.gate("pane_s", "mcp__ev_falso_ok__eco").permitido).toBe(false);
    await m.loja.habilitar("falso-ok", "missao", "mis_1", true);
    const inj = await m.loja.resolver({ ...m.alvo("pane_s"), missao_id: "mis_1", modo: "squad" });
    expect(inj?.ids).toEqual(["falso-ok"]);
    expect(inj!.configurar("claude", "/x/mcp.json")!.argumentos).toContain("--strict-mcp-config");
  });

  it("evento mcp_store.injected leva só ids e CLI; liberar só apaga arquivos de Pane que acabou", async () => {
    const m = montarLoja();
    await m.instalar("falso-ok");
    await m.loja.habilitar("falso-ok", "workspace", m.ws, true);
    m.vivos.add("pane_e");
    await m.loja.resolver(m.alvo("pane_e", "codex"));
    expect(m.barramento.find(([n]) => n === "mcp_store.injected")).toEqual(["mcp_store.injected", { pane_id: "pane_e", cli: "codex", ids: ["falso-ok"] }]);
    m.loja.liberar("pane_e"); // Pane ainda vivo (ex.: troca de conta com o mesmo pane_id): esquece o snapshot e NÃO apaga arquivo
    expect(m.limpezas).toEqual([]);
    await m.loja.resolver(m.alvo("pane_e", "codex"));
    m.vivos.delete("pane_e");
    m.loja.liberar("pane_e");
    expect(m.limpezas).toEqual(["pane_e"]);
  });
});

describe("kit, CLI do usuário, diagnóstico e manutenção ociosa", () => {
  it("kit: estado/plano sem rede; opt-out; instalar exige o hash do CONJUNTO", async () => {
    const m = montarLoja();
    const est = await m.loja.kitEstado();
    expect(est.opt_out).toBe(false);
    expect(est.pendentes).toContain("context7");
    const plano = await m.loja.kitPlano(null);
    expect(m.executor.chamadas).toHaveLength(0);
    expect(plano.comando_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await m.loja.kitOptOut(true)).opt_out).toBe(true);
    await m.loja.kitInstalar({ aceito: true, comando_hash: "f".repeat(64) }, null);
    await aguardar(() => m.eventos.some((e) => e.tipo === "estado" && (e as { estado: string }).estado === "falhou"));
    expect(m.repo.listarInstalados()).toEqual([]);
  });

  it("instalar na minha CLI: prévia sem efeito; sem confirmação digitada nada roda; remover só o que o app criou", async () => {
    const m = montarLoja();
    await m.instalar("falso-ok");
    const p = await m.loja.previaCliUsuario("falso-ok", "claude", null);
    expect(p).toMatchObject({ ok: true, previa: { nome_na_cli: "ev_falso_ok" } });
    expect(await m.loja.instalarNaCli("falso-ok", "claude", "errado", null)).toMatchObject({ ok: false, codigo: "confirmacao_invalida" });
    expect(m.executor.chamadas.some((c) => c.args.includes("mcp"))).toBe(false);
    expect(await m.loja.previaCliUsuario("falso-ok", "opencode", null)).toMatchObject({ ok: false, codigo: "cli_sem_suporte" });
    expect(await m.loja.removerDaCli("falso-ok", "claude")).toMatchObject({ ok: false, codigo: "nao_criado_pelo_app" });
  });

  it("diagnóstico traduz o do ciclo (cofre incluso)", async () => {
    const m = montarLoja();
    expect(await m.loja.diagnostico()).toEqual({ npm: { ok: true, versao: "10.0.0" }, node: { ok: true, versao: "v22.0.0" }, uv: { ok: false, versao: null }, docker: { ok: false }, cofre: { disponivel: true } });
  });

  it("ocioso: sem nada instalado não carrega nada; com instalado, limpa .tmp órfão e desabilita bloqueado", async () => {
    const m = montarLoja();
    await m.loja.ocioso();
    expect(m.cofreAbertoVezes()).toBe(0);
    await m.instalar("falso-ok");
    await m.loja.habilitar("falso-ok", "workspace", m.ws, true);
    await expect(m.loja.ocioso()).resolves.toBeUndefined();
  });

  it("ocioso varre os arquivos temporários de Pane que já não existe (e só deles), sem depender de nada instalado", async () => {
    const m = montarLoja();
    const pasta = (id: string) => join(m.userData, "panes", id);
    for (const id of ["pane_morto", "pane_vivo"]) {
      mkdirSync(pasta(id), { recursive: true });
      writeFileSync(join(pasta(id), "mcp.json"), '{"mcpServers":{}}', { mode: 0o600 });
      writeFileSync(join(pasta(id), "claude-settings.json"), "{}", { mode: 0o600 });
      writeFileSync(join(pasta(id), "outro-arquivo.txt"), "fica");
    }
    mkdirSync(join(m.userData, "panes", "nome invalido!"), { recursive: true });
    writeFileSync(join(m.userData, "panes", "nome invalido!", "mcp.json"), "{}");
    m.vivos.add("pane_vivo");
    await m.loja.ocioso();
    expect(existsSync(join(pasta("pane_morto"), "mcp.json"))).toBe(false);
    expect(existsSync(join(pasta("pane_morto"), "claude-settings.json"))).toBe(false);
    expect(readFileSync(join(pasta("pane_morto"), "outro-arquivo.txt"), "utf8")).toBe("fica");
    expect(existsSync(join(pasta("pane_vivo"), "mcp.json"))).toBe(true);
    expect(existsSync(join(m.userData, "panes", "nome invalido!", "mcp.json"))).toBe(true); // nome fora do padrão de id: nunca tocado
    expect(m.cofreAbertoVezes()).toBe(0); // varrer não abre cofre nem catálogo
  });

  it("varredura sem pasta `panes` é no-op", async () => {
    expect(await varrerArquivosOrfaosDaLoja(novaPasta("sem-panes-"), () => false)).toEqual([]);
  });

  it("descobrir: só por chamada explícita, sem abrir catálogo nem cofre, e nada vira instalável nem habilitado", async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return new Response(JSON.stringify({ servers: [{ server: { name: "io.github.acme/docs", description: "Servidor de documentação de exemplo" } }] }), { status: 200 }); }) as unknown as typeof fetch;
    const m = montarLoja({ fetch: f });
    await m.loja.listar();
    await m.loja.ocioso();
    expect(urls).toEqual([]); // abrir a Loja e a manutenção ociosa nunca chamam a rede do registro
    const aberturas = m.cofreAbertoVezes();
    const r = await m.loja.descobrir("docs");
    expect(urls).toHaveLength(1);
    expect(r.candidatos).toEqual([expect.objectContaining({ nome: "io.github.acme/docs", curado: false, instalavel: false, namespace_verificado: true })]);
    expect(m.cofreAbertoVezes()).toBe(aberturas);
    expect(m.repo.listarHabilitacoes()).toEqual([]);
    expect(m.repo.listarInstalados()).toEqual([]);
    await expect(m.loja.descobrir("x")).rejects.toMatchObject({ codigo: "consulta_invalida" });
    expect(urls).toHaveLength(1);
  });

  it("catálogo ilegível: a Loja abre vazia, só em leitura, sem lançar", async () => {
    const m = montarLoja({ semCatalogo: true });
    const l = await m.loja.listar();
    expect(l).toMatchObject({ entradas: [], somente_leitura: true });
    expect(l.aviso).toContain("leitura");
  });
});
