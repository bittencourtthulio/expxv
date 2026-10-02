// T-20.01 / T-20.40: o estudo de ameaças da Fase 20 é consistente com o plano e com os testes. Falha se uma ameaça Alta perder a task ou o teste que a prova, citar task inexistente,
// ou se os casos AB-01..AB-30, os portões G1..G4 e os residuais R1..R3 deixarem de existir.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "..", "..");
const ler = (p: string): string => readFileSync(resolve(RAIZ, p), "utf8");
const DOC = ler("docs/ade/AMEACAS-TELEGRAM.md");
const PLANO = ler("docs/ade/fase-20-alertas-comunicacao.md");
const ADVERSARIAL = ler("src/nucleo/telegram/adversarial.test.ts");

interface Caso {
  ab: string;
  sev: string;
  tasks: string[];
  teste: string;
}
function casos(): Caso[] {
  const saida: Caso[] = [];
  for (const linha of DOC.split("\n")) {
    const m = /^\|\s*(AB-\d{2})\s*\|/.exec(linha);
    if (m === null) continue;
    const c = linha.split("|").map((x) => x.trim());
    // [ "", AB, caso, sev, mitigação, task, teste, (prova) , "" ]  (a 1ª tabela tem uma coluna a mais no fim)
    saída: {
      saida.push({ ab: m[1] as string, sev: c[3] ?? "", tasks: [...(c[5] ?? "").matchAll(/T-20\.\d{2}/g)].map((x) => x[0]), teste: c[6] ?? "" });
    }
  }
  return saida;
}
const tasksDoPlano = new Set([...PLANO.matchAll(/^- \*\*(T-20\.\d{2})/gm)].map((m) => m[1] as string));

describe("estudo de ameaças da Fase 20 (T-20.01)", () => {
  const todos = casos();
  it("tem os 30 casos AB-01..AB-30 do plano (>= 24 exigidos) mais os da onda 2", () => {
    const ids = new Set(todos.map((c) => c.ab));
    for (let i = 1; i <= 30; i++) expect(ids.has(`AB-${String(i).padStart(2, "0")}`), `AB-${i}`).toBe(true);
    expect(todos.length).toBeGreaterThanOrEqual(34);
  });
  it("toda ameaça tem severidade válida, task existente e teste", () => {
    for (const c of todos) {
      expect(["Alta", "Média", "Baixa"], c.ab).toContain(c.sev);
      expect(c.tasks.length, `${c.ab} sem task`).toBeGreaterThan(0);
      for (const t of c.tasks) expect(tasksDoPlano.has(t), `${c.ab} cita ${t}, que não existe no plano`).toBe(true);
      expect(c.teste.length, `${c.ab} sem teste`).toBeGreaterThan(0);
    }
  });
  it("toda ameaça ALTA aponta para um teste que existe (nome em adversarial.test.ts ou arquivo de teste)", () => {
    for (const c of todos.filter((x) => x.sev === "Alta")) {
      const nomes = [...c.teste.matchAll(/`?(ab\d{2}_[a-z0-9_]+)`?/g)].map((m) => m[1] as string);
      const arquivos = [...c.teste.matchAll(/[\w./-]+\.test\.ts/g)].map((m) => m[0]);
      expect(nomes.length + arquivos.length, `${c.ab}: teste não identificável`).toBeGreaterThan(0);
      for (const n of nomes) expect(ADVERSARIAL.includes(`"${n}"`), `${c.ab}: o teste ${n} não existe`).toBe(true);
      for (const a of arquivos) {
        const candidatos = [a, `src/main/${a}`, `src/main/ipc/${a}`, `src/nucleo/mcp/${a}`];
        expect(candidatos.some((p) => existsSync(resolve(RAIZ, p))), `${c.ab}: arquivo ${a} não existe`).toBe(true);
      }
    }
  });
  it("o nome do teste de cada AB-01..AB-30 bate com o número do caso", () => {
    for (const c of todos.filter((x) => Number(x.ab.slice(3)) <= 30)) {
      const n = c.ab.slice(3);
      expect(c.teste.includes(`ab${n}_`), `${c.ab}: teste de outro caso`).toBe(true);
    }
  });
  it("registra os portões G1..G4 e os residuais R1..R3 com o texto exato", () => {
    for (const g of ["G1", "G2", "G3", "G4"]) expect(DOC, g).toMatch(new RegExp(`\\*\\*${g} `));
    for (const r of ["R1", "R2", "R3"]) expect(DOC, r).toMatch(new RegExp(`\\*\\*${r}\\*\\*`));
    expect(DOC).toContain("não ponta a ponta");
    expect(DOC).toContain("troca de chip");
    expect(DOC).toContain("até a rotação do token");
  });
  it("cobre as seis fronteiras de confiança F1..F6 e os atores obrigatórios", () => {
    for (const f of ["F1", "F2", "F3", "F4", "F5", "F6"]) expect(DOC, f).toContain(f);
    for (const a of ["Dono presente", "Dono ausente", "sequestrada", "Desconhecido", "Outro processo local", "roubou o token", "Telegram (empresa)", "Rede hostil"]) expect(DOC, a).toContain(a);
  });
  it("confirma D-150..D-159 e eles existem em 01-DECISOES.md", () => {
    const dec = ler("docs/ade/01-DECISOES.md");
    for (let i = 150; i <= 159; i++) {
      expect(DOC, `D-${i}`).toContain(`D-${i}`);
      expect(dec, `D-${i} em 01-DECISOES.md`).toContain(`**D-${i} `);
    }
  });
});
