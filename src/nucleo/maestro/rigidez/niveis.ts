// T-16.14 · Os cinco níveis de rigidez (nomes D-222; padrão 3). Dado puro: nome, semântica e as 2 linhas "ligado/desligado" da UI.
import { NIVEIS_RIGIDEZ, type NivelRigidez } from "../../../compartilhado/maestro";
import { NOME_NIVEL_RIGIDEZ, NIVEL_RIGIDEZ_PADRAO } from "../../squads/rigor";

export { NIVEIS_RIGIDEZ, NIVEL_RIGIDEZ_PADRAO, NOME_NIVEL_RIGIDEZ };

export interface DescricaoNivel {
  nivel: NivelRigidez;
  nome: string;
  semantica: string;
  ligado: string;
  desligado: string;
  quando: string;
}

export const NIVEIS: Readonly<Record<NivelRigidez, DescricaoNivel>> = {
  1: { nivel: 1, nome: "Relâmpago", semantica: "Um terminal, sem fases do método: faz só o pedido, com o piso de qualidade.", ligado: "um terminal, teste do que mudou, suíte verde, varredura de segredo", desligado: "fases do método, QA, entrega completa, hooks de método", quando: "mudança muito rápida e pontual (cor, texto, uma linha)" },
  2: { nivel: 2, nome: "Leve", semantica: "Etapas essenciais condensadas e agrupadas; QA enxuto em terminal separado; portão do mergex e PR.", ligado: "causa/plano/fix condensados, QA enxuto separado, mergex-check, PR", desligado: "atenção humana, pacote do QA, relatórios, hooks de escopo e plano", quando: "correção ou feature pequena de baixo risco" },
  3: { nivel: 3, nome: "Padrão", semantica: "O método como foi desenhado: um terminal por etapa, avaliador separado, mergex completo.", ligado: "todas as etapas do método, avaliador separado, entrega completa", desligado: "triagem do prodx, estimativa, stackx-check e designx-audit", quando: "uso normal" },
  4: { nivel: 4, nome: "Rigoroso", semantica: "Mais investigação e revisão: avaliador em provedor diferente, reauditoria até aprovar, hooks em bloqueio.", ligado: "revisor de testes, avaliador em outro provedor, hooks promovidos a bloqueio, portão estrito", desligado: "triagem do prodx e estimativa", quando: "mudança importante; raio ALTO força este nível" },
  5: { nivel: 5, nome: "Total", semantica: "Todas as etapas, inclusive triagem, estimativa, stackx-check e designx-audit, com dupla avaliação.", ligado: "todas as etapas, dupla auditoria/QA em provedores diferentes, quase todos os hooks em bloqueio", desligado: "nada do método fica de fora", quando: "sistema crítico, produção, pagamento, dado pessoal" },
};

export const ehNivel = (n: unknown): n is NivelRigidez => (NIVEIS_RIGIDEZ as readonly unknown[]).includes(n);
