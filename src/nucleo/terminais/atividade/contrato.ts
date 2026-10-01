import type { AtividadeTerminal, LinhaSubagente } from "../../../compartilhado/terminais";

export type { AtividadeTerminal, LinhaSubagente };

/** O que um adaptador entende do aviso bruto da CLI (hook, plugin...). Nada aqui é específico de uma ferramenta. */
export type SinalSubagente =
  | { tipo: "iniciado"; subagente_id: string; rotulo: string; descricao: string | null; arquivo: string | null }
  | { tipo: "concluido"; subagente_id: string; arquivo: string | null; resumo: string | null }
  /** CLIs sem transcript legível avisam a atividade diretamente (ex.: hooks de ferramenta). Anuncia o subagente se ainda não foi visto. */
  | { tipo: "atividade"; subagente_id: string; rotulo: string; linhas: LinhaSubagente[] };

export interface AlvoObservacao {
  /** URL local, exclusiva da sessão, que a CLI deve avisar (hooks). Leva o token da sessão. */
  url: string;
  sessao_id: string;
  /** Permissão do workspace da sessão (D-14). Adaptadores que precisam confiar em hooks do repositório só agem em `automatico`. */
  permissao: "seguro" | "automatico";
  /** Grava um arquivo de apoio da sessão (0600, `nome` pode ter subpastas) e devolve o caminho; some junto com a sessão. */
  gravarArquivo(nome: string, conteudo: string): string;
}

/** Argumentos e ambiente extras que fazem a CLI avisar o serviço; a sessão não muda em nada além disso. */
export interface ObservacaoSessao { argumentos: string[]; ambiente: Record<string, string> }

/**
 * Um adaptador por CLI. O serviço só conhece este contrato: para plugar outra CLI basta implementá-lo e
 * registrá-lo em `ADAPTADORES_ATIVIDADE`.
 */
export interface AdaptadorAtividade {
  readonly ferramenta_id: string;
  /** Gera a configuração de hook: argumentos de CLI que fazem a ferramenta avisar `alvo.url`. Nunca toca a configuração global da pessoa. */
  argumentosDeObservacao(alvo: AlvoObservacao): string[];
  /** Variáveis de ambiente extras (CLIs que se configuram por ambiente). Combine com o MCP por `combinarAmbientes`. */
  ambienteDeObservacao?(alvo: AlvoObservacao): Record<string, string>;
  /** Traduz o corpo bruto do aviso em sinal de subagente; `null` quando não é sobre subagente (ou está malformado). */
  interpretar(corpo: unknown): SinalSubagente | null;
  /** Traduz o aviso no que o agente principal faz (prompt, ferramenta, aprovação, fim); `null` quando não muda o estado. */
  interpretarAtividade?(corpo: unknown): AtividadeTerminal | null;
  /** Id da conversa da CLI, já validado; `null` quando o aviso não traz ou o id é inválido. Habilita "Retomar conversa". */
  conversaDoHook?(corpo: unknown): string | null;
  /** Traduz uma linha do arquivo seguido (transcript) em linhas de exibição; `[]` ignora. Sem transcript, devolva sempre `[]`. */
  analisarLinha(linha: string): LinhaSubagente[];
}
