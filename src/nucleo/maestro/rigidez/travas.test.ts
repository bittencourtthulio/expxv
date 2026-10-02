import { describe, expect, it } from "vitest";
import { BRANCHES_PROTEGIDAS_PADRAO, avaliarMudancaDeNivel, branchProtegida, exigeConfirmacao, FRASE_DE_CONFIRMACAO, JUSTIFICATIVA_MIN, nivelMinimoTravado, type ContextoTrava } from "./travas";

const ctx = (o: Partial<ContextoTrava> = {}): ContextoTrava => ({ raio_faixa: null, branch: "feature/x", branches_protegidas: BRANCHES_PROTEGIDAS_PADRAO, producao: false, ...o });

describe("travas de segurança", () => {
  it("raio ALTO ⇒ mínimo 4; demais faixas e ausência ⇒ sem trava", () => {
    expect(nivelMinimoTravado({ raio_faixa: "alto" })).toMatchObject({ minimo: 4, trava: "raio_alto" });
    expect(nivelMinimoTravado({ raio_faixa: "ALTO" }).minimo).toBe(4);
    for (const f of ["baixo", "medio", null]) expect(nivelMinimoTravado({ raio_faixa: f })).toMatchObject({ minimo: 1, trava: null, motivo: null });
  });
  it("branchProtegida com os padrões do plano e glob", () => {
    for (const b of ["main", "master", "develop", "release/1.2", "prod", "production", "prod-eu", "hotfix/urgente"]) expect(branchProtegida(b, BRANCHES_PROTEGIDAS_PADRAO), b).toBe(true);
    for (const b of ["feature/x", "ade/principal", "fix/main-menu", "maintenance", null, ""]) expect(branchProtegida(b, BRANCHES_PROTEGIDAS_PADRAO), String(b)).toBe(false);
    expect(branchProtegida("a.b", ["a.b"])).toBe(true);
    expect(branchProtegida("axb", ["a.b"])).toBe(false);
  });
  it("baixar para ≤ 2 em branch protegida ou produção exige confirmação; ≥ 3 não", () => {
    expect(exigeConfirmacao(ctx({ branch: "main" }), 2)).toMatchObject({ exige: true, trava: "branch_protegida", frase: FRASE_DE_CONFIRMACAO });
    expect(exigeConfirmacao(ctx({ branch: "main" }), 1).exige).toBe(true);
    expect(exigeConfirmacao(ctx({ branch: "main" }), 3).exige).toBe(false);
    expect(exigeConfirmacao(ctx({ producao: true }), 2)).toMatchObject({ exige: true, trava: "producao" });
    expect(exigeConfirmacao(ctx({ branch: "feature/x" }), 1).exige).toBe(false);
  });
});

describe("avaliarMudancaDeNivel", () => {
  const j = "x".repeat(JUSTIFICATIVA_MIN);
  it("raio ALTO + nível 2 ⇒ abaixo_do_minimo sem justificativa; 19 caracteres recusado, 20 aceito e logado", () => {
    const base = { via: "ui" as const, de: 4 as const, para: 2 as const, ctx: ctx({ raio_faixa: "alto" }) };
    expect(avaliarMudancaDeNivel(base)).toMatchObject({ ok: false, erro: "abaixo_do_minimo" });
    expect(avaliarMudancaDeNivel({ ...base, justificativa: "x".repeat(19) })).toMatchObject({ ok: false, erro: "abaixo_do_minimo" });
    expect(avaliarMudancaDeNivel({ ...base, justificativa: `   ${"x".repeat(19)}   ` })).toMatchObject({ ok: false });
    const ok = avaliarMudancaDeNivel({ ...base, justificativa: j });
    expect(ok).toMatchObject({ ok: true, log: { de: 4, para: 2, por: "usuario", trava: "raio_alto", justificativa: j } });
  });
  it("subir nunca é travado; mudar sem trava não registra trava", () => {
    expect(avaliarMudancaDeNivel({ via: "ui", de: 2, para: 5, ctx: ctx({ raio_faixa: "alto" }) })).toMatchObject({ ok: true, log: { trava: null, justificativa: null } });
    expect(avaliarMudancaDeNivel({ via: "ui", de: 3, para: 2, ctx: ctx() })).toMatchObject({ ok: true });
  });
  it("branch protegida: baixar exige digitar `baixar` e registra a trava", () => {
    const base = { via: "ui" as const, de: 3 as const, para: 2 as const, ctx: ctx({ branch: "main" }) };
    expect(avaliarMudancaDeNivel(base)).toMatchObject({ ok: false, erro: "confirmacao_necessaria" });
    expect(avaliarMudancaDeNivel({ ...base, confirmacao_digitada: "sim" })).toMatchObject({ ok: false, erro: "confirmacao_necessaria" });
    expect(avaliarMudancaDeNivel({ ...base, confirmacao_digitada: " BAIXAR " })).toMatchObject({ ok: true, log: { trava: "branch_protegida" } });
    expect(avaliarMudancaDeNivel({ ...base, ctx: ctx({ producao: true }), confirmacao_digitada: "baixar" })).toMatchObject({ ok: true, log: { trava: "producao" } });
  });
  it("raio ALTO e branch protegida juntos exigem as duas coisas; a trava do raio é a registrada", () => {
    const base = { via: "ui" as const, de: 4 as const, para: 2 as const, ctx: ctx({ raio_faixa: "alto", branch: "main" }), justificativa: j };
    expect(avaliarMudancaDeNivel(base)).toMatchObject({ ok: false, erro: "confirmacao_necessaria" });
    expect(avaliarMudancaDeNivel({ ...base, confirmacao_digitada: "baixar" })).toMatchObject({ ok: true, log: { trava: "raio_alto" } });
  });
  it("canal remoto (Telegram/issue) só sobe: nunca baixa nem sobrescreve trava (D-223)", () => {
    for (const via of ["telegram", "issue"] as const) {
      expect(avaliarMudancaDeNivel({ via, de: 3, para: 2, ctx: ctx() })).toMatchObject({ ok: false, erro: "canal_remoto_nao_baixa" });
      expect(avaliarMudancaDeNivel({ via, de: 3, para: 5, ctx: ctx() })).toMatchObject({ ok: true });
      expect(avaliarMudancaDeNivel({ via, de: null, para: 2, ctx: ctx({ raio_faixa: "alto" }), justificativa: j })).toMatchObject({ ok: false, erro: "canal_remoto_nao_sobrescreve_trava" });
      expect(avaliarMudancaDeNivel({ via, de: null, para: 2, ctx: ctx({ branch: "main" }), confirmacao_digitada: "baixar" })).toMatchObject({ ok: false, erro: "canal_remoto_nao_sobrescreve_trava" });
    }
  });
  it("vias locais (mcp, chat, paleta, hook) não são remotas", () => {
    for (const via of ["mcp", "chat", "paleta", "hook", "api", "squad"] as const) expect(avaliarMudancaDeNivel({ via, de: 3, para: 2, ctx: ctx() }).ok).toBe(true);
  });
  it("a trava some quando o raio deixa de ser ALTO", () => {
    expect(avaliarMudancaDeNivel({ via: "ui", de: 4, para: 2, ctx: ctx({ raio_faixa: "medio" }) }).ok).toBe(true);
  });
});
