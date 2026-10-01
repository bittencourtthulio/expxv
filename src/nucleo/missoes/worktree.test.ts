import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { criarRepoGit, git, limpar } from "../../../tests/fixtures/dominio/ambiente";
import { criarWorktreeDaMissao, nomeDoBranch } from "./worktree";

afterEach(limpar);

describe("nome do branch", () => {
  it("feature/<slug>, fix/<OC-ID>-<slug>, chore/<OC-ID>-<slug>", () => {
    expect(nomeDoBranch({ origem: "feature", slug: "cobranca-pix" })).toBe("feature/cobranca-pix");
    expect(nomeDoBranch({ origem: "ocorrencia", slug: "frete-errado", ocId: "OC-2026-0142" })).toBe("fix/OC-2026-0142-frete-errado");
    expect(nomeDoBranch({ origem: "ocorrencia", slug: "limpar", ocId: "OC-2026-0143", tipoOcorrencia: "chore" })).toBe("chore/OC-2026-0143-limpar");
    expect(nomeDoBranch({ origem: "ocorrencia", slug: "frete-errado" })).toBe("fix/frete-errado"); // OC-ID ainda não existe: a runx atribui depois
  });

  it("origens sem trabalho próprio não têm branch", () => {
    for (const origem of ["livre", "pedido", "projeto"] as const) expect(nomeDoBranch({ origem, slug: "x" })).toBeNull();
  });

  it("recusa OC-ID malformado (nada de caminho ou opção de git)", () => {
    expect(() => nomeDoBranch({ origem: "ocorrencia", slug: "x", ocId: "../../etc" })).toThrow();
    expect(() => nomeDoBranch({ origem: "ocorrencia", slug: "x", ocId: "--force" })).toThrow();
  });
});

describe("worktree da Missão", () => {
  it("cria ../<repo>--<slug> com branch feature/<slug> (slug sem acento)", async () => {
    const { raiz, pai } = criarRepoGit();
    const r = (await criarWorktreeDaMissao({ raizRepo: raiz, titulo: "Cobrança via PIX!", origem: "feature" })) as NonNullable<Awaited<ReturnType<typeof criarWorktreeDaMissao>>>;
    expect(r).toMatchObject({ worktree: "../repo--cobranca-via-pix", branch: "feature/cobranca-via-pix" });
    expect(r.caminho).toBe(join(pai, "repo--cobranca-via-pix"));
    expect(existsSync(r.caminho)).toBe(true);
    expect(git(raiz, "branch", "--list", "feature/cobranca-via-pix").trim()).toContain("feature/cobranca-via-pix");
  });

  it("colisão de slug ganha sufixo nas duas pontas (pasta e branch)", async () => {
    const { raiz } = criarRepoGit();
    const a = await criarWorktreeDaMissao({ raizRepo: raiz, titulo: "mesma coisa", origem: "feature" });
    const b = await criarWorktreeDaMissao({ raizRepo: raiz, titulo: "mesma coisa", origem: "feature" });
    expect(a?.worktree).toBe("../repo--mesma-coisa");
    expect(b).toMatchObject({ worktree: "../repo--mesma-coisa-2", branch: "feature/mesma-coisa-2" });
  });

  it("ocorrência com OC-ID usa fix/", async () => {
    const { raiz } = criarRepoGit();
    const r = await criarWorktreeDaMissao({ raizRepo: raiz, titulo: "Frete errado", origem: "ocorrencia", ocId: "OC-2026-0142" });
    expect(r?.branch).toBe("fix/OC-2026-0142-frete-errado");
    expect(r?.worktree).toBe("../repo--frete-errado");
  });

  it("origem sem trabalho devolve null e não toca no repo", async () => {
    const { raiz } = criarRepoGit();
    expect(await criarWorktreeDaMissao({ raizRepo: raiz, titulo: "x", origem: "livre" })).toBeNull();
    expect(git(raiz, "worktree", "list").trim().split("\n")).toHaveLength(1);
  });
});
