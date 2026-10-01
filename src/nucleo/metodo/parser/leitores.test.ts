import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { criarTmp, limparTmps } from "../../../../tests/fixtures/metodo/util";
import { gerarProjetoExpx, md } from "../../../../tests/fixtures/metodo/gerar";
import { KINDS_CONHECIDOS } from "./kinds";
import { LIMITE_BYTES, lerArtefato } from "./leitores";

afterEach(limparTmps);

function gravar(raiz: string, rel: string, conteudo: string | Buffer): void {
  mkdirSync(dirname(join(raiz, rel)), { recursive: true });
  writeFileSync(join(raiz, rel), conteudo);
}

describe("lerArtefato: um caso por kind", () => {
  it.each([...KINDS_CONHECIDOS])("kind %s é lido e preservado", async (kind) => {
    const raiz = criarTmp();
    gravar(raiz, "docs/x/ARQ.md", md({ expx_schema: 1, expx_tool: "sprintx", kind, trabalho_id: "t1" }));
    const a = await lerArtefato(raiz, "docs/x/ARQ.md");
    expect(a.rejeicao).toBeNull();
    expect(a.kind).toBe(kind);
    expect(a.ferramenta).toBe("sprintx");
    expect(a.trabalho_id).toBe("t1");
  });

  it("kind desconhecido vira 'desconhecido' e o arquivo continua visível", async () => {
    const raiz = criarTmp();
    gravar(raiz, "docs/x/ARQ.md", md({ expx_schema: 1, expx_tool: "sprintx", kind: "do_futuro", trabalho_id: "t1" }));
    const a = await lerArtefato(raiz, "docs/x/ARQ.md");
    expect(a.kind).toBe("desconhecido");
    expect(a.rejeicao).toBeNull();
    expect(a.dados).not.toBeNull();
  });
});

describe("lerArtefato: casos de erro e de formato", () => {
  it("YAML truncado -> rejeição yaml_invalido, sem lançar", async () => {
    const raiz = criarTmp();
    gravar(raiz, "docs/x/tasks.md", "---\nexpx_schema: 1\nkind: tasks\ntasks:\n  - id: T-0");
    const a = await lerArtefato(raiz, "docs/x/tasks.md");
    expect(a.dados).toBeNull();
    expect(a.rejeicao).toBe("yaml_invalido");
  });

  it("schema maior que o suportado é rejeitado com motivo schema_maior", async () => {
    const raiz = criarTmp();
    gravar(raiz, "docs/x/a.md", md({ expx_schema: 2, kind: "tasks" }));
    expect((await lerArtefato(raiz, "docs/x/a.md")).rejeicao).toBe("schema_maior");
  });

  it("arquivo sem frontmatter tem rejeição sem_frontmatter mas corpo disponível", async () => {
    const raiz = criarTmp();
    gravar(raiz, "docs/x/ORQUESTRADOR.md", "# sem yaml\n");
    const a = await lerArtefato(raiz, "docs/x/ORQUESTRADOR.md");
    expect(a.rejeicao).toBe("sem_frontmatter");
    expect(a.corpo).toContain("sem yaml");
  });

  it("BOM é tolerado", async () => {
    const raiz = criarTmp();
    gravar(raiz, "docs/x/a.md", "﻿" + md({ expx_schema: 1, kind: "tasks", expx_tool: "sprintx" }));
    expect((await lerArtefato(raiz, "docs/x/a.md")).kind).toBe("tasks");
  });

  it("arquivo acima de 2 MB é ignorado com aviso e sem ler o conteúdo", async () => {
    const raiz = criarTmp();
    gravar(raiz, "docs/x/grande.md", md({ expx_schema: 1, kind: "tasks" }) + "a".repeat(LIMITE_BYTES + 10));
    const a = await lerArtefato(raiz, "docs/x/grande.md");
    expect(a.rejeicao).toBe("arquivo_grande");
    expect(a.dados).toBeNull();
    expect(a.avisos.join(" ")).toMatch(/2 MB/);
  });

  it("arquivo inexistente devolve rejeição ilegivel em vez de lançar", async () => {
    const a = await lerArtefato(criarTmp(), "docs/nao/existe.md");
    expect(a.rejeicao).toBe("ilegivel");
  });

  it("caminhos com barra invertida são normalizados para /", async () => {
    const raiz = criarTmp();
    gravar(raiz, "docs/x/a.md", md({ kind: "tasks" }));
    expect((await lerArtefato(raiz, "docs\\x\\a.md")).caminho).toBe("docs/x/a.md");
  });
});

describe("leitores específicos (drift conhecido)", () => {
  it("prodx: schema expx-schema-v1 e pd_id viram ferramenta prodx e trabalho_id", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const a = await lerArtefato(raiz, "docs/produto/pedidos/PD-2026-0007-exportar-pdf/VEREDITO.md");
    expect(a.ferramenta).toBe("prodx");
    expect(a.kind).toBe("veredito");
    expect(a.trabalho_id).toBe("PD-2026-0007");
    expect(a.rejeicao).toBeNull();
    expect(a.dados?.aprovado_por).toBe("PENDENTE");
  });

  it("prodx com schema maior (expx-schema-v9) é rejeitado", async () => {
    const raiz = criarTmp();
    gravar(raiz, "docs/produto/pedidos/PD-1/VEREDITO.md", md({ kind: "veredito", schema: "expx-schema-v9", pd_id: "PD-1" }));
    expect((await lerArtefato(raiz, "docs/produto/pedidos/PD-1/VEREDITO.md")).rejeicao).toBe("schema_maior");
  });

  it("legadox/stackx: ## FAIXA: por regex, sem frontmatter, sem rejeição", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const r = await lerArtefato(raiz, "docs/legado/raio/exportar-csv.md");
    expect(r.faixa).toBe("alto");
    expect(r.ferramenta).toBe("legadox");
    expect(r.rejeicao).toBeNull();
    expect((await lerArtefato(raiz, "docs/legado/PERFIL.md")).faixa).toBe("medio");
    expect((await lerArtefato(raiz, "docs/stack/CONVENCOES.md")).ferramenta).toBe("stackx");
  });

  it("ENTREGA.md com expx_tool runx mesmo em trabalho sprintx segue legível", async () => {
    const raiz = criarTmp();
    gravar(raiz, "docs/entregas/feat/ENTREGA.md", md({ expx_schema: 1, expx_tool: "runx", kind: "entrega", trabalho_id: "feat", tipo_trabalho: "feature" }));
    const a = await lerArtefato(raiz, "docs/entregas/feat/ENTREGA.md");
    expect(a.kind).toBe("entrega");
    expect(a.ferramenta).toBe("mergex");
    expect(a.rejeicao).toBeNull();
  });

  it("designx: expx_tool designx (fora do enum do contrato) é aceito", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const a = await lerArtefato(raiz, "docs/design-system/AUDIT.md");
    expect(a.ferramenta).toBe("designx");
    expect(a.kind).toBe("design_audit");
    expect(a.rejeicao).toBeNull();
  });

  it("VEREDITO por regex em 00-AUDITORIA.md (sem frontmatter) e em QA.md", async () => {
    const raiz = criarTmp();
    gerarProjetoExpx(raiz);
    const aud = await lerArtefato(raiz, "docs/sprintx/features/relatorio-vendas/00-AUDITORIA.md");
    expect(aud.veredito).toBe("nao");
    expect(aud.rejeicao).toBeNull(); // sem frontmatter é o formato normal da auditoria
    expect((await lerArtefato(raiz, "docs/sprintx/features/cobranca-pix/00-AUDITORIA.md")).veredito).toBe("sim");
    expect((await lerArtefato(raiz, "docs/manutencao/OC-2026-0150-tela-lenta/QA.md")).veredito).toBe("reprovado");
    expect((await lerArtefato(raiz, "docs/manutencao/OC-2026-0142-frete-errado/QA.md")).veredito).toBe("aprovado");
  });

  it("QA.md sem linha de prosa cai no veredito do frontmatter", async () => {
    const raiz = criarTmp();
    gravar(raiz, "docs/manutencao/OC-1/QA.md", md({ expx_schema: 1, expx_tool: "runx", kind: "qa", trabalho_id: "OC-1", veredito: "reprovado" }, "# QA\n"));
    expect((await lerArtefato(raiz, "docs/manutencao/OC-1/QA.md")).veredito).toBe("reprovado");
  });

  it("markdown sem frontmatter fora da lista de exceções é marcado sem_frontmatter", async () => {
    const raiz = criarTmp();
    gravar(raiz, "docs/sprintx/features/a/00-DECISOES.md", "# sem yaml\n");
    expect((await lerArtefato(raiz, "docs/sprintx/features/a/00-DECISOES.md")).rejeicao).toBe("sem_frontmatter");
  });
});
