import { describe, expect, it } from "vitest";
import { relogioFalso } from "../../../tests/fixtures/alertas/ajudas";
import { criarAuditoria } from "./auditoria";
import { INATIVIDADE_MS } from "./autorizacao";
import { criarPanico } from "./panico";
import { criarRepoTelegramMemoria, type AutorizadoRow } from "./repo";

const montar = () => {
  const relogio = relogioFalso();
  const repo = criarRepoTelegramMemoria();
  const agora = (): string => new Date(relogio.agora()).toISOString();
  const aut = (id: string, user: number, extra: Partial<AutorizadoRow> = {}): AutorizadoRow => ({ id, canal_id: "c1", user_id: user, chat_id: user, nome_exibicao: "x", modo_padrao: "aprovar", texto_livre: true, pin_hash: null, criado_em: agora(), ultimo_uso_em: agora(), expira_em: new Date(relogio.agora() + INATIVIDADE_MS).toISOString(), revogado_em: null, ...extra });
  const eventos: string[] = [];
  let desligado = 0;
  const p = criarPanico({ repo, canal_id: "c1", relogio, auditoria: criarAuditoria({ repo, canal_id: "c1", relogio }), pararPoller: async () => void eventos.push("poller"), cancelarFila: () => void eventos.push("fila"), desligarCanal: () => void desligado++, aoEvento: (t) => void eventos.push(t) });
  return { relogio, repo, aut, p, eventos, desligado: () => desligado };
};

describe("revogação e inatividade (T-20.32, AB-15/AB-30)", () => {
  it("revogar anula os nonces e planos do usuário e ele volta a ser desconhecido", () => {
    const { repo, aut, p } = montar();
    repo.gravarAutorizado(aut("a1", 5));
    repo.gravarAutorizado(aut("a2", 6));
    repo.inserirAprovacao({ nonce_hash: "h1", mensagem_entrada_id: "e1", acao: "aprovar", plano_id: "p1", args_hash: "x", chat_id: 5, message_id: 1, user_id: 5, estado: "pendente", expira_em: new Date(Date.now() + 1e6).toISOString(), usado_em: null });
    repo.inserirAprovacao({ nonce_hash: "h2", mensagem_entrada_id: "e2", acao: "aprovar", plano_id: "p2", args_hash: "x", chat_id: 6, message_id: 1, user_id: 6, estado: "pendente", expira_em: new Date(Date.now() + 1e6).toISOString(), usado_em: null });
    expect(p.revogar("a1")).toBe(true);
    expect(repo.aprovacao("h1")?.estado).toBe("anulado");
    expect(repo.aprovacao("h2")?.estado).toBe("pendente");
    expect(p.revogar("a1")).toBe(false);
    expect(p.revogar("nao-existe")).toBe(false);
  });
  it("30 dias sem uso: expira, e sem ninguém ativo a entrada é desligada", () => {
    const { repo, aut, p, relogio, desligado, eventos } = montar();
    repo.gravarAutorizado(aut("a1", 5));
    expect(p.verificarInatividade()).toEqual({ expirados: 0, entrada_desligada: false });
    relogio.avancar(INATIVIDADE_MS + 1000);
    expect(p.verificarInatividade()).toEqual({ expirados: 1, entrada_desligada: true });
    expect(desligado()).toBe(1);
    expect(eventos).toContain("entrada_expirou");
    expect(repo.autorizadoPorId("a1")?.revogado_em).not.toBeNull();
    expect(p.verificarInatividade()).toEqual({ expirados: 0, entrada_desligada: false });
  });
  it("com outro autorizado ativo, expirar um não desliga a entrada", () => {
    const { repo, aut, p, relogio } = montar();
    repo.gravarAutorizado(aut("a1", 5, { expira_em: new Date(relogio.agora() - 1000).toISOString() }));
    repo.gravarAutorizado(aut("a2", 6));
    expect(p.verificarInatividade()).toEqual({ expirados: 1, entrada_desligada: false });
  });
  it("pânico: ordem rede primeiro (fila, poller), tudo revogado, canal desligado, 1 linha de auditoria; chamadas simultâneas = 1 execução", async () => {
    const { repo, aut, p, eventos, desligado } = montar();
    repo.gravarAutorizado(aut("a1", 5));
    repo.gravarAutorizado(aut("a2", 6));
    const [a, b] = await Promise.all([p.panico({ parar_execucoes: false, origem: "botao" }), p.panico({ parar_execucoes: false, origem: "botao" })]);
    expect(a).toEqual(b);
    expect(a).toEqual({ ok: true, revogados: 2 });
    expect(eventos.slice(0, 2)).toEqual(["fila", "poller"]);
    expect(desligado()).toBe(1);
    expect(repo.listarAuditoria("c1", null, 10).filter((x) => x.evento === "panico")).toHaveLength(1);
  });
});
