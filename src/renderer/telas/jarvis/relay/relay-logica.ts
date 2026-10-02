// Lógica PURA da aba Relay (Fase 22): rótulos por forma E texto, impressão digital em grupos, contagem regressiva, mapeamento de erros e validação local da URL. Sem React, sem relógio global.
import { validarUrlRelay, type DispositivoRelay, type ErroLigarRelay, type ErroParearRelay, type EstadoRelay, type SituacaoPareamentoRelay, type SituacaoRelay } from "../../../../compartilhado/relay";
import { contagemRegressiva, tempoRelativo } from "../logica";

export { contagemRegressiva, tempoRelativo };
export type TomRelay = "neutro" | "ok" | "aviso" | "erro";

export const SITUACAO_RELAY: Record<SituacaoRelay, { forma: string; texto: string; tom: TomRelay }> = {
  desligado: { forma: "○", texto: "Desligado", tom: "neutro" },
  ocioso: { forma: "◌", texto: "Ligado, sem celulares pareados (nenhuma conexão aberta)", tom: "neutro" },
  conectando: { forma: "◐", texto: "Conectando ao relay…", tom: "aviso" },
  conectado: { forma: "●", texto: "Conectado ao relay", tom: "ok" },
  indisponivel: { forma: "▲", texto: "Relay indisponível (o app segue funcionando; tentando de novo)", tom: "erro" },
};

export const ERRO_LIGAR_RELAY: Record<ErroLigarRelay, string> = {
  consentimento_ausente: "Marque que leu o que o relay vê e o que não vê.",
  reconhecimento_ausente: "Marque que entendeu que o relay é experimental.",
  url_invalida: "Endereço inválido. Use wss:// com um nome de domínio (sem IP, sem usuário, sem parâmetros).",
  ja_ligado: "O relay já está ligado.",
  falhou: "Não foi possível ligar o relay agora.",
};
export const ERRO_PAREAR_RELAY: Record<ErroParearRelay, string> = {
  relay_desligado: "Ligue o relay antes de parear.",
  ja_pareando: "Já existe um pareamento aberto.",
  falhou: "Não foi possível abrir o pareamento agora.",
};
export const TEXTO_FIM_PAREAMENTO: Partial<Record<SituacaoPareamentoRelay, string>> = {
  concluido: "Celular pareado. Ele começa só com leitura; você pode mudar a permissão em «Controle remoto».",
  negado: "Pareamento recusado. Nada foi criado.",
  expirado: "O código expirou. Abra um novo pareamento.",
};

/** «abcd 1234 …»: aceita o texto cru ou já agrupado. */
export const agrupar4 = (t: string): string => (t.replace(/\s+/g, "").match(/.{1,4}/g) ?? []).join(" ");

/** `null` = válida; senão, o motivo em texto. Espelha `validarUrlRelay` (que é a regra de verdade, no contrato). */
export function erroDeUrl(url: string): string | null {
  const t = url.trim();
  if (t === "") return "Informe o endereço do seu relay (wss://…).";
  if (!/^wss:\/\//i.test(t)) return "O endereço precisa começar com wss://.";
  return validarUrlRelay(t) ? null : ERRO_LIGAR_RELAY.url_invalida;
}

export const textoDispositivo = (d: DispositivoRelay, agoraMs: number): string =>
  `${d.revogado_em !== null ? "revogado" : d.conectado ? "conectado agora" : `visto ${tempoRelativo(d.ultimo_visto_em, agoraMs)}`}`;
export const ROTULO_TRANSPORTE = { lan: "rede local", relay: "relay", ambos: "rede local e relay" } as const;

/** `relay · N` (N = celulares pareados pelo relay) só com o relay ligado; `null` some do rodapé. */
export function indicadorRelay(e: EstadoRelay | null): { forma: string; texto: string; tom: TomRelay } | null {
  if (e === null || !e.ligado) return null;
  const s = SITUACAO_RELAY[e.situacao];
  return { forma: s.forma, texto: `relay · ${e.dispositivos}`, tom: s.tom };
}
