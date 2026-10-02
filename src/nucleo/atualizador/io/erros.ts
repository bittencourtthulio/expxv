// Erro nominal do atualizador: só o código (vocabulário fechado de `MOTIVOS_ATUALIZACAO`); nunca caminho, URL, cabeçalho ou texto de servidor.
import type { MotivoAtualizacao } from "../../../compartilhado/atualizacao";

export class AtualizacaoErro extends Error {
  constructor(readonly motivo: MotivoAtualizacao) {
    super(motivo);
    this.name = "AtualizacaoErro";
  }
}

/** Traduz erro da camada de rede (duck typing do `RedeErro.codigo`) ou do abort para um motivo nominal. */
export function motivoDeErro(e: unknown): MotivoAtualizacao {
  if (e instanceof AtualizacaoErro) return e.motivo;
  const codigo = typeof e === "object" && e !== null && "codigo" in e ? String((e as { codigo: unknown }).codigo) : "";
  switch (codigo) {
    case "redirect_outro_host":
    case "redirect_demais":
      return "redirecionamento_recusado";
    case "timeout":
    case "resposta_grande_demais":
      return "servidor_hostil";
    case "host_nao_permitido":
    case "https_obrigatorio":
      return "host_nao_permitido";
    case "consent_required":
      return "sem_consentimento";
    default:
  }
  if (typeof e === "object" && e !== null && "name" in e && (e as { name: unknown }).name === "AbortError") return "cancelado";
  return "falha_de_rede";
}
