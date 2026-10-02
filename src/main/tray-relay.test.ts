import { describe, expect, it } from "vitest";
import { montarItensTray } from "./tray";

describe("bandeja: pânico do relay (Fase 22)", () => {
  const base = { abrir: () => undefined, sair: () => undefined, notificacoes: { ativo: () => true, definir: async () => undefined } };
  it("só aparece com o relay ligado e aciona o pânico", () => {
    let n = 0;
    const sem = montarItensTray({ ...base, relayPanico: { visivel: () => false, acionar: () => void n++ } });
    expect(sem.some((i) => /relay/i.test(i.label ?? ""))).toBe(false);
    const com = montarItensTray({ ...base, relayPanico: { visivel: () => true, acionar: () => void n++ } });
    const item = com.find((i) => i.label === "Pânico do relay (fechar tudo)");
    expect(item).toBeDefined();
    item?.click?.();
    expect(n).toBe(1);
    expect(montarItensTray(base).some((i) => /relay/i.test(i.label ?? ""))).toBe(false);
  });
});
