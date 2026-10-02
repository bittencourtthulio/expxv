// Modelo de "Executar projeto" (D-430…): configurações de execução, estado do botão play/stop e eventos. Puro, sem Electron.
// O ADE só GRAVA na pasta do produto dentro do repositório do usuário (D-04): nunca em `docs/**` do método.
import { PRODUTO } from "../produto";
import type { ConfigExecucaoIpc, EstadoExecucao, FaseExecucao } from "../../compartilhado/executar";

export type {
  AvisoExecucaoIpc, ConfigExecucaoIpc, EntradaHistoricoExecutar, EstadoExecucao, EventoExecutar, FaseExecucao, ItemConfigExecucao, ListaExecucao, PedidoConfirmacaoExecutar, ResultadoIniciar, TipoExecucao,
} from "../../compartilhado/executar";

/** Arquivo versionável das configurações do usuário, relativo à raiz do workspace. */
export const ARQUIVO_CONFIG_EXECUTAR = `${PRODUTO.pastaNoProjeto}/executar.json`;
export const VERSAO_CONFIG_EXECUTAR = 1;

export const TIPOS_EXECUCAO = ["rodar", "build", "teste", "outro"] as const;

export const LIMITES_EXECUTAR = {
  configuracoes: 40,
  argumentos: 64,
  argumento_chars: 1_000,
  passos: 8,
  ambiente: 40,
  valor_ambiente_chars: 2_000,
  nome_chars: 60,
  linha_shell_chars: 2_000,
  historico: 20,
  /** teto de saída varrida por execução em busca de URL/porta (DoS por saída infinita) */
  saida_varrida_bytes: 2 * 1024 * 1024,
  /** cauda guardada entre pedaços (URL partida em dois pedaços) */
  cauda_chars: 512,
} as const;

/** Um comando: executável e argumentos SEPARADOS (nunca shell, AGENTS.md regra 10). */
export interface PassoExecucao {
  executavel: string;
  argumentos: string[];
}

/** Uma configuração de execução. `executavel`: nome no PATH (`npm`) ou caminho RELATIVO à raiz (`./gradlew`), nunca absoluto; `ambiente`: só variáveis
 * NÃO sensíveis (segredo só como `{{vault:NOME}}`); `shell`: linha para `sh -c`/`cmd /c`, opt-in explícito (com ela, executável/argumentos viram rótulo). */
export interface ConfigExecucao extends ConfigExecucaoIpc {
  origem: "detectada" | "usuario";
}

export interface ArquivoConfigExecutar {
  versao: 1;
  padrao: string | null;
  configuracoes: ConfigExecucao[];
}

export const ARQUIVO_VAZIO: ArquivoConfigExecutar = { versao: 1, padrao: null, configuracoes: [] };

// ---------------------------------------------------------------- estado / máquina
export const ESTADO_OCIOSO = (workspace_id: string): EstadoExecucao => ({
  fase: "ocioso", workspace_id, execucao_id: null, config_id: null, nome: null, tipo: null, passo: 0, passos_total: 0, sessao_id: null,
  iniciado_em: null, terminado_em: null, porta: null, url: null, codigo: null, sinal: null, mensagem: null,
});

export interface ResumoExecutarMcp {
  workspace_id: string;
  fase: FaseExecucao;
  config_id: string | null;
  nome: string | null;
  porta: number | null;
  url: string | null;
  codigo: number | null;
  mensagem: string | null;
  rodando_ha_s: number | null;
}
