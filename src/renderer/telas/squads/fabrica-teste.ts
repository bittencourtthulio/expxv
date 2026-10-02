// Fixtures de teste da tela Squads (só teste): API falsa de squads/agentes, squads e stores.
import { vi } from "vitest";
import type { Workspace } from "../../../compartilhado/dominio";
import type { Achado, Membro, OpcoesPerfilCli, Squad, SquadResumo } from "../../../compartilhado/squads";
import { criarStoreMissoes } from "../../estado/missoes";
import { criarStoreSquads } from "../../estado/squads";
import { criarStoreWorkspaces } from "../../estado/workspaces";

export const HASH = "a".repeat(64);
export const membro = (slug: string, papel: Membro["papel"], extra: Partial<Membro> = {}): Membro => ({
  slug, papel, rotulo: slug.charAt(0).toUpperCase() + slug.slice(1), descricao: `faz ${slug}`, prompt: `membros/${slug}.md`,
  perfil: { cli: "claude", modelo: "sonnet", esforco: "high", faixa: "alto" }, skills_permitidas: [], mcps_permitidos: [], hooks: [],
  max_instancias: papel === "orchestrator" ? 1 : 2, orcamento: { tempo_min: null, tokens: null, modo: "soft" }, rigidez: null, permissao: null, ...extra,
});
export const squad = (slug = "alfa", extra: Partial<Squad> = {}): Squad => ({
  slug, nome: `Squad ${slug}`, descricao: "d", escopo: "desenvolvimento", rigidez_padrao: null, max_instancias_paralelas: 4,
  orcamento: { tempo_min: null, tokens: null, modo: "soft" }, portoes: null, fabrica: null, origem: "usuario",
  membros: [membro("orq", "orchestrator"), membro("impl", "executor"), membro("rev", "reviewer", { perfil: { cli: "codex", modelo: "gpt-5", esforco: "medium", faixa: "alto" } })], ...extra,
});
export const resumo = (s: Squad, extra: Partial<SquadResumo> = {}): SquadResumo => ({
  slug: s.slug, nome: s.nome, escopo: s.escopo, origem: s.origem, membros: s.membros.length, clis: [...new Set(s.membros.map((m) => m.perfil.cli))],
  valida: true, atualizacao_de_fabrica: false, em_uso: false, hash: HASH, ...extra,
});
export const ws: Workspace = { id: "w1", nome: "proj", raiz: "/p", e_git: true, acesso_externo: "nenhum", permissao: "seguro", ultimo_uso_em: null, criado_em: "x", atualizado_em: "x" };
export const achado = (codigo: Achado["codigo"], caminho: string, severidade: Achado["severidade"] = "erro", mensagem = `msg ${codigo}`): Achado => ({ severidade, codigo, caminho, mensagem });

export const OPCOES: Record<string, OpcoesPerfilCli> = {
  claude: { modelos: [{ modelo: "sonnet", padrao: true }, { modelo: "opus" }], niveis_esforco: ["low", "medium", "high"], esforco_modo: "flag", instalada: true },
  codex: { modelos: [{ modelo: "gpt-5", padrao: true }], niveis_esforco: ["low", "medium", "high"], esforco_modo: "config", instalada: true },
  opencode: { modelos: [{ modelo: "x-1" }], niveis_esforco: [], esforco_modo: "indicativo", instalada: true },
};

export function montarApi(squads: Squad[], extra: { resumos?: Partial<SquadResumo>[]; achados?: Achado[] } = {}) {
  const porSlug = new Map(squads.map((s) => [s.slug, s]));
  const resumos = squads.map((s, i) => resumo(s, extra.resumos?.[i] ?? {}));
  const aoMudar: Array<(e: { slug: string; tipo: string }) => void> = [];
  const api = {
    squads: {
      listar: vi.fn(async () => resumos),
      obter: vi.fn(async (slug: string) => structuredClone(porSlug.get(slug) ?? squad(slug))),
      gravar: vi.fn(async (p: { squad: Squad }) => ({ ok: true as const, squad: p.squad, hash: "b".repeat(64), achados: [] as Achado[] })),
      validar: vi.fn(async () => extra.achados ?? []),
      duplicar: vi.fn(async (p: { slug: string }) => ({ ...structuredClone(porSlug.get(p.slug) ?? squad(p.slug)), slug: `${p.slug}-copia`, origem: "usuario" as const, fabrica: null })),
      apagar: vi.fn(async () => ({ ok: true as const })),
      fabricaAtualizacao: vi.fn(async () => ({ versao_nova: 2, membros: [{ membro: "orq", estado: "editado" as const }, { membro: "impl", estado: "atualizavel" as const }, { membro: "rev", estado: "igual" as const }] })),
      fabricaAplicar: vi.fn(async (slug: string) => structuredClone(porSlug.get(slug) ?? squad(slug))),
      fabricaDiff: vi.fn(async (p: { slug: string; membro: string }) => ({ membro: p.membro, estado: "editado" as const, atual: "minha linha\ncomum", fabrica: "linha da fábrica\ncomum" })),
      listarLixeira: vi.fn(async () => [] as Array<{ nome: string; slug: string; apagada_em: string | null }>),
      restaurarDaLixeira: vi.fn(async (nome: string) => squad(nome.replace(/-\d{14}-[0-9a-f]{4}$/, ""))),
      lerArquivoDaExecucao: vi.fn(async () => ({ existe: false, texto: null as string | null, truncado: false })),
      preflight: vi.fn(async () => ({ ok: true, avisos: [] as string[], substituicoes: [] as Array<{ membro: string; de: string; para: string }> })),
      enviarPrompt: vi.fn(async () => ({ execucao_id: "sqx_1234567890", mission_id: "m1", pane_id: "p1", avisos: [] as string[] })),
      listarExecucoes: vi.fn(async () => ({ itens: [], proximo: null })),
      exportar: vi.fn(async () => ({ caminho_relativo: ".x/squads/alfa" })),
      importarPrevia: vi.fn(),
      importarConfirmar: vi.fn(async () => squad("importada", { origem: "importada" })),
      assinar: vi.fn((cb: (e: { slug: string; tipo: string }) => void) => { aoMudar.push(cb); return () => undefined; }),
    },
    agentes: {
      listar: vi.fn(async (slug?: string) => (porSlug.get(slug ?? "")?.membros ?? []).map((m) => ({ agent_id: `${slug}.${m.slug}`, squad: slug!, rotulo: m.rotulo, papel: m.papel, perfil: m.perfil, vivos: 0 }))),
      lerPrompt: vi.fn(async () => ({ texto: "# {{rotulo}}\nObjetivo: {{objetivo}}", hash: HASH, editado: false })),
      gravarPrompt: vi.fn(async () => ({ ok: true as const, hash: "c".repeat(64), achados: [] as Achado[] })),
      previaPrompt: vi.fn(async (p: { texto?: string }) => ({ renderizado: `PREVIA ${p.texto ?? ""} <dado tipo="objetivo" aviso="x">\nexemplo\n</dado>`, variaveis_usadas: [], achados: [] as Achado[] })),
      restaurarPrompt: vi.fn(async () => ({ hash: HASH })),
      opcoesDePerfil: vi.fn(async (cli: string) => OPCOES[cli] ?? OPCOES["claude"]!),
      abrirPane: vi.fn(async () => ({ pane_id: "pane1" })),
    },
    emitir: (e: { slug: string; tipo: string }) => aoMudar.forEach((o) => o(e)),
  };
  const store = criarStoreSquads({ squads: () => api.squads as never, agentes: () => api.agentes as never, atrasoMs: 5 });
  return { api, store };
}

export async function storesDeApoio(atual: Workspace | null = ws) {
  const apiW = { estado: vi.fn().mockResolvedValue({ atual, recentes: atual ? [atual] : [] }), assinar: vi.fn(() => () => undefined), abrir: vi.fn(), definirAtual: vi.fn(), remover: vi.fn(), definirPermissao: vi.fn(), worktrees: vi.fn() };
  const workspaces = criarStoreWorkspaces({ api: () => apiW });
  await workspaces.iniciar();
  const apiM = { listar: vi.fn().mockResolvedValue({ itens: [], proximo: null }), criar: vi.fn(), detalhe: vi.fn().mockResolvedValue(null), encerrar: vi.fn(), abortar: vi.fn(), portoes: vi.fn().mockResolvedValue(null), liberarPortao: vi.fn().mockResolvedValue(null), assinar: vi.fn(() => () => undefined) };
  const missoes = criarStoreMissoes({ api: () => apiM });
  return { workspaces, missoes, apiM };
}
