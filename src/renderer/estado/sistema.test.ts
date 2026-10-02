import { describe, expect, it, vi } from "vitest";
import { CHAVE_MEDIDOR_MOSTRAR, PONTOS_HISTORICO, type AmostraSistema } from "../../compartilhado/sistema";
import { criarStoreSistema } from "./sistema";

function montar(preferencia: unknown = undefined) {
  let ouvinte: ((a: AmostraSistema) => void) | null = null;
  const cancelar = vi.fn(() => { ouvinte = null; });
  const api = { assinar: vi.fn(async (ativo: boolean) => ({ ativo })), detalhe: vi.fn(async () => null), aoAmostra: vi.fn((cb: (a: AmostraSistema) => void) => { ouvinte = cb; return cancelar; }) };
  const config = { ler: vi.fn(async () => preferencia), gravar: vi.fn(async () => ({ ok: true as const })) };
  const store = criarStoreSistema({ api: () => api as never, config: () => config as never });
  return { store, api, config, emitir: (a: AmostraSistema) => ouvinte?.(a), cancelar };
}

describe("store do medidor", () => {
  it("padrão LIGADO: lê a preferência, assina o main e recebe amostras", async () => {
    const m = montar();
    await m.store.iniciar();
    expect(m.config.ler).toHaveBeenCalledWith(CHAVE_MEDIDOR_MOSTRAR);
    expect(m.api.assinar).toHaveBeenCalledWith(true);
    m.emitir({ cpu: 20, ram: 50 });
    expect(m.store.obter().amostra).toEqual({ cpu: 20, ram: 50 });
    expect(m.store.obter().mostrar).toBe(true);
  });
  it("preferência desligada: NÃO assina o main (zero timers lá) e ignora amostras", async () => {
    const m = montar(false);
    await m.store.iniciar();
    expect(m.api.assinar).not.toHaveBeenCalled();
    expect(m.api.aoAmostra).not.toHaveBeenCalled();
    expect(m.store.obter().mostrar).toBe(false);
  });
  it("ocultar persiste, desassina e limpa o histórico; mostrar religa", async () => {
    const m = montar();
    await m.store.iniciar();
    m.emitir({ cpu: 1, ram: 2 });
    await m.store.definirMostrar(false);
    expect(m.config.gravar).toHaveBeenCalledWith(CHAVE_MEDIDOR_MOSTRAR, false);
    expect(m.api.assinar).toHaveBeenLastCalledWith(false);
    expect(m.cancelar).toHaveBeenCalled();
    expect(m.store.obter()).toMatchObject({ mostrar: false, amostra: null, historicoCpu: [], aberto: false });
    await m.store.alternarMostrar();
    expect(m.config.gravar).toHaveBeenLastCalledWith(CHAVE_MEDIDOR_MOSTRAR, true);
    expect(m.api.assinar).toHaveBeenLastCalledWith(true);
  });
  it("histórico limitado a 2 min (60 pontos)", async () => {
    const m = montar();
    await m.store.iniciar();
    for (let i = 0; i < PONTOS_HISTORICO + 10; i++) m.emitir({ cpu: i % 100, ram: 5 });
    expect(m.store.obter().historicoCpu).toHaveLength(PONTOS_HISTORICO);
  });
  it("anuncia só ao cruzar limiar (não por amostra)", async () => {
    const m = montar();
    await m.store.iniciar();
    const anuncios: string[] = [];
    m.store.assinar(() => { const a = m.store.obter().anuncio; if (a !== "" && anuncios.at(-1) !== a) anuncios.push(a); });
    for (const cpu of [10, 20, 30, 85, 86, 87, 95, 96, 20, 21]) m.emitir({ cpu, ram: 10 });
    expect(anuncios).toEqual(["Atenção: CPU em 85 por cento.", "Alerta: CPU em 95 por cento.", "CPU e memória voltaram ao normal."]);
  });
  it("sem a API (navegador/teste) = indisponível, nunca erro", async () => {
    const store = criarStoreSistema({ api: () => undefined, config: () => undefined });
    await store.iniciar();
    expect(store.obter().disponivel).toBe(false);
    store.abrir();
    expect(store.obter().aberto).toBe(false);
  });
  it("popover abre e fecha só com o medidor visível", async () => {
    const m = montar();
    await m.store.iniciar();
    m.store.alternar();
    expect(m.store.obter().aberto).toBe(true);
    m.store.fechar();
    expect(m.store.obter().aberto).toBe(false);
  });
});
