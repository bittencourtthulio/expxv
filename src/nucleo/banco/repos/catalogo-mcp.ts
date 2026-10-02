import type { Banco } from "../banco";
import {
  RETENCAO_LOG_POR_SERVIDOR,
  type CliLoja,
  type RegistroCliInstalacao,
  type RegistroConsentimento,
  type RegistroFerramenta,
  type RegistroHabilitacao,
  type RegistroInstalado,
  type RegistroLog,
  type RegistroSaude,
  type RegistroVariavel,
  type RepoLojaMcp,
} from "../../loja-mcp/repositorio";
import { bool, int, novoId } from "./comum";

/** Repositório SQLite da Loja de MCPs (T-07B.04): implementa a porta `RepoLojaMcp` (contrato = `criarRepoMemoria`). Só metadado, nunca segredo. */
export function criarRepoCatalogoMcp(banco: Banco): RepoLojaMcp {
  const hab = (l: Record<string, unknown>): RegistroHabilitacao => ({
    id: String(l.id), servidor_id: String(l.servidor_id), alvo_tipo: l.alvo_tipo as RegistroHabilitacao["alvo_tipo"],
    alvo_valor: String(l.alvo_valor), habilitado: bool(l.habilitado as number), atualizado_em: String(l.atualizado_em),
  });

  return {
    gravarInstalado: (r) => {
      banco.executar(
        `INSERT INTO catalogo_mcp_instalado (servidor_id,versao,metodo,estado,nivel_verificacao,integridade,pasta_rel,comando_hash,seed_versao,erro_codigo,instalado_em,atualizado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(servidor_id) DO UPDATE SET versao=excluded.versao, metodo=excluded.metodo, estado=excluded.estado, nivel_verificacao=excluded.nivel_verificacao,
           integridade=excluded.integridade, pasta_rel=excluded.pasta_rel, comando_hash=excluded.comando_hash, seed_versao=excluded.seed_versao,
           erro_codigo=excluded.erro_codigo, instalado_em=excluded.instalado_em, atualizado_em=excluded.atualizado_em`,
        [r.servidor_id, r.versao, r.metodo, r.estado, r.nivel_verificacao, r.integridade, r.pasta_rel, r.comando_hash, r.seed_versao, r.erro_codigo, r.instalado_em, r.atualizado_em],
      );
    },
    obterInstalado: (id) => banco.consultarUm<RegistroInstalado>("SELECT * FROM catalogo_mcp_instalado WHERE servidor_id = ?", [id]) ?? null,
    listarInstalados: () => banco.consultar<RegistroInstalado>("SELECT * FROM catalogo_mcp_instalado ORDER BY servidor_id"),
    removerServidor: (id) => {
      banco.transacao((b) => {
        for (const t of ["instalado", "variavel", "habilitacao", "saude", "ferramenta", "cli_instalacao"]) {
          b.executar(`DELETE FROM catalogo_mcp_${t} WHERE servidor_id = ?`, [id]);
        }
      });
    },

    gravarConsentimento: (r) => {
      banco.executar(
        "INSERT INTO catalogo_mcp_consentimento (id,servidor_id,versao,comando_hash,permissoes_json,origem,aceito_em) VALUES (?,?,?,?,?,?,?)",
        [r.id, r.servidor_id, r.versao, r.comando_hash, r.permissoes_json, r.origem, r.aceito_em],
      );
    },
    consentimentosDe: (id) =>
      banco.consultar<RegistroConsentimento>("SELECT * FROM catalogo_mcp_consentimento WHERE servidor_id = ? ORDER BY aceito_em, rowid", [id]),

    gravarVariavel: (r) => {
      banco.executar(
        `INSERT INTO catalogo_mcp_variavel (servidor_id,nome,definida,atualizada_em) VALUES (?,?,?,?)
         ON CONFLICT(servidor_id,nome) DO UPDATE SET definida=excluded.definida, atualizada_em=excluded.atualizada_em`,
        [r.servidor_id, r.nome, int(r.definida), r.atualizada_em],
      );
    },
    variaveisDe: (id) =>
      banco.consultar<{ servidor_id: string; nome: string; definida: number; atualizada_em: string | null }>(
        "SELECT * FROM catalogo_mcp_variavel WHERE servidor_id = ? ORDER BY nome", [id],
      ).map((l): RegistroVariavel => ({ servidor_id: l.servidor_id, nome: l.nome, definida: bool(l.definida), atualizada_em: l.atualizada_em })),
    apagarVariavel: (id, nome) => { banco.executar("DELETE FROM catalogo_mcp_variavel WHERE servidor_id = ? AND nome = ?", [id, nome]); },

    habilitar: (r) => {
      const novo = r.id ?? novoId("evento", "mcph");
      banco.executar(
        `INSERT INTO catalogo_mcp_habilitacao (id,servidor_id,alvo_tipo,alvo_valor,habilitado,atualizado_em) VALUES (?,?,?,?,?,?)
         ON CONFLICT(servidor_id,alvo_tipo,alvo_valor) DO UPDATE SET habilitado=excluded.habilitado, atualizado_em=excluded.atualizado_em`,
        [novo, r.servidor_id, r.alvo_tipo, r.alvo_valor, int(r.habilitado), r.atualizado_em],
      );
      return hab(banco.consultarUm("SELECT * FROM catalogo_mcp_habilitacao WHERE servidor_id = ? AND alvo_tipo = ? AND alvo_valor = ?", [r.servidor_id, r.alvo_tipo, r.alvo_valor])!);
    },
    listarHabilitacoes: (f = {}) => {
      const cond: string[] = [];
      const params: string[] = [];
      if (f.servidor_id !== undefined) { cond.push("servidor_id = ?"); params.push(f.servidor_id); }
      if (f.alvo_tipo !== undefined) { cond.push("alvo_tipo = ?"); params.push(f.alvo_tipo); }
      if (f.alvo_valor !== undefined) { cond.push("alvo_valor = ?"); params.push(f.alvo_valor); }
      const onde = cond.length ? ` WHERE ${cond.join(" AND ")}` : "";
      return banco.consultar(`SELECT * FROM catalogo_mcp_habilitacao${onde} ORDER BY rowid`, params).map(hab);
    },
    removerHabilitacoes: (id) => { banco.executar("DELETE FROM catalogo_mcp_habilitacao WHERE servidor_id = ?", [id]); },

    salvarSaude: (r) => {
      banco.executar(
        `INSERT INTO catalogo_mcp_saude (servidor_id,estado,testado_em,latencia_ms,n_ferramentas,erro_codigo) VALUES (?,?,?,?,?,?)
         ON CONFLICT(servidor_id) DO UPDATE SET estado=excluded.estado, testado_em=excluded.testado_em, latencia_ms=excluded.latencia_ms,
           n_ferramentas=excluded.n_ferramentas, erro_codigo=excluded.erro_codigo`,
        [r.servidor_id, r.estado, r.testado_em, r.latencia_ms, r.n_ferramentas, r.erro_codigo],
      );
    },
    obterSaude: (id) => banco.consultarUm<RegistroSaude>("SELECT * FROM catalogo_mcp_saude WHERE servidor_id = ?", [id]) ?? null,
    substituirFerramentas: (id, lista, em) => {
      banco.transacao((b) => {
        b.executar("DELETE FROM catalogo_mcp_ferramenta WHERE servidor_id = ?", [id]);
        for (const f of lista) {
          b.executar("INSERT OR REPLACE INTO catalogo_mcp_ferramenta (servidor_id,nome,descricao,visto_em) VALUES (?,?,?,?)", [id, f.nome, f.descricao, em]);
        }
      });
    },
    ferramentasDe: (id) => banco.consultar<RegistroFerramenta>("SELECT * FROM catalogo_mcp_ferramenta WHERE servidor_id = ? ORDER BY nome", [id]),

    cliInstalacaoGravar: (r) => {
      banco.executar(
        `INSERT INTO catalogo_mcp_cli_instalacao (servidor_id,cli,nome_na_cli,escopo,criado_em) VALUES (?,?,?,?,?)
         ON CONFLICT(servidor_id,cli) DO UPDATE SET nome_na_cli=excluded.nome_na_cli, escopo=excluded.escopo, criado_em=excluded.criado_em`,
        [r.servidor_id, r.cli, r.nome_na_cli, r.escopo, r.criado_em],
      );
    },
    cliInstalacoesDe: (id) => banco.consultar<RegistroCliInstalacao>("SELECT * FROM catalogo_mcp_cli_instalacao WHERE servidor_id = ? ORDER BY cli", [id]),
    cliInstalacaoRemover: (id, cli: CliLoja) => { banco.executar("DELETE FROM catalogo_mcp_cli_instalacao WHERE servidor_id = ? AND cli = ?", [id, cli]); },

    registrarLog: (r) => {
      banco.transacao((b) => {
        b.executar("INSERT INTO catalogo_mcp_log (id,servidor_id,nivel,evento,detalhe_json,em) VALUES (?,?,?,?,?,?)",
          [r.id ?? novoId("evento", "mcpl"), r.servidor_id, r.nivel, r.evento, r.detalhe_json.slice(0, 1024), r.em]);
        b.executar(
          `DELETE FROM catalogo_mcp_log WHERE servidor_id = ? AND rowid NOT IN
             (SELECT rowid FROM catalogo_mcp_log WHERE servidor_id = ? ORDER BY rowid DESC LIMIT ${RETENCAO_LOG_POR_SERVIDOR})`,
          [r.servidor_id, r.servidor_id],
        );
      });
    },
    logsDe: (id, limite = 50) =>
      banco.consultar<RegistroLog>("SELECT id,servidor_id,nivel,evento,detalhe_json,em FROM catalogo_mcp_log WHERE servidor_id = ? ORDER BY rowid DESC LIMIT ?", [id, Math.max(1, Math.floor(limite))]),
    podarLogs: (antesDe) => banco.executar("DELETE FROM catalogo_mcp_log WHERE em < ?", [antesDe]).alteracoes,

    kitOptOut: () => bool(banco.consultarUm<{ opt_out: number }>("SELECT opt_out FROM catalogo_mcp_kit LIMIT 1")?.opt_out ?? 0),
    definirKitOptOut: (valor, em) => {
      banco.transacao((b) => {
        b.executar("DELETE FROM catalogo_mcp_kit");
        b.executar("INSERT INTO catalogo_mcp_kit (opt_out,atualizado_em) VALUES (?,?)", [int(valor), em]);
      });
    },
  };
}
