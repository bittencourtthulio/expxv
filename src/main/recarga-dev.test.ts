import { describe, expect, it, vi } from "vitest";
import { ligarRecargaDev, mudancaRelevanteRenderer } from "./recarga-dev";

function montar() {
  let cb: (e: string, a: string | null) => void = () => undefined;
  const fechar = vi.fn();
  const tarefas: Array<{ fn: () => void; ativa: boolean }> = [];
  const recarregar = vi.fn();
  const parar = ligarRecargaDev({
    pasta: "/x/dist/renderer",
    recarregar,
    watch: (_p, _o, c) => {
      cb = c;
      return { close: fechar };
    },
    agendar: (fn) => {
      tarefas.push({ fn, ativa: true });
      return tarefas.length - 1;
    },
    cancelar: (id) => {
      const t = tarefas[id as number];
      if (t) t.ativa = false;
    },
  });
  const correr = (): void => tarefas.filter((t) => t.ativa).forEach((t) => ((t.ativa = false), t.fn()));
  return { emitir: (a: string | null) => cb("change", a), correr, recarregar, fechar, parar };
}

describe("recarga automática em modo dev", () => {
  it("rajada de mudanças vira uma recarga só", () => {
    const m = montar();
    for (let i = 0; i < 20; i++) m.emitir(`assets/a${i}.js`);
    m.correr();
    expect(m.recarregar).toHaveBeenCalledTimes(1);
  });

  it("ignora mapas de depuração e temporários; mudança sem nome recarrega", () => {
    expect(mudancaRelevanteRenderer("assets/a.js.map")).toBe(false);
    expect(mudancaRelevanteRenderer("x.tmp")).toBe(false);
    expect(mudancaRelevanteRenderer("index.html")).toBe(true);
    expect(mudancaRelevanteRenderer(null)).toBe(true);
    const m = montar();
    m.emitir("a.js.map");
    m.correr();
    expect(m.recarregar).not.toHaveBeenCalled();
  });

  it("parar cancela a recarga pendente e fecha o observador", () => {
    const m = montar();
    m.emitir("index.html");
    m.parar();
    m.correr();
    expect(m.recarregar).not.toHaveBeenCalled();
    expect(m.fechar).toHaveBeenCalledTimes(1);
  });
});
