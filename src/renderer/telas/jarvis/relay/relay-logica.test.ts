import { describe, expect, it } from "vitest";
import { validarUrlRelay } from "../../../../compartilhado/relay";
import { agrupar4, contagemRegressiva, erroDeUrl, indicadorRelay, SITUACAO_RELAY, textoDispositivo } from "./relay-logica";
import { dispositivoRelayFalso, estadoRelayFalso } from "../fabrica-teste";

describe("lógica pura do relay", () => {
  it("toda situação tem forma E texto", () => {
    for (const s of Object.values(SITUACAO_RELAY)) {
      expect(s.forma.length).toBeGreaterThan(0);
      expect(s.texto.length).toBeGreaterThan(3);
    }
  });
  it("impressão digital em grupos de 4, com ou sem espaços", () => {
    expect(agrupar4("0123456789abcdef")).toBe("0123 4567 89ab cdef");
    expect(agrupar4("0123 4567 89ab cdef")).toBe("0123 4567 89ab cdef");
  });
  it("URL: concorda com validarUrlRelay do contrato", () => {
    for (const u of ["wss://relay.exemplo.com", "ws://relay.exemplo.com", "wss://10.0.0.1", "wss://user@relay.exemplo.com", "wss://localhost", "wss://relay.exemplo.com/?x=1", "https://x.com", ""]) {
      expect(erroDeUrl(u) === null, u).toBe(validarUrlRelay(u));
    }
    expect(erroDeUrl("")).toMatch(/Informe/);
    expect(erroDeUrl("http://x.com")).toMatch(/wss:\/\//);
  });
  it("contagem regressiva em texto", () => {
    const t0 = Date.parse("2026-10-01T12:00:00Z");
    expect(contagemRegressiva(new Date(t0 + 45_000).toISOString(), t0)).toBe("expira em 45 s");
    expect(contagemRegressiva(new Date(t0 - 1).toISOString(), t0)).toBe("expirada");
  });
  it("indicador só com o relay ligado, com N e forma", () => {
    expect(indicadorRelay(null)).toBeNull();
    expect(indicadorRelay(estadoRelayFalso())).toBeNull();
    expect(indicadorRelay(estadoRelayFalso({ ligado: true, situacao: "conectado", dispositivos: 2 }))).toEqual({ forma: "●", texto: "relay · 2", tom: "ok" });
    expect(indicadorRelay(estadoRelayFalso({ ligado: true, situacao: "indisponivel" }))?.forma).toBe("▲");
  });
  it("dispositivo: revogado, conectado ou visto", () => {
    const t = Date.parse("2026-10-01T12:00:00Z");
    expect(textoDispositivo(dispositivoRelayFalso({ revogado_em: "2026-10-01T11:59:00Z" }), t)).toBe("revogado");
    expect(textoDispositivo(dispositivoRelayFalso({ conectado: true }), t)).toBe("conectado agora");
    expect(textoDispositivo(dispositivoRelayFalso(), t)).toMatch(/^visto há /);
  });
});
