// Portas (D-187): tudo que pertence a outras fases entra por aqui. Cada porta tem uma implementação `Indisponivel` determinística:
// a fase funciona e testa sozinha; porta ausente nunca lança, devolve null/vazio.
import type { EventoAgil } from "../../compartilhado/agil";
import type { EventoRastro, Severidade, Trabalho, VereditoTexto } from "../metodo/tipos";
import type { CommitFato } from "../../compartilhado/agil";

export interface AchadoQa { id: string; severidade: Severidade; categoria: string | null; task: string | null; arquivos: string[]; descricao: string }
export interface QaFonte { veredito: VereditoTexto | null; emitido_em: string | null; achados: AchadoQa[] }
export type CommitEntrega = CommitFato & { task_ref: string | null };

/** Um trabalho do método com tudo que o extrator de fatos precisa (montado a partir do modelo existente; só leitura). */
export interface FonteTrabalho {
  workspace_id: string;
  trabalho: Trabalho;
  rastro: EventoRastro[];
  commits: CommitEntrega[];
  qa: QaFonte | null;
  /** hash do que mudou no trabalho (mtime+tamanho ou conteúdo): igual => o sincronizador pula. */
  versao_origem: string;
}

export interface OcorrenciaRunx {
  id: string;
  tipo: string;
  aberta_em: string | null;
  /** trabalho_id do qual a ocorrência é regressão. */
  regressao_de: string | null;
  categoria: string | null;
  task_ref: string | null;
  arquivos: string[];
}

export interface PortaMetodo {
  fontes(workspaceId: string): Promise<FonteTrabalho[]>;
  ocorrencias(workspaceId: string): Promise<OcorrenciaRunx[]>;
  /** frontmatter (`dados`) de docs/sprintx/estimativas/HISTORICO.md, somente leitura; null se ausente. */
  historicoSprintx(workspaceId: string): Promise<Record<string, unknown> | null>;
}
export interface PortaCusto { janelas(workspaceId: string, trabalhoId: string, taskRef: string): Promise<{ ativo_ms: number; tokens: number | null } | null> }
export interface PortaBoard { colunas(workspaceId: string): Promise<string[] | null>; limiteWip(workspaceId: string, coluna: string): Promise<number | null> }
export interface SimilarRag { ref: string; titulo: string; pontos: number | null; categoria: string | null; duracao_obs_ms: number | null; retrabalho: boolean | null; similaridade: number }
export interface PortaRag { buscar(workspaceId: string, texto: string, opcoes: { tipos: string[]; limite: number }): Promise<SimilarRag[]> }
export interface RaioArquivos { faixa: "baixo" | "medio" | "alto" | null; sem_cobertura: boolean | null; zona_risco: boolean | null }
export interface PortaMapa { raio(workspaceId: string, arquivos: string[]): Promise<RaioArquivos | null> }
export interface PerfilEstimador { cli: string; modelo: string | null; faixa: string }
export interface PortaPerfil { resolver(workspaceId: string, skill: string, etapa: string): Promise<PerfilEstimador | null> }
export interface PortaHeadless { executar(p: { perfil: PerfilEstimador; entrada: string; tools: []; timeoutMs: number }): Promise<{ texto: string; tokens: number | null }> }
/** consentimento explícito (UI) para enviar o TEXTO das tasks ao provedor da CLI; ausente = não. */
export interface PortaConsentimento { estimativaPorIa(workspaceId: string): Promise<boolean> }
export interface PortaVcs { numstat(workspaceId: string, sha: string): Promise<number | null> }
export interface PortaForge { checksVerdes(workspaceId: string, trabalhoId: string): Promise<boolean | null>; reviews(workspaceId: string, trabalhoId: string): Promise<number | null> }
export interface PortaAlertas { publicar(evento: EventoAgil): void | Promise<void> }

export interface PortasAgil {
  metodo: PortaMetodo; custo: PortaCusto; board: PortaBoard; rag: PortaRag; mapa: PortaMapa; perfil: PortaPerfil;
  headless: PortaHeadless; consentimento: PortaConsentimento; vcs: PortaVcs; forge: PortaForge; alertas: PortaAlertas;
}

export const IndisponivelMetodo: PortaMetodo = { fontes: async () => [], ocorrencias: async () => [], historicoSprintx: async () => null };
export const IndisponivelCusto: PortaCusto = { janelas: async () => null };
export const IndisponivelBoard: PortaBoard = { colunas: async () => null, limiteWip: async () => null };
export const IndisponivelRag: PortaRag = { buscar: async () => [] };
export const IndisponivelMapa: PortaMapa = { raio: async () => null };
export const IndisponivelPerfil: PortaPerfil = { resolver: async () => null };
export const IndisponivelHeadless: PortaHeadless = { executar: async () => { throw new Error("headless indisponível"); } };
export const IndisponivelConsentimento: PortaConsentimento = { estimativaPorIa: async () => false };
export const IndisponivelVcs: PortaVcs = { numstat: async () => null };
export const IndisponivelForge: PortaForge = { checksVerdes: async () => null, reviews: async () => null };
export const IndisponivelAlertas: PortaAlertas = { publicar: () => undefined };

export function portasIndisponiveis(): PortasAgil {
  return {
    metodo: IndisponivelMetodo, custo: IndisponivelCusto, board: IndisponivelBoard, rag: IndisponivelRag, mapa: IndisponivelMapa,
    perfil: IndisponivelPerfil, headless: IndisponivelHeadless, consentimento: IndisponivelConsentimento, vcs: IndisponivelVcs,
    forge: IndisponivelForge, alertas: IndisponivelAlertas,
  };
}
