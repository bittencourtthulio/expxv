import type { ModoMissao, OrigemMissao, Papel, PedidoCriarMissao } from "../../../compartilhado/dominio";

export interface FormMissao {
  modo: ModoMissao;
  origem: OrigemMissao;
  titulo: string;
  pedido: string;
  /** CLI por papel; "" = não usar. */
  clis: Partial<Record<Papel, string>>;
  cadeado: boolean;
}

export const TITULO_MAX = 120;
export const PEDIDO_MAX = 8_000;

export const papeisDoModo = (modo: ModoMissao): readonly Papel[] => (modo === "livre" ? ["nenhum"] : ["piloto", "executor", "explorador", "revisor"]);
export const papelObrigatorio = (modo: ModoMissao, papel: Papel): boolean => modo === "livre" ? papel === "nenhum" : papel === "piloto";

export type ErrosMissao = Partial<Record<"titulo" | "pedido" | Papel, string>>;

export function validar(f: FormMissao, instaladas: readonly string[]): ErrosMissao {
  const e: ErrosMissao = {};
  const titulo = f.titulo.trim();
  if (titulo === "") e.titulo = "Dê um título à missão.";
  else if (titulo.length > TITULO_MAX) e.titulo = `Use no máximo ${TITULO_MAX} caracteres.`;
  const pedido = f.pedido.trim();
  if (pedido === "" && (f.modo !== "livre" || f.origem !== "livre")) e.pedido = "Descreva o pedido: é o que o piloto vai receber.";
  else if (pedido.length > PEDIDO_MAX) e.pedido = `Use no máximo ${PEDIDO_MAX} caracteres.`;
  for (const p of papeisDoModo(f.modo)) {
    const cli = f.clis[p] ?? "";
    if (cli === "") {
      if (papelObrigatorio(f.modo, p)) e[p] = f.modo === "livre" ? "Escolha a CLI." : "Squad e agêntico exigem um piloto: escolha a CLI do piloto.";
    } else if (!instaladas.includes(cli)) e[p] = "Essa CLI não está instalada.";
  }
  return e;
}

export function montarPedido(f: FormMissao, workspaceId: string): PedidoCriarMissao {
  const clis: Partial<Record<Papel, string>> = {};
  for (const p of papeisDoModo(f.modo)) { const c = f.clis[p]; if (c !== undefined && c !== "") clis[p] = c; }
  return { workspace_id: workspaceId, modo: f.modo, origem: f.origem, titulo: f.titulo.trim(), pedido: f.pedido.trim(), clis };
}

/** Cadeado: a CLI escolhida vale para todos os papéis do modo. */
export function aplicarCli(f: FormMissao, papel: Papel, cli: string): FormMissao {
  if (!f.cadeado || (cli === "" && !papelObrigatorio(f.modo, papel))) return { ...f, clis: { ...f.clis, [papel]: cli } };
  const clis: Partial<Record<Papel, string>> = {};
  for (const p of papeisDoModo(f.modo)) clis[p] = cli;
  return { ...f, clis };
}
