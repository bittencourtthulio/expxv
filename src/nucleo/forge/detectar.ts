import type { ExecutorVcs } from "../vcs/executor";
import { executorPadrao } from "../vcs/executor";
import { arr, obj, parseJson, parseRemoto, provedorPorHost, RunnerCli, semSegredos, str } from "./comum";
import { ForgeCliAusenteErro, INSTALACAO } from "./erros";
import type { ContaForge, EstadoForge, OpcoesLeitura, ProvedorForge, RepoRef } from "./forge";

// T-06.17 · Detecção e autenticação. Só lê o que a CLI imprime sobre CONTAS (host, usuário, ativa); linhas de token são
// descartadas antes de qualquer parse e `--show-token` nunca é usado. Sem a CLI: estado claro + instrução + modo degradado.

export interface OpcoesDetectar extends OpcoesLeitura {
  executor?: ExecutorVcs;
  /** Caminho/nome do executável da CLI (padrão `gh`/`glab`). */
  executavel?: string;
  env?: Record<string, string>;
}

/** Parse tolerante de `gh --version`/`glab --version`. */
export function parseVersao(texto: string): string | null {
  return /(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)/.exec(texto)?.[1] ?? null;
}

/** Remove linhas que carregam token antes de qualquer outro processamento ("Token scopes" é público e fica). */
function semLinhasDeToken(texto: string): string {
  return texto
    .split("\n")
    .filter((l) => !/\btoken\b/i.test(l) || /token scopes/i.test(l))
    .join("\n");
}

/** `gh auth status` (texto ou `--json hosts`) e `glab auth status` → contas. Nunca devolve token. */
export function parseAuthStatus(bruto: string): ContaForge[] {
  if (bruto.trim().startsWith("{")) {
    const j = obj(parseJson(bruto.trim())); // só login/host/ativa/protocolo são lidos; o campo de token nunca é tocado
    const contas: ContaForge[] = [];
    for (const [host, lista] of Object.entries(obj(j.hosts))) {
      for (const c of arr(lista)) {
        const o = obj(c);
        if (str(o.state) !== "" && str(o.state) !== "success") continue;
        const conta: ContaForge = { host: str(o.host, host), usuario: str(o.login) || null, ativa: o.active === true };
        const p = str(o.gitProtocol);
        if (p) conta.protocolo = p;
        contas.push(conta);
      }
    }
    return contas;
  }
  const texto = semLinhasDeToken(bruto).trim();
  const contas: ContaForge[] = [];
  let host = "";
  let atual: ContaForge | null = null;
  for (const linha of texto.split("\n")) {
    const t = linha.trim();
    if (t === "") continue;
    if (!/^\s/.test(linha) && /^[A-Za-z0-9.-]+(:\d+)?$/.test(t)) {
      host = t.toLowerCase();
      atual = null;
      continue;
    }
    const logou = /Logged in to (\S+?)(?: account (\S+)| as (\S+))/i.exec(t);
    if (logou) {
      atual = { host: (logou[1] ?? host).toLowerCase(), usuario: (logou[2] ?? logou[3] ?? "").replace(/[()]/g, "") || null, ativa: !/account/i.test(t) };
      contas.push(atual);
      continue;
    }
    const ativa = /Active account:\s*(true|false)/i.exec(t);
    if (ativa && atual) atual.ativa = ativa[1]?.toLowerCase() === "true";
    const proto = /Git operations protocol:\s*(\w+)/i.exec(t) ?? /configured to use (\w+) protocol/i.exec(t);
    if (proto && atual) atual.protocolo = proto[1]!.toLowerCase();
  }
  return contas;
}

/** Instrução do próximo passo (nunca com segredo). */
function instrucaoDe(provedor: ProvedorForge, cliInstalada: boolean, autenticado: boolean, host: string): string | null {
  if (!cliInstalada) return INSTALACAO[provedor];
  if (autenticado) return null;
  if (provedor === "github") return `Rode \`gh auth login --hostname ${host}\` no terminal; o app nunca guarda nem pede senha ou token.`;
  if (provedor === "gitlab") return `Rode \`glab auth login --hostname ${host}\` no terminal; o app nunca guarda nem pede senha ou token.`;
  return INSTALACAO[provedor];
}

/** Estado da CLI do provedor (gh/glab) para o host do repositório. */
export async function estadoCli(provedor: "github" | "gitlab", repo: RepoRef | null, cwd: string, op: OpcoesDetectar = {}): Promise<EstadoForge> {
  const nome = provedor === "github" ? "gh" : "glab";
  const cfg: ConstructorParameters<typeof RunnerCli>[0] = { provedor, cwd, executor: op.executor ?? executorPadrao };
  if (op.executavel) cfg.executavel = op.executavel;
  if (op.env) cfg.env = op.env;
  const runner = new RunnerCli(cfg);
  const base: EstadoForge = { provedor, cli: { nome, instalada: false, versao: null }, autenticado: false, contas: [], repo, degradado: true, instrucao: instrucaoDe(provedor, false, false, repo?.host ?? "") };
  const opc = op.signal ? { signal: op.signal } : {};
  let versao: string | null;
  try {
    const v = await runner.rodar(["--version"], { ...opc, timeoutMs: 8000 });
    if (v.codigo !== 0) return base;
    versao = parseVersao(v.stdout);
  } catch (e) {
    if (e instanceof ForgeCliAusenteErro) return base;
    throw e;
  }
  const auth = await runner.rodar(["auth", "status"], { ...opc, timeoutMs: 15_000 });
  const contas = parseAuthStatus(`${auth.stdout}\n${auth.stderr}`);
  const doHost = repo ? contas.filter((c) => c.host === repo.host.toLowerCase()) : contas;
  // várias contas no mesmo host: vale a ATIVA (nunca troca sozinho); sem marcação (glab), a única conta do host.
  const ativaDoHost = doHost.find((c) => c.ativa) ?? (provedor === "gitlab" && doHost.length === 1 ? doHost[0] : undefined);
  const autenticado = ativaDoHost !== undefined;
  return { provedor, cli: { nome, instalada: true, versao }, autenticado, contas: contas.map((c) => ({ ...c, usuario: c.usuario === null ? null : semSegredos(c.usuario) })), repo, degradado: !autenticado, instrucao: instrucaoDe(provedor, true, autenticado, repo?.host ?? "") };
}

export interface OpcoesDetectarRepo extends OpcoesDetectar {
  /** Hosts self-hosted/Enterprise por provedor (config do usuário). */
  hostsExtras?: Partial<Record<ProvedorForge, readonly string[]>>;
  /** Remoto preferido (padrão `origin`, senão o primeiro). */
  remoto?: string;
}

/** Remoto do repositório → provedor + `owner/repo`. Credenciais embutidas na URL são descartadas. */
export async function descobrirRepo(cwd: string, op: OpcoesDetectarRepo = {}): Promise<{ provedor: ProvedorForge | null; repo: RepoRef | null; remoto: string | null }> {
  const executor = (op.executor ?? executorPadrao).comConfianca("nao_confiavel");
  const nomes = (await executor.executar(["remote"], { cwd, tolerar: [128, 1], ...(op.signal ? { signal: op.signal } : {}) })).stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  const nome = nomes.includes(op.remoto ?? "origin") ? (op.remoto ?? "origin") : nomes[0];
  if (nome === undefined) return { provedor: null, repo: null, remoto: null };
  const url = (await executor.executar(["remote", "get-url", "--", nome], { cwd, tolerar: [128, 1, 2] })).stdout.trim();
  const repo = parseRemoto(url);
  if (!repo) return { provedor: null, repo: null, remoto: nome };
  return { provedor: provedorPorHost(repo.host, op.hostsExtras), repo, remoto: nome };
}
