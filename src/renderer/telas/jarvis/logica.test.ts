import { describe, expect, it } from "vitest";
import { ACOES_JARVIS, RISCO_DA_ACAO, PERMISSOES_REMOTAS } from "../../../compartilhado/jarvis";
import { EXPLICACAO_PERMISSAO, ROTULO_ACAO, ROTULO_PERMISSAO, ROTULO_RISCO, codigoVisivel, contagemRegressiva, enderecoDeParear, podeConfirmarPermissao, resumoTransporte, tempoRelativo } from "./logica";

const T = { ligado: true, transporte: "lan" as const, endereco: "192.168.1.20", porta: 51000, persistido: false as const, pareando: false, codigo_expira_em: null, conectados: 1, ultimo_erro: null };

describe("lógica da tela Jarvis", () => {
  it("rótulos cobrem todas as ações, riscos e permissões", () => {
    for (const a of ACOES_JARVIS) expect(ROTULO_ACAO[a].length, a).toBeGreaterThan(0);
    for (const r of Object.values(RISCO_DA_ACAO)) expect(ROTULO_RISCO[r].length).toBeGreaterThan(0);
    for (const p of PERMISSOES_REMOTAS) expect(ROTULO_PERMISSAO[p] && EXPLICACAO_PERMISSAO[p]).toBeTruthy();
  });
  it("contagem regressiva em texto", () => {
    const agora = Date.parse("2026-10-01T12:00:00Z");
    expect(contagemRegressiva("2026-10-01T12:00:12Z", agora)).toBe("expira em 12 s");
    expect(contagemRegressiva("2026-10-01T12:00:00Z", agora)).toBe("expirada");
    expect(contagemRegressiva("2026-10-01T11:59:00Z", agora)).toBe("expirada");
    expect(contagemRegressiva("2026-10-01T12:05:00Z", agora)).toBe("expira em 5 min");
    expect(contagemRegressiva("lixo", agora)).toBe("expirada");
  });
  it("transporte: texto e endereço de pareamento", () => {
    expect(resumoTransporte({ ...T, ligado: false })).toBe("Desligado");
    expect(resumoTransporte(T)).toBe("Ligado em https://192.168.1.20:51000 · 1 conectado");
    expect(resumoTransporte({ ...T, transporte: "loopback", endereco: "127.0.0.1", conectados: 2 })).toBe("Ligado em http://127.0.0.1:51000 · 2 conectados");
    expect(enderecoDeParear(T)).toBe("https://192.168.1.20:51000");
    expect(enderecoDeParear({ ...T, ligado: false })).toBeNull();
  });
  it("PERMITIR só para mensagem direta; o código some ao expirar", () => {
    expect(podeConfirmarPermissao("leitura", "")).toBe(true);
    expect(podeConfirmarPermissao("mensagem_direta", "permitir")).toBe(false);
    expect(podeConfirmarPermissao("mensagem_direta", "PERMITIR")).toBe(true);
    const agora = Date.parse("2026-10-01T12:00:00Z");
    expect(codigoVisivel("2026-10-01T12:01:00Z", agora)).toBe(true);
    expect(codigoVisivel("2026-10-01T11:59:00Z", agora)).toBe(false);
    expect(codigoVisivel(null, agora)).toBe(false);
  });
  it("tempo relativo", () => {
    const agora = Date.parse("2026-10-01T12:00:00Z");
    expect(tempoRelativo(null, agora)).toBe("nunca");
    expect(tempoRelativo("2026-10-01T11:59:50Z", agora)).toBe("agora há pouco");
    expect(tempoRelativo("2026-10-01T11:30:00Z", agora)).toBe("há 30 min");
    expect(tempoRelativo("2026-09-29T12:00:00Z", agora)).toBe("há 2 d");
  });
});
