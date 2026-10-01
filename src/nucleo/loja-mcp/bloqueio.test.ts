import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analisarNome, bloqueioFechado, carregarBloqueio, criarBloqueio, distanciaEdicao, ErroBloqueio, nomesConhecidos } from "./bloqueio";
import { carregarCatalogo } from "./catalogo";
import type { EntradaMcp } from "./esquema";

const RES = join(__dirname, "..", "..", "..", "resources", "mcp");
const cat = carregarCatalogo(join(RES, "catalogo-mcps.json"));
const entrada = (id: string): EntradaMcp => cat.porId.get(id)!.entrada as EntradaMcp;
const regra = (extra: object): unknown => ({ schema_version: 1, regras: [{ motivo: "comprometido", desde: "2026-10-01", ...extra }] });

describe("lista de bloqueio", () => {
  it("o arquivo embarcado carrega, é válido e vazio", () => {
    const b = carregarBloqueio(join(RES, "bloqueio.json"));
    expect(b.regras).toEqual([]);
    expect(b.consultarEntrada(entrada("context7"))).toBeNull();
  });

  it("bloqueia por id, por pacote e por versão exata", () => {
    const ctx7 = entrada("context7");
    const porId = criarBloqueio(regra({ id: "context7" }));
    expect(porId.consultarEntrada(ctx7)?.codigo).toBe("bloqueado");
    expect(porId.consultarEntrada(entrada("deepwiki"))).toBeNull();
    const porPacote = criarBloqueio(regra({ pacote: "@Upstash/Context7-MCP" }));
    expect(porPacote.consultarEntrada(ctx7)?.motivo).toBe("comprometido");
    const versaoCerta = criarBloqueio(regra({ pacote: "@upstash/context7-mcp", versoes: [ctx7.instalacao.versao!] }));
    expect(versaoCerta.consultarEntrada(ctx7)).not.toBeNull();
    const versaoOutra = criarBloqueio(regra({ pacote: "@upstash/context7-mcp", versoes: ["0.0.1"] }));
    expect(versaoOutra.consultarEntrada(ctx7)).toBeNull();
    expect(versaoOutra.consultarPacote("@upstash/context7-mcp", "0.0.1")).not.toBeNull();
    expect(versaoOutra.consultarPacote("@upstash/context7-mcp", null)).toBeNull();
    expect(criarBloqueio(regra({ pacote: "x", versoes: ["*"] })).consultarPacote("x", "9.9.9")).not.toBeNull();
  });

  it("entrada descartada pelo catálogo é sempre bloqueada, mesmo com a lista vazia", () => {
    const b = criarBloqueio({ schema_version: 1, regras: [] });
    const descartada = cat.entradas.find((x) => x.entrada.classificacao === "descartado")!.entrada as EntradaMcp;
    expect(b.consultarEntrada(descartada)?.codigo).toBe("descartado");
  });

  it("malformado lança ErroBloqueio: campo desconhecido, sem id/pacote, sem motivo, data ruim, versão ruim", () => {
    const ruins: unknown[] = [
      null, [], { schema_version: 2, regras: [] }, { schema_version: 1 }, { schema_version: 1, regras: [], extra: 1 },
      regra({}), regra({ id: "x", motivo: "" }), regra({ id: "x", desde: "ontem" }), regra({ id: "x", versoes: ["latest"] }),
      regra({ id: "x", executar: 1 }), regra({ id: "" }), { schema_version: 1, regras: ["texto"] },
    ];
    for (const r of ruins) expect(() => criarBloqueio(r)).toThrow(ErroBloqueio);
  });

  it("falha fechada: arquivo ausente, não-JSON ou malformado bloqueia TUDO", () => {
    const dir = mkdtempSync(join(tmpdir(), "bloq-"));
    writeFileSync(join(dir, "ruim.json"), "{ nao json");
    writeFileSync(join(dir, "malformado.json"), JSON.stringify({ schema_version: 1, regras: [{ motivo: "x" }] }));
    for (const arq of ["nao-existe.json", "ruim.json", "malformado.json"]) {
      const b = carregarBloqueio(join(dir, arq));
      expect(b.consultarEntrada(entrada("context7"))?.codigo).toBe("bloqueio_ilegivel");
      expect(b.consultarEntrada(entrada("deepwiki"))?.codigo).toBe("bloqueio_ilegivel");
      expect(b.consultarPacote("qualquer")?.codigo).toBe("bloqueio_ilegivel");
    }
    expect(bloqueioFechado().consultarId("x")?.codigo).toBe("bloqueio_ilegivel");
  });
});

describe("nomes suspeitos (typosquatting)", () => {
  const conhecidos = nomesConhecidos(cat);

  it("distância de edição (inclui transposição)", () => {
    expect(distanciaEdicao("context7", "context7")).toBe(0);
    expect(distanciaEdicao("context7", "contxt7")).toBe(1);
    expect(distanciaEdicao("context7", "cnotext7")).toBe(1);
    expect(distanciaEdicao("abc", "")).toBe(3);
    expect(distanciaEdicao("kitten", "sitting")).toBe(3);
  });

  it("nomes do próprio catálogo nunca são suspeitos", () => {
    for (const n of conhecidos) expect(analisarNome(n, conhecidos).suspeito, n).toBe(false);
  });

  it("letra a menos, trocada ou a mais perto de um conhecido ⇒ suspeito apontando o original", () => {
    for (const nome of ["@upstash/contxt7-mcp", "@upstash/context7-mpc", "@upstash/context77-mcp", "@modelcontextprotocol/server-filesytem"]) {
      const r = analisarNome(nome, conhecidos);
      expect(r.suspeito, nome).toBe(true);
      expect(r.parecido_com, nome).not.toBeNull();
    }
    expect(analisarNome("@upstash/contxt7-mcp", conhecidos).parecido_com).toBe("@upstash/context7-mcp");
  });

  it("mesmo nome em outro escopo (ou sem escopo) ⇒ escopo_diferente", () => {
    expect(analisarNome("@evil/context7-mcp", conhecidos)).toMatchObject({ suspeito: true, motivo: "escopo_diferente", parecido_com: "@upstash/context7-mcp" });
    expect(analisarNome("context7-mcp", conhecidos).motivo).toBe("escopo_diferente");
  });

  it("confundíveis visuais (0/o, 1/l, rn/m) ⇒ homoglifo", () => {
    expect(analisarNome("@upstash/cOntext7-mcp".toLowerCase().replace("o", "0"), conhecidos).suspeito).toBe(true);
    expect(analisarNome("rnemory", ["memory"]).motivo).toBe("homoglifo");
    expect(analisarNome("tavi1y-mcp", ["tavily-mcp"]).motivo).toBe("homoglifo");
  });

  it("nome sem relação, curto demais ou vazio não é suspeito", () => {
    expect(analisarNome("left-pad", conhecidos).suspeito).toBe(false);
    expect(analisarNome("minha-ferramenta-interna", conhecidos).suspeito).toBe(false);
    expect(analisarNome("", conhecidos).suspeito).toBe(false);
    expect(analisarNome("gix", ["git"]).suspeito).toBe(false);
  });
});
