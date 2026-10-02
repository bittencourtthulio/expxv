// ItemLista: o PADRÃO ÚNICO de item de lista do app (D-694). Toda lista de entidades (MCPs, provedores,
// skills, contas…) usa esta linha: título forte, descrição em uma linha, selos em pílula, coluna de meta
// (mono, discreta) e UMA ação com largura estável. Densidade: 56 px por padrão, ~38 px com `densa`.
// O corpo inteiro abre o detalhe; teclado de lista (↑/↓/Home/End) continua com a tela (prop `teclado`).
// Sem `aoAbrir`, o corpo é um `div` (linha de leitura, sem cursor de clique).
import type { KeyboardEvent, ReactNode } from "react";
import "./lista-padrao.css";

export type TomSelo = "neutro" | "destaque" | "sucesso" | "aviso" | "alerta";

export interface SeloLista {
  texto: string;
  tom?: TomSelo;
  /** dica suspensa (o texto integral quando a pílula corta) */
  titulo?: string;
}

export interface PropsItemLista {
  titulo: string;
  /** linha secundária; truncada com reticências (title fica por conta de quem passa) */
  descricao?: string | undefined;
  selos?: readonly SeloLista[] | undefined;
  /** coluna fixa antes da ação: contagem, data, estado curto (mono, discreto) */
  meta?: ReactNode | undefined;
  /** UMA ação principal por item (largura mínima estável do padrão) */
  acao?: ReactNode | undefined;
  /** linha aberta/selecionada: barra de destaque à esquerda + fundo */
  selecionado?: boolean | undefined;
  /** linha curta (~38–40 px): nome e descrição na mesma linha */
  densa?: boolean | undefined;
  /** estado extra do item (ex.: instalado, ligado) */
  estado?: string | undefined;
  /** rótulo acessível do corpo; padrão `${titulo}: detalhes` (troque quando o clique faz outra coisa) */
  rotuloCorpo?: string | undefined;
  aoAbrir?: (() => void) | undefined;
  /** teclado de lista da tela (roving ↑/↓/Home/End) */
  teclado?: ((e: KeyboardEvent<HTMLElement>) => void) | undefined;
  id?: string | undefined;
  children?: ReactNode;
}

export function ItemLista({ titulo, descricao, selos, meta, acao, selecionado, densa, estado, rotuloCorpo, aoAbrir, teclado, id, children }: PropsItemLista) {
  const temSelos = selos !== undefined && selos.length > 0;
  const rótulo = rotuloCorpo ?? `${titulo}: detalhes`;
  const conteudo = (
    <>
      <span className="lst-nome" title={titulo}>{titulo}</span>
      {descricao !== undefined && descricao !== "" ? <span className="lst-desc" title={descricao}>{descricao}</span> : null}
      {temSelos ? (
        <span className="lst-selos">
          {selos.map((s) => (
            <span key={s.texto} className="lst-selo" data-tom={s.tom} title={s.titulo ?? s.texto}>{s.texto}</span>
          ))}
        </span>
      ) : null}
    </>
  );
  return (
    <div
      className="lst-linha"
      data-id={id}
      data-selecionado={selecionado || undefined}
      data-densa={densa || undefined}
      data-estado={estado}
    >
      {aoAbrir !== undefined ? (
        <button type="button" className="lst-corpo" aria-label={rótulo} aria-pressed={selecionado} onClick={() => aoAbrir()} onKeyDown={teclado}>
          {conteudo}
        </button>
      ) : (
        <div className="lst-corpo" onKeyDown={teclado}>{conteudo}</div>
      )}
      {meta !== undefined ? <span className="lst-meta">{meta}</span> : null}
      {acao !== undefined ? <span className="lst-acao">{acao}</span> : null}
      {children}
    </div>
  );
}
