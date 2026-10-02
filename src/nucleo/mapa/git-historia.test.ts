import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { escrever, git, initRepo, isolarConfigGit, pastaTmp, removerPasta } from "../../../tests/fixtures/vcs/repos";
import { gerarRepo } from "../../../tests/fixtures/vcs/gerar";
import { AcumuladorHistoria, coletarHistoria } from "./git-historia";

const pastas: string[] = [];
beforeAll(isolarConfigGit);
afterEach(() => {
  for (const p of pastas.splice(0)) removerPasta(p);
});
const novo = (): string => {
  const base = pastaTmp("mapa-hist-");
  pastas.push(base);
  return join(base, "r");
};
const comoAutor = (dir: string, nome: string, email: string, msg: string): void => {
  git(dir, "add", "-A");
  git(dir, "-c", `user.name=${nome}`, "-c", `user.email=${email}`, "commit", "-q", "-m", msg);
};

describe("coletarHistoria (repositório sintético)", () => {
  it("churn, autores distintos por e-mail, correções, datas, renomeação seguida e merge ignorado", async () => {
    const dir = initRepo(novo(), false);
    escrever(dir, "src/a.ts", "1\n");
    escrever(dir, "src/b.ts", "1\n");
    comoAutor(dir, "Ana", "ana@x.com", "inicial");
    escrever(dir, "src/a.ts", "2\n");
    comoAutor(dir, "Ana Silva", "ANA@x.com", "fix: corrige bug no a"); // mesmo e-mail, nome diferente
    escrever(dir, "src/a.ts", "3\n");
    comoAutor(dir, "Bia", "bia@x.com", "ajuste");
    git(dir, "mv", "src/a.ts", "src/novo.ts");
    comoAutor(dir, "Bia", "bia@x.com", "renomeia");
    escrever(dir, "src/novo.ts", "4\n");
    comoAutor(dir, "Caio", "caio@x.com", "hotfix urgente");
    git(dir, "checkout", "-q", "-b", "lado");
    escrever(dir, "lado.ts", "x\n");
    comoAutor(dir, "Ana", "ana@x.com", "lado");
    git(dir, "checkout", "-q", "main");
    escrever(dir, "main.ts", "x\n");
    comoAutor(dir, "Ana", "ana@x.com", "principal");
    git(dir, "merge", "-q", "--no-ff", "-m", "merge", "lado");

    const r = await coletarHistoria({ raiz: dir });
    expect(r.estado).toBe("ok");
    const novoTs = r.arquivos.get("src/novo.ts")!;
    expect(novoTs).toMatchObject({ churn_total: 5, autores_n: 3, commits_correcao: 2 }); // inicial, fix, ajuste, renomeia, hotfix
    expect(r.arquivos.has("src/a.ts")).toBe(false); // histórico seguiu o novo nome
    expect(r.arquivos.get("src/b.ts")).toMatchObject({ churn_total: 1, autores_n: 1, commits_correcao: 0 });
    expect(Date.parse(novoTs.criado_git)).toBeLessThanOrEqual(Date.parse(novoTs.ultima_alt));
    expect(r.arquivos.get("lado.ts")?.churn_total).toBe(1);
    expect(r.commits).toBe(7); // o merge não conta
    expect(JSON.stringify([...r.arquivos.values()])).not.toMatch(/ana|bia|caio/i); // nenhum nome ou e-mail
  });

  it("janela de dias exclui commits antigos; teto de commits marca parcial; churn_janela só conta o recente", async () => {
    const dir = await gerarRepo(novo(), { arquivos: 30, commits: 40, alteracoesPorCommit: 2 }).then((r) => r.dir);
    const t0 = new Date(1_700_000_000_000 + 100_000_000); // ~1 dia depois dos commits gerados
    const cheio = await coletarHistoria({ raiz: dir, agora: t0 });
    expect(cheio.commits).toBe(40);
    const poucos = await coletarHistoria({ raiz: dir, agora: t0, maxCommits: 10 });
    expect(poucos.estado).toBe("parcial");
    expect(poucos.commits).toBe(10);
    const antigo = await coletarHistoria({ raiz: dir, agora: new Date(1_900_000_000_000), janelaDias: 30 });
    expect(antigo.commits).toBe(0);
    const semRecente = await coletarHistoria({ raiz: dir, agora: new Date(1_700_000_000_000 + 5 * 86_400_000 * 365 ), recenteDias: 30, janelaDias: 3650 });
    expect([...semRecente.arquivos.values()].every((a) => a.churn_janela === 0 && a.churn_total > 0)).toBe(true);
  });

  it("acoplamento temporal: pares ≥ 5 co-alterações e grau ≥ 0,3; commit grande (> 30) ignorado", async () => {
    const dir = initRepo(novo(), false);
    for (let i = 0; i < 6; i++) {
      escrever(dir, "x.ts", `${i}\n`);
      escrever(dir, "y.ts", `${i}\n`);
      if (i < 2) escrever(dir, "z.ts", `${i}\n`);
      comoAutor(dir, "A", "a@x.com", `c${i}`);
    }
    for (let i = 0; i < 40; i++) escrever(dir, `gigante/${i}.ts`, `${i}\n`);
    escrever(dir, "x.ts", "grande\n");
    escrever(dir, "y.ts", "grande\n");
    comoAutor(dir, "A", "a@x.com", "commit gigante");
    const r = await coletarHistoria({ raiz: dir });
    expect(r.acoplamento).toEqual([{ a: "x.ts", b: "y.ts", co_alteracoes: 6, grau: 0.857 }]);
  });

  it("sem repositório git: indisponível; cancelamento propaga", async () => {
    const base = pastaTmp("mapa-hist-sem-");
    pastas.push(base);
    expect(await coletarHistoria({ raiz: base })).toMatchObject({ estado: "indisponivel", commits: 0 });
    const dir = initRepo(novo());
    const ac = new AbortController();
    ac.abort();
    await expect(coletarHistoria({ raiz: dir, signal: ac.signal })).rejects.toThrow();
  });

  it("assunto com separador interno e nomes não ASCII não quebram o parse", async () => {
    const dir = initRepo(novo(), false);
    escrever(dir, "ação/título.ts", "1\n");
    comoAutor(dir, "Zé", "ze@x.com", "fix: a\u001fb");
    const r = await coletarHistoria({ raiz: dir });
    expect(r.arquivos.get("ação/título.ts")?.commits_correcao).toBe(1);
  });
});

describe("AcumuladorHistoria (formato do git log)", () => {
  it("aceita o texto em pedaços arbitrários", async () => {
    const texto = "\x1eh2\x1fB\x1fb@x\x1f1700000100\x1fdois\0\nR100\0a.ts\0c.ts\0\x1eh1\x1fA\x1fa@x\x1f1700000000\x1ffix um\0\nM\0a.ts\0M\0b.ts\0";
    const acc = new AcumuladorHistoria(0);
    for (let i = 0; i < texto.length; i += 7) acc.alimentar(texto.slice(i, i + 7));
    acc.finalizar();
    const { arquivos } = await acc.resultado();
    expect([...arquivos.keys()].sort()).toEqual(["b.ts", "c.ts"]);
    expect(arquivos.get("c.ts")).toMatchObject({ churn_total: 2, autores_n: 2 }); // h2 (mais novo, renomeia) e h1 sob o nome atual
  });
});
