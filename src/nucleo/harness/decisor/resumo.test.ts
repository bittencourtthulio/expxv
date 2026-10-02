import { describe, expect, it } from "vitest";
import { criarBreaker } from "./breaker";
import { lerResposta, montarCorpo } from "./formatos";
import { decidirPorRegras, normalizar } from "./regras";
import { hashResumo, resumirParaDecisor } from "./resumo";

// Segredos FALSOS montados em tempo de execução (o código-fonte não contém sequência com forma de credencial real).
const j = (...p: string[]): string => p.join("");
const SEGREDOS = [
  j("sk", "-or-v1-", "9f8e7d6c5b4a39281706f5e4d3c2b1a0"),
  j("sk", "-proj-", "AbCdEf1234567890GhIjKl"),
  j("gh", "p_", "1234567890abcdefghijABCDEFGHIJ123456"),
  j("ey", "JhbGciOiJIUzI1NiJ9.", "eyJzdWIiOiIxMjM0NTY3ODkwIn0.", "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"),
  j("AK", "IA", "IOSFODNN7EXAMPLE"),
  j("9f86d081884c7d659a2feaa0c55ad015", "a3bf4f1b2b0b822cd15d6c15b0f00a08"),
  j("xo", "xb-", "1234567890-abcdefghij"),
  j("AI", "za", "SyA-1234567890abcdefghijklmnopqrst"),
];
const MOLDES = [
  (s: string) => `corrija o login, a chave é ${s} e não funciona`,
  (s: string) => `Authorization: Bearer ${s}`,
  (s: string) => `API_KEY=${s}\nDEBUG=1\nquebrou o deploy`,
  (s: string) => `veja https://user:${s}@exemplo.com/repo e conserte`,
  (s: string) => `\`\`\`\nconst k = "${s}";\n\`\`\`\nbug acima`,
];

describe("resumirParaDecisor", () => {
  it("40 amostras com segredo plantado: nenhuma sai no resumo, todas ≤ 500 chars", () => {
    let n = 0;
    for (const s of SEGREDOS) {
      for (const molde of MOLDES) {
        const r = resumirParaDecisor(molde(s));
        expect(r, molde("<segredo>")).not.toContain(s);
        expect(r.length).toBeLessThanOrEqual(500);
        n++;
      }
    }
    expect(n).toBe(40);
  });

  it("remove caminhos absolutos, e-mails, URLs, valores de variáveis e blocos de código; mantém o sentido", () => {
    const r = resumirParaDecisor("o botão em /Users/maria/projetos/app/src/Botao.tsx quebrou, avise maria@empresa.com.br https://x.com/a?b=1\nSEGREDO_X=abc123def\n```js\nfoo()\n```\nfim");
    expect(r).not.toMatch(/\/Users|maria@|https:|abc123def|foo\(\)/);
    expect(r).toContain("[caminho]");
    expect(r).toContain("[email]");
    expect(r).toContain("[url]");
    expect(r).toContain("SEGREDO_X=[valor]");
    expect(r).toContain("botão");
    expect(resumirParaDecisor("caminho relativo src/main/x.ts fica")).toContain("src/main/x.ts");
    expect(resumirParaDecisor("C:\\Users\\ana\\proj\\a.ts falhou")).toContain("[caminho]");
  });

  it("valor do cofre conhecido passa pelo scrubber antes de tudo", () => {
    const r = resumirParaDecisor("minha senha curta é abc123 ok", { scrub: (t) => t.replace("abc123", "«cofre:X»") });
    expect(r).toContain("«cofre:X»");
    expect(r).not.toContain("abc123");
  });

  it("100 KB → ≤ 500 chars em ≤ 5 ms (melhor de 5)", () => {
    const grande = `${"linha de saída do terminal com texto qualquer e /var/log/app/erro.log ".repeat(1500)} ${SEGREDOS[0]}`;
    expect(grande.length).toBeGreaterThan(100_000);
    let melhor = Infinity;
    let saida = "";
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      saida = resumirParaDecisor(grande);
      melhor = Math.min(melhor, performance.now() - t0);
    }
    expect(saida.length).toBeLessThanOrEqual(500);
    expect(saida).not.toContain(SEGREDOS[0] as string);
    expect(melhor).toBeLessThanOrEqual(5 * Number(process.env.EXPXV_PERF_FATOR ?? 1));
  });

  it("hash estável (sha256 hex)", () => {
    expect(hashResumo("a")).toBe("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  });
});

describe("regras determinísticas (fallback)", () => {
  const opcoes = [
    { id: "bug", description: "defeito quebrado", palavras: ["erro"] },
    { id: "feature", description: "funcionalidade nova" },
  ];
  it("é determinística, escolhe entre as opções e sem sinal devolve a primeira com 1/n", () => {
    const a = decidirPorRegras("deu erro e está quebrado", opcoes);
    expect(a).toEqual(decidirPorRegras("deu erro e está quebrado", opcoes));
    expect(a.escolhida).toBe("bug");
    expect(a.com_sinal).toBe(true);
    expect(Object.values(a.probs).reduce((x, y) => x + y, 0)).toBeCloseTo(1, 6);
    const sem = decidirPorRegras("zzz", opcoes);
    expect(sem).toMatchObject({ escolhida: "bug", confianca: 0.5, com_sinal: false });
  });
  it("normaliza acentos e caixa", () => {
    expect(normalizar("  Não FUNCIONA!! ação ")).toBe("nao funciona acao");
  });
});

describe("formatos e breaker", () => {
  const ids = ["a", "b"];
  it("probs_json: valida ids ⊂ opções, faixa [0,1] e soma [0,99; 1,01]", () => {
    const ok = lerResposta("probs_json", JSON.stringify({ probs: { a: 0.7, b: 0.3 }, model: "m", usage: { cost: 0.01 } }), ids);
    expect(ok).toMatchObject({ ok: true, modelo: "m", uso: { cost: 0.01 } });
    expect(lerResposta("probs_json", JSON.stringify({ probs: { a: 1 } }), ids)).toMatchObject({ ok: true, probs: { a: 1, b: 0 } });
    for (const ruim of [{ probs: { a: 0.9, b: 0.9 } }, { probs: { a: 0.5, c: 0.5 } }, { probs: { a: -0.2, b: 1.2 } }, { probs: [0.5, 0.5] }, { probs: { a: "0.5", b: 0.5 } }, {}, []]) {
      expect(lerResposta("probs_json", JSON.stringify(ruim), ids)).toEqual({ ok: false, motivo: "resposta_invalida" });
    }
    expect(lerResposta("probs_json", "<html>", ids)).toEqual({ ok: false, motivo: "json_invalido" });
  });
  it("openai_chat: lê o JSON de choices[0].message.content (com ou sem cerca de código)", () => {
    const corpo = (c: string) => JSON.stringify({ choices: [{ message: { content: c } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
    expect(lerResposta("openai_chat", corpo('{"probs":{"a":0.5,"b":0.5}}'), ids)).toMatchObject({ ok: true, uso: { prompt_tokens: 5, completion_tokens: 2, cost: null } });
    expect(lerResposta("openai_chat", corpo('```json\n{"probs":{"a":0.5,"b":0.5}}\n```'), ids).ok).toBe(true);
    expect(lerResposta("openai_chat", corpo("não sei"), ids)).toEqual({ ok: false, motivo: "json_invalido" });
    expect(lerResposta("openai_chat", JSON.stringify({ choices: [] }), ids)).toEqual({ ok: false, motivo: "resposta_invalida" });
    expect(JSON.parse(montarCorpo("openai_chat", { kind: "k", question: "q", options: [{ id: "a", description: "x" }], modelo: "v/m" })).model).toBe("v/m");
  });
  it("breaker: abre por 5 min, meio-aberto depois; inválida só abre na repetição", () => {
    let t = 0;
    const b = criarBreaker({ agora: () => t });
    expect(b.permitir()).toBe(true);
    b.falha("json_invalido");
    expect(b.permitir()).toBe(true);
    b.falha("json_invalido");
    expect(b.permitir()).toBe(false);
    t = 5 * 60_000;
    expect(b.permitir()).toBe(true);
    b.falha("resposta_invalida"); // meio-aberto: uma falha reabre
    expect(b.permitir()).toBe(false);
    t += 5 * 60_000;
    b.sucesso();
    expect(b.estado()).toEqual({ aberto: false, ate: null, motivo: null });
    b.falha("http_402");
    expect(b.estado()).toMatchObject({ aberto: true, motivo: "http_402" });
  });
});
