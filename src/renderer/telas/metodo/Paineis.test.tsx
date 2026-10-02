// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Saude, proporcaoSemTrabalho } from "./Saude";
import { Violacoes } from "./Violacoes";
import { formatarDuracao, montarQuadro } from "./util";
import { indice, tk, trabalho } from "./fabrica";

describe("Saúde", () => {
  it("calcula a proporção de pedidos prodx que não viram trabalho", () => {
    const p = (v: string | null) => trabalho([], { ferramenta: "prodx", prodx: { veredito: v, assinado: false, briefing: false } });
    const i = indice([p("fazer"), p("ja_existe"), p("nao_fazer"), p("fazer_outra_coisa"), p(null)]);
    expect(proporcaoSemTrabalho(i)).toEqual({ pedidos: 5, avaliados: 4, semTrabalho: 2 });
    render(<Saude indice={i} />);
    expect(screen.getByText("50%")).toBeTruthy();
  });
  it("memox ausente é estado normal, não erro", () => {
    render(<Saude indice={indice([])} />);
    expect(screen.getByText(/Sem sinais do memox.*normal/)).toBeTruthy();
    expect(screen.getByText(/Sem pedidos do prodx/)).toBeTruthy();
  });
});

describe("Violações e util", () => {
  it("traduz o tipo da violação para português claro", () => {
    render(<Violacoes violacoes={[{ tipo: "ciclo_dependencia", trabalho_id: "x", alvo: "T-1", arquivo: "docs/a.md", detalhe: "A→B" }]} />);
    expect(screen.getByText("Ciclo de dependências no plano")).toBeTruthy();
  });
  it("lista vazia diz que não há violações", () => {
    render(<Violacoes violacoes={[]} />);
    expect(screen.getByText(/Nenhuma violação/)).toBeTruthy();
  });
  it("formata duração e monta colunas", () => {
    expect(formatarDuracao(null)).toBe("—");
    expect(formatarDuracao(45_000)).toBe("45 s");
    expect(formatarDuracao(3_720_000)).toBe("1 h 2 min");
    expect(montarQuadro(trabalho([tk("A", { status: "concluida" }), tk("B", { depende_de: ["A"] })])).pendente[0]?.pronta).toBe(true);
  });
});
