// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { Suspense, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { definirCarregadorDoTerminal, precarregarTerminal, type ModuloTerminal } from "./carga";
import { TerminalSobDemanda } from "./TerminalSobDemanda";
import type { PropsTerminal } from "./Terminal";

afterEach(() => definirCarregadorDoTerminal());
const Falso = (): ReactElement => <pre>xterm-falso</pre>;
const props = { sessaoId: "s1", ativo: true, tema: "escuro", webgl: false, api: {} } as unknown as PropsTerminal;

describe("TerminalSobDemanda (P-03)", () => {
  it("com o chunk já carregado monta na hora, sem mostrar o fallback do Suspense", async () => {
    definirCarregadorDoTerminal(() => Promise.resolve({ Terminal: Falso } as unknown as ModuloTerminal));
    await precarregarTerminal();
    render(<Suspense fallback={<p>carregando</p>}><TerminalSobDemanda {...props} /></Suspense>);
    expect(screen.queryByText("carregando")).toBeNull();
    expect(screen.getByText("xterm-falso")).toBeTruthy();
  });
  it("sem o chunk mostra o fallback e depois o terminal", async () => {
    definirCarregadorDoTerminal(() => Promise.resolve({ Terminal: Falso } as unknown as ModuloTerminal));
    render(<Suspense fallback={<p>carregando</p>}><TerminalSobDemanda {...props} /></Suspense>);
    expect(screen.getByText("carregando")).toBeTruthy();
    expect(await screen.findByText("xterm-falso")).toBeTruthy();
  });
});
