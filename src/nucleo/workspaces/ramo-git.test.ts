import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ramoAtual } from "./ramo-git";

const pastas: string[] = [];
const nova = (): string => { const p = mkdtempSync(join(tmpdir(), "ramo-")); pastas.push(p); return p; };
afterEach(() => { for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true }); });

describe("ramoAtual", () => {
  it("lê o ramo de .git/HEAD", async () => {
    const r = nova();
    mkdirSync(join(r, ".git"));
    writeFileSync(join(r, ".git", "HEAD"), "ref: refs/heads/feature/x\n");
    expect(await ramoAtual(r)).toBe("feature/x");
  });
  it("HEAD destacado, pasta sem git e erro viram null", async () => {
    const r = nova();
    mkdirSync(join(r, ".git"));
    writeFileSync(join(r, ".git", "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
    expect(await ramoAtual(r)).toBeNull();
    expect(await ramoAtual(nova())).toBeNull();
    expect(await ramoAtual(join(r, "nao-existe"))).toBeNull();
  });
  it("segue o ponteiro de worktree (.git é arquivo)", async () => {
    const r = nova();
    const real = join(r, "meta");
    mkdirSync(real);
    writeFileSync(join(real, "HEAD"), "ref: refs/heads/wt\n");
    mkdirSync(join(r, "wt"));
    writeFileSync(join(r, "wt", ".git"), "gitdir: ../meta\n");
    expect(await ramoAtual(join(r, "wt"))).toBe("wt");
  });
});
