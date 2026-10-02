import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { compilarMapaParaTeste } from "../fixtures/mapa/compilar";
import { escrever, pastaTmp, removerPasta } from "../fixtures/vcs/repos";
import { detectarFerramentas } from "../../src/nucleo/mapa/adaptadores/detectar";
import { executarExtracao } from "../../src/nucleo/mapa/worker-extracao";
import { criarLeitorConfinado } from "../../src/nucleo/mapa/confinado";
import { criarFachadaMapa, type FachadaMapa } from "../../src/nucleo/mapa/fachada";
import { criarServicoMapa, type ServicoMapaCompleto } from "../../src/nucleo/mapa/servico";
import { PRODUTO } from "../../src/nucleo/produto";

// T-17.45 (auditoria do mapa): repositório HOSTIL. Nada do que está no projeto analisado é executado (arquivo canário), arquivos de
// ambiente e chaves nunca são abertos nem vazam para banco, pacote, exportação ou respostas; symlink para fora não é seguido; `..` em
// manifestos não escapa da raiz; arquivo gigante e arquivo que trava o parser são contidos; nenhum módulo do mapa fala com a rede;
// literais de segredo e código-fonte não vão para o banco nem para o pacote que a IA lê.

const SRC = resolve(__dirname, "../../src");
const pastas: string[] = [];
const servicos: ServicoMapaCompleto[] = [];
let dist = "";
beforeAll(() => {
  dist = compilarMapaParaTeste(["nucleo/mapa/index.ts", "nucleo/mapa/worker-extracao.ts", "nucleo/mapa/pool.ts", "nucleo/mapa/worker-derivada.ts"]);
});
afterEach(async () => {
  for (const s of servicos.splice(0)) await s.encerrar();
});
afterAll(() => {
  for (const p of pastas) removerPasta(p);
});

const ISCA_AMBIENTE = "ISCA-AMBIENTE-nunca-deve-vazar";
const ISCA_CHAVE = "ISCA-CHAVE-nunca-deve-vazar";
const ISCA_FORA = "ISCA-FORA-DA-RAIZ-nunca-deve-vazar";
// literais de segredo montados em tempo de execução (o arquivo de teste não contém o valor contíguo)
const SEGREDO_TOKEN = ["sk", "-", "Z".repeat(32)].join("");
const SEGREDO_SENHA = ["hunter", "2-senha-secreta"].join("");

interface Cenario {
  raiz: string;
  fora: string;
  dados: string;
  f: FachadaMapa;
  s: ServicoMapaCompleto;
}

function cenario(): Cenario {
  const raiz = pastaTmp("ade-mapa-hostil-");
  const fora = pastaTmp("ade-mapa-fora-");
  const dados = pastaTmp("ade-mapa-hostil-db-");
  pastas.push(raiz, fora, dados);
  const canario = join(fora, "CANARIO-EXECUTADO.txt");
  const grava = `require('fs').writeFileSync(${JSON.stringify(canario)}, 'executado')`;
  // ---- scripts que gravariam o canário SE fossem executados
  escrever(raiz, "package.json", JSON.stringify({ name: "hostil", main: "src/app.ts", scripts: { postinstall: `node -e "${grava}"`, build: `node -e "${grava}"`, test: "vitest" }, dependencies: { express: "^4.0.0" } }));
  escrever(raiz, ".dependency-cruiser.js", `${grava};\nmodule.exports = { forbidden: [] };\n`);
  escrever(raiz, "webpack.config.js", `${grava};\nmodule.exports = {};\n`);
  escrever(raiz, "Makefile", `all:\n\t@node -e "${grava}"\n\ninstall:\n\t@node -e "${grava}"\n`);
  escrever(raiz, "composer.json", JSON.stringify({ name: "x/y", scripts: { "post-install-cmd": `node -e "${grava}"` }, autoload: { "psr-4": { "Evil\\": "../" } } }));
  escrever(raiz, "bin/ctags", `#!/bin/sh\nnode -e "${grava}"\n`);
  escrever(raiz, "node_modules/.bin/ctags", `#!/bin/sh\nnode -e "${grava}"\n`);
  for (const c of ["bin/ctags", "node_modules/.bin/ctags"]) execFileSync("chmod", ["+x", join(raiz, c)]);
  // ---- arquivos que nunca podem ser abertos
  escrever(raiz, ".env", `SEGREDO=${ISCA_AMBIENTE}\n`);
  escrever(raiz, "config/.env.production", `SEGREDO=${ISCA_AMBIENTE}\n`);
  escrever(raiz, "chave.pem", `${ISCA_CHAVE}\n`);
  escrever(raiz, "deploy/id_rsa", `${ISCA_CHAVE}\n`);
  escrever(raiz, "certs/servidor.key", `${ISCA_CHAVE}\n`);
  // ---- fora da raiz: tsconfig/composer/go.mod com `..` e symlinks apontando para cá
  escrever(fora, "externo/segredo.ts", `export const FORA = "${ISCA_FORA}";\n`);
  escrever(fora, "externo/dados.txt", `${ISCA_FORA}\n`);
  escrever(raiz, "tsconfig.json", JSON.stringify({ extends: "../../../../../../../../etc/tsconfig.base.json", compilerOptions: { baseUrl: ".", paths: { "@fora/*": [`${fora}/externo/*`, "../../../../../../../../etc/*"] } } }));
  escrever(raiz, "go.mod", `module hostil\n\nreplace x => ../../../../../../../../etc\n`);
  mkdirSync(join(raiz, "src"), { recursive: true });
  symlinkSync(join(fora, "externo/segredo.ts"), join(raiz, "src/link-arquivo.ts"));
  symlinkSync(join(fora, "externo"), join(raiz, "src/link-pasta"));
  symlinkSync("/etc/passwd", join(raiz, "src/passwd.ts"));
  symlinkSync(join(raiz, "src"), join(raiz, "src/ciclo"));
  // ---- código com literais de segredo (nomes e posições podem ir ao mapa; o VALOR nunca)
  escrever(raiz, "src/app.ts", `import express from "express";\nimport { FORA } from "@fora/segredo";\nimport { ler } from "../../../../../../../../etc/passwd";\n\n/** Cliente. senha: ${SEGREDO_SENHA} e token ${SEGREDO_TOKEN}. */\nexport function conectar(token: string = "${SEGREDO_TOKEN}"): string {\n  const senha = "${SEGREDO_SENHA}";\n  return token + senha + FORA + ler;\n}\nconst app = express();\napp.get("/ping", (req, res) => res.send(conectar()));\n`);
  // ---- arquivo gigante (50 MB) e arquivo que castiga o parser
  writeFileSync(join(raiz, "src/gigante.ts"), Buffer.alloc(50 * 1024 * 1024, "export const x = 1;\n"));
  writeFileSync(join(raiz, "src/aninhado.ts"), `const a = ${"(".repeat(300_000)}1${")".repeat(300_000)};\n`);
  writeFileSync(join(raiz, "src/binario.ts"), Buffer.concat([Buffer.from("export const b = 1;\n"), Buffer.alloc(4096, 0), Buffer.from("fim\n")]));
  const s = criarServicoMapa({
    raiz,
    caminhoDb: join(dados, "mapas", "ws_h", "mapa.db"),
    workspaceId: "ws_h",
    caminhoWorkerExtracao: join(dist, "nucleo/mapa/worker-extracao.js"),
    caminhoWorkerDerivada: join(dist, "nucleo/mapa/worker-derivada.js"),
    derivada: "worker",
    tamanhoPool: 2,
    ferramentas: () => detectarFerramentas({ PATH: `${join(raiz, "bin")}:${join(raiz, "node_modules/.bin")}:/usr/bin` }, []),
  });
  servicos.push(s);
  const f = criarFachadaMapa(s, { raiz, pastaExportacao: join(dados, "mapas", "ws_h", "exportacoes"), escolherPasta: async () => join(raiz, "docs", "saida") });
  return { raiz, fora, dados, f, s };
}

function tudoQueFoiGravado(dir: string): string {
  const partes: string[] = [];
  const andar = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) andar(p);
      else partes.push(readFileSync(p).toString("latin1"));
    }
  };
  if (existsSync(dir)) andar(dir);
  return partes.join("\n");
}

describe("auditoria do mapa: repositório hostil", () => {
  it("não executa nada do projeto (canário), não abre ambiente/chave, não segue symlink para fora e contém arquivo gigante/hostil", async () => {
    const c = cenario();
    const t0 = performance.now();
    const r = await c.s.analisarEAguardar({ modo: "completo" });
    const ms = performance.now() - t0;
    console.log(`[seguranca] análise do repositório hostil em ${(ms / 1000).toFixed(1)} s; estado=${r.estado}; arquivos=${r.novos}; falhas=${r.falhas}`);
    expect(r.estado).toBe("concluida");
    expect(r.erro).toBeNull();
    expect(ms).toBeLessThan(90_000);
    // 1. canário: nada foi executado (nem scripts de package.json/composer, nem configs JS, nem Makefile, nem binários do projeto)
    expect(existsSync(join(c.fora, "CANARIO-EXECUTADO.txt"))).toBe(false);
    // 2. o que foi indexado
    const caminhos = c.s.armazem().banco.consultar<{ caminho: string }>("SELECT caminho FROM arquivo").map((l) => l.caminho);
    for (const proibido of [".env", "config/.env.production", "chave.pem", "deploy/id_rsa", "certs/servidor.key", "src/link-arquivo.ts", "src/passwd.ts", "src/gigante.ts"]) expect(caminhos, proibido).not.toContain(proibido);
    expect(caminhos.some((p) => p.startsWith("src/link-pasta/") || p.startsWith("src/ciclo/"))).toBe(false);
    expect(caminhos).toContain("src/app.ts");
    // 3. nenhum conteúdo proibido em NENHUMA tabela do banco
    const banco = c.s.armazem().banco;
    const tabelas = banco.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    const dump = tabelas.map((t) => JSON.stringify(banco.consultar(`SELECT * FROM ${t}`))).join("\n");
    for (const isca of [ISCA_AMBIENTE, ISCA_CHAVE, ISCA_FORA, SEGREDO_TOKEN, SEGREDO_SENHA]) expect(dump.includes(isca), `banco contém ${isca}`).toBe(false);
    // 4. `..` nos manifestos não escapou da raiz: nada de fora virou aresta nem nó
    const nos = banco.consultar<{ id: string }>("SELECT id FROM no").map((n) => n.id);
    expect(nos.some((n) => n.includes(c.fora) || n.includes("/etc/") || n.includes("passwd"))).toBe(false);
    // 5. o nome do arquivo que trava o parser aparece no máximo como arquivo com erro de análise (contido, sem derrubar)
    const aninhado = banco.consultarUm<{ erros_parse: number }>("SELECT erros_parse FROM arquivo WHERE caminho = 'src/aninhado.ts'");
    if (aninhado !== undefined) expect(aninhado.erros_parse).toBeGreaterThanOrEqual(0);
    expect(banco.consultarUm<{ quick_check: string }>("PRAGMA quick_check(1)")?.quick_check).toBe("ok");
  }, 180_000);

  it("pacote de contexto, exportações e respostas das consultas não contêm código, segredos nem caminho absoluto", async () => {
    const c = cenario();
    await c.s.analisarEAguardar({ modo: "completo" });
    const pacote = c.f.gerarPacote({ trabalho_id: "OC-9", arquivos: ["src/app.ts"] });
    for (const formato of ["mermaid", "dot", "svg", "json", "csv"] as const) await c.f.exportar(formato, { tipo: "grafo", nivel: "simbolo", filtro: { pasta: "src" } });
    await c.f.exportar("md", { tipo: "relatorio" });
    const gravado = [tudoQueFoiGravado(join(c.raiz, pacote.pasta_rel)), tudoQueFoiGravado(join(c.dados, "mapas", "ws_h", "exportacoes"))].join("\n");
    const respostas = JSON.stringify([c.f.grafo("simbolo", { pasta: "src" }), c.f.no("sim:src/app.ts#conectar"), c.f.raio(["src/app.ts"]), c.f.analise("entradas").dados, c.f.perfil(), c.f.buscar("conectar")]);
    for (const [nome, texto] of [["gravado", gravado], ["respostas", respostas]] as const) {
      for (const isca of [ISCA_AMBIENTE, ISCA_CHAVE, ISCA_FORA, SEGREDO_TOKEN, SEGREDO_SENHA]) expect(texto.includes(isca), `${nome} contém ${isca}`).toBe(false);
      expect(texto.includes(c.raiz), `${nome} contém a raiz absoluta`).toBe(false);
      expect(texto.includes("return token + senha"), `${nome} contém código-fonte`).toBe(false);
    }
    // a assinatura é sanitizada (literal de texto vira "…") e o nome da função continua lá
    expect(respostas).toContain("conectar");
  }, 180_000);

  it("pacote: `.pasta-do-produto` como symlink para fora é recusado e nada é gravado fora; exportar para docs/ é recusado", async () => {
    const c = cenario();
    await c.s.analisarEAguardar({ modo: "completo" });
    const alvoFora = join(c.fora, "pacote-fora");
    mkdirSync(alvoFora, { recursive: true });
    symlinkSync(alvoFora, join(c.raiz, PRODUTO.pastaNoProjeto));
    expect(() => c.f.gerarPacote()).toThrow(/symlink/);
    expect(readdirSync(alvoFora)).toEqual([]);
    mkdirSync(join(c.raiz, "docs"), { recursive: true });
    await expect(c.f.exportar("json", { tipo: "grafo", nivel: "modulo" }, "escolher")).rejects.toThrow(/não escreve em docs/);
    expect(existsSync(join(c.raiz, "docs", "saida"))).toBe(false);
  }, 180_000);

  it("leitor confinado: recusa absoluto, `..`, NUL, ambiente/chave e symlink que sai da raiz", () => {
    const raiz = pastaTmp("ade-mapa-conf-");
    const fora = pastaTmp("ade-mapa-conf-fora-");
    pastas.push(raiz, fora);
    escrever(raiz, "ok.txt", "ok");
    escrever(raiz, ".env", ISCA_AMBIENTE);
    escrever(fora, "segredo.txt", ISCA_FORA);
    symlinkSync(join(fora, "segredo.txt"), join(raiz, "atalho.txt"));
    symlinkSync(fora, join(raiz, "pasta-fora"));
    const l = criarLeitorConfinado(raiz);
    expect(l.ler("ok.txt")).toBe("ok");
    for (const ruim of [".env", "atalho.txt", "pasta-fora/segredo.txt", join(fora, "segredo.txt"), `../${relative(dirname(raiz), fora)}/segredo.txt`, "a\0b", "/etc/passwd", ""]) {
      expect(l.ler(ruim), JSON.stringify(ruim)).toBeNull();
      expect(l.existe(ruim), `existe ${JSON.stringify(ruim)}`).toBe(false);
    }
    expect(l.listar("pasta-fora")).toEqual([]);
    expect(l.listar("..")).toEqual([]);
    expect(l.listar(".")).not.toContain(".env");
  });

  it("TOCTOU: o worker confere o realpath contra a raiz na hora de ler (arquivo trocado por symlink depois da varredura)", async () => {
    const raiz = pastaTmp("ade-mapa-toctou-");
    const fora = pastaTmp("ade-mapa-toctou-fora-");
    pastas.push(raiz, fora);
    escrever(fora, "segredo.ts", `export const FORA = "${ISCA_FORA}";\n`);
    escrever(raiz, "bom.ts", "export const b = 1;\n");
    symlinkSync(join(fora, "segredo.ts"), join(raiz, "trocado.ts"));
    const lerReal = async (c: string): Promise<Buffer> => readFileSync(c);
    const ruim = await executarExtracao({ id: 1, tipo: "extrair", caminho_abs: join(raiz, "trocado.ts"), raiz, caminho: "trocado.ts", linguagem: "typescript" }, {}, lerReal);
    expect(ruim.ok).toBe(false);
    expect(JSON.stringify(ruim)).not.toContain(ISCA_FORA);
    if (!ruim.ok) expect(ruim.erro).toMatch(/fora da raiz/);
    const bom = await executarExtracao({ id: 2, tipo: "extrair", caminho_abs: join(raiz, "bom.ts"), raiz, caminho: "bom.ts", linguagem: "typescript" }, {}, lerReal);
    expect(bom.ok).toBe(true);
    const sensivel = await executarExtracao({ id: 3, tipo: "extrair", caminho_abs: join(raiz, ".env"), raiz, caminho: ".env", linguagem: "typescript" }, {}, lerReal);
    expect(sensivel.ok).toBe(false);
  });

  it("ferramentas opcionais: só PATH do sistema; nunca node_modules/.bin nem pasta do projeto; nada é executado", () => {
    const raiz = pastaTmp("ade-mapa-ferr-");
    const fora = pastaTmp("ade-mapa-ferr-fora-");
    pastas.push(raiz, fora);
    const grava = `require('fs').writeFileSync(${JSON.stringify(join(fora, "CANARIO.txt"))}, 'x')`;
    escrever(raiz, "node_modules/.bin/ctags", `#!/bin/sh\nnode -e "${grava}"\n`);
    escrever(raiz, "node_modules/.bin/scc", `#!/bin/sh\nnode -e "${grava}"\n`);
    for (const n of ["ctags", "scc"]) execFileSync("chmod", ["+x", join(raiz, "node_modules/.bin", n)]);
    const r = detectarFerramentas({ PATH: `${join(raiz, "node_modules/.bin")}` }, []);
    expect(r).toEqual({ ctags: false, scc: false, dot: false });
    expect(existsSync(join(fora, "CANARIO.txt"))).toBe(false);
  });

  it("zero rede: nenhum módulo do mapa (nem workers, serviço, fachada, MCP, IPC) importa módulo de rede nem chama fetch/XMLHttpRequest", () => {
    const REDE = /(?:from|require\(|import\()\s*["'](?:node:)?(?:http|https|http2|net|tls|dgram|dns|dns\/promises|worker_threads\/net)["']|\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(/;
    const arquivos: string[] = [];
    const andar = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) andar(p);
        else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) arquivos.push(p);
      }
    };
    andar(join(SRC, "nucleo/mapa"));
    arquivos.push(join(SRC, "main/mapa.ts"), join(SRC, "main/mapa-mcp.ts"), join(SRC, "main/ipc/mapa.ts"), join(SRC, "nucleo/mcp/tools/mapa.ts"));
    andar(join(SRC, "renderer/telas/mapa"));
    const violacoes = arquivos.filter((a) => REDE.test(readFileSync(a, "utf8"))).map((a) => relative(SRC, a));
    expect(violacoes).toEqual([]);
  });

  it("nenhum módulo do mapa executa processo do projeto: só `git` (leitura) pelo executor do VCS; sem child_process direto, eval nem shell", () => {
    const PERIGO = /child_process|\bexecSync\b|\bspawnSync\b|\bspawn\(|\bexecFile\(|new Function\(|\beval\(|shell:\s*true/;
    const lista: string[] = [];
    const andar = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) andar(p);
        else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n)) lista.push(p);
      }
    };
    andar(join(SRC, "nucleo/mapa"));
    lista.push(join(SRC, "main/mapa.ts"), join(SRC, "main/mapa-mcp.ts"), join(SRC, "main/ipc/mapa.ts"));
    const achados = lista.filter((a) => PERIGO.test(readFileSync(a, "utf8"))).map((a) => relative(SRC, a));
    expect(achados).toEqual([]);
  });
});
