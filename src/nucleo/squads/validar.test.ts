import { describe, expect, it } from "vitest";
import type { CodigoAchado, Membro, Squad } from "./tipos";
import { contemCaminhoAbsoluto, contemCaminhoAbsolutoEmValores, extrairVariaveis, pareceSegredo, redigirSegredos, temErro, validarMembro, validarPrompt, validarSlug, validarSquad } from "./validar";
import type { ContextoValidacao } from "./validar";

function membro(slug: string, papel: Membro["papel"], extra: Partial<Membro> = {}): Membro {
  return {
    slug,
    papel,
    rotulo: slug,
    descricao: "d",
    prompt: `membros/${slug}.md`,
    perfil: { cli: "claude", modelo: papel === "reviewer" ? "opus" : "sonnet", esforco: "medio", faixa: "medio" },
    skills_permitidas: [],
    mcps_permitidos: [],
    hooks: [],
    max_instancias: 1,
    orcamento: { tempo_min: null, tokens: null, modo: "soft" },
    rigidez: null,
    permissao: null,
    ...extra,
  };
}
function squad(extra: Partial<Squad> = {}): Squad {
  return {
    slug: "demo",
    nome: "Demo",
    descricao: "d",
    escopo: "desenvolvimento",
    rigidez_padrao: null,
    max_instancias_paralelas: 4,
    orcamento: { tempo_min: null, tokens: null, modo: "soft" },
    portoes: null,
    fabrica: null,
    origem: "usuario",
    membros: [membro("orq", "orchestrator"), membro("impl", "executor"), membro("rev", "reviewer")],
    ...extra,
  };
}
const com = (m: Membro[], extra: Partial<Squad> = {}): Squad => squad({ membros: m, ...extra });
const base = (): Membro[] => [membro("orq", "orchestrator"), membro("impl", "executor"), membro("rev", "reviewer")];
const trocar = (i: number, extra: Partial<Membro>): Squad => {
  const m = base();
  m[i] = { ...m[i]!, ...extra };
  return com(m);
};
const perfil = (i: number, p: Partial<Membro["perfil"]>): Squad => {
  const m = base();
  m[i] = { ...m[i]!, perfil: { ...m[i]!.perfil, ...p } };
  return com(m);
};
const codigos = (s: Squad, ctx?: ContextoValidacao): CodigoAchado[] => validarSquad(s, ctx).map((a) => a.codigo);

describe("validarSquad: squad válida e composição", () => {
  it("squad válida = 0 achados", () => expect(validarSquad(squad())).toEqual([]));
  it("sem orquestrador", () => expect(codigos(com([membro("a", "executor"), membro("b", "executor"), membro("rev", "reviewer")]))).toContain("sem_orquestrador"));
  it("dois orquestradores", () => expect(codigos(com([...base(), membro("orq2", "orchestrator")]))).toContain("orquestrador_duplicado"));
  it("sem revisor, com a mensagem do plano", () => {
    const a = validarSquad(com([membro("orq", "orchestrator"), membro("a", "executor"), membro("b", "scout")])).find((x) => x.codigo === "sem_revisor");
    expect(a?.severidade).toBe("erro");
    expect(a?.mensagem).toContain("Missão nunca conclui");
  });
  it("2 membros = poucos_membros", () => expect(codigos(com([membro("orq", "orchestrator"), membro("rev", "reviewer")]))).toContain("poucos_membros"));
  it("13 membros = muitos_membros", () => {
    const m = [...base()];
    for (let i = 0; i < 10; i++) m.push(membro(`x${i}`, "executor"));
    expect(codigos(com(m))).toContain("muitos_membros");
  });
  it("12 membros é aceito", () => {
    const m = [...base()];
    for (let i = 0; i < 9; i++) m.push(membro(`x${i}`, "executor", { perfil: { cli: "codex", modelo: null, esforco: null, faixa: "medio" } }));
    expect(codigos(com(m))).not.toContain("muitos_membros");
  });
  it("slug de membro duplicado", () => expect(codigos(com([...base(), membro("impl", "scout")]))).toContain("slug_duplicado"));
  it("slug de squad inválido", () => expect(codigos(squad({ slug: "Demo Ruim" }))).toContain("slug_invalido"));
  it("agent_id acima de 80", () => expect(codigos(squad({ slug: "a".repeat(40), membros: [membro("b".repeat(40), "orchestrator"), membro("c", "executor"), membro("d", "reviewer")] }))).toContain("slug_invalido"));
  it("fábrica não é gravável", () => expect(codigos(squad({ origem: "fabrica" }), { paraGravar: true })).toContain("fabrica_somente_leitura"));
  it("fábrica sem paraGravar é válida", () => expect(codigos(squad({ origem: "fabrica" }))).toEqual([]));
});

describe("validarSquad: perfil", () => {
  it("CLI desconhecida", () => expect(codigos(perfil(1, { cli: "foo" }))).toContain("cli_desconhecida"));
  it("orquestrador em gemini = cli_sem_intake (CT-14.03)", () => expect(codigos(perfil(0, { cli: "gemini" }))).toContain("cli_sem_intake"));
  it("orquestrador em claude, codex e opencode passa", () => {
    for (const cli of ["claude", "codex", "opencode"]) expect(codigos(perfil(0, { cli }))).not.toContain("cli_sem_intake");
  });
  it("cli auto é válida inclusive no orquestrador", () => expect(codigos(perfil(0, { cli: "auto" }))).toEqual([]));
  it("executor em gemini passa (só o orquestrador exige intake)", () => expect(codigos(perfil(1, { cli: "gemini" }))).not.toContain("cli_sem_intake"));
  it("CLI não instalada só avisa quando o contexto informa as instaladas", () => {
    expect(codigos(squad())).not.toContain("cli_nao_instalada");
    const a = validarSquad(squad(), { clisInstaladas: ["codex"] }).filter((x) => x.codigo === "cli_nao_instalada");
    expect(a).toHaveLength(3);
    expect(a[0]?.severidade).toBe("aviso");
  });
  it("modelo com espaço ou hífen inicial é inválido; default e null passam", () => {
    expect(codigos(perfil(1, { modelo: "meu modelo" }))).toContain("modelo_invalido");
    expect(codigos(perfil(1, { modelo: "--rm" }))).toContain("modelo_invalido");
    expect(codigos(perfil(1, { modelo: "default" }))).not.toContain("modelo_invalido");
    expect(codigos(perfil(1, { modelo: null }))).not.toContain("modelo_invalido");
    expect(codigos(perfil(1, { modelo: "openrouter/anthropic/x:1" }))).not.toContain("modelo_invalido");
  });
  it("faixa fora do conjunto", () => expect(codigos(perfil(1, { faixa: "ultra" as never }))).toContain("faixa_invalida"));
  it("esforço desconhecido", () => expect(codigos(perfil(1, { esforco: "extremo" }))).toContain("esforco_invalido"));
  it("esforço nativo fora da lista da CLI é erro; neutro sempre passa", () => {
    const ctx: ContextoValidacao = { niveisEsforco: (cli) => (cli === "codex" ? ["minimal", "low", "medium", "high"] : null) };
    expect(codigos(perfil(1, { cli: "codex", esforco: "max" }), ctx)).toContain("esforco_invalido");
    expect(codigos(perfil(1, { cli: "codex", esforco: "high" }), ctx)).not.toContain("esforco_invalido");
    expect(codigos(perfil(1, { cli: "codex", esforco: "alto" }), ctx)).not.toContain("esforco_invalido");
  });
  it("CLI sem parâmetro de esforço gera aviso indicativo, não erro", () => {
    const ctx: ContextoValidacao = { modoEsforco: (cli) => (cli === "opencode" ? "indicativo" : "flag") };
    const a = validarSquad(perfil(1, { cli: "opencode", esforco: "alto" }), ctx).find((x) => x.codigo === "esforco_indicativo");
    expect(a?.severidade).toBe("aviso");
    expect(temErro(validarSquad(perfil(1, { cli: "opencode", esforco: "alto" }), ctx))).toBe(false);
  });
  it("revisor igual ao executor é aviso; diferente não", () => {
    const igual = perfil(2, { modelo: "sonnet" });
    const a = validarSquad(igual).find((x) => x.codigo === "revisor_igual_ao_executor");
    expect(a?.severidade).toBe("aviso");
    expect(codigos(squad())).not.toContain("revisor_igual_ao_executor");
  });
});

describe("validarSquad: limites, skills, MCPs, permissão", () => {
  it("max_instancias 9 e 0 inválidos; orquestrador só 1", () => {
    expect(codigos(trocar(1, { max_instancias: 9 }))).toContain("limite_invalido");
    expect(codigos(trocar(1, { max_instancias: 0 }))).toContain("limite_invalido");
    expect(codigos(trocar(0, { max_instancias: 2 }))).toContain("limite_invalido");
    expect(codigos(trocar(1, { max_instancias: 8 }))).toEqual([]);
  });
  it("paralelas da squad acima do global é recusado", () => {
    expect(codigos(squad({ max_instancias_paralelas: 9 }))).toContain("limite_invalido");
    expect(codigos(squad({ max_instancias_paralelas: 6 }))).toEqual([]);
    expect(codigos(squad({ max_instancias_paralelas: 5 }), { maxParallelPanes: 4 })).toContain("limite_invalido");
  });
  it("orçamento fora da faixa", () => {
    expect(codigos(squad({ orcamento: { tempo_min: 0, tokens: null, modo: "soft" } }))).toContain("limite_invalido");
    expect(codigos(squad({ orcamento: { tempo_min: 1441, tokens: null, modo: "soft" } }))).toContain("limite_invalido");
    expect(codigos(squad({ orcamento: { tempo_min: 30, tokens: -5, modo: "soft" } }))).toContain("limite_invalido");
    expect(codigos(squad({ orcamento: { tempo_min: 30, tokens: 100000, modo: "rigido" } }))).toEqual([]);
  });
  it("rigidez fora de 1..5 e escopo inválido", () => {
    expect(codigos(squad({ rigidez_padrao: 6 as never }))).toContain("limite_invalido");
    expect(codigos(squad({ escopo: "x" as never }))).toContain("limite_invalido");
    expect(codigos(trocar(1, { rigidez: 0 as never }))).toContain("limite_invalido");
  });
  it("skill e MCP desconhecidos são aviso só com catálogo informado", () => {
    const s = trocar(1, { skills_permitidas: ["ev-builder", "inventada"], mcps_permitidos: ["context7", "malicioso"] });
    expect(codigos(s)).toEqual([]);
    const a = validarSquad(s, { skillsConhecidas: new Set(["ev-builder"]), mcpsConhecidos: new Set(["context7"]) });
    expect(a.map((x) => x.codigo).sort()).toEqual(["mcp_desconhecido", "skill_desconhecida"]);
    expect(a.every((x) => x.severidade === "aviso")).toBe(true);
  });
  it("nome de skill com caractere perigoso é recusado mesmo sem catálogo", () => {
    expect(codigos(trocar(1, { skills_permitidas: ["a b; rm -rf"] }))).toContain("limite_invalido");
  });
  it("permissão acima do workspace avisa; igual ou menor não", () => {
    const ctx: ContextoValidacao = { permissaoWorkspace: "seguro" };
    expect(codigos(trocar(1, { permissao: "automatico" }), ctx)).toContain("permissao_acima_do_workspace");
    expect(codigos(trocar(1, { permissao: "seguro" }), ctx)).toEqual([]);
    expect(codigos(trocar(1, { permissao: "bypass" as never }), ctx)).toContain("limite_invalido");
  });
  it("caminho do prompt divergente do padrão", () => expect(codigos(trocar(1, { prompt: "../x.md" }))).toContain("membro_sem_prompt"));
});

describe("achados: forma e texto", () => {
  it("todo achado tem severidade, gravidade, caminho e mensagem em PT-BR", () => {
    const a = validarSquad(com([membro("a", "scout")]));
    expect(a.length).toBeGreaterThan(2);
    for (const x of a) {
      expect(["erro", "aviso"]).toContain(x.severidade);
      expect(["alta", "media", "baixa"]).toContain(x.gravidade);
      expect(x.caminho.length).toBeGreaterThan(0);
      expect(x.mensagem).toMatch(/[a-zçãé]/);
    }
    expect(a.find((x) => x.codigo === "sem_orquestrador")?.gravidade).toBe("alta");
  });
  it("aviso tem gravidade média ou baixa", () => {
    const a = validarSquad(perfil(2, { modelo: "sonnet" })).find((x) => x.codigo === "revisor_igual_ao_executor");
    expect(a?.gravidade).toBe("media");
  });
});

describe("validarMembro / validarSlug / extrairVariaveis", () => {
  it("validarMembro isolado devolve só os achados do membro", () => {
    expect(validarMembro(membro("ok", "executor"))).toEqual([]);
    expect(validarMembro(membro("ok", "executor", { perfil: { cli: "x", modelo: null, esforco: null, faixa: "medio" } }), {}, "membros[3]")[0]?.caminho).toBe("membros[3].perfil.cli");
  });
  it("validarSlug", () => {
    expect(validarSlug("ok-1")).toEqual([]);
    for (const s of ["", "A", "-a", "a_b", "a".repeat(41), "../a", 3 as never]) expect(validarSlug(s)).toHaveLength(1);
  });
  it("extrairVariaveis devolve nomes únicos na ordem", () => {
    expect(extrairVariaveis("{{objetivo}} x {{ rigor }} {{objetivo}} {{foo}}")).toEqual(["objetivo", "rigor", "foo"]);
  });
});

describe("validarPrompt", () => {
  it("prompt com variáveis do conjunto fechado passa", () => {
    expect(validarPrompt("# {{rotulo}} — {{squad}}\n{{objetivo}}\n{{contexto_rag}}\n{{arquivos}}\n{{rigor}}\n{{pasta}}/missoes/{{missao}} {{card}} {{membro}}")).toEqual([]);
  });
  it("variável desconhecida {{foo}} é erro", () => expect(validarPrompt("oi {{foo}}").map((a) => a.codigo)).toEqual(["variavel_desconhecida"]));
  it("chaves vazias {{}} também são erro", () => expect(validarPrompt("oi {{}}").map((a) => a.codigo)).toContain("variavel_desconhecida"));
  it("17 KiB = prompt_grande; 16 KiB exatos passam", () => {
    expect(validarPrompt("a".repeat(17 * 1024)).map((a) => a.codigo)).toEqual(["prompt_grande"]);
    expect(validarPrompt("a".repeat(16 * 1024))).toEqual([]);
  });
  it("tamanho conta bytes, não caracteres", () => expect(validarPrompt("ç".repeat(9000)).map((a) => a.codigo)).toEqual(["prompt_grande"]));
  it("prompt com API_KEY=abc... é recusado", () => expect(validarPrompt("use API_KEY=abc123def456ghi").map((a) => a.codigo)).toContain("prompt_com_segredo"));
  it("outros formatos de segredo", () => {
    for (const t of ["ghp_" + "a1".repeat(20), "sk-" + "Ab1".repeat(10), "-----BEGIN RSA PRIVATE KEY-----", "Bearer " + "a".repeat(30), "senha: abc123def4567890"]) {
      expect(validarPrompt(t).map((a) => a.codigo), t).toContain("prompt_com_segredo");
    }
  });
  it("menção inofensiva a token/chave não é segredo", () => {
    expect(validarPrompt("Nunca copie token ou chave de API: cite só o nome da variável.")).toEqual([]);
    expect(validarPrompt("orçamento de tokens: soft")).toEqual([]);
  });
  it("vazio e caracteres de controle", () => {
    expect(validarPrompt("   ").map((a) => a.codigo)).toEqual(["membro_sem_prompt"]);
    expect(validarPrompt("a\u0000b").map((a) => a.codigo)).toContain("membro_sem_prompt");
    expect(validarPrompt("linha\ncom\ttab\r\n")).toEqual([]);
  });
});

describe("desempenho: validar ≤ 5 ms por squad", () => {
  it("squad de 12 membros valida bem abaixo de 5 ms (p95)", () => {
    const m = [membro("orq", "orchestrator"), membro("rev", "reviewer")];
    for (let i = 0; i < 10; i++) m.push(membro(`x${i}`, "executor", { skills_permitidas: ["ev-builder", "ev-evidence-before-done"] }));
    const s = com(m);
    const ctx: ContextoValidacao = { skillsConhecidas: new Set(["ev-builder", "ev-evidence-before-done"]), mcpsConhecidos: new Set(["context7"]), clisInstaladas: ["claude"] };
    const tempos: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      validarSquad(s, ctx);
      tempos.push(performance.now() - t0);
    }
    tempos.sort((a, b) => a - b);
    expect(tempos[94]).toBeLessThan(5);
  });
});

describe("redigirSegredos (objetivo da caixa de prompt)", () => {
  it("troca chave, token e senha por marca e deixa o resto intacto", async () => {
    const { redigirSegredos, pareceSegredo } = await import("./validar");
    const t = "Corrija o login. API_KEY=abcdef123456789 e use Bearer abcdefghijklmnopqrstuvwxyz0123 depois. senha: abc123def456ghi";
    const r = redigirSegredos(t);
    expect(r).toContain("Corrija o login.");
    expect(r).toContain("[segredo omitido]");
    expect(r).not.toContain("abcdef123456789");
    expect(r).not.toContain("abcdefghijklmnopqrstuvwxyz0123");
    expect(pareceSegredo(r)).toBe(false);
    expect(redigirSegredos("texto limpo")).toBe("texto limpo");
  });
});

describe("auditoria: segredos (detecção e redação)", () => {
  it("chave privada: a redação leva o CORPO e o fim, não só o cabeçalho", () => {
    const chave = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=SENTINELA\nAAAA\n-----END OPENSSH PRIVATE KEY-----";
    expect(pareceSegredo(chave)).toBe(true);
    const r = redigirSegredos(`antes\n${chave}\ndepois`);
    expect(r).not.toContain("SENTINELA");
    expect(r).not.toContain("END OPENSSH");
    expect(r).toContain("antes");
    expect(r).toContain("depois");
  });
  it("chave privada sem a linha de fim (truncada): redige até o fim do texto", () => {
    const r = redigirSegredos("x\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEASENTINELA");
    expect(r).not.toContain("SENTINELA");
  });
  it.each([
    ["Stripe", "sk_live_51HxABCDEFGHIJKLMNOPQRSTUV"],
    ["Google", "AIzaSyA-1234567890abcdefghijklmnopqrstuv"],
    ["JWT", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"],
    ["npm", "npm_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["GitLab", "glpat-abcdefghijklmnopqrst"],
  ])("token %s é reconhecido e redigido", (_nome, token) => {
    expect(pareceSegredo(`use ${token} aqui`)).toBe(true);
    expect(redigirSegredos(`use ${token} aqui`)).not.toContain(token.slice(8));
  });
  it("texto comum não vira segredo (sem falso positivo em prosa técnica)", () => {
    for (const t of ["o token de acesso é pedido ao usuário", "sk-learn e a chave primária da tabela", "Bearer é o esquema de autorização", "eyJ é o começo de um JWT"]) {
      expect(pareceSegredo(t), t).toBe(false);
    }
  });
  it("caminho absoluto: detecta POSIX, Windows, UNC e file://, ignora relativos", () => {
    expect(contemCaminhoAbsoluto("veja /Users/x/y")).toBe(true);
    expect(contemCaminhoAbsoluto("file:///home/x")).toBe(true);
    expect(contemCaminhoAbsoluto("C:\\Users\\x")).toBe(true);
    expect(contemCaminhoAbsoluto("\\\\srv\\share\\a")).toBe(true);
    expect(contemCaminhoAbsoluto("src/etc/x e ./tmp e ../var")).toBe(false);
    expect(contemCaminhoAbsolutoEmValores({ a: { b: ["ok", "usa /Volumes/Disco/x"] } })).toBe(true);
    expect(contemCaminhoAbsolutoEmValores({ a: { b: ["ok", "relativo/x"] }, n: 3, nulo: null })).toBe(false);
  });
});
