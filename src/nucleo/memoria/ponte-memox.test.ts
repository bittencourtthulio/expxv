import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estadoMemox, eventoDoMetodo, memoxInstalado, reindexarMemox } from "./ponte-memox";

const pastas: string[] = [];
afterEach(() => pastas.splice(0).forEach((p) => { try { chmodSync(p, 0o755); } catch { /* ok */ } rmSync(p, { recursive: true, force: true }); }));
const nova = (): string => {
  const p = mkdtempSync(join(tmpdir(), "ponte-memox-"));
  pastas.push(p);
  return p;
};
function comMemox(texto = "indice: 12 arquivos"): string {
  const raiz = nova();
  mkdirSync(join(raiz, ".claude/skills/memox/assets"), { recursive: true });
  writeFileSync(join(raiz, ".claude/skills/memox/assets/memox.py"), `import sys\nprint(${JSON.stringify(texto)})\n`);
  return raiz;
}

describe("ponte com o memox (T-08.10)", () => {
  it("sem memox: tudo funciona, sem erro nem aviso", async () => {
    const raiz = nova();
    expect(memoxInstalado(raiz)).toBe(false);
    expect(await estadoMemox(raiz)).toEqual({ instalado: false, texto: null, aviso: null });
    expect(await reindexarMemox(raiz)).toEqual({ ok: true, aviso: null });
  });
  it("com memox falso: lê o estado (somente leitura) e não escreve nada na raiz", async () => {
    const raiz = comMemox();
    const antes = JSON.stringify(readdirSync(raiz, { recursive: true }).sort());
    expect(memoxInstalado(raiz)).toBe(true);
    const e = await estadoMemox(raiz);
    expect(e.instalado).toBe(true);
    expect(e.texto).toContain("12 arquivos");
    expect(JSON.stringify(readdirSync(raiz, { recursive: true }).sort())).toBe(antes);
  });
  it("auditoria: leitura funciona com a raiz do projeto SOMENTE LEITURA (nenhuma escrita fora de userData)", async () => {
    const raiz = comMemox();
    chmodSync(raiz, 0o555);
    const e = await estadoMemox(raiz);
    expect(e.instalado).toBe(true);
  });
  it("eventos do método: task_concluida / veredito_emitido viram UMA linha com chave de dedupe; o resto é ignorado", () => {
    expect(eventoDoMetodo({ tipo: "task_concluida", trabalho_id: "sprint-x", task: "T-01" })).toMatchObject({ chave: "sprint-x|T-01|task_concluida", importancia: 2, texto: "Método: task T-01 concluída (sprint-x)" });
    expect(eventoDoMetodo({ tipo: "veredito_emitido", trabalho_id: "oc-1", veredito: "APROVADO" })).toMatchObject({ importancia: 3, texto: "Método: veredito APROVADO emitido (oc-1)" });
    expect(eventoDoMetodo({ tipo: "outra", trabalho_id: "x" })).toBeNull();
    expect(eventoDoMetodo({ tipo: "task_concluida" })).toBeNull();
    expect(eventoDoMetodo(null)).toBeNull();
  });
  it("reindexar (P-25): chama o script do memox por executor injetado; falha vira aviso discreto", async () => {
    const raiz = comMemox();
    const chamadas: string[][] = [];
    expect(await reindexarMemox(raiz, { executor: async (_s, a) => (chamadas.push(a), { codigo: 0 }) })).toEqual({ ok: true, aviso: null });
    expect(chamadas).toEqual([["reindexar"]]);
    expect((await reindexarMemox(raiz, { executor: async () => ({ codigo: 1 }) })).ok).toBe(false);
  });
});
