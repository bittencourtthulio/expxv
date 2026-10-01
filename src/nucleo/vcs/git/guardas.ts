import { GitErro } from "../../git/erros";
import { ramoAtual, type OpcoesBase } from "./comum";
import { ehRamoPadrao } from "./ramos";

// Guardas comuns das operações que reescrevem ou integram histórico (D-36): a automação nunca escreve na
// branch padrão; ações destrutivas aceitam `simular` e devolvem o que se perderia.

export type OrigemOperacao = "usuario" | "automacao";

export type MotivoRecusa =
  | "automacao-ramo-padrao"
  | "automacao-sem-ramo"
  | "origem-invalida"
  | "confirmacao-invalida"
  | "ramo-padrao"
  | "publicado"
  | "operacao-em-curso"
  | "sem-operacao"
  | "sem-ramo"
  | "passos-invalidos"
  | "conflitos-pendentes"
  | "simulacao-necessaria";

/** O app recusou a operação por regra de segurança (nunca chegou a rodar o git). */
export class OperacaoRecusadaErro extends GitErro {
  override name = "OperacaoRecusadaErro";
  constructor(mensagem: string, readonly motivo: MotivoRecusa, readonly detalhe: string[] = []) {
    super(mensagem);
  }
}

/** Origem `automacao` na branch padrão (ou sem branch) é recusada; origem desconhecida também. Devolve a branch atual. */
export async function guardaAutomacao(raiz: string, origem: OrigemOperacao, rotulo: string, op: OpcoesBase = {}): Promise<string | null> {
  if (origem !== "usuario" && origem !== "automacao") throw new OperacaoRecusadaErro("Origem da operação inválida.", "origem-invalida");
  const ramo = await ramoAtual(raiz, op);
  if (origem === "automacao") {
    if (ramo === null) throw new OperacaoRecusadaErro(`Automação não faz ${rotulo} com HEAD destacado.`, "automacao-sem-ramo");
    if (await ehRamoPadrao(raiz, ramo, op)) throw new OperacaoRecusadaErro(`Automação não faz ${rotulo} na branch padrão (${ramo}). Use uma branch de trabalho.`, "automacao-ramo-padrao", [ramo]);
  }
  return ramo;
}
