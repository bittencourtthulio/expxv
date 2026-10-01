// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("mostra o texto e expõe o tom", () => {
    render(<Badge tom="alerta">Falhou</Badge>);
    expect(screen.getByText("Falhou").getAttribute("data-tom")).toBe("alerta");
  });
  it("o tom padrão é neutro", () => {
    render(<Badge>x</Badge>);
    expect(screen.getByText("x").getAttribute("data-tom")).toBe("neutro");
  });
});
