import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { criarVcsSvn } from "./vcs-svn";
import { abrirVcs } from "../index";
import { capabilitiesDe, CAPABILITIES_SVN } from "../vcs";
import { chamadas, falso } from "../../../../tests/fixtures/vcs/svn-util";
import { BIN_FALSO, pastaTmp, removerPasta } from "../../../../tests/fixtures/vcs/repos";

const pastas: string[] = [];
afterEach(() => pastas.splice(0).forEach(removerPasta));

describe("Vcs svn: interface e capabilities", () => {
  it("SVN nega stage/stash/worktree/remoto e tem lock, changelist, propriedades, blame e histórico", () => {
    expect(CAPABILITIES_SVN).toMatchObject({ stage: false, stash: false, worktree: false, remoto: false, commitParcial: false, blame: true, historico: true, lock: true, changelist: true, propriedades: true });
    expect(capabilitiesDe("svn")).toMatchObject({ lock: true });
    expect(capabilitiesDe("svn", false)).toMatchObject({ historico: false });
    expect(capabilitiesDe("git").lock).toBeUndefined();
  });
  it("status() e diff() pelo contrato comum, com info em cache (1 svn info para vários status)", async () => {
    const f = falso();
    const dir = pastaTmp("svn-v-");
    pastas.push(dir);
    const v = criarVcsSvn(dir, { executavel: f.executavel, env: f.env });
    expect(v.tipo).toBe("svn");
    expect(v.git).toBeUndefined();
    const s1 = await v.status();
    await v.status();
    expect(s1).toMatchObject({ branch: "trunk", oid: "5" });
    expect(chamadas(f.log).filter((c) => c[0] === "info")).toHaveLength(1);
    const d = await v.diff();
    expect(d.arquivos.length).toBeGreaterThan(0);
    await v.svn.commit({ mensagem: "x", origem: "usuario" });
    await v.status();
    expect(chamadas(f.log).filter((c) => c[0] === "info")).toHaveLength(2); // invalidado pelo commit
  });
  it("abrirVcs: pasta com .svn e binário -> Vcs svn; sem binário -> null (degrada)", async () => {
    const dir = pastaTmp("svn-v-");
    pastas.push(dir);
    mkdirSync(join(dir, ".svn"));
    writeFileSync(join(dir, ".svn", "wc.db"), "");
    const antes = process.env.PATH;
    process.env.PATH = `${BIN_FALSO}:${antes}`;
    try {
      const v = await abrirVcs(dir, dir);
      expect(v?.tipo).toBe("svn");
      expect(v?.svn).toBeDefined();
    } finally {
      process.env.PATH = antes;
    }
    process.env.PATH = "/nao/existe";
    try {
      expect(await abrirVcs(dir, dir)).toBeNull();
    } finally {
      process.env.PATH = antes;
    }
  });
});
