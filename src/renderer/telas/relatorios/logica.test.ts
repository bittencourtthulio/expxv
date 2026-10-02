import { describe, expect, it } from "vitest";
import type { EnvioDivulgacao } from "../../../compartilhado/relatorios";
import { CANAL_OFF, REDES, detalheFalso } from "./fabrica-teste";
import { ABAS_RELATORIOS, acoesDoPacote, contador, linhaDoPacote, nomeAmigavel, podeEnviar, tamanhoPt, textoDoErro, variantesDeRedes } from "./logica";

const envio = (estado: EnvioDivulgacao["estado"]): EnvioDivulgacao => ({ id: "e", pacote_id: "p", workspace_id: "w", canal: "telegram", variante: "curta", texto: "t", estado, criado_em: "t", enviado_em: null, erro: null });

describe("lógica pura da tela Relatórios", () => {
  it("abas na ordem do contrato", () => {
    expect(ABAS_RELATORIOS.map((a) => a.rotulo)).toEqual(["Pacotes", "Revisão", "Divulgação", "Config"]);
  });
  it("textoDoErro tira o prefixo do IPC e o código; nunca devolve vazio", () => {
    expect(textoDoErro(new Error("Error invoking remote method 'relatorios:gerar': Error: [rule_violation] a sprint ainda não foi fechada"))).toBe("a sprint ainda não foi fechada");
    expect(textoDoErro(new Error("[not_found] pacote não encontrado"))).toBe("pacote não encontrado");
    expect(textoDoErro(undefined)).toMatch(/Algo deu errado/);
    expect(textoDoErro("texto")).toBe("texto");
  });
  it("linha do pacote e tamanho em português", () => {
    expect(linhaDoPacote(detalheFalso())).toBe("Sprint 12 — r1 · pronto · texto padrão · rascunho · 1 aviso(s)");
    expect(tamanhoPt(512)).toBe("512 B");
    expect(tamanhoPt(2048)).toBe("2,0 KB");
    expect(tamanhoPt(3 * 1024 * 1024)).toBe("3,0 MB");
  });
  it("lê as 3 variantes e corta pelo limite como última barreira", () => {
    const v = variantesDeRedes(REDES);
    expect(v.map((x) => x.variante)).toEqual(["curta", "media", "longa"]);
    expect(v[0]?.texto).toContain("Novidades da versão");
    expect(v.map((x) => x.limite)).toEqual([280, 600, 1200]);
    const gigante = variantesDeRedes(`== curta (9999 caracteres) ==\n${"x".repeat(5000)}\n`);
    expect(gigante[0]?.texto).toHaveLength(280);
    expect(variantesDeRedes("lixo")).toEqual([]);
  });
  it("contador conta caracteres (não bytes) e avisa quando estoura", () => {
    expect(contador("ação", 280)).toEqual({ n: 4, estoura: false, rotulo: "4/280" });
    expect(contador("x".repeat(281), 280).estoura).toBe(true);
  });
  it("regras de habilitação: aprovar só pronto, em rascunho e sem problema no texto do cliente", () => {
    expect(acoesDoPacote(null).podeAprovar).toBe(false);
    expect(acoesDoPacote(detalheFalso()).podeAprovar).toBe(true);
    expect(acoesDoPacote(detalheFalso({ estado: "gerando" })).podeRegenerar).toBe(false);
    expect(acoesDoPacote(detalheFalso({ estado: "falhou" })).podeRegenerar).toBe(true);
    expect(acoesDoPacote(detalheFalso({ revisao_usuario: "aprovado" }))).toMatchObject({ podeAprovar: false, podeDesaprovar: true });
    const ruim = detalheFalso({ verificacao: { ok: false, afirmacoes_total: 1, com_fonte: 1, violacoes: [{ regra: "V5", bloco: "u_correcoes", afirmacao_id: null, detalhe: "termo técnico: api" }] } });
    expect(acoesDoPacote(ruim).podeAprovar).toBe(false);
    expect(acoesDoPacote(ruim).motivoAprovar).toMatch(/Revisão/);
    const tecnico = detalheFalso({ verificacao: { ok: false, afirmacoes_total: 1, com_fonte: 1, violacoes: [{ regra: "V2", bloco: "t_resumo", afirmacao_id: null, detalhe: "x" }] } });
    expect(acoesDoPacote(tecnico).podeAprovar).toBe(true);
  });
  it("enviar: exige item aprovado, relatório aprovado, canal disponível e consentimento (com o motivo certo)", () => {
    const ok = { canal: "telegram" as const, disponivel: true, consentido: true, motivo: null };
    expect(podeEnviar(envio("rascunho"), ok, true).motivo).toMatch(/Aprove o item/);
    expect(podeEnviar(envio("aprovado"), ok, false).motivo).toMatch(/relatório do cliente/);
    expect(podeEnviar(envio("aprovado"), CANAL_OFF, true).motivo).toMatch(/não configurado/);
    expect(podeEnviar(envio("aprovado"), { ...ok, consentido: false, motivo: "Falta o seu consentimento para enviar por este canal." }, true).motivo).toMatch(/consentimento/);
    expect(podeEnviar(envio("aprovado"), undefined, true).pode).toBe(false);
    expect(podeEnviar(envio("aprovado"), ok, true)).toEqual({ pode: true, motivo: null });
    expect(podeEnviar(envio("falhou"), ok, true).pode).toBe(true);
    expect(podeEnviar(envio("enviado"), ok, true).pode).toBe(false);
    expect(podeEnviar(envio("cancelado"), ok, true).pode).toBe(false);
  });
  it("nome amigável conhecido e fallback para o nome do arquivo", () => {
    expect(nomeAmigavel("tasks-jira.csv")).toBe("Tarefas para Jira (CSV)");
    expect(nomeAmigavel("outro.bin")).toBe("outro.bin");
  });
});
