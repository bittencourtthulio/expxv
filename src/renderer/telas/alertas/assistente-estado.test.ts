import { describe, expect, it } from "vitest";
import { confirmaDireto, exigeConfirmacaoDireto, formatoTokenOk, linhasIniciais, mensagemErro, montarWorkspaces, passoSugerido, passosConcluidos, reduzirToken, TOKEN_INICIAL } from "./assistente-estado";
import { canalFalso, estadoTelegramFalso } from "./fabrica-teste";
import type { AutorizadoCompletoVisao } from "../../../compartilhado/alertas";

const aut = (extra: Partial<AutorizadoCompletoVisao> = {}): AutorizadoCompletoVisao => ({ id: "a1", canal_id: "c", nome_exibicao: "Ana", modo_padrao: "aprovar", texto_livre: true, com_pin: false, criado_em: "", ultimo_uso_em: "", expira_em: "", revogado_em: null, workspaces: [], ...extra });
const TOKEN = "123456789:AAEhBOweik6ad9r_QXMENQjcrTu1jibl3cs";

describe("passo sugerido (retomável)", () => {
  it("sem token -> 1; token sem consentimento -> 3; sem conta -> 4; completo -> 5", () => {
    expect(passoSugerido(estadoTelegramFalso())).toBe(1);
    expect(passoSugerido(estadoTelegramFalso({ token_mascarado: "x" }))).toBe(3);
    const cons = canalFalso({ consentimento: { versao_texto: "tg-1", aceito_em: "2026-10-01T10:00:00Z", host: "api.telegram.org" } });
    expect(passoSugerido(estadoTelegramFalso({ token_mascarado: "x", canal: cons }))).toBe(4);
    expect(passoSugerido(estadoTelegramFalso({ token_mascarado: "x", canal: cons, autorizados: [aut()] }))).toBe(5);
    expect(passoSugerido(estadoTelegramFalso({ token_mascarado: "x", canal: cons, autorizados: [aut({ revogado_em: "2026-10-01" })] }))).toBe(4);
  });
  it("passos concluídos", () => {
    expect([...passosConcluidos(estadoTelegramFalso({ token_mascarado: "x" }))].sort()).toEqual([1, 2]);
  });
});

describe("formulário do token", () => {
  it("formato do token", () => {
    expect(formatoTokenOk(TOKEN)).toBe(true);
    expect(formatoTokenOk("abc")).toBe(false);
  });
  it("testar ok guarda o bot; falhar LIMPA o token; salvar LIMPA o token", () => {
    let s = reduzirToken(TOKEN_INICIAL, { t: "digitar", token: TOKEN });
    expect(s.token).toBe(TOKEN);
    s = reduzirToken(s, { t: "testar" });
    s = reduzirToken(s, { t: "resultado_teste", r: { ok: true, bot: { id: 1, username: "b", nome: "B" } } });
    expect(s.fase).toBe("testado");
    expect(s.token).toBe(TOKEN);
    const salvo = reduzirToken(reduzirToken(s, { t: "salvar" }), { t: "resultado_salvo", r: { ok: true } });
    expect(salvo.token).toBe("");
    expect(salvo.fase).toBe("salvo");
    const falho = reduzirToken(reduzirToken(TOKEN_INICIAL, { t: "digitar", token: TOKEN }), { t: "resultado_teste", r: { ok: false, erro: "nao_autorizado" } });
    expect(falho).toMatchObject({ token: "", fase: "erro", erro: "nao_autorizado" });
    expect(JSON.stringify(falho)).not.toContain(TOKEN);
  });
  it("digitar de novo zera erro e fase", () => {
    const erro = reduzirToken(TOKEN_INICIAL, { t: "resultado_teste", r: { ok: false, erro: "rede" } });
    expect(reduzirToken(erro, { t: "digitar", token: "1" })).toMatchObject({ fase: "ocioso", erro: null, token: "1" });
  });
});

describe("permissões por workspace", () => {
  it("nenhum liberado por padrão e um único padrão entre os liberados", () => {
    const l = linhasIniciais([{ id: "w1" }, { id: "w2" }], []);
    expect(l.every((x) => x.modo === "nenhum")).toBe(true);
    expect(montarWorkspaces(l)).toEqual([]);
    expect(montarWorkspaces([{ workspace_id: "w1", modo: "nenhum", padrao: true }, { workspace_id: "w2", modo: "aprovar", padrao: false }, { workspace_id: "w3", modo: "consulta", padrao: false }])).toEqual([
      { workspace_id: "w2", modo: "aprovar", padrao: true }, { workspace_id: "w3", modo: "consulta", padrao: false },
    ]);
  });
  it("modo direto exige digitar DIRETO exatamente", () => {
    expect(exigeConfirmacaoDireto([{ workspace_id: "w", modo: "direto", padrao: true }])).toBe(true);
    expect(exigeConfirmacaoDireto([{ workspace_id: "w", modo: "aprovar", padrao: true }])).toBe(false);
    expect(confirmaDireto("DIRETO")).toBe(true);
    expect(confirmaDireto("direto")).toBe(false);
    expect(mensagemErro("sem_workspace_liberado")).toMatch(/workspace/);
    expect(mensagemErro("xyz")).toBe("Não foi possível concluir.");
  });
});
