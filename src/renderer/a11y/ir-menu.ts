import { act, fireEvent, screen } from "@testing-library/react";

/** Vai a uma tela pelo menu lateral agrupado: abre os grupos fechados até achar o item (como a pessoa faria) e clica. */
export async function irParaTela(nome: string): Promise<void> {
  const achar = () => screen.queryAllByRole("button", { name: new RegExp(`^${nome}`) }).find((b) => !b.hasAttribute("aria-expanded"));
  for (const cab of screen.queryAllByRole("button", { expanded: false })) {
    if (achar() !== undefined) break;
    await act(async () => { fireEvent.click(cab); });
  }
  const item = achar();
  if (item === undefined) throw new Error(`tela não encontrada no menu: ${nome}`);
  await act(async () => { fireEvent.click(item); });
}
