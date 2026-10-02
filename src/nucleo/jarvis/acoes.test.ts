import { describe, expect, it } from "vitest";
import { ACOES_JARVIS, RISCO_DA_ACAO, type AcaoJarvis, type AtorJarvis, type OrigemJarvis, type PermissaoRemota } from "../../compartilhado/jarvis";
import { requisitoDaAcao, resumoDaAcao, textoSeguro, validarAcaoTipada } from "./acoes";

describe("validarAcaoTipada (lista fechada, estrita)", () => {
  it("aceita as nove ações e normaliza", () => {
    expect(validarAcaoTipada({ acao: "status" })).toEqual({ ok: true, acao: { acao: "status" } });
    expect(validarAcaoTipada({ acao: "abrir_pane", pane: "#3" })).toEqual({ ok: true, acao: { acao: "abrir_pane", pane: "3" } });
    expect(validarAcaoTipada({ acao: "enviar_prompt", destino: "maestro", squad: null, texto: "  faça X  " })).toEqual({ ok: true, acao: { acao: "enviar_prompt", destino: "maestro", squad: null, texto: "faça X" } });
    expect(validarAcaoTipada({ acao: "enviar_prompt", destino: "squad", squad: "dev.time", texto: "x" }).ok).toBe(true);
    expect(validarAcaoTipada({ acao: "aprovar_gate", gate_id: "g1", decisao: "recusar" }).ok).toBe(true);
    expect(validarAcaoTipada({ acao: "pausar", alvo: "missão x" }).ok).toBe(true);
    expect(ACOES_JARVIS).toHaveLength(9);
  });
  it.each([
    [{ acao: "pane_close" }],
    [{ acao: "run_command", comando: "rm -rf /" }],
    [{ acao: "status", extra: 1 }],
    [{ acao: "abrir_pane" }],
    [{ acao: "enviar_prompt", destino: "piloto", squad: null, texto: "x" }],
    [{ acao: "enviar_prompt", destino: "maestro", squad: "x", texto: "x" }],
    [{ acao: "enviar_prompt", destino: "squad", squad: "../x", texto: "x" }],
    [{ acao: "enviar_prompt", destino: "maestro", squad: null, texto: "   " }],
    [{ acao: "aprovar_gate", gate_id: "a b", decisao: "aprovar" }],
    [{ acao: "aprovar_gate", gate_id: "g1", decisao: "talvez" }],
    ["status"],
    [null],
    [[]],
  ])("recusa %j", (v) => {
    expect(validarAcaoTipada(v).ok).toBe(false);
  });
  it("texto do prompt sai sem controle/bidi, redigido e cortado", () => {
    const sujo = `oi‮\u0007 chave sk-ant-api03-${"A".repeat(40)} fim`;
    const t = textoSeguro(sujo);
    expect(t).not.toMatch(/[‮\u0007]/);
    expect(t).not.toContain("sk-ant-api03");
    expect(textoSeguro("x".repeat(9000)).length).toBeLessThanOrEqual(2000);
  });
  it("resumo cita alvo e texto", () => {
    expect(resumoDaAcao({ acao: "enviar_prompt", destino: "squad", squad: "dev", texto: "finalizar a publicação" })).toContain("«finalizar a publicação»");
  });
});

describe("matriz ator × permissão × origem × ação", () => {
  const ator = (a: AtorJarvis, permissao: PermissaoRemota | null, origem: OrigemJarvis, acao: AcaoJarvis) => requisitoDaAcao({ ator: a, permissao, origem, acao });
  it("Jarvis local: leitura e escrita_leve diretas; escrita confirma no desktop", () => {
    for (const a of ACOES_JARVIS) {
      const r = ator("jarvis", null, "fala_do_usuario", a);
      expect(r.permitido, a).toBe(true);
      expect(r.confirmacao, a).toBe(RISCO_DA_ACAO[a] === "escrita" ? "desktop" : "nenhuma");
    }
  });
  it("conteúdo externo só lê: nunca autoriza escrita (D-72)", () => {
    for (const a of ACOES_JARVIS) {
      const r = ator("jarvis", null, "conteudo_externo", a);
      expect(r.permitido, a).toBe(RISCO_DA_ACAO[a] === "leitura");
      if (!r.permitido) expect(r.codigo).toBe("origem_nao_confiavel");
    }
  });
  it("remoto leitura: só leitura; escrita -> permissao_insuficiente (AC-15)", () => {
    for (const a of ACOES_JARVIS) {
      const r = ator("remoto", "leitura", "remoto_confirmado", a);
      expect(r.permitido, a).toBe(RISCO_DA_ACAO[a] === "leitura");
      if (!r.permitido) expect(r.codigo).toBe("permissao_insuficiente");
    }
  });
  it("remoto mensagem_confirmada: escrita sempre com confirmação no desktop; abrir_pane nunca", () => {
    expect(ator("remoto", "mensagem_confirmada", "remoto_confirmado", "enviar_prompt")).toEqual({ permitido: true, confirmacao: "desktop" });
    expect(ator("remoto", "mensagem_confirmada", "remoto_confirmado", "parar")).toEqual({ permitido: true, confirmacao: "desktop" });
    expect(ator("remoto", "mensagem_confirmada", "remoto_confirmado", "abrir_pane").permitido).toBe(false);
  });
  it("remoto mensagem_direta: enviar/pausar/parar sem confirmação extra; aprovar_gate SEMPRE confirma", () => {
    expect(ator("remoto", "mensagem_direta", "remoto_direto", "enviar_prompt").confirmacao).toBe("nenhuma");
    expect(ator("remoto", "mensagem_direta", "remoto_direto", "pausar").confirmacao).toBe("nenhuma");
    expect(ator("remoto", "mensagem_direta", "remoto_direto", "aprovar_gate")).toEqual({ permitido: true, confirmacao: "desktop" });
  });
  it("origem de remoto não vale para o Jarvis local e vice-versa; sem permissão = recusa", () => {
    expect(ator("jarvis", null, "remoto_direto", "enviar_prompt").permitido).toBe(false);
    expect(ator("remoto", null, "remoto_direto", "status").permitido).toBe(false);
    expect(ator("remoto", "mensagem_direta", "fala_do_usuario", "enviar_prompt").permitido).toBe(false);
  });
  it("ação fora da lista é recusada", () => {
    expect(ator("jarvis", null, "ui", "pane_close" as AcaoJarvis).codigo).toBe("acao_fora_da_lista");
  });
});
