// T-22.20: o guia de hospedagem só cita arquivos, serviços e variáveis que existem em deploy/relay, não tem valor de segredo e marca os custos como estimativa.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "..", "..");
const DEPLOY = resolve(RAIZ, "deploy/relay");
const guia = readFileSync(resolve(DEPLOY, "LEIA-ME.md"), "utf8");
const compose = readFileSync(resolve(DEPLOY, "compose.yaml"), "utf8");
const blocos = [...guia.matchAll(/```\n([\s\S]*?)```/g)].map((m) => (m[1] as string).trim());
const comandos = [...blocos, ...[...guia.matchAll(/`((?:docker|node) [^`]+)`/g)].map((m) => m[1] as string)];

describe("guia de hospedagem do relay", () => {
  it("todo caminho `deploy/relay/...` citado existe", () => {
    const caminhos = [...guia.matchAll(/deploy\/relay\/([\w.\-]+)/g)].map((m) => m[1] as string);
    expect(caminhos.length).toBeGreaterThan(0);
    for (const c of caminhos) expect(existsSync(resolve(DEPLOY, c)), c).toBe(true);
  });
  it("todo comando referencia arquivo, serviço e perfil que existem", () => {
    expect(comandos.length).toBeGreaterThanOrEqual(3);
    for (const c of comandos) {
      if (/docker compose/.test(c)) {
        const arq = /-f (\S+)/.exec(c)?.[1];
        expect(arq !== undefined && existsSync(resolve(RAIZ, arq)), c).toBe(true);
        const perfil = /--profile (\S+)/.exec(c)?.[1];
        if (perfil !== undefined) expect(compose).toMatch(new RegExp(`profiles:\\n\\s+- ${perfil}\\b`));
        const servico = /\blogs (\w+)/.exec(c)?.[1];
        if (servico !== undefined) expect(compose).toMatch(new RegExp(`^  ${servico}:`, "m"));
        expect(c).not.toMatch(/\b(push|-H|--host)\b/);
      }
      if (/^node /.test(c)) expect(existsSync(resolve(RAIZ, c.split(" ")[1] as string)), c).toBe(true);
    }
  });
  it("toda variável RELAY_* citada existe no ambiente de exemplo", () => {
    const ex = readFileSync(resolve(DEPLOY, ".env.example"), "utf8");
    for (const v of new Set(guia.match(/\bRELAY_[A-Z_]+\b/g) ?? [])) expect(ex, v).toContain(`${v}=`);
  });
  it("não traz valor de segredo, nem chave PEM, nem token", () => {
    expect(guia).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY|sha256:[0-9a-f]{20,}[1-9a-f]|[A-Za-z0-9+/]{40,}={0,2}\b(?<![/.])/);
    expect(guia).not.toMatch(/(token|senha|secret|password)\s*[=:]\s*\S{6,}/i);
  });
  it("custos aparecem como estimativa e o guia diz que o repositório não implanta nada", () => {
    expect(guia).toContain("estimativa — confirme com seu provedor");
    expect(guia).toMatch(/não implanta nada/);
    for (const t of ["O que o relay vê", "Se o relay for comprometido", "Alternativas gratuitas", "Backup"]) expect(guia.toLowerCase()).toContain(t.toLowerCase());
  });
});
