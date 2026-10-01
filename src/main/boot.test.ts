import { describe, expect, it, vi } from "vitest";
import { executarBoot, iniciarServicosSecundarios } from "./boot";

describe("boot em duas ondas", () => {
  it("um serviço que falha não derruba os outros e vai para aoFalhar", async () => {
    const ok = vi.fn();
    const aoFalhar = vi.fn();
    await iniciarServicosSecundarios(
      {
        ruim: () => {
          throw new Error("boom");
        },
        ruimAssincrono: async () => {
          throw new Error("boom2");
        },
        bom: ok,
      },
      aoFalhar,
    );
    expect(ok).toHaveBeenCalledTimes(1);
    expect(aoFalhar).toHaveBeenCalledTimes(2);
    expect(aoFalhar.mock.calls.map((c) => c[0]).sort()).toEqual(["ruim", "ruimAssincrono"]);
  });

  it("aguarda só abrir; serviços começam depois e não são aguardados por quem abre", async () => {
    const ordem: string[] = [];
    let liberar: () => void = () => undefined;
    const lento = new Promise<void>((r) => {
      liberar = r;
    });
    const { servicosProntos } = await executarBoot({
      abrir: () => {
        ordem.push("abrir");
      },
      servicos: {
        lento: async () => {
          ordem.push("lento:inicio");
          await lento;
          ordem.push("lento:fim");
        },
      },
      aoFalhar: () => undefined,
    });
    // executarBoot já resolveu, mas o serviço lento ainda não terminou
    expect(ordem).toEqual(["abrir", "lento:inicio"]);
    liberar();
    await servicosProntos;
    expect(ordem).toEqual(["abrir", "lento:inicio", "lento:fim"]);
  });

  it("falha ao abrir propaga e nenhum serviço começa", async () => {
    const servico = vi.fn();
    await expect(
      executarBoot({
        abrir: () => {
          throw new Error("sem janela");
        },
        servicos: { s: servico },
        aoFalhar: () => undefined,
      }),
    ).rejects.toThrow("sem janela");
    expect(servico).not.toHaveBeenCalled();
  });

  it("marca onda 1 e cada serviço concluído", async () => {
    const marcas: string[] = [];
    const { servicosProntos } = await executarBoot({
      abrir: () => undefined,
      servicos: { a: () => undefined },
      aoFalhar: () => undefined,
      marcar: (n) => marcas.push(n),
    });
    await servicosProntos;
    expect(marcas).toEqual(["boot:onda1", "boot:servico:a"]);
  });
});
