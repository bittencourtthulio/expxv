// T-16.15 · Instruções de rigidez por etapa (linguagem natural). O ADE não escreve estado do método (D-04): grava só em `<pasta do produto>/maestro/<id>/`
// e passa ao comando um PONTEIRO no argumento (uma linha, ≤ 1 500). O método pode ignorar a instrução: a omissão é de despacho e o piso é verificado no disco.
import type { EtapaId, NivelRigidez, PipelineId } from "../../../compartilhado/maestro";
import { PRODUTO } from "../../produto";
import { PISO_DE_QUALIDADE } from "../../squads/rigor";
import { normalizarArgumento } from "../../metodo/comandos";
import { etapaDef } from "../etapas/catalogo";
import { celaDe, PARAMETROS_POR_NIVEL } from "./matriz";
import { NOME_NIVEL_RIGIDEZ } from "./niveis";

export const ARGUMENTO_MAX = 1500;
const ID_SEGURO = /^[A-Za-z0-9_-]{1,64}$/;

export const caminhoDeInstrucoes = (pipelineInstanciaId: string, etapa: EtapaId): string => {
  if (!ID_SEGURO.test(pipelineInstanciaId)) throw new Error("id de pipeline inválido");
  return `${PRODUTO.pastaNoProjeto}/maestro/${pipelineInstanciaId}/instrucoes-${etapa.split(".")[1]}.md`;
};

export function precisaDeInstrucoes(pipeline: PipelineId, etapa: EtapaId, nivel: NivelRigidez): boolean {
  const def = etapaDef(etapa);
  if (def === null || def.humano || def.tipo === "consulta") return false;
  const c = celaDe(pipeline, etapa, nivel);
  return !(nivel === 3 && c.modo === "roda" && def.tipo !== "implementador");
}

/** Texto das instruções (nunca contém segredo nem caminho absoluto). */
export function instrucoesDaEtapa(etapa: EtapaId, nivel: NivelRigidez, pipeline: PipelineId): string {
  const def = etapaDef(etapa);
  const nome = NOME_NIVEL_RIGIDEZ[nivel];
  const p = PARAMETROS_POR_NIVEL[nivel];
  const cela = celaDe(pipeline, etapa, nivel);
  const linhas: string[] = [
    `# Instruções do nível ${nivel} (${nome}) para ${def?.nome ?? etapa}`,
    "",
    "Esta é a configuração de rigidez escolhida pelo usuário no ADE. Ela orienta a profundidade; não substitui as regras da skill nem o piso abaixo.",
    "",
  ];
  if (cela.modo === "reduzida" && cela.nota !== undefined) linhas.push(`Redução permitida: ${cela.nota}.`);
  if (cela.modo === "reforco" && cela.nota !== undefined) linhas.push(`Reforço pedido: ${cela.nota}.`);
  if ((etapa === "sprintx.f2" || etapa === "prodx.p25" || etapa === "buildx.condutor") && p.densidade !== null && p.forma !== null) {
    linhas.push(`Densidade \`${p.densidade}\`, forma \`${p.forma}\` (escolhidas pelo usuário no ADE): considere o D-00 confirmado e registre-o; ${p.forma === "autonomo" ? "pesquise e registre hipóteses em vez de perguntar, exceto escopo de negócio e definição de pronto" : "conduza a entrevista"}.`);
  }
  if (def?.tipo === "implementador" || etapa === "rapido.executar") linhas.push(`Testes: ${p.testes.replace(/_/g, " ")}.`);
  if (def?.tipo === "avaliador") linhas.push("Você é o avaliador: quem implementa não aprova. Julgue só pelo que está no disco.");
  linhas.push("", PISO_DE_QUALIDADE, "");
  return linhas.join("\n");
}

/** Argumento final: base + ponteiro para o arquivo de instruções; uma linha, ≤ 1 500, sem controle. */
export function argumentoComInstrucoes(base: string | null, relInstrucoes: string, nivel: NivelRigidez): string | null {
  const sufixo = ` — rigidez ${NOME_NIVEL_RIGIDEZ[nivel]} (N${nivel}): siga ${relInstrucoes}`;
  const b = normalizarArgumento(base) ?? "";
  const limite = Math.max(0, ARGUMENTO_MAX - sufixo.length);
  const corpo = b.length > limite ? b.slice(0, limite).trimEnd() : b;
  return normalizarArgumento(`${corpo}${sufixo}`);
}

export interface PortaGravarTexto {
  gravar(rel: string, texto: string): Promise<void>;
}
export async function gravarInstrucoes(porta: PortaGravarTexto, pipelineInstanciaId: string, etapa: EtapaId, nivel: NivelRigidez, pipeline: PipelineId): Promise<string> {
  const rel = caminhoDeInstrucoes(pipelineInstanciaId, etapa);
  await porta.gravar(rel, instrucoesDaEtapa(etapa, nivel, pipeline));
  return rel;
}

const relRapido = (id: string, nome: string): string => `${PRODUTO.pastaNoProjeto}/maestro/${ID_SEGURO.test(id) ? id : "x"}/${nome}`;

export const caminhoInstrucoesRapido = (pipelineInstanciaId: string): string => relRapido(pipelineInstanciaId, "instrucoes-rapido.md");
/** Argumento do `rapido`: instrução + pedido normalizado (sem comando do método). */
export function promptRapido(pipelineInstanciaId: string, pedido: string): string | null {
  return normalizarArgumento(`Faça a alteração pedida seguindo ${caminhoInstrucoesRapido(pipelineInstanciaId)}. Pedido: ${pedido}`);
}
export const caminhoRelatorioRapido = (pipelineInstanciaId: string): string => relRapido(pipelineInstanciaId, "rapido-relatorio.md");

/** Corpo do `instrucoes-rapido.md` (piso obrigatório do pipeline rápido). */
export function instrucoesRapido(pipelineInstanciaId: string): string {
  return [
    "# Alteração rápida (nível 1, Relâmpago)",
    "",
    "Faça **somente** a alteração pedida. Piso, obrigatório:",
    "1. escreva/ajuste um teste do comportamento alterado e, em correção, veja-o falhar antes;",
    "2. rode o subconjunto afetado e, ao fim, a suíte inteira;",
    "3. nada de segredo, arquivo de ambiente ou caminho absoluto em arquivo;",
    "4. nenhuma operação git destrutiva e nenhum commit na branch padrão;",
    `5. ao terminar, grave \`${caminhoRelatorioRapido(pipelineInstanciaId)}\` com \`teste_criado: sim|nao\`, \`suite: verde|vermelha\`, \`comando_suite\`, \`arquivos\` e \`resumo\`, e pare. Não chame skills do método.`,
    "",
  ].join("\n");
}
