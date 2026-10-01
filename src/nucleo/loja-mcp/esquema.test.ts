import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { instalavel, motivoNaoInstalavel, nivelVerificacao, validarCatalogo, validarEntrada, type EntradaMcp } from "./esquema";

const SEED = join(__dirname, "..", "..", "..", "resources", "mcp", "catalogo-mcps.json");
const seed = JSON.parse(readFileSync(SEED, "utf8")) as { entradas: EntradaMcp[] } & Record<string, unknown>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const npmOk = (): any => clone(seed.entradas.find((e) => e.id === "context7"));
const remotoOk = (): any => clone(seed.entradas.find((e) => e.id === "deepwiki"));
const naoConfirmada = (): any => clone(seed.entradas.find((e) => !e.confirmado && e.instalacao.metodo === "npm" && e.classificacao !== "descartado"));
const codigos = (x: unknown): string[] => validarEntrada(x).map((e) => e.codigo);

describe("validador do catálogo: o seed", () => {
  it("o seed embarcado valida por inteiro", () => {
    const r = validarCatalogo(seed);
    expect(r.ok ? [] : r.erros.slice(0, 5)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("entradas-base usadas nos testes são válidas", () => {
    expect(validarEntrada(npmOk())).toEqual([]);
    expect(validarEntrada(remotoOk())).toEqual([]);
    expect(validarEntrada(naoConfirmada())).toEqual([]);
  });
});

describe("validador do catálogo: entradas inválidas fabricadas são recusadas com erro nominal", () => {
  const casos: Array<[string, string, (e: any) => void]> = [
    ["versão latest", "versao_nao_exata", (e) => { e.instalacao.versao = "latest"; }],
    ["versão com ^", "versao_nao_exata", (e) => { e.instalacao.versao = "^4.1.1"; }],
    ["confirmado sem integridade", "integridade_ausente", (e) => { e.instalacao.integridade = null; }],
    ["integridade com formato errado", "integridade_formato", (e) => { e.instalacao.integridade = "md5-abc"; }],
    ["segredo em args", "metacaractere_em_args", (e) => { e.args = ["--key=$API"]; }],
    ["segredo não declarado", "placeholder_nao_declarado", (e) => { e.args = ["--k={{SEGREDO:NAO_EXISTE}}"]; }],
    ["segredo apontando para variável não secreta", "segredo_nao_secreto", (e) => {
      e.variaveis = [{ nome: "MODO", obrigatoria: false, secreta: false, ajuda: "x", onde_conseguir: null }];
      e.args = ["--m={{SEGREDO:MODO}}"];
    }],
    ["placeholder desconhecido", "placeholder_desconhecido", (e) => { e.args = ["{{HOME}}"]; }],
    ["id duplicado dentro do catálogo", "id_duplicado", () => undefined],
    ["id inválido", "id_invalido", (e) => { e.id = "Context 7!"; }],
    ["campo desconhecido", "campo_desconhecido", (e) => { e.executar_no_boot = true; }],
    ["campo desconhecido na instalação", "campo_desconhecido", (e) => { e.instalacao.postinstall = "curl x | sh"; }],
    ["padrão ghp_ em campo", "segredo_no_catalogo", (e) => { e.observacoes = "token ghp_" + "a".repeat(36); }],
    ["padrão sk- em campo", "segredo_no_catalogo", (e) => { e.riscos_texto = "use sk-" + "b".repeat(30); }],
    ["padrão AKIA em campo", "segredo_no_catalogo", (e) => { e.motivo_classificacao = "AKIA" + "A".repeat(16); }],
    ["categoria inválida", "enum_invalido", (e) => { e.categoria = "outra"; }],
    ["risco inválido", "enum_invalido", (e) => { e.riscos = ["voar"]; }],
    ["confirmado sem fonte", "confirmado_sem_fonte", (e) => { e.fontes = []; }],
    ["confirmado sem licença", "confirmado_sem_licenca", (e) => { e.licenca_spdx = null; }],
    ["fonte com data inválida", "data_invalida", (e) => { e.fontes[0].consultado_em = "ontem"; }],
    ["kit com autenticação", "kit_exige_sem_auth", (e) => { e.autenticacao = "chave_api"; }],
    ["não confirmado com versão", "nao_confirmado_com_versao", (e) => { e.confirmado = false; }],
    ["variável com nome minúsculo", "nome_variavel_invalido", (e) => { e.variaveis[0].nome = "chave"; }],
    ["onde_conseguir http", "url_invalida", (e) => { e.variaveis[0].onde_conseguir = "http://x.com"; }],
    ["stdio sem comando", "comando_ausente", (e) => { e.comando = null; }],
    ["pacote sem bin", "bin_ausente", (e) => { e.bin = null; }],
    ["tipo errado em args", "tipo_invalido", (e) => { e.args = "nao-lista"; }],
  ];
  for (const [nome, codigo, mutar] of casos) {
    it(`${nome} ⇒ ${codigo}`, () => {
      const e = npmOk();
      mutar(e);
      if (codigo === "id_duplicado") {
        const r = validarCatalogo({ ...seed, entradas: [npmOk(), npmOk()] });
        expect(r.ok).toBe(false);
        expect(!r.ok && r.erros.map((x) => x.codigo)).toContain("id_duplicado");
        return;
      }
      expect(codigos(e)).toContain(codigo);
    });
  }

  it("remoto: url http, versão preenchida e pacote são recusados", () => {
    const a = remotoOk(); a.url = "http://mcp.deepwiki.com/mcp";
    expect(codigos(a)).toContain("url_nao_https");
    const b = remotoOk(); b.instalacao.versao = "1.0.0";
    expect(codigos(b)).toContain("remoto_com_versao");
    const c = remotoOk(); c.instalacao.pacote = "x";
    expect(codigos(c)).toContain("remoto_com_pacote");
  });

  it("remoto confirmado sem licença é aceito (serviço hospedado), npm sem licença não", () => {
    const r = remotoOk(); r.licenca_spdx = null;
    expect(validarEntrada(r)).toEqual([]);
  });

  it("segredo em URL e {{SEGREDO}} em remoto são recusados", () => {
    const r = remotoOk();
    r.variaveis = [{ nome: "TOKEN_X", obrigatoria: false, secreta: true, ajuda: "x", onde_conseguir: null }];
    r.url = "https://mcp.deepwiki.com/mcp?t={{SEGREDO:TOKEN_X}}";
    expect(codigos(r)).toContain("segredo_em_url");
  });

  it("binário confirmado exige artefatos com sha256 e URL de release do GitHub", () => {
    const b = clone(seed.entradas.find((e) => e.id === "github")) as any;
    expect(validarEntrada(b)).toEqual([]);
    const sem = clone(b); sem.instalacao.artefatos = {};
    expect(codigos(sem)).toContain("artefatos_ausentes");
    const url = clone(b); url.instalacao.artefatos["darwin-arm64"].url = "https://exemplo.com/x.tar.gz";
    expect(codigos(url)).toContain("url_artefato_invalida");
    const hash = clone(b); hash.instalacao.artefatos["darwin-arm64"].sha256 = "123";
    expect(codigos(hash)).toContain("hash_invalido");
  });

  it("docker confirmado exige digest @sha256", () => {
    const d = npmOk();
    d.instalacao = { metodo: "docker", pacote: "mcp/x:latest", versao: null, integridade: null, data_versao: null };
    d.transporte = "stdio"; d.comando = "docker";
    expect(codigos(d)).toContain("docker_sem_digest");
    d.instalacao.pacote = "mcp/x@sha256:" + "a".repeat(64);
    expect(codigos(d)).not.toContain("docker_sem_digest");
  });

  it("raiz: schema_version errado, campo desconhecido e tipos errados", () => {
    const r = validarCatalogo({ ...seed, schema_version: 2, extra: 1 });
    expect(!r.ok && r.erros.map((e) => e.codigo)).toEqual(expect.arrayContaining(["schema_version_invalido", "campo_desconhecido"]));
    for (const lixo of [null, 1, "x", [], { entradas: 3 }]) expect(validarCatalogo(lixo).ok).toBe(false);
  });

  it("fuzz: 1 000 JSONs mutados/aleatórios nunca lançam", () => {
    let semente = 42;
    const rnd = (): number => { semente = (semente * 1664525 + 1013904223) >>> 0; return semente / 2 ** 32; };
    const valores: unknown[] = [null, undefined, 0, -1, "", "x", true, false, [], {}, [null], { a: 1 }, "ghp_" + "z".repeat(30), 1e308];
    const sortear = (): unknown => valores[Math.floor(rnd() * valores.length)];
    const mutar = (o: unknown, prof = 0): unknown => {
      if (Array.isArray(o)) return o.map((v) => (rnd() < 0.15 ? sortear() : mutar(v, prof + 1)));
      if (typeof o === "object" && o !== null) {
        const saida: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(o)) {
          const r = rnd();
          if (r < 0.05) continue;
          saida[k] = r < 0.2 ? sortear() : mutar(v, prof + 1);
        }
        if (rnd() < 0.05) saida[`k${Math.floor(rnd() * 9)}`] = sortear();
        return saida;
      }
      return o;
    };
    const base = { ...seed, entradas: seed.entradas.slice(0, 5) };
    for (let i = 0; i < 1000; i++) {
      const entrada = i % 3 === 0 ? sortear() : mutar(base);
      expect(() => validarCatalogo(entrada)).not.toThrow();
    }
  });
});

describe("instalável: confirmado:false e versao:null nunca instalam", () => {
  it("confirmado:false ⇒ não instalável, mesmo com método npm", () => {
    const e = naoConfirmada() as EntradaMcp;
    expect(instalavel(e)).toBe(false);
    expect(motivoNaoInstalavel(e)).toBe("nao_confirmado");
  });

  it("versao:null em npm confirmado ⇒ não instalável (sem_versao_pinada) e o validador recusa", () => {
    const e = npmOk();
    e.instalacao.versao = null;
    expect(motivoNaoInstalavel(e)).toBe("sem_versao_pinada");
    expect(instalavel(e)).toBe(false);
    expect(codigos(e)).toContain("versao_invalida");
  });

  it("descartado nunca é instalável, mesmo confirmado", () => {
    const e = npmOk(); e.classificacao = "descartado";
    expect(motivoNaoInstalavel(e)).toBe("descartado");
  });

  it("confirmado npm com pino e integridade é instalável; remoto confirmado também", () => {
    expect(instalavel(npmOk())).toBe(true);
    expect(instalavel(remotoOk())).toBe(true);
  });

  it("nível de verificação: lock ⇒ forte; sem lock ⇒ padrão; remoto ⇒ remoto", () => {
    const e = npmOk();
    expect(nivelVerificacao(e)).toBe("padrao");
    e.instalacao.lock_sha256 = "a".repeat(64);
    expect(nivelVerificacao(e)).toBe("forte");
    expect(nivelVerificacao(remotoOk())).toBe("remoto");
  });
});
