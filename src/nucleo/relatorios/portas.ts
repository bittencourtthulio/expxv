// Portas (padrão D-187): tudo que pertence a outras fases entra por aqui. Cada porta tem uma implementação `Indisponivel*` determinística: a fase
// gera o pacote só com o que a gestão ágil entrega; porta ausente nunca lança. Relógio e ids são injetados (testes determinísticos).
import type { FatoTask, ItemAgil, ItemResumo, PainelAgil, SprintAgil, SprintItemAgil } from "../../compartilhado/agil";
import type { CanalDivulgacao, EstadoDado } from "../../compartilhado/relatorios";
import type { Scrub } from "./seguranca";
import { scrubNulo } from "./seguranca";

/** um item da sprint com tudo que o extrator de fatos precisa (montado a partir da gestão ágil; só leitura). */
export interface ItemBruto { item: ItemAgil; resumo: ItemResumo; fato: FatoTask | null; resultado: SprintItemAgil["resultado"] }
export interface SprintBruta { sprint: SprintAgil; itens: ItemBruto[]; painel: PainelAgil | null }
export interface SprintFechadaResumo { id: string; nome: string; fechada_em: string | null; versao_lancamento: string | null }
export interface PortaAgil {
  sprint(workspaceId: string, sprintId: string): Promise<SprintBruta | null>;
  sprintsFechadas(workspaceId: string): Promise<SprintFechadaResumo[]>;
}
export interface PrVcs { trabalho_id: string; url: string; estado: string | null }
/** commits/PRs do versionamento (Fase 6). `null` = não sabe. */
export interface PortaVersionamento { prs(workspaceId: string, trabalhoIds: readonly string[]): Promise<PrVcs[] | null> }
/** custo da sprint (Fase 10): `custo desconhecido ≠ 0`. */
export interface PortaCusto { sprint(workspaceId: string, tasks: readonly { trabalho_id: string; task_ref: string }[]): Promise<{ tokens: number | null; usd: number | null; estado: EstadoDado } | null> }
/** mapa de código (Fase 17): módulos tocados e alterações de arquitetura. Recebe caminhos RELATIVOS. */
export interface PortaMapa { alteracoes(workspaceId: string, arquivos: readonly string[]): Promise<{ modulos: { nome: string; arquivos: number }[]; ciclos: number | null; pontos_quentes: string[] } | null> }
export interface PerfilRedacao { cli: string; modelo: string | null; faixa: string }
export interface PortaPerfil { resolver(workspaceId: string): Promise<PerfilRedacao | null> }
/** execução headless SEM ferramentas (D-88): a entrada já vem saneada; o texto de volta é dado não confiável. */
export interface PortaHeadless { executar(p: { perfil: PerfilRedacao; entrada: string; tools: []; timeoutMs: number }): Promise<{ texto: string; tokens: number | null }> }
/** raiz do workspace (absoluta, só para o main/armazenamento; nunca entra em artefato). */
export interface PortaWorkspace { raiz(workspaceId: string): string | null }
export interface ResultadoEnvioCanal { ok: boolean; erro: string | null }
/** canais já existentes (Fase 20: Telegram/alertas) atrás de uma interface; o consentimento é conferido ANTES de chamar. */
export interface PortaCanais {
  disponiveis(workspaceId: string): Promise<CanalDivulgacao[]>;
  enviar(workspaceId: string, canal: CanalDivulgacao, texto: string): Promise<ResultadoEnvioCanal>;
}
export interface PortaEventos { publicar(tipo: string, payload: Record<string, unknown>): void }

export interface PortasRelatorios {
  agil: PortaAgil; versionamento: PortaVersionamento; custo: PortaCusto; mapa: PortaMapa; perfil: PortaPerfil; headless: PortaHeadless;
  workspace: PortaWorkspace; canais: PortaCanais; eventos: PortaEventos; scrub: Scrub;
}

export const IndisponivelAgil: PortaAgil = { sprint: async () => null, sprintsFechadas: async () => [] };
export const IndisponivelVersionamento: PortaVersionamento = { prs: async () => null };
export const IndisponivelCusto: PortaCusto = { sprint: async () => null };
export const IndisponivelMapa: PortaMapa = { alteracoes: async () => null };
export const IndisponivelPerfil: PortaPerfil = { resolver: async () => null };
export const IndisponivelHeadless: PortaHeadless = { executar: async () => { throw new Error("redator indisponível"); } };
export const IndisponivelWorkspace: PortaWorkspace = { raiz: () => null };
export const IndisponivelCanais: PortaCanais = { disponiveis: async () => [], enviar: async () => ({ ok: false, erro: "canal indisponível" }) };
export const EventosNulos: PortaEventos = { publicar: () => undefined };

export function portasIndisponiveis(): PortasRelatorios {
  return {
    agil: IndisponivelAgil, versionamento: IndisponivelVersionamento, custo: IndisponivelCusto, mapa: IndisponivelMapa, perfil: IndisponivelPerfil,
    headless: IndisponivelHeadless, workspace: IndisponivelWorkspace, canais: IndisponivelCanais, eventos: EventosNulos, scrub: scrubNulo,
  };
}
