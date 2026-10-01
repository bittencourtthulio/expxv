// Menu nativo do app: módulo PURO (sem `electron`); Menu entra injetado. Ações viram eventos por
// `emitir`; quem liga (main.ts) encaminha ao renderer.
//
// Como chamar em main.ts (depois de app.whenReady):
//   const menu = criarMenu({ plataforma: process.platform, Menu, emitir: (e) => janela?.webContents.send(canal, e) });
//   menu.instalar();   // ao sair/trocar: menu.destruir();
//
// Atalhos (04-UI-UX): Cmd+tecla no macOS; Ctrl+Shift+tecla no Windows/Linux (Ctrl+letra é do processo
// do terminal). Os que o renderer já trata sozinho (paleta, tema) aparecem só como dica
// (`registerAccelerator: false`), para o mesmo toque não disparar duas vezes.
import { PRODUTO } from "../nucleo/produto";

export type EventoMenu =
  | { tipo: "abrir-projeto" }
  | { tipo: "paleta" }
  | { tipo: "tema"; valor: "claro" | "escuro" | "sistema" | "alternar" }
  | { tipo: "sobre" };

export interface ItemTemplate {
  label?: string;
  role?: string;
  type?: "separator" | "submenu" | "checkbox" | "radio" | "normal";
  accelerator?: string;
  registerAccelerator?: boolean;
  submenu?: ItemTemplate[];
  click?: () => void;
}

export interface MenuInjetavel {
  buildFromTemplate(template: ItemTemplate[]): unknown;
  setApplicationMenu(menu: unknown): void;
}

export interface DepsMenu {
  plataforma: NodeJS.Platform | string;
  Menu: MenuInjetavel;
  emitir: (evento: EventoMenu) => void;
  nomeApp?: string;
}

const SEP: ItemTemplate = { type: "separator" };

export function montarTemplateMenu(plataforma: string, emitir: (e: EventoMenu) => void, nome: string = PRODUTO.nome): ItemTemplate[] {
  const mac = plataforma === "darwin";
  const tecla = (macAcc: string, outro: string) => (mac ? macAcc : outro);
  const tema = (valor: "claro" | "escuro" | "sistema" | "alternar") => () => emitir({ tipo: "tema", valor });

  const arquivo: ItemTemplate = {
    label: "Arquivo",
    submenu: [
      { label: "Abrir projeto…", accelerator: tecla("Cmd+O", "Ctrl+Shift+O"), click: () => emitir({ tipo: "abrir-projeto" }) },
      SEP,
      mac ? { role: "close" } : { label: "Sair", role: "quit" },
    ],
  };
  const editar: ItemTemplate = {
    label: "Editar",
    submenu: [{ role: "undo" }, { role: "redo" }, SEP, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
  };
  const visualizacao: ItemTemplate = {
    label: "Visualização",
    submenu: [
      { label: "Paleta de comandos…", accelerator: tecla("Cmd+K", "Ctrl+Shift+P"), registerAccelerator: false, click: () => emitir({ tipo: "paleta" }) },
      SEP,
      { label: "Alternar tema", accelerator: tecla("Cmd+Shift+L", "Ctrl+Shift+L"), registerAccelerator: false, click: tema("alternar") },
      {
        label: "Tema",
        type: "submenu",
        submenu: [
          { label: "Claro", click: tema("claro") },
          { label: "Escuro", click: tema("escuro") },
          { label: "Seguir o sistema", click: tema("sistema") },
        ],
      },
      SEP,
      { role: "togglefullscreen" },
    ],
  };
  const janela: ItemTemplate = {
    label: "Janela",
    submenu: mac ? [{ role: "minimize" }, { role: "zoom" }, SEP, { role: "front" }] : [{ role: "minimize" }, { role: "close" }],
  };
  const ajuda: ItemTemplate = {
    label: "Ajuda",
    submenu: mac ? [{ label: "Atalhos e comandos…", click: () => emitir({ tipo: "paleta" }) }] : [
      { label: "Atalhos e comandos…", click: () => emitir({ tipo: "paleta" }) },
      SEP,
      { label: `Sobre ${nome}`, click: () => emitir({ tipo: "sobre" }) },
    ],
  };

  const menus = [arquivo, editar, visualizacao, janela, ajuda];
  if (!mac) return menus;
  const app: ItemTemplate = {
    label: nome,
    submenu: [
      { label: `Sobre ${nome}`, click: () => emitir({ tipo: "sobre" }) },
      SEP,
      { role: "services" },
      SEP,
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      SEP,
      { role: "quit" },
    ],
  };
  return [app, ...menus];
}

export function criarMenu(deps: DepsMenu): { instalar(): void; destruir(): void } {
  return {
    instalar() {
      deps.Menu.setApplicationMenu(deps.Menu.buildFromTemplate(montarTemplateMenu(deps.plataforma, deps.emitir, deps.nomeApp)));
    },
    destruir() {
      deps.Menu.setApplicationMenu(null);
    },
  };
}
