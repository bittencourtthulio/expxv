// Adaptadores do Electron para captura e voz (Fase 11): fonte de tela, codificador de imagem, porta do sistema (permissões) e tecla global. O módulo `electron` entra por parâmetro
// (interface mínima abaixo): nada aqui importa Electron em tempo de carga e os testes usam stubs. Nada é chamado no boot: o primeiro uso (ação da pessoa) é quem aciona.
import type { DisplayInfo, Retangulo } from "../nucleo/captura/geometria";
import { tamanhoDaMiniatura } from "../nucleo/captura/geometria";
import type { Bitmap, Codificador } from "../nucleo/captura/imagem";
import type { TeclaGlobal } from "../nucleo/voz/teclas";
import type { Capturado, FonteTela } from "./captura";
import type { PortaSistema } from "./permissoes";

/** Subconjunto do `NativeImage`. */
export interface ImagemNativa {
  getSize(): { width: number; height: number };
  toBitmap(): Buffer | Uint8Array;
  toPNG(): Buffer | Uint8Array;
  toJPEG(qualidade: number): Buffer | Uint8Array;
  resize(op: { width: number; height: number; quality?: string }): ImagemNativa;
}

/** `Rectangle` do Electron. */
export interface RetanguloEletron { x: number; y: number; width: number; height: number }

export interface JanelaMinima {
  isDestroyed(): boolean;
  getBounds(): RetanguloEletron;
  getContentBounds(): RetanguloEletron;
  webContents: { capturePage(): Promise<ImagemNativa> };
}

/** Subconjunto do módulo `electron` usado aqui. */
export interface ModuloElectron {
  screen: { getAllDisplays(): { id: number; bounds: RetanguloEletron; scaleFactor: number }[] };
  desktopCapturer: { getSources(op: { types: string[]; thumbnailSize: { width: number; height: number } }): Promise<{ display_id: string; thumbnail: ImagemNativa }[]> };
  nativeImage: { createFromBitmap(b: Buffer, op: { width: number; height: number; scaleFactor?: number }): ImagemNativa };
  systemPreferences: { getMediaAccessStatus(tipo: "microphone" | "screen" | "camera"): string; askForMediaAccess?(tipo: "microphone" | "camera"): Promise<boolean> };
  shell: { openExternal(url: string): Promise<void> };
  globalShortcut: { register(acelerador: string, fn: () => void): boolean; unregister(acelerador: string): void; unregisterAll?(): void };
}

const paraBuffer = (b: Bitmap): Buffer => Buffer.from(b.dados.buffer, b.dados.byteOffset, b.dados.byteLength);

function deImagem(img: ImagemNativa): Bitmap {
  const t = img.getSize();
  const bruto = img.toBitmap();
  return { largura: t.width, altura: t.height, dados: new Uint8Array(bruto.buffer, bruto.byteOffset, bruto.byteLength).slice() };
}

export function criarFonteEletron(e: ModuloElectron, janela: () => JanelaMinima | null): FonteTela {
  const displays = (): DisplayInfo[] => e.screen.getAllDisplays().map((d) => ({ id: d.id, x: d.bounds.x, y: d.bounds.y, largura: d.bounds.width, altura: d.bounds.height, fator: d.scaleFactor > 0 ? d.scaleFactor : 1 }));
  const viva = (): JanelaMinima | null => {
    const j = janela();
    return j === null || j.isDestroyed() ? null : j;
  };
  return {
    displays,
    janelaBounds(): Retangulo | null {
      const j = viva();
      if (j === null) return null;
      const b = j.getBounds();
      return { x: b.x, y: b.y, largura: b.width, altura: b.height };
    },
    async capturarDisplay(displayId): Promise<Capturado | null> {
      const todos = displays();
      const alvo = todos.find((x) => x.id === displayId);
      if (alvo === undefined) return null;
      // thumbnailSize = bounds × fator: sem isso o Retina sai em baixa resolução (o recorte físico depende disso)
      const fontes = await e.desktopCapturer.getSources({ types: ["screen"], thumbnailSize: tamanhoDaMiniatura(alvo) });
      const fonte = fontes.find((f) => f.display_id === String(displayId)) ?? (todos.length === 1 ? fontes[0] : undefined) ?? fontes[todos.indexOf(alvo)];
      if (fonte === undefined) return null;
      const bitmap = deImagem(fonte.thumbnail);
      if (bitmap.largura === 0 || bitmap.altura === 0) return null;
      // o SO pode ter entregue outro tamanho: o fator efetivo vem da imagem real
      return { bitmap, display: { ...alvo, fator: bitmap.largura / alvo.largura } };
    },
    async capturarJanelaApp(): Promise<Capturado | null> {
      const j = viva();
      if (j === null) return null;
      const bitmap = deImagem(await j.webContents.capturePage());
      const conteudo = j.getContentBounds();
      if (bitmap.largura === 0 || conteudo.width === 0) return null;
      const fator = bitmap.largura / conteudo.width;
      return { bitmap, display: { id: -1, x: 0, y: 0, largura: Math.round(bitmap.largura / fator), altura: Math.round(bitmap.altura / fator), fator } };
    },
  };
}

export function criarCodificadorEletron(e: ModuloElectron): Codificador {
  const imagem = (b: Bitmap): ImagemNativa => e.nativeImage.createFromBitmap(paraBuffer(b), { width: b.largura, height: b.altura, scaleFactor: 1 });
  return {
    png: (b) => new Uint8Array(imagem(b).toPNG()),
    jpeg: (b, q) => new Uint8Array(imagem(b).toJPEG(q)),
  };
}

/** JPEG no tamanho LÓGICO do display (o renderer desenha 1:1 e devolve coordenadas lógicas). */
export function criarPreviaEletron(e: ModuloElectron): (b: Bitmap, d: DisplayInfo) => Uint8Array {
  return (b, d) => {
    const img = e.nativeImage.createFromBitmap(paraBuffer(b), { width: b.largura, height: b.altura, scaleFactor: 1 });
    const reduzida = b.largura === d.largura && b.altura === d.altura ? img : img.resize({ width: d.largura, height: d.altura, quality: "good" });
    return new Uint8Array(reduzida.toJPEG(80));
  };
}

export function criarPortaSistemaEletron(e: ModuloElectron, plataforma: NodeJS.Platform): PortaSistema {
  return {
    plataforma,
    statusMedia: (tipo) => e.systemPreferences.getMediaAccessStatus(tipo),
    pedirMicrofone: async () => (e.systemPreferences.askForMediaAccess === undefined ? false : e.systemPreferences.askForMediaAccess("microphone")),
    abrirUrl: (url) => e.shell.openExternal(url),
  };
}

export function criarTeclaGlobalEletron(e: ModuloElectron): TeclaGlobal {
  const mine = new Set<string>();
  return {
    registrar(acelerador, aoAcionar) {
      try {
        if (!e.globalShortcut.register(acelerador, aoAcionar)) return false;
        mine.add(acelerador);
        return true;
      } catch {
        return false;
      }
    },
    liberar(acelerador) {
      if (!mine.delete(acelerador)) return;
      try { e.globalShortcut.unregister(acelerador); } catch { /* já liberado */ }
    },
    liberarTodas() {
      for (const a of mine) { try { e.globalShortcut.unregister(a); } catch { /* já liberado */ } }
      mine.clear();
    },
  };
}
