import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TEMA_XTERM_CLARO, TEMA_XTERM_ESCURO } from "../componentes/Terminal/tema-xterm";
import { lerHex, misturar, razao, type RGB } from "./contraste";

// T-05.05: contraste AA (≥ 4,5 texto normal; ≥ 3 ícones/indicadores) nos DOIS temas, medido sobre o tokens.css real.
const css = readFileSync(join(__dirname, "..", "tokens.css"), "utf8");

function tokensDe(tema: "escuro" | "claro"): Record<string, string> {
  const ini = css.indexOf(`:root[data-theme="${tema}"]`);
  const bloco = css.slice(css.indexOf("{", ini) + 1, css.indexOf("}", ini));
  return Object.fromEntries([...bloco.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));
}

const TEMAS = ["escuro", "claro"] as const;
const cor = (t: Record<string, string>, nome: string): RGB => lerHex(t[`--${nome}`] ?? "");
const SUPERFICIES = ["fundo", "painel", "superficie", "superficie-2"] as const;

describe.each(TEMAS)("contraste AA, tema %s", (tema) => {
  const t = tokensDe(tema);

  it("texto, texto-suave, texto-discreto e destaque-texto ≥ 4,5 sobre fundo, painel, superfície e superfície-2", () => {
    const falhas: string[] = [];
    for (const fg of ["texto", "texto-suave", "texto-discreto", "destaque-texto"]) {
      for (const bg of SUPERFICIES) {
        const r = razao(cor(t, fg), cor(t, bg));
        if (r < 4.5) falhas.push(`${fg} sobre ${bg}: ${r.toFixed(2)}`);
      }
    }
    expect(falhas).toEqual([]);
  });

  it("alerta, aviso e sucesso ≥ 4,5 sobre fundo, painel e superfície (e sobre as tintas de 12–16 %)", () => {
    const falhas: string[] = [];
    for (const fg of ["alerta", "aviso", "sucesso"]) {
      for (const bg of ["fundo", "painel", "superficie"]) {
        const r = razao(cor(t, fg), cor(t, bg));
        if (r < 4.5) falhas.push(`${fg} sobre ${bg}: ${r.toFixed(2)}`);
      }
    }
    // .terminais-aguardando (aviso 16 %) e .terminais-erro (alerta 12 %) sobre painel
    const tintaAviso = misturar(cor(t, "aviso"), 0.16, cor(t, "painel"));
    const tintaAlerta = misturar(cor(t, "alerta"), 0.12, cor(t, "painel"));
    const tintaReinicio = misturar(cor(t, "aviso"), 0.14, cor(t, "painel"));
    if (razao(cor(t, "aviso"), tintaAviso) < 4.5) falhas.push(`aviso sobre tinta 16 %: ${razao(cor(t, "aviso"), tintaAviso).toFixed(2)}`);
    if (razao(cor(t, "aviso"), tintaReinicio) < 4.5) falhas.push(`aviso sobre tinta 14 %: ${razao(cor(t, "aviso"), tintaReinicio).toFixed(2)}`);
    if (razao(cor(t, "alerta"), tintaAlerta) < 4.5) falhas.push(`alerta sobre tinta 12 %: ${razao(cor(t, "alerta"), tintaAlerta).toFixed(2)}`);
    expect(falhas).toEqual([]);
  });

  it("texto sobre o destaque (botão primário, selo, estado normal e hover) ≥ 4,5; glifo do selo 'aguardando' ≥ 4,5", () => {
    const destaque = cor(t, "destaque");
    const hover = misturar({ r: 0, g: 0, b: 0 }, 0.12, destaque); // color-mix(destaque 88 %, preto)
    expect(razao(cor(t, "sobre-destaque"), destaque)).toBeGreaterThanOrEqual(4.5);
    expect(razao(cor(t, "sobre-destaque"), hover)).toBeGreaterThanOrEqual(4.5);
    expect(razao(cor(t, "fundo"), cor(t, "aviso"))).toBeGreaterThanOrEqual(4.5);
  });

  it("indicadores não textuais ≥ 3: anel de foco (destaque), ícones (destaque-texto) e borda de campo", () => {
    const falhas: string[] = [];
    for (const bg of ["fundo", "painel", "superficie"]) {
      const r = razao(cor(t, "destaque"), cor(t, bg));
      if (r < 3) falhas.push(`foco/destaque sobre ${bg}: ${r.toFixed(2)}`);
    }
    for (const bg of ["fundo", "painel", "superficie", "superficie-2"]) {
      const r = razao(cor(t, "destaque-texto"), cor(t, bg));
      if (r < 3) falhas.push(`ícone destaque-texto sobre ${bg}: ${r.toFixed(2)}`);
    }
    for (const bg of ["fundo", "painel"]) {
      const r = razao(cor(t, "borda-campo"), cor(t, bg));
      if (r < 3) falhas.push(`borda-campo sobre ${bg}: ${r.toFixed(2)}`);
    }
    expect(falhas).toEqual([]);
  });
});

describe.each([["escuro", TEMA_XTERM_ESCURO], ["claro", TEMA_XTERM_CLARO]] as const)("xterm, tema %s", (tema, x) => {
  const t = tokensDe(tema);
  const fundo = lerHex(x.background ?? "");

  it("o fundo do xterm é o --painel do tema do app", () => {
    expect(x.background?.toLowerCase()).toBe(t["--painel"]);
  });

  it("texto padrão ≥ 4,5; cursor ≥ 3 sobre o fundo; letra sob o cursor de bloco ≥ 4,5", () => {
    expect(razao(lerHex(x.foreground ?? ""), fundo)).toBeGreaterThanOrEqual(4.5);
    expect(razao(lerHex(x.cursor ?? ""), fundo)).toBeGreaterThanOrEqual(3);
    expect(razao(lerHex(x.cursorAccent ?? ""), lerHex(x.cursor ?? ""))).toBeGreaterThanOrEqual(4.5);
  });

  it("texto selecionado ≥ 4,5 sobre a seleção", () => {
    expect(razao(lerHex(x.selectionForeground ?? ""), lerHex(x.selectionBackground ?? ""))).toBeGreaterThanOrEqual(4.5);
  });

  it("cores ANSI usadas como texto ≥ 4,5 sobre o fundo (exceto a que se confunde com o próprio fundo)", () => {
    const fora = tema === "escuro" ? ["black"] : ["white", "brightWhite"];
    const falhas: string[] = [];
    for (const [nome, v] of Object.entries(x)) {
      if (!/^(bright)?(black|red|green|yellow|blue|magenta|cyan|white)$/i.test(nome) || fora.includes(nome) || typeof v !== "string") continue;
      const r = razao(lerHex(v), fundo);
      if (r < 4.5) falhas.push(`${nome} ${v}: ${r.toFixed(2)}`);
    }
    expect(falhas).toEqual([]);
  });
});
