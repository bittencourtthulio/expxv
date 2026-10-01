import type { AtividadeTerminal, EstadoSessao } from "../../../compartilhado/terminais";

/** O que a sinaleira precisa de cada sessão: o grupo (aba) a que pertence, se o processo vive e o que o agente faz. */
export interface AbaSemaforo { sessao_id: string; aba_id: string; estado: EstadoSessao; atividade?: AtividadeTerminal | undefined }

const PRIORIDADE: Record<AtividadeTerminal, number> = { aguardando: 3, trabalhando: 2, pronto: 1 };

/** Só sessão em execução tem atividade que valha: o aviso de um processo encerrado é resto do que ele fazia. */
const vale = (aba: AbaSemaforo): aba is AbaSemaforo & { atividade: AtividadeTerminal } => aba.estado === "executando" && aba.atividade !== undefined;

/** Atividade do grupo inteiro (raiz e divisões): aguardando > trabalhando > pronto. */
export function atividadeDoGrupo(abas: readonly AbaSemaforo[], abaId: string): AtividadeTerminal | undefined {
  let melhor: AtividadeTerminal | undefined;
  for (const aba of abas) {
    if (aba.aba_id !== abaId || !vale(aba)) continue;
    if (melhor === undefined || PRIORIDADE[aba.atividade] > PRIORIDADE[melhor]) melhor = aba.atividade;
  }
  return melhor;
}

export function contarAguardando(abas: readonly AbaSemaforo[]): number {
  return abas.filter((aba) => vale(aba) && aba.atividade === "aguardando").length;
}

/** A primeira sessão (na ordem das abas) que espera a pessoa; o contador do rodapé leva até ela. */
export function primeiraAguardando(abas: readonly AbaSemaforo[]): string | null {
  return abas.find((aba) => vale(aba) && aba.atividade === "aguardando")?.sessao_id ?? null;
}

export interface RotuloAtividade { forma: "anel" | "alerta" | "check"; glifo: string; texto: string }

/** Forma e texto de cada estado: a cor nunca é o único sinal (anel, "!" e "✓" + aria-label). */
export function rotuloDaAtividade(atividade: AtividadeTerminal | undefined): RotuloAtividade | null {
  if (atividade === "trabalhando") return { forma: "anel", glifo: "", texto: "trabalhando" };
  if (atividade === "aguardando") return { forma: "alerta", glifo: "!", texto: "aguardando você" };
  if (atividade === "pronto") return { forma: "check", glifo: "✓", texto: "pronto" };
  return null;
}

/** Texto do contador do rodapé. */
export function textoAguardando(n: number): string {
  return n === 1 ? "1 aguardando você" : `${n} aguardando você`;
}
