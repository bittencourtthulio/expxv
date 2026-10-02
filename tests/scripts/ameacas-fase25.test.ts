// T-25.01 (AP-16): o estudo de ameaças da Fase 25 é consistente com o plano e com os testes. Falha se uma ameaça Alta perder a task ou o teste que a
// prova, citar task inexistente, ou se os casos AP-01..AP-18, as fronteiras F1..F4, os portões G1..G5 e os residuais R1..R6 deixarem de existir.
// Enquanto AP-16 estiver `planejado:portao`, o portão T-25.02 ainda não fechou; quando vira `pronto`, o §3 de base/L-laya-local.md tem de registrar
// o veredito GO com medições — remover esse registro faz este teste falhar.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "..", "..");
const ler = (p: string): string => readFileSync(resolve(RAIZ, p), "utf8");
const DOC = ler("docs/ade/seguranca/AMEACAS-FASE-25.md");
const PLANO = ler("docs/ade/fase-25-laya-local.md");

function testes(dir: string, acc: Array<{ arquivo: string; texto: string }> = []): Array<{ arquivo: string; texto: string }> {
  if (!existsSync(dir)) return acc;
  for (const n of readdirSync(dir)) {
    const c = join(dir, n);
    if (n === "node_modules") continue;
    if (statSync(c).isDirectory()) testes(c, acc);
    else if (/\.test\.tsx?$/.test(n)) acc.push({ arquivo: n, texto: readFileSync(c, "utf8") });
  }
  return acc;
}
const TESTES = [
  ...testes(join(RAIZ, "src/nucleo/laya")),
  ...testes(join(RAIZ, "tests/scripts")),
  ...testes(join(RAIZ, "src/main")),
  ...testes(join(RAIZ, "src/renderer")),
];

interface Caso {
  ap: string;
  sev: string;
  tasks: string[];
  teste: string;
  estado: string;
}
function casos(): Caso[] {
  const saida: Caso[] = [];
  for (const linha of DOC.split("\n")) {
    const m = /^\|\s*(AP-\d{2})\s*\|/.exec(linha);
    if (m === null) continue;
    const c = linha.split("|").map((x) => x.trim());
    // ["", AP, caso, sev, mitigação, task, teste, estado, ""]
    saida.push({ ap: m[1] as string, sev: c[3] ?? "", tasks: [...(c[5] ?? "").matchAll(/T-25\.\d{2}/g)].map((x) => x[0]), teste: c[6] ?? "", estado: c[7] ?? "" });
  }
  return saida;
}
const tasksDoPlano = new Set([...PLANO.matchAll(/^####\s+(T-25\.\d{2})/gm)].map((m) => m[1] as string));

describe("estudo de ameaças da Fase 25 (T-25.01)", () => {
  const todos = casos();

  it("tem os casos AP-01..AP-18 do plano (>= 18 exigidos)", () => {
    const ids = new Set(todos.map((c) => c.ap));
    for (let i = 1; i <= 18; i++) expect(ids.has(`AP-${String(i).padStart(2, "0")}`), `AP-${i}`).toBe(true);
    expect(todos.length).toBeGreaterThanOrEqual(18);
  });

  it("toda ameaça tem severidade válida, task EXISTENTE no plano, teste e estado", () => {
    for (const c of todos) {
      expect(["Alta", "Média", "Baixa"], c.ap).toContain(c.sev);
      expect(c.tasks.length, `${c.ap} sem task`).toBeGreaterThan(0);
      for (const t of c.tasks) expect(tasksDoPlano.has(t), `${c.ap} cita ${t}, que não existe no plano`).toBe(true);
      expect(c.teste.length, `${c.ap} sem teste`).toBeGreaterThan(0);
      expect(c.estado, c.ap).toMatch(/^(pronto|planejado:(A|B|C|D|portao))$/);
    }
  });

  it("toda ameaça `pronto` aponta para um teste que EXISTE (nome em arquivo de teste ou arquivo de teste); Alta nunca fica sem teste pronto nem plano", () => {
    for (const c of todos) {
      const nomes = [...c.teste.matchAll(/`?(ap\d{2}_[a-z0-9_]+)`?/g)].map((m) => m[1] as string);
      const arquivos = [...c.teste.matchAll(/[\w/-]+\.test\.tsx?/g)].map((m) => m[0]);
      expect(nomes.length + arquivos.length, `${c.ap}: teste não identificável`).toBeGreaterThan(0);
      if (c.estado.startsWith("planejado")) {
        expect(c.sev === "Alta" ? tasksDoPlano.size : 1, c.ap).toBeGreaterThan(0); // Alta planejada exige task existente (conferido acima)
        continue;
      }
      for (const a of arquivos) expect(TESTES.some((t) => t.arquivo === a.split("/").pop()), `${c.ap}: arquivo ${a} não existe`).toBe(true);
      for (const n of nomes) {
        const alvo = TESTES.filter((t) => arquivos.length === 0 || arquivos.some((a) => a.split("/").pop() === t.arquivo));
        expect(
          alvo.some((t) => t.texto.includes(n)),
          `${c.ap}: o teste ${n} não existe`,
        ).toBe(true);
      }
    }
  });

  it("o nome do teste de cada AP com nome bate com o número do caso", () => {
    for (const c of todos) {
      const nomes = [...c.teste.matchAll(/`?(ap\d{2})_[a-z0-9_]+`?/g)].map((m) => m[1] as string);
      for (const n of nomes) expect(n, c.ap).toBe(`ap${c.ap.slice(3)}`);
    }
  });

  it("registra as fronteiras F1..F4, os portões G1..G5 e os residuais R1..R6 com o texto exato", () => {
    for (const f of ["F1", "F2", "F3", "F4"]) expect(DOC, f).toMatch(new RegExp(`\\|\\s*${f}\\s`));
    for (const g of ["G1", "G2", "G3", "G4", "G5"]) expect(DOC, g).toMatch(new RegExp(`\\*\\*${g}\\s*[—-]`));
    for (const r of ["R1", "R2", "R3", "R4", "R5", "R6"]) expect(DOC, r).toMatch(new RegExp(`\\*\\*${r}\\s*[—-]`));
    expect(DOC).toContain("sugestões ruins são esperadas");
    expect(DOC).toContain("sha256 fixado no catálogo");
    expect(DOC).toContain("`LAYA_MODELO_DIR`");
  });

  it("confirma D-695..D-708 em 01-DECISOES.md e a herança (voz local + Telegram) existe e está citada", () => {
    const dec = ler("docs/ade/01-DECISOES.md");
    for (let i = 695; i <= 708; i++) expect(dec, `D-${i} em 01-DECISOES.md`).toContain(`**D-${i} `);
    expect(DOC).toMatch(/[Hh]erda e não duplica/);
    expect(existsSync(resolve(RAIZ, "docs/ade/AUDITORIA-VOZ-LOCAL.md")), "AUDITORIA-VOZ-LOCAL.md").toBe(true);
    expect(existsSync(resolve(RAIZ, "docs/ade/AMEACAS-TELEGRAM.md")), "AMEACAS-TELEGRAM.md").toBe(true);
    expect(DOC).toContain("AUDITORIA-VOZ-LOCAL.md");
    expect(DOC).toContain("AMEACAS-TELEGRAM.md");
  });

  it("os residuais estão enviados ao dono em PENDENCIAS-DO-DONO.md", () => {
    const pend = ler("docs/ade/PENDENCIAS-DO-DONO.md");
    expect(pend).toContain("## Decisor local laya");
    for (const r of ["R1 fraqueza zero-shot", "R2 host curinga", "R3 verificação rápida", "R4 Windows", "LAYA_MODELO_DIR"]) expect(pend, r).toContain(r);
  });

  it("ap16_portao_runtime_bloqueante: o portão de runtime T-25.02 é bloqueante no plano; `pronto` exige o §3 de base/L-laya-local.md com veredito GO", () => {
    expect(PLANO).toContain("bloqueante");
    const ap16 = todos.find((c) => c.ap === "AP-16");
    expect(ap16, "AP-16").toBeDefined();
    if (ap16?.estado === "pronto") {
      const pesquisa = ler("docs/ade/base/L-laya-local.md");
      expect(pesquisa, "§3 com veredito GO").toMatch(/## 3[\s\S]*Veredito[\s\S]*\*\*GO\*\*/);
    }
  });
});
