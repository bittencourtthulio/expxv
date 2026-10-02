import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrarDadosLegados, MARCADOR_MIGRACAO, type SafeStorageMinimo } from "./dados-legados";

// AU-18 (D-341): renomear não pode deixar o cofre/dados ilegíveis; a migração copia, nunca apaga.

let raiz: string;
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "dados-legados-"));
});
afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

function semear(id: string, cofre: object | null = { versao: 1, motor: "safe_storage", entradas: [{ id: "cof_x", cifrado_b64: Buffer.from("ok").toString("base64") }] }): void {
  const dir = join(raiz, id);
  mkdirSync(join(dir, "sub"), { recursive: true });
  writeFileSync(join(dir, "dados.db"), "BANCO");
  writeFileSync(join(dir, "dados.db-wal"), "WAL");
  writeFileSync(join(dir, "preferencias.json"), '{"tema":"escuro"}');
  writeFileSync(join(dir, "sub", "x.txt"), "x");
  writeFileSync(join(dir, "SingletonLock"), "trava");
  if (cofre !== null) writeFileSync(join(dir, "cofre.json"), JSON.stringify(cofre));
}

const ssBom = (): SafeStorageMinimo => ({ isEncryptionAvailable: () => true, decryptString: () => "ok" });
const ssQuebrado = (): SafeStorageMinimo => ({
  isEncryptionAvailable: () => true,
  decryptString: () => {
    throw new Error("item do chaveiro inacessível");
  },
});
const base = { idDados: "novo", idsAnteriores: ["antigo"] as const };

describe("migrarDadosLegados", () => {
  it("sem pasta anterior: nada a migrar e nada é criado", async () => {
    const r = await migrarDadosLegados({ raizDados: raiz, ...base, safeStorage: ssBom() });
    expect(r.estado).toBe("nada_a_migrar");
    expect(existsSync(join(raiz, "novo"))).toBe(false);
  });

  it("idDados igual ao antigo (renomeou só o nome): não faz nada", async () => {
    semear("antigo");
    const r = await migrarDadosLegados({ raizDados: raiz, idDados: "antigo", idsAnteriores: ["antigo"], safeStorage: ssBom() });
    expect(r.estado).toBe("nada_a_migrar");
    expect(readdirSync(raiz)).toEqual(["antigo"]);
  });

  it("copia banco, preferências e cofre (alcançável) e NUNCA apaga o antigo", async () => {
    semear("antigo");
    const r = await migrarDadosLegados({ raizDados: raiz, ...base, safeStorage: ssBom() });
    expect(r).toMatchObject({ estado: "migrado", origem: "antigo", avisos: [] });
    expect(readFileSync(join(raiz, "novo", "dados.db"), "utf8")).toBe("BANCO");
    expect(readFileSync(join(raiz, "novo", "dados.db-wal"), "utf8")).toBe("WAL");
    expect(readFileSync(join(raiz, "novo", "preferencias.json"), "utf8")).toBe('{"tema":"escuro"}');
    expect(readFileSync(join(raiz, "novo", "sub", "x.txt"), "utf8")).toBe("x");
    expect(existsSync(join(raiz, "novo", "cofre.json"))).toBe(true);
    expect(existsSync(join(raiz, "novo", "SingletonLock"))).toBe(false);
    // o antigo segue intacto
    expect(readFileSync(join(raiz, "antigo", "dados.db"), "utf8")).toBe("BANCO");
    expect(existsSync(join(raiz, "antigo", "cofre.json"))).toBe(true);
    // marcador sem caminho absoluto
    const marcador = readFileSync(join(raiz, "novo", MARCADOR_MIGRACAO), "utf8");
    expect(marcador).not.toContain(raiz);
    expect(JSON.parse(marcador)).toMatchObject({ origem: "antigo" });
  });

  it("não deixa pasta temporária depois de migrar", async () => {
    semear("antigo");
    await migrarDadosLegados({ raizDados: raiz, ...base, safeStorage: ssBom() });
    expect(readdirSync(raiz).sort()).toEqual(["antigo", "novo"]);
  });

  it("idempotente: a segunda execução não duplica nem sobrescreve", async () => {
    semear("antigo");
    await migrarDadosLegados({ raizDados: raiz, ...base, safeStorage: ssBom() });
    writeFileSync(join(raiz, "novo", "preferencias.json"), '{"tema":"claro"}');
    writeFileSync(join(raiz, "antigo", "dados.db"), "MUDOU");
    const r = await migrarDadosLegados({ raizDados: raiz, ...base, safeStorage: ssBom() });
    expect(r.estado).toBe("ja_migrado");
    expect(readFileSync(join(raiz, "novo", "preferencias.json"), "utf8")).toBe('{"tema":"claro"}');
    expect(readFileSync(join(raiz, "novo", "dados.db"), "utf8")).toBe("BANCO");
    expect(readdirSync(raiz).sort()).toEqual(["antigo", "novo"]);
  });

  it("destino que já existe sem marcador (uso próprio) é respeitado", async () => {
    semear("antigo");
    mkdirSync(join(raiz, "novo"));
    writeFileSync(join(raiz, "novo", "dados.db"), "PROPRIO");
    const r = await migrarDadosLegados({ raizDados: raiz, ...base, safeStorage: ssBom() });
    expect(r.estado).toBe("destino_existente");
    expect(readFileSync(join(raiz, "novo", "dados.db"), "utf8")).toBe("PROPRIO");
  });

  it("cofre inalcançável: migra o banco, sinaliza reconfigurar_cofre e não leva o cofre ilegível", async () => {
    semear("antigo");
    const r = await migrarDadosLegados({ raizDados: raiz, ...base, safeStorage: ssQuebrado() });
    expect(r.estado).toBe("migrado");
    expect(r.avisos).toEqual(["reconfigurar_cofre"]);
    expect(readFileSync(join(raiz, "novo", "dados.db"), "utf8")).toBe("BANCO");
    expect(existsSync(join(raiz, "novo", "cofre.json"))).toBe(false);
    expect(existsSync(join(raiz, "antigo", "cofre.json"))).toBe(true);
    // o aviso persiste na segunda execução
    const r2 = await migrarDadosLegados({ raizDados: raiz, ...base, safeStorage: ssQuebrado() });
    expect(r2).toMatchObject({ estado: "ja_migrado", avisos: ["reconfigurar_cofre"] });
  });

  it("sem safeStorage disponível e cofre do SO: mesmo aviso", async () => {
    semear("antigo");
    const r = await migrarDadosLegados({ raizDados: raiz, ...base });
    expect(r.avisos).toEqual(["reconfigurar_cofre"]);
    expect(existsSync(join(raiz, "novo", "dados.db"))).toBe(true);
  });

  it("cofre com senha-mestra não depende do chaveiro: é copiado", async () => {
    semear("antigo", { versao: 1, motor: "senha_mestra", entradas: [{ id: "cof_x", cifrado_b64: "AAAA" }] });
    const r = await migrarDadosLegados({ raizDados: raiz, ...base });
    expect(r.avisos).toEqual([]);
    expect(existsSync(join(raiz, "novo", "cofre.json"))).toBe(true);
  });

  it("sem cofre ou cofre vazio: nada a reconfigurar", async () => {
    semear("antigo", null);
    expect((await migrarDadosLegados({ raizDados: raiz, ...base })).avisos).toEqual([]);
    rmSync(join(raiz, "novo"), { recursive: true });
    semear("antigo", { versao: 1, motor: "safe_storage", entradas: [] });
    expect((await migrarDadosLegados({ raizDados: raiz, ...base })).avisos).toEqual([]);
  });

  it("falha no meio da cópia: mantém o antigo, não cria o destino e não deixa temporário", async () => {
    semear("antigo");
    const r = await migrarDadosLegados({
      raizDados: raiz,
      ...base,
      safeStorage: ssBom(),
      copiarArquivo: async (de, para) => {
        if (de.endsWith("preferencias.json")) throw new Error("disco cheio");
        const { copyFile } = await import("node:fs/promises");
        await copyFile(de, para);
      },
    });
    expect(r.estado).toBe("falhou");
    expect(r.motivo).toBe("copia_falhou");
    expect(readdirSync(raiz)).toEqual(["antigo"]);
    expect(readFileSync(join(raiz, "antigo", "dados.db"), "utf8")).toBe("BANCO");
    // uma nova tentativa (sem falha) funciona
    const r2 = await migrarDadosLegados({ raizDados: raiz, ...base, safeStorage: ssBom() });
    expect(r2.estado).toBe("migrado");
  });

  it("usa o primeiro id anterior que existe (mais recente primeiro)", async () => {
    semear("velho");
    semear("antigo");
    writeFileSync(join(raiz, "antigo", "dados.db"), "RECENTE");
    const r = await migrarDadosLegados({ raizDados: raiz, idDados: "novo", idsAnteriores: ["antigo", "velho"], safeStorage: ssBom() });
    expect(r.origem).toBe("antigo");
    expect(readFileSync(join(raiz, "novo", "dados.db"), "utf8")).toBe("RECENTE");
  });

  it("recusa ids que escapam da raiz (path traversal)", async () => {
    const r = await migrarDadosLegados({ raizDados: raiz, idDados: "novo", idsAnteriores: ["../fora", "a/b"], safeStorage: ssBom() });
    expect(r.estado).toBe("nada_a_migrar");
    expect(migrarDadosLegados({ raizDados: raiz, idDados: "../novo", idsAnteriores: ["antigo"] })).resolves.toMatchObject({ estado: "falhou", motivo: "id_invalido" });
  });
});
