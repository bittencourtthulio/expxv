import { afterEach, describe, expect, it } from "vitest";
import type { Banco } from "../banco";
import { novoBancoMemoria, semearMissao, semearPane, semearWorkspace } from "../../../tests/fixtures/memoria/banco";
import { criarCiclo } from "./ciclo";
import { atualizarEntrada } from "./edicao";
import { hashDoConteudo } from "./escrita";
import { criarRepoMemoria } from "./repo";
import { criarServicoMemoria } from "./servico";
import { MemoriaErro, type LinhaEntrada } from "./tipos";

const abertos: Banco[] = [];
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const AGORA = new Date("2026-10-20T12:00:00.000Z");

function mundo() {
  const b = novoBancoMemoria();
  abertos.push(b);
  const ws = semearWorkspace(b);
  semearMissao(b, "M1", ws, "agentico");
  semearPane(b, { id: "P1", ws, mission: "M1", papel: "piloto" });
  const repo = criarRepoMemoria(b);
  const linha = (o: Partial<LinhaEntrada> & { id: string; conteudo: string }): LinhaEntrada => ({
    workspace_id: "ws_1", mission_id: "M1", pane_id: "P1", linhagem_id: "P1", squad_slug: null, escopo: "pane", anel: 1, tipo: "evento", fonte: "agente", autor_pane_id: null, importancia: 3,
    substitui_id: null, estado: "ativa", expira_em: null, redigido: 0, hash_conteudo: hashDoConteudo(o.conteudo), contagem: 1, criado_em: "2026-10-01T10:00:00.000Z", atualizado_em: "2026-10-01T10:00:00.000Z", ...o,
  });
  return { b, repo, linha };
}
const cod = (f: () => unknown): string => {
  try { f(); } catch (x) { return (x as MemoriaErro).codigo; }
  return "nenhum";
};

describe("edição humana (UI: Editar e Fixar)", () => {
  it("editar o texto redige segredos, recalcula o hash, apaga o vetor antigo e passa a fonte para usuario", () => {
    const m = mundo();
    m.repo.inserir(m.linha({ id: "mem_a", conteudo: "texto original" }));
    m.b.executar("INSERT INTO memoria_vetor (entrada_id, modelo, dimensao, vetor, criado_em) VALUES ('mem_a','hash-256-v1',8,x'00','2026-10-01T10:00:00.000Z')");
    const r = atualizarEntrada({ banco: m.b, agora: () => AGORA }, { id: "mem_a", conteudo: "novo texto com API_KEY=abc123segredo" });
    expect(r.conteudo).not.toContain("abc123segredo");
    expect(r.conteudo).toContain("[REDACTED]");
    expect(r.redigido).toBe(1);
    expect(r.fonte).toBe("usuario");
    expect(r.hash_conteudo).toBe(hashDoConteudo(r.conteudo));
    expect(m.b.consultar("SELECT 1 FROM memoria_vetor WHERE entrada_id = 'mem_a'")).toHaveLength(0);
    expect(m.b.consultar("SELECT 1 FROM memoria_fts WHERE memoria_fts MATCH 'original'")).toHaveLength(0);
  });
  it("fixar muda só a importância (a fonte e o texto ficam)", () => {
    const m = mundo();
    m.repo.inserir(m.linha({ id: "mem_a", conteudo: "decisão" }));
    const r = atualizarEntrada({ banco: m.b, agora: () => AGORA }, { id: "mem_a", importancia: 5 });
    expect(r).toMatchObject({ importancia: 5, fonte: "agente", conteudo: "decisão" });
  });
  it("recusa vazio, grande, importância inválida, entrada inexistente ou não ativa; nada para atualizar", () => {
    const m = mundo();
    m.repo.inserir(m.linha({ id: "mem_a", conteudo: "x" }));
    m.repo.inserir(m.linha({ id: "mem_b", conteudo: "y", estado: "expirada" }));
    const d = { banco: m.b };
    expect(cod(() => atualizarEntrada(d, { id: "mem_a", conteudo: "  \u0007 " }))).toBe("invalid_argument");
    expect(cod(() => atualizarEntrada(d, { id: "mem_a", conteudo: "a".repeat(1001) }))).toBe("too_large");
    expect(cod(() => atualizarEntrada(d, { id: "mem_a", conteudo: "a".repeat(9000) }))).toBe("too_large");
    expect(cod(() => atualizarEntrada(d, { id: "mem_a", importancia: 6 }))).toBe("invalid_argument");
    expect(cod(() => atualizarEntrada(d, { id: "mem_zzz", importancia: 4 }))).toBe("not_found");
    expect(cod(() => atualizarEntrada(d, { id: "mem_b", importancia: 4 }))).toBe("not_found");
    expect(cod(() => atualizarEntrada(d, { id: "mem_a" }))).toBe("invalid_argument");
  });
  it("preferência (anel 3) edita pelo mesmo caminho das preferências (limite de 300)", () => {
    const m = mundo();
    const svc = criarServicoMemoria({ banco: m.b, agora: () => AGORA });
    const p = svc.preferencias.gravar({ id: null, conteudo: "responder em português", importancia: 3 });
    const r = svc.atualizar({ id: p.id, conteudo: "responder sempre em português", importancia: 5 });
    expect(r).toMatchObject({ escopo: "usuario", conteudo: "responder sempre em português", importancia: 5 });
    expect(cod(() => svc.atualizar({ id: p.id, conteudo: "a".repeat(301) }))).toBe("too_large");
  });
  it("entrada fixada (importância 5) fica fora da compactação, da retenção e da expiração por Missão", () => {
    const m = mundo();
    m.b.transacao(() => {
      for (let i = 0; i < 230; i++) m.repo.inserir(m.linha({ id: `mem_e${String(i).padStart(4, "0")}`, conteudo: `evento ${i}`, importancia: 2, atualizado_em: "2026-10-02T10:00:00.000Z" }));
      m.repo.inserir(m.linha({ id: "mem_fix", conteudo: "evento fixado", importancia: 5, atualizado_em: "2026-10-02T09:00:00.000Z", expira_em: "2026-10-03T00:00:00.000Z" }));
      m.repo.inserir(m.linha({ id: "mem_vel", conteudo: "evento velho", importancia: 2, atualizado_em: "2025-01-01T09:00:00.000Z", expira_em: "2026-10-03T00:00:00.000Z" }));
    });
    const c = criarCiclo({ banco: m.b, agora: () => AGORA });
    c.expirar();
    c.retencao();
    let g = 0;
    while (c.compactar() > 0 && g++ < 50);
    expect(m.repo.obter("mem_fix")?.estado).toBe("ativa");
    expect(m.repo.obter("mem_vel")?.estado).toBe("expirada");
  });
});

describe("estado.missoes (chave por Missão legível pela UI)", () => {
  it("devolve só as Missões do workspace com valor explícito", () => {
    const m = mundo();
    semearMissao(m.b, "M2", "ws_1", "agentico");
    const svc = criarServicoMemoria({ banco: m.b, agora: () => AGORA });
    m.repo.definirMissaoAtiva("M1", false, AGORA.toISOString());
    return svc.estado("ws_1").then((e) => { expect(e.missoes).toEqual({ M1: false }); });
  });
});
