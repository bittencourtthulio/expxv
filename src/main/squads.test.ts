// Integração de squads no main: serviços REAIS (banco, Missões, Panes, orquestração, loja de squads, squads de FÁBRICA do repositório) com
// sessões e detector falsos. Prova o fluxo do plano: duplicar da fábrica → editar o prompt → caixa de prompt → orquestrador com o
// perfil/prompt do membro → invocar executores (portão, limites, prompt relido) sem nenhuma CLI de verdade.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarTmp, detectorFalso, ferramenta, limpar, novoBanco, sessoesFalsas } from "../../tests/fixtures/dominio/ambiente";
import { criarServicoContas } from "../nucleo/provedores/contas";
import { criarServicoProvedores } from "../nucleo/provedores/servico";
import { criarServicoMissoes } from "../nucleo/missoes/servico";
import { criarServicoPanes } from "../nucleo/missoes/panes";
import { PRODUTO } from "../nucleo/produto";
import type { EventoSquad } from "../compartilhado/squads";
import { criarBarramento } from "./barramento";
import { criarOrquestracao, type Orquestracao } from "./orquestracao";
import { ligarSquads, pastaDeFabricaDeSquads, type LigacaoSquads, type ObservarPastaRecursiva } from "./squads";
import { criarManipuladoresSquads, registrarIpcSquads, sanearErroDeSquads } from "./ipc/squads";
import { criarRegistroIpc } from "./ipc/registro";
import { CANAIS_INVOKE } from "../compartilhado/ipc";

afterEach(limpar);

const RAIZ_REPO = join(__dirname, "..", "..");
const ATIVOS = {
  pastaDePrompts: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "prompts"),
  scriptGancho: join(RAIZ_REPO, "src", "nucleo", "orquestracao", "hooks", "scripts", "gancho.mjs"),
  caminhoWorker: "/nao-usado/mcp-worker.js",
};
const FABRICA = join(RAIZ_REPO, "resources", "squads");
const abertas: Array<{ orq: Orquestracao; sq: LigacaoSquads }> = [];
afterEach(async () => {
  while (abertas.length) {
    const a = abertas.pop();
    a?.sq.encerrar();
    await a?.orq.encerrar();
  }
});

function montar(opcoes: { ferramentas?: ReturnType<typeof ferramenta>[]; observarPasta?: ObservarPastaRecursiva } = {}) {
  const b = novoBanco();
  const { banco, repos } = b;
  const dados = criarTmp("sq-dados-");
  const raiz = criarTmp("sq-ws-");
  const ws = repos.workspace.criar({ nome: "ws", raiz });
  const sessoes = sessoesFalsas();
  const detector = detectorFalso(opcoes.ferramentas ?? [ferramenta("claude"), ferramenta("codex"), ferramenta("opencode")]);
  const contas = criarServicoContas({ banco, repos, pastaDeDados: dados });
  const workspaces = { exigir: (id: string) => repos.workspace.exigir(id) };
  const barramento = criarBarramento();
  const eventosDominio: Array<{ tipo: string; payload: Record<string, unknown> }> = [];
  for (const t of ["squad.saved", "squad.deleted", "squad.exported", "squad.imported", "squad.prompt_sent", "agent.invoked", "agent.closed", "squad.factory_update_available"]) {
    barramento.assinar(t, (payload) => void eventosDominio.push({ tipo: t, payload: payload as Record<string, unknown> }));
  }
  const panes = criarServicoPanes({ banco, repos, workspaces, sessoes: async () => sessoes as never, detector, contas });
  const missoes = criarServicoMissoes({ banco, repos, workspaces, panes });
  const provedores = criarServicoProvedores({ detector, contas });
  const avisos: string[] = [];
  const orq = criarOrquestracao({
    dominio: { repos, workspaces, provedores, missoes, panes },
    banco,
    barramento,
    sessoes: async () => sessoes as never,
    dirApp: dados,
    executavelNode: "/app/Electron",
    electronComoNode: true,
    ativos: ATIVOS,
    avisar: (m) => void avisos.push(m),
    atrasoFechamentoMs: 10,
    intervaloSegurancaMs: 50,
    iniciarServidor: async () => ({
      url: "http://127.0.0.1:1/mcp",
      urlGanchos: "http://127.0.0.1:1/hooks",
      porta: 1,
      portaAnterior: null,
      portaReutilizada: true,
      emitirToken: (p) => `token-${p.pane_id}-${p.role}`,
      revogar: () => undefined,
      fechar: async () => undefined,
    }),
  });
  const renderer: EventoSquad[] = [];
  const saidas: Array<string | null> = [];
  const entradas: Array<string | null> = [];
  const sq = ligarSquads({
    repos,
    banco,
    pastaDoUsuario: join(dados, "squads"),
    pastaDeFabrica: FABRICA,
    workspaces,
    missoes,
    provedores,
    orquestracao: orq,
    panes,
    dirApp: dados,
    barramento,
    emitirRenderer: (e) => void renderer.push(e),
    escolherArquivoDeSaida: async () => saidas.shift() ?? null,
    escolherArquivoDeEntrada: async () => entradas.shift() ?? null,
    pastaDePrompts: ATIVOS.pastaDePrompts,
    avisar: (m) => void avisos.push(m),
    observarPasta: opcoes.observarPasta ?? (() => ({ fechar: () => undefined })),
  });
  abertas.push({ orq, sq });
  return { orq, sq, banco, repos, dados, raiz, ws, sessoes, barramento, eventosDominio, renderer, avisos, saidas, entradas, missoes, panes };
}
type Ambiente = ReturnType<typeof montar>;

const pedido = (m: Ambiente, extra: Record<string, unknown> = {}) => ({ workspace_id: m.ws.id, squad_slug: "minha", objetivo: "Criar a tela de login com e-mail e senha", plano_antes: null, rigidez: null, max_paralelos: null, ...extra }) as never;
const argsDe = (m: Ambiente, paneId: string): string[] => {
  const pane = m.repos.pane.exigir(paneId);
  const s = [...m.sessoes.sessoes.values()].find((x) => x.ambiente[`${PRODUTO.prefixoEnv}MCP_TOKEN`] === `token-${paneId}-${pane.papel}`);
  return (s?.pedido["argumentos"] as string[] | undefined) ?? [];
};
const instrucoesDe = (m: Ambiente, paneId: string): string => {
  const f = join(m.dados, "panes", paneId, "instrucoes.md");
  if (existsSync(f)) return readFileSync(f, "utf8");
  const a = argsDe(m, paneId);
  return a[a.indexOf("--append-system-prompt") + 1] ?? "";
};

async function comSquadMinha(m: Ambiente): Promise<void> {
  await m.orq.iniciar();
  await m.sq.iniciar();
  await m.sq.servico.duplicar({ slug: "feature-fullstack", novo_slug: "minha", novo_nome: "Minha squad" });
}

describe("fluxo completo: fábrica → cópia → caixa de prompt → orquestrador → agentes", () => {
  it("o orquestrador abre com o perfil (modelo, esforço), o prompt do membro, o elenco e o objetivo; o MCP e o handoff continuam", async () => {
    const m = montar();
    await comSquadMinha(m);
    expect(m.sq.servico.listar().length).toBeGreaterThanOrEqual(17);
    const pre = await m.sq.execucao.preflight({ slug: "minha", workspace_id: m.ws.id });
    expect(pre).toMatchObject({ ok: true, substituicoes: [] });
    const r = await m.sq.execucao.enviarPrompt(pedido(m));
    const missao = m.repos.mission.exigir(r.mission_id);
    expect(missao).toMatchObject({ modo: "squad", squad_id: "minha", piloto_pane_id: r.pane_id });
    expect(m.repos.pane.exigir(r.pane_id)).toMatchObject({ cli: "claude", eh_piloto: true, agente_id: "minha.orquestrador", modelo: "opus", esforco: "high" });
    const a = argsDe(m, r.pane_id);
    expect(a).toEqual(expect.arrayContaining(["--model", "opus", "--effort", "high", "--mcp-config", "--settings"]));
    const t = instrucoesDe(m, r.pane_id);
    expect(t).toContain("Você é o piloto"); // base inalterável do papel
    expect(t).toContain("Squad: Minha squad. Você é Orquestrador (orchestrator)");
    expect(t).toContain("Elenco da squad");
    expect(t).toContain("implementador-backend");
    expect(t).toContain('<dado tipo="objetivo"');
    expect(t).toContain("Criar a tela de login");
    expect(t).not.toContain("--dangerously-skip-permissions");
    // portões: plano antes ⇒ `build` pendente; o resto liberado; auditoria gravada
    expect(m.repos.missionSquad.exigir(r.mission_id)).toMatchObject({ squad_slug: "minha", portoes_pendentes: ["build"], plano_antes: true });
    expect(m.repos.squadExecucao.exigir(r.execucao_id).mission_id).toBe(r.mission_id);
    expect(m.eventosDominio.map((e) => e.tipo)).toEqual(expect.arrayContaining(["squad.saved", "agent.invoked", "squad.prompt_sent"]));
    expect(m.renderer).toContainEqual({ slug: "minha", tipo: "gravada" });
  });

  it("agent_invoke: gate_pending antes de aprovar o plano; depois cada executor nasce com o perfil e o prompt EDITADO do membro (CT-14.05)", async () => {
    const m = montar();
    await comSquadMinha(m);
    const r = await m.sq.execucao.enviarPrompt(pedido(m));
    const claims = { workspace_id: m.ws.id, mission_id: r.mission_id, pane_id: r.pane_id, role: "piloto" as const, mode: "squad" as const };
    const lista = m.sq.portaSquads.listar(r.mission_id);
    expect(lista.agents.map((x) => x.agent_id)).toContain("minha.implementador-backend");
    expect(lista.agents.map((x) => x.agent_id)).not.toContain("minha.orquestrador");
    await expect(m.sq.portaSquads.invocar(claims, { agent_id: "minha.implementador-backend" })).rejects.toMatchObject({ subcode: "gate_pending" });

    m.orq.liberarPortao(r.mission_id, "build"); // o que `missoes:liberar_portao` faz quando a pessoa aprova o plano
    const l = await m.sq.servico.lerPrompt("minha.implementador-backend");
    await m.sq.servico.gravarPrompt({ agent_id: "minha.implementador-backend", texto: `${l.texto}\n\nMARCA-DE-EDICAO-DO-USUARIO`, hash_esperado: l.hash });
    const w1 = await m.sq.portaSquads.invocar(claims, { agent_id: "minha.implementador-backend", prompt: "Implemente o endpoint de login" });
    const worker = m.repos.pane.exigir(w1.pane_id);
    expect(worker).toMatchObject({ papel: "executor", cli: "claude", agente_id: "minha.implementador-backend", modelo: "sonnet" });
    expect(argsDe(m, w1.pane_id)).toEqual(expect.arrayContaining(["--model", "sonnet", "--effort", "medium"]));
    expect(instrucoesDe(m, w1.pane_id)).toContain("MARCA-DE-EDICAO-DO-USUARIO");
    expect(m.repos.task.listarPorMissao(r.mission_id).itens[0]?.briefing_path).toContain("briefing-agente-");
    expect(readFileSync(join(m.raiz, m.repos.task.listarPorMissao(r.mission_id).itens[0]?.briefing_path as string), "utf8")).toContain("Implemente o endpoint de login");
    const inv = m.repos.invocacaoAgente.listarPorMissao(r.mission_id);
    expect(inv.map((i) => i.agente_id)).toEqual(["minha.orquestrador", "minha.implementador-backend"]);
    expect(w1.invocation_id).toBe(inv[1]?.id);

    // editar de novo: a PRÓXIMA invocação lê o arquivo atual
    const l2 = await m.sq.servico.lerPrompt("minha.implementador-backend");
    await m.sq.servico.gravarPrompt({ agent_id: "minha.implementador-backend", texto: l2.texto.replace("MARCA-DE-EDICAO-DO-USUARIO", "SEGUNDA-MARCA"), hash_esperado: l2.hash });
    const w2 = await m.sq.portaSquads.invocar(claims, { agent_id: "minha.implementador-backend" });
    expect(instrucoesDe(m, w2.pane_id)).toContain("SEGUNDA-MARCA");
    expect(instrucoesDe(m, w2.pane_id)).not.toContain("MARCA-DE-EDICAO-DO-USUARIO");
    // o worker 1 manteve o que tinha ao nascer
    expect(instrucoesDe(m, w1.pane_id)).toContain("MARCA-DE-EDICAO-DO-USUARIO");

    // limite por membro (max_instancias = 2 na fábrica): o terceiro volta limit_reached e nada fica pela metade
    const tasksAntes = m.repos.task.listarPorMissao(r.mission_id).itens.length;
    await expect(m.sq.portaSquads.invocar(claims, { agent_id: "minha.implementador-backend" })).rejects.toMatchObject({ subcode: "limit_reached" });
    expect(m.repos.task.listarPorMissao(r.mission_id).itens).toHaveLength(tasksAntes);
    expect(m.sq.portaSquads.listar(r.mission_id).agents.find((x) => x.agent_id === "minha.implementador-backend")?.in_flight).toBe(2);
    // encerrar um worker libera a vaga
    await m.panes.encerrarPane(w1.pane_id, "teste");
    await expect(m.sq.portaSquads.invocar(claims, { agent_id: "minha.implementador-backend" })).resolves.toHaveProperty("pane_id");
  });

  it("pane_spawn com agent_id (caminho do MVP) também aplica o perfil do membro e ignora provider/model informados", async () => {
    const m = montar();
    await comSquadMinha(m);
    const r = await m.sq.execucao.enviarPrompt(pedido(m, { plano_antes: false }));
    const { pane_id } = await m.orq.portas.panes.spawn({
      workspace_id: m.ws.id, mission_id: r.mission_id, pedido_por_pane_id: r.pane_id, provedor: "opencode", modelo: "modelo-do-chamador",
      conta_id: null, papel: "executor", agente_id: "minha.revisor", briefing_path: null, cwd: null,
    });
    expect(m.repos.pane.exigir(pane_id)).toMatchObject({ papel: "revisor", cli: "claude", agente_id: "minha.revisor" });
    expect(argsDe(m, pane_id).join(" ")).not.toContain("modelo-do-chamador");
    await expect(
      m.orq.portas.panes.spawn({ workspace_id: m.ws.id, mission_id: r.mission_id, pedido_por_pane_id: r.pane_id, provedor: "claude", modelo: null, conta_id: null, papel: "executor", agente_id: "minha.orquestrador", briefing_path: null, cwd: null }),
    ).rejects.toMatchObject({ subcode: "forbidden_role" });
  });

  it("plano_antes=false libera o executor na criação; o revisor segue obrigatório (mission_complete sem revisor ok é recusado pela porta)", async () => {
    const m = montar();
    await comSquadMinha(m);
    const r = await m.sq.execucao.enviarPrompt(pedido(m, { plano_antes: false }));
    const claims = { workspace_id: m.ws.id, mission_id: r.mission_id, pane_id: r.pane_id, role: "piloto" as const, mode: "squad" as const };
    await expect(m.sq.portaSquads.invocar(claims, { agent_id: "minha.implementador-backend" })).resolves.toHaveProperty("invocation_id");
    await expect(m.orq.portas.missoes.concluir(r.mission_id)).rejects.toMatchObject({ subcode: "reviewer_required" });
  });

  it("Missão de squad criada SEM a caixa de prompt (wizard do MVP) continua como antes: sem agente, sem vínculo", async () => {
    const m = montar();
    await comSquadMinha(m);
    const missao = await m.missoes.criar({ workspace_id: m.ws.id, modo: "squad", origem: "livre", titulo: "Wizard", pedido: "x", clis: { piloto: "claude" } });
    expect(m.repos.pane.exigir(missao.piloto_pane_id as string).agente_id ?? null).toBeNull();
    expect(m.repos.missionSquad.obter(missao.id)).toBeUndefined();
    expect(m.repos.invocacaoAgente.listarPorMissao(missao.id)).toEqual([]);
    expect(instrucoesDe(m, missao.piloto_pane_id as string)).toContain("piloto");
  });

  it("orquestrador com prompt inválido no disco: a Missão é abortada, nenhuma sessão fica órfã e o erro é nominal", async () => {
    const m = montar();
    await comSquadMinha(m);
    const l = await m.sq.servico.lerPrompt("minha.orquestrador");
    // grava um segredo no .md por fora do app (edição externa) e relê
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(m.dados, "squads", "minha", "membros", "orquestrador.md"), `${l.texto}\nAPI_KEY=abcdef123456789\n`);
    await m.sq.servico.recarregar();
    const sessoesAntes = m.sessoes.sessoes.size;
    await expect(m.sq.execucao.enviarPrompt(pedido(m))).rejects.toMatchObject({ codigo: "squad_invalida" });
    expect(m.sessoes.sessoes.size).toBe(sessoesAntes);
    expect(m.repos.missionSquad.obter("nada")).toBeUndefined();
  });

  it("CLI do orquestrador indisponível → erro nominal e nenhuma Missão criada", async () => {
    const m = montar({ ferramentas: [ferramenta("codex")] });
    await comSquadMinha(m);
    await expect(m.sq.execucao.enviarPrompt(pedido(m))).rejects.toMatchObject({ codigo: "cli_indisponivel" });
    expect(m.repos.mission.listarPorWorkspace(m.ws.id, { limite: 10 }).itens).toHaveLength(0);
    const pre = await m.sq.execucao.preflight({ slug: "minha", workspace_id: m.ws.id });
    expect(pre.ok).toBe(true);
    expect(pre.substituicoes.find((s) => s.membro === "orquestrador")).toEqual({ membro: "orquestrador", de: "claude", para: "codex" });
  });
});

describe("ligação: iniciar, observador de edição externa, encerrar", () => {
  it("iniciar liga a porta de agentes, carrega o índice e emite o aviso de fábrica; encerrar solta tudo (idempotentes)", async () => {
    const m = montar();
    await m.orq.iniciar();
    await m.sq.iniciar();
    await m.sq.iniciar();
    expect(m.sq.servico.listar({ origem: "fabrica" }).length).toBeGreaterThanOrEqual(17);
    m.sq.encerrar();
    m.sq.encerrar();
    // com a porta solta, o spawn volta ao MVP (sem ajuste) e não quebra
    const ag = await m.missoes.criar({ workspace_id: m.ws.id, modo: "agentico", origem: "livre", titulo: "A", pedido: "x", clis: { piloto: "claude" } });
    expect(m.repos.pane.exigir(ag.piloto_pane_id as string).agente_id ?? null).toBeNull();
  });

  it("edição externa de um .md: o observador (debounce) relê e o renderer recebe `externa`", async () => {
    let aoMudar: (() => void) | null = null;
    const m = montar({ observarPasta: (_dir, f) => { aoMudar = f; return { fechar: () => undefined }; } });
    await comSquadMinha(m);
    const { writeFileSync } = await import("node:fs");
    const l = await m.sq.servico.lerPrompt("minha.revisor");
    writeFileSync(join(m.dados, "squads", "minha", "membros", "revisor.md"), `${l.texto}\nEDITADO FORA DO APP\n`);
    expect(aoMudar).not.toBeNull();
    m.renderer.length = 0;
    (aoMudar as unknown as () => void)();
    (aoMudar as unknown as () => void)(); // rajada: uma releitura só
    await new Promise((r) => setTimeout(r, 450));
    expect(m.renderer).toEqual([{ slug: "minha", tipo: "externa" }]);
    expect((await m.sq.servico.lerPrompt("minha.revisor")).texto).toContain("EDITADO FORA DO APP");
  });

  it("pastaDeFabricaDeSquads: empacotado usa <resources>/squads; senão dist/squads, depois resources/squads do repositório", () => {
    const existe = (ok: string[]) => (c: string) => ok.includes(c);
    expect(pastaDeFabricaDeSquads({ empacotado: true, resourcesPath: "/r", appPath: "/a", existe: existe(["/r/squads", "/a/resources/squads"]) })).toBe(join("/r", "squads"));
    expect(pastaDeFabricaDeSquads({ empacotado: false, resourcesPath: "/r", appPath: "/a", existe: existe([join("/a", "dist", "squads"), join("/a", "resources", "squads")]) })).toBe(join("/a", "dist", "squads"));
    expect(pastaDeFabricaDeSquads({ empacotado: false, resourcesPath: "/r", appPath: "/a", existe: existe([join("/a", "resources", "squads")]) })).toBe(join("/a", "resources", "squads"));
    expect(pastaDeFabricaDeSquads({ empacotado: true, resourcesPath: "/r", appPath: "/a", existe: () => false })).toBeNull();
  });
});

describe("IPC de squads: registro real, erros saneados, portabilidade pelo seletor do main", () => {
  function registro(m: Ambiente) {
    const invocados = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const reg = criarRegistroIpc({
      ipcMain: { handle: (c, f) => void invocados.set(c, f as never), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined },
      autorizar: () => true,
    });
    registrarIpcSquads({ registro: reg, ligacao: m.sq });
    const chamar = (canal: string, entrada: unknown): Promise<unknown> => Promise.resolve(invocados.get(canal)?.({}, entrada));
    return { reg, chamar };
  }

  it("registra todos os 21 canais squads:/agentes: (inclusive agentes:abrir_pane, T-14.17), e cada um responde pelo serviço real", async () => {
    const m = montar();
    await comSquadMinha(m);
    const { reg, chamar } = registro(m);
    const esperados = CANAIS_INVOKE.filter((c) => /^(squads|agentes):/.test(c)).sort();
    expect(reg.registrados()).toEqual(esperados);
    const lista = (await chamar("squads:listar", { origem: "usuario" })) as Array<{ slug: string }>;
    expect(lista.map((s) => s.slug)).toEqual(["minha"]);
    expect(((await chamar("squads:obter", { slug: "minha" })) as { membros: unknown[] }).membros.length).toBeGreaterThan(3);
    expect(((await chamar("agentes:listar", { squad: "minha" })) as unknown[]).length).toBeGreaterThan(3);
    const opc = (await chamar("agentes:perfil_opcoes", { cli: "claude" })) as { instalada: boolean; esforco_modo: string };
    expect(opc).toMatchObject({ instalada: true, esforco_modo: "flag" });
    const ler = (await chamar("agentes:prompt_ler", { agent_id: "minha.revisor" })) as { texto: string; hash: string; editado: boolean };
    expect(ler.editado).toBe(false);
    const grav = await chamar("agentes:prompt_gravar", { agent_id: "minha.revisor", texto: "novo texto {{rigor}}", hash_esperado: ler.hash });
    expect(grav).toMatchObject({ ok: true });
    expect(((await chamar("agentes:prompt_ler", { agent_id: "minha.revisor" })) as { editado: boolean }).editado).toBe(true);
    expect(await chamar("agentes:prompt_restaurar", { agent_id: "minha.revisor" })).toHaveProperty("hash");
    expect(((await chamar("agentes:prompt_previa", { agent_id: "minha.orquestrador" })) as { renderizado: string }).renderizado).toContain("Minha squad");
    const val = (await chamar("squads:validar", { squad: { ...m.sq.servico.obter("minha"), membros: [] }, workspace_id: m.ws.id })) as Array<{ codigo: string }>;
    expect(val.map((a) => a.codigo)).toContain("sem_orquestrador");
    const ex = (await chamar("squads:execucoes_listar", { workspace_id: m.ws.id, limite: 10 })) as { itens: unknown[] };
    expect(ex.itens).toEqual([]);
    const fab = (await chamar("squads:fabrica_atualizacao", { slug: "minha" })) as { versao_nova: number | null };
    expect(fab.versao_nova).toBeNull();
  });

  it("modo livre (agentes:abrir_pane): Pane avulso com o modelo, o esforço e o prompt do agente; sem Missão, sem portão, sem token MCP", async () => {
    const m = montar();
    await comSquadMinha(m);
    const { chamar } = registro(m);
    const r = (await chamar("agentes:abrir_pane", { workspace_id: m.ws.id, agent_id: "minha.implementador-backend", objetivo: "explique o módulo de login" })) as { pane_id: string };
    const pane = m.repos.pane.exigir(r.pane_id);
    expect(pane).toMatchObject({ mission_id: null, papel: "nenhum", agente_id: "minha.implementador-backend", cli: "claude" });
    expect(m.repos.mission.listarPorWorkspace(m.ws.id).itens).toHaveLength(0);
    const sessao = [...m.sessoes.sessoes.values()].find((x) => (x.pedido["argumentos"] as string[]).includes("--append-system-prompt"));
    const args = sessao?.pedido["argumentos"] as string[];
    expect(args).toEqual(expect.arrayContaining(["--model", "--append-system-prompt"]));
    expect(args.join(" ")).not.toContain("--mcp-config");
    expect(args[args.indexOf("--append-system-prompt") + 1]).toContain("explique o módulo de login");
    expect(Object.keys(sessao?.ambiente ?? {}).some((k) => k.endsWith("MCP_TOKEN"))).toBe(false);
    const inv = m.banco.consultar<{ mission_id: string | null; agente_id: string }>("SELECT mission_id, agente_id FROM invocacao_agente");
    expect(inv).toEqual([{ mission_id: null, agente_id: "minha.implementador-backend" }]);
    // agente inexistente: erro nominal e nenhum Pane novo
    await expect(chamar("agentes:abrir_pane", { workspace_id: m.ws.id, agent_id: "minha.fantasma" })).rejects.toMatchObject({ codigo: "squad_ausente" });
  });

  it("exportar para arquivo e importar de volta usam o seletor do main; o renderer nunca vê caminho; erro de disco vira texto genérico", async () => {
    const m = montar();
    await comSquadMinha(m);
    const { chamar } = registro(m);
    const arquivo = join(criarTmp("sq-io-"), "minha.squad.json");
    m.saidas.push(arquivo);
    expect(await chamar("squads:exportar", { slug: "minha", destino: "arquivo" })).toEqual({ caminho_relativo: null });
    m.entradas.push(arquivo);
    const previa = (await chamar("squads:importar_previa", { origem: "arquivo" })) as { previa_id: string; squad: { slug: string; origem: string } };
    expect(previa.squad).toMatchObject({ slug: "minha", origem: "importada" });
    const copia = (await chamar("squads:importar_confirmar", { previa_id: previa.previa_id, slug: "minha-importada" })) as { slug: string; origem: string };
    expect(copia).toMatchObject({ slug: "minha-importada", origem: "importada" });
    expect(m.sq.servico.listar().map((s) => s.slug)).toContain("minha-importada");
    // cancelar o seletor: erro nominal; ENOENT cru: genérico
    await expect(chamar("squads:exportar", { slug: "minha", destino: "arquivo" })).rejects.toThrow(/cancelada/);
    const cru = Object.assign(new Error("ENOENT: no such file or directory, open '/Users/fulano/segredo'"), { code: "ENOENT" });
    expect(sanearErroDeSquads(cru).message).toBe("falha ao executar a operação de squads");
    expect(sanearErroDeSquads(cru).message).not.toContain("/Users");
    const manip = criarManipuladoresSquads({ ...m.sq, servico: { ...m.sq.servico, obter: () => { throw cru; } } as never });
    await expect(manip["squads:obter"]({ slug: "x" })).rejects.toThrow("falha ao executar a operação de squads");
  });

  it("apagar exige o slug digitado e recusa squad em uso por Missão ativa", async () => {
    const m = montar();
    await comSquadMinha(m);
    const { chamar } = registro(m);
    const r = await m.sq.execucao.enviarPrompt(pedido(m));
    await expect(chamar("squads:apagar", { slug: "minha", confirmar_slug: "minha" })).rejects.toMatchObject({ codigo: "em_uso" });
    expect(m.sq.servico.listar().find((s) => s.slug === "minha")?.em_uso).toBe(true);
    await m.missoes.abortar(r.mission_id);
    expect(await chamar("squads:apagar", { slug: "minha", confirmar_slug: "minha" })).toEqual({ ok: true });
  });
});
