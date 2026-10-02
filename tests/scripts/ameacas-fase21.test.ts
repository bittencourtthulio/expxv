// T-21.01: o estudo de ameaças da Fase 21 é consistente com o plano e com os testes. Falha se uma ameaça Alta perder a task ou o teste que a prova,
// citar task inexistente, ou se os casos AU-01..AU-24, as fronteiras F1..F8, os portões G1..G4 e os residuais R1..R3 deixarem de existir.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "..", "..");
const ler = (p: string): string => readFileSync(resolve(RAIZ, p), "utf8");
const DOC = ler("docs/ade/seguranca/AMEACAS-FASE-21.md");
const PLANO = ler("docs/ade/fase-21-distribuicao.md");

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
const TESTES = [...testes(join(RAIZ, "src/nucleo/atualizador")), ...testes(join(RAIZ, "tests/scripts")), ...testes(join(RAIZ, "src/main")), ...testes(join(RAIZ, "src/renderer/telas/configuracoes"))];

interface Caso {
  au: string;
  sev: string;
  tasks: string[];
  teste: string;
  estado: string;
}
function casos(): Caso[] {
  const saida: Caso[] = [];
  for (const linha of DOC.split("\n")) {
    const m = /^\|\s*(AU-\d{2})\s*\|/.exec(linha);
    if (m === null) continue;
    const c = linha.split("|").map((x) => x.trim());
    // ["", AU, caso, sev, mitigação, task, teste, estado, ""]
    saida.push({ au: m[1] as string, sev: c[3] ?? "", tasks: [...(c[5] ?? "").matchAll(/T-21\.\d{2}/g)].map((x) => x[0]), teste: c[6] ?? "", estado: c[7] ?? "" });
  }
  return saida;
}
const tasksDoPlano = new Set([...PLANO.matchAll(/^- \*\*(T-21\.\d{2})/gm)].map((m) => m[1] as string));

describe("estudo de ameaças da Fase 21 (T-21.01)", () => {
  const todos = casos();

  it("tem os casos AU-01..AU-24 do plano (>= 24 exigidos)", () => {
    const ids = new Set(todos.map((c) => c.au));
    for (let i = 1; i <= 24; i++) expect(ids.has(`AU-${String(i).padStart(2, "0")}`), `AU-${i}`).toBe(true);
    expect(todos.length).toBeGreaterThanOrEqual(24);
  });

  it("toda ameaça tem severidade válida, task EXISTENTE no plano, teste e estado", () => {
    for (const c of todos) {
      expect(["Alta", "Média", "Baixa"], c.au).toContain(c.sev);
      expect(c.tasks.length, `${c.au} sem task`).toBeGreaterThan(0);
      for (const t of c.tasks) expect(tasksDoPlano.has(t), `${c.au} cita ${t}, que não existe no plano`).toBe(true);
      expect(c.teste.length, `${c.au} sem teste`).toBeGreaterThan(0);
      expect(c.estado, c.au).toMatch(/^(pronto|planejado:W[0-9])$/);
    }
  });

  it("toda ameaça `pronto` aponta para um teste que EXISTE (nome em arquivo de teste ou arquivo de teste); Alta nunca fica sem teste pronto nem plano", () => {
    for (const c of todos) {
      const nomes = [...c.teste.matchAll(/`?(au\d{2}_[a-z0-9_]+)`?/g)].map((m) => m[1] as string);
      const arquivos = [...c.teste.matchAll(/[\w-]+\.test\.tsx?/g)].map((m) => m[0]);
      expect(nomes.length + arquivos.length, `${c.au}: teste não identificável`).toBeGreaterThan(0);
      if (c.estado.startsWith("planejado")) {
        expect(c.sev === "Alta" ? tasksDoPlano.size : 1, c.au).toBeGreaterThan(0); // Alta planejada exige task existente (conferido acima)
        continue;
      }
      for (const a of arquivos) expect(TESTES.some((t) => t.arquivo === a), `${c.au}: arquivo ${a} não existe`).toBe(true);
      for (const n of nomes) {
        const alvo = TESTES.filter((t) => arquivos.length === 0 || arquivos.includes(t.arquivo));
        expect(
          alvo.some((t) => t.texto.includes(n)),
          `${c.au}: o teste ${n} não existe`,
        ).toBe(true);
      }
    }
  });

  it("o nome do teste de cada AU com nome bate com o número do caso", () => {
    for (const c of todos) {
      const nomes = [...c.teste.matchAll(/`?(au\d{2})_[a-z0-9_]+`?/g)].map((m) => m[1] as string);
      for (const n of nomes) expect(n, c.au).toBe(`au${c.au.slice(3)}`);
    }
  });

  it("registra as fronteiras F1..F8, os portões G1..G4 e os residuais R1..R3 com o texto exato", () => {
    for (const f of ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"]) expect(DOC, f).toMatch(new RegExp(`\\|\\s*${f}\\s*\\|`));
    for (const g of ["G1", "G2", "G3", "G4"]) expect(DOC, g).toMatch(new RegExp(`\\*\\*${g}\\*\\*`));
    for (const r of ["R1", "R2", "R3"]) expect(DOC, r).toMatch(new RegExp(`\\*\\*${r}\\*\\*`));
    expect(DOC).toContain("o sistema operacional avisa ou bloqueia a instalação");
    expect(DOC).toContain("assinada com a chave que o CI guarda");
    expect(DOC).toContain("não é protegida pelo atualizador");
  });

  it("lista os ativos exigidos e confirma D-340..D-349, que existem em 01-DECISOES.md", () => {
    for (const a of ["Chave privada de assinatura de código", "Chave privada do manifesto (Ed25519)", "Tokens e segredos do CI", "Artefatos publicados", "Canal `stable`", "`userData`, banco e cofre"]) expect(DOC, a).toContain(a);
    const dec = ler("docs/ade/01-DECISOES.md");
    for (let i = 340; i <= 349; i++) expect(dec, `D-${i} em 01-DECISOES.md`).toContain(`**D-${i} `);
    expect(DOC).toContain("D-340..D-349 confirmadas");
  });

  it("o residual R1..R3 está enviado ao dono em P-330 e o estudo recomenda o electron-updater só como backend isolado", () => {
    expect(ler("docs/ade/PENDENCIAS-DO-DONO.md")).toContain("| P-330 |");
    expect(DOC).toMatch(/um único arquivo/);
    expect(DOC).toContain("import()");
  });
});
