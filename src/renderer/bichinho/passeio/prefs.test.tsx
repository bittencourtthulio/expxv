// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FAIXAS_CONFIG, validarFaixaConfig } from "../../../main/ipc/app";
import { SecaoBichinhos } from "../../telas/config/SecaoBichinhos";
import { CHAVE_OCIOSIDADE_MIN, CHAVE_PASSEAR, CHAVE_TRAVESSURAS, criarStoreBichinho } from "../estado";

afterEach(cleanup);
const esperar = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("preferências do passeio", () => {
  it("padrões: passeio ligado, travessuras ligadas, 3 minutos", async () => {
    const store = criarStoreBichinho({ api: () => undefined, config: () => ({ ler: async () => undefined, gravar: async () => ({ ok: true }) }) as never });
    await store.garantir([]);
    expect(store.obter()).toMatchObject({ passear: true, travessuras: true, ociosidadeMin: 3 });
  });
  it("lê e grava as três chaves do contrato; minutos ficam em 1–30", async () => {
    const gravar = vi.fn(async () => ({ ok: true as const }));
    const valores: Record<string, unknown> = { [CHAVE_PASSEAR]: false, [CHAVE_TRAVESSURAS]: false, [CHAVE_OCIOSIDADE_MIN]: 99 };
    const store = criarStoreBichinho({ api: () => undefined, config: () => ({ ler: async (c: string) => valores[c], gravar }) as never });
    await store.garantir([]);
    expect(store.obter()).toMatchObject({ passear: false, travessuras: false, ociosidadeMin: 30 });
    await store.definirOciosidadeMin(0);
    await store.definirPassear(true);
    await store.definirTravessuras(true);
    expect(gravar).toHaveBeenCalledWith(CHAVE_OCIOSIDADE_MIN, 1);
    expect(gravar).toHaveBeenCalledWith(CHAVE_PASSEAR, true);
    expect(gravar).toHaveBeenCalledWith(CHAVE_TRAVESSURAS, true);
  });
  it("o main valida as chaves (booleanos; minutos inteiros de 1 a 30)", () => {
    expect(Object.keys(FAIXAS_CONFIG)).toEqual(expect.arrayContaining([CHAVE_PASSEAR, CHAVE_TRAVESSURAS, CHAVE_OCIOSIDADE_MIN]));
    expect(() => validarFaixaConfig(CHAVE_OCIOSIDADE_MIN, 3)).not.toThrow();
    expect(() => validarFaixaConfig(CHAVE_OCIOSIDADE_MIN, 0)).toThrow();
    expect(() => validarFaixaConfig(CHAVE_OCIOSIDADE_MIN, 31)).toThrow();
    expect(() => validarFaixaConfig(CHAVE_OCIOSIDADE_MIN, 2.5)).toThrow();
    expect(() => validarFaixaConfig(CHAVE_PASSEAR, "sim")).toThrow();
    expect(() => validarFaixaConfig(CHAVE_TRAVESSURAS, true)).not.toThrow();
  });
  it("Configurações › Tema: alternar passeio e travessuras, mudar o tempo e a nota sobre reduzir movimento", async () => {
    const gravar = vi.fn(async () => ({ ok: true as const }));
    const store = criarStoreBichinho({ api: () => undefined, config: () => ({ ler: async () => undefined, gravar }) as never });
    render(<SecaoBichinhos carregar={async () => store} />);
    const passeio = await screen.findByRole("switch", { name: /Bichinhos passeiam quando ociosos: ligado/ });
    await esperar();
    const tempo = screen.getByLabelText("Tempo de ociosidade antes do passeio") as HTMLInputElement;
    expect(tempo.value).toBe("3");
    fireEvent.change(tempo, { target: { value: "7" } });
    await esperar();
    expect(gravar).toHaveBeenCalledWith(CHAVE_OCIOSIDADE_MIN, 7);
    fireEvent.click(screen.getByRole("switch", { name: /travessuras\): ligado/ }));
    await esperar();
    expect(gravar).toHaveBeenCalledWith(CHAVE_TRAVESSURAS, false);
    fireEvent.click(passeio);
    await esperar();
    expect(gravar).toHaveBeenCalledWith(CHAVE_PASSEAR, false);
    expect(screen.getByRole("switch", { name: /passeiam quando ociosos: desligado/ })).toBeTruthy();
    expect((screen.getByLabelText("Tempo de ociosidade antes do passeio") as HTMLInputElement).disabled).toBe(true);
    expect(document.body.textContent).toMatch(/Reduzir movimento/);
  });
});
