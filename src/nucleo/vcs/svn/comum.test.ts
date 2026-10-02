import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ExecutorVcs } from "../executor";
import {
  AutenticacaoNecessariaErro, caminhoRepo, caminhoWc, exigirConfirmacaoServidor, mensagemEmArquivo, nomeSimples, rodarSvn, SvnErro, SvnIndisponivelErro, SvnRecusadoErro, traduzirErroSvn, validarUrl,
} from "./comum";
import { GitErro } from "../../git/erros";
import { arquivoDeErro, chamadas, falso } from "../../../../tests/fixtures/vcs/svn-util";
import { pastaTmp } from "../../../../tests/fixtures/vcs/repos";

describe("svn/comum: segurança de argv", () => {
  it("sempre --non-interactive e entrada do usuário só depois de `--` (caminho com `-` nunca vira opção)", async () => {
    const f = falso();
    await rodarSvn(pastaTmp("svn-c-"), "status", ["--xml"], ["-rf", "--password=x"], { executavel: f.executavel, env: f.env });
    const c = chamadas(f.log)[0] as string[];
    expect(c.slice(0, 3)).toEqual(["status", "--non-interactive", "--xml"]);
    expect(c.indexOf("--")).toBeGreaterThan(0);
    expect(c.slice(c.indexOf("--") + 1)).toEqual(["-rf", "--password=x"]);
  });
  it("recusa senha, confiança em certificado, diff/editor externos e override de config em flags", async () => {
    const cwd = pastaTmp("svn-c-");
    for (const flag of ["--password", "--password=segredo", "--trust-server-cert", "--trust-server-cert-failures=unknown-ca", "--force-interactive", "--diff-cmd=rm", "--editor-cmd=sh", "--config-option=x", "--config-dir=/tmp/x", "--username"]) {
      await expect(rodarSvn(cwd, "info", [flag])).rejects.toBeInstanceOf(SvnRecusadoErro);
    }
  });
  it("senha só por stdin e só por opção explícita do usuário (nunca em argv)", async () => {
    const f = falso();
    await rodarSvn(pastaTmp("svn-c-"), "info", [], [], { executavel: f.executavel, env: f.env, autenticacao: { usuario: "maria", senhaStdin: "s3nh4-secreta" } });
    const c = (chamadas(f.log)[0] as string[]).join(" ");
    expect(c).toContain("--username maria");
    expect(c).toContain("--password-from-stdin");
    expect(c).not.toContain("s3nh4-secreta");
    await expect(rodarSvn(pastaTmp("svn-c-"), "info", [], [], { autenticacao: { usuario: "-x" } })).rejects.toThrow();
  });
  it("nomes, caminhos e URLs: `-` inicial, `..`, controle e esquemas não permitidos são recusados", () => {
    expect(() => nomeSimples("-evil")).toThrow();
    expect(() => nomeSimples("a b")).toThrow();
    expect(nomeSimples("feature_1.2")).toBe("feature_1.2");
    expect(() => caminhoWc("../fora")).toThrow();
    expect(() => caminhoWc("/abs")).toThrow();
    expect(caminhoWc("pasta/a@b.txt")).toBe("pasta/a@b.txt@");
    expect(() => caminhoRepo("-r")).toThrow();
    expect(() => caminhoRepo("branches/../x")).toThrow();
    expect(caminhoRepo("/branches/x/")).toBe("branches/x");
    expect(validarUrl("https://svn.exemplo.com/r")).toBeTruthy();
    expect(validarUrl("svn+ssh://host/r")).toBeTruthy();
    for (const u of ["http://x/r", "svn://x/r", "ftp://x", "-oX", "https://u:senha@x/r", "file:///r", "https://x/a b", "javascript:1"]) expect(() => validarUrl(u)).toThrow(SvnRecusadoErro);
    expect(validarUrl("file:///r", true)).toBe("file:///r");
  });
  it("erro de URL nunca vaza a senha embutida", () => {
    try {
      validarUrl("https://u:senha-vaza@x/r");
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("senha-vaza");
    }
  });
  it("gravar no servidor exige origem usuario E confirmadoServidor: true", () => {
    expect(() => exigirConfirmacaoServidor("x", { origem: "automacao", confirmadoServidor: true })).toThrow(/usuário/);
    expect(() => exigirConfirmacaoServidor("x", { origem: "usuario" })).toThrow(/confirm/);
    expect(() => exigirConfirmacaoServidor("x", { origem: "usuario", confirmadoServidor: "sim" as unknown as boolean })).toThrow();
    expect(() => exigirConfirmacaoServidor("x", { origem: "usuario", confirmadoServidor: true })).not.toThrow();
  });
  it("mensagem vai para arquivo UTF-8 temporário que é removido", async () => {
    const m = await mensagemEmArquivo("olá ✓\nsegunda linha");
    expect(readFileSync(m.arquivo, "utf8")).toBe("olá ✓\nsegunda linha");
    await m.limpar();
    expect(() => readFileSync(m.arquivo)).toThrow();
  });
});

describe("svn/comum: erros nominais", () => {
  const traduz = (stderr: string): unknown => traduzirErroSvn(new GitErro("x", ["info"], 1, stderr), ["info"]);
  it("autenticação ausente vira autenticacao_necessaria com a instrução de terminal (sem travar)", async () => {
    const f = falso({ SVN_FALSO_ERRO: arquivoDeErro("svn: E170013: Unable to connect to a repository at URL 'https://x/r'\nsvn: E215004: Authentication failed and interactive prompting is disabled; see the --force-interactive option\nsvn: E215004: No more credentials or we tried too many times.\nAuthentication failed\n") });
    const e = await rodarSvn(pastaTmp("svn-c-"), "info", [], [], { executavel: f.executavel, env: f.env }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AutenticacaoNecessariaErro);
    expect((e as SvnErro).nominal).toBe("autenticacao_necessaria");
    expect((e as SvnErro).instrucao).toMatch(/terminal/);
  });
  it("demais falhas: sem permissão, certificado, rede, cópia bloqueada, desatualizado, conflito", () => {
    expect((traduz("svn: E170001: Authorization failed\n") as SvnErro).nominal).toBe("sem_permissao");
    expect((traduz("svn: E230001: Server SSL certificate verification failed\n") as SvnErro).nominal).toBe("certificado_nao_confiavel");
    expect((traduz("svn: E170013: Unable to connect to a repository at URL\n") as SvnErro).nominal).toBe("sem_rede");
    expect((traduz("svn: E155004: Working copy locked; run 'svn cleanup'\n") as SvnErro).nominal).toBe("copia_bloqueada");
    expect((traduz("svn: E160028: File is out of date\n") as SvnErro).nominal).toBe("desatualizado");
    expect((traduz("svn: E155015: Aborting commit: remains in conflict\n") as SvnErro).nominal).toBe("conflito");
  });
  it("binário inexistente vira instrução `brew install subversion`", async () => {
    const e = await rodarSvn(pastaTmp("svn-c-"), "info", [], [], { executavel: "/nao/existe/svn", executor: new ExecutorVcs() }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SvnIndisponivelErro);
    expect((e as Error).message).toContain("brew install subversion");
  });
});
