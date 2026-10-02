// Máquina de estados do atualizador (Fase 21, T-21.13): desligado → ocioso → verificando → disponivel → baixando → verificado → pronto → instalando | erro.
// Reducer puro e total: evento inválido para o estado devolve o MESMO estado (nunca lança, nunca pula etapa).
import type { FaseAtualizacao } from "../../compartilhado/atualizacao";

export type EventoMaquina =
  | "ligar"
  | "desligar"
  | "verificar"
  | "achou_disponivel"
  | "achou_atual"
  | "falhou"
  | "baixar"
  | "baixado"
  | "hash_ok"
  | "cancelar"
  | "preparar"
  | "instalar"
  | "reiniciar_erro";

const TABELA: Record<FaseAtualizacao, Partial<Record<EventoMaquina, FaseAtualizacao>>> = {
  desligado: { ligar: "ocioso" },
  ocioso: { desligar: "desligado", verificar: "verificando" },
  verificando: { achou_disponivel: "disponivel", achou_atual: "ocioso", falhou: "erro", cancelar: "ocioso", desligar: "desligado" },
  disponivel: { baixar: "baixando", verificar: "verificando", desligar: "desligado" },
  baixando: { baixado: "verificado", falhou: "erro", cancelar: "disponivel", desligar: "desligado" },
  // `hash_ok` só existe depois de `baixado`: o arquivo só vira `pronto` depois de sha512 e tamanho conferidos
  verificado: { hash_ok: "pronto", falhou: "erro", cancelar: "disponivel", desligar: "desligado" },
  pronto: { instalar: "instalando", falhou: "erro", cancelar: "disponivel", verificar: "verificando", desligar: "desligado" },
  instalando: { falhou: "erro" },
  erro: { reiniciar_erro: "ocioso", desligar: "desligado", verificar: "verificando" },
};

export function transicao(fase: FaseAtualizacao, evento: EventoMaquina): FaseAtualizacao {
  return TABELA[fase][evento] ?? fase;
}

export function eventosValidos(fase: FaseAtualizacao): EventoMaquina[] {
  return Object.keys(TABELA[fase]) as EventoMaquina[];
}
