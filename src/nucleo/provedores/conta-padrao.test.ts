// Conta padrão (login existente): tabelas de instalado x login x desabilitada, idempotência, ambiente e fronteira de leitura.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { criarTmp, detectorFalso, ferramenta, limpar, novoBanco } from "../../../tests/fixtures/dominio/ambiente";
import { criarServicoContas } from "./contas";
import { criarServicoProvedores } from "./servico";

// espiões de LEITURA de conteúdo: o módulo é trocado por um que conta as chamadas (escrita/stat seguem reais)
const leituras = vi.hoisted(() => ({ n: 0 }));
vi.mock("node:fs", async (orig) => {
  const real = await orig<typeof import("node:fs")>();
  const conta = <F extends (...a: never[]) => unknown>(f: F): F => ((...a: never[]) => { leituras.n++; return f(...a); }) as F;
  return { ...real, default: real, readFileSync: conta(real.readFileSync as never), openSync: conta(real.openSync as never), readSync: conta(real.readSync as never) };
});

vi.mock("node:fs/promises", async (orig) => {
  const real = await orig<typeof import("node:fs/promises")>();
  const conta = <F extends (...a: never[]) => unknown>(f: F): F => ((...a: never[]) => { leituras.n++; return f(...a); }) as F;
  return { ...real, default: real, readFile: conta(real.readFile as never), open: conta(real.open as never) };
});

afterEach(() => {
  vi.restoreAllMocks();
  limpar();
});

function montar(opc: { claude?: boolean; codex?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const { banco, repos } = novoBanco();
  const casa = criarTmp("casa-");
  const dados = criarTmp("dados-");
  const contas = criarServicoContas({ banco, repos, pastaDeDados: dados, casa, env: opc.env ?? {} });
  const criadas: number[] = [];
  const det = detectorFalso([ferramenta("claude", opc.claude ?? true), ferramenta("codex", opc.codex ?? true), ferramenta("terminal")]);
  const servico = criarServicoProvedores({ detector: det as never, contas, aoContasCriadas: (c) => criadas.push(c.length) });
  return { contas, servico, casa, criadas, repos };
}
const arquivo = (casa: string, rel: string): void => {
  mkdirSync(join(casa, rel, ".."), { recursive: true });
  writeFileSync(join(casa, rel), "{}");
};

describe("conta padrão (login existente)", () => {
  const tabela: Array<{ nome: string; claude: boolean; login: string[]; esperado: "autenticada" | "nao_autenticada" | null }> = [
    { nome: "instalado + logado", claude: true, login: [".claude/.credentials.json"], esperado: "autenticada" },
    { nome: "instalado + só histórico de uso", claude: true, login: [".claude/history.jsonl"], esperado: "autenticada" },
    { nome: "instalado sem login", claude: true, login: [], esperado: "nao_autenticada" },
    { nome: "não instalado", claude: false, login: [".claude/.credentials.json"], esperado: null },
  ];
  for (const t of tabela) {
    it(`claude: ${t.nome}`, async () => {
      const { servico, casa, contas } = montar({ claude: t.claude, codex: false });
      for (const l of t.login) arquivo(casa, l);
      const lista = await servico.listar(false);
      const claude = lista.find((p) => p.ferramenta.id === "claude");
      if (t.esperado === null) {
        expect(claude?.contas).toEqual([]);
        expect(contas.listar()).toEqual([]);
        return;
      }
      expect(claude?.contas).toHaveLength(1);
      const c = claude?.contas[0];
      expect(c).toMatchObject({ rotulo: "Conta padrão", config_dir_ref: null, habilitada: true });
      expect(claude?.login_contas?.[c?.id ?? ""]).toBe(t.esperado);
    });
  }

  it("codex: auth.json (só stat) ou sessions contam como login; sem nada é não autenticada", async () => {
    const a = montar({ claude: false });
    arquivo(a.casa, ".codex/auth.json");
    expect((await a.servico.listar(false)).find((p) => p.ferramenta.id === "codex")?.login_contas).toEqual({ [a.contas.listar()[0]!.id]: "autenticada" });
    const b = montar({ claude: false });
    mkdirSync(join(b.casa, ".codex", "sessions"), { recursive: true });
    expect(b.contas.loginDaConta({ provedor: "codex", config_dir_ref: null })).toBe("autenticada");
    const c = montar({ claude: false });
    expect(c.contas.loginDaConta({ provedor: "codex", config_dir_ref: null })).toBe("nao_autenticada");
  });

  it("idempotente em 3 chamadas; evento só na criação", async () => {
    const { servico, contas, criadas } = montar();
    await servico.listar(false);
    await servico.listar(true);
    await servico.providerList();
    expect(contas.listar().map((c) => c.provedor).sort()).toEqual(["claude", "codex"]);
    expect(criadas).toEqual([2]);
  });

  it("desabilitada pelo usuário não é recriada nem reabilitada; renomear também não duplica", async () => {
    const { servico, contas, repos } = montar();
    await servico.listar(false);
    const c = contas.listar().find((x) => x.provedor === "claude")!;
    contas.habilitar(c.id, false);
    repos.conta.renomear(c.id, "Minha");
    await servico.listar(false);
    await servico.providerList();
    const todas = contas.listar().filter((x) => x.provedor === "claude");
    expect(todas).toHaveLength(1);
    expect(todas[0]?.habilitada).toBe(false);
  });

  it("contas isoladas já existentes ficam como estão; a padrão convive com elas", async () => {
    const { servico, contas } = montar({ codex: false });
    const iso = contas.criar("claude", "Pessoal");
    await servico.listar(false);
    const lista = contas.listar().filter((c) => c.provedor === "claude");
    expect(lista).toHaveLength(2);
    expect(lista.find((c) => c.id === iso.id)?.config_dir_ref).toBe(`contas/${iso.id}`);
    expect(contas.loginDaConta(iso)).toBe("nao_aplicavel");
  });

  it("ambiente da sessão: padrão = {} (sem variável de config); isolada = a variável", async () => {
    const { servico, contas } = montar({ env: { CODEX_HOME: "/opt/meu-codex" } });
    await servico.listar(false);
    const pad = contas.listar().find((c) => c.provedor === "codex")!;
    expect(contas.ambienteDaConta(pad)).toEqual({});
    expect(contas.ambienteDaConta(contas.listar().find((c) => c.provedor === "claude")!)).toEqual({});
    expect(contas.ambienteDaConta(contas.criar("codex", "Isolada"))).toHaveProperty("CODEX_HOME");
    // a pasta efetiva (só leitura de uso) respeita o ambiente do usuário
    expect(contas.configDirEfetivo(pad)).toBe("/opt/meu-codex");
  });

  it("pasta efetiva padrão = ~/.codex e ~/.claude; relativa/inválida na variável é ignorada", () => {
    const { contas, casa } = montar({ env: { CODEX_HOME: "relativo" } });
    expect(contas.configDirEfetivo({ provedor: "codex", config_dir_ref: null })).toBe(join(casa, ".codex"));
    expect(contas.configDirEfetivo({ provedor: "claude", config_dir_ref: null })).toBe(join(casa, ".claude"));
    expect(contas.configDirEfetivo({ provedor: "gemini", config_dir_ref: null })).toBeNull();
  });

  it("provider_list: padrão não autenticada fica fora do roteamento sem desabilitar o provedor; autenticada entra", async () => {
    const a = montar({ codex: false });
    const sem = (await a.servico.providerList()).find((p) => p.provider === "claude");
    expect(sem).toMatchObject({ accounts: [], enabled: true });
    arquivo(a.casa, ".claude/.credentials.json");
    const com = (await a.servico.providerList()).find((p) => p.provider === "claude");
    expect(com?.accounts.map((c) => c.label)).toEqual(["Conta padrão"]);
  });

  it("fronteira: nenhum read de conteúdo de credencial/ambiente", async () => {
    const { servico, casa } = montar();
    arquivo(casa, ".codex/auth.json");
    arquivo(casa, ".claude/.credentials.json");
    leituras.n = 0;
    await servico.listar(false);
    await servico.providerList();
    expect(leituras.n).toBe(0);
  });
});

describe("conta padrão do Grok (D-442): sinal por stat de ~/.grok/auth.json", () => {
  function montarGrok(env: NodeJS.ProcessEnv = {}) {
    const { banco, repos } = novoBanco();
    const casa = criarTmp("casa-");
    const contas = criarServicoContas({ banco, repos, pastaDeDados: criarTmp("dados-"), casa, env });
    const servico = criarServicoProvedores({ detector: detectorFalso([ferramenta("grok", true, "1.0.46"), ferramenta("terminal")]) as never, contas });
    return { contas, servico, casa };
  }

  it("instalado: nasce habilitada ('Conta padrão'); sem auth.json = não autenticada; com auth.json = autenticada", async () => {
    const a = montarGrok();
    const lista = await a.servico.listar(false);
    const g = lista.find((p) => p.ferramenta.id === "grok");
    expect(g?.ferramenta).toMatchObject({ instalado: true, versao: "1.0.46" });
    expect(g?.contas).toHaveLength(1);
    expect(g?.contas[0]).toMatchObject({ rotulo: "Conta padrão", config_dir_ref: null, habilitada: true });
    expect(g?.login_contas?.[g.contas[0]!.id]).toBe("nao_autenticada");
    arquivo(a.casa, ".grok/auth.json");
    expect(a.contas.loginDaConta({ provedor: "grok", config_dir_ref: null })).toBe("autenticada");
  });

  it("só sessões antigas (sem auth.json, ex.: após `grok logout`) não contam como login", () => {
    const a = montarGrok();
    mkdirSync(join(a.casa, ".grok", "sessions"), { recursive: true });
    expect(a.contas.loginDaConta({ provedor: "grok", config_dir_ref: null })).toBe("nao_autenticada");
  });

  it("GROK_HOME absoluto do usuário muda a pasta efetiva; a sessão não recebe variável nenhuma da conta padrão", () => {
    const a = montarGrok({ GROK_HOME: "/opt/meu-grok" });
    const padrao = { provedor: "grok", config_dir_ref: null };
    expect(a.contas.configDirEfetivo(padrao)).toBe("/opt/meu-grok");
    expect(a.contas.ambienteDaConta(padrao)).toEqual({});
    const b = montarGrok();
    expect(b.contas.configDirEfetivo(padrao)).toBe(join(b.casa, ".grok"));
  });

  it("fronteira: nenhum read de conteúdo de auth.json", async () => {
    const { servico, casa } = montarGrok();
    arquivo(casa, ".grok/auth.json");
    leituras.n = 0;
    await servico.listar(false);
    await servico.providerList();
    expect(leituras.n).toBe(0);
  });
});
