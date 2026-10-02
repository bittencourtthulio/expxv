// Cenário compartilhado dos testes do instalador da suíte (não é um teste): projeto de fixture copiado para uma pasta temporária, `npm` e `expxdev` FALSOS
// no PATH, ambiente montado como o app monta, e registro das chamadas feitas aos falsos. Sem rede.
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { matarArvoreDaPasta, registrarPasta } from "../limpeza";
import { executarInstalacao, type DependenciasInstalador, type ResultadoInstalacao } from "../../src/nucleo/suite/instalador";
import { criarManifesto, type ResultadoManifesto } from "../../src/nucleo/suite/manifesto";
import type { ProgressoSuite } from "../../src/nucleo/suite/modelo";
import { ambienteDoInstalador } from "../../src/nucleo/suite/plano";
import { executarProcesso, type PedidoProcesso } from "../../src/nucleo/suite/processo";

export const FIX = resolve(__dirname, "../fixtures/suite");

export interface Opc {
  projeto?: string;
  npm?: string;
  init?: string;
  /** variáveis extras no ambiente de ORIGEM (as hostis que o instalador precisa descartar) */
  extraAmbiente?: Record<string, string>;
  path?: string;
  sonda?: NonNullable<DependenciasInstalador["sondarRegistro"]>;
  total?: number;
  silencio?: number;
  versao?: string;
  semPermissao?: boolean;
  ambienteBruto?: Record<string, string>;
}

export interface Cenario {
  dir: string;
  raiz: string;
  deps: DependenciasInstalador;
  pedidos: PedidoProcesso[];
  eventos: ProgressoSuite[];
  antes: ResultadoManifesto;
  ac: AbortController;
  chamadas(): Array<Record<string, unknown>>;
  rodar(): Promise<ResultadoInstalacao>;
  tmpPai: string;
  pastaBackups: string;
  backups(): string[];
}

export function criarAmbienteDeTeste(prefixo = "suite-teste-") {
  const base = realpathSync(mkdtempSync(join(tmpdir(), prefixo)));
  registrarPasta(base);
  let n = 0;
  const pastasSemPermissao: string[] = [];
  const liberarPermissoes = (): void => { for (const p of pastasSemPermissao.splice(0)) { try { chmodSync(p, 0o755); } catch { /* já removida */ } } };
  const encerrar = (): void => {
    matarArvoreDaPasta(base);
    liberarPermissoes();
    for (const p of readdirSync(base)) { try { chmodSync(join(base, p), 0o755); } catch { /* ok */ } }
    rmSync(base, { recursive: true, force: true });
  };

  async function cenario(o: Opc = {}): Promise<Cenario> {
    n += 1;
    const dir = join(base, `c${n}`);
    mkdirSync(join(dir, "tmp"), { recursive: true });
    mkdirSync(join(dir, "home"), { recursive: true });
    const raiz = join(dir, "proj");
    cpSync(join(FIX, "projetos", o.projeto ?? "ausente"), raiz, { recursive: true });
    if (o.semPermissao) { chmodSync(raiz, 0o555); pastasSemPermissao.push(raiz); }
    const log = join(dir, "chamadas.jsonl");
    const origem: NodeJS.ProcessEnv = {
      PATH: o.path ?? `${join(FIX, "npm-falso")}:${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: join(dir, "home"), FAKE_LOG: log, FAKE_NPM_MODO: o.npm ?? "ok", FAKE_INIT_MODO: o.init ?? "ok",
      ORCA_TOKEN_X: "orca", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "s", NPM_TOKEN: "segredo-npm", MEU_API_KEY: "k", npm_config_registry: "https://evil.example/", NODE_OPTIONS: "--require /evil.js",
      ...(o.extraAmbiente ?? {}),
    };
    const ambiente = o.ambienteBruto ?? ambienteDoInstalador({ origem, inicio: join(dir, "home") });
    const pedidos: PedidoProcesso[] = [];
    const eventos: ProgressoSuite[] = [];
    const antes = await criarManifesto(raiz);
    const ac = new AbortController();
    const deps: DependenciasInstalador = {
      workspace_id: "ws_teste", instalacao_id: "inst_1", raiz, modo: "instalar", versao: o.versao ?? "0.9.0", ambienteOrigem: origem, ambiente, inicio: join(dir, "home"),
      pastaDados: join(dir, "dados"), pastaTemporaria: join(dir, "tmp"),
      executar: (p) => { pedidos.push(p); return executarProcesso(p); },
      sondarRegistro: o.sonda ?? (async () => ({ ok: true })),
      tempoTotalMs: o.total ?? 30_000, silencioMs: o.silencio ?? 20_000,
      aoMudar: (p) => eventos.push(p),
    };
    const chamadas = (): Array<Record<string, unknown>> => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : []);
    const pastaBackups = join(dir, "dados", "suite", "backups", "ws_teste");
    const backups = (): string[] => (existsSync(pastaBackups) ? readdirSync(pastaBackups) : []);
    return { dir, raiz, deps, pedidos, eventos, antes, ac, chamadas, rodar: () => executarInstalacao(deps, ac.signal), tmpPai: join(dir, "tmp"), pastaBackups, backups };
  }

  const esperarLog = async (c: Pick<Cenario, "eventos">, trecho: string, ms = 25_000): Promise<void> => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) { if (c.eventos.some((e) => e.log.some((l) => l.includes(trecho)))) return; await new Promise((r) => setTimeout(r, 20)); }
    throw new Error(`log nunca mostrou "${trecho}"`);
  };

  return { base, cenario, esperarLog, liberarPermissoes, encerrar, proximo: (): number => { n += 1; return n; } };
}
