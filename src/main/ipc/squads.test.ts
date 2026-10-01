import { describe, expect, it } from "vitest";
import { CANAIS_ENVIO, CANAIS_EVENTO, CANAIS_INVOKE } from "../../compartilhado/ipc";
import type { Membro, Squad } from "../../compartilhado/squads";
import { VALIDADORES_SQUADS, vPromptTexto } from "./squads";

/**
 * Canais `squads:*`/`agentes:*` com validador estrito mas SEM manipulador nesta onda, com a task que o implementa
 * (cada onda remove daqui os que passar a registrar; o teste abaixo falha se a lista mentir).
 */
export const CANAIS_SQUADS_SEM_MANIPULADOR_AINDA: Readonly<Record<string, string>> = {
  "squads:listar": "T-14.09",
  "squads:obter": "T-14.09",
  "squads:gravar": "T-14.09",
  "squads:validar": "T-14.09",
  "squads:duplicar": "T-14.09",
  "squads:apagar": "T-14.09",
  "squads:fabrica_atualizacao": "T-14.09",
  "squads:fabrica_aplicar": "T-14.09",
  "squads:preflight": "T-14.16",
  "squads:enviar_prompt": "T-14.16",
  "squads:execucoes_listar": "T-14.16",
  "squads:exportar": "T-14.10",
  "squads:importar_previa": "T-14.10",
  "squads:importar_confirmar": "T-14.10",
  "agentes:listar": "T-14.09",
  "agentes:prompt_ler": "T-14.21",
  "agentes:prompt_gravar": "T-14.21",
  "agentes:prompt_previa": "T-14.21",
  "agentes:prompt_restaurar": "T-14.21",
  "agentes:perfil_opcoes": "T-14.05",
  "agentes:abrir_pane": "T-14.17",
};
const CANAIS_COM_MANIPULADOR: readonly string[] = [];

type Entrada = Record<string, unknown>;
const val = (canal: keyof typeof VALIDADORES_SQUADS, v: unknown) => (VALIDADORES_SQUADS[canal] as (x: unknown) => { ok: boolean; erro?: string })(v);

function membro(slug: string, papel: Membro["papel"], extra: Partial<Membro> = {}): Membro {
  return {
    slug,
    papel,
    rotulo: slug,
    descricao: "faz algo",
    prompt: `membros/${slug}.md`,
    perfil: { cli: "claude", modelo: "sonnet", esforco: "medio", faixa: "medio" },
    skills_permitidas: ["ev-builder"],
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
    slug: "minha-squad",
    nome: "Minha squad",
    descricao: "d",
    escopo: "desenvolvimento",
    rigidez_padrao: null,
    max_instancias_paralelas: 6,
    orcamento: { tempo_min: 60, tokens: null, modo: "rigido" },
    portoes: null,
    fabrica: null,
    origem: "usuario",
    membros: [membro("orq", "orchestrator"), membro("impl", "executor", { max_instancias: 2 }), membro("rev", "reviewer")],
    ...extra,
  };
}
const gravar = (s: unknown, hash: string | null = null) => val("squads:gravar", { squad: s, hash_esperado: hash });
const HASH = "a".repeat(64);
const WS = "ws_01HZZZZZZZZZZZZZZZZZZZZZZZ";

describe("contrato Fase 14: todo canal tem validador estrito", () => {
  const doContrato = [...CANAIS_INVOKE, ...CANAIS_ENVIO].filter((c) => /^(squads|agentes):/.test(c)).sort();

  it("cada canal squads:/agentes: do contrato tem validador e nenhum validador é órfão", () => {
    expect(Object.keys(VALIDADORES_SQUADS).sort()).toEqual(doContrato);
    for (const c of doContrato) expect(typeof (VALIDADORES_SQUADS as Record<string, unknown>)[c], c).toBe("function");
    expect(doContrato).toHaveLength(21);
    expect(CANAIS_EVENTO).toContain("squads:evento");
  });

  it("canal sem manipulador está na lista com a task T-14.NN; a lista não mente", () => {
    for (const [canal, task] of Object.entries(CANAIS_SQUADS_SEM_MANIPULADOR_AINDA)) {
      expect(doContrato, canal).toContain(canal);
      expect(task, canal).toMatch(/^T-14\.\d{2}$/);
      expect(CANAIS_COM_MANIPULADOR, canal).not.toContain(canal);
    }
    const cobertos = new Set([...Object.keys(CANAIS_SQUADS_SEM_MANIPULADOR_AINDA), ...CANAIS_COM_MANIPULADOR]);
    expect([...cobertos].sort()).toEqual(doContrato);
  });
});

describe("validadores squads: gravar", () => {
  it("aceita squad válida e devolve cópia reconstruída (não o objeto recebido)", () => {
    const entrada = { squad: squad(), hash_esperado: null };
    const r = VALIDADORES_SQUADS["squads:gravar"](entrada);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor).toEqual(entrada);
      expect(r.valor.squad).not.toBe(entrada.squad);
    }
  });

  it("recusa campo extra e tipo errado, na squad e no membro", () => {
    expect(gravar({ ...squad(), extra: 1 }).ok).toBe(false);
    expect(gravar({ ...squad(), membros: [{ ...membro("orq", "orchestrator"), cwd: "/x" }] }).ok).toBe(false);
    expect(gravar({ ...squad(), nome: 42 }).ok).toBe(false);
    expect(val("squads:gravar", { squad: squad(), hash_esperado: null, extra: 1 }).ok).toBe(false);
    expect(gravar(squad(), "curto").ok).toBe(false);
    expect(gravar(squad(), HASH).ok).toBe(true);
  });

  it("exige EXATAMENTE 1 orquestrador no gravar; no validar a squad sem orquestrador passa (vira achado)", () => {
    const sem = squad({ membros: [membro("impl", "executor"), membro("rev", "reviewer"), membro("exp", "scout")] });
    const dois = squad({ membros: [membro("orq", "orchestrator"), membro("orq2", "orchestrator"), membro("rev", "reviewer")] });
    expect(gravar(sem)).toMatchObject({ ok: false, erro: expect.stringContaining("exatamente 1 orquestrador") });
    expect(gravar(dois).ok).toBe(false);
    expect(val("squads:validar", { squad: sem, workspace_id: null }).ok).toBe(true);
  });

  it("recusa slug de squad/membro fora do padrão e nome/arquivo com caminho", () => {
    for (const slug of ["Maiusculo", "-comeca", "com espaço", "../x", "a/b", "x".repeat(41), ""]) {
      expect(gravar(squad({ slug })).ok, slug).toBe(false);
    }
    const m = (extra: Partial<Membro>) => squad({ membros: [membro("orq", "orchestrator", extra), membro("impl", "executor"), membro("rev", "reviewer")] });
    expect(gravar(m({ slug: "../orq", prompt: "membros/../orq.md" })).ok).toBe(false);
    expect(gravar(m({ prompt: "../../etc/passwd" })).ok).toBe(false);
    expect(gravar(m({ prompt: "/abs/orq.md" })).ok).toBe(false);
    expect(gravar(m({ prompt: "membros/outro.md" })).ok).toBe(false); // precisa ser membros/<slug>.md
    expect(gravar(m({ rotulo: "/etc/x" })).ok).toBe(false);
    expect(gravar(m({ rotulo: "https://x.io" })).ok).toBe(false);
    expect(gravar(squad({ nome: "C:\\pasta" })).ok).toBe(false);
  });

  it("recusa slug repetido e agent_id acima de 80", () => {
    expect(gravar(squad({ membros: [membro("orq", "orchestrator"), membro("rev", "reviewer"), membro("rev", "executor")] })).ok).toBe(false);
    const longo = "m".repeat(40);
    expect(gravar(squad({ slug: "s".repeat(40), membros: [membro(longo, "orchestrator"), membro("rev", "reviewer"), membro("exp", "scout")] })).ok).toBe(false);
  });

  it("recusa esforço e faixa desconhecidos, modelo com caminho/URL e CLI com formato inválido", () => {
    const p = (perfil: Partial<Membro["perfil"]>) => squad({ membros: [membro("orq", "orchestrator", { perfil: { cli: "claude", modelo: null, esforco: null, faixa: "alto", ...perfil } }), membro("rev", "reviewer"), membro("exp", "scout")] });
    expect(gravar(p({ esforco: "ultra" })).ok).toBe(false);
    expect(gravar(p({ esforco: "--dangerously" })).ok).toBe(false);
    expect(gravar(p({ faixa: "gigante" as never })).ok).toBe(false);
    expect(gravar(p({ modelo: "http://x" })).ok).toBe(false);
    expect(gravar(p({ modelo: "../x" })).ok).toBe(false);
    expect(gravar(p({ modelo: "x y" })).ok).toBe(false);
    expect(gravar(p({ cli: "/usr/bin/claude" })).ok).toBe(false);
    expect(gravar(p({ cli: "claude; rm" })).ok).toBe(false);
    for (const esforco of ["baixo", "alto", "low", "xhigh", null]) expect(gravar(p({ esforco })).ok, String(esforco)).toBe(true);
    expect(gravar(p({ cli: "auto", modelo: "anthropic/claude-sonnet", faixa: "topo" })).ok).toBe(true); // OpenRouter: modelo com "/"
  });

  it("limites: instâncias 1..8, orquestrador sempre 1, nível de rigidez 1..5, orçamento, permissão e portões", () => {
    const m = (extra: Partial<Membro>) => squad({ membros: [membro("orq", "orchestrator"), membro("impl", "executor", extra), membro("rev", "reviewer")] });
    expect(gravar(m({ max_instancias: 9 })).ok).toBe(false);
    expect(gravar(m({ max_instancias: 0 })).ok).toBe(false);
    expect(gravar(m({ max_instancias: 1.5 })).ok).toBe(false);
    expect(gravar(m({ max_instancias: 8 })).ok).toBe(true);
    expect(gravar(squad({ membros: [membro("orq", "orchestrator", { max_instancias: 2 }), membro("rev", "reviewer"), membro("exp", "scout")] })).ok).toBe(false);
    expect(gravar(m({ rigidez: 6 as never })).ok).toBe(false);
    expect(gravar(m({ rigidez: 0 as never })).ok).toBe(false);
    expect(gravar(m({ rigidez: 5 })).ok).toBe(true);
    expect(gravar(squad({ rigidez_padrao: 3 })).ok).toBe(true);
    expect(gravar(squad({ rigidez_padrao: "3" as never })).ok).toBe(false);
    expect(gravar(squad({ max_instancias_paralelas: 9 })).ok).toBe(false);
    expect(gravar(squad({ orcamento: { tempo_min: 1441, tokens: null, modo: "soft" } })).ok).toBe(false);
    expect(gravar(squad({ orcamento: { tempo_min: 5, tokens: null, modo: "abortar" as never } })).ok).toBe(false);
    expect(gravar(m({ permissao: "equilibrado" })).ok).toBe(true);
    expect(gravar(m({ permissao: "bypass" as never })).ok).toBe(false);
    expect(gravar(squad({ portoes: ["build", "qa"] })).ok).toBe(true);
    expect(gravar(squad({ portoes: ["build", "build"] })).ok).toBe(false);
    expect(gravar(squad({ portoes: ["deploy" as never] })).ok).toBe(false);
    expect(gravar(squad({ membros: Array.from({ length: 13 }, (_, i) => membro(`m${i}`, i === 0 ? "orchestrator" : "executor")) })).ok).toBe(false);
  });

  it("skills/MCPs/hooks: sem caminho nem URL, sem repetição", () => {
    const m = (extra: Partial<Membro>) => squad({ membros: [membro("orq", "orchestrator"), membro("impl", "executor", extra), membro("rev", "reviewer")] });
    expect(gravar(m({ skills_permitidas: ["ev-builder", "grupo:metodo"] })).ok).toBe(true);
    expect(gravar(m({ skills_permitidas: ["../x"] })).ok).toBe(false);
    expect(gravar(m({ mcps_permitidos: ["https://evil.io/mcp"] })).ok).toBe(false);
    expect(gravar(m({ skills_permitidas: ["a", "a"] })).ok).toBe(false);
    expect(gravar(m({ hooks: ["/bin/sh"] })).ok).toBe(false);
  });
});

describe("validadores agentes: prompt", () => {
  const gp = (texto: unknown) => val("agentes:prompt_gravar", { agent_id: "minha-squad.impl", texto, hash_esperado: HASH });

  it("aceita variáveis fechadas (com espaço) e recusa variável fora do conjunto", () => {
    expect(gp("# {{rotulo}} em {{ squad }}\nObjetivo: {{objetivo}} {{contexto_rag}} {{arquivos}} {{membro}} {{missao}} {{card}} {{pasta}} {{rigor}}").ok).toBe(true);
    expect(gp("{{foo}}")).toMatchObject({ ok: false, erro: expect.stringContaining("variável desconhecida: foo") });
    expect(gp("{{ __proto__ }}").ok).toBe(false);
    expect(gp("{{objetivo}} e {{senha}}").ok).toBe(false);
  });

  it("recusa prompt > 16 KiB (em bytes), vazio, com NUL/controle e tipo errado", () => {
    expect(gp("a".repeat(16384)).ok).toBe(true);
    expect(gp("a".repeat(16385)).ok).toBe(false);
    expect(gp("é".repeat(8193)).ok).toBe(false); // 16 386 bytes
    expect(gp("").ok).toBe(false);
    expect(gp("a\0b").ok).toBe(false);
    expect(gp("a\u0007b").ok).toBe(false);
    expect(gp("linha\n\tcom tab\r\n").ok).toBe(true);
    expect(gp(42).ok).toBe(false);
    expect(vPromptTexto("{{x}}").ok).toBe(false);
  });

  it("agent_id sempre <squad>.<membro>; hash_esperado sha256; campo extra recusado", () => {
    for (const agent_id of ["so-squad", "a.b.c", "../x.y", "a/b.c", "A.b", "a.b/../c"]) {
      expect(val("agentes:prompt_ler", { agent_id }).ok, agent_id).toBe(false);
    }
    expect(val("agentes:prompt_ler", { agent_id: "feature-fullstack.orquestrador" }).ok).toBe(true);
    expect(val("agentes:prompt_gravar", { agent_id: "a.b", texto: "x", hash_esperado: "zz" }).ok).toBe(false);
    expect(val("agentes:prompt_gravar", { agent_id: "a.b", texto: "x", hash_esperado: HASH, cwd: "/x" }).ok).toBe(false);
  });

  it("prévia: precisa de agent_id ou texto; texto com variável desconhecida e arquivos de exemplo com caminho absoluto são recusados", () => {
    expect(val("agentes:prompt_previa", { agent_id: null }).ok).toBe(false);
    expect(val("agentes:prompt_previa", { agent_id: null, texto: "oi {{objetivo}}" }).ok).toBe(true);
    expect(val("agentes:prompt_previa", { agent_id: "a.b" }).ok).toBe(true);
    expect(val("agentes:prompt_previa", { agent_id: null, texto: "{{nope}}" }).ok).toBe(false);
    expect(val("agentes:prompt_previa", { agent_id: "a.b", exemplo: { objetivo: "x", arquivos: ["src/a.ts"] } }).ok).toBe(true);
    expect(val("agentes:prompt_previa", { agent_id: "a.b", exemplo: { objetivo: "x", arquivos: ["/etc/passwd"] } }).ok).toBe(false);
    expect(val("agentes:prompt_previa", { agent_id: "a.b", exemplo: { objetivo: "x", arquivos: ["../fora"] } }).ok).toBe(false);
  });
});

describe("validadores squads: execução, apagar, portabilidade e listagens", () => {
  const pedido = (extra: Entrada = {}) => ({ workspace_id: WS, squad_slug: "feature-fullstack", objetivo: "faça X", plano_antes: null, rigidez: null, max_paralelos: null, ...extra });

  it("enviar_prompt: objetivo ≤ 4 000 e não vazio; rigidez 1..5; paralelos 1..8; sem campo extra/caminho", () => {
    expect(val("squads:enviar_prompt", pedido()).ok).toBe(true);
    expect(val("squads:enviar_prompt", pedido({ objetivo: "a".repeat(4000), plano_antes: true, rigidez: 2, max_paralelos: 6 })).ok).toBe(true);
    expect(val("squads:enviar_prompt", pedido({ objetivo: "a".repeat(4001) })).ok).toBe(false);
    expect(val("squads:enviar_prompt", pedido({ objetivo: "   " })).ok).toBe(false);
    expect(val("squads:enviar_prompt", pedido({ objetivo: "a\0b" })).ok).toBe(false);
    expect(val("squads:enviar_prompt", pedido({ rigidez: 6 })).ok).toBe(false);
    expect(val("squads:enviar_prompt", pedido({ max_paralelos: 9 })).ok).toBe(false);
    expect(val("squads:enviar_prompt", pedido({ plano_antes: "sim" })).ok).toBe(false);
    expect(val("squads:enviar_prompt", pedido({ cwd: "/tmp" })).ok).toBe(false);
    expect(val("squads:enviar_prompt", pedido({ workspace_id: "/home/x" })).ok).toBe(false);
    expect(val("squads:enviar_prompt", pedido({ squad_slug: "../x" })).ok).toBe(false);
  });

  it("apagar: confirmar_slug diferente do slug é recusado", () => {
    expect(val("squads:apagar", { slug: "x-1", confirmar_slug: "x-1" }).ok).toBe(true);
    expect(val("squads:apagar", { slug: "x-1", confirmar_slug: "x-2" })).toMatchObject({ ok: false, erro: expect.stringContaining("confirmar_slug") });
    expect(val("squads:apagar", { slug: "x-1" }).ok).toBe(false);
  });

  it("exportar/importar: destino/origem fechados, repo exige workspace (e nome), nunca caminho", () => {
    expect(val("squads:exportar", { slug: "x", destino: "repo", workspace_id: WS }).ok).toBe(true);
    expect(val("squads:exportar", { slug: "x", destino: "arquivo" }).ok).toBe(true);
    expect(val("squads:exportar", { slug: "x", destino: "repo" }).ok).toBe(false);
    expect(val("squads:exportar", { slug: "x", destino: "/tmp/saida" }).ok).toBe(false);
    expect(val("squads:exportar", { slug: "x", destino: "arquivo", caminho: "/tmp/x" }).ok).toBe(false);
    expect(val("squads:importar_previa", { origem: "repo", workspace_id: WS, nome: "x" }).ok).toBe(true);
    expect(val("squads:importar_previa", { origem: "repo", workspace_id: WS, nome: "../x" }).ok).toBe(false);
    expect(val("squads:importar_previa", { origem: "repo" }).ok).toBe(false);
    expect(val("squads:importar_previa", { origem: "arquivo" }).ok).toBe(true);
    expect(val("squads:importar_previa", { origem: "arquivo", nome: "x" }).ok).toBe(false);
    expect(val("squads:importar_confirmar", { previa_id: "prv_12345678" }).ok).toBe(true);
    expect(val("squads:importar_confirmar", { previa_id: "../../x" }).ok).toBe(false);
    expect(val("squads:importar_confirmar", { previa_id: "prv_12345678", slug: "novo" }).ok).toBe(true);
  });

  it("listar/obter/duplicar/fábrica/preflight/execuções/perfil/abrir_pane: estritos", () => {
    expect(val("squads:listar", {}).ok).toBe(true);
    expect(val("squads:listar", { busca: "bug", origem: "fabrica" }).ok).toBe(true);
    expect(val("squads:listar", { origem: "terceiros" }).ok).toBe(false);
    expect(val("squads:listar", { busca: "a".repeat(81) }).ok).toBe(false);
    expect(val("squads:obter", { slug: "a/b" }).ok).toBe(false);
    expect(val("squads:duplicar", { slug: "a", novo_slug: "b", novo_nome: "Nova" }).ok).toBe(true);
    expect(val("squads:duplicar", { slug: "a", novo_slug: "../b" }).ok).toBe(false);
    expect(val("squads:fabrica_aplicar", { slug: "a", membros: ["orq", "rev"] }).ok).toBe(true);
    expect(val("squads:fabrica_aplicar", { slug: "a", membros: ["../orq"] }).ok).toBe(false);
    expect(val("squads:preflight", { slug: "a", workspace_id: WS }).ok).toBe(true);
    expect(val("squads:preflight", { slug: "a" }).ok).toBe(false);
    expect(val("squads:execucoes_listar", { workspace_id: WS, limite: 100 }).ok).toBe(true);
    expect(val("squads:execucoes_listar", { workspace_id: WS, limite: 101 }).ok).toBe(false);
    expect(val("squads:execucoes_listar", { workspace_id: WS, limite: 10, cursor: "sqx_01HZZZZZZZZZZZZZZZZZZZZZZZ" }).ok).toBe(true);
    expect(val("squads:execucoes_listar", { workspace_id: WS, limite: 10, cursor: "x" }).ok).toBe(false);
    expect(val("agentes:perfil_opcoes", { cli: "opencode" }).ok).toBe(true);
    expect(val("agentes:perfil_opcoes", { cli: "../claude" }).ok).toBe(false);
    expect(val("agentes:listar", {}).ok).toBe(true);
    expect(val("agentes:listar", { squad: "A B" }).ok).toBe(false);
    expect(val("agentes:abrir_pane", { workspace_id: WS, agent_id: "a.b" }).ok).toBe(true);
    expect(val("agentes:abrir_pane", { workspace_id: WS, agent_id: "a.b", objetivo: "x".repeat(4001) }).ok).toBe(false);
    expect(val("agentes:abrir_pane", { workspace_id: WS, agent_id: "a.b", cwd: "/x" }).ok).toBe(false);
  });
});
