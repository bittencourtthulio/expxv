// `electron-updater` NÃO está instalado no pacote padrão (D-24/D-342): o tipo é opaco aqui e o módulo só é carregado por `import()` dinâmico
// em `backends/electron-updater.ts`, no perfil de build `com-atualizacao`. Declaração mínima (shorthand) para o tsc não depender da instalação.
declare module "electron-updater";
