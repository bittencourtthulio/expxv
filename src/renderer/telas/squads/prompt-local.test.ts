import { describe, expect, it } from "vitest";
import { analisarPromptLocal, bytesDe, inserirNoCursor, trechosDaPrevia } from "./prompt-local";

describe("analisarPromptLocal", () => {
  it("texto válido com variáveis do conjunto fechado não tem achado", () => {
    expect(analisarPromptLocal("# {{rotulo}}\nObjetivo: {{ objetivo }} {{contexto_rag}}")).toEqual([]);
  });
  it("variável desconhecida (uma vez só), vazio e acima de 16 KiB são erros", () => {
    const a = analisarPromptLocal("{{foo}} e {{foo}} e {{bar}}");
    expect(a.map((x) => x.codigo)).toEqual(["variavel_desconhecida", "variavel_desconhecida"]);
    expect(analisarPromptLocal("   ")[0]!.codigo).toBe("membro_sem_prompt");
    expect(analisarPromptLocal("a".repeat(16 * 1024 + 1))[0]!.codigo).toBe("prompt_grande");
    expect(analisarPromptLocal("é".repeat(9000))[0]!.codigo).toBe("prompt_grande"); // 18 000 bytes
  });
  it("conta bytes, não caracteres", () => {
    expect(bytesDe("é")).toBe(2);
  });
});

describe("trechosDaPrevia", () => {
  it("marca os blocos <dado> e preserva o resto", () => {
    const t = trechosDaPrevia('Antes <dado tipo="objetivo" aviso="x">\nfazer\n</dado> depois');
    expect(t.map((x) => x.dado)).toEqual([false, true, false]);
    expect(t.map((x) => x.texto).join("")).toBe('Antes <dado tipo="objetivo" aviso="x">\nfazer\n</dado> depois');
  });
  it("sem bloco: um trecho comum", () => {
    expect(trechosDaPrevia("só texto")).toEqual([{ dado: false, texto: "só texto" }]);
  });
});

describe("inserirNoCursor", () => {
  it("insere na posição e substitui a seleção", () => {
    expect(inserirNoCursor("ab", 1, 1, "{{x}}")).toEqual({ texto: "a{{x}}b", cursor: 6 });
    expect(inserirNoCursor("abcd", 1, 3, "-")).toEqual({ texto: "a-d", cursor: 2 });
    expect(inserirNoCursor("ab", 99, 99, "z").texto).toBe("abz");
  });
});
