import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { abrirBanco, migrar, MIGRACOES } from "../nucleo/banco";
import { PRODUTO } from "../nucleo/produto";
import { criarTmp, limpar } from "../../tests/fixtures/dominio/ambiente";
import { abrirDominioBase } from "./dominio-base";

afterEach(limpar);

const backups = (pasta: string): string[] => readdirSync(pasta).filter((n) => n.includes(".bak-v"));

describe("abrirDominioBase: backup antes de migrar (AUD-08)", () => {
  it("banco existente com migration pendente ganha cópia ANTES de migrar", async () => {
    const pasta = criarTmp("dom-base-");
    const antigo = abrirBanco(join(pasta, `${PRODUTO.id}.db`));
    migrar(antigo, { migracoes: MIGRACOES.slice(0, 2) }); // banco de uma versão anterior do app
    antigo.fechar();
    const dominio = await abrirDominioBase({ pastaDeDados: pasta, escolherPasta: async () => null });
    try {
      const feitos = backups(pasta);
      expect(feitos).toHaveLength(1);
      expect(feitos[0]).toContain(".bak-v2-");
      // a cópia é a versão antiga (sem as tabelas novas); o banco aberto já foi migrado
      const copia = abrirBanco(join(pasta, feitos[0] as string));
      expect(copia.consultarUm("SELECT name FROM sqlite_master WHERE name = 'wake_pendente'")).toBeUndefined();
      copia.fechar();
      expect(dominio.banco.consultarUm("SELECT name FROM sqlite_master WHERE name = 'wake_pendente'")).toBeDefined();
    } finally {
      dominio.fechar();
    }
  });

  it("banco novo e banco já atualizado não geram backup", async () => {
    const pasta = criarTmp("dom-base-");
    (await abrirDominioBase({ pastaDeDados: pasta, escolherPasta: async () => null })).fechar();
    expect(backups(pasta)).toEqual([]);
    (await abrirDominioBase({ pastaDeDados: pasta, escolherPasta: async () => null })).fechar();
    expect(backups(pasta)).toEqual([]);
  });
});
