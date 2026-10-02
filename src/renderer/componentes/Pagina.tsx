import type { ReactNode } from "react";
import "./pagina.css";
import "./conforto.css";

/** Como a tela ocupa a janela: leitura = coluna centralizada; painel = preenche com margem fluida; cheia = sem margem (terminais, canvas, diff). */
export type ModoPagina = "leitura" | "painel" | "cheia";
/** Largura máxima do conteúdo (tokens `--largura-*` em pagina.css). */
export type LarguraPagina = "estreita" | "padrao" | "larga" | "total";

export interface PropsPagina {
  titulo: string;
  subtitulo?: string;
  children?: ReactNode;
  /** Obrigatório por tela: ver `componentes/modos-tela.ts`. */
  modo: ModoPagina;
  largura?: LarguraPagina;
  /** Centraliza também na vertical (página inicial e estados vazios). */
  centralizar?: boolean;
}

export function Pagina({ titulo, subtitulo, children, modo, largura, centralizar }: PropsPagina) {
  return (
    <section className="pagina" data-modo={modo} data-largura={largura} data-centralizar={centralizar ? "" : undefined}>
      <header className="pagina-cabecalho">
        <h1>{titulo}</h1>
        {subtitulo ? <p>{subtitulo}</p> : null}
      </header>
      {children}
    </section>
  );
}
