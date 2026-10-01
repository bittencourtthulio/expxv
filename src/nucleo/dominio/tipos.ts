import type {
  AcessoExterno,
  EstadoMissao,
  EstadoPane,
  EstadoTask,
  ModoMissao,
  OrigemMissao,
  Papel,
  Permissao,
  StatusHandoff,
  TipoPane,
} from "./enums";

/** Campos comuns. Datas em UTC ISO com milissegundos. */
interface Comum {
  id: string;
  criado_em: string;
  atualizado_em: string;
}

export interface Workspace extends Comum {
  nome: string;
  /** Caminho absoluto: só aqui (é do usuário). */
  raiz: string;
  e_git: boolean;
  acesso_externo: AcessoExterno;
  permissao: Permissao;
  ultimo_uso_em: string | null;
}

export interface Mission extends Comum {
  workspace_id: string;
  modo: ModoMissao;
  origem: OrigemMissao;
  trabalho_id: string | null;
  titulo: string;
  estado: EstadoMissao;
  worktree: string | null;
  branch: string | null;
  piloto_pane_id: string | null;
  concluida_em: string | null;
  /** Fase 14: slug da squad usada (`null` = sem squad). Opcional para não quebrar quem monta `Mission` à mão. */
  squad_id?: string | null;
}

export interface Pane extends Comum {
  mission_id: string | null;
  workspace_id: string;
  display_id: number;
  tipo: TipoPane;
  cli: string | null;
  executavel_id: string | null;
  conta_id: string | null;
  modelo: string | null;
  esforco: string | null;
  papel: Papel;
  eh_piloto: boolean;
  estado: EstadoPane;
  sessao_pty_id: string | null;
  respawn_de: string | null;
  cwd: string | null;
  encerrado_motivo: string | null;
  /** Fase 14: `"<squad>.<membro>"` (`null` = Pane sem agente). */
  agente_id?: string | null;
}

export interface Sessao extends Comum {
  pane_id: string;
  cli_ref_conversa: string | null;
  ultimo_uso_em: string | null;
}

export interface Conta extends Comum {
  provedor: string;
  rotulo: string;
  /** Referência ao diretório de configuração; segredo nunca. */
  config_dir_ref: string | null;
  habilitada: boolean;
}

export interface Task extends Comum {
  mission_id: string;
  task_ref: string;
  titulo: string;
  briefing_path: string | null;
  papel: Papel;
  estado: EstadoTask;
  pane_id: string | null;
  handoff_id: string | null;
}

export interface Handoff extends Comum {
  task_id: string;
  de_pane_id: string | null;
  para_pane_id: string | null;
  resumo: string;
  relatorio_path: string | null;
  status: StatusHandoff;
}

export interface Pagina<T> {
  itens: T[];
  /** Cursor (id do último item) para a próxima página; null quando acabou. */
  proximo: string | null;
}

export interface OpcoesPagina {
  /** 1..500, padrão 50. */
  limite?: number;
  /** `proximo` da página anterior. */
  depois?: string | null;
}
