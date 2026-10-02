// Portas do núcleo de alertas. Nada aqui conhece Electron, banco ou rede: o main injeta os adaptadores reais
// (repositório SQLite sobre as tabelas de `docs/ade/pedidos/20-pedidos.md`, barramento, cofre, relógio).
import type {
  AlertaVisao,
  CanalRegistro,
  EntregaRegistro,
  EstadoEntrega,
  Pagina,
  Regra,
  Severidade,
  TipoAlerta,
} from "../../compartilhado/alertas";

export interface Relogio {
  agora(): number;
}
export const relogioReal: Relogio = { agora: () => Date.now() };

export interface PortaBarramento {
  emitir(tipo: string, payload: unknown): void;
}

export interface ReferenciaTask {
  workspace_id: string;
  trabalho_id: string;
  task_id: string;
}

/** F10 `custo_agregado` escopo `card`. `fonte: "sem_fonte"` => tokens `null` (D-116: nunca zero). */
export interface PortaCusto {
  tokensDaTask(ref: ReferenciaTask): { entrada: number; saida: number; cache_escrita: number; cache_leitura: number; usd_conhecido: number | null; fonte: "medida" | "estimada" | "sem_fonte" };
}
/** F18. Tudo opcional: `null` = a fase não sabe. */
export interface PortaAgil {
  pontos(ref: ReferenciaTask): number | null;
  prazoSprint?(workspace_id: string, sprint_id: string): string | null;
  capacidadeRestanteMs?(sprint_id: string): number | null;
  estimativaRestanteMs?(sprint_id: string): number | null;
  feitoDePrimeira?(ref: ReferenciaTask): boolean | null;
}
export interface PortaConsumo {
  cotaGeralPct(): number | null;
}

export interface FiltroAlertas {
  estado?: "nao_lidos" | "todos" | "silenciados";
  tipos?: TipoAlerta[];
  severidade_min?: Severidade;
  workspace_id?: string;
  mission_id?: string;
  busca?: string;
  depois_id?: string | null;
  limite?: number;
}

export interface RepoAlertas {
  inserir(a: AlertaVisao): void;
  atualizar(id: string, patch: Partial<AlertaVisao>): void;
  obter(id: string): AlertaVisao | null;
  /** alerta mais recente com a mesma chave, NÃO lido, criado desde `desde_iso`. */
  recentePorDedupe(chave: string, desde_iso: string): AlertaVisao | null;
  listar(f: FiltroAlertas): Pagina<AlertaVisao>;
  contar(): { nao_lidos: number; criticos: number };
  marcarLido(ids: string[], em: string): number;
  silenciar(alvo: { tipo: TipoAlerta } | { entidade_tipo: string; entidade_id: string }, ate: string | null): number;
  apagarAntesDe(iso: string): number;
}

export interface RepoEntregas {
  /** idempotente: `UNIQUE (alerta_id, canal_id, regra_id)`. Devolve `false` se já existia. */
  inserir(e: EntregaRegistro): boolean;
  obter(id: string): EntregaRegistro | null;
  atualizar(id: string, patch: Partial<EntregaRegistro>): void;
  porEstado(estado: EstadoEntrega, limite: number): EntregaRegistro[];
  apagarAntesDe(iso: string): number;
}
export interface RepoRegras {
  listar(): Regra[];
  gravar(r: Regra): void;
  apagar(id: string): boolean;
}
export interface RepoCanais {
  listar(): CanalRegistro[];
  obter(id: string): CanalRegistro | null;
  gravar(c: CanalRegistro): void;
}
