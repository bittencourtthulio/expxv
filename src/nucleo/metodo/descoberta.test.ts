import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { criarTmp, limparTmps } from "../../../tests/fixtures/metodo/util";
import { gerarProjetoExpx } from "../../../tests/fixtures/metodo/gerar";
import { descobrir, type Descoberta } from "./descoberta";

afterEach(() => undefined);

describe("descobrir", () => {
  let d: Descoberta;
  let raiz: string;
  beforeAll(async () => {
    raiz = criarTmp();
    gerarProjetoExpx(raiz);
    d = await descobrir(raiz);
    return () => limparTmps();
  });

  const pastas = (layout: string): string[] => d.trabalhos.filter((t) => t.layout === layout).map((t) => t.pasta).sort();

  it("acha os trabalhos sprintx em docs/sprintx/features/*", () => {
    expect(pastas("sprintx_features")).toEqual(
      ["cobranca-pix", "exportar-csv", "feature-truncada", "fundacao-autenticacao", "plano-quebrado", "relatorio-vendas", "so-base"].map((s) => `docs/sprintx/features/${s}`),
    );
  });

  it("acha o legado em docs/<slug>/ e não confunde pastas reservadas", () => {
    expect(pastas("legado")).toEqual(["docs/agenda-online"]);
  });

  it("acha ocorrências runx em docs/manutencao/* e pedidos prodx em docs/produto/pedidos/*", () => {
    expect(pastas("manutencao")).toHaveLength(4);
    expect(pastas("pedido")).toEqual(["docs/produto/pedidos/PD-2026-0007-exportar-pdf", "docs/produto/pedidos/PD-2026-0008-tema-escuro"]);
  });

  it("ignora node_modules, dist e nomes fora da lista", () => {
    const todos = d.trabalhos.flatMap((t) => t.arquivos).concat(d.projeto, d.camadas, d.relatorios);
    expect(todos.some((a) => a.includes("node_modules") || a.includes("/dist/"))).toBe(false);
    expect(todos.some((a) => a.endsWith(".rascunho"))).toBe(false);
    expect(d.trabalhos.some((t) => t.pasta.includes("node_modules") || t.pasta.endsWith("/dist"))).toBe(false);
  });

  it("lista arquivos por NOME e guarda as subpastas de primeiro nível", () => {
    const cp = d.trabalhos.find((t) => t.pasta.endsWith("/cobranca-pix"));
    expect(cp?.diretorios.sort()).toEqual(["base", "sprint-01", "sprint-02"]);
    expect(cp?.arquivos).toEqual(
      expect.arrayContaining([
        "docs/sprintx/features/cobranca-pix/ORQUESTRADOR.md",
        "docs/sprintx/features/cobranca-pix/00-AUDITORIA.md",
        "docs/sprintx/features/cobranca-pix/sprint-01/tasks.md",
        "docs/sprintx/features/cobranca-pix/sprint-02/tasks.md",
        "docs/sprintx/features/cobranca-pix/base/00-INDICE.md",
      ]),
    );
    // base/pagamentos.md e 00-LACUNAS.md não estão na lista de nomes
    expect(cp?.arquivos.some((a) => a.endsWith("pagamentos.md") || a.endsWith("00-LACUNAS.md"))).toBe(false);
  });

  it("00-INDICE.md só vale dentro de base/", async () => {
    const r = criarTmp();
    mkdirSync(join(r, "docs/sprintx/features/a/base"), { recursive: true });
    writeFileSync(join(r, "docs/sprintx/features/a/00-INDICE.md"), "x");
    writeFileSync(join(r, "docs/sprintx/features/a/base/00-INDICE.md"), "x");
    const dd = await descobrir(r);
    expect(dd.trabalhos[0]?.arquivos).toEqual(["docs/sprintx/features/a/base/00-INDICE.md"]);
  });

  it("agrega projeto, entregas, relatórios, eventos, camadas e configuração", () => {
    expect(d.projeto.sort()).toEqual(["docs/projeto/MAPA.md", "docs/projeto/PREMISSAS.md", "docs/projeto/PROJETO.md", "docs/projeto/VEREDITO.md"]);
    expect(d.entregas).toEqual([{ id: "OC-2026-0142-frete-errado", arquivos: ["docs/entregas/OC-2026-0142-frete-errado/ENTREGA.md"] }]);
    expect(d.relatorios).toEqual(expect.arrayContaining(["docs/relatorios/INDICE.md"]));
    expect(d.relatorios.filter((r) => r.endsWith("tecnico.md") || r.endsWith("uso.md"))).toHaveLength(2);
    expect(d.eventos.sort()).toEqual(["docs/eventos/cobranca-pix.1.jsonl", "docs/eventos/cobranca-pix.jsonl"]);
    expect(d.camadas).toEqual(
      expect.arrayContaining(["docs/stack/CONVENCOES.md", "docs/legado/PERFIL.md", "docs/legado/raio/exportar-csv.md", "docs/design-system/DESIGN-SYSTEM.md", "docs/produto/PRODUTO.md", "docs/produto/INDICE.md"]),
    );
    expect(d.config).toEqual({ hooks: true, lock: true, memoria: true });
  });

  it("projeto sem docs/ devolve descoberta vazia sem lançar", async () => {
    const r = criarTmp();
    const dd = await descobrir(r);
    expect(dd.trabalhos).toEqual([]);
    expect(dd.config).toEqual({ hooks: false, lock: false, memoria: false });
    expect((await descobrir("/nao/existe/mesmo")).trabalhos).toEqual([]);
  });
});
