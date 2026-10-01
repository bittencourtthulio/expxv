import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { criarBloqueio } from "./bloqueio";
import { carregarCatalogo } from "./catalogo";
import type { EntradaMcp } from "./esquema";
import { hashDoComando, planejarInstalacao, type DiagnosticoMcp, type OpcoesPlano, type PlanoInstalacao } from "./plano";

const cat = carregarCatalogo(join(__dirname, "..", "..", "..", "resources", "mcp", "catalogo-mcps.json"));
const E = (id: string): EntradaMcp => JSON.parse(JSON.stringify(cat.porId.get(id)!.entrada)) as EntradaMcp;
const WS = mkdtempSync(join(tmpdir(), "ws-plano-"));
const opcoes: OpcoesPlano = { userData: "/dados/app", workspace: WS, plataforma: "darwin", node: "/usr/bin/node" };
const TUDO: DiagnosticoMcp = { npm: { ok: true, versao: "10.2.0" }, node: { ok: true, versao: "v20.11.0" }, uv: { ok: true, versao: "0.5.1" }, docker: { ok: true }, cofre: { disponivel: true } };

function plano(e: EntradaMcp, d: DiagnosticoMcp = TUDO, o: Partial<OpcoesPlano> = {}): PlanoInstalacao {
  const r = planejarInstalacao(e, d, { ...opcoes, ...o });
  if (!r.ok) throw new Error(`recusado: ${r.bloqueio.codigo}`);
  return r.plano;
}
const recusa = (e: EntradaMcp, d: DiagnosticoMcp = TUDO, o: Partial<OpcoesPlano> = {}): string => {
  const r = planejarInstalacao(e, d, { ...opcoes, ...o });
  return r.ok ? "aceito" : r.bloqueio.codigo;
};

describe("plano de instalação: o que acontece ao clicar", () => {
  it("cinco passos na ordem consentimento → instalar → variáveis → saúde → habilitar", () => {
    const p = plano(E("context7"));
    expect(p.passos.map((x) => x.id)).toEqual(["consentimento", "instalar", "variaveis", "saude", "habilitar"]);
    expect(p.passos[0]!.requer_clique).toBe(true);
    expect(p.passos[1]!.detalhe).toMatch(/sem sudo/);
    expect(p.passos[1]!.detalhe).toContain("/dados/app/mcp/context7");
    expect(p.passos[3]!.detalhe).toContain("3 s");
    expect(plano(E("deepwiki")).passos[2]!.aplicavel).toBe(false);
  });

  it("npm sem lock: npm install com pino exato, --ignore-scripts, pasta temporária isolada, sem global nem sudo", () => {
    const e = E("context7");
    const p = plano(e);
    const [acao] = p.acoes;
    expect(acao).toMatchObject({ tipo: "exec" });
    const argv = (acao as { argv: string[] }).argv;
    expect(argv.slice(0, 2)).toEqual(["npm", "install"]);
    expect(argv).toContain("--ignore-scripts");
    expect(argv).toContain(`@upstash/context7-mcp@${e.instalacao.versao}`);
    expect(argv).toContain("--save-exact");
    expect(argv).not.toContain("-g");
    expect(argv).not.toContain("--global");
    expect(argv.join(" ")).not.toMatch(/sudo|latest|npx|--force/);
    expect(argv[argv.indexOf("--prefix") + 1]).toBe("/dados/app/mcp/.tmp/context7-<ulid>");
    expect(p.comando_instalacao[0]).toContain("npm install");
    expect(p.nivel_verificacao).toBe("padrao");
  });

  it("com lock curado vira npm ci e nível forte, sem o aviso de transitivas", () => {
    const e = E("context7");
    e.instalacao.lock_sha256 = "b".repeat(64);
    const p = plano(e);
    expect((p.acoes[0] as { argv: string[] }).argv.slice(0, 2)).toEqual(["npm", "ci"]);
    expect(p.nivel_verificacao).toBe("forte");
    expect(p.avisos.map((a) => a.codigo)).not.toContain("transitivas_nao_travadas");
  });

  it("sem lock mostra o aviso 'dependências transitivas não travadas'", () => {
    const a = plano(E("context7")).avisos.find((x) => x.codigo === "transitivas_nao_travadas");
    expect(a?.texto).toMatch(/transitivas não travadas/);
  });

  it("scripts_permitidos aparece em destaque (nível alto) e desliga --ignore-scripts só para ele", () => {
    const e = E("context7");
    e.instalacao.scripts_permitidos = true;
    const p = plano(e);
    const alto = p.avisos.find((x) => x.codigo === "scripts_de_instalacao");
    expect(alto?.nivel).toBe("alto");
    expect(alto?.texto).toMatch(/postinstall/);
    expect((p.acoes[0] as { argv: string[] }).argv).not.toContain("--ignore-scripts");
    expect(p.permissoes.scripts_permitidos).toBe(true);
  });

  it("uvx: venv próprio e pip pinado; com lock usa --require-hashes", () => {
    const e = E("fetch");
    const p = plano(e);
    const argvs = p.acoes.map((a) => (a as { argv: string[] }).argv);
    expect(argvs[0]!.slice(0, 2)).toEqual(["uv", "venv"]);
    expect(argvs[1]!.join(" ")).toContain(`${e.instalacao.pacote}==${e.instalacao.versao}`);
    expect(argvs.flat().join(" ")).not.toMatch(/tool install|uvx|sudo/);
    e.instalacao.lock_sha256 = "c".repeat(64);
    expect((plano(e).acoes[1] as { argv: string[] }).argv).toContain("--require-hashes");
  });

  it("binário: download de release do GitHub com sha256; remoto: só registrar, sem download", () => {
    const b = plano(E("github"));
    expect(b.acoes[0]).toMatchObject({ tipo: "download" });
    expect((b.acoes[0] as { url: string }).url).toMatch(/^https:\/\/github\.com\/github\/github-mcp-server\/releases\/download\//);
    expect((b.acoes[0] as { sha256: string }).sha256).toMatch(/^[0-9a-f]{64}$/);
    const r = plano(E("deepwiki"));
    expect(r.acoes).toEqual([expect.objectContaining({ tipo: "registrar", url: "https://mcp.deepwiki.com/mcp" })]);
    expect(r.pasta).toBeNull();
    expect(r.nivel_verificacao).toBe("remoto");
    expect(r.passos[1]!.detalhe).toMatch(/Sem download/);
  });

  it("variáveis: secretas só pelo nome; nenhum valor em nenhum campo do plano", () => {
    const p = plano(E("redis-mcp"));
    const url = p.permissoes.variaveis.find((v) => v.nome === "REDIS_URL")!;
    expect(url).toMatchObject({ secreta: true });
    expect(p.comando_exato).toContain("<segredo:REDIS_URL>");
    expect(p.avisos.map((a) => a.codigo)).toContain("segredo_em_argumento");
  });

  it("comando_exato é exatamente o que o comando de execução mostra (UI = executor)", () => {
    const p = plano(E("filesystem"));
    expect(p.comando_exato).toBe(p.permissoes.comando_exato);
    expect(p.comando_exato).toContain(WS);
  });
});

describe("plano: recusas", () => {
  it("recusa confirmado:false, descartado, sem pino e catálogo adulterado", () => {
    const naoConf = cat.entradas.find((x) => !x.entrada.confirmado && x.entrada.classificacao !== "descartado")!.entrada as EntradaMcp;
    expect(recusa(naoConf)).toBe("nao_confirmado");
    const desc = cat.entradas.find((x) => x.entrada.classificacao === "descartado")!.entrada as EntradaMcp;
    expect(["descartado", "nao_confirmado"]).toContain(recusa(desc));
    const e = E("context7"); e.instalacao.versao = null;
    expect(recusa(e)).toBe("sem_versao_pinada");
    const f = E("context7"); f.instalacao.integridade = null;
    expect(recusa(f)).toBe("sem_integridade");
    expect(recusa(E("context7"), TUDO, { catalogoAdulterado: true })).toBe("catalogo_adulterado");
    const confDescartada = E("context7"); confDescartada.classificacao = "descartado";
    expect(recusa(confDescartada)).toBe("descartado");
  });

  it("lista de bloqueio recusa; bloqueio ilegível (fechado) recusa tudo", () => {
    const b = criarBloqueio({ schema_version: 1, regras: [{ id: "context7", motivo: "comprometido", desde: "2026-10-01" }] });
    expect(recusa(E("context7"), TUDO, { bloqueio: b })).toBe("bloqueado");
    expect(recusa(E("deepwiki"), TUDO, { bloqueio: b })).toBe("aceito");
  });

  it("pré-requisito ausente: instrução acionável em português", () => {
    const sem = planejarInstalacao(E("context7"), { cofre: { disponivel: true } }, opcoes);
    expect(sem.ok).toBe(false);
    if (!sem.ok) {
      expect(sem.bloqueio.codigo).toBe("prerequisito_ausente");
      expect(sem.bloqueio.acao).toMatch(/Instale o Node\.js/);
    }
    const semUv = planejarInstalacao(E("fetch"), { ...TUDO, uv: { ok: false } }, opcoes);
    expect(!semUv.ok && semUv.bloqueio.acao).toMatch(/uv/);
    expect(recusa(E("context7"), { ...TUDO, node: { ok: true, versao: "v16.20.0" } })).toBe("node_antigo");
    // remoto e binário não exigem runtime
    expect(recusa(E("deepwiki"), {})).toBe("aceito");
    expect(recusa(E("github"), {})).toBe("aceito");
  });

  it("comando inválido (workspace inexistente) vira recusa nominal, não exceção", () => {
    expect(recusa(E("filesystem"), TUDO, { workspace: "/nao/existe/mesmo", ehDiretorio: () => false })).toBe("comando_invalido");
  });
});

describe("avisos honestos (P-138, P-135)", () => {
  it("nunca promete 'grátis': plano grátis e custo não confirmado têm aviso para conferir o preço", () => {
    const grat = plano(E("context7")).avisos.find((a) => a.codigo === "plano_gratis");
    expect(grat?.texto).toMatch(/preço no site oficial/);
    expect(grat?.texto.toLowerCase()).not.toMatch(/\bgrátis para sempre|\bgarantid/);
    const nc = plano(E("linear-remoto")).avisos.map((a) => a.codigo);
    expect(nc).toContain("custo_nao_confirmado");
    expect(nc).toContain("oauth_pela_cli");
  });

  it("licença restritiva e cofre indisponível geram aviso", () => {
    const e = E("context7"); e.licenca_spdx = "GPL-3.0-or-later";
    expect(plano(e).avisos.map((a) => a.codigo)).toContain("licenca_restritiva");
    expect(plano(E("redis-mcp"), { ...TUDO, cofre: { disponivel: false } }).avisos.map((a) => a.codigo)).toContain("cofre_indisponivel");
    expect(plano(E("redis-mcp")).avisos.map((a) => a.codigo)).not.toContain("cofre_indisponivel");
  });

  it("risco alto (execução de código / escrita remota) tem aviso", () => {
    expect(plano(E("playwright-mcp")).avisos.map((a) => a.codigo)).toContain("risco_alto");
  });
});

describe("comando_hash", () => {
  it("é estável e independe de pasta, workspace e plataforma", () => {
    const a = plano(E("filesystem")).comando_hash;
    expect(plano(E("filesystem"), TUDO, { userData: "/outro/lugar" }).comando_hash).toBe(a);
    expect(plano(E("filesystem"), TUDO, { workspace: tmpdir() }).comando_hash).toBe(a);
    expect(hashDoComando(E("filesystem"))).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("muda se QUALQUER arg, versão, integridade, host, variável ou lock mudar", () => {
    const base = hashDoComando(E("sentry-stdio"));
    const mutacoes: Array<[string, (e: EntradaMcp) => void]> = [
      ["arg", (e) => { e.args = [...e.args, "--extra"]; }],
      ["versão", (e) => { e.instalacao.versao = "9.9.9"; }],
      ["integridade", (e) => { e.instalacao.integridade = `sha512-${"A".repeat(86)}==`; }],
      ["pacote", (e) => { e.instalacao.pacote = "@sentry/outro"; }],
      ["bin", (e) => { e.bin = "outro-bin"; }],
      ["variável", (e) => { e.variaveis = [...e.variaveis, { nome: "NOVA_VAR", obrigatoria: false, secreta: false, ajuda: "x", onde_conseguir: null }]; }],
      ["secreta→não", (e) => { e.variaveis[0]!.secreta = !e.variaveis[0]!.secreta; }],
      ["lock", (e) => { e.instalacao.lock_sha256 = "d".repeat(64); }],
      ["scripts", (e) => { e.instalacao.scripts_permitidos = true; }],
      ["comando", (e) => { e.comando = "outro"; }],
    ];
    for (const [nome, f] of mutacoes) {
      const e = E("sentry-stdio");
      f(e);
      expect(hashDoComando(e), nome).not.toBe(base);
    }
    const remoto = hashDoComando(E("deepwiki"));
    const outroHost = E("deepwiki"); outroHost.url = "https://mcp.outro-host.com/mcp";
    expect(hashDoComando(outroHost)).not.toBe(remoto);
    const bin = E("github"); const k = Object.keys(bin.instalacao.artefatos!)[0]!;
    const base2 = hashDoComando(bin);
    bin.instalacao.artefatos![k]!.url = "https://github.com/outro/repo/releases/download/v1/x.tar.gz";
    expect(hashDoComando(bin)).not.toBe(base2);
  });

  it("todas as entradas instaláveis do seed planejam sem exceção e com hashes únicos", () => {
    const hashes = new Set<string>();
    let n = 0;
    for (const x of cat.entradas) {
      if (!x.instalavel) continue;
      const r = planejarInstalacao(x.entrada as EntradaMcp, TUDO, { ...opcoes, variaveis: {} });
      expect(r.ok, x.entrada.id).toBe(true);
      if (r.ok) { hashes.add(r.plano.comando_hash); expect(r.plano.permissoes.comando_exato.length).toBeGreaterThan(0); }
      n++;
    }
    expect(hashes.size).toBe(n);
  });
});
