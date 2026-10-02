import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { detectarSuite } from "./detectar";
import type { EstadoSuiteId } from "./modelo";

const FIX = resolve(__dirname, "../../../tests/fixtures/suite/projetos");
const base = mkdtempSync(join(tmpdir(), "suite-detectar-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const copia = (nome: string): string => { const d = join(base, `${nome}-${Math.random().toString(36).slice(2, 7)}`); cpSync(join(FIX, nome), d, { recursive: true }); return d; };

const TABELA: ReadonlyArray<[string, EstadoSuiteId, RegExp]> = [
  ["ausente", "ausente", /não está instalada/],
  ["completa", "completa", /está instalada/],
  ["incompleta-sem-skill", "incompleta", /Faltam 1 skill\(s\): memox/],
  ["incompleta-lock-corrompido", "incompleta", /ilegível/],
  ["incompleta-sem-lock", "incompleta", /arquivo de controle/],
  ["ausente-com-claude", "ausente", /não está instalada/],
  ["desatualizada", "desatualizada", /0\.8\.0/],
];

describe("detecção da suíte por tabela de fixtures", () => {
  it.each(TABELA)("%s → %s", async (nome, esperado, motivo) => {
    const r = await detectarSuite(copia(nome), { gravavel: async () => true, nodeDisponivel: () => true });
    expect(r.estado).toBe(esperado);
    expect(r.motivo).toMatch(motivo);
  });

  it("completa lista as nove skills e a versão do lock", async () => {
    const r = await detectarSuite(join(FIX, "completa"));
    expect(r.skills_presentes).toHaveLength(9);
    expect(r.skills_faltando).toEqual([]);
    expect(r.versao_instalada).toBe("0.9.0");
  });

  it("pasta sem permissão de escrita → indisponivel (quando precisa instalar)", async () => {
    const r = await detectarSuite(copia("ausente"), { gravavel: async () => false });
    expect(r.estado).toBe("indisponivel");
    expect(r.motivo).toMatch(/permissão de escrita/);
  });

  it("Node ausente → indisponivel (quando precisa instalar)", async () => {
    const r = await detectarSuite(copia("ausente"), { gravavel: async () => true, nodeDisponivel: () => false });
    expect(r.estado).toBe("indisponivel");
    expect(r.motivo).toMatch(/Node/);
  });

  it("suíte completa continua completa mesmo sem escrita ou sem Node (nada a instalar)", async () => {
    const r = await detectarSuite(join(FIX, "completa"), { gravavel: async () => false, nodeDisponivel: () => false });
    expect(r.estado).toBe("completa");
  });

  it("é somente leitura: a pasta não muda", async () => {
    const d = copia("incompleta-sem-skill");
    const { criarManifesto, compararManifestos } = await import("./manifesto");
    const antes = await criarManifesto(d);
    await detectarSuite(d);
    const depois = await criarManifesto(d);
    expect(compararManifestos(antes.mapa, depois.mapa)).toEqual({ criados: [], alterados: [], removidos: [], fora_do_esperado: [] });
  });

  it("versão mínima configurável", async () => {
    const r = await detectarSuite(join(FIX, "completa"), { versaoMinima: "1.0.0" });
    expect(r.estado).toBe("desatualizada");
  });
});
