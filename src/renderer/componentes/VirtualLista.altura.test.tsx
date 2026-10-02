// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { VirtualLista } from "./VirtualLista";

// P-09: a altura da lista virtualizada NÃO pode vir do style inline (ele vence qualquer regra de CSS e, num pai de altura
// automática, a lista mede 69 000 px e renderiza as 1 000 linhas). A prova de medição real está em tests/perf/metodo.perf.ts.
describe("VirtualLista: altura vem do CSS", () => {
  it("não fixa height nem maxHeight inline", () => {
    render(<VirtualLista itens={[{ id: "a" }]} alturaItem={20} rotulo="Uma" chave={(x) => x.id} renderItem={(x) => <span>{x.id}</span>} />);
    const el = screen.getByRole("list", { name: "Uma" });
    expect(el.style.height).toBe("");
    expect(el.style.maxHeight).toBe("");
  });

  it("toda lista do Método tem altura própria por seletor mais específico que o padrão", () => {
    const pasta = join(__dirname, "../telas/metodo");
    const css = readFileSync(join(pasta, "metodo.css"), "utf8");
    for (const seletor of [".met-fase-tasks .virtual-lista", ".met-caixa-lista .virtual-lista", ".met-coluna .virtual-lista", ".met-rastro .virtual-lista"]) {
      expect(css, seletor).toMatch(new RegExp(`${seletor.replace(/[.]/g, "\\.")}\\s*\\{[^}]*height:\\s*\\d+(px|vh)`));
    }
    // tela Trabalhos: colunas e linha do tempo também fixam a altura por seletor mais específico
    const trab = readFileSync(join(__dirname, "../telas/trabalhos/trabalhos.css"), "utf8");
    for (const seletor of [".trab-coluna-corpo .virtual-lista", ".trab-linha-corpo .virtual-lista"]) {
      expect(trab, seletor).toMatch(new RegExp(`${seletor.replace(/[.]/g, "\\.")}\\s*\\{[^}]*height:\\s*100%`));
    }
    expect(readFileSync(join(__dirname, "VirtualLista.css"), "utf8")).toMatch(/\.virtual-lista\s*\{[^}]*height:\s*100%/);
  });
});
