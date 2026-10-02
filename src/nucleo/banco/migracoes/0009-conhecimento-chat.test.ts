import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, type Banco } from "../banco";
import { migrar, versaoAtual } from "../migrar";
import { criarReposConhecimentoDominio } from "../../conhecimento/repos-dominio";
import { MIGRACOES, VERSAO_SUPORTADA } from "./index";

const abertos: Banco[] = [];
const novo = (): Banco => {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  return b;
};
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const TS = "2026-01-01T00:00:00.000Z";
const ws = (b: Banco, id = "ws_1") => b.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES (?,?,'/r',?,?)", [id, "n", TS, TS]);

describe("migration 0009 conhecimento-chat", () => {
  it("é a versão 9 e as tabelas existem", () => {
    const b = novo();
    expect(MIGRACOES[8]?.nome).toBe("0009-conhecimento-chat");
    expect(versaoAtual(b)).toBe(VERSAO_SUPORTADA);
    const t = b.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'").map((x) => x.name);
    expect(t).toEqual(expect.arrayContaining(["conhecimento_config", "chat_conversa", "chat_mensagem", "chat_plano"]));
  });
  it("defaults corretos (consulta_obrigatoria=aviso, chat_execucao=reversiveis) e CHECKs", () => {
    const b = novo();
    ws(b);
    const r = criarReposConhecimentoDominio(b);
    const padrao = r.config.ler("ws_1");
    expect(padrao).toMatchObject({ ativo: true, consulta_obrigatoria: "aviso", contexto_chars: 2000, chat_execucao: "reversiveis", aprendizado_modo: "deterministico", retencao_transcricao_dias: 90 });
    expect(r.config.gravar("ws_1", { consulta_obrigatoria: "bloqueio", ativo: false }).consulta_obrigatoria).toBe("bloqueio");
    expect(() => r.config.gravar("ws_1", { contexto_chars: 100 })).toThrow();
    expect(() => r.config.gravar("ws_1", { retencao_transcricao_dias: 3 })).toThrow();
  });
  it("CASCADE por workspace: apagar o workspace leva config, conversas, mensagens e planos", () => {
    const b = novo();
    ws(b);
    const r = criarReposConhecimentoDominio(b);
    r.config.gravar("ws_1", { ativo: true });
    const c = r.conversa.criar({ workspace_id: "ws_1", titulo: "t", modo: "perguntar", perfil_json: "{}" });
    const m = r.mensagem.adicionar({ conversa_id: c.id, papel: "usuario", texto: "oi" });
    r.plano.gravar({ id: "plano_1", conversa_id: c.id, intencao: "bug", plano_json: "{}", estado: "proposto", mission_id: null, pane_ids_json: "[]" });
    expect(r.mensagem.listar(c.id).map((x) => x.id)).toEqual([m.id]);
    expect(r.plano.obter("plano_1")?.estado).toBe("proposto");
    b.executar("DELETE FROM workspace WHERE id = 'ws_1'");
    for (const t of ["conhecimento_config", "chat_conversa", "chat_mensagem", "chat_plano"]) expect(b.consultarUm<{ n: number }>(`SELECT count(*) AS n FROM ${t}`)?.n).toBe(0);
  });
  it("leitura de config ≤ 5 ms (caminho quente)", () => {
    const b = novo();
    ws(b);
    const r = criarReposConhecimentoDominio(b);
    r.config.gravar("ws_1", {});
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) r.config.ler("ws_1");
    expect((performance.now() - t0) / 100).toBeLessThan(5);
  });
});
