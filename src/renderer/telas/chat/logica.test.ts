import { describe, expect, it } from "vitest";
import type { CitacaoChat, MensagemChatDto, PerfilChatEstado, PlanoChatDto } from "../../../compartilhado/chat";
import { LIMITE_COMPOSER, LIMITE_PROMPT_PLANO, alturaEstimada, avaliarAjuste, calcularJanela, descreverSemLlm, linhaDeCitacao, mesclarMensagem, partirCitacoes, podeDecidir, reduzirToken, rotuloEstadoPlano, validarComposer } from "./logica";

const msg = (id: string, extra: Partial<MensagemChatDto> = {}): MensagemChatDto => ({ id, conversa_id: "c1", papel: "assistente", texto: "", citacoes: [], plano_id: null, estado: "completa", criado_em: `2026-10-01T10:00:${id.padStart(2, "0")}Z`, ...extra });
const cit = (n: number): CitacaoChat => ({ n, documento_id: `d${n}`, titulo: `Doc ${n}`, origem: `docs/${n}.md`, tipo: "doc", ocorrido_em: "2026-10-01T10:00:00Z" });

describe("citações [n]", () => {
  it("parte o texto em segmentos; só vira citação quando o número existe", () => {
    expect(partirCitacoes("Veja [1] e [2], mas [9] não existe.", [cit(1), cit(2)])).toEqual([
      { tipo: "texto", valor: "Veja " }, { tipo: "cit", n: 1 }, { tipo: "texto", valor: " e " }, { tipo: "cit", n: 2 },
      { tipo: "texto", valor: ", mas [9] não existe." },
    ]);
    expect(partirCitacoes("sem nada", [])).toEqual([{ tipo: "texto", valor: "sem nada" }]);
    expect(partirCitacoes("", [cit(1)])).toEqual([]);
  });
  it("HTML bruto continua texto (nunca interpretado)", () => {
    const s = partirCitacoes("<img src=x onerror=alert(1)> [1]", [cit(1)]);
    expect(s[0]).toEqual({ tipo: "texto", valor: "<img src=x onerror=alert(1)> " });
  });
  it("linha de citação: [n] título · tipo · origem · data", () => {
    expect(linhaDeCitacao(cit(3))).toBe("[3] Doc 3 · doc · docs/3.md · 01/10/2026");
  });
});

describe("redutor de streaming de tokens", () => {
  it("anexa o delta, preserva ordem e imutabilidade; cria a mensagem se o token chegar antes dela", () => {
    const base = [msg("1", { texto: "Olá", estado: "transmitindo" })];
    const r = reduzirToken(base, "1", ", mundo");
    expect(r[0]?.texto).toBe("Olá, mundo");
    expect(base[0]?.texto).toBe("Olá");
    const nova = reduzirToken(base, "2", "oi");
    expect(nova).toHaveLength(2);
    expect(nova[1]).toMatchObject({ id: "2", papel: "assistente", estado: "transmitindo", texto: "oi" });
  });
  it("não cresce sem limite", () => {
    let m = [msg("1", { estado: "transmitindo" })];
    for (let i = 0; i < 30; i++) m = reduzirToken(m, "1", "x".repeat(10_000));
    expect((m[0]?.texto.length ?? 0)).toBeLessThanOrEqual(200_000);
  });
  it("mesclar substitui por id (mensagem completa vence o parcial) e mantém a ordem por data", () => {
    const m = mesclarMensagem([msg("2", { texto: "parcial", estado: "transmitindo" }), msg("1")], msg("2", { texto: "final" }));
    expect(m.map((x) => x.id)).toEqual(["1", "2"]);
    expect(m[1]?.texto).toBe("final");
    expect(mesclarMensagem(m, msg("3")).map((x) => x.id)).toEqual(["1", "2", "3"]);
  });
});

describe("janela virtual de mensagens", () => {
  it("só devolve o intervalo visível mais a margem, com 1000 mensagens", () => {
    const alturas = Array.from({ length: 1000 }, () => 50);
    const j = calcularJanela(alturas, 5000, 400, 3);
    expect(j.primeiro).toBe(97);
    expect(j.ultimo - j.primeiro).toBeLessThan(20);
    expect(j.alturaTotal).toBe(50_000);
    expect(j.deslocamento).toBe(97 * 50);
  });
  it("lista vazia e rolagem além do fim não quebram", () => {
    expect(calcularJanela([], 0, 400, 3)).toEqual({ primeiro: 0, ultimo: 0, alturaTotal: 0, deslocamento: 0 });
    const j = calcularJanela([10, 10], 9999, 100, 2);
    expect(j.ultimo).toBe(2);
    expect(j.primeiro).toBeLessThanOrEqual(2);
  });
  it("altura estimada cresce com o texto, mas tem teto", () => {
    expect(alturaEstimada(msg("1", { texto: "oi" }), 80)).toBeLessThan(alturaEstimada(msg("1", { texto: "linha\n".repeat(30) }), 80));
    expect(alturaEstimada(msg("1", { texto: "x".repeat(200_000) }), 80)).toBeLessThanOrEqual(2400);
  });
});

describe("composer e plano", () => {
  it("limite de 8000; vazio não envia", () => {
    expect(validarComposer("  ").ok).toBe(false);
    expect(validarComposer("preciso implementar X").ok).toBe(true);
    expect(validarComposer("a".repeat(LIMITE_COMPOSER + 1))).toMatchObject({ ok: false });
    expect(validarComposer("a".repeat(LIMITE_COMPOSER)).ok).toBe(true);
  });
  it("ajuste do plano: prompt ≤ 20000, não vazio, cli válida", () => {
    expect(avaliarAjuste({ prompt: "ok" }).ok).toBe(true);
    expect(avaliarAjuste({ prompt: "" }).ok).toBe(false);
    expect(avaliarAjuste({ prompt: "x".repeat(LIMITE_PROMPT_PLANO + 1) }).ok).toBe(false);
    expect(avaliarAjuste({ prompt: "ok", cli: "claude" }).ok).toBe(true);
  });
  it("só se decide plano proposto; exige_aprovacao define se há botão Aprovar", () => {
    const p = { estado: "proposto", exige_aprovacao: true } as PlanoChatDto;
    expect(podeDecidir(p)).toEqual({ aprovar: true, editar: true, cancelar: true });
    expect(podeDecidir({ ...p, exige_aprovacao: false })).toEqual({ aprovar: false, editar: true, cancelar: true });
    expect(podeDecidir({ ...p, estado: "executando" })).toEqual({ aprovar: false, editar: false, cancelar: false });
    expect(rotuloEstadoPlano("executando")).toBe("executando");
  });
  it("busca sem LLM: avisa o motivo quando nenhuma CLI está disponível ou a escolhida não está", () => {
    const indisp: PerfilChatEstado = { perfil: null, clis: [{ cli: "claude", disponivel: false, motivo: "não instalada" }, { cli: "codex", disponivel: false, motivo: null }] };
    expect(descreverSemLlm(indisp)).toMatchObject({ semLlm: true });
    expect(descreverSemLlm(indisp).motivo).toContain("não instalada");
    const ok: PerfilChatEstado = { perfil: { cli: "claude", modelo: null, esforco: null, faixa: "medio" }, clis: [{ cli: "claude", disponivel: true, motivo: null }] };
    expect(descreverSemLlm(ok).semLlm).toBe(false);
    const escolhidaOff: PerfilChatEstado = { perfil: { cli: "codex", modelo: null, esforco: null, faixa: "medio" }, clis: [{ cli: "claude", disponivel: true, motivo: null }, { cli: "codex", disponivel: false, motivo: "sem login" }] };
    expect(descreverSemLlm(escolhidaOff).semLlm).toBe(true);
  });
});
