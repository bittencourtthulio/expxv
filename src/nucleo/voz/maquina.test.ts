import { describe, expect, it } from "vitest";
import type { EstadoDitado } from "../../compartilhado/captura";
import { criarMaquinaDitado, DEBOUNCE_ALTERNAR_MS, ERRO_VOLTA_A_OCIOSO_MS, type EventoDitado } from "./maquina";

function nova() {
  let t = 1_000;
  const m = criarMaquinaDitado(() => t);
  return { m, avancar: (ms: number) => void (t += ms) };
}

describe("máquina do ditado", () => {
  it("segurar: iniciar -> gravando, soltar -> transcrevendo -> injetando -> ocioso", () => {
    const { m } = nova();
    expect(m.transitar({ tipo: "iniciar", disparo: "segurar" })).toEqual({ estado: "gravando", acao: "abrir_microfone" });
    expect(m.transitar({ tipo: "soltar" })).toEqual({ estado: "transcrevendo", acao: "finalizar_fala" });
    expect(m.transitar({ tipo: "transcrito" })).toEqual({ estado: "injetando", acao: "injetar" });
    expect(m.transitar({ tipo: "injetado" }).estado).toBe("ocioso");
  });

  it("alternar: segundo toque dentro de 300 ms é ignorado; depois disso encerra; nunca desliga sozinho", () => {
    const { m, avancar } = nova();
    m.transitar({ tipo: "alternar" });
    avancar(DEBOUNCE_ALTERNAR_MS - 1);
    expect(m.transitar({ tipo: "alternar" })).toEqual({ estado: "gravando", acao: "nenhuma" });
    avancar(2_000);
    expect(m.transitar({ tipo: "tempo" }).estado).toBe("gravando"); // não desliga em 2 s
    expect(m.transitar({ tipo: "alternar" })).toEqual({ estado: "transcrevendo", acao: "finalizar_fala" });
  });

  it("soltar não encerra gravação em modo alternar", () => {
    const { m } = nova();
    m.transitar({ tipo: "alternar" });
    expect(m.transitar({ tipo: "soltar" }).estado).toBe("gravando");
  });

  it("parar explícito (botão ou atalho do app) encerra a fala em qualquer disparo, sem debounce", () => {
    const { m } = nova();
    m.transitar({ tipo: "alternar" });
    expect(m.transitar({ tipo: "parar" })).toEqual({ estado: "transcrevendo", acao: "finalizar_fala" });
    expect(m.transitar({ tipo: "parar" }).acao).toBe("nenhuma"); // fora de gravando não faz nada
    expect(nova().m.transitar({ tipo: "parar" }).estado).toBe("ocioso");
  });

  it("fala durante transcrevendo é recusada, não enfileirada", () => {
    const { m } = nova();
    m.transitar({ tipo: "iniciar", disparo: "segurar" });
    m.transitar({ tipo: "soltar" });
    expect(m.transitar({ tipo: "iniciar", disparo: "segurar" })).toEqual({ estado: "transcrevendo", acao: "recusar_ocupado" });
    expect(m.transitar({ tipo: "alternar" }).acao).toBe("recusar_ocupado");
  });

  it("cancelar vale em qualquer estado e volta a ocioso", () => {
    for (const ate of [0, 1, 2]) {
      const { m } = nova();
      m.transitar({ tipo: "iniciar", disparo: "segurar" });
      if (ate >= 1) m.transitar({ tipo: "soltar" });
      if (ate >= 2) m.transitar({ tipo: "transcrito" });
      expect(m.transitar({ tipo: "cancelar" })).toEqual({ estado: "ocioso", acao: "cancelar_tudo" });
    }
    const { m } = nova();
    expect(m.transitar({ tipo: "cancelar" }).acao).toBe("nenhuma");
  });

  it("erro volta a ocioso em 3 s e guarda o código", () => {
    const { m, avancar } = nova();
    m.transitar({ tipo: "iniciar", disparo: "segurar" });
    expect(m.transitar({ tipo: "falha", codigo: "motor_falhou" })).toEqual({ estado: "erro", acao: "mostrar_erro" });
    expect(m.codigoErro).toBe("motor_falhou");
    avancar(ERRO_VOLTA_A_OCIOSO_MS - 1);
    expect(m.transitar({ tipo: "tempo" }).estado).toBe("erro");
    avancar(1);
    expect(m.transitar({ tipo: "tempo" }).estado).toBe("ocioso");
    expect(m.codigoErro).toBeNull();
  });

  it("tabela completa: nenhuma combinação estado x evento lança nem produz estado inválido", () => {
    const eventos: EventoDitado[] = [
      { tipo: "iniciar", disparo: "segurar" }, { tipo: "iniciar", disparo: "alternar" }, { tipo: "soltar" }, { tipo: "parar" }, { tipo: "alternar" }, { tipo: "cancelar" },
      { tipo: "transcrito" }, { tipo: "injetado" }, { tipo: "falha", codigo: "cancelado" }, { tipo: "tempo" },
    ];
    const caminhos: EventoDitado[][] = [[], [{ tipo: "iniciar", disparo: "segurar" }], [{ tipo: "iniciar", disparo: "segurar" }, { tipo: "soltar" }], [{ tipo: "iniciar", disparo: "segurar" }, { tipo: "soltar" }, { tipo: "transcrito" }], [{ tipo: "iniciar", disparo: "segurar" }, { tipo: "falha", codigo: "motor_falhou" }]];
    const validos: EstadoDitado[] = ["ocioso", "gravando", "transcrevendo", "injetando", "erro"];
    const vistos = new Set<string>();
    for (const c of caminhos) for (const e of eventos) {
      const { m } = nova();
      for (const p of c) m.transitar(p);
      vistos.add(m.estado);
      const r = m.transitar(e);
      expect(validos).toContain(r.estado);
    }
    expect([...vistos].sort()).toEqual([...validos].sort());
  });
});
