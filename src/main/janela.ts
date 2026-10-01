import { join } from "node:path";
import type { TemaEfetivo } from "../compartilhado/ipc";
import { corFundoJanela } from "../compartilhado/tema";

/**
 * Criação da janela com as webPreferences seguras obrigatórias (contextIsolation + sandbox, sem
 * nodeIntegration). `BrowserWindow` é injetável para teste. A janela nasce oculta e só aparece em
 * `ready-to-show` (sem flash branco); o fundo segue o tema (D-15).
 */

export interface WebPreferencesSeguras {
  preload: string;
  contextIsolation: true;
  sandbox: true;
  nodeIntegration: false;
  webSecurity: true;
  allowRunningInsecureContent: false;
  spellcheck: false;
}

export function webPreferencesSeguras(preload: string): WebPreferencesSeguras {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: false,
  };
}

export interface OpcoesConstrucao {
  show: false;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  backgroundColor: string;
  webPreferences: WebPreferencesSeguras;
}

export interface Janela {
  loadURL(url: string): unknown;
  on(evento: string, cb: (...args: never[]) => void): void;
  once(evento: string, cb: (...args: never[]) => void): void;
  show(): void;
}

export const DIMENSOES = { largura: 1280, altura: 820, larguraMinima: 720, alturaMinima: 480 } as const;

export function opcoesDaJanela(preload: string, tema: TemaEfetivo): OpcoesConstrucao {
  return {
    show: false,
    width: DIMENSOES.largura,
    height: DIMENSOES.altura,
    minWidth: DIMENSOES.larguraMinima,
    minHeight: DIMENSOES.alturaMinima,
    backgroundColor: corFundoJanela(tema),
    webPreferences: webPreferencesSeguras(preload),
  };
}

export function criarJanela(op: {
  url: string;
  preload: string;
  tema: TemaEfetivo;
  BrowserWindow: new (opConstrucao: OpcoesConstrucao) => Janela;
  aoMostrar?: () => void;
}): Janela {
  const janela = new op.BrowserWindow(opcoesDaJanela(op.preload, op.tema));
  janela.once("ready-to-show", () => {
    janela.show();
    op.aoMostrar?.();
  });
  void janela.loadURL(op.url);
  return janela;
}

/** Caminho do preload compilado, relativo ao main em execução (dist/main → dist/preload). */
export function caminhoDoPreload(diretorioDoMain: string): string {
  return join(diretorioDoMain, "..", "preload", "preload.js");
}
