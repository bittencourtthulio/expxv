import { describe, expect, it } from "vitest";
import { CONTEXTOS, defDoContexto, formatarDataDoContexto, linhasDoContexto, ORDEM_DA_SEQUENCIA, resumoDoContexto, sequenciaDoQueFalta, situacaoDoContexto, type EntradaContexto } from "./contexto";
import { comandoDeContexto, comandoSugerido } from "./comandos";
import { moduloDoGesto, moduloDoComando } from "../suite/modulos";

const NADA = { convencoes: false, design_system: false, produto: false, memoria: false, perfil_legado: false };
const LIGADOS = { stackx: true, designx: true, prodx: true, memox: true, legadox: false };
const e = (p: Partial<EntradaContexto> = {}): EntradaContexto => ({ camadas: NADA, modulos: LIGADOS, suiteInstalada: true, ...p });

describe("situação de cada camada de contexto (tabela)", () => {
  const stack = defDoContexto("convencoes");
  const legado = defDoContexto("perfil_legado");
  const casos: Array<[string, ReturnType<typeof defDoContexto>, EntradaContexto, string]> = [
    ["arquivo existe", stack, e({ camadas: { ...NADA, convencoes: true } }), "gerado"],
    ["existe mesmo com o módulo desligado", legado, e({ camadas: { ...NADA, perfil_legado: true } }), "gerado"],
    ["existe mesmo sem a suíte", stack, e({ camadas: { ...NADA, convencoes: true }, suiteInstalada: false }), "gerado"],
    ["falta e módulo ligado", stack, e(), "ausente"],
    ["falta e módulo desligado", legado, e(), "desligado"],
    ["suíte ausente vence desligado", legado, e({ suiteInstalada: false }), "indisponivel"],
    ["suíte ausente", stack, e({ suiteInstalada: false }), "indisponivel"],
    ["skill do módulo faltando no lock", stack, e({ skillsFaltando: ["stackx"] }), "indisponivel"],
    ["módulo desconhecido na lista", stack, e({ modulos: { prodx: true } }), "indisponivel"],
    ["módulos ainda não lidos não bloqueiam", legado, e({ modulos: null, suiteInstalada: null }), "ausente"],
  ];
  it.each(casos)("%s", (_n, def, entrada, esperado) => {
    expect(situacaoDoContexto(def, entrada)).toBe(esperado);
  });
});

describe("linhas, data e resumo", () => {
  it("só o gerado leva data; comando exato na forma do Claude Code", () => {
    const l = linhasDoContexto(e({ camadas: { ...NADA, produto: true }, mtime: { produto: "2026-03-04T10:00:00.000Z", convencoes: "2026-01-01T00:00:00.000Z" } }));
    expect(l.map((x) => x.def.id)).toEqual(CONTEXTOS.map((c) => c.id));
    expect(l.find((x) => x.def.id === "produto")?.data).toBe("2026-03-04T10:00:00.000Z");
    expect(l.find((x) => x.def.id === "convencoes")?.data).toBeNull();
    expect(l.find((x) => x.def.id === "convencoes")?.comando).toBe("/expx:stackx-detectar");
    expect(l.find((x) => x.def.id === "perfil_legado")?.texto).toBe("Desligado — módulo legadox desligado");
  });
  it("resumo: zero amigável, parcial, tudo e nada disponível; desligado fica fora da conta", () => {
    expect(resumoDoContexto(linhasDoContexto(e()))).toBe("Contexto do projeto: nada gerado ainda (0 de 4)");
    expect(resumoDoContexto(linhasDoContexto(e({ camadas: { ...NADA, convencoes: true, memoria: true } })))).toBe("Contexto do projeto: 2 de 4 gerados");
    expect(resumoDoContexto(linhasDoContexto(e({ camadas: { convencoes: true, design_system: true, produto: true, memoria: true, perfil_legado: false } })))).toBe("Contexto do projeto: todos os 4 gerados");
    expect(resumoDoContexto(linhasDoContexto(e({ suiteInstalada: false })))).toBe("Contexto do projeto: nada disponível para gerar agora");
    expect(resumoDoContexto(linhasDoContexto(e({ modulos: { ...LIGADOS, legadox: true } })))).toBe("Contexto do projeto: nada gerado ainda (0 de 5)");
  });
  it("formata a data em pt-BR e recusa lixo", () => {
    expect(formatarDataDoContexto("2026-03-04T12:00:00.000Z")).toMatch(/^0[34]\/03\/2026$/);
    expect(formatarDataDoContexto("lixo")).toBeNull();
    expect(formatarDataDoContexto(undefined)).toBeNull();
  });
});

describe("sequência 'Gerar o que falta'", () => {
  it("ordem fixa: convenções, produto, memória, design system; legado só se ligado", () => {
    expect(ORDEM_DA_SEQUENCIA).toEqual(["convencoes", "produto", "memoria", "design_system", "perfil_legado"]);
    expect(sequenciaDoQueFalta(linhasDoContexto(e()))).toEqual(["convencoes", "produto", "memoria", "design_system"]);
    expect(sequenciaDoQueFalta(linhasDoContexto(e({ modulos: { ...LIGADOS, legadox: true } })))).toEqual(["convencoes", "produto", "memoria", "design_system", "perfil_legado"]);
  });
  it("pula o gerado, o desligado e o indisponível", () => {
    expect(sequenciaDoQueFalta(linhasDoContexto(e({ camadas: { ...NADA, convencoes: true, memoria: true }, modulos: { ...LIGADOS, designx: false } })))).toEqual(["produto"]);
    expect(sequenciaDoQueFalta(linhasDoContexto(e({ suiteInstalada: false })))).toEqual([]);
  });
});

describe("comando de contexto (sem argumento) e módulo do gesto", () => {
  it("monta o comando por CLI e mapeia gesto → módulo (para o bloqueio de módulo desligado)", () => {
    expect(comandoDeContexto("gerar_memoria", "claude").comando).toBe("/expx:memox-indexar");
    expect(comandoDeContexto("gerar_design_system", "opencode").comando).toBe("/designx-cartography");
    expect(comandoDeContexto("gerar_perfil_legado", "codex").comando).toBe("");
    expect(comandoDeContexto("retomar", "claude").motivo_bloqueio).toMatch(/desconhecido/i);
    expect(comandoSugerido("gerar_convencoes", null, "claude").comando).toBe("/expx:stackx-detectar");
    for (const c of CONTEXTOS) {
      expect(moduloDoGesto(c.gesto, null)).toBe(c.modulo);
      expect(moduloDoComando(comandoDeContexto(c.gesto, "claude").comando)).toBe(c.modulo);
    }
  });
});
