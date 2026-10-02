// Evento do histórico local de atualização (Fase 21, T-21.13; tabela `atualizacao_evento` em T-21.17). Sem dado pessoal, sem texto de servidor (D-25).
import {
  CANAIS_ATUALIZACAO,
  MOTIVOS_ATUALIZACAO,
  TIPOS_EVENTO_ATUALIZACAO,
  type AtualizacaoEvento,
  type CanalAtualizacao,
  type MotivoAtualizacao,
  type TipoEventoAtualizacao,
} from "../../compartilhado/atualizacao";
import { lerVersao } from "./versao";

export interface EntradaEvento {
  tipo: TipoEventoAtualizacao;
  canal: CanalAtualizacao;
  versao_de: string;
  versao_para?: string | null;
  motivo?: MotivoAtualizacao | null;
}

/** Monta o evento; entrada fora do contrato lança (é bug do chamador, nunca dado do servidor). Motivo só por código nominal. */
export function criarEvento(e: EntradaEvento, id: string, agora: Date): AtualizacaoEvento {
  if (!(TIPOS_EVENTO_ATUALIZACAO as readonly string[]).includes(e.tipo)) throw new Error("tipo de evento desconhecido");
  if (!(CANAIS_ATUALIZACAO as readonly string[]).includes(e.canal)) throw new Error("canal desconhecido");
  if (lerVersao(e.versao_de) === null) throw new Error("versao_de inválida");
  const para = e.versao_para ?? null;
  if (para !== null && lerVersao(para) === null) throw new Error("versao_para inválida");
  const motivo = e.motivo ?? null;
  if (motivo !== null && !(MOTIVOS_ATUALIZACAO as readonly string[]).includes(motivo)) throw new Error("motivo fora do vocabulário nominal");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new Error("id inválido");
  return { id, tipo: e.tipo, canal: e.canal, versao_de: e.versao_de, versao_para: para, motivo, criado_em: agora.toISOString() };
}
