import type { ReactNode } from "react";

export function Pagina({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children?: ReactNode }) {
  return (
    <section className="pagina">
      <header className="pagina-cabecalho">
        <h1>{titulo}</h1>
        {subtitulo ? <p>{subtitulo}</p> : null}
      </header>
      {children}
    </section>
  );
}
