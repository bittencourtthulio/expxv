// @ts-nocheck
import { Botao } from "./botao";
import * as UI from "./ui";

export function Painel({ itens }: { itens: string[] }) {
  return (
    <section>
      <Botao onClick={() => itens.push("x")} />
      <UI.Cartao />
      <div className="x" />
    </section>
  );
}
