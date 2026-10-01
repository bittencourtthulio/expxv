// Modo "Precisão máxima" (P-27, OPT-IN por provedor). Obtém o % exato pela fonte OFICIAL que a própria CLI usa
// (arquivos de uso que ela grava ou o endpoint oficial dela), com consentimento explícito e VERSIONADO.
// Este módulo é só o PORTÃO e a normalização: quem toca credencial/rede é a `FonteOficial` injetada pelo main, que
// recebe o pedido, usa o token UMA vez em memória e devolve apenas o JSON de uso. O token NUNCA é guardado nem
// logado aqui (este arquivo nem sabe o que é um token). Padrão = desligado = nenhuma credencial é lida.
import type { FonteLimite, LimitSnapshot } from "../../../compartilhado/limites";
import { normalizarSnapshot } from "../validar";
import { INTERVALO_REDE_S, type AdaptadorLimite, type ContaLimite, type ContextoLeitura } from "./adaptador";

export const VERSAO_CONSENTIMENTO_PRECISAO = 1;
export const TEXTO_CONSENTIMENTO_PRECISAO =
  "Precisão máxima: para mostrar o consumo exato, o app consultará, a cada 5 minutos no máximo, o endpoint oficial que a própria CLI " +
  "deste provedor já usa, com o login que ela já possui. O token é usado apenas na memória, na hora da consulta, e nunca é salvo, " +
  "exibido nem registrado em log. Nada é enviado a terceiros. Você pode desligar quando quiser; desligado, o app não lê credencial alguma. " +
  "Confira os termos de uso do provedor.";

export interface ConfigPrecisaoMaxima {
  ativo: boolean;
  versao: number;
  /** ISO do consentimento. */
  em: string;
}
export const chaveConfigPrecisao = (provedor: string): string => `limites.precisao_maxima.${provedor}`;

/** Só vale com `ativo === true` E consentimento na versão atual do texto (texto mudou → pede de novo). */
export function precisaoMaximaAtiva(cfg: unknown): boolean {
  if (typeof cfg !== "object" || cfg === null) return false;
  const c = cfg as Partial<ConfigPrecisaoMaxima>;
  return c.ativo === true && c.versao === VERSAO_CONSENTIMENTO_PRECISAO && typeof c.em === "string" && c.em !== "";
}

/** Porta implementada pelo main. Devolve o JSON de uso (sem credencial) ou `null`. Pode lançar (conta no breaker). */
export interface FonteOficial {
  obter(conta: ContaLimite, ctx: ContextoLeitura): Promise<unknown | null>;
}

const FONTE_POR_PROVEDOR: Readonly<Record<string, FonteLimite>> = { claude: "claude_statusline", codex: "codex_rollout" };

export function criarAdaptadorPrecisaoMaxima(opcoes: { provedor: string; config: () => unknown; fonte: FonteOficial }): AdaptadorLimite {
  const fonteLimite = FONTE_POR_PROVEDOR[opcoes.provedor];
  return {
    id: `precisao_maxima_${opcoes.provedor}`,
    fonte: fonteLimite ?? "nenhuma",
    provedores: [opcoes.provedor],
    intervalo_min_s: INTERVALO_REDE_S,
    rede: true,
    aplicavel(conta) {
      return fonteLimite !== undefined && conta.provedor === opcoes.provedor && precisaoMaximaAtiva(opcoes.config());
    },
    async ler(conta, ctx): Promise<LimitSnapshot | null> {
      if (fonteLimite === undefined || !precisaoMaximaAtiva(opcoes.config())) return null; // revogado no meio do caminho
      const bruto = await opcoes.fonte.obter(conta, ctx);
      if (bruto === null || bruto === undefined) return null;
      const s = normalizarSnapshot(bruto, { id: conta.id, provedor: conta.provedor }, { agora: ctx.agora, fonte: fonteLimite });
      return s.status === "ok" ? s : null;
    },
  };
}
