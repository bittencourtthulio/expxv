import type { ReactElement } from "react";

// Sprite próprio de paths SVG (24x24, traço). Sem biblioteca de ícones.
const CAMINHOS = {
  inicio: "M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  missoes: "M4 4h16v16H4ZM4 10h16M10 10v10",
  terminais: "M3 5h18v14H3ZM7 10l3 2-3 2M12 15h5",
  metodo: "M3 4h6v5H3ZM15 4h6v5h-6ZM9 15h6v5H9ZM9 6.5h6M6 9v3a2 2 0 0 0 2 2h1M18 9v3a2 2 0 0 1-2 2h-1",
  workspaces: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  provedores: "M12 3 3 8v8l9 5 9-5V8ZM12 12l9-4M12 12 3 8M12 12v9",
  config: "M4 7h16M4 17h16M8 4v6M16 14v6",
  busca: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  alerta: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4",
  lua: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
  sol: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5",
  fixar: "M9 3h6l-1 6 3 3v2H7v-2l3-3ZM12 14v7",
  mais: "M12 5v14M5 12h14",
  dividirLado: "M4 5h16v14H4ZM12 5v14",
  dividirCima: "M4 5h16v14H4ZM4 12h16",
  expandir: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  fechar: "M6 6l12 12M18 6 6 18",
  copiar: "M9 9h11v11H9ZM15 9V4H4v11h5",
  ajuda: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01",
  aviso: "M12 4 2.5 20h19ZM12 10v4M12 17h.01",
  parar: "M7 7h10v10H7Z",
  pasta: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
} as const;

export type NomeIcone = keyof typeof CAMINHOS;

export function Icone({ nome, className = "" }: { nome: NomeIcone; className?: string }): ReactElement {
  return (
    <svg className={`icone ${className}`.trim()} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={CAMINHOS[nome]} />
    </svg>
  );
}
