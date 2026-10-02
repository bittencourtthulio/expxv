// Permissões do SO e do Chromium (Fase 11, T-11.01). NADA é pedido ao SO no boot nem ao abrir uma tela: só por ação do usuário, depois do diálogo explicativo do app.
//  - Microfone: `getMediaAccessStatus`/`askForMediaAccess` (macOS); o handler do Chromium só libera ÁUDIO, só do scheme do app, só da janela principal e só depois do aviso de primeiro uso.
//  - Tela: nunca pelo handler do Chromium (a captura é do `desktopCapturer` no main); no macOS a permissão só vale depois de reabrir o app.
import type { EstadoPermissao } from "../compartilhado/captura";
import { HOST_APP, SCHEME } from "./scheme";

export type PlataformaApp = "mac" | "windows" | "linux";

export function plataformaDe(p: NodeJS.Platform): PlataformaApp {
  return p === "darwin" ? "mac" : p === "win32" ? "windows" : "linux";
}

/** Porta sobre `systemPreferences`/`shell` (injetada; stub nos testes). */
export interface PortaSistema {
  plataforma: NodeJS.Platform;
  statusMedia(tipo: "microphone" | "screen"): string;
  pedirMicrofone(): Promise<boolean>;
  abrirUrl(url: string): Promise<void>;
}

export interface Permissoes {
  plataforma: PlataformaApp;
  microfone(): EstadoPermissao;
  tela(): EstadoPermissao;
  /** SÓ depois do diálogo explicativo. No macOS abre o diálogo do SO uma única vez (depois disso o SO não pergunta de novo). */
  pedirMicrofone(): Promise<EstadoPermissao>;
  /** `false` onde não há painel conhecido (Linux). Abre só URLs fixas do próprio módulo. */
  abrirAjustes(painel: "microfone" | "tela"): Promise<boolean>;
}

export function mapearStatus(bruto: string): EstadoPermissao {
  switch (bruto) {
    case "granted": return "concedida";
    case "denied": return "negada";
    case "restricted": return "restrita";
    default: return "indeterminada"; // not-determined, unknown e qualquer outro
  }
}

const URL_AJUSTES: Record<"darwin" | "win32", Record<"microfone" | "tela", string>> = {
  darwin: {
    microfone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    tela: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  },
  win32: { microfone: "ms-settings:privacy-microphone", tela: "ms-settings:privacy-broadfilesystemaccess" },
};

export function criarPermissoes(so: PortaSistema): Permissoes {
  const ler = (tipo: "microphone" | "screen"): EstadoPermissao => {
    try { return mapearStatus(so.statusMedia(tipo)); } catch { return "indeterminada"; } // Linux: sem API; nunca lança
  };
  return {
    plataforma: plataformaDe(so.plataforma),
    microfone: () => ler("microphone"),
    tela: () => (so.plataforma === "darwin" ? ler("screen") : "concedida"), // Windows/Linux não têm gate de tela no SO
    async pedirMicrofone() {
      if (so.plataforma === "darwin") {
        // só pergunta enquanto indeterminada: negada/restrita exigem Ajustes (nunca laço de pedidos)
        if (ler("microphone") === "indeterminada") {
          try { await so.pedirMicrofone(); } catch { /* o estado abaixo diz o que ficou */ }
        }
      }
      return ler("microphone");
    },
    async abrirAjustes(painel) {
      const url = so.plataforma === "darwin" ? URL_AJUSTES.darwin[painel] : so.plataforma === "win32" ? URL_AJUSTES.win32[painel] : null;
      if (url === null) return false;
      try { await so.abrirUrl(url); return true; } catch { return false; }
    },
  };
}

// ------------------------------------------------------------------------------------------------ handler do Chromium

export interface ContextoPermissao {
  /** o id do webContents que pede é o da janela principal? */
  janelaPrincipal: boolean;
  /** URL de origem de quem pede. */
  origem: string;
  /** o aviso de primeiro uso do microfone já foi aceito pela pessoa? */
  consentimentoMicrofone: boolean;
}

/**
 * Decide um pedido de permissão do Chromium. Só `media` com ÁUDIO puro (nunca vídeo/tela), do scheme do app, da janela principal e com o aviso de primeiro uso aceito.
 * Todo o resto (notificações, geolocalização, câmera, display-capture, sensores…) é negado.
 */
export function decidirPermissao(permissao: string, detalhes: { mediaTypes?: readonly string[]; mediaType?: string } | undefined, ctx: ContextoPermissao): boolean {
  if (permissao !== "media") return false;
  if (!ctx.janelaPrincipal || !origemDoApp(ctx.origem) || !ctx.consentimentoMicrofone) return false;
  const tipos = detalhes?.mediaTypes;
  if (tipos !== undefined) return tipos.length === 1 && tipos[0] === "audio";
  return detalhes?.mediaType === "audio";
}

export function origemDoApp(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === `${SCHEME}:` && u.host === HOST_APP;
  } catch {
    return false;
  }
}
