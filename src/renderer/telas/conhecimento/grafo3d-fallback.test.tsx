// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArestaGrafo, NoGrafo } from "../../../compartilhado/conhecimento";
import { definirWebgl2ParaTeste } from "../../componentes/grafo3d/suporte";
import { Grafo } from "./Grafo";

const no = (id: string): NoGrafo => ({ id, tipo: "arquivo", rotulo: id, peso: 1, x: null, y: null, ultimo_em: "", mission_id: null });
const props = (extra: Record<string, unknown> = {}) => ({ nos: [no("a"), no("b")], arestas: [{ origem: "a", destino: "b", tipo: "toca", peso: 1 } as ArestaGrafo], selecionadoId: null, semente: "s", truncado: false, aoSelecionar: vi.fn(), aoFocar: vi.fn(), aoPosicoes: vi.fn(), ...extra });

beforeEach(() => { HTMLCanvasElement.prototype.getContext = (() => null) as never; localStorage.clear(); });
afterEach(() => { cleanup(); definirWebgl2ParaTeste(null); });

describe("Grafo do Conhecimento: 3D com fallback automático", () => {
  it("sem WebGL2 usa o canvas 2D e não mostra o botão de 3D", () => {
    definirWebgl2ParaTeste(false);
    const { container } = render(<Grafo {...props()} />);
    expect(container.querySelector(".con-grafo canvas")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Modo 3D" })).toBeNull();
  });
  it("com 'reduzir movimento' usa o 2D mesmo com WebGL2", () => {
    definirWebgl2ParaTeste(true);
    const { container } = render(<Grafo {...props({ reduzirMovimento: true })} />);
    expect(container.querySelector(".con-grafo canvas")).not.toBeNull();
    expect(container.querySelector(".g3d")).toBeNull();
  });
  it("WebGL2 declarado mas contexto indisponível: carrega o 3D sob demanda e volta ao 2D sem quebrar", async () => {
    definirWebgl2ParaTeste(true);
    const { container } = render(<Grafo {...props({ reduzirMovimento: false })} />);
    await waitFor(() => expect(container.querySelector(".con-grafo canvas")).not.toBeNull());
    expect(localStorage.getItem("grafo3d.simples")).toBe("1");
    await act(async () => undefined);
    expect(screen.getByRole("button", { name: "Modo 3D" })).toBeTruthy();
  });
});
