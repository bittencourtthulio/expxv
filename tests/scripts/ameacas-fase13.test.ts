// Fase 13 (onda 1): o estudo de ameaças do Jarvis e do controle remoto é consistente com o plano, com os testes e com a mutação. Falha se uma ameaça Alta perder a task ou o teste que a prova,
// citar task inexistente, apontar teste/mutação que não existe, ou se os portões G1..G3, os residuais R1..R5 e as decisões D-320..D-325 deixarem de existir.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error módulo .mjs sem tipos (script de CLI)
import { MUTACOES } from "./mutacoes-fase13.mjs";

const RAIZ = resolve(__dirname, "..", "..");
const ler = (p: string): string => readFileSync(resolve(RAIZ, p), "utf8");
const DOC = ler("docs/ade/AMEACAS-REMOTO.md");
const PLANO = ler("docs/ade/fase-13-jarvis-controle-remoto.md");
const ADV = ler("src/nucleo/remoto/adversarial.test.ts");
const IDS_MUTACAO = new Set((MUTACOES as Array<{ id: string }>).map((m) => m.id));

interface Caso { ar: string; sev: string; tasks: string[]; teste: string; mutacoes: string[] }
const casos: Caso[] = DOC.split("\n").flatMap((linha) => {
  const m = /^\|\s*(AR-\d{2})\s*\|/.exec(linha);
  if (m === null) return [];
  const c = linha.split("|").map((x) => x.trim());
  return [{ ar: m[1] as string, sev: c[3] ?? "", tasks: [...(c[5] ?? "").matchAll(/T-13\.\d{2}/g)].map((x) => x[0]), teste: c[6] ?? "", mutacoes: [...(c[7] ?? "").matchAll(/AR-\d{2}[a-e]?/g)].map((x) => x[0]) }];
});
const tasksDoPlano = new Set([...PLANO.matchAll(/^### ?13\w|T-13\.\d{2}/gm)].map((m) => m[0]).filter((x) => x.startsWith("T-")));

describe("estudo de ameaças da Fase 13 (onda 1)", () => {
  it("tem os 28 casos AR-01..AR-28 (>= 20 exigidos)", () => {
    const ids = new Set(casos.map((c) => c.ar));
    for (let i = 1; i <= 28; i++) expect(ids.has(`AR-${String(i).padStart(2, "0")}`), `AR-${i}`).toBe(true);
    expect(casos.length).toBeGreaterThanOrEqual(28);
  });
  it("toda ameaça tem severidade válida, task existente no plano e teste nomeado", () => {
    for (const c of casos) {
      expect(["Alta", "Média", "Baixa"], c.ar).toContain(c.sev);
      expect(c.tasks.length, `${c.ar} sem task`).toBeGreaterThan(0);
      for (const t of c.tasks) expect(tasksDoPlano.has(t), `${c.ar} cita ${t}, que não existe no plano`).toBe(true);
      expect(/`ar\d{2}_[a-z0-9_]+`/.test(c.teste), `${c.ar} sem teste nomeado`).toBe(true);
    }
  });
  it("o teste de cada caso existe em adversarial.test.ts e o número bate com o caso", () => {
    for (const c of casos) {
      const nome = /`(ar\d{2}_[a-z0-9_]+)`/.exec(c.teste)?.[1] as string;
      expect(ADV.includes(`it("${nome}"`), `${c.ar}: o teste ${nome} não existe`).toBe(true);
      expect(nome.startsWith(`ar${c.ar.slice(3)}_`), `${c.ar}: teste de outro caso`).toBe(true);
    }
  });
  it("toda mutação citada existe na lista; toda ameaça Alta tem mutação ou justificativa estrutural", () => {
    for (const c of casos) for (const m of c.mutacoes) expect(IDS_MUTACAO.has(m) || [...IDS_MUTACAO].some((x) => x.startsWith(m)), `${c.ar} cita a mutação ${m}`).toBe(true);
    const semMutacao = casos.filter((c) => c.sev === "Alta" && c.mutacoes.length === 0).map((c) => c.ar);
    expect(semMutacao.sort()).toEqual(["AR-02", "AR-26"]); // estruturais: não há rota de texto que confirme; identidade só passa pela porta de segredos (teste de estado/auditoria)
  });
  it("toda mutação da lista é citada por algum caso (nada solto)", () => {
    const citadas = new Set(casos.flatMap((c) => c.mutacoes));
    const ranges = (id: string): boolean => [...citadas].some((c) => id === c || id.startsWith(c.replace(/[a-e]$/, "")));
    for (const id of IDS_MUTACAO) expect(ranges(id as string), `mutação ${id} não aparece em nenhum caso`).toBe(true);
  });
  it("registra portões G1..G3, residuais R1..R5 e o texto exato dos riscos que vão ao dono", () => {
    for (const g of ["G1", "G2", "G3"]) expect(DOC, g).toMatch(new RegExp(`\\*\\*${g} `));
    for (const r of ["R1", "R2", "R3", "R4", "R5"]) expect(DOC, r).toMatch(new RegExp(`\\*\\*${r}\\*\\*`));
    expect(DOC).toContain("não é um PAKE");
    expect(DOC).toContain("sem auditoria externa");
    expect(DOC).toContain("não implementado");
  });
  it("cobre as seis fronteiras F1..F6 e os atores obrigatórios", () => {
    for (const f of ["F1", "F2", "F3", "F4", "F5", "F6"]) expect(DOC, f).toContain(f);
    for (const a of ["Dono presente", "Celular roubado", "Qualquer host da LAN", "Atacante ativo na LAN", "Outro processo local", "Texto hostil"]) expect(DOC, a).toContain(a);
  });
  it("D-320..D-325 existem em 01-DECISOES.md", () => {
    const dec = ler("docs/ade/01-DECISOES.md");
    for (let i = 320; i <= 325; i++) expect(dec, `D-${i}`).toMatch(new RegExp(`\\*\\*D-${i} ·`));
  });
});
