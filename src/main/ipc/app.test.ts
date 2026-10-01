import { describe, expect, it } from "vitest";
import { registrarIpcApp, validarFaixaConfig, type DependenciasApp } from "./app";

function montar() {
  const dados = new Map<string, unknown>();
  const handlers = new Map<string, (e: never) => unknown>();
  const registro = { invoke: (c: string, _v: unknown, m: (e: never) => unknown) => void handlers.set(c, m), envio: () => undefined, registrados: () => [], remover: () => undefined };
  const preferencias = { obter: (k: string) => dados.get(k), definir: async (k: string, v: unknown) => void dados.set(k, v) };
  registrarIpcApp({ registro, versao: "1", preferencias, marcas: { ler: () => ({}), marcar: () => undefined }, sistemaEscuro: () => true, aoMudarTema: () => undefined } as unknown as DependenciasApp);
  return { dados, gravar: handlers.get("app:config_gravar")! };
}

describe("faixas de configuração no main", () => {
  it("aceita valores dentro da faixa e grava", async () => {
    const { dados, gravar } = montar();
    await gravar({ chave: "terminal_scrollback", valor: 50_000 } as never);
    await gravar({ chave: "cor_destaque", valor: "#1d4ed8" } as never);
    await gravar({ chave: "cor_destaque", valor: null } as never);
    await gravar({ chave: "permissao_padrao", valor: "automatico" } as never);
    expect(dados.get("terminal_scrollback")).toBe(50_000);
    expect(dados.get("permissao_padrao")).toBe("automatico");
  });
  it("rejeita fora de faixa, cor inválida e tipo errado sem gravar", async () => {
    const { dados, gravar } = montar();
    await expect(gravar({ chave: "terminal_scrollback", valor: 50_001 } as never)).rejects.toThrow(/faixa/);
    await expect(gravar({ chave: "terminal_scrollback", valor: 10 } as never)).rejects.toThrow();
    await expect(gravar({ chave: "limite_paineis", valor: 0 } as never)).rejects.toThrow();
    await expect(gravar({ chave: "cor_destaque", valor: "azul" } as never)).rejects.toThrow();
    await expect(gravar({ chave: "permissao_padrao", valor: "tudo" } as never)).rejects.toThrow();
    await expect(gravar({ chave: "notificacoes", valor: "sim" } as never)).rejects.toThrow();
    expect(dados.size).toBe(0);
  });
  it("chaves desconhecidas continuam livres e as reservadas continuam bloqueadas", async () => {
    const { gravar } = montar();
    await expect(gravar({ chave: "outra_coisa", valor: { a: 1 } } as never)).resolves.toEqual({ ok: true });
    await expect(gravar({ chave: "tema_x", valor: 1 } as never)).rejects.toThrow(/reservada/);
    expect(() => validarFaixaConfig("toString", 1)).not.toThrow();
  });
});
