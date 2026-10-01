import type { Banco } from "../banco";
import { agora } from "../tempo";
import { NaoEncontradoErro, PAPEIS, type Papel } from "../../dominio";
import { AUTH_CONTA, type AuthConta, type ContaRoteamento, type ContaRoteamentoEntrada } from "../../../compartilhado/harness";
import { exigirEnum } from "./comum";
import { jsonDe, lerJson, numeroEm } from "./json";

interface Linha {
  conta_id: string;
  reservada_modelos_json: string;
  reservada_papeis_json: string;
  workspaces_fixados_json: string;
  auth: AuthConta;
  em_cooldown_ate: string | null;
  teto_tokens_5h: number | null;
  teto_tokens_semana: number | null;
  atualizado_em: string;
}
const mapear = (l: Linha): ContaRoteamento => ({
  conta_id: l.conta_id,
  reservada_modelos: lerJson<string[]>(l.reservada_modelos_json, []),
  reservada_papeis: lerJson<Papel[]>(l.reservada_papeis_json, []),
  workspaces_fixados: lerJson<string[]>(l.workspaces_fixados_json, []),
  auth: l.auth,
  em_cooldown_ate: l.em_cooldown_ate,
  teto_tokens_5h: l.teto_tokens_5h,
  teto_tokens_semana: l.teto_tokens_semana,
  atualizado_em: l.atualizado_em,
});

/** Roteamento por conta: reservas, pins, auth e cooldown. Nunca guarda credencial. */
export function criarRepoContaRoteamento(banco: Banco) {
  const existe = (contaId: string): boolean => banco.consultarUm("SELECT 1 AS x FROM conta WHERE id = ?", [contaId]) !== undefined;
  const garantir = (contaId: string): void => {
    if (!existe(contaId)) throw new NaoEncontradoErro("Conta", contaId);
    banco.executar("INSERT OR IGNORE INTO conta_roteamento (conta_id, atualizado_em) VALUES (?, ?)", [contaId, agora()]);
  };
  const exigir = (contaId: string): ContaRoteamento => mapear(banco.consultarUm<Linha>("SELECT * FROM conta_roteamento WHERE conta_id = ?", [contaId]) as Linha);
  return {
    /** Conta existente sem linha gravada devolve os padrões (sem escrever). */
    obter(contaId: string): ContaRoteamento | undefined {
      const l = banco.consultarUm<Linha>("SELECT * FROM conta_roteamento WHERE conta_id = ?", [contaId]);
      if (l) return mapear(l);
      if (!existe(contaId)) return undefined;
      return { conta_id: contaId, reservada_modelos: [], reservada_papeis: [], workspaces_fixados: [], auth: "desconhecida", em_cooldown_ate: null, teto_tokens_5h: null, teto_tokens_semana: null, atualizado_em: "" };
    },
    /** Uma linha por conta (com padrões para as sem linha), em ordem de id. */
    listar(): ContaRoteamento[] {
      const gravadas = new Map(banco.consultar<Linha>("SELECT * FROM conta_roteamento").map((l) => [l.conta_id, mapear(l)]));
      return banco.consultar<{ id: string }>("SELECT id FROM conta ORDER BY id").map((c) => gravadas.get(c.id) ?? (this.obter(c.id) as ContaRoteamento));
    },
    /** Configuração do usuário. `teto_*` omitido mantém o valor; `null` apaga. `auth` e cooldown não passam por aqui. */
    gravarConfig(d: ContaRoteamentoEntrada): ContaRoteamento {
      garantir(d.conta_id);
      d.reservada_papeis.forEach((p) => exigirEnum("reservada_papeis", p, PAPEIS));
      const atual = exigir(d.conta_id);
      const t5 = d.teto_tokens_5h === undefined ? atual.teto_tokens_5h : d.teto_tokens_5h === null ? null : numeroEm("teto_tokens_5h", d.teto_tokens_5h, 1, Number.MAX_SAFE_INTEGER);
      const ts = d.teto_tokens_semana === undefined ? atual.teto_tokens_semana : d.teto_tokens_semana === null ? null : numeroEm("teto_tokens_semana", d.teto_tokens_semana, 1, Number.MAX_SAFE_INTEGER);
      banco.executar(
        "UPDATE conta_roteamento SET reservada_modelos_json=?, reservada_papeis_json=?, workspaces_fixados_json=?, teto_tokens_5h=?, teto_tokens_semana=?, atualizado_em=? WHERE conta_id=?",
        [jsonDe("reservada_modelos", d.reservada_modelos), jsonDe("reservada_papeis", d.reservada_papeis), jsonDe("workspaces_fixados", d.workspaces_fixados), t5, ts, agora(), d.conta_id],
      );
      return exigir(d.conta_id);
    },
    definirAuth(contaId: string, auth: AuthConta): ContaRoteamento {
      exigirEnum("auth", auth, AUTH_CONTA);
      garantir(contaId);
      banco.executar("UPDATE conta_roteamento SET auth = ?, atualizado_em = ? WHERE conta_id = ?", [auth, agora(), contaId]);
      return exigir(contaId);
    },
    /** `ate` null limpa o cooldown. */
    definirCooldown(contaId: string, ate: string | null): ContaRoteamento {
      garantir(contaId);
      banco.executar("UPDATE conta_roteamento SET em_cooldown_ate = ?, atualizado_em = ? WHERE conta_id = ?", [ate, agora(), contaId]);
      return exigir(contaId);
    },
  };
}
export type RepoContaRoteamento = ReturnType<typeof criarRepoContaRoteamento>;
