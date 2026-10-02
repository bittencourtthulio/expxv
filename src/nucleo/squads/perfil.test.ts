import { describe, expect, it } from "vitest";
import { CLIS_CATALOGO, type Membro, type PermissaoMembro } from "../../compartilhado/squads";
import {
  CliAutoSemResolucaoErro,
  CliDesconhecidaErro,
  comCadeado,
  EsforcoInvalidoErro,
  ExecutavelInvalidoErro,
  faixaDe,
  ModeloInvalidoErro,
  montarComandoDoMembro,
  paraPerfilCompleto,
  permissaoEfetiva,
  PermissaoInvalidaErro,
  resolverEMontarComando,
  resolverPerfilDireto,
  type ContextoComando,
  type EntradaRenderizacao,
  type PortaResolverPerfil,
  type RenderizadorDoPrompt,
} from "./perfil";
import { PISO_DE_QUALIDADE } from "./rigor";

const renderizador: RenderizadorDoPrompt & { chamadas: EntradaRenderizacao[] } = {
  chamadas: [],
  renderizar(e) {
    this.chamadas.push(e);
    return [`PROMPT:${e.membro.slug}`, e.rigor, e.esforco_indicativo ?? ""].filter((x) => x !== "").join("\n");
  },
};

const membro = (p: Partial<Membro["perfil"]> = {}, extra: Partial<Membro> = {}): Membro => ({
  slug: "dev", papel: "executor", rotulo: "Dev", descricao: "d", prompt: "membros/dev.md",
  perfil: { cli: "claude", modelo: "sonnet", esforco: "alto", faixa: "alto", ...p },
  skills_permitidas: [], mcps_permitidos: [], hooks: [], max_instancias: 1,
  orcamento: { tempo_min: null, tokens: null, modo: "soft" }, rigidez: null, permissao: null, ...extra,
});
const ctx = (extra: Partial<ContextoComando> = {}): ContextoComando => ({
  squad_slug: "s", executavel: "/usr/local/bin/claude", permissao_workspace: "seguro", rigidez: 3, renderizador, ...extra,
});

describe("montarComandoDoMembro", () => {
  it("claude: --model + --effort como argv separado; sem esforço indicativo; prompt renderizado com rigor", () => {
    const c = montarComandoDoMembro(membro(), ctx());
    expect(c.ferramenta).toBe("claude");
    expect(c.argumentos).toEqual(["--model", "sonnet", "--effort", "high"]);
    expect(c.esforco).toMatchObject({ modo: "flag", indicativo: false, confiavel: true, texto: null });
    expect(c.modelo).toBe("sonnet");
    expect(c.prompt).toContain("PROMPT:dev");
    expect(c.prompt).toContain("Rigor padrão");
    expect(c.perfil_efetivo).toMatchObject({ cli: "claude", modelo: "sonnet", esforco: "high", esforco_modo: "flag", faixa: "alto", conta_id: null });
  });

  it("codex: esforço por -c (config)", () => {
    const c = montarComandoDoMembro(membro({ cli: "codex", modelo: null, esforco: "maximo", faixa: "medio" }), ctx({ executavel: "/x/codex" }));
    expect(c.argumentos).toEqual(["-c", 'model_reasoning_effort="xhigh"']);
    expect(c.esforco.modo).toBe("config");
  });

  it("CLI sem mecanismo (opencode): esforço vira indicativo, marcado, e a instrução vai ao renderizador/prompt", () => {
    const c = montarComandoDoMembro(membro({ cli: "opencode", modelo: "anthropic/claude-sonnet", esforco: "alto" }), ctx({ executavel: "/x/opencode" }));
    expect(c.argumentos).toEqual(["--model", "anthropic/claude-sonnet"]);
    expect(c.esforco).toMatchObject({ modo: "indicativo", indicativo: true, confiavel: false });
    expect(c.esforco.texto).toContain("## Nível de esforço desejado: alto");
    expect(c.prompt).toContain("## Nível de esforço desejado: alto");
    expect(c.perfil_efetivo.esforco_modo).toBe("indicativo");
    expect(renderizador.chamadas.at(-1)?.esforco_indicativo).toContain("alto");
  });

  it("esforço nulo => modo nenhum; modelo default/nulo => sem --model", () => {
    const c = montarComandoDoMembro(membro({ modelo: "default", esforco: null }), ctx());
    expect(c.argumentos).toEqual([]);
    expect(c.esforco.modo).toBe("nenhum");
    expect(c.modelo).toBeNull();
  });

  it("flag ausente no --help detectado: vira indicativo com aviso, nunca falha o spawn", () => {
    const c = montarComandoDoMembro(membro(), ctx({ esforco: { flagsDetectadas: "Usage: claude" } }));
    expect(c.argumentos).toEqual(["--model", "sonnet"]);
    expect(c.esforco.modo).toBe("indicativo");
    expect(c.perfil_efetivo.avisos.join(" ")).toContain("--effort");
  });

  it("CLI que não aceita --model (qwen) com modelo: aviso, sem argumento", () => {
    const c = montarComandoDoMembro(membro({ cli: "qwen", modelo: "algum", esforco: null }), ctx({ executavel: "/x/qwen" }));
    expect(c.argumentos).toEqual([]);
    expect(c.perfil_efetivo.avisos[0]).toContain("não aceita --model");
  });

  describe("erros nominais", () => {
    it("CLI desconhecida / auto sem resolução / modelo malformado / esforço inválido / executável inválido", () => {
      expect(() => montarComandoDoMembro(membro({ cli: "nope" }), ctx())).toThrow(CliDesconhecidaErro);
      expect(() => montarComandoDoMembro(membro({ cli: "auto" }), ctx())).toThrow(CliAutoSemResolucaoErro);
      expect(() => montarComandoDoMembro(membro({ modelo: "--dangerously" }), ctx())).toThrow(ModeloInvalidoErro);
      expect(() => montarComandoDoMembro(membro({ modelo: "a b" }), ctx())).toThrow(ModeloInvalidoErro);
      expect(() => montarComandoDoMembro(membro({ modelo: "x;rm -rf /" }), ctx())).toThrow(ModeloInvalidoErro);
      expect(() => montarComandoDoMembro(membro({ esforco: "$(id)" }), ctx())).toThrow(EsforcoInvalidoErro);
      expect(() => montarComandoDoMembro(membro(), ctx({ executavel: "" }))).toThrow(ExecutavelInvalidoErro);
      expect(() => montarComandoDoMembro(membro(), ctx({ executavel: "a\nb" }))).toThrow(ExecutavelInvalidoErro);
      expect(() => montarComandoDoMembro(membro({}, { permissao: "root" as PermissaoMembro }), ctx())).toThrow(PermissaoInvalidaErro);
    });
  });

  it("NENHUM perfil gera comando com shell: argv é lista de strings sem metacaracteres e sem flag+valor colados", () => {
    const perigosos = ["--effort high", "high; rm -rf /", "$(id)", "`id`", "a|b", "a&&b"];
    for (const cli of CLIS_CATALOGO) for (const esforco of [null, "minimo", "baixo", "medio", "alto", "maximo"]) for (const permissao of [null, "seguro", "equilibrado", "automatico"] as const) {
      const c = montarComandoDoMembro(membro({ cli, modelo: "m-1.0", esforco }, { permissao }), ctx({ executavel: `/x/${cli}`, permissao_workspace: "automatico" }));
      expect(Array.isArray(c.argumentos)).toBe(true);
      for (const a of c.argumentos) {
        expect(typeof a).toBe("string");
        expect(a).not.toMatch(/[;|&$`\n\r\0<>]/);
        expect(a).not.toMatch(/^--\S+\s\S/); // "--flag valor" num único argumento
      }
      expect(c).not.toHaveProperty("shell");
      expect(c).not.toHaveProperty("comando");
    }
    for (const p of perigosos) {
      expect(() => montarComandoDoMembro(membro({ modelo: p }), ctx())).toThrow();
      expect(() => montarComandoDoMembro(membro({ esforco: p }), ctx())).toThrow();
    }
  });

  describe("permissão: o menor entre membro e workspace vale (tabela)", () => {
    const tabela: Array<[PermissaoMembro | null, PermissaoMembro | null, PermissaoMembro, PermissaoMembro, boolean]> = [
      // membro, missão, workspace, efetiva, flag automática presente
      ["automatico", null, "seguro", "seguro", false],
      ["automatico", null, "equilibrado", "equilibrado", false],
      ["automatico", null, "automatico", "automatico", true],
      [null, "automatico", "seguro", "seguro", false],
      [null, "automatico", "automatico", "automatico", true],
      [null, null, "automatico", "automatico", true],
      [null, null, "seguro", "seguro", false],
      ["seguro", "automatico", "automatico", "seguro", false],
      ["equilibrado", null, "automatico", "equilibrado", false],
      ["seguro", null, "automatico", "seguro", false],
    ];
    it.each(tabela)("membro=%s missão=%s workspace=%s => %s (flag=%s)", (m, mis, ws, efetiva, flag) => {
      const c = montarComandoDoMembro(membro({}, { permissao: m }), ctx({ permissao_workspace: ws, permissao_missao: mis }));
      expect(c.permissao_efetiva).toBe(efetiva);
      expect(c.argumentos.includes("--dangerously-skip-permissions")).toBe(flag);
      expect(permissaoEfetiva(m, mis, ws)).toBe(efetiva);
    });
    it("automatico em codex nunca usa o bypass total de sandbox", () => {
      const c = montarComandoDoMembro(membro({ cli: "codex", modelo: null, esforco: null }, { permissao: "automatico" }), ctx({ permissao_workspace: "automatico", executavel: "/x/codex" }));
      expect(c.argumentos).toEqual(["--approve-for-me"]);
      expect(c.argumentos.join(" ")).not.toContain("bypass");
    });
  });

  it("rigidez: usa a do membro quando há, senão a do contexto; piso sempre presente", () => {
    expect(montarComandoDoMembro(membro({}, { rigidez: 1 }), ctx({ rigidez: 5 })).prompt).toContain("Rigor mínimo");
    expect(montarComandoDoMembro(membro(), ctx({ rigidez: 5 })).prompt).toContain("Rigor total");
    expect(montarComandoDoMembro(membro({}, { rigidez: 1 }), ctx()).prompt).toContain(PISO_DE_QUALIDADE);
  });

  it("perfil completo: faixa de equivalência, conta preferida e permissão", () => {
    expect(paraPerfilCompleto(membro({}, { permissao: "equilibrado" }), "s.dev", "conta-1")).toEqual({
      agente_id: "s.dev", cli: "claude", modelo: "sonnet", esforco: "alto", faixa: "alto", conta_preferida: "conta-1", permissao: "equilibrado",
    });
    expect([faixaDe("claude", "opus"), faixaDe("claude", "sonnet"), faixaDe("claude", "haiku"), faixaDe("claude", null), faixaDe("codex", "x"), faixaDe("claude", "claude-opus-4")]).toEqual(["topo", "alto", "rapido", "medio", "medio", "topo"]);
  });
});

describe("integração com a Fase 9 por porta", () => {
  it("dublê determinístico: respeita o perfil e resolve 'auto' para o fallback", async () => {
    const porta = resolverPerfilDireto({ fallbackCli: "codex" });
    const perfil = paraPerfilCompleto(membro({ cli: "auto", modelo: null, esforco: "medio" }), "s.dev", "c1");
    const r = await porta.resolverPerfil(perfil, { workspace_id: "w", papel: "executor", mission_id: null });
    expect(r).toMatchObject({ cli: "codex", modelo: null, conta: "c1" });
    expect((await porta.resolverPerfil({ ...perfil, cli: "claude", modelo: "opus" }, { workspace_id: "w", papel: "executor", mission_id: null })).modelo).toBe("opus");
  });

  it("a resolução da porta manda: troca CLI/modelo/conta e o esforço é recalculado para a CLI resolvida", async () => {
    const chamadas: unknown[] = [];
    const porta: PortaResolverPerfil = {
      resolverPerfil(perfil, contexto) {
        chamadas.push({ perfil, contexto });
        return Promise.resolve({ cli: "codex", modelo: null, conta: "conta-9", motivo: "claude no limite; troca por codex", ambiente: { CODEX_HOME: "/h" } });
      },
    };
    const c = await resolverEMontarComando(porta, membro({ cli: "claude", esforco: "alto" }), { ...ctx({ executavel: "/x/codex", agente_id: "s.dev" }), workspace_id: "w" });
    expect(c.ferramenta).toBe("codex");
    expect(c.argumentos).toEqual(['-c', 'model_reasoning_effort="high"']);
    expect(c.ambiente).toEqual({ CODEX_HOME: "/h" });
    expect(c.perfil_efetivo.conta_id).toBe("conta-9");
    expect(c.motivo).toContain("troca por codex");
    expect(chamadas).toHaveLength(1);
    expect((chamadas[0] as { contexto: { papel: string } }).contexto.papel).toBe("executor");
  });

  it("resolução com CLI inexistente é erro nominal (a porta não escapa da validação)", () => {
    expect(() => montarComandoDoMembro(membro(), ctx({ resolucao: { cli: "zzz", modelo: null, conta: null, motivo: "x" } }))).toThrow(CliDesconhecidaErro);
    expect(() => montarComandoDoMembro(membro(), ctx({ resolucao: { cli: "claude", modelo: "-x", conta: null, motivo: "x" } }))).toThrow(ModeloInvalidoErro);
  });
});

describe("comCadeado: CLI imposta a todos os membros só na Missão (wizard)", () => {
  const base = (papel: Membro["papel"], cli: string, modelo: string | null, esforco: string | null): Membro => ({
    slug: "m", papel, rotulo: "M", descricao: "d", prompt: "membros/m.md", perfil: { cli, modelo, esforco, faixa: "alto" },
    skills_permitidas: [], mcps_permitidos: [], hooks: [], max_instancias: 1, orcamento: { tempo_min: null, tokens: null, modo: "soft" }, rigidez: null, permissao: null,
  });
  it("sem cadeado, ou mesma CLI: o membro volta idêntico", () => {
    const m = base("executor", "claude", "sonnet", "high");
    expect(comCadeado(m, null)).toBe(m);
    expect(comCadeado(m, "claude")).toBe(m);
  });
  it("troca a CLI preservando papel e faixa; modelo inexistente na CLI nova vira padrão (null); esforço fora da tabela vira null", () => {
    const r = comCadeado(base("executor", "claude", "sonnet", "xhigh"), "codex");
    expect(r.perfil.cli).toBe("codex");
    expect(r.perfil.faixa).toBe("alto");
    expect(r.perfil.modelo).toBeNull();
    expect(r.papel).toBe("executor");
  });
  it("não muta o membro original", () => {
    const m = base("executor", "claude", "sonnet", "high");
    comCadeado(m, "codex");
    expect(m.perfil.cli).toBe("claude");
  });
  it("orquestrador só aceita CLI com contrato de intake: com gemini mantém a CLI original", () => {
    const o = base("orchestrator", "claude", "opus", "high");
    expect(comCadeado(o, "gemini").perfil.cli).toBe("claude");
    expect(comCadeado(o, "codex").perfil.cli).toBe("codex");
  });
  it("auto é aceito (o harness escolhe); CLI de formato inválido é ignorada", () => {
    expect(comCadeado(base("executor", "claude", "sonnet", "high"), "auto").perfil).toMatchObject({ cli: "auto", modelo: null, esforco: null });
    expect(comCadeado(base("executor", "claude", "sonnet", "high"), "../x").perfil.cli).toBe("claude");
  });
});
