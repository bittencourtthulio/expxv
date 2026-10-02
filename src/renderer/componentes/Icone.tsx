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
  ramo: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9c0 6-12 3-12 6",
  versionamento: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9c0 6-12 3-12 6",
  menos: "M5 12h14",
  desfazer: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  atualizar: "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5",
  baixar: "M12 4v12M6 12l6 6 6-6M5 20h14",
  subir: "M12 20V8M6 12l6-6 6 6M5 4h14",
  lixeira: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  consumo: "M4 20V10M10 20V4M16 20v-8M22 20H2",
  harness: "M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6",
  pasta: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z",
  memoria: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3ZM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  loja: "M4 9l1.5-5h13L20 9M4 9h16v11H4ZM4 9c0 2 1.5 3 3 3s3-1 3-3c0 2 1.5 3 3 3s3-1 3-3M10 20v-5h4v5",
  pipelines: "M3 6h5v4H3ZM16 6h5v4h-5ZM9.5 14h5v4h-5ZM8 8h8M12 8v6M5.5 10v2a2 2 0 0 0 2 2h2M18.5 10v2a2 2 0 0 1-2 2h-2",
  agil: "M4 5h16M4 5v14M4 19h16M8 15V11M12 15V8M16 15v-6M20 5v14",
  relatorios: "M6 3h9l4 4v14H6ZM14 3v5h5M9 12h7M9 16h7M9 9h2",
  squads: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20c0-3.3 2.7-5 6-5s6 1.7 6 5M17 11a2.5 2.5 0 1 0 0-5M17 15c2.5 0 4 1.5 4 4",
  grafo: "M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM9 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM7.7 6.4l8.6 1.5M7 7l1.5 10M16.7 10 10.2 17.3",
  chat: "M4 5h16v11H9l-5 4Z",
  bench: "M5 21V4M5 5h11l-2 3 2 3H5M13 21v-6M19 21v-9M3 21h18",
  mapa: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2ZM9 4v14M15 6v14",
  trabalhos: "M4 4h4.5v16H4ZM9.75 4h4.5v10h-4.5ZM15.5 4H20v13h-4.5Z",
  chevron: "M9 6l6 6-6 6",
  codigo: "M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14",
  catalogo: "M4 5h6v6H4ZM14 5h6v6h-6ZM4 15h6v5H4ZM14 15h6v5h-6Z",
  executar: "M7 4.5v15l12.5-7.5Z",
  chevronBaixo: "M6 9l6 6 6-6",
  estrela: "M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9L12 16.9l-5.2 2.9 1-5.9L3.5 9.7l5.9-.8Z",
  externo: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  reticencias: "M5 12h.01M12 12h.01M19 12h.01",
  lista: "M4 7h16M4 12h16M4 17h16",
  desdobrar: "M6 8l6-4 6 4M6 16l6 4 6-4",
  dobrar: "M6 4l6 4 6-4M6 20l6-4 6 4",
  faiscas: "M10 3l1.9 5.1L17 10l-5.1 1.9L10 17l-1.9-5.1L3 10l5.1-1.9ZM18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9Z",
  cpu: "M7 7h10v10H7ZM10 10h4v4h-4ZM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3",
} as const;

export type NomeIcone = keyof typeof CAMINHOS;

export function Icone({ nome, className = "" }: { nome: NomeIcone; className?: string }): ReactElement {
  return (
    <svg className={`icone ${className}`.trim()} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={CAMINHOS[nome]} />
    </svg>
  );
}
