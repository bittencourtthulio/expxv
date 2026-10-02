// Backend `electron-updater` (T-21.16) com `autoUpdater` FALSO: nenhum teste instala o pacote nem toca rede.
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { artefatoSintetico, manifestoBase, sha512Hex } from "../../../../tests/fixtures/atualizacao/manifestos";
import { AtualizacaoErro } from "../io/erros";
import { configurarUpdater, criarBackendElectronUpdater, type AutoUpdaterMinimo } from "./electron-updater";

let pasta = "";
beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), "atualizador-eu-"));
});
afterEach(() => rmSync(pasta, { recursive: true, force: true }));

class UpdaterFalso extends EventEmitter implements AutoUpdaterMinimo {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  allowPrerelease = true;
  channel: string | null = null;
  feed: unknown = null;
  chamadas: string[] = [];
  arquivoBaixado: string | null = null;
  setFeedURL(o: { provider: "generic"; url: string; channel?: string }): void {
    this.feed = o;
  }
  async checkForUpdates(): Promise<unknown> {
    this.chamadas.push("check");
    return {};
  }
  async downloadUpdate(): Promise<unknown> {
    this.chamadas.push("download");
    this.emit("download-progress", { percent: 50 });
    this.emit("update-downloaded", { downloadedFile: this.arquivoBaixado });
    return [];
  }
  quitAndInstall(): void {
    this.chamadas.push("quitAndInstall");
  }
}
const op = { hostDoBuild: "releases.exemplo.com", caminhoBase: "/", canal: "stable" as const };

describe("configuração obrigatória do updater (D-340, D-140)", () => {
  it("força autoDownload=false, autoInstallOnAppQuit=false, allowDowngrade=false e feed SÓ do build (https, host do build, canal)", () => {
    const u = new UpdaterFalso();
    configurarUpdater(u, op);
    expect([u.autoDownload, u.autoInstallOnAppQuit, u.allowDowngrade, u.allowPrerelease]).toEqual([false, false, false, false]);
    expect(u.feed).toEqual({ provider: "generic", url: "https://releases.exemplo.com/stable", channel: "latest" });
    const b = new UpdaterFalso();
    configurarUpdater(b, { ...op, canal: "beta", caminhoBase: "/feed" });
    expect(b.allowPrerelease).toBe(true);
    expect(b.channel).toBe("beta");
    expect(b.feed).toEqual({ provider: "generic", url: "https://releases.exemplo.com/feed/beta", channel: "beta" });
  });
});

describe("backend electron-updater", () => {
  it("pacote sem a dependência (import falha) ⇒ `backend_indisponivel`, sem derrubar nada", async () => {
    const b = criarBackendElectronUpdater({ ...op, carregar: async () => { throw new Error("Cannot find module"); } });
    const art = manifestoBase().artefatos[0]!;
    const erro = await b.baixar({ manifesto: manifestoBase(), artefato: art, destinoDir: pasta, onProgresso: () => undefined, sinal: new AbortController().signal }).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(AtualizacaoErro);
    expect((erro as AtualizacaoErro).motivo).toBe("backend_indisponivel");
  });

  it("baixa pelo updater, REVERIFICA sha512/tamanho do manifesto assinado e só então instala o que ele mesmo baixou", async () => {
    const conteudo = artefatoSintetico();
    const arquivo = join(pasta, "baixado.dmg");
    writeFileSync(arquivo, conteudo);
    const u = new UpdaterFalso();
    u.arquivoBaixado = arquivo;
    const b = criarBackendElectronUpdater({ ...op, carregar: async () => ({ autoUpdater: u }) });
    const m = manifestoBase({}, conteudo);
    const progresso: number[] = [];
    const r = await b.baixar({ manifesto: m, artefato: m.artefatos[0]!, destinoDir: pasta, onProgresso: (f) => progresso.push(f), sinal: new AbortController().signal });
    expect(r.caminho).toBe(arquivo);
    expect(progresso).toContain(0.5);
    expect(u.chamadas).toEqual(["check", "download"]);
    expect(u.autoDownload).toBe(false);
    await b.instalar(arquivo);
    expect(u.chamadas.at(-1)).toBe("quitAndInstall");
  });

  it("arquivo baixado com hash diferente do manifesto assinado: apagado e NUNCA instalado (camada (ii) vale mesmo com o updater satisfeito)", async () => {
    const conteudo = artefatoSintetico();
    const arquivo = join(pasta, "baixado.dmg");
    const ruim = Buffer.from(conteudo);
    ruim[0] = (ruim[0] as number) ^ 1;
    writeFileSync(arquivo, ruim);
    const u = new UpdaterFalso();
    u.arquivoBaixado = arquivo;
    const b = criarBackendElectronUpdater({ ...op, carregar: async () => ({ autoUpdater: u }) });
    const m = manifestoBase({}, conteudo);
    expect(sha512Hex(ruim)).not.toBe(m.artefatos[0]!.sha512);
    const erro = await b.baixar({ manifesto: m, artefato: m.artefatos[0]!, destinoDir: pasta, onProgresso: () => undefined, sinal: new AbortController().signal }).catch((e: unknown) => e);
    expect((erro as AtualizacaoErro).motivo).toBe("hash_diferente");
    expect(existsSync(arquivo)).toBe(false);
    await expect(b.instalar(arquivo)).rejects.toBeInstanceOf(AtualizacaoErro);
    expect(u.chamadas).not.toContain("quitAndInstall");
  });

  it("instalar recusa caminho que não é o baixado e erro do updater vira `falha_de_rede`", async () => {
    const u = new UpdaterFalso();
    const b = criarBackendElectronUpdater({ ...op, carregar: async () => ({ autoUpdater: u }) });
    await expect(b.instalar("/tmp/qualquer.dmg")).rejects.toBeInstanceOf(AtualizacaoErro);
    u.downloadUpdate = async () => {
      u.emit("error", new Error("https://x.test?token=SEGREDO"));
      return [];
    };
    const m = manifestoBase();
    const erro = await b.baixar({ manifesto: m, artefato: m.artefatos[0]!, destinoDir: pasta, onProgresso: () => undefined, sinal: new AbortController().signal }).catch((e: unknown) => e);
    expect((erro as AtualizacaoErro).motivo).toBe("falha_de_rede");
    expect(String((erro as Error).message)).not.toContain("SEGREDO"); // texto do updater nunca vaza no erro
  });
});
