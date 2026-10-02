// Canal do prompt de orquestrador por CLI (D-510 a D-513): tabela do que o comando de lançamento de CADA CLI leva (canal de instrução + proibições) e honestidade das garantias.
import { describe, expect, it } from "vitest";
import { garantiasDaCli, CLIS_QUE_ORQUESTRAM } from "../../compartilhado/orquestrador";
import { LIMITES_PAINEL_LIVRE } from "../../compartilhado/painel-livre";
import { PRODUTO } from "../produto";
import { canalDoOrquestrador, EDICAO_NEGADA_CLAUDE, instrucaoDeReserva, instrucoesDoOrquestrador, nomeDoPromptDoOrquestrador, SUBAGENTE_NEGADO_CLAUDE } from "./canal-orquestrador";
import { carregarPrompt } from "./prompts";

const ARQ = "/app/panes/pane_x/instrucoes.md";
const base = { instrucoes: "PROMPT-ORQ", arquivoInstrucoes: ARQ, orquestradorEdita: false, permissao: "seguro" as const };

describe("prompt do orquestrador (versionado e editável)", () => {
  it("os dois arquivos existem, são versionados e dizem o essencial: delegar, pane_spawn em paralelo, nunca subagentes internos, dado não confiável, sem segredo", async () => {
    for (const nome of ["orquestrador", "orquestrador.en"] as const) {
      const p = await carregarPrompt(nome);
      expect(p.versao).toBeGreaterThanOrEqual(1);
      const t = instrucoesDoOrquestrador({ cli: nome === "orquestrador" ? "claude" : "codex", prompt: p, orquestradorEdita: false });
      for (const termo of ["pane_spawn", "pane_list", "pane_read", "pane_send"]) expect(t).toContain(termo);
      expect(t).toMatch(/PARALELO|PARALLEL/);
      expect(t).toContain(PRODUTO.id);
      expect(t).toContain(String(LIMITES_PAINEL_LIVRE.workers_por_painel));
      expect(t).not.toMatch(/\{\{[A-Z_]+\}\}/);
      expect(Buffer.byteLength(t)).toBeLessThan(3_000); // cabe no argumento sem virar arquivo
      expect(t).toMatch(/subagent/i);
      expect(t).toMatch(/(não confiável|untrusted)/i);
    }
  });
  it("D-520: manda ler o relatório/saída ANTES de fechar, fechar só quando terminou, não fechar quem trabalha e decidir sobre falha pela cauda (prompts e reserva)", async () => {
    for (const nome of ["orquestrador", "orquestrador.en"] as const) {
      const t = instrucoesDoOrquestrador({ cli: nome === "orquestrador" ? "claude" : "codex", prompt: await carregarPrompt(nome), orquestradorEdita: false });
      for (const termo of ["handoff_read", "pane_close", "failed"]) expect(t).toContain(termo);
      expect(t).toMatch(/ANTES|BEFORE/);
      expect(t).toMatch(/NUNCA feche painel que ainda trabalha|NEVER close a pane that is still working/);
    }
    for (const cli of ["claude", "codex"]) {
      const t = instrucoesDoOrquestrador({ cli, prompt: null, orquestradorEdita: false });
      expect(t).toContain("handoff_read");
      expect(t).toContain("pane_close");
      expect(t).toMatch(/ANTES|BEFORE/);
    }
  });
  it("PT-BR para Claude e OpenCode; inglês para Codex e Grok", () => {
    expect(nomeDoPromptDoOrquestrador("claude")).toBe("orquestrador");
    expect(nomeDoPromptDoOrquestrador("opencode")).toBe("orquestrador");
    expect(nomeDoPromptDoOrquestrador("codex")).toBe("orquestrador.en");
    expect(nomeDoPromptDoOrquestrador("grok")).toBe("orquestrador.en");
  });
  it("sem o arquivo, a reserva mantém as regras que importam (nunca fica sem instrução)", () => {
    for (const cli of ["claude", "codex"]) {
      const t = instrucoesDoOrquestrador({ cli, prompt: null, orquestradorEdita: false });
      expect(t).toBe(instrucaoDeReserva(cli));
      expect(t).toContain("pane_spawn");
      expect(t).toMatch(/Task|Agent/);
    }
  });
  it("com o opt-out a instrução continua mandando delegar e acrescenta a linha do dono", () => {
    const t = instrucoesDoOrquestrador({ cli: "claude", prompt: null, orquestradorEdita: true });
    expect(t).toContain("liberou que o orquestrador edite");
    expect(t).toContain("pane_spawn");
  });
});

describe("tabela por CLI: o comando de lançamento leva o canal de injeção e as proibições esperadas", () => {
  it("claude: --append-system-prompt; deny de Agent/Task e de Edit/Write/MultiEdit/NotebookEdit (via --settings por sessão)", () => {
    const c = canalDoOrquestrador({ ...base, cli: "claude" });
    expect(c.argumentos).toEqual(["--append-system-prompt", "PROMPT-ORQ"]);
    expect(c.denyDoClaude).toEqual([...SUBAGENTE_NEGADO_CLAUDE, ...EDICAO_NEGADA_CLAUDE]);
    expect(c.denyDoClaude).toEqual(expect.arrayContaining(["Agent", "Task", "Edit", "Write", "MultiEdit", "NotebookEdit"]));
    expect(c.argumentos).not.toContain("--disallowedTools"); // variádico: engoliria o prompt inicial posicional
    expect(c.arquivos).toEqual([]);
    expect(c.garantias).toMatchObject({ selo: "completo", instrucao: "garantido", subagentes_internos: "garantido", edicao: "parcial", orquestra: true });
  });

  it("codex: developer_instructions (JSON válido como string TOML), --disable multi_agent e sandbox somente-leitura", () => {
    const c = canalDoOrquestrador({ ...base, cli: "codex", instrucoes: 'linha "1"\nlinha 2' });
    expect(c.argumentos.slice(0, 2)).toEqual(["-c", `developer_instructions=${JSON.stringify('linha "1"\nlinha 2')}`]);
    expect(c.argumentos).toEqual(expect.arrayContaining(["--disable", "multi_agent", "-s", "read-only"]));
    expect(c.argumentos.join(" ")).not.toContain("model_instructions_file"); // SUBSTITUIRIA as instruções da CLI
    expect(c.argumentos.join(" ")).not.toMatch(/bypass|danger/);
    expect(c.garantias).toMatchObject({ selo: "completo", edicao: "garantido" });
  });
  it("codex em modo automático: sem -s read-only (conflita com --approve-for-me); fica 'parcial' na edição, com selo honesto", () => {
    const c = canalDoOrquestrador({ ...base, cli: "codex", permissao: "automatico" });
    expect(c.argumentos).not.toContain("-s");
    expect(c.argumentos).toEqual(expect.arrayContaining(["--disable", "multi_agent"]));
    expect(c.garantias.edicao).toBe("parcial");
    expect(c.garantias.limites.join(" ")).toMatch(/automático/);
  });

  it("opencode: arquivo de instruções efêmero + permissões task/edit negadas por OPENCODE_CONFIG_CONTENT", () => {
    const c = canalDoOrquestrador({ ...base, cli: "opencode" });
    const cfg = JSON.parse(c.ambiente["OPENCODE_CONFIG_CONTENT"] ?? "{}") as { instructions: string[]; permission: Record<string, string>; tools: Record<string, boolean> };
    expect(cfg.instructions).toEqual([ARQ]);
    expect(cfg.permission).toEqual({ task: "deny", edit: "deny" });
    expect(cfg.tools).toEqual({ task: false });
    expect(c.arquivos).toEqual([{ caminho: ARQ, conteudo: "PROMPT-ORQ" }]);
    expect(c.argumentos).toEqual([]);
    expect(c.garantias).toMatchObject({ selo: "completo", edicao: "parcial" });
  });

  it("grok (com a ponte): --rules, --no-subagents e --deny Edit; --disallowed-tools NÃO entra (só do headless)", () => {
    const c = canalDoOrquestrador({ ...base, cli: "grok", ponteGrok: true });
    expect(c.argumentos).toEqual(["--rules", "PROMPT-ORQ", "--no-subagents", "--deny", "Edit"]);
    expect(c.argumentos).not.toContain("--disallowed-tools");
    expect(c.argumentos.join(" ")).not.toMatch(/always-approve|yolo|bypass/);
    expect(c.garantias).toMatchObject({ orquestra: true, selo: "parcial", instrucao: "garantido", subagentes_internos: "garantido", edicao: "parcial" });
  });
  it("grok SEM a ponte: não orquestra (selo honesto, alternativa oferecida)", () => {
    const g = garantiasDaCli("grok");
    expect(g).toMatchObject({ orquestra: false, selo: "nao_orquestra" });
    expect(g.alternativa).toMatch(/Claude Code, Codex ou OpenCode/);
    expect(g.limites.join(" ")).toMatch(/Grok ainda não orquestra/);
  });

  it.each(["gemini", "aider", "qwen", "kilo", "terminal", "inventada"])("%s: não fala com o MCP do app por sessão: canal vazio e selo 'não orquestra'", (cli) => {
    const c = canalDoOrquestrador({ ...base, cli });
    expect(c.argumentos).toEqual([]);
    expect(c.ambiente).toEqual({});
    expect(c.arquivos).toEqual([]);
    expect(c.denyDoClaude).toEqual([]);
    expect(c.garantias).toMatchObject({ orquestra: false, selo: "nao_orquestra", instrucao: "nenhum", subagentes_internos: "nenhum" });
    expect(c.garantias.alternativa).not.toBeNull();
  });

  it("as CLIs que orquestram são exatamente as que recebem canal não vazio (sem a ponte)", () => {
    for (const cli of ["claude", "codex", "opencode"]) {
      const c = canalDoOrquestrador({ ...base, cli });
      expect(c.argumentos.length + Object.keys(c.ambiente).length).toBeGreaterThan(0);
      expect(CLIS_QUE_ORQUESTRAM).toContain(cli);
    }
  });
});

describe("opt-out do workspace: orquestrador pode editar", () => {
  it("claude: só os subagentes continuam negados; opencode e grok soltam a edição; codex perde o somente-leitura", () => {
    const edita = { ...base, orquestradorEdita: true };
    expect(canalDoOrquestrador({ ...edita, cli: "claude" }).denyDoClaude).toEqual([...SUBAGENTE_NEGADO_CLAUDE]);
    const oc = JSON.parse(canalDoOrquestrador({ ...edita, cli: "opencode" }).ambiente["OPENCODE_CONFIG_CONTENT"] ?? "{}") as { permission: Record<string, string> };
    expect(oc.permission).toEqual({ task: "deny" });
    expect(canalDoOrquestrador({ ...edita, cli: "grok", ponteGrok: true }).argumentos).toEqual(["--rules", "PROMPT-ORQ", "--no-subagents"]);
    const cx = canalDoOrquestrador({ ...edita, cli: "codex" }).argumentos;
    expect(cx).not.toContain("-s");
    expect(cx).toEqual(expect.arrayContaining(["--disable", "multi_agent"]));
    for (const cli of ["claude", "codex", "opencode", "grok"]) expect(canalDoOrquestrador({ ...edita, cli, ponteGrok: true }).garantias.edicao).toBe("nenhum");
  });
});

describe("garantias para a UI", () => {
  it("quem orquestra tem selo completo (instrução em canal de sistema + subagentes bloqueados); nenhuma CLI promete bloqueio total do shell", () => {
    for (const cli of CLIS_QUE_ORQUESTRAM) {
      const g = garantiasDaCli(cli);
      expect(g.selo).toBe("completo");
      expect(g.canal_instrucao).not.toBeNull();
      expect(g.limites.length).toBeGreaterThan(0);
    }
    expect(garantiasDaCli("claude").limites.join(" ")).toMatch(/shell/i);
  });
});
