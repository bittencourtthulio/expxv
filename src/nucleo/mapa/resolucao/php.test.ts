import { describe, expect, it } from "vitest";
import { montarContexto } from "../../../../tests/fixtures/mapa/contexto";
import { lerManifesto } from "../manifestos";
import type { ImportBruto, SimboloBruto } from "../tipos";
import type { ArquivoParaResolver } from "./comum";
import { resolvedorPhp } from "./php";

// T-17.17 (PHP): PSR-4 exata, classmap/funções heurística, require relativo, mesmo namespace; fixture real.

const COMPOSER = JSON.stringify({
  require: { "laravel/framework": "^10", "doctrine/orm": "^2" },
  autoload: { "psr-4": { "App\\": ["app/", "src/"], "App\\Console\\Commands\\": "app/Console/Commands/" }, classmap: ["legado"] },
});
const manifestos = [lerManifesto("composer.json", COMPOSER)!];

const imp = (especificador: string, nome?: string, tipo: ImportBruto["tipo"] = "estatico", alias: string | null = null): ImportBruto => ({
  especificador, tipo, linha: 2, so_tipo: false, nomes: nome === undefined ? [] : [{ nome, alias }],
});
const sim = (qualificado: string, tipo: SimboloBruto["tipo"] = "classe"): SimboloBruto => ({ nome: qualificado.split(/[\\.]/).pop() as string, qualificado, tipo, linha: 1, linha_fim: 1, exportado: true, visibilidade: "publica", complexidade: 0, assinatura: "", doc: null, decoradores: [] });

function proj(arquivos: Record<string, { imports?: ImportBruto[]; simbolos?: SimboloBruto[]; herancas?: string[]; chamadas?: Array<{ alvo: string; receptor: string | null }> }>) {
  const mapa = new Map<string, ArquivoParaResolver>();
  for (const [c, v] of Object.entries(arquivos))
    mapa.set(c, {
      caminho: c, linguagem: "php",
      extracao: {
        imports: v.imports ?? [], simbolos: v.simbolos ?? [],
        herancas: (v.herancas ?? []).map((b) => ({ classe: "X", base: b, tipo: "herda" as const, linha: 3 })),
        chamadas: (v.chamadas ?? []).map((x) => ({ de: null, alvo: x.alvo, receptor: x.receptor, tipo: "chamada" as const, linha: 4 })),
      },
    });
  return resolvedorPhp.resolver({ arquivos: mapa, manifestos });
}

const BASE = {
  "app/Models/Cliente.php": { simbolos: [sim("App\\Models\\Cliente"), sim("App\\Models\\Cliente.total", "metodo")] },
  "src/Entity/Pedido.php": { simbolos: [sim("App\\Entity\\Pedido")] },
  "legado/Velha.php": { simbolos: [sim("Velha")] },
  "lib/helpers.php": { simbolos: [sim("App\\Support\\moeda", "funcao")] },
};
const ORIGEM = "app/Http/Ctl.php";
const liga = (i: ImportBruto, extra = {}) => {
  const r = proj({ ...BASE, ...extra, [ORIGEM]: { imports: [i], simbolos: [sim("App\\Http\\Ctl")] } });
  return { r, l: r.ligacoes.find((x) => x.arquivo === ORIGEM && x.especificador === i.especificador) };
};

describe("resolvedor PHP: tabela", () => {
  const tabela: Array<[string, ImportBruto, string | null, "exata" | "heuristica"]> = [
    ["PSR-4 pasta principal", imp("App\\Models\\Cliente", "Cliente"), "arq:app/Models/Cliente.php", "exata"],
    ["PSR-4 segunda pasta do mesmo prefixo", imp("App\\Entity\\Pedido", "Pedido"), "arq:src/Entity/Pedido.php", "exata"],
    ["use com alias", imp("App\\Models\\Cliente", "Cliente", "estatico", "C"), "arq:app/Models/Cliente.php", "exata"],
    ["classmap (índice de símbolos)", imp("Velha", "Velha"), "arq:legado/Velha.php", "heuristica"],
    ["use function via índice", imp("App\\Support\\moeda", "function moeda"), "arq:lib/helpers.php", "exata"],
    ["use function inexistente no namespace do projeto é listada", imp("App\\Support\\nada", "function nada"), null, "exata"],
    ["use const externa de namespace global", imp("PHP_EOL", "const PHP_EOL"), "ext:builtin:PHP_EOL", "exata"],
    ["classe do projeto inexistente é listada", imp("App\\Models\\Fantasma", "Fantasma"), null, "exata"],
    ["vendor sem pacote homônimo no composer.json (namespace != nome do pacote)", imp("Illuminate\\Support\\Str", "Str"), "ext:composer:illuminate", "exata"],
    ["vendor com pacote correspondente", imp("Doctrine\\ORM\\Mapping", "Mapping"), "ext:composer:doctrine/orm", "exata"],
    ["vendor desconhecido", imp("Acme\\Lib\\X", "X"), "ext:composer:acme", "exata"],
    ["classe global (sem namespace) é builtin", imp("DateTime", "DateTime"), "ext:builtin:DateTime", "exata"],
    ["namespace com barra inicial", imp("\\App\\Models\\Cliente", "Cliente"), "arq:app/Models/Cliente.php", "exata"],
    ["mais específico vence (Commands/)", imp("App\\Console\\Commands\\Sync", "Sync"), null, "exata"],
  ];
  for (const [nome, i, esperado, conf] of tabela)
    it(nome, () => {
      const { r, l } = liga(i);
      expect(l).toBeDefined();
      if (esperado === null) {
        expect(l?.para).toBeNull();
        expect(r.nao_resolvidos).toHaveLength(1);
      } else {
        expect(l?.para).toBe(esperado);
        expect(l?.confianca).toBe(conf);
      }
    });
  it("PSR-4 mais específico: classe em app/Console/Commands", () => {
    const { l } = liga(imp("App\\Console\\Commands\\Sync", "Sync"), { "app/Console/Commands/Sync.php": { simbolos: [sim("App\\Console\\Commands\\Sync")] } });
    expect(l?.para).toBe("arq:app/Console/Commands/Sync.php");
  });
  it("require relativo (`./x` do extrator) é exata; vendor/autoload é ignorado; ausente é listado", () => {
    const r = proj({
      "a/index.php": { imports: [imp("./inc/util.php", undefined, "require"), imp("./vendor/autoload.php", undefined, "require"), imp("./nada.php", undefined, "require"), imp("../topo.php", undefined, "require")] },
      "a/inc/util.php": {}, "topo.php": {},
    });
    expect(r.ligacoes.find((l) => l.especificador === "./inc/util.php")).toMatchObject({ para: "arq:a/inc/util.php", confianca: "exata" });
    expect(r.ligacoes.find((l) => l.especificador === "../topo.php")?.para).toBe("arq:topo.php");
    expect(r.ignorados).toBe(1);
    expect(r.nao_resolvidos.map((n) => n.especificador)).toEqual(["./nada.php"]);
  });
  it("require de caminho sem ./ cai na raiz como heurística", () => {
    const r = proj({ "a/index.php": { imports: [imp("lib/base.php", undefined, "require")] }, "lib/base.php": {} });
    expect(r.ligacoes[0]).toMatchObject({ para: "arq:lib/base.php", confianca: "heuristica" });
  });
  it("require que escapa da raiz é recusado", () => {
    const r = proj({ "a.php": { imports: [imp("../../etc/passwd", undefined, "require")] } });
    expect(r.nao_resolvidos[0]?.motivo).toBe("fora_da_raiz");
  });
  it("mesmo namespace sem `use`: herança e chamada estática", () => {
    const r = proj({
      "app/Models/Cliente.php": { simbolos: [sim("App\\Models\\Cliente")] },
      "app/Models/Base.php": { simbolos: [sim("App\\Models\\Base")] },
      "app/Models/Pedido.php": { simbolos: [sim("App\\Models\\Pedido")], herancas: ["Base"], chamadas: [{ alvo: "novo", receptor: "Cliente" }, { alvo: "f", receptor: "self" }, { alvo: "g", receptor: "\\Outro\\Cliente" }] },
    });
    expect(r.arestas.map((a) => a.para).sort()).toEqual(["arq:app/Models/Base.php", "arq:app/Models/Cliente.php"]);
  });
});

describe("resolvedor PHP: fixture real", () => {
  it("ClienteController -> Cliente por PSR-4; Illuminate externo; imports de Cliente do projeto ausentes são listados", async () => {
    const { ctx } = await montarContexto("php");
    const r = resolvedorPhp.resolver({ ...ctx, manifestos });
    const l = (arq: string, e: string) => r.ligacoes.find((x) => x.arquivo === arq && x.especificador === e);
    expect(l("app/Http/Controllers/ClienteController.php", "App\\Models\\Cliente")).toMatchObject({ para: "arq:app/Models/Cliente.php", confianca: "exata" });
    expect(l("routes/web.php", "Illuminate\\Support\\Facades\\Route")?.para).toBe("ext:composer:illuminate");
    expect(l("routes/web.php", "App\\Http\\Controllers\\ClienteController")?.para).toBe("arq:app/Http/Controllers/ClienteController.php");
    expect(l("app/Models/Cliente.php", "App\\Contracts\\Auditavel")?.para).toBeNull();
    expect(r.nao_resolvidos.some((n) => n.especificador === "App\\Contracts\\Auditavel")).toBe(true);
    expect(l("plugin.php", "./inc/util.php")?.para).toBeNull();
    expect(l("index.php", "./vendor/autoload.php")).toBeUndefined();
  });
});
