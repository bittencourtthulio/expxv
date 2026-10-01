import { describe, expect, it } from "vitest";
import { KINDS_CONHECIDOS, normalizarKind } from "./kinds";

describe("kinds", () => {
  it("todo kind do contrato e das skills é reconhecido", () => {
    for (const k of ["orquestrador", "sprint", "fases", "tasks", "plano", "bloqueios", "ocorrencia", "causa_raiz", "qa", "base_indice", "relatorio_tecnico", "relatorio_uso", "relatorios_indice", "projeto", "premissas", "mapa", "recursao", "validacao", "relatorio", "decisoes", "estimativa", "estimativa_historico", "fechamento", "entrega", "produto", "pedido", "existencia", "avaliacao", "veredito", "briefing", "produto_indice", "design_system", "design_audit", "design_log", "design_debt"]) {
      expect(KINDS_CONHECIDOS.has(k)).toBe(true);
      expect(normalizarKind(k)).toBe(k);
    }
  });

  it("kind desconhecido, ausente ou de tipo errado vira 'desconhecido'", () => {
    expect(normalizarKind("tipo_do_futuro")).toBe("desconhecido");
    expect(normalizarKind(undefined)).toBe("desconhecido");
    expect(normalizarKind(null)).toBe("desconhecido");
    expect(normalizarKind(7)).toBe("desconhecido");
    expect(normalizarKind("")).toBe("desconhecido");
  });

  it("normaliza caixa e espaços", () => {
    expect(normalizarKind("  Tasks ")).toBe("tasks");
  });
});
