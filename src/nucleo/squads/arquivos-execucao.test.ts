import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lerArquivoDaExecucao } from "./arquivos-execucao";
import { LIMITE_ARQUIVO_EXECUCAO_BYTES } from "./tipos";

const tmps: string[] = [];
afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});
function ambiente() {
  const base = mkdtempSync(join(tmpdir(), "sq-arq-"));
  tmps.push(base);
  const pasta = join(base, ".expxv", "missoes", "m1");
  mkdirSync(pasta, { recursive: true });
  return { base, pasta };
}

describe("lerArquivoDaExecucao", () => {
  it("devolve existe=false quando o arquivo ainda não foi gravado", async () => {
    const { base } = ambiente();
    expect(await lerArquivoDaExecucao(base, "m1", "plano")).toEqual({ existe: false, texto: null, truncado: false });
  });

  it("lê plano.md e resultado.md da pasta da Missão", async () => {
    const { base, pasta } = ambiente();
    writeFileSync(join(pasta, "plano.md"), "# Plano\n- card 1\n");
    writeFileSync(join(pasta, "resultado.md"), "feito");
    expect((await lerArquivoDaExecucao(base, "m1", "plano")).texto).toBe("# Plano\n- card 1\n");
    expect((await lerArquivoDaExecucao(base, "m1", "resultado")).texto).toBe("feito");
  });

  it("redige segredo e remove caracteres de controle", async () => {
    const { base, pasta } = ambiente();
    writeFileSync(join(pasta, "plano.md"), "ok\u0000\u001b[31m API_KEY=sk-abcdefghijklmnopqrstuvwxyz0123456789 fim");
    const r = await lerArquivoDaExecucao(base, "m1", "plano");
    expect(r.texto).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    // eslint-disable-next-line no-control-regex
    expect(r.texto).not.toMatch(/[\u0000\u001b]/);
  });

  it("trunca acima de 256 KiB e avisa", async () => {
    const { base, pasta } = ambiente();
    writeFileSync(join(pasta, "plano.md"), "a".repeat(LIMITE_ARQUIVO_EXECUCAO_BYTES + 5000));
    const r = await lerArquivoDaExecucao(base, "m1", "plano");
    expect(r.truncado).toBe(true);
    expect(Buffer.byteLength(r.texto ?? "", "utf8")).toBeLessThanOrEqual(LIMITE_ARQUIVO_EXECUCAO_BYTES);
  });

  it("recusa link simbólico para fora da pasta do produto (mesmo dentro da raiz do workspace)", async () => {
    const { base, pasta } = ambiente();
    writeFileSync(join(base, "arquivo-de-ambiente"), "TOKEN=segredo-sentinela");
    symlinkSync(join(base, "arquivo-de-ambiente"), join(pasta, "plano.md"));
    const r = await lerArquivoDaExecucao(base, "m1", "plano");
    expect(r).toEqual({ existe: false, texto: null, truncado: false });
  });

  it("recusa id de Missão com separador ou ..", async () => {
    const { base } = ambiente();
    await expect(lerArquivoDaExecucao(base, "../x", "plano")).rejects.toThrow();
    await expect(lerArquivoDaExecucao(base, "a/b", "resultado")).rejects.toThrow();
  });
});
