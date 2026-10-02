import { describe, expect, it, vi } from "vitest";
import { criarPermissoes, decidirPermissao, mapearStatus, origemDoApp, type PortaSistema } from "./permissoes";
import { urlDoApp } from "./scheme";

const ORIGEM = urlDoApp();

function porta(plataforma: NodeJS.Platform, status: Record<string, string> = {}): PortaSistema & { pedir: ReturnType<typeof vi.fn>; abrir: ReturnType<typeof vi.fn> } {
  const pedir = vi.fn(async () => true);
  const abrir = vi.fn(async () => undefined);
  return { plataforma, statusMedia: (t) => { if (status["lancar"] === "1") throw new Error("sem API"); return status[t] ?? "not-determined"; }, pedirMicrofone: pedir, abrirUrl: abrir, pedir, abrir };
}

describe("permissões do SO", () => {
  it("mapeia os status do macOS", () => {
    expect(["granted", "denied", "restricted", "not-determined", "unknown", "xyz"].map(mapearStatus)).toEqual(["concedida", "negada", "restrita", "indeterminada", "indeterminada", "indeterminada"]);
  });

  it("criar o serviço NÃO pede nada ao SO (nenhum pedido antes da ação do usuário)", () => {
    const p = porta("darwin");
    const perm = criarPermissoes(p);
    perm.microfone();
    perm.tela();
    expect(p.pedir).not.toHaveBeenCalled();
    expect(p.abrir).not.toHaveBeenCalled();
  });

  it("pedir microfone só pergunta ao SO quando indeterminada; negada nunca vira laço de pedidos", async () => {
    const p1 = porta("darwin", { microphone: "not-determined" });
    await criarPermissoes(p1).pedirMicrofone();
    expect(p1.pedir).toHaveBeenCalledTimes(1);
    const p2 = porta("darwin", { microphone: "denied" });
    expect(await criarPermissoes(p2).pedirMicrofone()).toBe("negada");
    expect(p2.pedir).not.toHaveBeenCalled();
  });

  it("Windows e Linux não lançam: tela concedida e microfone indeterminado sem API", async () => {
    const w = criarPermissoes(porta("win32", { microphone: "granted" }));
    expect(w.tela()).toBe("concedida");
    expect(w.microfone()).toBe("concedida");
    const l = criarPermissoes(porta("linux", { lancar: "1" }));
    expect(l.microfone()).toBe("indeterminada");
    expect(await l.pedirMicrofone()).toBe("indeterminada");
    expect(await l.abrirAjustes("microfone")).toBe(false);
  });

  it("abrir Ajustes usa só URLs fixas por plataforma", async () => {
    const p = porta("darwin");
    await criarPermissoes(p).abrirAjustes("tela");
    expect(p.abrir).toHaveBeenCalledWith("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
    const w = porta("win32");
    await criarPermissoes(w).abrirAjustes("microfone");
    expect(w.abrir).toHaveBeenCalledWith("ms-settings:privacy-microphone");
  });
});

describe("handler de permissões do Chromium", () => {
  const ok = { janelaPrincipal: true, origem: ORIGEM, consentimentoMicrofone: true };

  it("libera só áudio puro, do app, da janela principal e com aviso aceito", () => {
    expect(decidirPermissao("media", { mediaTypes: ["audio"] }, ok)).toBe(true);
    expect(decidirPermissao("media", { mediaType: "audio" }, ok)).toBe(true);
  });

  it("nega vídeo, tela, mistura de tipos e tipo desconhecido", () => {
    expect(decidirPermissao("media", { mediaTypes: ["video"] }, ok)).toBe(false);
    expect(decidirPermissao("media", { mediaTypes: ["audio", "video"] }, ok)).toBe(false);
    expect(decidirPermissao("media", { mediaType: "unknown" }, ok)).toBe(false);
    expect(decidirPermissao("media", undefined, ok)).toBe(false);
    expect(decidirPermissao("display-capture", { mediaTypes: ["video"] }, ok)).toBe(false);
  });

  it("nega outra origem, outra janela e antes do aviso de primeiro uso", () => {
    expect(decidirPermissao("media", { mediaTypes: ["audio"] }, { ...ok, origem: "https://exemplo.com/" })).toBe(false);
    expect(decidirPermissao("media", { mediaTypes: ["audio"] }, { ...ok, janelaPrincipal: false })).toBe(false);
    expect(decidirPermissao("media", { mediaTypes: ["audio"] }, { ...ok, consentimentoMicrofone: false })).toBe(false);
  });

  it("nega tudo que não é media", () => {
    for (const p of ["notifications", "geolocation", "clipboard-read", "midi", "openExternal", "fullscreen", "camera", "microphone"]) expect(decidirPermissao(p, { mediaTypes: ["audio"] }, ok)).toBe(false);
    expect(origemDoApp("file:///etc/passwd")).toBe(false);
    expect(origemDoApp(ORIGEM)).toBe(true);
  });
});
