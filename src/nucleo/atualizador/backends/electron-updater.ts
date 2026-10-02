// ÚNICO arquivo de `src/` que referencia o `electron-updater` (D-340), SEMPRE por `import()` dinâmico e só depois do consentimento (duas chaves, D-342).
// Configuração fixa e conservadora (D-140: padrão seguro, nunca teto): sem download automático, sem instalar ao sair, sem downgrade; feed SOMENTE do build
// (provedor `generic` com host e caminho do build): qualquer URL vinda do renderer é ignorada porque este módulo nem a recebe.
import type { CanalAtualizacao } from "../../../compartilhado/atualizacao";
import type { BackendAtualizacao } from "../io/backend";
import { AtualizacaoErro } from "../io/erros";
import { reverificarArquivo } from "../io/verificador";

export interface FonteDoUpdater {
  /** padrão: `() => import("electron-updater")`. Injetável para teste (nenhum teste instala o pacote). */
  carregar?: () => Promise<{ autoUpdater: AutoUpdaterMinimo }>;
}

/** Subconjunto do `AppUpdater` que usamos (tipado à mão para não depender do pacote). */
export interface AutoUpdaterMinimo {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  allowPrerelease: boolean;
  channel: string | null;
  disableWebInstaller?: boolean;
  setFeedURL(opcoes: { provider: "generic"; url: string; channel?: string }): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(token?: unknown): Promise<unknown>;
  on(evento: string, ouvinte: (...args: any[]) => void): unknown;
  removeListener?(evento: string, ouvinte: (...args: any[]) => void): unknown;
  quitAndInstall(silencioso?: boolean, executarDepois?: boolean): void;
}

export interface OpcoesBackendElectronUpdater extends FonteDoUpdater {
  hostDoBuild: string;
  caminhoBase: string;
  canal: CanalAtualizacao;
}

const carregarPadrao = async (): Promise<{ autoUpdater: AutoUpdaterMinimo }> => (await import("electron-updater")) as { autoUpdater: AutoUpdaterMinimo };

/** Aplica a configuração obrigatória (exportada para o teste provar cada chave). */
export function configurarUpdater(u: AutoUpdaterMinimo, op: Pick<OpcoesBackendElectronUpdater, "hostDoBuild" | "caminhoBase" | "canal">): void {
  u.autoDownload = false;
  u.autoInstallOnAppQuit = false;
  u.allowDowngrade = false;
  u.allowPrerelease = op.canal === "beta";
  u.channel = op.canal === "beta" ? "beta" : "latest";
  const base = op.caminhoBase.endsWith("/") ? op.caminhoBase : `${op.caminhoBase}/`;
  u.setFeedURL({ provider: "generic", url: `https://${op.hostDoBuild}${base}${op.canal}`, channel: u.channel });
}

export function criarBackendElectronUpdater(op: OpcoesBackendElectronUpdater): BackendAtualizacao {
  let pronto: AutoUpdaterMinimo | null = null;
  let baixado: string | null = null;
  const obter = async (): Promise<AutoUpdaterMinimo> => {
    if (pronto !== null) return pronto;
    let mod: { autoUpdater: AutoUpdaterMinimo };
    try {
      mod = await (op.carregar ?? carregarPadrao)();
    } catch {
      throw new AtualizacaoErro("backend_indisponivel"); // pacote sem a dependência (perfil padrão)
    }
    configurarUpdater(mod.autoUpdater, op);
    pronto = mod.autoUpdater;
    return pronto;
  };
  return {
    nome: "electron-updater",
    capacidades: { baixa: true, instala: true },
    async baixar(p) {
      const u = await obter();
      let aoProgresso: ((i: { percent?: number }) => void) | null = null;
      let aoBaixar: ((i: { downloadedFile?: string }) => void) | null = null;
      try {
        const pronto2 = new Promise<string>((resolve, reject) => {
          aoBaixar = (info) => (typeof info?.downloadedFile === "string" ? resolve(info.downloadedFile) : reject(new AtualizacaoErro("backend_indisponivel")));
          aoProgresso = (i) => p.onProgresso(Math.max(0, Math.min(1, (i.percent ?? 0) / 100)));
          u.on("update-downloaded", aoBaixar);
          u.on("download-progress", aoProgresso);
          u.on("error", () => reject(new AtualizacaoErro("falha_de_rede")));
          p.sinal.addEventListener("abort", () => reject(new AtualizacaoErro("cancelado")), { once: true });
        });
        await u.checkForUpdates();
        await u.downloadUpdate();
        const caminho = await pronto2;
        // camada (ii): o arquivo que o updater baixou precisa bater com o sha512 e o tamanho do manifesto ASSINADO (senão é apagado)
        await reverificarArquivo(caminho, p.artefato);
        baixado = caminho;
        return { caminho };
      } finally {
        if (aoBaixar !== null) u.removeListener?.("update-downloaded", aoBaixar);
        if (aoProgresso !== null) u.removeListener?.("download-progress", aoProgresso);
      }
    },
    async instalar(caminho) {
      const u = await obter();
      if (baixado === null || caminho !== baixado) throw new AtualizacaoErro("backend_indisponivel"); // só instala o que ele mesmo baixou e passou na camada (ii)
      u.quitAndInstall(false, true);
    },
  };
}
