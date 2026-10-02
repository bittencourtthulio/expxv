// Tipos internos do Bench. Os contratos que cruzam processos moram em `compartilhado/bench.ts`; aqui ficam as linhas do banco e o que só o núcleo vê (mapa cego, preço congelado).
import type { CriterioRubrica, CustoFonte, CustoTipo, EstadoResultado, EstadoRun, JuizEstado, ModoSandbox, PesosScore, ResultadoChecagem } from "../../compartilhado/bench";

export * from "../../compartilhado/bench";

export interface PrecoCongelado { provedor: string; modelo: string; preco_in_mtok: number; preco_out_mtok: number; preco_cache_mtok: number | null; vale_desde: string }
export interface ArtefatoRegistrado { nome: string; tipo: string; bytes: number; sha256: string }

/** Linha completa de `bench_resultado` (uso interno do núcleo e do serviço). */
export interface LinhaResultado {
  id: string;
  run_id: string;
  tarefa_slug: string;
  tarefa_versao: number;
  alvo_slug: string;
  tentativa: number;
  estado: EstadoResultado;
  workdir: string | null;
  log_ref: string | null;
  prompt_efetivo: string;
  duracao_s: number | null;
  custo_usd: number | null;
  custo_fonte: CustoFonte;
  custo_tipo: CustoTipo | null;
  preco: PrecoCongelado | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_total: number | null;
  turnos: number | null;
  revisoes: number | null;
  artefatos: ArtefatoRegistrado[];
  checagens: ResultadoChecagem[];
  isolamento: "garantido" | "parcial";
  juiz_estado: JuizEstado;
  qualidade: number | null;
  qualidade_detalhe: Partial<Record<CriterioRubrica, number>> | null;
  notas: string | null;
  aviso: string | null;
  cli_versao: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface LinhaRun {
  id: string;
  nome: string;
  tarefas: Array<{ slug: string; versao: number }>;
  alvos: string[];
  estado: EstadoRun;
  max_paralelo: number;
  teto_usd: number | null;
  juiz_alvo: string | null;
  pesos: PesosScore;
  sandbox: ModoSandbox;
  criado_em: string;
  iniciada_em: string | null;
  terminada_em: string | null;
}

export interface LinhaVeredito {
  id: string;
  run_id: string;
  tarefa_slug: string;
  tarefa_versao: number;
  juiz_modelo: string;
  /** INTERNO: rótulo cego → alvo. Nunca atravessa canal IPC/MCP. */
  mapa_cego: Record<string, string>;
  notas: Record<string, { nota: number; detalhe: Partial<Record<CriterioRubrica, number>> }>;
  ranking: string[];
  /** custo do juiz, registrado à PARTE (fora do score). */
  custo_juiz_usd: number | null;
  criado_em: string;
}

/** Erro de regra do Bench; chega ao renderer como `[codigo] texto`. */
export class ErroBench extends Error {
  override name = "ErroBench";
  constructor(readonly codigo: string, mensagem: string) {
    super(`[${codigo}] ${mensagem}`);
  }
}
