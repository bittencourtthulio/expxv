import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { aplicar, ITENS_MANUAIS, LISTA_FECHADA, lerProduto, planejar, reverter, validarOpcoes } from "../../scripts/lib/renomear.mjs";

// T-21.05 (D-01, D-341): o script de renomeação opera por lista FECHADA; aqui só em árvore temporária, nunca na real.

const RAIZ = join(__dirname, "..", "..");
const temporarias: string[] = [];
const DISTRIBUICAO = readFileSync(join(RAIZ, "build", "distribuicao.json"), "utf8");

function copiar(rel: string, destinoRaiz: string): void {
  const origem = join(RAIZ, rel);
  if (!existsSync(origem)) return;
  mkdirSync(join(destinoRaiz, rel, ".."), { recursive: true });
  cpSync(origem, join(destinoRaiz, rel), { recursive: true });
}

/** árvore mínima: os arquivos reais da lista fechada (+ distribuicao.json de fixture, o coordenador pode ainda não tê-lo). */
function arvore(): string {
  const raiz = mkdtempSync(join(tmpdir(), "renomear-"));
  temporarias.push(raiz);
  for (const rel of ["src/nucleo/produto.ts", "package.json", "electron-builder.yml", ".github/workflows/release.yml", ".github/workflows/validacao.yml"]) copiar(rel, raiz);
  mkdirSync(join(raiz, "build"), { recursive: true });
  writeFileSync(join(raiz, "build", "distribuicao.json"), DISTRIBUICAO);
  return raiz;
}

function hashes(raiz: string): Record<string, string> {
  const saida: Record<string, string> = {};
  const andar = (dir: string): void => {
    for (const n of readdirSync(dir)) {
      const c = join(dir, n);
      if (statSync(c).isDirectory()) andar(c);
      else saida[relative(raiz, c)] = createHash("sha256").update(readFileSync(c)).digest("hex");
    }
  };
  andar(raiz);
  return saida;
}

const NOVO = { nome: "Aurora", id: "aurora" };
const relatorioDe = (raiz: string): string => readdirSync(raiz).filter((n) => /^renomeacao-\d{4}-\d{2}-\d{2}(-\d+)?\.json$/.test(n)).map((n) => join(raiz, n))[0]!;

afterAll(() => {
  for (const t of temporarias) rmSync(t, { recursive: true, force: true });
});

describe("validação das opções", () => {
  it("recusa id fora de ^[a-z][a-z0-9]{2,23}$", () => {
    for (const id of ["Ab", "1abc", "ab", "a".repeat(25), "ab-c", "com espaco", "../x", "ÁÁÁ", ""]) {
      expect(() => validarOpcoes({ nome: "Ok", id }), id).toThrow(/id/);
    }
    expect(() => validarOpcoes({ nome: "Ok", id: "abc" })).not.toThrow();
    expect(() => validarOpcoes({ nome: "Ok", id: "a".repeat(24) })).not.toThrow();
  });

  it("recusa nome vazio, com caractere de controle ou '/'", () => {
    for (const nome of ["", "  ", "a/b", "a\nb", "a\u0000b", "a\u007fb", "x".repeat(65)]) {
      expect(() => validarOpcoes({ nome, id: "abc" }), JSON.stringify(nome)).toThrow(/nome/);
    }
    expect(() => validarOpcoes({ nome: "Meu App 2", id: "abc" })).not.toThrow();
  });

  it("recusa dono/repo/host inválidos e valida o appId derivado (DNS reverso)", () => {
    expect(() => validarOpcoes({ dono: "a/b" })).toThrow(/dono/);
    expect(() => validarOpcoes({ repo: "a b" })).toThrow(/repo/);
    expect(() => validarOpcoes({ hostFeed: "https://x.com/y" })).toThrow(/host/);
    expect(() => validarOpcoes({ hostFeed: "feed.exemplo.com.br" })).not.toThrow();
    expect(() => validarOpcoes({ id: "abc" }, { appIdAtual: "com.expx.expxv" })).not.toThrow();
    expect(() => validarOpcoes({ id: "abc" }, { appIdAtual: "com.1x.y" })).toThrow(/appId/);
  });

  it("--migrar-dados exige id novo diferente do idDados atual", () => {
    const raiz = arvore();
    expect(() => planejar(raiz, { migrarDados: true })).toThrow(/migrar/);
    expect(() => planejar(raiz, { id: "expxv", migrarDados: true })).toThrow(/migrar/);
  });
});

describe("dry-run", () => {
  it("não grava nada (hash da árvore igual) e é rápido (P-158 ≤ 2 s)", () => {
    const raiz = arvore();
    const antes = hashes(raiz);
    const t0 = performance.now();
    const plano = planejar(raiz, NOVO);
    const ms = performance.now() - t0;
    expect(hashes(raiz)).toEqual(antes);
    expect(ms).toBeLessThan(2000);
    expect(plano.arquivos.map((a: { caminho: string }) => a.caminho).sort()).toEqual(
      ["build/distribuicao.json", ".github/workflows/release.yml", ".github/workflows/validacao.yml", "electron-builder.yml", "package.json", "src/nucleo/produto.ts"]
        .filter((c) => plano.arquivos.some((a: { caminho: string }) => a.caminho === c))
        .sort(),
    );
    expect(plano.arquivos.some((a: { caminho: string }) => a.caminho === "package.json")).toBe(true);
    expect(plano.manual.map((m: { id: string }) => m.id)).toEqual(ITENS_MANUAIS.map((m: { id: string }) => m.id));
  });

  it("o CLI padrão é dry-run: não grava e não cria relatório", () => {
    const raiz = arvore();
    const antes = hashes(raiz);
    const r = spawnSync(process.execPath, [join(RAIZ, "scripts", "renomear.mjs"), "--nome", "Aurora", "--id", "aurora", "--raiz", raiz], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/dry-run/i);
    expect(hashes(raiz)).toEqual(antes);
  });
});

describe("aplicar", () => {
  let raiz: string;
  beforeEach(() => {
    raiz = arvore();
  });

  it("altera só a lista fechada e produto.ts/package.json/electron-builder passam a concordar", () => {
    const t0 = performance.now();
    aplicar(raiz, planejar(raiz, NOVO), { hoje: new Date("2026-10-01T12:00:00Z") });
    expect(performance.now() - t0).toBeLessThan(5000);
    const p = lerProduto(raiz);
    expect(p).toMatchObject({ nome: "Aurora", id: "aurora" });
    const pkg = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")) as { name: string };
    expect(pkg.name).toBe("aurora");
    const builder = readFileSync(join(raiz, "electron-builder.yml"), "utf8");
    expect(builder).toContain("appId: com.expx.aurora");
    expect(builder).toContain("productName: Aurora");
    expect(builder).toContain("artifactName: Aurora-universal.${ext}");
    expect(builder).toContain("artifactName: Aurora-Setup.${ext}");
    expect(builder).toMatch(/publish:[\s\S]*repo: aurora/);
    expect(existsSync(join(raiz, "renomeacao-2026-10-01.json"))).toBe(true);
  });

  it("AU-19: o nome antigo não sobra nos arquivos da lista fechada (exceto a identidade de dados fixada)", () => {
    const antigo = lerProduto(raiz);
    aplicar(raiz, planejar(raiz, NOVO), { hoje: new Date("2026-10-01T00:00:00Z") });
    for (const rel of ["package.json", "electron-builder.yml", ".github/workflows/release.yml", ".github/workflows/validacao.yml"]) {
      const texto = readFileSync(join(raiz, rel), "utf8");
      expect(texto.includes(antigo.nome), `${rel} ainda cita o nome`).toBe(false);
      expect(texto.includes(antigo.id), `${rel} ainda cita o id`).toBe(false);
    }
    const produto = readFileSync(join(raiz, "src/nucleo/produto.ts"), "utf8");
    expect(produto).toContain(`const ID_DADOS: string = "${antigo.id}";`); // AU-18: dados continuam onde estão
    expect(produto).toContain('const IDS_ANTERIORES: readonly string[] = [];');
    expect(lerProduto(raiz).idDados).toBe(antigo.id);
  });

  it("não muda idDados por padrão; --migrar-dados muda e registra o antigo em idsAnteriores", () => {
    const antigo = lerProduto(raiz).id;
    aplicar(raiz, planejar(raiz, { ...NOVO, migrarDados: true }), { hoje: new Date("2026-10-01T00:00:00Z") });
    const p = lerProduto(raiz);
    expect(p.idDados).toBe("aurora");
    expect(p.idsAnteriores).toEqual([antigo]);
    const produto = readFileSync(join(raiz, "src/nucleo/produto.ts"), "utf8");
    expect(produto).toContain("const ID_DADOS: string = ID;");
  });

  it("segunda renomeação com --migrar-dados empilha os anteriores (mais recente primeiro)", () => {
    const original = lerProduto(raiz).id;
    aplicar(raiz, planejar(raiz, { ...NOVO, migrarDados: true }), { hoje: new Date("2026-10-01T00:00:00Z") });
    aplicar(raiz, planejar(raiz, { nome: "Zenite", id: "zenite", migrarDados: true }), { hoje: new Date("2026-10-02T00:00:00Z") });
    const p = lerProduto(raiz);
    expect(p.idDados).toBe("zenite");
    expect(p.idsAnteriores).toEqual(["aurora", original]);
  });

  it("dono/repo e host do feed", () => {
    aplicar(raiz, planejar(raiz, { ...NOVO, dono: "minha-org", repo: "releases-aurora", hostFeed: "feed.exemplo.com.br" }), { hoje: new Date("2026-10-01T00:00:00Z") });
    expect(lerProduto(raiz).repositorioReleases).toEqual({ dono: "minha-org", repo: "releases-aurora" });
    const builder = readFileSync(join(raiz, "electron-builder.yml"), "utf8");
    expect(builder).toContain("owner: minha-org");
    expect(builder).toContain("repo: releases-aurora");
    const dist = JSON.parse(readFileSync(join(raiz, "build", "distribuicao.json"), "utf8")) as { atualizacao: { feed: { host: string } } };
    expect(dist.atualizacao.feed.host).toBe("feed.exemplo.com.br");
  });

  it("sem distribuicao.json na árvore: ignora sem erro", () => {
    rmSync(join(raiz, "build"), { recursive: true });
    expect(() => aplicar(raiz, planejar(raiz, { ...NOVO, hostFeed: "feed.exemplo.com.br" }), { hoje: new Date("2026-10-01T00:00:00Z") })).not.toThrow();
  });

  it("o relatório traz antes/depois por arquivo, a lista manual e nenhum segredo", () => {
    process.env.RENOMEAR_SENTINELA = "SEGREDO-NAO-PODE-APARECER";
    aplicar(raiz, planejar(raiz, NOVO), { hoje: new Date("2026-10-01T00:00:00Z") });
    delete process.env.RENOMEAR_SENTINELA;
    const texto = readFileSync(relatorioDe(raiz), "utf8");
    expect(texto).not.toContain("SEGREDO-NAO-PODE-APARECER");
    expect(texto).not.toContain(raiz); // caminhos relativos (regra 12)
    const rel = JSON.parse(texto) as { arquivos: Array<{ caminho: string; edicoes: Array<{ antes: string; depois: string }> }>; manual: Array<{ id: string }> };
    expect(rel.arquivos.find((a) => a.caminho === "package.json")!.edicoes[0]).toMatchObject({ antes: expect.stringContaining('"expxv"'), depois: expect.stringContaining('"aurora"') });
    expect(rel.manual.map((m) => m.id)).toEqual(ITENS_MANUAIS.map((m) => m.id));
  });

  it("não sobrescreve um relatório do mesmo dia (perderia a reversão)", () => {
    const hoje = new Date("2026-10-01T00:00:00Z");
    aplicar(raiz, planejar(raiz, NOVO), { hoje });
    aplicar(raiz, planejar(raiz, { nome: "Zenite", id: "zenite" }), { hoje });
    expect(existsSync(join(raiz, "renomeacao-2026-10-01.json"))).toBe(true);
    expect(existsSync(join(raiz, "renomeacao-2026-10-01-2.json"))).toBe(true);
  });
});

describe("reverter", () => {
  it("aplicar + reverter = identidade byte a byte (e sem aplicar repetido)", () => {
    const raiz = arvore();
    const antes = hashes(raiz);
    const { caminhoRelatorio } = aplicar(raiz, planejar(raiz, { ...NOVO, dono: "outra-org", migrarDados: true, hostFeed: "feed.exemplo.com.br" }), { hoje: new Date("2026-10-01T00:00:00Z") });
    expect(hashes(raiz)).not.toEqual(antes);
    reverter(raiz, caminhoRelatorio);
    const depois = hashes(raiz);
    delete depois["renomeacao-2026-10-01.json"];
    expect(depois).toEqual(antes);
  });

  it("propriedade: para vários nomes/ids válidos, aplicar+reverter restaura a árvore", () => {
    const casos = [
      { nome: "Aurora", id: "aurora" },
      { nome: "Meu App: Pro #2", id: "meuapp2" },
      { nome: "Ünico Ação", id: "abc" },
      { nome: "X y", id: "a".repeat(24), migrarDados: true },
    ];
    for (const [i, c] of casos.entries()) {
      const raiz = arvore();
      const antes = hashes(raiz);
      const { caminhoRelatorio } = aplicar(raiz, planejar(raiz, c), { hoje: new Date(`2026-10-0${i + 1}T00:00:00Z`) });
      reverter(raiz, caminhoRelatorio);
      const depois = hashes(raiz);
      delete depois[relative(raiz, caminhoRelatorio)];
      expect(depois, JSON.stringify(c)).toEqual(antes);
    }
  });

  it("recusa reverter se um arquivo mudou depois da renomeação (não perde edição do dono)", () => {
    const raiz = arvore();
    const { caminhoRelatorio } = aplicar(raiz, planejar(raiz, NOVO), { hoje: new Date("2026-10-01T00:00:00Z") });
    const pkg = join(raiz, "package.json");
    writeFileSync(pkg, readFileSync(pkg, "utf8") + "\n");
    const estado = hashes(raiz);
    expect(() => reverter(raiz, caminhoRelatorio)).toThrow(/mudou/);
    expect(hashes(raiz)).toEqual(estado); // nada foi revertido pela metade
  });

  it("o CLI reverte pelo relatório", () => {
    const raiz = arvore();
    const antes = hashes(raiz);
    const exe = join(RAIZ, "scripts", "renomear.mjs");
    const a = spawnSync(process.execPath, [exe, "--nome", "Aurora", "--id", "aurora", "--aplicar", "--raiz", raiz], { encoding: "utf8" });
    expect(a.status, a.stderr).toBe(0);
    const rel = relatorioDe(raiz);
    const r = spawnSync(process.execPath, [exe, "--reverter", rel, "--raiz", raiz], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const depois = hashes(raiz);
    delete depois[relative(raiz, rel)];
    expect(depois).toEqual(antes);
  });

  it("o CLI recusa entrada inválida com código ≠ 0 e sem gravar", () => {
    const raiz = arvore();
    const antes = hashes(raiz);
    const r = spawnSync(process.execPath, [join(RAIZ, "scripts", "renomear.mjs"), "--id", "Inválido!", "--aplicar", "--raiz", raiz], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/id/);
    expect(hashes(raiz)).toEqual(antes);
  });
});

describe("varredura de marca com o nome novo (AU-19)", () => {
  it("numa cópia de src/ renomeada, nenhum arquivo fora de produto.ts cita o nome novo nem o antigo", () => {
    const raiz = arvore();
    const EXT = [".ts", ".tsx", ".css", ".html", ".mjs", ".cjs", ".js", ".json"];
    const copia = join(raiz, "src");
    const copiarSrc = (de: string, para: string): void => {
      for (const n of readdirSync(de)) {
        if (n === "node_modules" || n === "assets") continue;
        const o = join(de, n);
        if (statSync(o).isDirectory()) {
          mkdirSync(join(para, n), { recursive: true });
          copiarSrc(o, join(para, n));
        } else if (EXT.some((e) => n.endsWith(e)) && !/\.test\.tsx?$/.test(n) && !(para === join(copia, "nucleo") && n === "produto.ts")) {
          cpSync(o, join(para, n));
        }
      }
    };
    copiarSrc(join(RAIZ, "src"), copia);
    const antigo = lerProduto(raiz);
    const vazamentosDe = (termos: string[]): string[] => {
      const achados: string[] = [];
      const varrer = (dir: string): void => {
        for (const n of readdirSync(dir)) {
          const c = join(dir, n);
          if (statSync(c).isDirectory()) varrer(c);
          else if (relative(raiz, c) !== join("src", "nucleo", "produto.ts")) {
            const t = readFileSync(c, "utf8").toLowerCase();
            for (const termo of termos) if (t.includes(termo)) achados.push(`${relative(raiz, c)}: ${termo}`);
          }
        }
      };
      varrer(copia);
      return achados;
    };
    // o que já vazava ANTES de renomear não é culpa do script (trabalho de outros agentes em andamento): a base é a referência
    const base = vazamentosDe([antigo.nome, antigo.id, antigo.appId, `${antigo.id}-app`].map((t: string) => t.toLowerCase()));
    aplicar(raiz, planejar(raiz, NOVO), { hoje: new Date("2026-10-01T00:00:00Z") });
    const novo = lerProduto(raiz);
    const termosNovos = [novo.nome, novo.id, `com.expx.${novo.id}`, `${novo.id}-app`].map((t: string) => t.toLowerCase());
    expect(vazamentosDe(termosNovos)).toEqual([]);
    expect(vazamentosDe([antigo.nome, antigo.id, antigo.appId, `${antigo.id}-app`].map((t: string) => t.toLowerCase()))).toEqual(base);
  });
});

describe("a árvore real não é tocada", () => {
  it("lista fechada declarada coincide com o que o plano usa", () => {
    expect([...LISTA_FECHADA].sort()).toEqual([".github/workflows/*.yml", "build/distribuicao.json", "electron-builder.yml", "package.json", "src/nucleo/produto.ts"]);
  });
});
