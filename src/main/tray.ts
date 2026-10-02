// Bandeja do sistema: abrir, pausar notificações, sair. Módulo PURO: Tray, Menu e nativeImage entram
// injetados (nada aqui importa `electron`).
//
// Como chamar em main.ts (depois de app.whenReady):
//   const { Tray, Menu, nativeImage } = await import("electron");
//   const tray = criarTray({
//     Tray, Menu, icone: criarIconeTray(__dirname, nativeImage),
//     abrir: () => mostrarJanela(), sair: () => app.quit(), notificacoes: criarPreferenciaNotificacoes(preferencias),
//   });
//   tray.instalar();   // no encerramento: tray.destruir();
import { join } from "node:path";
import { PRODUTO } from "../nucleo/produto";
import type { PreferenciaNotificacoes } from "./preferencia-notificacoes";

export const ARQUIVO_ICONE_TRAY = "icone-32.png";
export const TAMANHO_ICONE_TRAY = 16;

export interface ImagemTray { resize(op: { width: number; height: number }): ImagemTray }
export interface NativeImageTray { createFromPath(caminho: string): ImagemTray }

/** `diretorioDoMain` é o `__dirname` do main compilado; `build/` é seu irmão (build/icone-32.png). */
export function criarIconeTray(diretorioDoMain: string, nativeImage: NativeImageTray): ImagemTray {
  return nativeImage.createFromPath(join(diretorioDoMain, "..", "build", ARQUIVO_ICONE_TRAY)).resize({ width: TAMANHO_ICONE_TRAY, height: TAMANHO_ICONE_TRAY });
}

/**
 * `criarIconeTray` espera o diretório ONDE FICA `build/` como irmão do que recebe; o `__dirname` do main compilado é
 * `<raiz>/dist/main`, então o argumento certo é `<raiz>/dist` (no pacote: `app.asar/dist`, e `build/icone-32.png` entra em `files`).
 */
export function diretorioBaseDoIcone(diretorioDoMain: string): string {
  return join(diretorioDoMain, "..");
}

export interface ItemTray {
  label?: string;
  type?: "separator" | "checkbox" | "normal";
  checked?: boolean;
  click?: () => void;
}

export interface InstanciaTray {
  setToolTip(texto: string): void;
  setContextMenu(menu: unknown): void;
  on(evento: "click", ouvinte: () => void): void;
  destroy(): void;
}

export interface DepsTray {
  Tray: new (icone: never) => InstanciaTray;
  Menu: { buildFromTemplate(template: ItemTray[]): unknown };
  icone: ImagemTray;
  abrir: () => void;
  sair: () => void;
  notificacoes: Pick<PreferenciaNotificacoes, "ativo" | "definir">;
  nomeApp?: string;
  /** Fase 20: item "parar tudo" do Telegram (pânico). Só aparece com `visivel()` verdadeiro (canal ligado). */
  telegramPanico?: { visivel(): boolean; acionar(): void };
  /** kill-switch do controle remoto (Fase 13): só aparece com o servidor ligado. */
  remotoDesligar?: { visivel(): boolean; acionar(): void };
  /** pânico do relay (Fase 22): só aparece com o relay ligado; fecha todos os sockets, revoga todos os dispositivos e deixa tudo desligado. */
  relayPanico?: { visivel(): boolean; acionar(): void };
}

export function montarItensTray(deps: Pick<DepsTray, "abrir" | "sair" | "notificacoes" | "nomeApp" | "telegramPanico" | "remotoDesligar" | "relayPanico">): ItemTray[] {
  const nome = deps.nomeApp ?? PRODUTO.nome;
  return [
    { label: `Abrir ${nome}`, click: deps.abrir },
    { label: "Pausar notificações", type: "checkbox", checked: !deps.notificacoes.ativo(), click: () => void deps.notificacoes.definir(!deps.notificacoes.ativo()) },
    ...(deps.telegramPanico?.visivel() === true ? [{ label: "Parar tudo no Telegram (pânico)", click: deps.telegramPanico.acionar }] : []),
    ...(deps.remotoDesligar?.visivel() === true ? [{ label: "Desligar controle remoto", click: deps.remotoDesligar.acionar }] : []),
    ...(deps.relayPanico?.visivel() === true ? [{ label: "Pânico do relay (fechar tudo)", click: deps.relayPanico.acionar }] : []),
    { type: "separator" },
    { label: "Sair", click: deps.sair },
  ];
}

export function criarTray(deps: DepsTray): { instalar(): void; destruir(): void; atualizar(): void } {
  let tray: InstanciaTray | null = null;
  const menu = () => deps.Menu.buildFromTemplate(montarItensTray(deps));
  return {
    instalar() {
      if (tray !== null) return;
      tray = new deps.Tray(deps.icone as never);
      tray.setToolTip(deps.nomeApp ?? PRODUTO.nome);
      tray.setContextMenu(menu());
      tray.on("click", deps.abrir);
    },
    /** refaz o menu (ex.: a preferência mudou por outro caminho). */
    atualizar() { tray?.setContextMenu(menu()); },
    destruir() {
      tray?.destroy();
      tray = null;
    },
  };
}
