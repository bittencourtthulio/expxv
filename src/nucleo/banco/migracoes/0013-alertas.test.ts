import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, type Banco } from "../banco";
import { migrar, versaoAtual } from "../migrar";
import { MIGRACOES, VERSAO_SUPORTADA } from "./index";

const abertos: Banco[] = [];
const novo = (): Banco => {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  return b;
};
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const TS = "2026-01-01T00:00:00.000Z";
const tabelas = (b: Banco) => b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((t) => t.name);
const indices = (b: Banco) => b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='index'").map((t) => t.name);
const canal = (b: Banco, tipo = "telegram"): void => void b.executar("INSERT INTO canal (id,tipo,nome,estado,criado_em,atualizado_em) VALUES ('c1',?,'n','ativo',?,?)", [tipo, TS, TS]);

describe("migration 0013-alertas", () => {
  it("é a versão 13, cria tabelas e índices do plano e é idempotente", () => {
    const b = novo();
    expect(MIGRACOES[12]?.nome).toBe("0013-alertas");
    expect(VERSAO_SUPORTADA).toBeGreaterThanOrEqual(13);
    const r = migrar(b);
    expect(r.aplicadas).toContain("0013-alertas");
    expect(tabelas(b)).toEqual(expect.arrayContaining(["alerta", "canal", "alerta_regra", "alerta_template", "alerta_entrega", "tarefa_tempo", "telegram_estado", "telegram_update_visto", "telegram_autorizado", "telegram_workspace", "telegram_nao_autorizado", "mensagem_entrada", "telegram_aprovacao", "telegram_auditoria"]));
    expect(indices(b)).toEqual(expect.arrayContaining(["ix_alerta_criado", "ix_alerta_naolido", "ix_alerta_entidade", "ix_alerta_dedupe", "ix_entrega_pend", "ux_entrega_idem", "ix_entrada_hash", "ix_aprov_plano"]));
    expect(migrar(b).aplicadas).toEqual([]);
    expect(versaoAtual(b)).toBe(VERSAO_SUPORTADA);
  });

  it("migra do banco da v12 com dados, sem perda", () => {
    const b = novo();
    migrar(b, { migracoes: MIGRACOES.slice(0, 12) });
    b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_1','n','/r',?,?)", [TS, TS]);
    const r = migrar(b);
    expect(r.de).toBe(12);
    expect(b.consultarUm("SELECT nome FROM workspace WHERE id='ws_1'")).toEqual({ nome: "n" });
  });

  it("CHECKs: canal aceita 'toast' e rejeita tipo/estado inválido; severidade; nível; ação de aprovação", () => {
    const b = novo();
    migrar(b);
    canal(b, "toast");
    expect(() => b.executar("INSERT INTO canal (id,tipo,nome,estado,criado_em,atualizado_em) VALUES ('c2','sms','n','ativo',?,?)", [TS, TS])).toThrow();
    expect(() => b.executar("INSERT INTO canal (id,tipo,nome,estado,criado_em,atualizado_em) VALUES ('c3','so','n','quebrado',?,?)", [TS, TS])).toThrow();
    expect(() => b.executar("INSERT INTO alerta (id,tipo,severidade,fonte,titulo,dados_json,dedupe_chave,criado_em,atualizado_em) VALUES ('a','t','urgente','f','t','{}','k',?,?)", [TS, TS])).toThrow();
    expect(() => b.executar("INSERT INTO alerta_regra (id,nome,tipos_json,canal_id,nivel,criado_em) VALUES ('r','n','[]','c1','tudo',?)", [TS])).toThrow();
    b.executar("INSERT INTO mensagem_entrada (id,canal_id,autorizado_id,update_id,texto_redigido,tamanho_original,estado,criado_em,atualizado_em) VALUES ('m','c1','a',1,'x',1,'recebida',?,?)", [TS, TS]);
    for (const acao of ["aprovar", "editar", "cancelar", "parar", "ws", "gate_aprovar", "gate_recusar", "gate_confirmar"]) {
      b.executar("INSERT INTO telegram_aprovacao (nonce_hash,mensagem_entrada_id,acao,plano_id,args_hash,chat_id,user_id,estado,expira_em) VALUES (?,?,?,'p','h',1,1,'pendente',?)", [`n_${acao}`, "m", acao, TS]);
    }
    expect(() => b.executar("INSERT INTO telegram_aprovacao (nonce_hash,mensagem_entrada_id,acao,plano_id,args_hash,chat_id,user_id,estado,expira_em) VALUES ('x','m','apagar','p','h',1,1,'pendente',?)", [TS])).toThrow();
    expect(() => b.executar("INSERT INTO mensagem_entrada (id,canal_id,autorizado_id,update_id,texto_redigido,tamanho_original,estado,criado_em,atualizado_em) VALUES ('m2','c1','a',2,?,1,'recebida',?,?)", ["x".repeat(2001), TS, TS])).toThrow();
    expect(() => b.executar("INSERT INTO mensagem_entrada (id,canal_id,autorizado_id,update_id,texto_redigido,tamanho_original,estado,criado_em,atualizado_em) VALUES ('m3','c1','a',1,'y',1,'recebida',?,?)", [TS, TS])).toThrow();
  });

  it("idempotência de entrega vale também com regra NULL; template acima de 2000 caracteres é rejeitado", () => {
    const b = novo();
    migrar(b);
    canal(b);
    b.executar("INSERT INTO alerta (id,tipo,severidade,fonte,titulo,dados_json,dedupe_chave,criado_em,atualizado_em) VALUES ('a','t','info','f','t','{}','k',?,?)", [TS, TS]);
    const ins = (id: string) => b.executar("INSERT INTO alerta_entrega (id,alerta_id,canal_id,regra_id,estado,criado_em) VALUES (?, 'a','c1',NULL,'pendente',?)", [id, TS]);
    ins("e1");
    expect(() => ins("e2")).toThrow();
    expect(() => b.executar("INSERT INTO alerta_template (id,tipo,canal_tipo,nivel,corpo,atualizado_em) VALUES ('t','x','so','minimo',?,?)", ["x".repeat(2001), TS])).toThrow();
  });
});
