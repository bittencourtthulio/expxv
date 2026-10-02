import { describe, expect, it } from "vitest";
import { analisarOrigemGit, validarBranch, validarNomePasta, type CodigoOrigem } from "./url";

const ok = (e: string, op: { permitirLocal?: boolean } = {}) => {
  const r = analisarOrigemGit(e, op);
  if (!r.ok) throw new Error(`esperava aceitar ${JSON.stringify(e)}: ${r.codigo} ${r.motivo}`);
  return r.origem;
};

// valor sintético montado em tempo de execução (nada que pareça credencial real no arquivo)
const TOKEN_FALSO = ["ghp", "_", "a".repeat(36)].join("");

describe("analisarOrigemGit — aceita", () => {
  const aceitas: Array<[string, { url_git: string; host: string; repo: string; nome: string; tipo: string; provedor: string; slug: string | null }]> = [
    ["https://github.com/dono/repo", { url_git: "https://github.com/dono/repo", host: "github.com", repo: "repo", nome: "repo", tipo: "https", provedor: "github", slug: "dono/repo" }],
    ["https://github.com/dono/repo.git", { url_git: "https://github.com/dono/repo.git", host: "github.com", repo: "repo", nome: "repo", tipo: "https", provedor: "github", slug: "dono/repo" }],
    ["  https://GitHub.com/Dono/Meu.Repo.git/  ", { url_git: "https://github.com/Dono/Meu.Repo.git", host: "github.com", repo: "Meu.Repo", nome: "Meu.Repo", tipo: "https", provedor: "github", slug: "Dono/Meu.Repo" }],
    ["git@github.com:dono/repo.git", { url_git: "git@github.com:dono/repo.git", host: "github.com", repo: "repo", nome: "repo", tipo: "ssh", provedor: "github", slug: "dono/repo" }],
    ["dono/repo", { url_git: "https://github.com/dono/repo.git", host: "github.com", repo: "repo", nome: "repo", tipo: "github_curto", provedor: "github", slug: "dono/repo" }],
    ["dono/repo.git", { url_git: "https://github.com/dono/repo.git", host: "github.com", repo: "repo", nome: "repo", tipo: "github_curto", provedor: "github", slug: "dono/repo" }],
    ["https://gitlab.com/grupo/sub/projeto.git", { url_git: "https://gitlab.com/grupo/sub/projeto.git", host: "gitlab.com", repo: "projeto", nome: "projeto", tipo: "https", provedor: "gitlab", slug: null }],
    ["git@gitlab.com:grupo/projeto.git", { url_git: "git@gitlab.com:grupo/projeto.git", host: "gitlab.com", repo: "projeto", nome: "projeto", tipo: "ssh", provedor: "gitlab", slug: null }],
    ["https://bitbucket.org/time/repo.git", { url_git: "https://bitbucket.org/time/repo.git", host: "bitbucket.org", repo: "repo", nome: "repo", tipo: "https", provedor: "bitbucket", slug: null }],
    ["https://dev.azure.com/org/proj/_git/repo", { url_git: "https://dev.azure.com/org/proj/_git/repo", host: "dev.azure.com", repo: "repo", nome: "repo", tipo: "https", provedor: "azure", slug: null }],
    ["git@ssh.dev.azure.com:v3/org/proj/repo", { url_git: "git@ssh.dev.azure.com:v3/org/proj/repo", host: "ssh.dev.azure.com", repo: "repo", nome: "repo", tipo: "ssh", provedor: "azure", slug: null }],
    ["ssh://git@github.com/dono/repo.git", { url_git: "ssh://git@github.com/dono/repo.git", host: "github.com", repo: "repo", nome: "repo", tipo: "ssh", provedor: "github", slug: "dono/repo" }],
    ["ssh://git@git.exemplo.com:2222/time/repo.git", { url_git: "ssh://git@git.exemplo.com:2222/time/repo.git", host: "git.exemplo.com", repo: "repo", nome: "repo", tipo: "ssh", provedor: "outro", slug: null }],
    ["https://git.exemplo.com:8443/time/repo", { url_git: "https://git.exemplo.com:8443/time/repo", host: "git.exemplo.com", repo: "repo", nome: "repo", tipo: "https", provedor: "outro", slug: null }],
    ["https://github.com/dono/.github", { url_git: "https://github.com/dono/.github", host: "github.com", repo: ".github", nome: "github", tipo: "https", provedor: "github", slug: "dono/.github" }],
  ];
  it.each(aceitas)("%s", (entrada, esperado) => {
    const o = ok(entrada);
    expect(o.url_git).toBe(esperado.url_git);
    expect(o.host).toBe(esperado.host);
    expect(o.repo).toBe(esperado.repo);
    expect(o.nome_sugerido).toBe(esperado.nome);
    expect(o.tipo).toBe(esperado.tipo);
    expect(o.provedor).toBe(esperado.provedor);
    expect(o.github_slug).toBe(esperado.slug);
    expect(o.exibicao).not.toMatch(/@/);
  });

  it("o nome sugerido sempre passa na validação de nome de pasta", () => {
    for (const e of ["https://github.com/dono/a%20b", "https://github.com/dono/...", "dono/-x-", "https://github.com/dono/CON"]) {
      const r = analisarOrigemGit(e);
      if (r.ok) expect(validarNomePasta(r.origem.nome_sugerido).ok).toBe(true);
    }
  });
});

describe("analisarOrigemGit — recusa (injeções e armadilhas)", () => {
  const recusadas: Array<[string, string, CodigoOrigem]> = [
    ["vazio", "", "vazia"],
    ["só espaços", "   ", "vazia"],
    ["opção -oProxyCommand", "-oProxyCommand=sh -c 'id'", "opcao"],
    ["opção --upload-pack", "--upload-pack=touch /tmp/x", "opcao"],
    ["começa com hífen simples", "-x", "opcao"],
    ["ext:: com shell", "ext::sh -c 'touch /tmp/pwned'", "esquema_proibido"],
    ["ext:: sem espaço", "ext::sh", "esquema_proibido"],
    ["fd::", "fd::17/foo", "esquema_proibido"],
    ["URL com --upload-pack embutido", "https://github.com/dono/repo --upload-pack=x", "espaco"],
    ["URL com espaço", "https://github.com/dono/meu repo", "espaco"],
    ["quebra de linha", "https://github.com/dono/repo\nhttps://evil.example/x", "controle"],
    ["byte nulo", "https://github.com/dono/repo\u0000", "controle"],
    ["tab no meio", "https://github.com/dono/\trepo", "controle"],
    ["bidi override", "https://github.com/dono/repo\u202e", "controle"],
    ["zero-width", "https://github.com/do\u200bno/repo", "controle"],
    ["homóglifo cirílico no host", "https://g\u0456thub.com/dono/repo", "nao_ascii"],
    ["homóglifo no atalho", "d\u043eno/repo", "nao_ascii"],
    ["ponto final ideográfico", "https://github\u3002com/dono/repo", "nao_ascii"],
    ["senha na URL", "https://user:senha@github.com/dono/repo", "credenciais"],
    ["token como usuário", `https://${TOKEN_FALSO}@github.com/dono/repo`, "credenciais"],
    ["usuário sem senha em https", "https://user@github.com/dono/repo", "credenciais"],
    ["senha em ssh://", "ssh://git:segredo@github.com/dono/repo", "credenciais"],
    ["file:/// sem permissão", "file:///tmp/repo", "local_bloqueado"],
    ["caminho absoluto sem permissão", "/Users/x/repo", "local_bloqueado"],
    ["caminho Windows sem permissão", "C:\\repos\\x", "local_bloqueado"],
    ["http (sem TLS)", "http://github.com/dono/repo", "esquema_proibido"],
    ["git://", "git://github.com/dono/repo.git", "esquema_proibido"],
    ["ftp", "ftp://example.com/dono/repo", "esquema_proibido"],
    ["javascript:", "javascript://github.com/%0aalert(1)", "esquema_proibido"],
    ["scp com ../", "git@host:../../etc/passwd", "caminho_invalido"],
    ["scp com ../ no meio", "git@github.com:dono/../../x.git", "caminho_invalido"],
    ["https com ..", "https://github.com/dono/../x", "caminho_invalido"],
    ["https com %2e%2e", "https://github.com/dono/%2e%2e/x", "caminho_invalido"],
    ["https com query", "https://github.com/dono/repo?x=1", "caminho_invalido"],
    ["https com fragmento", "https://github.com/dono/repo#x", "caminho_invalido"],
    ["só um segmento", "https://github.com/dono", "caminho_invalido"],
    ["host começando com hífen no scp", "git@-oProxyCommand=x:dono/repo", "host_invalido"],
    ["host começando com hífen no ssh", "ssh://git@-oProxyCommand=x/dono/repo", "host_invalido"],
    ["host IPv6", "https://[::1]/dono/repo", "host_invalido"],
    ["usuário scp com opção", "-o@github.com:dono/repo", "opcao"],
    ["atalho sem dono", "repo", "formato"],
    ["atalho com três partes", "a/b/c", "formato"],
    ["texto solto", "quero clonar o projeto", "espaco"],
    ["dono com ponto no atalho (parece host)", "github.com/dono/repo", "formato"],
  ];
  it.each(recusadas)("%s", (_nome, entrada, codigo) => {
    const r = analisarOrigemGit(entrada);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe(codigo);
  });

  it("recusa não-string e texto enorme", () => {
    expect(analisarOrigemGit(undefined).ok).toBe(false);
    expect(analisarOrigemGit(42).ok).toBe(false);
    const r = analisarOrigemGit(`https://github.com/dono/${"a".repeat(3000)}`);
    expect(r.ok === false && r.codigo).toBe("muito_longa");
  });

  it("a mensagem de credencial orienta `gh auth login` e nunca ecoa a senha", () => {
    const r = analisarOrigemGit("https://user:senha-secreta@github.com/dono/repo");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain("gh auth login");
      expect(r.motivo).not.toContain("senha-secreta");
    }
  });

  it("o resultado nunca carrega userinfo", () => {
    for (const e of ["git@github.com:dono/repo.git", "ssh://git@github.com/dono/repo.git"]) {
      const o = ok(e);
      expect(o.exibicao).toBe("github.com/dono/repo");
    }
  });
});

describe("analisarOrigemGit — caminho local só com permissão", () => {
  it("aceita caminho absoluto e file:/// quando permitido", () => {
    expect(ok("/tmp/teste/meu-repo.git", { permitirLocal: true })).toMatchObject({ tipo: "local", repo: "meu-repo", url_git: "/tmp/teste/meu-repo.git", nome_sugerido: "meu-repo" });
    expect(ok("file:///tmp/teste/outro", { permitirLocal: true }).url_git).toBe("/tmp/teste/outro");
    expect(ok("/tmp/com espaco/repo", { permitirLocal: true }).url_git).toBe("/tmp/com espaco/repo");
  });
  it("mesmo permitido, recusa `..`, file:// sem barra tripla e controle", () => {
    expect(analisarOrigemGit("/tmp/a/../../etc", { permitirLocal: true }).ok).toBe(false);
    expect(analisarOrigemGit("file://host/tmp/x", { permitirLocal: true }).ok).toBe(false);
    expect(analisarOrigemGit("/tmp/x\u0000y", { permitirLocal: true }).ok).toBe(false);
  });
  it("permitir local não relaxa as outras regras (ext::, opção, credenciais)", () => {
    for (const e of ["ext::sh -c id", "-oProxyCommand=x", "https://u:p@github.com/a/b"]) expect(analisarOrigemGit(e, { permitirLocal: true }).ok).toBe(false);
  });
});

describe("validarNomePasta", () => {
  it.each(["meu-projeto", "app_v2", "Projeto Final", "a.b", "x".repeat(100)])("aceita %s", (n) => expect(validarNomePasta(n).ok).toBe(true));
  it.each(["", "  ", ".", "..", ".git", ".oculta", "-x", "a/b", "a\\b", "a:b", "a*b", "a?b", "a<b", "a|b", "nome.", "CON", "nul.txt", "COM1", "x".repeat(101), "a\u0000b", "a\nb"])("recusa %j", (n) => expect(validarNomePasta(n).ok).toBe(false));
  it("recusa não-string", () => expect(validarNomePasta(3 as unknown).ok).toBe(false));
});

describe("validarBranch", () => {
  it.each([null, undefined, "", "  "])("vazio vira a padrão (%j)", (b) => expect(validarBranch(b)).toEqual({ ok: true, branch: null }));
  it.each(["main", "feature/x-1", "release/1.2.3", "fix_bug"])("aceita %s", (b) => expect(validarBranch(b)).toEqual({ ok: true, branch: b }));
  it.each(["-x", "--upload-pack=x", "a..b", "/x", "x/", "a//b", "a b", "x.lock", "a@{1}", "x\u0000", "a;b", "$(id)"])("recusa %j", (b) => expect(validarBranch(b).ok).toBe(false));
});
