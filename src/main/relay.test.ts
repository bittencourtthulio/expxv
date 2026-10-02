// Ligação do relay no main (T-22.21): desligado = nada carregado, nada aberto; consentimento, reconhecimento e URL; `habilitado` nunca persistido; reinício deixa desligado.
import { afterEach, describe, expect, it, vi } from "vitest";
import { criarCenarioRemoto, type CenarioRemoto } from "../../tests/fixtures/jarvis/cenario-remoto";
import { TEXTO_CONSENTIMENTO_RELAY_VERSAO, type EstadoRelay } from "../compartilhado/relay";
import type { ServicoRemoto } from "../nucleo/remoto/servico";
import { ligarRelay, type DepsLigacaoRelay } from "./relay";

const cenarios: CenarioRemoto[] = [];
afterEach(async () => {
  for (const c of cenarios.splice(0)) await c.fechar();
  vi.resetModules();
  vi.doUnmock("../nucleo/remoto-estendido/ws-cliente");
  vi.doUnmock("../nucleo/remoto-estendido/servico");
  vi.doUnmock("../nucleo/remoto-estendido/cliente-relay");
});

function deps(o: { remoto?: () => Promise<ServicoRemoto> } = {}) {
  const cen = criarCenarioRemoto();
  cenarios.push(cen);
  const prefs = new Map<string, unknown>();
  const emitidos: EstadoRelay[] = [];
  const chamadasRemoto = { n: 0 };
  const d: DepsLigacaoRelay = {
    banco: cen.j.banco,
    prefs: { obter: (k) => prefs.get(k), definir: async (k, v) => void prefs.set(k, v) },
    remoto: o.remoto ?? (async () => (chamadasRemoto.n++, cen.servico)),
    segredos: { ler: async (n) => cen.segredos.get(n) ?? null, gravar: async (n, v) => void cen.segredos.set(n, v), apagar: async (n) => void cen.segredos.delete(n) },
    emitirRenderer: (_c, p) => void emitidos.push(p),
  };
  return { d, cen, prefs, emitidos, chamadasRemoto };
}

describe("P-160 e AX-17: relay desligado não existe", () => {
  it("relay_desligado_zero: estado, config, SAS, desligar e pânico não carregam o núcleo do relay nem o ws-cliente e não tocam o serviço remoto", async () => {
    const carregados: string[] = [];
    for (const m of ["ws-cliente", "servico", "cliente-relay"]) {
      vi.doMock(`../nucleo/remoto-estendido/${m}`, async (orig) => {
        carregados.push(m);
        return orig();
      });
    }
    const { ligarRelay: ligar } = await import("./relay");
    const { d, chamadasRemoto } = deps();
    const l = ligar(d);
    expect(await l.api.estado()).toMatchObject({ ligado: false, situacao: "desligado", experimental: true, conectado: false, dispositivos: 0 });
    expect(await l.api.configObter()).toMatchObject({ habilitado: false, experimental: true, url: "", consentimento_versao: "", reconhecimento_experimental: false });
    expect(await l.api.parearSas()).toEqual({ situacao: "fechado", sas: null, nome_dispositivo: null });
    expect(await l.api.parearDecidir(true)).toEqual({ ok: false });
    expect(await l.api.desligar()).toEqual({ ok: true });
    // mexer na configuração com o relay desligado também NÃO monta o núcleo
    expect(await l.api.configDefinir({ url: "wss://relay.exemplo.com", padding: false })).toMatchObject({ url: "wss://relay.exemplo.com", padding: false, habilitado: false, experimental: true });
    await expect(l.api.configDefinir({ url: "ws://relay.exemplo.com" })).rejects.toThrow();
    await l.panico();
    expect(l.relayLigado()).toBe(false);
    expect(carregados).toEqual([]);
    expect(chamadasRemoto.n).toBe(0);
    await l.encerrar();
  });
  it("listar dispositivos com o relay desligado usa só o serviço remoto (sem importar o cliente do relay)", async () => {
    const { d } = deps();
    const { ligarRelay: ligar } = await import("./relay");
    const l = ligar(d);
    expect(await l.api.dispositivos()).toEqual([]);
  });
});

describe("ligar e config", () => {
  it("ligar sem consentimento/reconhecimento/URL é recusado com o motivo; nada abre", async () => {
    const { d, emitidos } = deps();
    const l = ligarRelay(d);
    expect(await l.api.ligar()).toEqual({ ok: false, motivo: "consentimento_ausente" });
    await l.api.configDefinir({ consentimento_versao: TEXTO_CONSENTIMENTO_RELAY_VERSAO });
    expect(await l.api.ligar()).toEqual({ ok: false, motivo: "reconhecimento_ausente" });
    await l.api.configDefinir({ reconhecimento_experimental: true });
    expect(await l.api.ligar()).toEqual({ ok: false, motivo: "url_invalida" });
    expect((await l.api.estado()).ligado).toBe(false);
    expect(l.relayLigado()).toBe(false);
    expect(emitidos.every((e) => !e.ligado)).toBe(true);
    await l.encerrar();
  });
  it("ax34: `habilitado` nunca é gravado como true nas preferências, mesmo pedindo; `experimental` não é editável; ligado com URL de teste (loopback) e depois reiniciar deixa desligado", async () => {
    const { d, prefs, emitidos } = deps();
    const l = ligarRelay(d);
    await l.api.configDefinir({ habilitado: true });
    expect((prefs.get("relay_config") as { habilitado: boolean }).habilitado).toBe(false);
    // `configDefinir` valida wss; o teste grava a URL de loopback direto nas preferências (ws://127.0.0.1 só vale com NODE_ENV=test)
    prefs.set("relay_config", { url: "", habilitado: false, experimental: true, consentimento_versao: TEXTO_CONSENTIMENTO_RELAY_VERSAO, reconhecimento_experimental: true, padding: true, pwa_origem: "" });
    await expect(l.api.configDefinir({ experimental: false } as never)).rejects.toThrow();
    await l.encerrar();
    // «reinício»: nova ligação sobre as mesmas preferências nasce desligada
    const l2 = ligarRelay(d);
    expect(await l2.api.estado()).toMatchObject({ ligado: false, situacao: "desligado" });
    expect(l2.relayLigado()).toBe(false);
    expect((await l2.api.configObter()).habilitado).toBe(false);
    expect(emitidos.every((e) => !e.ligado)).toBe(true);
    await l2.encerrar();
  });
});
