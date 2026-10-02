import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Membro, Squad } from "./tipos";
import {
  FormatoInvalidoError,
  VersaoMaiorError,
  caminhoSeguro,
  gravarSquadNoDiretorio,
  hashDoConjunto,
  interpretarMembroMd,
  interpretarSquad,
  lerSquadDoDiretorio,
  serializarMembroMd,
  serializarSquad,
  sha256,
} from "./formato";

const tmps: string[] = [];
const novoTmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "formato-squad-"));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function membro(slug: string, papel: Membro["papel"], extra: Partial<Membro> = {}): Membro {
  return {
    slug,
    papel,
    rotulo: `Rótulo: ${slug}`,
    descricao: "descrição curta",
    prompt: `membros/${slug}.md`,
    perfil: { cli: "claude", modelo: "sonnet", esforco: "medio", faixa: "medio" },
    skills_permitidas: ["ev-builder"],
    mcps_permitidos: [],
    hooks: [],
    max_instancias: 1,
    orcamento: { tempo_min: null, tokens: null, modo: "soft" },
    rigidez: null,
    permissao: null,
    ...extra,
  };
}
function squad(extra: Partial<Squad> = {}): Squad {
  return {
    slug: "demo",
    nome: "Demo",
    descricao: "Squad de teste.",
    escopo: "desenvolvimento",
    rigidez_padrao: null,
    max_instancias_paralelas: 4,
    orcamento: { tempo_min: null, tokens: null, modo: "soft" },
    portoes: null,
    fabrica: null,
    origem: "usuario",
    membros: [membro("orq", "orchestrator"), membro("impl", "executor"), membro("rev", "reviewer")],
    ...extra,
  };
}
const prompts = { orq: "# Orquestrador\n{{objetivo}}\n", impl: "# Implementador\n", rev: "# Revisor\n" };

describe("formato: squad.json", () => {
  it("round-trip sem perda e com schema_version", () => {
    const s = squad();
    const texto = serializarSquad(s);
    expect(JSON.parse(texto).schema_version).toBe(1);
    const { squad: lida, avisos } = interpretarSquad(texto, "usuario");
    expect(lida).toEqual(s);
    expect(avisos).toEqual([]);
  });

  it("campo extra é tolerado com aviso e descartado", () => {
    const bruto = JSON.parse(serializarSquad(squad()));
    bruto.novidade = 1;
    bruto.membros[0].ideia = true;
    const { squad: lida, avisos } = interpretarSquad(JSON.stringify(bruto), "usuario");
    expect(lida.slug).toBe("demo");
    expect(avisos.some((a) => a.includes("novidade"))).toBe(true);
    expect(avisos.some((a) => a.includes("ideia"))).toBe(true);
    expect(JSON.stringify(lida)).not.toContain("novidade");
  });

  it("recusa versão maior que a suportada e versão ausente", () => {
    const bruto = JSON.parse(serializarSquad(squad()));
    bruto.schema_version = 2;
    expect(() => interpretarSquad(JSON.stringify(bruto), "usuario")).toThrow(VersaoMaiorError);
    delete bruto.schema_version;
    expect(() => interpretarSquad(JSON.stringify(bruto), "usuario")).toThrow(FormatoInvalidoError);
    expect(() => interpretarSquad("{não é json", "usuario")).toThrow(FormatoInvalidoError);
  });

  it("recusa tipo errado nos campos obrigatórios e caminho de prompt fora de membros/", () => {
    const bruto = JSON.parse(serializarSquad(squad()));
    bruto.membros[1].prompt = "../fora.md";
    expect(() => interpretarSquad(JSON.stringify(bruto), "usuario")).toThrow(/caminho/i);
    const b2 = JSON.parse(serializarSquad(squad()));
    b2.membros = "nada";
    expect(() => interpretarSquad(JSON.stringify(b2), "usuario")).toThrow(FormatoInvalidoError);
  });

  it("origem vem do local (fábrica/usuário); 'importada' é guardada no arquivo", () => {
    const texto = serializarSquad(squad({ origem: "importada" }));
    expect(interpretarSquad(texto, "usuario").squad.origem).toBe("importada");
    expect(interpretarSquad(serializarSquad(squad()), "fabrica").squad.origem).toBe("fabrica");
  });
});

describe("formato: membro .md", () => {
  it("round-trip com frontmatter e rótulo com dois-pontos", () => {
    const md = serializarMembroMd({ papel: "executor", rotulo: 'Impl: "back"' }, "# Corpo\nlinha\n");
    const r = interpretarMembroMd(md);
    expect(r.papel).toBe("executor");
    expect(r.rotulo).toBe('Impl: "back"');
    expect(r.corpo).toBe("# Corpo\nlinha\n");
  });
  it("frontmatter incompleto, versão maior e binário viram erro nominal", () => {
    expect(() => interpretarMembroMd("---\nschema_version: 1\npapel: executor\n# sem fechar")).toThrow(FormatoInvalidoError);
    expect(() => interpretarMembroMd("---\nschema_version: 9\npapel: executor\nrotulo: x\n---\ncorpo")).toThrow(VersaoMaiorError);
    expect(() => interpretarMembroMd("---\nschema_version: 1\npapel: executor\nrotulo: x\n---\nco\u0000rpo")).toThrow(FormatoInvalidoError);
  });
  it("arquivo sem frontmatter é aceito como corpo puro (edição manual) com aviso", () => {
    const r = interpretarMembroMd("só texto");
    expect(r.corpo).toBe("só texto");
    expect(r.avisos.length).toBeGreaterThan(0);
  });
});

describe("caminhoSeguro e hashes", () => {
  it("aceita relativo simples e recusa .., absoluto, NUL, barra invertida e vazio", () => {
    expect(caminhoSeguro("membros/a.md")).toBe("membros/a.md");
    for (const ruim of ["../a", "membros/../../a", "/etc/passwd", "a\u0000b", "a\\b", "", "C:/x", "./../x"]) {
      expect(() => caminhoSeguro(ruim), ruim).toThrow(FormatoInvalidoError);
    }
  });
  it("hash do conjunto independe da ordem das chaves e muda com o conteúdo", () => {
    const a = hashDoConjunto({ "a": sha256("1"), "b": sha256("2") });
    expect(hashDoConjunto({ "b": sha256("2"), "a": sha256("1") })).toBe(a);
    expect(hashDoConjunto({ "a": sha256("1"), "b": sha256("3") })).not.toBe(a);
  });
});

describe("formato: diretório (escrita atômica, leitura segura)", () => {
  it("gravar → ler = mesmo hash e mesmos prompts", async () => {
    const dir = join(novoTmp(), "demo");
    const gravado = await gravarSquadNoDiretorio(dir, squad(), prompts);
    const lido = await lerSquadDoDiretorio(dir, "usuario");
    expect(lido.hash).toBe(gravado.hash);
    expect(lido.prompts).toEqual(prompts);
    expect(lido.squad).toEqual(squad());
    expect(readdirSync(join(dir, "membros")).sort()).toEqual(["impl.md", "orq.md", "rev.md"]);
  });

  it("regravar remove .md de membro que saiu e não deixa temporário", async () => {
    const dir = join(novoTmp(), "demo");
    await gravarSquadNoDiretorio(dir, squad(), prompts);
    const menor = squad({ membros: [membro("orq", "orchestrator"), membro("rev", "reviewer")] });
    await gravarSquadNoDiretorio(dir, menor, prompts);
    expect(readdirSync(join(dir, "membros")).sort()).toEqual(["orq.md", "rev.md"]);
    expect(readdirSync(dir).filter((n) => n.includes(".tmp"))).toEqual([]);
  });

  it("edição externa de um .md muda o hash do conjunto", async () => {
    const dir = join(novoTmp(), "demo");
    const g = await gravarSquadNoDiretorio(dir, squad(), prompts);
    const md = readFileSync(join(dir, "membros", "impl.md"), "utf8");
    writeFileSync(join(dir, "membros", "impl.md"), md + "\nmais uma regra\n");
    const lido = await lerSquadDoDiretorio(dir, "usuario");
    expect(lido.hash).not.toBe(g.hash);
    expect(lido.prompts["impl"]).toContain("mais uma regra");
  });

  it(".md binário ou truncado vira aviso e não derruba a leitura", async () => {
    const dir = join(novoTmp(), "demo");
    await gravarSquadNoDiretorio(dir, squad(), prompts);
    writeFileSync(join(dir, "membros", "impl.md"), Buffer.from([0, 1, 2, 255, 254]));
    writeFileSync(join(dir, "membros", "rev.md"), "---\nschema_version: 1\npapel: reviewer");
    const lido = await lerSquadDoDiretorio(dir, "usuario");
    expect(lido.prompts["impl"]).toBe("");
    expect(lido.prompts["rev"]).toBe("");
    expect(lido.prompts["orq"]).toBe(prompts.orq);
    expect(lido.avisos.length).toBe(2);
  });

  it("symlink de .md para fora é recusado (aviso, conteúdo não é lido); membro ausente também avisa", async () => {
    const raiz = novoTmp();
    const dir = join(raiz, "demo");
    await gravarSquadNoDiretorio(dir, squad(), prompts);
    writeFileSync(join(raiz, "segredo.md"), "SEGREDO-DO-USUARIO");
    rmSync(join(dir, "membros", "impl.md"));
    symlinkSync(join(raiz, "segredo.md"), join(dir, "membros", "impl.md"));
    rmSync(join(dir, "membros", "rev.md"));
    const lido = await lerSquadDoDiretorio(dir, "usuario");
    expect(lido.prompts["impl"]).toBe("");
    expect(JSON.stringify(lido)).not.toContain("SEGREDO-DO-USUARIO");
    expect(lido.avisos.length).toBe(2);
  });

  it("symlink em squad.json ou em membros/ é recusado", async () => {
    const raiz = novoTmp();
    const dir = join(raiz, "demo");
    await gravarSquadNoDiretorio(dir, squad(), prompts);
    mkdirSync(join(raiz, "fora"));
    rmSync(join(dir, "membros"), { recursive: true });
    symlinkSync(join(raiz, "fora"), join(dir, "membros"));
    await expect(lerSquadDoDiretorio(dir, "usuario")).rejects.toThrow(FormatoInvalidoError);
  });

  it("escrita interrompida (temporário órfão) não corrompe nem aparece como membro", async () => {
    const dir = join(novoTmp(), "demo");
    await gravarSquadNoDiretorio(dir, squad(), prompts);
    writeFileSync(join(dir, "membros", "impl.md.tmp-123-abc"), "meio escrito");
    writeFileSync(join(dir, "squad.json.tmp-123-abc"), "{meio");
    const lido = await lerSquadDoDiretorio(dir, "usuario");
    expect(lido.squad.membros).toHaveLength(3);
    expect(lido.prompts["impl"]).toBe(prompts.impl);
  });

  it("recusa gravar prompt de membro sem texto fornecido e slug de membro que vira caminho", async () => {
    const dir = join(novoTmp(), "demo");
    await expect(gravarSquadNoDiretorio(dir, squad(), { orq: "x" })).rejects.toThrow(FormatoInvalidoError);
    const ruim = squad({ membros: [membro("../x", "orchestrator"), membro("a", "executor"), membro("b", "reviewer")] });
    await expect(gravarSquadNoDiretorio(dir, ruim, { "../x": "x", a: "a", b: "b" })).rejects.toThrow(FormatoInvalidoError);
  });
});
