// T-14.06 · Rigor por nível de rigidez (Fase 14 Anexo B + Fase 16 piso). PURO: dados + funções.
// `snippetDeRigor` SOMA ao prompt do membro (nunca remove regras inalteráveis do papel). O PISO de qualidade
// (I1–I10 da Fase 16, versão que cabe no prompt) está em TODOS os níveis: baixar a rigidez nunca o remove.
import { NIVEIS_RIGIDEZ, type NivelRigidez, type PortaoMissao } from "../../compartilhado/squads";

export const NOME_NIVEL_RIGIDEZ: Readonly<Record<NivelRigidez, string>> = { 1: "Relâmpago", 2: "Leve", 3: "Padrão", 4: "Rigoroso", 5: "Total" };
export const NIVEL_RIGIDEZ_PADRAO: NivelRigidez = 3;

/** Piso de qualidade: idêntico em todos os níveis. Marcador estável (`PISO_DE_QUALIDADE`) para testes e auditoria. */
export const PISO_DE_QUALIDADE =
  "Piso de qualidade (vale em qualquer nível): ao menos um teste do comportamento alterado e a suíte afetada verde; nenhum segredo no código, log ou diff; nenhuma operação git destrutiva; as regras do seu papel e do handoff continuam valendo.";

const RIGOR: Readonly<Record<NivelRigidez, string>> = {
  1: "Rigor mínimo (Relâmpago): faça só o que foi pedido, com o menor caminho. Não amplie o escopo.",
  2: "Rigor leve: plano de uma linha; teste de regressão ou de integração do que mudou; revise o próprio diff antes de entregar. Evite explorar além do necessário.",
  3: "Rigor padrão: dois testes por card (integração e funcional), escopo travado no contrato, relatório com evidência, handoff completo.",
  4: "Rigor alto: teste antes do código (veja-o falhar), subconjunto e suíte verdes, revisão independente obrigatória, registre alternativas descartadas e riscos, nenhum 'depois eu vejo'.",
  5: "Rigor total: tudo do nível anterior, mais casos de borda e consequências de segunda ordem, verificação cruzada por outro agente, evidência anexada a cada critério de aceite e nenhuma pendência escondida.",
};

/** Texto PT-BR acrescentado ao prompt do membro (substitui `{{rigor}}`). Nível fora de 1..5 cai no padrão (3). Sempre inclui o piso. */
export function snippetDeRigor(nivel: number | null | undefined): string {
  const n = normalizarNivelRigidez(nivel);
  return `${RIGOR[n]}\n${PISO_DE_QUALIDADE}`;
}

export function normalizarNivelRigidez(nivel: number | null | undefined): NivelRigidez {
  return (NIVEIS_RIGIDEZ as readonly number[]).includes(nivel as number) ? (nivel as NivelRigidez) : NIVEL_RIGIDEZ_PADRAO;
}

/** Nível efetivo de um membro: o do membro, senão o da squad, senão o padrão. O nível "pedido" da Missão vem pela porta. */
export function rigidezEfetiva(...candidatos: Array<number | null | undefined>): NivelRigidez {
  for (const c of candidatos) if ((NIVEIS_RIGIDEZ as readonly number[]).includes(c as number)) return c as NivelRigidez;
  return NIVEL_RIGIDEZ_PADRAO;
}

export const PORTOES_MISSAO: readonly PortaoMissao[] = ["direction", "content", "build", "qa"];

export interface PoliticaDePortoes {
  liberar: PortaoMissao[];
  pendentes: PortaoMissao[];
  /** o revisor continua obrigatório em QUALQUER nível (o portão `qa` só libera o revisor; nunca dispensa a revisão). */
  revisor_obrigatorio: true;
}

/**
 * N1–N2 ou `planoAntes=false` ⇒ libera os 4 portões; N3 ⇒ só `build` pendente; N4 ⇒ `direction`+`build`; N5 ⇒ os 4 pendentes.
 * Em todos os casos `revisor_obrigatorio` é `true`.
 */
export function politicaDePortoes(nivel: number | null | undefined, planoAntes: boolean): PoliticaDePortoes {
  const n = normalizarNivelRigidez(nivel);
  let pendentes: PortaoMissao[];
  if (!planoAntes || n <= 2) pendentes = [];
  else if (n === 3) pendentes = ["build"];
  else if (n === 4) pendentes = ["direction", "build"];
  else pendentes = [...PORTOES_MISSAO];
  return { liberar: PORTOES_MISSAO.filter((p) => !pendentes.includes(p)), pendentes, revisor_obrigatorio: true };
}

/** Porta da Fase 16 (nível efetivo por escopo). Implementação padrão: 3. */
export interface PortaNivelRigidez {
  efetivo(ctx: { workspace_id: string; mission_id: string | null; squad_slug: string | null; membro_slug: string | null }): Promise<NivelRigidez>;
}
export const nivelRigidezPadrao: PortaNivelRigidez = { efetivo: () => Promise.resolve(NIVEL_RIGIDEZ_PADRAO) };
