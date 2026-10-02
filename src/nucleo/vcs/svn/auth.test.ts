import { describe, expect, it } from "vitest";
import { comandoAutenticar, verificarAutenticacaoSvn } from "./auth";
import { arquivoDeErro, chamadas, falso } from "../../../../tests/fixtures/vcs/svn-util";
import { pastaTmp } from "../../../../tests/fixtures/vcs/repos";

describe("svn/auth: autenticação segura", () => {
  it("sem credencial: estado nominal + comando de terminal, sem travar nem pedir senha", async () => {
    const f = falso({ SVN_FALSO_ERRO: arquivoDeErro("svn: E215004: Authentication failed and interactive prompting is disabled\nsvn: E215004: No more credentials or we tried too many times.\n") });
    const e = await verificarAutenticacaoSvn(pastaTmp("svn-a-"), { executavel: f.executavel, env: f.env, url: "https://svn.exemplo.com/repo" });
    expect(e).toMatchObject({ estado: "autenticacao_necessaria", comandoTerminal: "svn info 'https://svn.exemplo.com/repo'" });
    expect(chamadas(f.log)[0]).toContain("--non-interactive");
    expect((chamadas(f.log)[0] as string[]).join(" ")).not.toMatch(/password|trust-server/);
  });
  it("com credencial em cache: ok; rede fora e certificado têm estados próprios", async () => {
    const f = falso();
    expect((await verificarAutenticacaoSvn(pastaTmp("svn-a-"), { executavel: f.executavel, env: f.env })).estado).toBe("ok");
    const g = falso({ SVN_FALSO_ERRO: arquivoDeErro("svn: E230001: Server SSL certificate verification failed: issuer is not trusted\n") });
    expect((await verificarAutenticacaoSvn(pastaTmp("svn-a-"), { executavel: g.executavel, env: g.env })).estado).toBe("certificado_nao_confiavel");
    const h = falso({ SVN_FALSO_ERRO: arquivoDeErro("svn: E170013: Unable to connect to a repository at URL\n") });
    expect((await verificarAutenticacaoSvn(pastaTmp("svn-a-"), { executavel: h.executavel, env: h.env })).estado).toBe("sem_rede");
  });
  it("comandoAutenticar só aceita URL permitida e escapa aspas", () => {
    expect(() => comandoAutenticar("http://x/r")).toThrow();
    expect(() => comandoAutenticar("-oProxy=x")).toThrow();
    expect(comandoAutenticar("svn+ssh://h/r")).toBe("svn info 'svn+ssh://h/r'");
    expect(comandoAutenticar("https://h/r'x")).toBe("svn info 'https://h/r%27x'");
  });
});
