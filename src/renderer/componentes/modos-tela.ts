import type { TelaId } from "../casca/telas";
import type { LarguraPagina, ModoPagina } from "./Pagina";

/** Modo de layout de cada tela (D-32): leitura centralizada, painel fluido ou cheia (full-bleed). Não muda ids de tela. */
export const MODO_DA_TELA: Record<TelaId, { modo: ModoPagina; largura?: LarguraPagina }> = {
  inicio: { modo: "leitura", largura: "larga" },
  config: { modo: "leitura", largura: "padrao" },
  provedores: { modo: "leitura", largura: "larga" },
  workspaces: { modo: "leitura", largura: "padrao" },
  missoes: { modo: "leitura", largura: "larga" },
  metodo: { modo: "painel", largura: "total" },
  trabalhos: { modo: "painel", largura: "total" },
  harness: { modo: "leitura", largura: "larga" },
  consumo: { modo: "leitura", largura: "larga" },
  alertas: { modo: "leitura", largura: "larga" },
  relatorios: { modo: "leitura", largura: "larga" },
  memoria: { modo: "leitura", largura: "larga" },
  catalogo: { modo: "leitura", largura: "larga" },
  "loja-mcp": { modo: "leitura", largura: "larga" },
  jarvis: { modo: "leitura", largura: "larga" },
  bench: { modo: "leitura", largura: "larga" },
  agil: { modo: "leitura", largura: "larga" },
  chat: { modo: "leitura", largura: "padrao" },
  terminais: { modo: "cheia" },
  mapa: { modo: "cheia" },
  conhecimento: { modo: "cheia" },
  versionamento: { modo: "cheia" },
  squads: { modo: "cheia" },
  pipelines: { modo: "cheia" },
};

/** Telas sem o componente `Pagina` (cabeçalho próprio em barra compacta): o contêiner raiz leva `data-modo` direto. */
export const SEM_PAGINA: Partial<Record<TelaId, string>> = {
  terminais: "área de trabalho maximizada (D-32), grade de PTYs",
  mapa: "canvas/grafo full-bleed (outro agente refaz o renderizador)",
  conhecimento: "grafo full-bleed (outro agente refaz o renderizador)",
  versionamento: "diff e árvore, barra compacta própria",
  squads: "editor de squads, barra compacta própria",
  pipelines: "editor de pipelines, barra compacta própria",
  harness: "barra de abas compacta própria",
  consumo: "barra de abas compacta própria",
  alertas: "barra de abas compacta própria",
  relatorios: "barra compacta própria",
  memoria: "barra compacta própria",
  catalogo: "barra compacta própria",
  "loja-mcp": "barra compacta própria",
  jarvis: "barra de abas compacta própria",
  bench: "barra compacta própria",
  agil: "barra de abas compacta própria",
  chat: "conversa com composer fixo no rodapé",
};
