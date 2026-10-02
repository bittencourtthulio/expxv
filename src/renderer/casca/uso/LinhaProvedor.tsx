import type { ReactNode } from "react";
import { infoProvedor } from "../provedores-visual";
import { LogoProvedor } from "./LogoProvedor";

/** Seção de um provedor: logo + nome + quantidade de contas; as contas entram como filhos. Hierarquia provedor → conta → modelo. */
export function LinhaProvedor({ provedor, contas, children, tag: Tag = "section" }: { provedor: string; contas: number; children: ReactNode; tag?: "section" | "li" }) {
  const info = infoProvedor(provedor);
  return (
    <Tag className="uso-provedor" data-provedor={info.id} aria-label={info.nome}>
      <header className="uso-provedor-cab">
        <LogoProvedor provedor={provedor} tamanho={18} />
        <strong>{info.nome}</strong>
        <span className="uso-detalhe">{contas === 1 ? "1 conta" : `${contas} contas`}</span>
      </header>
      {children}
    </Tag>
  );
}
