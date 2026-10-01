import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ExecutorVcs } from "../../../src/nucleo/vcs/executor";

// Ajudantes dos testes de forge: CLI falsa com cenário JSON + log de argv. Nenhum teste fala com a rede nem usa `gh` de verdade.

export interface RegraFake {
  quando?: string[];
  regex?: string;
  stdinContem?: string;
  saida?: unknown;
  arquivo?: string;
  stderr?: string;
  codigo?: number;
  bytes?: number;
}
export interface Fake {
  dir: string;
  cwd: string;
  gh: string;
  glab: string;
  env: Record<string, string>;
  executor: ExecutorVcs;
  chamadas(): Array<{ nome: string; argv: string[]; stdin: string; promptOff: boolean; semCor: boolean }>;
  definir(regras: RegraFake[]): void;
  limpar(): void;
}
const FIXTURES = resolve(__dirname);

export function criarFake(regras: RegraFake[] = []): Fake {
  const dir = mkdtempSync(join(tmpdir(), "forge-fake-"));
  const cwd = join(dir, "repo");
  mkdirSync(cwd);
  const cenario = join(dir, "cenario.json");
  const logArq = join(dir, "log.jsonl");
  writeFileSync(cenario, JSON.stringify({ regras }));
  writeFileSync(logArq, "");
  return {
    dir,
    cwd,
    gh: join(FIXTURES, "bin", "gh"),
    glab: join(FIXTURES, "bin", "glab"),
    env: { FORGE_FAKE_CENARIO: cenario, FORGE_FAKE_LOG: logArq },
    executor: new ExecutorVcs({ ambienteBase: () => ({ PATH: process.env.PATH ?? "", HOME: dir }) }),
    chamadas: () =>
      readFileSync(logArq, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    definir: (r) => writeFileSync(cenario, JSON.stringify({ regras: r })),
    limpar: () => rmSync(dir, { recursive: true, force: true }),
  };
}
export const fixtureJson = (rel: string): unknown => JSON.parse(readFileSync(join(FIXTURES, rel), "utf8"));
