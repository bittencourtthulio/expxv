// Cedência do grupo DIREITO do cabeçalho (04-UI-UX.md, "Cabeçalho em janela estreita"): a busca
// central nunca é coberta e nenhum chip desenha por cima do vizinho. Quem cede é o texto (com
// reticências): a cota e o nome do seletor de rigidez; suíte, medidor e ações têm largura fixa.
// Regressão da sobreposição relatada entre ~960 e ~1300 px de largura.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ler = (arquivo: string): string => readFileSync(resolve(__dirname, arquivo), "utf8");

describe("CSS do grupo direito do topo (cedência sem sobreposição)", () => {
  it("cota: o piso do min-width é 48 px — min-width vence max-width, então 96 px anulava as faixas estreitas de casca.css", () => {
    const css = ler("sistema.css");
    expect(css).toMatch(/\.topo-direita \.cota-chip \{[^}]*flex: 0 1 auto;[^}]*min-width: 48px;[^}]*\}/);
    expect(css).not.toMatch(/\.topo-direita \.cota-chip \{[^}]*min-width: 96px/);
  });

  it("rigidez: as barras não encolhem (flex: none) e o rótulo elide o nome (min-width 0 + ellipsis) — o conteúdo nunca desenha fora da pílula", () => {
    const css = ler("rigidez.css");
    expect(css).toMatch(/\.rig-slider \{[^}]*flex: none;[^}]*\}/);
    expect(css).toMatch(
      /\.rig-rotulo \{[^}]*flex: 0 1 auto;[^}]*min-width: 0;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*\}/,
    );
    expect(css).toMatch(/\.rig-rotulo > span:first-child \{[^}]*min-width: 0;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*\}/);
    expect(css).toMatch(/\.rig-badge \{[^}]*flex: none;[^}]*\}/);
  });

  it("itens de largura fixa seguem fixos: medidor, ações e ícones nunca voltam a encolher", () => {
    const css = ler("sistema.css");
    expect(css).toMatch(/\.sis-chip \{[^}]*flex: none;[^}]*\}/);
    expect(css).toMatch(/\.topo-direita \.topo-acoes \{ flex: none; \}/);
    expect(css).toMatch(/\.topo-direita \.topo-icone \{ flex: none; \}/);
  });

  it("botão da suíte: nenhuma regra devolve flex: initial nem trava TODO o resto em flex: none (o nome do rig cede também com o botão presente)", () => {
    const css = ler("suite.css");
    expect(css).toMatch(/\.topo-workspace\.topo-suite \{ flex: none;[^}]*\}/);
    expect(css).not.toMatch(/flex: initial/);
    expect(css).not.toMatch(/:not\(\.topo-suite\):not\(\.cota-chip\) \{ flex: none/);
  });
});
