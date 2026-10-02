// Política de aprovações dos workers (D-640 em diante): contrato entre main e renderer. Nada aqui carrega segredo, caminho absoluto nem token.
// O dono pediu workers AUTÔNOMOS (que não fiquem pedindo permissão); o padrão é o nível do meio, por allowlist, e o bypass total só existe
// dentro de um worktree isolado, com confirmação DIGITADA e as proibições `deny` mantidas.

export const NIVEIS_APROVACAO_WORKER = ["perguntar", "automatico_seguro", "total"] as const;
export type NivelAprovacaoWorker = (typeof NIVEIS_APROVACAO_WORKER)[number];

/** Padrão global para workspaces novos e para os que ainda não têm valor (o dono pediu workers autônomos; segurança como piso, não teto). */
export const NIVEL_APROVACAO_PADRAO: NivelAprovacaoWorker = "automatico_seguro";

/** Palavra que o dono digita para liberar o nível TOTAL. */
export const PALAVRA_LIBERAR_TUDO = "liberar tudo";

/** Quanto a CLI GARANTE o que o nível promete: `garantido` (a própria CLI aplica allow/deny), `parcial` (só parte é aplicada), `pergunta` (a CLI continua perguntando). */
export type SeloAprovacao = "garantido" | "parcial" | "pergunta";

export interface PreferenciaAprovacaoWorkers {
  /** `null` = o padrão global; senão o workspace. */
  workspace_id: string | null;
  /** nível configurado para o escopo (workspace sem valor próprio devolve o padrão global) */
  nivel: NivelAprovacaoWorker;
  /** o workspace tem valor próprio (`false` = herda o padrão global) */
  proprio: boolean;
  /** só workspace: aplicar a política automática também com a CLI na raiz do projeto do dono (padrão `false`) */
  permitir_raiz: boolean;
  /** só workspace: o projeto é confiável (`npm run` e afins executam código do repositório). Padrão `true`; `false` rebaixa para `perguntar`. */
  confiavel: boolean;
  /** padrão global vigente */
  padrao_global: NivelAprovacaoWorker;
}

export interface PedidoAprovacaoWorkers {
  /** `null` = o padrão global (Configurações); id = o workspace */
  workspace_id: string | null;
  nivel?: NivelAprovacaoWorker;
  /** só com `total`: a palavra digitada pelo dono (`liberar tudo`) */
  confirmacao?: string;
  permitir_raiz?: boolean;
  confiavel?: boolean;
  /** só workspace: `true` volta a herdar o padrão global */
  herdar?: boolean;
}

export interface DescricaoNivel {
  titulo: string;
  /** o que o agente pode fazer sozinho */
  pode: string;
  /** o que continua bloqueado ou perguntando */
  bloqueado: string;
}

export const DESCRICAO_NIVEL_APROVACAO: Readonly<Record<NivelAprovacaoWorker, DescricaoNivel>> = {
  perguntar: {
    titulo: "Perguntar sempre",
    pode: "Nada além do que a CLI já faz sem perguntar (ler arquivos, por exemplo).",
    bloqueado: "Cada edição, comando ou entrega pede a sua aprovação. O trabalho automático para esperando você.",
  },
  automatico_seguro: {
    titulo: "Automático seguro (recomendado)",
    pode: "Editar arquivos da pasta do próprio worker, ler o projeto, entregar o handoff, rodar testes, lint, build e comandos git do dia a dia (sem push).",
    bloqueado: "Push, apagar em massa, sudo, rede (curl/wget), ssh, ler .env e chaves, escrever fora da pasta do worker e abrir outros agentes.",
  },
  total: {
    titulo: "Total (bypass)",
    pode: "Tudo o que a CLI permite sem perguntar, só dentro de um worktree isolado.",
    bloqueado: "Mesmo assim ficam bloqueados push, apagar em massa, sudo, ssh, ler chaves e abrir agentes. Só vale no Claude Code; nas outras CLIs vira o automático seguro. Nunca na raiz do projeto.",
  },
};

export const ROTULO_SELO_APROVACAO: Readonly<Record<SeloAprovacao, string>> = {
  garantido: "garantido pela CLI",
  parcial: "parcial",
  pergunta: "a CLI pergunta sempre",
};

/** Texto curto do indicador no cabeçalho do painel e nos cartões ("aprovações: automático seguro"). */
export const ROTULO_CURTO_NIVEL_APROVACAO: Readonly<Record<NivelAprovacaoWorker, string>> = {
  perguntar: "perguntar sempre",
  automatico_seguro: "automático seguro",
  total: "total (bypass)",
};

export function ehNivelAprovacao(v: unknown): v is NivelAprovacaoWorker {
  return typeof v === "string" && (NIVEIS_APROVACAO_WORKER as readonly string[]).includes(v);
}

/** O nível pedido só pode ABAIXAR o configurado; nunca elevar. */
export function menorNivelAprovacao(a: NivelAprovacaoWorker, b: NivelAprovacaoWorker): NivelAprovacaoWorker {
  return NIVEIS_APROVACAO_WORKER[Math.min(NIVEIS_APROVACAO_WORKER.indexOf(a), NIVEIS_APROVACAO_WORKER.indexOf(b))] ?? "perguntar";
}

export function confirmacaoTotalValida(texto: string | null | undefined): boolean {
  return typeof texto === "string" && texto.trim().toLowerCase() === PALAVRA_LIBERAR_TUDO;
}

/**
 * Selo honesto por CLI para os níveis automáticos (a UI mostra antes de o dono escolher). Espelha `aprovacaoDoWorker` (um teste confere os dois).
 * `garantido`: a própria CLI aplica allow/deny e o bypass é controlável (Claude Code). `parcial`: só parte vale (Codex: sandbox do sistema sem lista de comandos;
 * OpenCode/Grok: regras por configuração ainda sem contrato validado). Demais CLIs: continuam perguntando.
 */
export const SELO_APROVACAO_POR_CLI: Readonly<Record<string, SeloAprovacao>> = { claude: "garantido", codex: "parcial", opencode: "parcial", grok: "parcial" };
export const seloAprovacaoDaCli = (cli: string): SeloAprovacao => SELO_APROVACAO_POR_CLI[cli] ?? "pergunta";
