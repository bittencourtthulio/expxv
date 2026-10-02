// Fechar Pane com memória NA MESMA TRANSAÇÃO (T-08.09, RF-06.14). `criarAoEncerrar` devolve o gancho `aoEncerrar(tx, pane)` que
// `repos.pane.encerrar(id, motivo, aoEncerrar)` deve chamar DENTRO da própria `banco.transacao`, depois do UPDATE do Pane: se a
// gravação da memória (ou qualquer coisa depois) falhar, o `UPDATE pane` também é desfeito. O mesmo texto do coletor faz o dedupe
// de 24 h juntar os dois caminhos (transação e barramento).
import type { Banco } from "../banco";
import { resolverContextoDoPane, type OpcoesContexto } from "./contexto";
import { textoDeFechamento } from "./coletor";
import { criarEscritor, type DepsEscrita } from "./escrita";

export function criarAoEncerrar(deps: Omit<DepsEscrita, "banco"> & OpcoesContexto) {
  return function aoEncerrar(tx: Banco, pane: { id: string; display_id?: number | null }, motivo = "encerrado", duracaoMs?: number): void {
    const ctx = resolverContextoDoPane(tx, pane.id, deps.cliTemMcp ? { cliTemMcp: deps.cliTemMcp } : {});
    if (ctx.modo === "off") return;
    const display = pane.display_id ?? tx.consultarUm<{ display_id: number }>("SELECT display_id FROM pane WHERE id = ?", [pane.id])?.display_id ?? null;
    criarEscritor({ ...deps, banco: tx }).gravar({
      ctx, tipo: "evento", conteudo: textoDeFechamento(display, motivo, duracaoMs), importancia: 2, origem: "coletor", fonte: "sistema", escopo: ctx.linhagem_id ? "pane" : "missao",
    });
  };
}
