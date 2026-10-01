import type { Banco } from "../banco";
import { agora } from "../tempo";
import { ValorInvalidoErro } from "../../dominio";
import { textoObrigatorio } from "./comum";

export function criarRepoConfig(banco: Banco) {
  return {
    obter<T = unknown>(chave: string): T | undefined {
      const l = banco.consultarUm<{ valor_json: string }>("SELECT valor_json FROM config WHERE chave = ?", [chave]);
      return l ? (JSON.parse(l.valor_json) as T) : undefined;
    },
    definir(chave: string, valor: unknown): void {
      textoObrigatorio("chave", chave);
      const json = JSON.stringify(valor);
      if (json === undefined) throw new ValorInvalidoErro("valor", valor);
      const ts = agora();
      banco.executar(
        "INSERT INTO config (chave,valor_json,criado_em,atualizado_em) VALUES (?,?,?,?) ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em",
        [chave, json, ts, ts],
      );
    },
    remover(chave: string): void {
      banco.executar("DELETE FROM config WHERE chave = ?", [chave]);
    },
    listar(): Record<string, unknown> {
      const saida: Record<string, unknown> = {};
      for (const l of banco.consultar<{ chave: string; valor_json: string }>("SELECT chave, valor_json FROM config ORDER BY chave")) {
        saida[l.chave] = JSON.parse(l.valor_json);
      }
      return saida;
    },
  };
}

export type RepoConfig = ReturnType<typeof criarRepoConfig>;
