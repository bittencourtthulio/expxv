// `window.ade` falso e populado para varrer as telas em jsdom (só teste).
import type { ApiAde } from "../../compartilhado/ipc";
import type { DetalheMissao, EstadoPortoes, Mission, Workspace } from "../../compartilhado/dominio";
import type { FerramentaDetectada } from "../../compartilhado/terminais";
import { indice, tk, trabalho } from "../telas/metodo/fabrica";
import { lojaMcpFalsa } from "../telas/loja-mcp/fabrica-teste";
import { cofreFalso, harnessFalso, limitesFalso, openrouterFalso } from "./ade-falso-harness";
import { memoriaFalso } from "./ade-falso-memoria";
import { maestroFalso } from "./ade-falso-maestro";
import { chatFalso, conhecimentoFalso, ragFalso } from "./ade-falso-conhecimento";
import { custoFalso } from "./ade-falso-custo";
import { workspacesFalsoComPainel } from "./ade-falso-painel";

export const ws = (id: string, extra: Partial<Workspace> = {}): Workspace => ({ id, nome: id, raiz: `/p/${id}`, e_git: true, acesso_externo: "leitura", permissao: "seguro", ultimo_uso_em: null, criado_em: "x", atualizado_em: "x", ...extra });
export const claude: FerramentaDetectada = { id: "claude", nome: "Claude Code", descricao: "CLI da Anthropic", instalado: true, executavel_id: "e1", modo_lancamento: "direto", erro_codigo: null, versao: "2.0", recursos: { prompt_inicial: true, retomar: true, mcp: true, hook: true } };
export const codex: FerramentaDetectada = { ...claude, id: "codex", nome: "Codex", instalado: false, executavel_id: null, erro_codigo: "ausente", versao: null };

export const missao: Mission = { id: "m1", workspace_id: "w1", modo: "squad", origem: "feature", trabalho_id: null, titulo: "Login", estado: "executando", worktree: null, branch: "feature/login", piloto_pane_id: "p1", concluida_em: null, criado_em: "x", atualizado_em: "x" };
export const detalhe: DetalheMissao = {
  mission: missao,
  panes: [{ id: "p1", mission_id: "m1", workspace_id: "w1", display_id: 3, tipo: "cli", cli: "claude", executavel_id: null, conta_id: null, modelo: null, esforco: null, papel: "piloto", eh_piloto: true, estado: "aguardando", sessao_pty_id: null, respawn_de: null, cwd: null, encerrado_motivo: null, criado_em: "x", atualizado_em: "x" }],
  tasks: [{ id: "t1", mission_id: "m1", task_ref: "T-1", titulo: "Criar rota", briefing_path: null, papel: "executor", estado: "aberta", pane_id: null, handoff_id: null, criado_em: "x", atualizado_em: "x" }],
  handoffs: [{ id: "h1", task_id: "t1", de_pane_id: null, para_pane_id: null, resumo: "Rota pronta", relatorio_path: null, status: "ok", criado_em: "x", atualizado_em: "x" }],
};

export const trabalhoExemplo = trabalho(
  [tk("T-1", { status: "concluida" }), tk("T-2", { depende_de: ["T-1"], status: "em_andamento" }), tk("T-3", { depende_de: ["T-2", "T-9"], status: "bloqueada" })],
  {
    sinaleira: { cor: "amarelo", motivo: "Auditoria pendente", motivos: [] },
    violacoes: [{ tipo: "bloqueio_antigo", trabalho_id: "minha-feature", alvo: "B-1", arquivo: "docs/x.md", detalhe: "aberto há 10 dias" }],
    entrega: { estado: "aberta", branch: "feat/x", portao: "PRONTO", pr_url: null, pr_estado: null, commits: 3, arquivo: "docs/mergex/E.md" },
  },
);

/** API completa; os métodos de terminais ficam de fora (a tela de Terminais é varrida à parte, com Terminal falso). */
export function criarAdeFalso(): ApiAde {
  const atual = ws("w1", { permissao: "automatico" });
  const api = {
    versao: async () => "0.0.0-teste",
    tema: { ler: async () => ({ preferencia: "escuro", efetivo: "escuro" }), definir: async (p: string) => ({ preferencia: p, efetivo: "escuro" }), assinar: () => () => undefined },
    menu: { assinar: () => () => undefined },
    config: { ler: async () => undefined, gravar: async () => ({ ok: true as const }) },
    perf: { ler: async () => ({}), marcar: () => undefined },
    workspaces: workspacesFalsoComPainel({
      estado: async () => ({ atual, recentes: [atual, ws("w2", { e_git: false, acesso_externo: "nenhum" })] }),
      abrir: async () => null, definirAtual: async () => null, remover: async () => true, definirPermissao: async () => null,
      worktrees: async () => [{ caminho: ".", branch: "main", principal: true, sujo: false }, { caminho: "../x--feat", branch: null, principal: false, sujo: true }],
      assinar: () => () => undefined,
    }),
    provedores: {
      listar: async () => [
        { ferramenta: claude, contas: [{ id: "c1", provedor: "claude", rotulo: "pessoal", config_dir_ref: null, habilitada: true, criado_em: "x", atualizado_em: "x" }] },
        { ferramenta: codex, contas: [] },
      ],
      criarConta: async () => ({}), habilitarConta: async () => null, diagnostico: async () => ({ texto: "ok" }),
    },
    missoes: {
      listar: async () => ({ itens: [missao, { ...missao, id: "m2", titulo: "Pagamentos", estado: "aguardando" }], proximo: null }),
      criar: async () => missao, detalhe: async () => detalhe, encerrar: async () => null, abortar: async () => null,
      portoes: async (): Promise<EstadoPortoes> => ({ mission_id: "m1", liberados: [], pendentes: ["plano", "execucao"] as never }),
      liberarPortao: async () => null, assinar: () => () => undefined,
    },
    metodo: {
      estado: async () => indice([trabalhoExemplo]),
      rastro: async () => ({ eventos: [{ ts: "2026-01-01T00:00:00Z", expx_eventos: 1, trabalho_id: "minha-feature", ferramenta: "sprintx", origem: "hook", evento: "task_concluida", fase: null, task: "T-1", agente: "claude", resultado: "ok", detalhe: "ok", arquivos: [] }], proximo: 1 }),
      comandoSugerido: async () => ({ comando: "/expx:sprintx", pane_separado: false, somente_humano: false, motivo_bloqueio: null }),
      disparar: async () => ({ ok: true, comando: "/expx:sprintx", pane_id: "p1" }),
      assinar: () => () => undefined,
    },
    limites: limitesFalso(),
    harness: harnessFalso(),
    openrouter: openrouterFalso(),
    cofre: cofreFalso(),
    lojaMcp: lojaMcpFalsa(),
    memoria: memoriaFalso(),
    conhecimento: conhecimentoFalso(),
    chat: chatFalso(),
    rag: ragFalso(),
    ...maestroFalso(),
    ...custoFalso(),
  };
  return api as unknown as ApiAde;
}

export const instalar = (): void => { (globalThis as unknown as { ade: unknown }).ade = criarAdeFalso(); };
export const remover = (): void => { delete (globalThis as { ade?: unknown }).ade; };
