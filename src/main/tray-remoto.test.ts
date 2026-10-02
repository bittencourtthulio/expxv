import { describe, expect, it } from "vitest";
import { montarItensTray } from "./tray";

describe("bandeja: kill-switch do controle remoto (Fase 13)", () => {
  const base = { abrir: () => undefined, sair: () => undefined, notificacoes: { ativo: () => true, definir: async () => undefined } };
  it("só aparece com o servidor ligado e aciona o desligamento", () => {
    let n = 0;
    const sem = montarItensTray({ ...base, remotoDesligar: { visivel: () => false, acionar: () => void n++ } });
    expect(sem.some((i) => /controle remoto/i.test(i.label ?? ""))).toBe(false);
    const com = montarItensTray({ ...base, remotoDesligar: { visivel: () => true, acionar: () => void n++ } });
    const item = com.find((i) => i.label === "Desligar controle remoto");
    expect(item).toBeDefined();
    item?.click?.();
    expect(n).toBe(1);
  });
});
