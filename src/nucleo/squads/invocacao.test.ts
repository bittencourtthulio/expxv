import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, type Banco } from "../banco";
import { criarRepositorios, type Repositorios } from "../banco/repos";
import type { Mission, Pane, Workspace } from "../dominio";
import { ErroMcp } from "../mcp/erros";
import type { AgenteDoSquad, PedidoSpawn, PortaMissoes, PortaPanes, PortaProvedores } from "../mcp/portas";
import type { EntradaPreparoDePane } from "../missoes/panes";
import { gravarSquadNoDiretorio, serializarMembroMd } from "./formato";
import { criarMotorDeAgentes, type IntencaoDeExecucao, type MotorDeAgentes } from "./invocacao";
import { criarLoja } from "./loja";
import { resolverPerfilDireto, type PortaResolverPerfil } from "./perfil";
import { criarServicoSquads, type ServicoSquads } from "./servico";
import type { Membro, Squad } from "./tipos";
import { PASTA_PROMPTS_PADRAO } from "../orquestracao/prompts";

const tmps: string[] = [];
const bancos: Banco[] = [];
let raiz = "";
let usuario = "";
let banco: Banco;
let repos: Repositorios;
let ws: Workspace;
let servico: ServicoSquads;
let motor: MotorDeAgentes;
let definidos: Array<{ mission: string; agentes: AgenteDoSquad[] }> = [];
let liberados: Array<{ mission: string; portao: string }> = [];
let eventos: Array<{ tipo: string; payload: Record<string, unknown> }> = [];
let avisos: string[] = [];
let habilitadas = new Set<string>(["claude", "codex"]);
let resolver: PortaResolverPerfil;
const H = "a".repeat(64);

const membro = (slug: string, papel: Membro["papel"], extra: Partial<Membro> = {}): Membro => ({
  slug, papel, rotulo: slug.toUpperCase(), descricao: `faz ${slug}`, prompt: `membros/${slug}.md`,
  perfil: { cli: "claude", modelo: "sonnet", esforco: "alto", faixa: "alto" },
  skills_permitidas: ["ev-builder"], mcps_permitidos: [], hooks: [], max_instancias: 2,
  orcamento: { tempo_min: null, tokens: null, modo: "soft" }, rigidez: null, permissao: null, ...extra,
});
const squad = (extra: Partial<Squad> = {}): Squad => ({
  slug: "eq", nome: "Equipe Teste", descricao: "d", escopo: "desenvolvimento", rigidez_padrao: null, max_instancias_paralelas: 3,
  orcamento: { tempo_min: null, tokens: null, modo: "soft" }, portoes: null, fabrica: null, origem: "usuario",
  membros: [
    membro("orq", "orchestrator", { max_instancias: 1, perfil: { cli: "claude", modelo: "opus", esforco: "alto", faixa: "topo" } }),
    membro("impl", "executor"),
    membro("rev", "reviewer", { max_instancias: 1, perfil: { cli: "codex", modelo: "gpt-5", esforco: "medio", faixa: "alto" } }),
  ],
  ...extra,
});
const textos = (v = "v1") => ({ orq: `PROMPT-ORQ ${v}\nObjetivo: {{objetivo}}\nRAG: {{contexto_rag}}\n{{rigor}}`, impl: `PROMPT-IMPL ${v} card {{card}}`, rev: `PROMPT-REV ${v}` });

beforeEach(async () => {
  raiz = mkdtempSync(join(tmpdir(), "motor-squad-"));
  tmps.push(raiz);
  usuario = join(raiz, "squads");
  mkdirSync(usuario, { recursive: true });
  banco = abrirBanco(":memory:");
  bancos.push(banco);
  migrar(banco);
  repos = criarRepositorios(banco);
  ws = repos.workspace.criar({ nome: "w", raiz: join(raiz, "ws") });
  definidos = [];
  liberados = [];
  eventos = [];
  avisos = [];
  habilitadas = new Set(["claude", "codex"]);
  resolver = resolverPerfilDireto();
  await gravarSquadNoDiretorio(join(usuario, "eq"), squad(), textos());
  const loja = criarLoja({ pastaUsuario: usuario });
  servico = criarServicoSquads({ loja });
  await servico.carregar();
  montar();
});
afterEach(() => {
  bancos.splice(0).forEach((b) => b.fechar());
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function montar(extra: Partial<Parameters<typeof criarMotorDeAgentes>[0]> = {}): void {
  motor = criarMotorDeAgentes({
    servico, repos, banco, resolver,
    cliHabilitada: async (c) => habilitadas.has(c),
    pastaDePrompts: PASTA_PROMPTS_PADRAO,
    definirSquad: (mission, agentes) => definidos.push({ mission, agentes }),
    liberarPortao: (mission, portao) => liberados.push({ mission, portao }),
    emitir: (tipo, payload) => eventos.push({ tipo, payload }),
    avisar: (m) => avisos.push(m),
    maxPanesParalelos: 8,
    ...extra,
  });
}

const intencao = (extra: Partial<IntencaoDeExecucao> = {}): IntencaoDeExecucao => {
  const e = repos.squadExecucao.criar({ squad_slug: "eq", squad_hash: H, workspace_id: ws.id, objetivo: "Fazer o login", plano_antes: true, nivel_rigidez: 3 });
  return {
    execucao_id: e.id, squad_slug: "eq", squad_hash: H, contexto_rag: "feito antes: tela de login", nivel_rigidez: 3, plano_antes: true,
    pendentes: ["build"], liberar: ["direction", "content", "qa"], max_paralelos: null,
    resolucao: { cli: "claude", modelo: "opus", conta: null, motivo: "perfil do membro (resolução direta)" }, ...extra,
  };
};
function missao(modo: Mission["modo"] = "squad"): Mission {
  return repos.mission.criar({ workspace_id: ws.id, modo, origem: "livre", titulo: "M" });
}
function pane(m: Mission, p: { piloto?: boolean; papel?: Pane["papel"]; cli?: string; agente_id?: string | null } = {}): Pane {
  return repos.pane.criar({ workspace_id: ws.id, mission_id: m.id, tipo: "cli", cli: p.cli ?? "claude", papel: p.papel ?? (p.piloto === true ? "piloto" : "executor"), eh_piloto: p.piloto === true, agente_id: p.agente_id ?? null });
}
const entrada = (m: Mission, p: Pane, contexto?: Record<string, unknown>): EntradaPreparoDePane =>
  ({ pane: p, pedido: { missao_id: m.id, cli: p.cli ?? "claude", ...(contexto === undefined ? {} : { contexto }) }, missao: m, workspace: ws, cwd: raiz, ferramenta: { id: p.cli ?? "claude" } }) as unknown as EntradaPreparoDePane;

describe("prepararPane: piloto = orquestrador da squad", () => {
  it("consome a intenção, vincula a Missão (mission_squad, squad_id, agentes, portões) e compõe base + papel + prompt do membro + rigor", async () => {
    const m = missao();
    const p = pane(m, { piloto: true });
    const i = intencao();
    motor.registrarIntencao(ws.id, i);
    const a = await motor.prepararPane(entrada(m, p));
    expect(a).not.toBeNull();
    // vínculo e auditoria
    expect(repos.missionSquad.exigir(m.id)).toMatchObject({ squad_slug: "eq", squad_hash: H, portoes_pendentes: ["build"], nivel_rigidez: 3, plano_antes: true });
    expect(repos.mission.exigir(m.id).squad_id).toBe("eq");
    expect(repos.squadExecucao.porMissao(m.id)?.id).toBe(i.execucao_id);
    expect(definidos).toEqual([{ mission: m.id, agentes: [{ agente_id: "eq.orq", papel: "piloto" }, { agente_id: "eq.impl", papel: "executor" }, { agente_id: "eq.rev", papel: "revisor" }] }]);
    expect(liberados.map((l) => l.portao).sort()).toEqual(["content", "direction", "qa"]);
    // instruções: base do piloto + papel + prompt do membro (variáveis renderizadas em blocos de dado) + rigor + regras inalteráveis
    const t = a!.instrucoes;
    expect(t).toContain("Você é o piloto");
    expect(t.indexOf("Você é o piloto")).toBeLessThan(t.indexOf("PROMPT-ORQ v1"));
    expect(t).toContain("Squad: Equipe Teste. Você é ORQ (orchestrator)");
    expect(t).toContain('<dado tipo="objetivo"');
    expect(t).toContain("Fazer o login");
    expect(t).toContain('<dado tipo="contexto_rag"');
    expect(t).toContain("feito antes: tela de login");
    expect(t).toContain("Rigor padrão");
    // Fase 7: o perfil do membro volta ao preparador para virar filtro REAL (o orquestrador do fixture só tem a lista dele)
    expect(a).toMatchObject({ skills_permitidas: expect.any(Array), mcps_permitidos: expect.any(Array) });
    // restrição imposta pelo gate no Claude: o prompt não repete a instrução textual "não use outras"
    expect(t).not.toContain("não use outras");
    expect(t).toContain("Elenco da squad");
    expect(t).not.toContain("PROMPT-IMPL"); // o orquestrador nunca vê o prompt dos outros
    expect(t.lastIndexOf("Regras inalteráveis")).toBeGreaterThan(t.indexOf("PROMPT-ORQ v1"));
    // perfil: modelo e esforço do membro no argv; sem prompt, sem flag de permissão
    expect(a!.argumentos).toEqual(["--model", "opus", "--effort", "high"]);
    expect(a!.argumentos.join(" ")).not.toContain("dangerously");
    // o Pane e a invocação ficam auditáveis
    expect(repos.pane.exigir(p.id)).toMatchObject({ agente_id: "eq.orq", modelo: "opus", esforco: "high" });
    const inv = repos.invocacaoAgente.listarPorMissao(m.id);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ agente_id: "eq.orq", pane_id: p.id, encerrada_em: null });
    expect(inv[0]!.perfil).toMatchObject({ cli: "claude", modelo: "opus", esforco: "high", esforco_modo: "flag", faixa: "topo" });
    expect(inv[0]!.prompt_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(eventos).toContainEqual({ tipo: "agent.invoked", payload: { invocation_id: a!.invocation_id, agente_id: "eq.orq", pane_id: p.id, mission_id: m.id } });
  });

  it("a intenção vale uma vez; sem intenção a Missão de squad segue como no MVP (null); modo livre e agêntico sem vínculo também", async () => {
    const m = missao();
    const p = pane(m, { piloto: true });
    expect(await motor.prepararPane(entrada(m, p))).toBeNull();
    motor.registrarIntencao(ws.id, intencao());
    expect(await motor.prepararPane(entrada(m, p))).not.toBeNull();
    const m2 = missao();
    expect(await motor.prepararPane(entrada(m2, pane(m2, { piloto: true })))).toBeNull(); // intenção já consumida
    const livre = missao("livre");
    expect(await motor.prepararPane(entrada(livre, pane(livre, { piloto: true })))).toBeNull();
    const ag = missao("agentico");
    motor.registrarIntencao(ws.id, intencao());
    expect(await motor.prepararPane(entrada(ag, pane(ag, { piloto: true })))).toBeNull(); // agêntico não consome intenção de squad
  });

  it("D-211: editar o .md depois da Missão criada vale na PRÓXIMA invocação (arquivo lido no instante do spawn)", async () => {
    const m = missao();
    motor.registrarIntencao(ws.id, intencao());
    await motor.prepararPane(entrada(m, pane(m, { piloto: true })));
    const l = await servico.lerPrompt("eq.impl");
    const g = await servico.gravarPrompt({ agent_id: "eq.impl", texto: "PROMPT-IMPL EDITADO card {{card}}", hash_esperado: l.hash });
    expect(g.ok).toBe(true);
    const w = pane(m, { papel: "executor" });
    const a = await motor.prepararPane(entrada(m, w, { card: { task_id: "tsk_1", task_ref: "t-1" }, agente: { agente_id: "eq.impl", resolucao: { cli: "claude", modelo: "sonnet", conta: null, motivo: "x" } } }));
    expect(a!.instrucoes).toContain("PROMPT-IMPL EDITADO card t-1");
    expect(a!.instrucoes).not.toContain("PROMPT-IMPL v1");
    expect(a!.instrucoes).toContain("Seu papel nesta squad"); // base do papel + papel na squad
    expect(a!.argumentos).toEqual(["--model", "sonnet", "--effort", "high"]);
    expect(repos.squadExecucao.porMissao(m.id)?.objetivo).toBe("Fazer o login");
    expect(repos.missionSquad.exigir(m.id).squad_hash).toBe(H); // a auditoria não muda com a edição
  });

  it("D-232: a permissão efetiva volta ao main (membro mais restrito vence o workspace automático; mais permissivo fica no teto do workspace)", async () => {
    const ag = (id: string) => ({ card: { task_id: "tsk_1", task_ref: "t-1" }, agente: { agente_id: id, resolucao: { cli: "claude", modelo: "sonnet", conta: null, motivo: "x" } } });
    const comImpl = (permissao: Membro["permissao"]) => squad({ membros: squad().membros.map((x) => (x.slug === "impl" ? { ...x, permissao } : x)) });
    const preparar = async (wsPerm: "seguro" | "automatico", doMembro: Membro["permissao"]) => {
      await gravarSquadNoDiretorio(join(usuario, "eq"), comImpl(doMembro), textos());
      await servico.recarregar();
      montar({ permissaoDoWorkspace: () => wsPerm });
      const m = missao();
      motor.registrarIntencao(ws.id, intencao());
      await motor.prepararPane(entrada(m, pane(m, { piloto: true })));
      return (await motor.prepararPane(entrada(m, pane(m, { papel: "executor" }), ag("eq.impl"))))!.permissao;
    };
    expect(await preparar("automatico", null)).toBe("automatico"); // sem permissão própria = a do workspace
    expect(await preparar("automatico", "seguro")).toBe("seguro"); // mais restrito vence
    expect(await preparar("seguro", "automatico")).toBe("seguro"); // mais permissivo: teto do workspace
  });

  it("prompt ausente/inválido → erro nominal, nenhuma invocação gravada e nenhum segredo no erro", async () => {
    const m = missao();
    motor.registrarIntencao(ws.id, intencao());
    await servico.carregar();
    writeFileSync(join(usuario, "eq", "membros", "orq.md"), serializarMembroMd({ papel: "orchestrator", rotulo: "orq" }, "usa API_KEY=abcdef123456789 aqui"));
    const loja = criarLoja({ pastaUsuario: usuario });
    servico = criarServicoSquads({ loja });
    await servico.carregar();
    montar();
    motor.registrarIntencao(ws.id, intencao());
    const p = pane(m, { piloto: true });
    const erro = await motor.prepararPane(entrada(m, p)).catch((e: unknown) => e);
    expect(erro).toMatchObject({ codigo: "prompt_invalido" });
    expect(String((erro as Error).message)).not.toContain("abcdef123456789");
    expect(repos.invocacaoAgente.listarPorMissao(m.id)).toHaveLength(0);
  });

  it("respawn do piloto (troca de conta): a invocação anterior termina e uma nova abre para o MESMO Pane", async () => {
    const m = missao();
    motor.registrarIntencao(ws.id, intencao());
    const p = pane(m, { piloto: true });
    const a = await motor.prepararPane(entrada(m, p));
    const b = await motor.prepararPane(entrada(m, repos.pane.exigir(p.id)));
    expect(b!.invocation_id).not.toBe(a!.invocation_id);
    const todas = repos.invocacaoAgente.listarPorMissao(m.id);
    expect(todas.filter((x) => x.encerrada_em === null)).toHaveLength(1);
  });
});

describe("ajustarSpawn: o perfil do membro manda", () => {
  const spawn = (extra: Partial<PedidoSpawn> = {}, m?: Mission): PedidoSpawn => ({
    workspace_id: ws.id, mission_id: (m ?? mis).id, pedido_por_pane_id: "pane_x", provedor: "gemini", modelo: "outro", conta_id: null,
    papel: "executor", agente_id: "eq.impl", briefing_path: null, cwd: null, ...extra,
  });
  let mis: Mission;
  beforeEach(async () => {
    mis = missao();
    motor.registrarIntencao(ws.id, intencao());
    await motor.prepararPane(entrada(mis, pane(mis, { piloto: true })));
  });

  it("troca provedor/modelo pelo perfil do membro (os informados são ignorados), zera o modelo do pedido e leva o perfil no contexto", async () => {
    const r = await motor.ajustarSpawn(spawn());
    expect(r.pedido).toMatchObject({ provedor: "claude", modelo: null, papel: "executor", agente_id: "eq.impl" });
    expect(r.contexto).toMatchObject({ agente: { agente_id: "eq.impl", resolucao: { cli: "claude", modelo: "sonnet" } } });
    const rev = await motor.ajustarSpawn(spawn({ agente_id: "eq.rev", papel: "executor" }));
    expect(rev.pedido).toMatchObject({ provedor: "codex", papel: "revisor" }); // o papel vem do membro, não do argumento
  });

  it("agente fora da squad, de outra squad, o orquestrador e id malformado → forbidden_role", async () => {
    for (const agente_id of ["eq.nao-existe", "outra.impl", "eq.orq", "lixo", "eq."]) {
      await expect(motor.ajustarSpawn(spawn({ agente_id })), agente_id).rejects.toMatchObject({ code: "rule_violation", subcode: "forbidden_role" });
    }
  });

  it("limites: por membro (2), por squad (3 com o orquestrador fora da conta) e CLI desabilitada → provider_disabled; encerrar libera a vaga", async () => {
    const abrir = async (agente_id: string): Promise<Pane> => {
      const r = await motor.ajustarSpawn(spawn({ agente_id }));
      const w = pane(mis, { papel: r.pedido.papel });
      await motor.prepararPane(entrada(mis, w, { card: { task_id: "t", task_ref: "t-1" }, ...(r.contexto ?? {}) }));
      return w;
    };
    const w1 = await abrir("eq.impl");
    await abrir("eq.impl");
    await expect(motor.ajustarSpawn(spawn())).rejects.toMatchObject({ subcode: "limit_reached" }); // membro cheio (2)
    const wRev = await abrir("eq.rev"); // 3º da squad
    await expect(motor.ajustarSpawn(spawn({ agente_id: "eq.rev" }))).rejects.toMatchObject({ subcode: "limit_reached" }); // membro (1) E squad (3)
    repos.pane.encerrar(w1.id, "fim");
    await abrir("eq.impl"); // a vaga voltou (sincronizarEncerradas)
    repos.pane.encerrar(wRev.id, "fim");
    habilitadas.delete("codex");
    await expect(motor.ajustarSpawn(spawn({ agente_id: "eq.rev" }))).rejects.toMatchObject({ subcode: "provider_disabled" });
  });

  it("max_paralelos pedido na caixa de prompt limita a squad abaixo do limite dela", async () => {
    const m = missao();
    motor.registrarIntencao(ws.id, intencao({ max_paralelos: 1 }));
    await motor.prepararPane(entrada(m, pane(m, { piloto: true })));
    const r = await motor.ajustarSpawn(spawn({ mission_id: m.id }));
    const w = pane(m, { papel: "executor" });
    await motor.prepararPane(entrada(m, w, { card: { task_id: "t", task_ref: "t-1" }, ...(r.contexto ?? {}) }));
    await expect(motor.ajustarSpawn(spawn({ mission_id: m.id, agente_id: "eq.rev" }))).rejects.toMatchObject({ subcode: "limit_reached" });
  });

  it("Missão sem squad vinculada, agente nulo ou fora de Missão: pedido intacto (MVP)", async () => {
    const solta = missao();
    const p = spawn({}, solta);
    expect((await motor.ajustarSpawn(p)).pedido).toBe(p);
    expect((await motor.ajustarSpawn(spawn({ agente_id: null }))).contexto).toBeNull();
    expect((await motor.ajustarSpawn(spawn({ mission_id: null }))).contexto).toBeNull();
  });

  it("aviso (não bloqueia) quando o revisor usa a mesma CLI de um executor ativo", async () => {
    habilitadas.add("claude");
    await servico.atualizarMembro({ agent_id: "eq.rev", hash_esperado: servico.listar()[0]!.hash, mudanca: { perfil: { cli: "claude", modelo: "opus", esforco: "alto", faixa: "alto" } } });
    const r = await motor.ajustarSpawn(spawn());
    const w = pane(mis, { papel: "executor", cli: "claude" });
    await motor.prepararPane(entrada(mis, w, { card: { task_id: "t", task_ref: "t-1" }, ...(r.contexto ?? {}) }));
    avisos.length = 0;
    await motor.ajustarSpawn(spawn({ agente_id: "eq.rev" }));
    expect(avisos.some((a) => a.includes("mesma CLI"))).toBe(true);
  });
});

describe("agent_list e agent_invoke", () => {
  let mis: Mission;
  let piloto: Pane;
  beforeEach(async () => {
    mis = missao();
    motor.registrarIntencao(ws.id, intencao());
    piloto = pane(mis, { piloto: true });
    await motor.prepararPane(entrada(mis, piloto));
  });
  const claims = () => ({ workspace_id: ws.id, mission_id: mis.id, pane_id: piloto.id, role: "piloto" as const, mode: "squad" as const });
  const info = (extra: Partial<Awaited<ReturnType<PortaMissoes["obter"]>> & object> = {}) => ({
    mission_id: mis.id, workspace_id: ws.id, modo: "squad" as const, estado: "planejando" as const, titulo: "M", piloto_pane_id: piloto.id,
    portoes_liberados: ["direction", "content", "build", "qa"] as const, agentes_do_squad: definidos[0]!.agentes, ...extra,
  });
  function portas(over: { liberados?: readonly ("direction" | "content" | "build" | "qa")[] } = {}) {
    const spawns: PedidoSpawn[] = [];
    const briefings: string[] = [];
    const p = {
      panes: {
        spawn: async (pedido: PedidoSpawn) => {
          spawns.push(pedido);
          const r = await motor.ajustarSpawn(pedido);
          const w = pane(mis, { papel: r.pedido.papel });
          await motor.prepararPane(entrada(mis, w, { card: { task_id: "t", task_ref: "t-9" }, ...(r.contexto ?? {}) }));
          return { pane_id: w.id };
        },
        listar: async () => [],
      } as unknown as PortaPanes,
      missoes: { obter: async () => info(over.liberados === undefined ? {} : { portoes_liberados: over.liberados }) } as unknown as PortaMissoes,
      provedores: { listar: async () => [{ provedor: "claude", cli: "claude", contas: [], habilitado: true }, { provedor: "codex", cli: "codex", contas: [], habilitado: true }] } as unknown as PortaProvedores,
      gravarBriefing: async (_m: string, _w: string, texto: string) => {
        briefings.push(texto);
        return ".x/missoes/m/briefing-t-9.md";
      },
    };
    return { p, spawns, briefings };
  }

  it("agent_list: só a squad da Missão, sem o orquestrador, sem texto de prompt, com in_flight; ≤ 4 KB", async () => {
    const l = motor.agentList(mis.id);
    expect(l.agents.map((a) => a.agent_id)).toEqual(["eq.impl", "eq.rev"]);
    expect(l.agents[0]).toEqual({ agent_id: "eq.impl", role: "executor", label: "IMPL", description: "faz impl", tier: "alto", max_instances: 2, in_flight: 0 });
    const json = JSON.stringify(l);
    expect(json).not.toContain("PROMPT-");
    expect(Buffer.byteLength(json)).toBeLessThan(4096);
    expect(() => motor.agentList(missao().id)).toThrow(ErroMcp);
    const { p } = portas();
    await motor.invocar(claims(), { agent_id: "eq.impl" }, p);
    expect(motor.agentList(mis.id).agents[0]?.in_flight).toBe(1);
  });

  it("agent_invoke: abre o terminal do membro com o perfil dele, grava o briefing do prompt e devolve pane_id + invocation_id", async () => {
    const { p, spawns, briefings } = portas();
    const r = await motor.invocar(claims(), { agent_id: "eq.impl", prompt: "Implemente a tela de login" }, p);
    expect(r.pane_id).toBeTruthy();
    expect(r.invocation_id).toMatch(/^inv_/);
    expect(spawns[0]).toMatchObject({ agente_id: "eq.impl", papel: "executor", briefing_path: ".x/missoes/m/briefing-t-9.md", mission_id: mis.id });
    expect(briefings[0]).toContain("## Contrato");
    expect(briefings[0]).toContain("Implemente a tela de login");
    expect(briefings[0]).toContain("## Executado_por");
    expect(repos.invocacaoAgente.listarPorMissao(mis.id).map((i) => i.agente_id)).toEqual(["eq.orq", "eq.impl"]);
  });

  it("ordem das regras: gate_pending, forbidden_role (worker chamando, orquestrador, fora da squad), limit_reached, prompt grande", async () => {
    const { p } = portas({ liberados: ["direction", "qa"] }); // build pendente
    await expect(motor.invocar(claims(), { agent_id: "eq.impl" }, p)).rejects.toMatchObject({ subcode: "gate_pending" });
    const livre = portas();
    await expect(motor.invocar({ ...claims(), role: "executor" }, { agent_id: "eq.impl" }, livre.p)).rejects.toMatchObject({ subcode: "forbidden_role" }); // chamador não é piloto
    await expect(motor.invocar(claims(), { agent_id: "eq.orq" }, livre.p)).rejects.toMatchObject({ subcode: "forbidden_role" });
    await expect(motor.invocar(claims(), { agent_id: "eq.fantasma" }, livre.p)).rejects.toMatchObject({ subcode: "forbidden_role" });
    await expect(motor.invocar(claims(), { agent_id: "eq.impl", prompt: "x".repeat(4001) }, livre.p)).rejects.toMatchObject({ code: "invalid_argument" });
    await motor.invocar(claims(), { agent_id: "eq.rev" }, livre.p);
    await expect(motor.invocar(claims(), { agent_id: "eq.rev" }, livre.p)).rejects.toMatchObject({ subcode: "limit_reached" });
    await expect(motor.invocar({ ...claims(), mission_id: null }, { agent_id: "eq.impl" }, livre.p)).rejects.toMatchObject({ subcode: "not_in_mission" });
    await expect(motor.invocar({ ...claims(), mission_id: missao().id }, { agent_id: "eq.impl" }, livre.p)).rejects.toMatchObject({ subcode: "forbidden_role" }); // sem squad
  });
});

describe("Fase 9 × Fase 14: respawn e troca de conta (harness-mover) NÃO fazem o agente perder o perfil, o prompt nem a restrição de permissão", () => {
  async function vincular(): Promise<{ m: Mission; orq: Pane }> {
    const m = missao();
    const orq = pane(m, { piloto: true });
    motor.registrarIntencao(ws.id, intencao());
    await motor.prepararPane(entrada(m, orq));
    return { m, orq };
  }
  const entradaDeRespawn = (m: Mission, novo: Pane, antigo: Pane, extra: Record<string, unknown> = {}): EntradaPreparoDePane =>
    ({ pane: novo, pedido: { missao_id: m.id, cli: novo.cli ?? "claude", respawn_de: antigo.id, contexto: { card: { task_ref: "t-9" } }, ...extra }, missao: m, workspace: ws, cwd: raiz, ferramenta: { id: novo.cli ?? "claude" } }) as unknown as EntradaPreparoDePane;

  it("worker de agente com respawn_de: herda o agente do Pane antigo (prompt do membro, permissão do membro, invocação auditável)", async () => {
    const hash = servico.listar().find((r) => r.slug === "eq")!.hash;
    const g = await servico.gravar({ squad: squad({ membros: squad().membros.map((x) => (x.slug === "impl" ? { ...x, permissao: "seguro" as const } : x)) }), hash_esperado: hash });
    expect(g.ok).toBe(true);
    montar({ permissaoDoWorkspace: () => "automatico" }); // workspace automático; o membro é 'seguro'
    const { m } = await vincular();
    const antigo = pane(m, { agente_id: "eq.impl" });
    repos.pane.encerrar(antigo.id, "superseded");
    const novo = pane(m, { agente_id: null }); // o serviço de Panes cria o novo SEM agente
    const a = await motor.prepararPane(entradaDeRespawn(m, novo, antigo));
    expect(a).not.toBeNull();
    expect(a!.agente_id).toBe("eq.impl");
    expect(a!.instrucoes).toContain("PROMPT-IMPL");
    expect(a!.permissao).toBe("seguro"); // a restrição do membro sobrevive ao respawn (sem isto o Pane novo herdaria o automático do workspace)
    expect(repos.pane.exigir(novo.id).agente_id).toBe("eq.impl");
    expect(repos.invocacaoAgente.listarPorMissao(m.id).some((i) => i.pane_id === novo.id && i.agente_id === "eq.impl")).toBe(true);
  });

  it("troca para outra CLI/modelo: valem o modelo e a CLI DO PEDIDO (decididos pelo harness), nunca o modelo nominal do membro na CLI errada", async () => {
    const { m } = await vincular();
    const antigo = pane(m, { agente_id: "eq.impl" });
    repos.pane.encerrar(antigo.id, "superseded");
    const novo = pane(m, { cli: "codex", agente_id: null });
    const a = await motor.prepararPane(entradaDeRespawn(m, novo, antigo, { cli: "codex", modelo: "gpt-5", esforco: "medium" }));
    expect(a).not.toBeNull();
    expect(a!.argumentos.join(" ")).toContain("gpt-5");
    expect(a!.argumentos.join(" ")).not.toContain("sonnet");
    expect(repos.pane.exigir(novo.id)).toMatchObject({ agente_id: "eq.impl", modelo: "gpt-5" });
  });

  it("respawn_de de OUTRA Missão ou de Pane sem agente não concede agente nenhum (nada herdado em silêncio)", async () => {
    const { m } = await vincular();
    const outra = missao();
    const alheio = pane(outra, { agente_id: "eq.impl" });
    const novo = pane(m, { agente_id: null });
    expect(await motor.prepararPane(entradaDeRespawn(m, novo, alheio))).toBeNull();
    const semAgente = pane(m, { agente_id: null });
    const novo2 = pane(m, { agente_id: null });
    expect(await motor.prepararPane(entradaDeRespawn(m, novo2, semAgente))).toBeNull();
  });

  it("agente de squad grava pane_rota com o perfil EFETIVO (a troca por consumo enxerga o que de fato roda)", async () => {
    const { m } = await vincular();
    const w = pane(m, { agente_id: "eq.impl" });
    await motor.prepararPane({ pane: w, pedido: { missao_id: m.id, cli: "claude", contexto: { agente: { agente_id: "eq.impl", resolucao: { cli: "claude", modelo: "sonnet", conta: null, motivo: "x" } }, card: { task_ref: "t-1" } } }, missao: m, workspace: ws, cwd: raiz, ferramenta: { id: "claude" } } as unknown as EntradaPreparoDePane);
    expect(repos.paneRota.obter(w.id)?.perfil).toMatchObject({ agente_id: "eq.impl", cli: "claude", modelo: "sonnet" });
  });
});

describe("auditoria: limites sob concorrência (o orquestrador pode emitir várias chamadas de uma vez)", () => {
  const spawn = (extra: Partial<PedidoSpawn> = {}, m: Mission): PedidoSpawn => ({
    workspace_id: ws.id, mission_id: m.id, pedido_por_pane_id: "pane_x", provedor: "claude", modelo: null, conta_id: null,
    papel: "executor", agente_id: "eq.impl", briefing_path: null, cwd: null, ...extra,
  });
  async function mis(): Promise<Mission> {
    const m = missao();
    motor.registrarIntencao(ws.id, intencao());
    await motor.prepararPane(entrada(m, pane(m, { piloto: true })));
    return m;
  }
  /** o caminho real: ajustarSpawn (confere limites) → Pane novo → prepararPane (registra a invocação) */
  async function invocar(m: Mission, agente_id = "eq.impl"): Promise<void> {
    const r = await motor.ajustarSpawn(spawn({ agente_id }, m));
    const w = pane(m, { papel: r.pedido.papel });
    await motor.prepararPane(entrada(m, w, { card: { task_id: "t", task_ref: "t-1" }, ...(r.contexto ?? {}) }));
  }

  it("5 invocações simultâneas do membro com max_instancias=2: só 2 passam, 3 voltam limit_reached (sem estourar o limite)", async () => {
    const m = await mis();
    const r = await Promise.allSettled([1, 2, 3, 4, 5].map(() => invocar(m)));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(2);
    for (const x of r.filter((y) => y.status === "rejected")) expect((x as PromiseRejectedResult).reason).toMatchObject({ subcode: "limit_reached" });
    expect(repos.invocacaoAgente.listarPorMissao(m.id).filter((i) => i.agente_id === "eq.impl" && i.encerrada_em === null)).toHaveLength(2);
  });

  it("limite da squad (3 terminais) vale entre membros diferentes em paralelo", async () => {
    const m = await mis();
    const r = await Promise.allSettled([invocar(m, "eq.impl"), invocar(m, "eq.impl"), invocar(m, "eq.rev"), invocar(m, "eq.rev"), invocar(m, "eq.impl")]);
    const abertas = repos.invocacaoAgente.listarPorMissao(m.id).filter((i) => i.agente_id !== "eq.orq" && i.encerrada_em === null);
    expect(abertas.length).toBeLessThanOrEqual(3);
    expect(r.filter((x) => x.status === "fulfilled").length).toBe(abertas.length);
  });

  it("falha depois da reserva (provedor desabilitado) não prende a vaga", async () => {
    const m = await mis();
    habilitadas = new Set(["codex"]);
    await expect(invocar(m)).rejects.toMatchObject({ subcode: "provider_disabled" });
    habilitadas = new Set(["claude", "codex"]);
    await invocar(m);
    await invocar(m);
    await expect(invocar(m)).rejects.toMatchObject({ subcode: "limit_reached" });
  });

  it("reserva órfã (spawn que nunca chegou ao preparo) expira sozinha, devolvendo a vaga", async () => {
    let agoraMs = Date.parse("2026-10-01T12:00:00Z");
    montar({ agora: () => new Date(agoraMs) });
    const m = await mis();
    await motor.ajustarSpawn(spawn({}, m));
    await motor.ajustarSpawn(spawn({}, m)); // 2 reservas, nenhum preparo
    await expect(motor.ajustarSpawn(spawn({}, m))).rejects.toMatchObject({ subcode: "limit_reached" });
    agoraMs += 61_000;
    await expect(motor.ajustarSpawn(spawn({}, m))).resolves.toBeDefined();
  });
});
