import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { PRODUTO } from "./src/nucleo/produto";

// O título da janela vem de PRODUTO.nome (D-01): o index.html não carrega o nome.
const tituloDoProduto = () => ({
  name: "titulo-do-produto",
  transformIndexHtml: (html: string) => html.replace("%TITULO%", PRODUTO.nome),
});

// O renderer é servido pelo scheme próprio do app (base relativa) — sem servidor HTTP (D-09).
export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  base: "./",
  plugins: [react(), tituloDoProduto()],
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    target: "chrome138",
    sourcemap: false,
    chunkSizeWarningLimit: 400,
  },
});
