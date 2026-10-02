import { describe, expect, it } from "vitest";
import { criarServicoCliUsuario, previaCliUsuario } from "./cli-usuario";
import { criarRepoMemoria } from "./repositorio";
import type { Executor, PedidoExec } from "./executor";
import { carregarCatalogo } from "./catalogo";
import { catalogoFalso, SEED } from "../../../tests/fixtures/mcp-loja/apoio-ciclo";

const cat = catalogoFalso();
const real = carregarCatalogo(SEED);
const ctx = { userData: "/dados/app", plataforma: "darwin" as const, node: "/usr/bin/node" };

function executorRegistrador(codigo = 0): Executor & { chamadas: PedidoExec[] } {
  const chamadas: PedidoExec[] = [];
  return { chamadas, rodar: async (p) => { chamadas.push(p); return { codigo, saida: "", erro: "", timeout: false, abortado: false, excedeu_saida: false, nao_iniciou: false }; } };
}

describe("prévia do comando na CLI do usuário", () => {
  it("Claude stdio e remoto; Codex; Gemini: argv separado, escopo user, nome ev_*", () => {
    const e = cat.porId.get("falso-ok")!.entrada;
    const r = cat.porId.get("falso-remoto")!.entrada;
    const claude = previaCliUsuario(e, "claude", ctx);
    expect(claude).toMatchObject({ ok: true });
    if (!claude.ok) return;
    expect(claude.previa.argv.slice(0, 8)).toEqual(["claude", "mcp", "add", "--scope", "user", "--transport", "stdio", "ev_falso_ok"]);
    expect(claude.previa.argv[8]).toBe("--");
    expect(claude.previa.argv.slice(9)).toEqual(["/usr/bin/node", "/dados/app/mcp/falso-ok/node_modules/.bin/servidor.mjs"]);
    const rc = previaCliUsuario(r, "claude", ctx);
    expect(rc.ok && rc.previa.argv).toEqual(["claude", "mcp", "add", "--scope", "user", "--transport", "http", "ev_falso_remoto", expect.stringMatching(/^https:/)]);
    const codex = previaCliUsuario(e, "codex", ctx);
    expect(codex.ok && codex.previa.argv.slice(0, 5)).toEqual(["codex", "mcp", "add", "ev_falso_ok", "--"]);
    const gemini = previaCliUsuario(e, "gemini", ctx);
    expect(gemini.ok && gemini.previa.argv.slice(0, 6)).toEqual(["gemini", "mcp", "add", "-s", "user", "ev_falso_ok"]);
  });

  it("OpenCode: sem comando não interativo, orientação em vez de execução", () => {
    expect(previaCliUsuario(cat.porId.get("falso-ok")!.entrada, "opencode", ctx)).toMatchObject({ ok: false, codigo: "cli_sem_suporte" });
  });

  it("servidor que recebe a chave por argumento é recusado; variável secreta vira aviso e NUNCA entra no argv", () => {
    expect(previaCliUsuario(real.porId.get("stripe-npm")!.entrada, "claude", ctx)).toMatchObject({ ok: false, codigo: "exige_segredo_em_args" });
    const p = previaCliUsuario(real.porId.get("context7")!.entrada, "claude", ctx);
    expect(p.ok && p.previa.avisos.join(" ")).toMatch(/Defina CONTEXT7_API_KEY no seu próprio ambiente/);
    expect(p.ok && p.previa.argv.join(" ")).not.toMatch(/CONTEXT7_API_KEY|--api-key/);
  });
});

describe("serviço: confirmação digitada e remoção só do que o app criou", () => {
  const e = cat.porId.get("falso-ok")!.entrada;
  const previa = (): NonNullable<ReturnType<typeof previaCliUsuario> & { ok: true }>["previa"] => { const r = previaCliUsuario(e, "claude", ctx); if (!r.ok) throw new Error("x"); return r.previa; };

  it("sem a confirmação exata NADA roda; com ela roda uma vez, sem shell, e registra", async () => {
    const repo = criarRepoMemoria();
    const ex = executorRegistrador();
    const svc = criarServicoCliUsuario({ repo, executor: ex, localizar: (n) => `/bin/${n}`, ambiente: () => ({ HOME: "/h", PATH: "/bin" }), agora: () => "t" });
    for (const errada of ["", "sim", "EV_FALSO_OK", "ev_falso_ok "]) expect(await svc.instalar(e, previa(), errada)).toMatchObject({ ok: false, codigo: "confirmacao_invalida" });
    expect(ex.chamadas).toHaveLength(0);
    expect(await svc.instalar(e, previa(), "ev_falso_ok")).toEqual({ ok: true });
    expect(ex.chamadas).toHaveLength(1);
    expect(ex.chamadas[0]!.exe).toBe("/bin/claude");
    expect(ex.chamadas[0]!.args.slice(0, 3)).toEqual(["mcp", "add", "--scope"]);
    expect(repo.cliInstalacoesDe("falso-ok")).toEqual([{ servidor_id: "falso-ok", cli: "claude", nome_na_cli: "ev_falso_ok", escopo: "user", criado_em: "t" }]);
  });

  it("CLI ausente ou falha do comando: nada registrado", async () => {
    const repo = criarRepoMemoria();
    const sem = criarServicoCliUsuario({ repo, executor: executorRegistrador(), localizar: () => null });
    expect(await sem.instalar(e, previa(), "ev_falso_ok")).toMatchObject({ ok: false, codigo: "cli_nao_encontrada" });
    const falha = criarServicoCliUsuario({ repo, executor: executorRegistrador(1), localizar: (n) => n });
    expect(await falha.instalar(e, previa(), "ev_falso_ok")).toMatchObject({ ok: false, codigo: "falha" });
    expect(repo.cliInstalacoesDe("falso-ok")).toEqual([]);
  });

  it("remover só mexe no que está registrado com prefixo ev_ (nome diferente é recusado, nada executa)", async () => {
    const repo = criarRepoMemoria();
    const ex = executorRegistrador();
    const svc = criarServicoCliUsuario({ repo, executor: ex, localizar: (n) => n });
    expect(await svc.remover("falso-ok", "claude")).toMatchObject({ ok: false, codigo: "nao_criado_pelo_app" });
    repo.cliInstalacaoGravar({ servidor_id: "falso-ok", cli: "claude", nome_na_cli: "meu-servidor-pessoal", escopo: "user", criado_em: "t" });
    expect(await svc.remover("falso-ok", "claude")).toMatchObject({ ok: false, codigo: "nao_criado_pelo_app" });
    expect(ex.chamadas).toHaveLength(0);
    repo.cliInstalacaoGravar({ servidor_id: "falso-ok", cli: "claude", nome_na_cli: "ev_falso_ok", escopo: "user", criado_em: "t" });
    expect(await svc.remover("falso-ok", "claude")).toEqual({ ok: true });
    expect(ex.chamadas[0]!.args).toEqual(["mcp", "remove", "--scope", "user", "ev_falso_ok"]);
    expect(repo.cliInstalacoesDe("falso-ok")).toEqual([]);
  });
});
