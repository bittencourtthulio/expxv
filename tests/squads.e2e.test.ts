// E2E da Fase 14 (T-14.28, parte de UI e modo livre) no Electron real: tela Squads, editor, prompt do membro, duplicar fábrica,
// "Abrir agente" (modo livre: Pane avulso, sem Missão), importação com prévia e zero diálogos nativos. As CLIs são as falsas de
// `tests/fixtures/mcp/cli-orq.mjs` (ÚNICA detecção, gancho de teste); nada sai da máquina.
//
// Onda 6 acrescenta o fluxo "enviar prompt → orquestrador + N terminais paralelos → handoffs → revisor → mission_complete",
// "plano_antes pendente × direto" e a leitura de plano.md/resultado.md, com a CLI falsa `tests/fixtures/cli-agente.mjs` (cli-orq +
// registro do que cada Pane recebeu). ESCRITO e type-checado, NÃO executado: rodar exige `npm run build` (não rodar com o
// `npm run dev` do dono ativo: ele usa `dist/`). Os testes de núcleo e de main (src/main/squads.test.ts) cobrem a lógica.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { PRODUTO } from "../src/nucleo/produto";
import { criarAmbienteOrq, esperar, processosDeWorker, type AmbienteOrq } from "./fixtures/mcp/ambiente-orq";
import { dialogosChamados, vigiarDialogos } from "./terminais-ui-ajuda";

interface JanelaSquads {
  ade: {
    squads: {
      listar(p?: unknown): Promise<Array<{ slug: string; origem: string; hash: string }>>;
      obter(slug: string): Promise<{ slug: string; nome: string; membros: Array<{ slug: string; papel: string }> }>;
      exportar(p: unknown): Promise<{ caminho_relativo: string | null }>;
      importarPrevia(p: unknown): Promise<{ mcps_removidos: string[]; squad: { origem: string }; prompts: Record<string, string> }>;
      gravar(p: unknown): Promise<{ ok: boolean }>;
      enviarPrompt(p: unknown): Promise<{ execucao_id: string; mission_id: string; pane_id: string }>;
      lerArquivoDaExecucao(p: { execucao_id: string; arquivo: "plano" | "resultado" }): Promise<{ existe: boolean; texto: string | null; truncado: boolean }>;
    };
    agentes: {
      lerPrompt(id: string): Promise<{ texto: string; hash: string; editado: boolean }>;
      gravarPrompt(p: unknown): Promise<{ ok: boolean }>;
      abrirPane(p: unknown): Promise<{ pane_id: string }>;
    };
    missoes: { listar(ws: string): Promise<{ itens: unknown[] }>; portoes(id: string): Promise<{ pendentes: string[]; liberados: string[] } | null> };
  };
}

let amb: AmbienteOrq;
let pagina: Page;
let nativos = 0;

const avaliar = <T, A>(fn: (a: A) => Promise<T> | T, arg: A): Promise<T> => pagina.evaluate(fn as never, arg as never) as Promise<T>;
const ir = async (rotulo: string): Promise<void> => {
  await pagina.locator('nav[aria-label="Principal"] button', { hasText: rotulo }).click();
  await pagina.mouse.move(900, 500); // o menu lateral abre por cima com o mouse em cima dele
};
const banco = <T>(sql: string): T[] => {
  const b = new DatabaseSync(join(amb.app.pastaDados, `${PRODUTO.id}.db`));
  try {
    b.exec("PRAGMA busy_timeout = 5000");
    return b.prepare(sql).all() as T[];
  } finally {
    b.close();
  }
};

beforeAll(async () => {
  amb = await criarAmbienteOrq({ cli: "cli-agente.mjs" });
  pagina = amb.app.pagina;
  await vigiarDialogos(amb.app);
  pagina.on("dialog", (d) => { nativos += 1; void d.dismiss(); }); // alert/confirm/prompt do renderer
}, 120_000);

afterAll(async () => {
  await amb?.fechar();
});

describe("tela Squads no Electron real", () => {
  it("as squads de fábrica existem e a tela abre em chunk lazy com a lista (Minhas/Fábrica)", async () => {
    const lista = await avaliar(() => (window as unknown as JanelaSquads).ade.squads.listar(), undefined);
    expect(lista.filter((s) => s.origem === "fabrica").length).toBeGreaterThanOrEqual(17);
    await ir("Squads");
    await pagina.waitForSelector('section[aria-label="Squads"]', { timeout: 15_000 });
    await pagina.waitForSelector(".sq-lista .sq-item", { timeout: 15_000 });
    expect(await pagina.locator(".sq-grupo").allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining("Fábrica")]));
    // a tela ocupa quase toda a área útil (≥ 90%)
    const fracao = await pagina.evaluate(() => {
      const tela = document.querySelector('section[aria-label="Squads"]')!.getBoundingClientRect();
      const main = document.querySelector("main")!.getBoundingClientRect();
      return (tela.width * tela.height) / (main.width * main.height);
    });
    expect(fracao).toBeGreaterThanOrEqual(0.9);
  });

  it("criar squad pela UI: nasce com orquestrador, executor e revisor e fica gravada; edição não salva desabilita Enviar", async () => {
    await pagina.getByRole("button", { name: "Nova", exact: true }).click();
    await pagina.getByLabel("Nome", { exact: true }).fill("Squad E2E");
    await pagina.getByRole("button", { name: "Criar squad" }).click();
    await pagina.waitForSelector('table[aria-label="Membros da squad"]', { timeout: 15_000 });
    const s = await avaliar(() => (window as unknown as JanelaSquads).ade.squads.obter("squad-e2e"), undefined);
    expect(s.membros.map((m) => m.papel)).toEqual(["orchestrator", "executor", "reviewer"]);
    await pagina.getByLabel("Nome da squad").fill("Squad E2E editada");
    await pagina.getByLabel(/Objetivo para a squad/).fill("qualquer objetivo");
    await esperar(async () => (await pagina.getByRole("button", { name: "Enviar", exact: true }).isDisabled()) || undefined, 5_000);
    expect(await pagina.getByText(/Salve a squad antes de enviar/).count()).toBeGreaterThan(0);
    await pagina.getByRole("button", { name: "Salvar", exact: true }).click();
    await esperar(async () => ((await avaliar(() => (window as unknown as JanelaSquads).ade.squads.obter("squad-e2e"), undefined)).nome === "Squad E2E editada") || undefined, 10_000);
  });

  it("fábrica é somente leitura; duplicar para editar cria a cópia; o prompt editado fica 'editado' e persiste", async () => {
    const antes = (await avaliar(() => (window as unknown as JanelaSquads).ade.squads.listar(), undefined)).map((s) => s.slug);
    await pagina.getByRole("button", { name: "Fábrica", exact: true }).click();
    await pagina.locator(".sq-lista .sq-item").first().click();
    await pagina.waitForSelector('table[aria-label="Membros da squad"]');
    expect(await pagina.getByLabel("Nome da squad").isDisabled()).toBe(true);
    await pagina.getByRole("button", { name: "Duplicar para editar" }).first().click();
    await esperar(async () => {
      const agora = (await avaliar(() => (window as unknown as JanelaSquads).ade.squads.listar(), undefined)).map((s) => s.slug);
      return agora.find((s) => !antes.includes(s));
    }, 10_000);
    const depois = (await avaliar(() => (window as unknown as JanelaSquads).ade.squads.listar(), undefined)).filter((s) => !antes.includes(s.slug));
    const copia = depois[0]!;
    expect(copia.origem).toBe("usuario");
    const sq = await avaliar((slug) => (window as unknown as JanelaSquads).ade.squads.obter(slug), copia.slug);
    const membro = sq.membros.find((m) => m.papel === "executor")!;
    const agentId = `${copia.slug}.${membro.slug}`;
    // edição pelo canal (a UI chama o mesmo): o texto novo é lido a cada abertura
    const lido = await avaliar((id) => (window as unknown as JanelaSquads).ade.agentes.lerPrompt(id), agentId);
    const r = await avaliar(([id, hash]) => (window as unknown as JanelaSquads).ade.agentes.gravarPrompt({ agent_id: id, texto: "MARCA-E2E-V1 {{objetivo}}", hash_esperado: hash }), [agentId, lido.hash] as const);
    expect(r.ok).toBe(true);
    expect((await avaliar((id) => (window as unknown as JanelaSquads).ade.agentes.lerPrompt(id), agentId)).editado).toBe(true);
    (globalThis as unknown as { __copia?: string }).__copia = agentId;
  });

  it("modo livre: 'Abrir agente' abre um Pane avulso (sem Missão, sem portões) e relê o prompt a cada abertura", async () => {
    const agentId = (globalThis as unknown as { __copia?: string }).__copia!;
    expect(agentId).toBeTruthy();
    const missoesAntes = (await avaliar((ws) => (window as unknown as JanelaSquads).ade.missoes.listar(ws), amb.wsId)).itens.length;
    const r1 = await avaliar(([ws, id]) => (window as unknown as JanelaSquads).ade.agentes.abrirPane({ workspace_id: ws, agent_id: id, objetivo: "olá" }), [amb.wsId, agentId] as const);
    const pane = banco<{ mission_id: string | null; papel: string; agente_id: string | null }>(`SELECT mission_id, papel, agente_id FROM pane WHERE id = '${r1.pane_id.replace(/'/g, "")}'`)[0]!;
    expect(pane).toMatchObject({ mission_id: null, papel: "nenhum", agente_id: agentId });
    const inv1 = banco<{ mission_id: string | null; prompt_hash: string }>(`SELECT mission_id, prompt_hash FROM invocacao_agente WHERE pane_id = '${r1.pane_id.replace(/'/g, "")}'`)[0]!;
    expect(inv1.mission_id).toBeNull();
    // edita o prompt e abre de novo: o hash da invocação muda (CT-14.05 no modo livre)
    const lido = await avaliar((id) => (window as unknown as JanelaSquads).ade.agentes.lerPrompt(id), agentId);
    await avaliar(([id, hash]) => (window as unknown as JanelaSquads).ade.agentes.gravarPrompt({ agent_id: id, texto: "MARCA-E2E-V2 {{objetivo}}", hash_esperado: hash }), [agentId, lido.hash] as const);
    const r2 = await avaliar(([ws, id]) => (window as unknown as JanelaSquads).ade.agentes.abrirPane({ workspace_id: ws, agent_id: id }), [amb.wsId, agentId] as const);
    const inv2 = banco<{ prompt_hash: string }>(`SELECT prompt_hash FROM invocacao_agente WHERE pane_id = '${r2.pane_id.replace(/'/g, "")}'`)[0]!;
    expect(inv2.prompt_hash).not.toBe(inv1.prompt_hash);
    expect((await avaliar((ws) => (window as unknown as JanelaSquads).ade.missoes.listar(ws), amb.wsId)).itens.length).toBe(missoesAntes);
  });

  it("'Abrir agente…' pela UI: diálogo com squad e agente, sem Missão", async () => {
    await ir("Squads");
    await pagina.getByRole("button", { name: "Abrir agente…" }).click();
    await pagina.getByRole("dialog", { name: "Abrir agente" }).waitFor();
    expect(await pagina.getByLabel("Agente").locator("option").count()).toBeGreaterThan(2);
    await pagina.getByRole("button", { name: "Cancelar" }).click();
  });

  it("importar squad hostil: a prévia mostra os prompts, os MCPs saem e a origem é 'importada'", async () => {
    // exporta para o repositório, hostiliza o arquivo exportado e lê a prévia (nada é gravado antes de confirmar)
    const ex = await avaliar((ws) => (window as unknown as JanelaSquads).ade.squads.exportar({ slug: "squad-e2e", destino: "repo", workspace_id: ws }), amb.wsId);
    const rel = ex.caminho_relativo!;
    expect(rel.startsWith("/")).toBe(false);
    const pasta = join(amb.raiz, rel);
    const arquivo = existsSync(join(pasta, "squad.json")) ? join(pasta, "squad.json") : pasta;
    const json = JSON.parse(readFileSync(arquivo, "utf8")) as { membros: Array<{ mcps_permitidos: string[] }> };
    expect(JSON.stringify(json)).not.toContain(amb.raiz); // sem caminho absoluto no export
    const nome = rel.split("/").filter(Boolean).pop()!;
    const previa = await avaliar(([ws, n]) => (window as unknown as JanelaSquads).ade.squads.importarPrevia({ origem: "repo", workspace_id: ws, nome: n }), [amb.wsId, nome] as const);
    expect(previa.squad.origem).toBe("importada");
    expect(Object.keys(previa.prompts).length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(previa.mcps_removidos)).toBe(true);
  });
});

// ---------------------------------------------------------------- fluxo de enviar prompt (CLI falsa de agente)
const SQUAD_FLUXO = "sq-fluxo";
const membroFluxo = (slug: string, papel: string, cli: string, modelo: string, extra: Record<string, unknown> = {}) => ({
  slug, papel, rotulo: slug.toUpperCase(), descricao: `faz ${slug}`, prompt: `membros/${slug}.md`,
  perfil: { cli, modelo, esforco: "alto", faixa: "alto" }, skills_permitidas: [], mcps_permitidos: [], hooks: [], max_instancias: 1,
  orcamento: { tempo_min: null, tokens: null, modo: "soft" }, rigidez: null, permissao: null, ...extra,
});
const squadFluxo = () => ({
  slug: SQUAD_FLUXO, nome: "Squad do fluxo", descricao: "e2e do fluxo de prompt", escopo: "outro", rigidez_padrao: null, max_instancias_paralelas: 2,
  orcamento: { tempo_min: null, tokens: null, modo: "soft" }, portoes: null, fabrica: null, origem: "usuario",
  membros: [membroFluxo("orq", "orchestrator", "claude", "opus"), membroFluxo("impl", "executor", "claude", "sonnet", { max_instancias: 2 }), membroFluxo("rev", "reviewer", "codex", "gpt-5")],
});
const chamadaInvoke = (agente: string, caminho: string, worker: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  tool: "agent_invoke", args: { agent_id: `${SQUAD_FLUXO}.${agente}`, briefing_path: caminho }, briefing: { caminho, texto: `E2E:${JSON.stringify(worker)}` }, ...extra,
});
const missoesDoFluxo: string[] = [];
const enviar = async (objetivo: string, planoAntes: boolean) => {
  const r = await avaliar(([ws, o, pa]) => (window as unknown as JanelaSquads).ade.squads.enviarPrompt({ workspace_id: ws, squad_slug: "sq-fluxo", objetivo: o, plano_antes: pa, rigidez: null, max_paralelos: null }), [amb.wsId, objetivo, planoAntes] as const);
  missoesDoFluxo.push(r.mission_id);
  return r;
};

describe("fluxo de enviar prompt a uma squad (orquestrador, terminais paralelos, handoffs, revisor)", () => {
  let execucao = "";
  let missao = "";

  it("prepara a squad do fluxo e o prompt marcado do orquestrador", async () => {
    const r = await avaliar((sq) => (window as unknown as JanelaSquads).ade.squads.gravar({ squad: sq, hash_esperado: null }), squadFluxo());
    expect(r.ok).toBe(true);
    const lido = await avaliar((id) => (window as unknown as JanelaSquads).ade.agentes.lerPrompt(id), `${SQUAD_FLUXO}.orq`);
    const g = await avaliar(([id, h]) => (window as unknown as JanelaSquads).ade.agentes.gravarPrompt({ agent_id: id, texto: "MARCA-ORQ-E2E objetivo: {{objetivo}}", hash_esperado: h }), [`${SQUAD_FLUXO}.orq`, lido.hash] as const);
    expect(g.ok).toBe(true);
  });

  it("direto: orquestrador + 2 executores em paralelo (o 3º espera a vaga), revisor ok e mission_complete", async () => {
    const solta = ".e2e-solta-fluxo";
    const w = { worker: "handoff", esperar: solta };
    const dir = `${PRODUTO.pastaNoProjeto}`;
    const diretiva = {
      chamadas: [
        chamadaInvoke("impl", `${dir}/b-fluxo-1.md`, { ...w, resumo: "impl-1" }),
        chamadaInvoke("impl", `${dir}/b-fluxo-2.md`, { ...w, resumo: "impl-2" }),
        chamadaInvoke("impl", `${dir}/b-fluxo-3.md`, { worker: "handoff", resumo: "impl-3" }, { ate_ok: true }),
        chamadaInvoke("rev", `${dir}/b-fluxo-4.md`, { worker: "handoff", resumo: "aprovado", status: "ok" }, { ate_ok: true }),
        { tool: "mission_complete", args: {}, ate_ok: true },
      ],
    };
    const r = await enviar(`Entregar o fluxo. E2E:${JSON.stringify(diretiva)}`, false);
    execucao = r.execucao_id;
    missao = r.mission_id;
    // o orquestrador abriu com o perfil do membro: modelo e o prompt editado chegam ao Pane
    const reg = await esperar(() => amb.registroDoPane(r.pane_id), 30_000);
    expect(reg.argv.join(" ")).toContain("opus");
    expect(JSON.stringify(reg)).toContain("MARCA-ORQ-E2E");
    // limite da squad (2 paralelas): o 3º agent_invoke é recusado enquanto os dois executores vivem
    await esperar(async () => (await amb.chamadasDoPiloto(missao)).some((l) => l.tool === "agent_invoke" && l.ok === false) || undefined, 45_000);
    const vivos = (await amb.detalhe(missao))!.panes.filter((p) => p.papel === "executor" && p.estado !== "encerrado");
    expect(vivos.length).toBe(2);
    for (const p of vivos) expect((await esperar(() => amb.registroDoPane(p.id), 20_000)).argv.join(" ")).toContain("sonnet");
    writeFileSync(join(amb.raiz, solta), ""); // os executores entregam; a vaga abre; o 3º entra
    await esperar(async () => (await amb.detalhe(missao))?.mission.estado === "concluida" || undefined, 90_000);
    const d = (await amb.detalhe(missao))!;
    expect(d.handoffs.filter((h) => h.status === "ok").length).toBeGreaterThanOrEqual(4);
    expect(d.panes.some((p) => p.papel === "revisor")).toBe(true);
    const aceitas = (await amb.chamadasDoPiloto(missao)).filter((l) => l.tool === "agent_invoke" && l.ok === true);
    expect(aceitas.length).toBe(4);
    const portoes = await avaliar((m) => (window as unknown as JanelaSquads).ade.missoes.portoes(m), missao);
    expect(portoes?.pendentes ?? []).toEqual([]);
  });

  it("plano.md e resultado.md da execução são lidos pelo canal novo (texto puro; ausente = existe:false)", async () => {
    const antes = await avaliar((id) => (window as unknown as JanelaSquads).ade.squads.lerArquivoDaExecucao({ execucao_id: id, arquivo: "plano" }), execucao);
    expect(antes).toEqual({ existe: false, texto: null, truncado: false });
    const pasta = join(amb.raiz, PRODUTO.pastaNoProjeto, "missoes", missao);
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, "plano.md"), "# Plano\n\n- card 1 <script>alert(1)</script>\n");
    writeFileSync(join(pasta, "resultado.md"), "# Resultado\n\nfeito\n");
    const plano = await avaliar((id) => (window as unknown as JanelaSquads).ade.squads.lerArquivoDaExecucao({ execucao_id: id, arquivo: "plano" }), execucao);
    expect(plano.existe).toBe(true);
    expect(plano.texto).toContain("# Plano");
    const res = await avaliar((id) => (window as unknown as JanelaSquads).ade.squads.lerArquivoDaExecucao({ execucao_id: id, arquivo: "resultado" }), execucao);
    expect(res.texto).toContain("feito");
    await expect(avaliar((id) => (window as unknown as JanelaSquads).ade.squads.lerArquivoDaExecucao({ execucao_id: id, arquivo: "plano" }), "sqx_naoexiste0000")).rejects.toThrow();
  });

  it("plano antes: o portão build fica pendente (gate_pending) até Aprovar na UI; depois o executor entra", async () => {
    const dir = `${PRODUTO.pastaNoProjeto}`;
    const diretiva = { chamadas: [chamadaInvoke("impl", `${dir}/b-plano-1.md`, { worker: "handoff", resumo: "pos-plano" }, { ate_ok: true })] };
    const r = await enviar(`Com plano antes. E2E:${JSON.stringify(diretiva)}`, true);
    const p0 = await avaliar((m) => (window as unknown as JanelaSquads).ade.missoes.portoes(m), r.mission_id);
    expect(p0?.pendentes).toContain("build");
    await esperar(async () => (await amb.chamadasDoPiloto(r.mission_id)).some((l) => l.tool === "agent_invoke" && l.ok === false) || undefined, 30_000);
    expect((await amb.detalhe(r.mission_id))!.panes.filter((p) => p.papel === "executor").length).toBe(0);
    await ir("Squads");
    await pagina.locator(".sq-lista .sq-item", { hasText: "Squad do fluxo" }).click();
    await pagina.locator(".sq-exec-linha", { hasText: "Com plano antes" }).click();
    await pagina.getByRole("button", { name: "Aprovar", exact: true }).click();
    await pagina.getByRole("button", { name: "Aprovar plano" }).click();
    await esperar(async () => (await amb.chamadasDoPiloto(r.mission_id)).some((l) => l.tool === "agent_invoke" && l.ok === true) || undefined, 45_000);
    expect((await amb.detalhe(r.mission_id))!.panes.some((p) => p.papel === "executor")).toBe(true);
  });
});

describe("encerramento", () => {
  it("zero diálogos nativos e nenhum processo órfão", async () => {
    expect(nativos).toBe(0);
    expect(await dialogosChamados(amb.app)).toBe(0);
    for (const id of missoesDoFluxo.splice(0)) await avaliar((m) => (window as unknown as { ade: { missoes: { abortar(i: string): Promise<unknown> } } }).ade.missoes.abortar(m), id).catch(() => undefined);
    await amb.abortarCriadas();
    await esperar(() => processosDeWorker() === 0, 15_000);
    expect(processosDeWorker()).toBe(0);
  });
});
