import { describe, expect, it } from "vitest";
import { FASES_ATUALIZACAO } from "../../compartilhado/atualizacao";
import { eventosValidos, transicao, type EventoMaquina } from "./maquina";
import { criarEvento } from "./historico";

const TODOS: EventoMaquina[] = ["ligar", "desligar", "verificar", "achou_disponivel", "achou_atual", "falhou", "baixar", "baixado", "hash_ok", "cancelar", "preparar", "instalar", "reiniciar_erro"];

describe("máquina de estados (T-21.13)", () => {
  it("caminho feliz: desligado → ocioso → verificando → disponivel → baixando → verificado → pronto → instalando", () => {
    let f = transicao("desligado", "ligar");
    for (const e of ["verificar", "achou_disponivel", "baixar", "baixado", "hash_ok", "instalar"] as const) f = transicao(f, e);
    expect(f).toBe("instalando");
  });
  it("não pula etapa: sem hash_ok não há `pronto`; sem baixar não há `baixando`; desligado só liga", () => {
    expect(transicao("verificado", "instalar")).toBe("verificado");
    expect(transicao("disponivel", "instalar")).toBe("disponivel");
    expect(transicao("disponivel", "baixado")).toBe("disponivel");
    for (const e of TODOS.filter((x) => x !== "ligar")) expect(transicao("desligado", e), e).toBe("desligado");
  });
  it("evento inválido devolve o MESMO estado; toda transição leva a uma fase conhecida", () => {
    for (const f of FASES_ATUALIZACAO) for (const e of TODOS) expect(FASES_ATUALIZACAO).toContain(transicao(f, e));
    expect(eventosValidos("pronto")).toContain("instalar");
  });
  it("falha e cancelamento: baixando volta a disponível ao cancelar, vai a erro ao falhar; erro se recupera", () => {
    expect(transicao("baixando", "cancelar")).toBe("disponivel");
    expect(transicao("baixando", "falhou")).toBe("erro");
    expect(transicao("erro", "reiniciar_erro")).toBe("ocioso");
    expect(transicao("instalando", "cancelar")).toBe("instalando");
  });
  it("desligar de qualquer estado ativo volta a desligado (exceto instalando)", () => {
    for (const f of ["ocioso", "verificando", "disponivel", "baixando", "verificado", "pronto", "erro"] as const) expect(transicao(f, "desligar")).toBe("desligado");
  });
});

describe("evento do histórico (T-21.13)", () => {
  const agora = new Date("2026-10-01T00:00:00Z");
  it("grava só código nominal, versões válidas e nada de texto livre", () => {
    const e = criarEvento({ tipo: "recusada", canal: "stable", versao_de: "1.0.0", versao_para: "1.1.0", motivo: "assinatura_invalida" }, "evt_12345678", agora);
    expect(e).toEqual({ id: "evt_12345678", tipo: "recusada", canal: "stable", versao_de: "1.0.0", versao_para: "1.1.0", motivo: "assinatura_invalida", criado_em: agora.toISOString() });
  });
  it("recusa motivo de servidor, versão inválida, tipo desconhecido e id inválido", () => {
    const base = { tipo: "recusada", canal: "stable", versao_de: "1.0.0" } as const;
    expect(() => criarEvento({ ...base, motivo: "o servidor disse: https://x.test?token=abc" as never }, "evt_12345678", agora)).toThrow();
    expect(() => criarEvento({ ...base, versao_de: "x" }, "evt_12345678", agora)).toThrow();
    expect(() => criarEvento({ ...base, tipo: "outro" as never }, "evt_12345678", agora)).toThrow();
    expect(() => criarEvento({ ...base }, "x", agora)).toThrow();
  });
});
