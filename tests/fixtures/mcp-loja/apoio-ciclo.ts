// Apoio dos testes do ciclo de vida da Loja de MCPs (Fase 7B, onda B): catálogo sintético com servidores
// FALSOS, executor de npm FALSO (escreve a árvore que o npm escreveria, apontando para os servidores MCP
// falsos desta pasta) e um cofre REAL com cifrador falso (nunca o Keychain). Nada de rede, nada de pacote real.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { criarCofre, criarMotorSafeStorage, type Cofre } from "../../../src/nucleo/cofre";
import { criarCatalogo, type CatalogoCarregado } from "../../../src/nucleo/loja-mcp/catalogo";
import type { EntradaMcp } from "../../../src/nucleo/loja-mcp/esquema";
import type { Executor, PedidoExec, ResultadoExec } from "../../../src/nucleo/loja-mcp/executor";
import { integridadeSha512 } from "../../../src/nucleo/loja-mcp/integridade";
import { PASTA_FALSOS } from "./servidores";

export const SEED = join(PASTA_FALSOS, "..", "..", "..", "resources", "mcp", "catalogo-mcps.json");
export const SENTINELA_SEGREDO = "chave-valida";

const pastas: string[] = [];
export function novaPasta(prefixo = "loja-b-"): string {
  const p = mkdtempSync(join(tmpdir(), prefixo));
  pastas.push(p);
  return p;
}
export function limparPastas(): void { while (pastas.length) rmSync(pastas.pop() as string, { recursive: true, force: true }); }

export const INTEGRIDADE_FALSA = integridadeSha512("pacote-falso-conteudo");
export const MODO_POR_PACOTE: Record<string, string> = {
  "@falso/ok": "ok", "@falso/chave": "exige-variavel", "@falso/lento": "lento", "@falso/vazio": "vazio", "@falso/crash": "crash", "@falso/eco": "eco-ambiente",
};

function semente(): { raiz: Record<string, unknown>; modelo: EntradaMcp } {
  const raiz = JSON.parse(readFileSync(SEED, "utf8")) as { entradas: EntradaMcp[] };
  return { raiz, modelo: raiz.entradas.find((e) => e.id === "context7") as EntradaMcp };
}

export function entradaNpmFalsa(id: string, pacote: string, extra: Partial<EntradaMcp> = {}): EntradaMcp {
  const { modelo } = semente();
  const e = JSON.parse(JSON.stringify(modelo)) as EntradaMcp;
  e.id = id;
  e.nome = `Falso ${id}`;
  e.classificacao = "opcional";
  e.instalacao = { ...e.instalacao, pacote, versao: "1.0.0", integridade: INTEGRIDADE_FALSA, data_versao: "2026-09-30" };
  e.bin = "servidor.mjs";
  e.args = [];
  e.variaveis = [];
  e.autenticacao = "nenhuma";
  return Object.assign(e, extra);
}

/** Catálogo sintético: os 3 do Kit do seed + servidores falsos (ok, chave obrigatória, lento, vazio, crash, eco) + um remoto falso. */
export function catalogoFalso(extras: EntradaMcp[] = [], seedVersao = "teste.1"): CatalogoCarregado {
  const { raiz } = semente();
  const todas = (raiz as { entradas: EntradaMcp[] }).entradas;
  const manter = todas.filter((e) => ["context7", "deepwiki", "sequential-thinking", "git", "filesystem", "fetch"].includes(e.id));
  const chave = entradaNpmFalsa("falso-chave", "@falso/chave", {
    autenticacao: "chave_api",
    variaveis: [{ nome: "FALSO_API_KEY", obrigatoria: true, secreta: true, ajuda: "chave de teste", onde_conseguir: "https://example.com/chave" }],
  });
  const opcionalPublica = entradaNpmFalsa("falso-publica", "@falso/ok", {
    variaveis: [{ nome: "FALSO_PROJETO", obrigatoria: false, secreta: false, ajuda: "id de projeto", onde_conseguir: null }],
  });
  const deepwiki = JSON.parse(JSON.stringify(todas.find((e) => e.id === "deepwiki"))) as EntradaMcp;
  deepwiki.id = "falso-remoto";
  deepwiki.nome = "Falso remoto";
  deepwiki.classificacao = "opcional";
  const padrao = [...manter, entradaNpmFalsa("falso-ok", "@falso/ok"), chave, opcionalPublica, entradaNpmFalsa("falso-lento", "@falso/lento"),
    entradaNpmFalsa("falso-vazio", "@falso/vazio"), entradaNpmFalsa("falso-crash", "@falso/crash"), entradaNpmFalsa("falso-eco", "@falso/eco"), deepwiki];
  // `extras` com id já existente SUBSTITUI a entrada (simula nova versão do seed).
  const ids = new Set(extras.map((x) => x.id));
  const doc = { schema_version: 1, seed_versao: seedVersao, gerado_em: "2026-10-01", fonte: "teste", entradas: [...padrao.filter((x) => !ids.has(x.id)), ...extras] };
  return criarCatalogo(doc, "teste");
}

export interface ExecutorFalso extends Executor {
  chamadas: PedidoExec[];
  /** Força o resultado da próxima chamada (ex.: código 1, timeout). */
  proximo: Array<Partial<ResultadoExec> | ((p: PedidoExec) => Partial<ResultadoExec> | void)>;
  /** Altera a integridade gravada na árvore falsa (simula pacote adulterado). */
  integridadeGravada: string | null;
  /** Não cria o executável (simula instalação incompleta). */
  semBin: boolean;
}

/** Integridade do pacote no catálogo (quando informado), senão a falsa padrão. */
function integridadeDe(cat: CatalogoCarregado | undefined, pacote: string): string {
  const e = cat?.entradas.find((x) => x.entrada.instalacao.pacote === pacote)?.entrada;
  return e?.instalacao.integridade ?? INTEGRIDADE_FALSA;
}

const OK: ResultadoExec = { codigo: 0, saida: "", erro: "", timeout: false, abortado: false, excedeu_saida: false, nao_iniciou: false };

/** Executor que finge `npm install|ci --prefix <tmp>`: escreve `node_modules/.bin/<bin>` (importa o servidor falso) e o lock. */
export function executorNpmFalso(catalogo?: CatalogoCarregado): ExecutorFalso {
  const ex: ExecutorFalso = {
    chamadas: [], proximo: [], integridadeGravada: null, semBin: false,
    async rodar(p: PedidoExec): Promise<ResultadoExec> {
      ex.chamadas.push({ ...p, args: [...p.args], env: { ...p.env } });
      const forcado = ex.proximo.shift();
      if (forcado) { const r = typeof forcado === "function" ? forcado(p) : forcado; if (r) return { ...OK, ...r }; }
      const i = p.args.indexOf("--prefix");
      const prefixo = i >= 0 ? p.args[i + 1]! : p.cwd!;
      const pkg = JSON.parse(readFileSync(join(prefixo, "package.json"), "utf8")) as { dependencies: Record<string, string> };
      const [pacote] = Object.keys(pkg.dependencies);
      const modo = MODO_POR_PACOTE[pacote!] ?? "ok";
      const bin = join(prefixo, "node_modules", ".bin");
      mkdirSync(bin, { recursive: true });
      const nomeBin = catalogo?.entradas.find((x) => x.entrada.instalacao.pacote === pacote)?.entrada.bin ?? "servidor.mjs";
      if (!ex.semBin) writeFileSync(join(bin, nomeBin), `import ${JSON.stringify(pathToFileURL(join(PASTA_FALSOS, `${modo}.mjs`)).href)};\n`);
      writeFileSync(join(prefixo, "node_modules", ".package-lock.json"), JSON.stringify({ packages: { [`node_modules/${pacote}`]: { integrity: ex.integridadeGravada ?? integridadeDe(catalogo, pacote!) } } }));
      return { ...OK };
    },
  };
  return ex;
}

const portaFalsa = {
  disponivel: () => true,
  backend: () => null as string | null,
  cifrar: (t: string) => Buffer.from(`enc:${Buffer.from(t).reverse().toString("base64")}`),
  decifrar: (b: Uint8Array) => Buffer.from(Buffer.from(b).toString().slice(4), "base64").reverse().toString(),
};

/** Cofre real (arquivo temporário) com cifrador falso. */
export function cofreDeTeste(dir: string): Cofre {
  return criarCofre({ arquivo: join(dir, "cofre.json"), motor: criarMotorSafeStorage(portaFalsa) });
}
