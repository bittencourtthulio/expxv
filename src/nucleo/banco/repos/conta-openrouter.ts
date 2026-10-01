import type { Banco } from "../banco";
import { NaoEncontradoErro, ValorInvalidoErro } from "../../dominio";
import type { ContaOpenRouterEstado, TipoContaOpenRouter } from "../../../compartilhado/harness";
import { textoObrigatorio } from "./comum";
import { numeroOuNulo } from "./json";

export interface ContaOpenRouterLinha extends ContaOpenRouterEstado {
  cofre_entrada_id: string;
}
export interface NovaContaOpenRouter {
  conta_id: string;
  /** referência (id/nome) da entrada do cofre; a CHAVE nunca entra aqui. */
  cofre_entrada_id: string;
  ultimos4: string;
}
export interface SaldoOpenRouter {
  tipo: TipoContaOpenRouter;
  limite_usd: number | null;
  usado_usd: number | null;
  saldo_usd: number | null;
  saldo_em: string | null;
}
const TIPOS: readonly TipoContaOpenRouter[] = ["pago", "gratuito", "desconhecido"];
/** Padrões de chave conhecidos: se o texto parece uma chave, recusa (defesa em profundidade: só a referência cabe no banco). */
const PARECE_CHAVE = /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}|^[A-Za-z0-9_-]{40,}$/;

const SELECT = `SELECT c.id AS conta_id, c.rotulo AS rotulo, o.cofre_entrada_id AS cofre_entrada_id, o.ultimos4 AS ultimos4, o.tipo AS tipo,
  o.limite_usd AS limite_usd, o.usado_usd AS usado_usd, o.saldo_usd AS saldo_usd, o.saldo_em AS saldo_em
  FROM conta_openrouter o JOIN conta c ON c.id = o.conta_id`;

/** Extensão `conta_openrouter` de uma `conta` com provedor "openrouter". Valores `null` = a API não informou (nunca 0). */
export function criarRepoContaOpenRouter(banco: Banco) {
  const obter = (contaId: string): ContaOpenRouterLinha | undefined => banco.consultarUm<ContaOpenRouterLinha>(`${SELECT} WHERE o.conta_id = ?`, [contaId]);
  return {
    obter,
    listar(): ContaOpenRouterLinha[] {
      return banco.consultar<ContaOpenRouterLinha>(`${SELECT} ORDER BY c.id`);
    },
    /** Cria ou troca a referência do cofre e a máscara. Preserva o último saldo conhecido. */
    gravar(d: NovaContaOpenRouter): ContaOpenRouterLinha {
      textoObrigatorio("cofre_entrada_id", d.cofre_entrada_id);
      if (PARECE_CHAVE.test(d.cofre_entrada_id)) throw new ValorInvalidoErro("cofre_entrada_id", "[parece uma chave; use a referência do cofre]");
      if (typeof d.ultimos4 !== "string" || d.ultimos4.length === 0 || d.ultimos4.length > 4) throw new ValorInvalidoErro("ultimos4", "[máscara]");
      const conta = banco.consultarUm<{ provedor: string }>("SELECT provedor FROM conta WHERE id = ?", [d.conta_id]);
      if (!conta) throw new NaoEncontradoErro("Conta", d.conta_id);
      if (conta.provedor !== "openrouter") throw new ValorInvalidoErro("provedor", conta.provedor);
      banco.executar(
        `INSERT INTO conta_openrouter (conta_id,cofre_entrada_id,ultimos4) VALUES (?,?,?)
         ON CONFLICT(conta_id) DO UPDATE SET cofre_entrada_id = excluded.cofre_entrada_id, ultimos4 = excluded.ultimos4`,
        [d.conta_id, d.cofre_entrada_id, d.ultimos4],
      );
      return obter(d.conta_id) as ContaOpenRouterLinha;
    },
    /** Resposta da API: campo que não veio (ou inválido) fica `null`, nunca 0. */
    atualizarSaldo(contaId: string, s: Partial<SaldoOpenRouter> & { saldo_em: string }): ContaOpenRouterLinha {
      if (!obter(contaId)) throw new NaoEncontradoErro("ContaOpenRouter", contaId);
      const tipo = s.tipo !== undefined && TIPOS.includes(s.tipo) ? s.tipo : "desconhecido";
      banco.executar("UPDATE conta_openrouter SET tipo = ?, limite_usd = ?, usado_usd = ?, saldo_usd = ?, saldo_em = ? WHERE conta_id = ?", [
        tipo, numeroOuNulo(s.limite_usd), numeroOuNulo(s.usado_usd), numeroOuNulo(s.saldo_usd), s.saldo_em, contaId,
      ]);
      return obter(contaId) as ContaOpenRouterLinha;
    },
    remover(contaId: string): boolean {
      return banco.executar("DELETE FROM conta_openrouter WHERE conta_id = ?", [contaId]).alteracoes > 0;
    },
  };
}
export type RepoContaOpenRouter = ReturnType<typeof criarRepoContaOpenRouter>;
