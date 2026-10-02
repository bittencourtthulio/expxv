// Prechecagens úteis ANTES de rodar (D-581): `node_modules` ausente, Python sem ambiente virtual, Docker ou outro programa fora do PATH.
// SÓ LEITURA: nada é executado nem instalado; o que existe é um pré-passo SUGERIDO que o usuário pode adicionar à configuração com um clique.
import { leitorEm, type LeitorProjeto } from "./detectar";
import type { ConfigExecucao, PassoExecucao } from "./modelo";

export interface AvisoExecucao {
  codigo: "sem_node_modules" | "sem_venv" | "sem_docker" | "sem_programa";
  /** linguagem simples, em português */
  mensagem: string;
  /** pré-passo opcional que resolve o aviso (`npm install`); `null` quando é preciso instalar algo por fora */
  pre_passo: PassoExecucao | null;
}

export interface AmbientePrechecagem {
  /** o programa existe no PATH (o main usa `resolverExecutavel`; o teste injeta)? Ausente = não confere programas */
  programaNoPath?: (nome: string) => boolean;
}

const GERENCIADORES = new Set(["npm", "pnpm", "yarn", "bun"]);
const SUBCOMANDOS_INSTALAR = new Set(["install", "i", "ci", "add"]);
const PYTHON = /^python(3(\.\d+)?)?$/;

const json = (t: string | null): Record<string, unknown> | null => {
  if (t === null) return null;
  try { const v = JSON.parse(t) as unknown; return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null; } catch { return null; }
};

const ehInstalacao = (p: PassoExecucao): boolean =>
  (GERENCIADORES.has(p.executavel) && (p.argumentos[0] === undefined ? p.executavel === "yarn" : SUBCOMANDOS_INSTALAR.has(p.argumentos[0]))) || /^(uv|poetry|pip3?|pipenv)$/.test(p.executavel);

/** Avisos da configuração, na ordem em que o usuário os resolveria. `[]` = nada a avisar. */
export function prechecar(raiz: LeitorProjeto, cfg: Pick<ConfigExecucao, "executavel" | "argumentos" | "cwd" | "pre_passos" | "shell">, amb: AmbientePrechecagem = {}): AvisoExecucao[] {
  const avisos: AvisoExecucao[] = [];
  const passos: PassoExecucao[] = [...cfg.pre_passos, ...(cfg.shell === null ? [{ executavel: cfg.executavel, argumentos: cfg.argumentos }] : [])];
  const pasta = cfg.cwd === "" || cfg.cwd === "." ? raiz : leitorEm(raiz, cfg.cwd);
  const rotuloPasta = cfg.cwd === "" || cfg.cwd === "." ? "do projeto" : `de ${cfg.cwd}`;
  const jaInstala = cfg.pre_passos.some(ehInstalacao);

  // ---- Node: dependências instaladas?
  const usaNode = passos.find((p) => GERENCIADORES.has(p.executavel) && !ehInstalacao(p));
  if (usaNode !== undefined && !jaInstala && pasta.existe("package.json")) {
    const pkg = json(pasta.ler("package.json"));
    const temDeps = Object.keys((pkg?.["dependencies"] as object | undefined) ?? {}).length + Object.keys((pkg?.["devDependencies"] as object | undefined) ?? {}).length > 0;
    // em workspaces as dependências sobem para o `node_modules` da raiz
    const instalado = pasta.existe("node_modules") || raiz.existe("node_modules");
    if (temDeps && !instalado) {
      const pm = usaNode.executavel;
      avisos.push({
        codigo: "sem_node_modules",
        mensagem: `A pasta ${rotuloPasta} ainda não tem node_modules. Rode "${pm} install" primeiro (ou adicione como pré-passo).`,
        pre_passo: { executavel: pm, argumentos: ["install"] },
      });
    }
  }

  // ---- Python: ambiente virtual?
  const usaPython = passos.find((p) => PYTHON.test(p.executavel));
  if (usaPython !== undefined && !jaInstala) {
    const projetoPython = pasta.existe("pyproject.toml") || pasta.existe("requirements.txt") || pasta.existe("Pipfile") || pasta.existe("setup.py");
    const temVenv = [".venv", "venv", "env"].some((n) => pasta.existe(n) && pasta.listar(n).includes("pyvenv.cfg")) || [".venv", "venv"].some((n) => raiz.existe(n));
    if (projetoPython && !temVenv) {
      const uv = pasta.existe("uv.lock");
      avisos.push({
        codigo: "sem_venv",
        mensagem: uv
          ? `Python sem ambiente virtual ${rotuloPasta}. Rode "uv sync" para criar o .venv e instalar as dependências.`
          : `Python sem ambiente virtual ${rotuloPasta}. Crie um (python3 -m venv .venv) e instale as dependências antes de rodar.`,
        pre_passo: uv ? { executavel: "uv", argumentos: ["sync"] } : null,
      });
    }
  }

  // ---- programas fora do PATH (sem executar nada: só procura)
  if (amb.programaNoPath !== undefined) {
    const vistos = new Set<string>();
    for (const p of passos) {
      const nome = p.executavel;
      if (nome.includes("/") || vistos.has(nome)) continue;
      vistos.add(nome);
      if (amb.programaNoPath(nome)) continue;
      avisos.push(nome === "docker"
        ? { codigo: "sem_docker", mensagem: "O Docker não foi encontrado nesta máquina. Instale o Docker Desktop e abra-o antes de rodar.", pre_passo: null }
        : { codigo: "sem_programa", mensagem: `O programa "${nome}" não foi encontrado no PATH desta máquina. Instale-o antes de rodar.`, pre_passo: null });
    }
  }
  return avisos;
}
