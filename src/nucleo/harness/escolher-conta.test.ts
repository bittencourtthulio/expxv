import { describe, expect, it } from "vitest";
import type { CandidataConta, OpcoesPick, ResultadoPick } from "../../compartilhado/harness";
import { AGORA, conta, embaralhar, emH, opcoesConta, prng, type ExtraConta, uso } from "../../../tests/fixtures/harness/construtores";
import { pickAccount } from "./escolher-conta";

interface Caso {
  nome: string;
  cands: CandidataConta[];
  opc?: Partial<OpcoesPick>;
  escolhida: string | null;
  descartadas?: Record<string, string>;
  /** ordem esperada do ranking (prefixo). */
  ranking?: string[];
  tiers?: Record<string, number>;
}
const c = (id: string, x: ExtraConta = {}): CandidataConta => conta(id, "claude", x);

// TABELA DE DECISÃO de pickAccount (D-55). CT-9.01, 9.02, 9.09, 9.13, 9.15, 9.34.
const TABELA: Caso[] = [
  { nome: "CT-9.01 expires_first: reseta antes vence (conta 2: 60% em 1 d × conta 1: 40% em 5 d)", cands: [c("c1", { w: [["weekly", 40, 120]] }), c("c2", { w: [["weekly", 60, 24]] })], escolhida: "c2", ranking: ["c2", "c1"] },
  { nome: "CT-9.02 conta a 100% numa janela relevante é descartada; a outra com folga vence", cands: [c("c1", { w: [["weekly", 40, 120]] }), c("c2", { w: [["weekly", 100, 24]] })], escolhida: "c1", descartadas: { c2: "esgotada" } },
  { nome: "empate de reset: menor uso vence", cands: [c("c1", { w: [["five_hour", 50, 3]] }), c("c2", { w: [["five_hour", 20, 3]] })], escolhida: "c2" },
  { nome: "empate total: menor conta_id", cands: [c("c9", { w: [["five_hour", 20, 3]] }), c("c2", { w: [["five_hour", 20, 3]] }), c("c5", { w: [["five_hour", 20, 3]] })], escolhida: "c2", ranking: ["c2", "c5", "c9"] },
  { nome: "CT-9.15 max_slack: folgas 5/30/12 ⇒ a de folga 30", cands: [c("a", { w: [["five_hour", 95, 1]] }), c("b", { w: [["five_hour", 70, 9] ] }), c("d", { w: [["five_hour", 88, 2] ] })], opc: { estrategia: "max_slack" }, escolhida: "b" },
  { nome: "CT-9.15 a mesma entrada com expires_first obedece o reset (folga 5 reseta antes, mas está quente: nível 3 perde)", cands: [c("a", { w: [["five_hour", 95, 1]] }), c("b", { w: [["five_hour", 70, 9]] }), c("d", { w: [["five_hour", 88, 2]] })], escolhida: "b", tiers: { a: 3, b: 1, d: 3 } },
  { nome: "max_slack desempata pela folga igual com reset mais cedo", cands: [c("a", { w: [["five_hour", 40, 9]] }), c("b", { w: [["five_hour", 40, 2]] })], opc: { estrategia: "max_slack" }, escolhida: "b" },
  { nome: "janela vencida (resets_at ≤ agora) é desconhecida: 100% vencido não esgota; nível 2", cands: [c("c1", { w: [["five_hour", 100, -1]] })], escolhida: "c1", tiers: { c1: 2 } },
  { nome: "janela vencida perde para conta medida (nível 2 × nível 1)", cands: [c("c1", { w: [["five_hour", 100, -1]] }), c("c2", { w: [["five_hour", 70, 100]] })], escolhida: "c2" },
  { nome: "resets_at exatamente agora também é vencida", cands: [c("c1", { w: [["five_hour", 100, 0]] })], escolhida: "c1", tiers: { c1: 2 } },
  { nome: "used_pct null = desconhecida (nunca vira folga nem zero): nível 2", cands: [c("c1", { w: [["five_hour", null, 3]] }), c("c2", { w: [["five_hour", 60, 3]] })], escolhida: "c2", tiers: { c1: 2, c2: 1 } },
  { nome: "CT-9.09 balde do modelo a 100% descarta a conta para aquele modelo", cands: [c("c1", { w: [["weekly", 10, 50]], baldes: { opus: [100, 50] } }), c("c2", { w: [["weekly", 30, 50]], baldes: { opus: [20, 50] } })], opc: { modelo: "opus" }, escolhida: "c2", descartadas: { c1: "modelo_esgotado" } },
  { nome: "balde esgotado de OUTRO modelo não afeta", cands: [c("c1", { w: [["weekly", 10, 50]], baldes: { opus: [100, 50] } })], opc: { modelo: "sonnet" }, escolhida: "c1" },
  { nome: "balde ignorado quando o pedido não tem modelo", cands: [c("c1", { w: [["weekly", 10, 50]], baldes: { opus: [100, 50] } })], escolhida: "c1" },
  { nome: "balde vencido não esgota", cands: [c("c1", { w: [["weekly", 10, 50]], baldes: { opus: [100, -2] } })], opc: { modelo: "opus" }, escolhida: "c1" },
  { nome: "balde entra no gargalo (maior uso entre janelas e balde)", cands: [c("c1", { w: [["weekly", 10, 50]], baldes: { opus: [90, 50] } })], opc: { modelo: "opus" }, escolhida: "c1", tiers: { c1: 3 } },
  { nome: "reserva de modelo: conta reservada a opus não serve sonnet", cands: [c("c1", { resMod: ["opus"] }), c("c2")], opc: { modelo: "sonnet" }, escolhida: "c2", descartadas: { c1: "reservada" } },
  { nome: "reserva de modelo: serve o modelo reservado", cands: [c("c1", { resMod: ["opus"] })], opc: { modelo: "opus" }, escolhida: "c1" },
  { nome: "reserva de papel: serve o papel reservado", cands: [c("c1", { resPapeis: ["revisor"] }), c("c2")], opc: { papel: "revisor" }, escolhida: "c1" },
  { nome: "reserva de papel: não serve outro papel", cands: [c("c1", { resPapeis: ["revisor"] })], opc: { papel: "executor" }, escolhida: null, descartadas: { c1: "reservada" } },
  { nome: "evitar_reservadas=false ignora a reserva", cands: [c("c1", { resPapeis: ["revisor"] })], opc: { evitar_reservadas: false }, escolhida: "c1" },
  { nome: "pin duro por conta_fixa_id", cands: [c("c1", { w: [["five_hour", 5, 1]] }), c("c2", { w: [["five_hour", 70, 9]] })], opc: { conta_fixa_id: "c2" }, escolhida: "c2", descartadas: { c1: "fora_do_pin" } },
  { nome: "pin duro: a fixada esgotada ⇒ nenhuma outra serve", cands: [c("c1"), c("c2", { w: [["five_hour", 100, 9]] })], opc: { conta_fixa_id: "c2" }, escolhida: null, descartadas: { c1: "fora_do_pin", c2: "esgotada" } },
  { nome: "conta fixada a ESTE workspace atende só ele", cands: [c("c1", { fixadaEm: ["ws1"] }), c("c2")], escolhida: "c1", descartadas: { c2: "fora_do_pin" } },
  { nome: "conta fixada a OUTRO workspace não serve (sem fixada aqui)", cands: [c("c1", { fixadaEm: ["ws9"] }), c("c2")], escolhida: "c2", descartadas: { c1: "fora_do_pin" } },
  { nome: "cooldown no futuro descarta", cands: [c("c1", { cooldownH: 0.1 }), c("c2")], escolhida: "c2", descartadas: { c1: "cooldown" } },
  { nome: "cooldown vencido não descarta", cands: [c("c1", { cooldownH: -0.1 })], escolhida: "c1" },
  { nome: "cooldown ilegível não descarta (nunca trava por lixo)", cands: [c("c1", { cooldownH: "ontem" })], escolhida: "c1" },
  { nome: "CT-9.13 sem snapshot: nível 4, depois de qualquer conta com dado", cands: [c("c1", { semUso: true }), c("c2", { w: [["five_hour", 70, 90]] })], escolhida: "c2", tiers: { c1: 4, c2: 1 } },
  { nome: "só há conta sem snapshot: ainda é escolhida (rebaixada, não excluída)", cands: [c("c1", { semUso: true })], escolhida: "c1", tiers: { c1: 4 } },
  { nome: "status unavailable = nível 4", cands: [c("c1", { status: "unavailable" }), c("c2")], escolhida: "c2", tiers: { c1: 4 } },
  { nome: "fonte nenhuma = nível 4", cands: [c("c1", { fonte: "nenhuma", confianca: "desconhecido" }), c("c2")], escolhida: "c2", tiers: { c1: 4 } },
  { nome: "estimado = nível 2 (depois do medido)", cands: [c("c1", { fonte: "estimado", confianca: "estimado", w: [["five_hour", 5, 1]] }), c("c2", { w: [["five_hour", 70, 90]] })], escolhida: "c2", tiers: { c1: 2, c2: 1 } },
  { nome: "estimado ≥ limiar de troca vai para o nível 3 (dado frágil nunca promove)", cands: [c("c1", { fonte: "estimado", confianca: "estimado", w: [["five_hour", 90, 1]] })], escolhida: "c1", tiers: { c1: 3 } },
  { nome: "manual conta como medido (nível 1)", cands: [c("c1", { fonte: "manual", confianca: "manual", w: [["five_hour", 30, 2]] })], escolhida: "c1", tiers: { c1: 1 } },
  { nome: "confianca desconhecido com janela preenchida = nível 2", cands: [c("c1", { confianca: "desconhecido", w: [["five_hour", 30, 2]] })], escolhida: "c1", tiers: { c1: 2 } },
  { nome: "≥ 85% medido = nível 3 (quente) perde para nível 1 mesmo resetando depois", cands: [c("c1", { w: [["five_hour", 86, 1]] }), c("c2", { w: [["five_hour", 10, 200]] })], escolhida: "c2", tiers: { c1: 3, c2: 1 } },
  { nome: "exatamente 85% já é quente", cands: [c("c1", { w: [["five_hour", 85, 1]] })], escolhida: "c1", tiers: { c1: 3 } },
  { nome: "84,9% ainda é nível 1", cands: [c("c1", { w: [["five_hour", 84.9, 1]] })], escolhida: "c1", tiers: { c1: 1 } },
  { nome: "todas quentes: a que reseta primeiro", cands: [c("c1", { w: [["five_hour", 90, 5]] }), c("c2", { w: [["five_hour", 88, 2]] })], escolhida: "c2" },
  { nome: "limiar de troca configurável (70)", cands: [c("c1", { w: [["five_hour", 75, 1]] })], opc: { limiar_troca_pct: 70 }, escolhida: "c1", tiers: { c1: 3 } },
  { nome: "limiar de esgotamento configurável (90): 92% esgota", cands: [c("c1", { w: [["five_hour", 92, 1]] }), c("c2")], opc: { limiar_esgotamento_pct: 90 }, escolhida: "c2", descartadas: { c1: "esgotada" } },
  { nome: "conta de crédito (sem reset) ordena DEPOIS das que resetam", cands: [c("or", { fonte: "openrouter_api", w: [["credit", 10, null]] }), c("c1", { w: [["weekly", 60, 100]] })], escolhida: "c1", ranking: ["c1", "or"] },
  { nome: "CT-9.34 crédito a 90% = nível 3; sem limite (null) = nível 2", cands: [c("or1", { fonte: "openrouter_api", w: [["credit", 90, null]] }), c("or2", { fonte: "openrouter_api", w: [["credit", null, null]] })], escolhida: "or2", tiers: { or1: 3, or2: 2 } },
  { nome: "crédito esgotado descarta mesmo com janela=five_hour", cands: [c("or", { fonte: "openrouter_api", w: [["credit", 100, null]] })], opc: { janela: "five_hour" }, escolhida: null, descartadas: { or: "esgotada" } },
  { nome: "janela weekly ignora a five_hour esgotada", cands: [c("c1", { w: [["five_hour", 100, 2], ["weekly", 10, 50]] })], opc: { janela: "weekly" }, escolhida: "c1", tiers: { c1: 1 } },
  { nome: "janela five_hour ignora a weekly esgotada", cands: [c("c1", { w: [["five_hour", 10, 2], ["weekly", 100, 50]] })], opc: { janela: "five_hour" }, escolhida: "c1" },
  { nome: "janela auto: weekly esgotada descarta", cands: [c("c1", { w: [["five_hour", 10, 2], ["weekly", 100, 50]] })], escolhida: null, descartadas: { c1: "esgotada" } },
  { nome: "monthly esgotada descarta em auto", cands: [c("c1", { w: [["monthly", 100, 500]] })], escolhida: null },
  { nome: "gargalo = janela de maior uso (99% na 5 h, 40% na semana ⇒ nível 3, uso 99)", cands: [c("c1", { w: [["five_hour", 99, 1], ["weekly", 40, 100]] })], escolhida: "c1", tiers: { c1: 3 } },
  { nome: "gargalo desempata por reset mais cedo (chave usa o reset da janela gargalo)", cands: [c("c1", { w: [["five_hour", 50, 10], ["weekly", 50, 2]] }), c("c2", { w: [["five_hour", 50, 5]] })], escolhida: "c1" },
  { nome: "todas esgotadas ⇒ escolhida null", cands: [c("c1", { w: [["five_hour", 100, 2]] }), c("c2", { w: [["weekly", 100, 20]] })], escolhida: null, descartadas: { c1: "esgotada", c2: "esgotada" } },
  { nome: "desabilitada", cands: [c("c1", { hab: false }), c("c2")], escolhida: "c2", descartadas: { c1: "desabilitada" } },
  { nome: "auth expirada descarta; desconhecida não", cands: [c("c1", { auth: "expirada" }), c("c2", { auth: "desconhecida" })], escolhida: "c2", descartadas: { c1: "auth" } },
  { nome: "excluir", cands: [c("c1"), c("c2")], opc: { excluir: ["c1"] }, escolhida: "c2", descartadas: { c1: "excluida" } },
  { nome: "sem candidatas", cands: [], escolhida: null },
];

describe("pickAccount: tabela de decisão", () => {
  expect(TABELA.length).toBeGreaterThanOrEqual(45);
  it.each(TABELA.map((t) => [t.nome, t] as const))("%s", (_nome, t) => {
    const r = pickAccount(t.cands, opcoesConta(t.opc));
    expect(r.escolhida).toBe(t.escolhida);
    for (const [id, motivo] of Object.entries(t.descartadas ?? {})) expect(r.descartadas.find((d) => d.conta_id === id)?.motivo).toBe(motivo);
    if (t.ranking) expect(r.ranking.slice(0, t.ranking.length).map((x) => x.conta_id)).toEqual(t.ranking);
    for (const [id, tier] of Object.entries(t.tiers ?? {})) expect(r.ranking.find((x) => x.conta_id === id)?.tier).toBe(tier);
    // toda candidata aparece exatamente uma vez: no ranking OU nas descartadas
    expect(r.ranking.length + r.descartadas.length).toBe(t.cands.length);
    for (const x of r.ranking) expect(x.motivo.length).toBeGreaterThan(0);
  });
});

describe("pickAccount: propriedades", () => {
  const gerar = (r: () => number): { cands: CandidataConta[]; opc: Partial<OpcoesPick> } => {
    const n = 1 + Math.floor(r() * 12);
    const cands: CandidataConta[] = [];
    for (let i = 0; i < n; i++) {
      const sorte = r();
      const usado = (): number | null => (r() < 0.1 ? null : Math.round(r() * 100));
      const h = (): number | null => (r() < 0.1 ? null : Math.round((r() * 200 - 20) * 10) / 10);
      cands.push(
        c(`c${String(i).padStart(2, "0")}`, {
          semUso: sorte < 0.08,
          hab: r() > 0.1,
          auth: r() < 0.1 ? "expirada" : "ok",
          cooldownH: r() < 0.1 ? 1 : null,
          fonte: r() < 0.15 ? "estimado" : "claude_statusline",
          confianca: r() < 0.15 ? "estimado" : "medido",
          w: [["five_hour", usado(), h()], ["weekly", usado(), h()]],
          baldes: r() < 0.3 ? { opus: [usado(), h()] } : {},
        }),
      );
    }
    return { cands, opc: { estrategia: r() < 0.5 ? "expires_first" : "max_slack", modelo: r() < 0.5 ? "opus" : null, janela: (["auto", "weekly", "five_hour"] as const)[Math.floor(r() * 3)] as OpcoesPick["janela"] } };
  };
  it("permutar a ordem das candidatas nunca muda o resultado (500 cenários)", () => {
    const r = prng(42);
    for (let k = 0; k < 500; k++) {
      const { cands, opc } = gerar(r);
      const base = pickAccount(cands, opcoesConta(opc));
      const perm = pickAccount(embaralhar(cands, r), opcoesConta(opc));
      expect(perm).toEqual(base);
    }
  });
  it("idempotente: mesma entrada, mesma saída, entrada intocada", () => {
    const r = prng(7);
    for (let k = 0; k < 100; k++) {
      const { cands, opc } = gerar(r);
      const antes = JSON.stringify(cands);
      const a = pickAccount(cands, opcoesConta(opc));
      const b = pickAccount(cands, opcoesConta(opc));
      expect(b).toEqual(a);
      expect(JSON.stringify(cands)).toBe(antes);
    }
  });
  it("nunca escolhe conta esgotada, desabilitada, sem auth ou em cooldown", () => {
    const r = prng(99);
    for (let k = 0; k < 500; k++) {
      const { cands, opc } = gerar(r);
      const res = pickAccount(cands, opcoesConta(opc));
      if (res.escolhida === null) continue;
      const esc = cands.find((x) => x.conta_id === res.escolhida) as CandidataConta;
      expect(esc.habilitada).toBe(true);
      expect(esc.auth).not.toBe("expirada");
      expect(esc.cooldown_ate === null || Date.parse(esc.cooldown_ate) <= AGORA).toBe(true);
      if (esc.uso && opc.janela === "auto") for (const w of esc.uso.windows) if (w.used_pct !== null && w.resets_at !== null && Date.parse(w.resets_at) > AGORA) expect(w.used_pct).toBeLessThan(100);
      expect(res.descartadas.some((d) => d.conta_id === res.escolhida)).toBe(false);
    }
  });
  it("o ranking é ordenado por nível e a escolhida é a primeira do melhor nível", () => {
    const r = prng(5);
    for (let k = 0; k < 200; k++) {
      const { cands, opc } = gerar(r);
      const res = pickAccount(cands, opcoesConta(opc));
      const tiers = res.ranking.map((x) => x.tier);
      expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
      expect(res.escolhida).toBe(res.ranking[0]?.conta_id ?? null);
    }
  });
  it("tier 4 (sem dado) nunca antecede conta com dado válido", () => {
    const res = pickAccount([c("a", { semUso: true }), c("b", { w: [["five_hour", 99, 1]] })], opcoesConta());
    expect(res.escolhida).toBe("b");
  });
  it("não muta o snapshot recebido e aceita AccountUsage derivado pronto", () => {
    const u = uso("x", "claude", [["five_hour", 10, 3]]);
    const cand: CandidataConta = { ...c("x"), uso: u };
    const copia = JSON.stringify(u);
    pickAccount([cand], opcoesConta());
    expect(JSON.stringify(u)).toBe(copia);
    expect(emH(0)).toBe(new Date(AGORA).toISOString());
  });
});

describe("pickAccount: fronteira", () => {
  it("só importa tipos (nenhum import de runtime)", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync(new URL("./escolher-conta.ts", import.meta.url), "utf8");
    const imports = [...fonte.matchAll(/^import\s+(type\s+)?[^;]*from\s+"([^"]+)"/gm)];
    expect(imports.length).toBeGreaterThan(0);
    for (const m of imports) expect(m[1], `import de runtime: ${m[2]}`).toBeTruthy();
    const codigo = fonte.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(codigo).not.toMatch(/Date\.now|Math\.random|new Date\(\)/);
  });
  it("resultado tipado para o Decision: ranking traz chave e motivo", () => {
    const r: ResultadoPick = pickAccount([c("a", { w: [["five_hour", 20, 3]] })], opcoesConta());
    expect(r.ranking[0]).toMatchObject({ conta_id: "a", tier: 1 });
    expect(Array.isArray(r.ranking[0]?.chave)).toBe(true);
  });
});
