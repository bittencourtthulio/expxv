import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { GitErro } from "../../git/erros";
import { caminhoSeguro, rodarGit, type OpcoesBase } from "./comum";
import { OperacaoRecusadaErro } from "./guardas";
import { rodarRemoto, semCredenciais, classificarErroRemoto, type OpcoesRede } from "./remotos";

// T-06.15 · Submódulos: detectar e DEGRADAR com aviso (aparecem como ponteiro; nada é baixado nem inicializado sozinho).
// `submodule update --init` é operação explícita, com confirmação (usa a rede), `protocol.file.allow=user` e
// `protocol.ext.allow=never` (uma URL `ext::` do .gitmodules nunca executa comando).

export type EstadoSubmodulo = "nao-inicializado" | "atual" | "divergente" | "conflito";

export interface Submodulo {
  caminho: string;
  /** Commit registrado no repositório principal (o ponteiro). */
  hash: string;
  estado: EstadoSubmodulo;
  /** URL do .gitmodules, sem credenciais. */
  url: string | null;
  /** Commit atual dentro do submódulo (quando inicializado). */
  hashAtual: string | null;
  aviso: string | null;
}

const AVISO: Record<EstadoSubmodulo, string | null> = {
  "nao-inicializado": "Submódulo não inicializado: mostrado só como ponteiro (nenhum arquivo dele foi baixado). Inicializar usa a rede e pede confirmação.",
  atual: null,
  divergente: "O submódulo está em outro commit que o registrado: mudanças dentro dele não aparecem no diff do projeto, só o ponteiro.",
  conflito: "Conflito no ponteiro do submódulo: escolha o commit (nossa/deles) para resolver.",
};

async function existe(p: string): Promise<boolean> {
  return lstat(p).then(() => true, () => false);
}

export async function listarSubmodulos(raiz: string, op: OpcoesBase = {}): Promise<Submodulo[]> {
  const ls = await rodarGit(raiz, ["ls-files", "-s", "-z"], { ...op, maxBytes: 64 * 1024 * 1024 });
  const links = new Map<string, string>();
  for (const reg of ls.stdout.split("\0")) {
    const m = /^160000 ([0-9a-f]+) (\d)\t([\s\S]+)$/.exec(reg);
    if (m) links.set(m[3] as string, m[1] as string);
  }
  if (links.size === 0) return [];
  const conflito = new Set<string>();
  const un = await rodarGit(raiz, ["ls-files", "-u", "-z"], op);
  for (const reg of un.stdout.split("\0")) {
    const m = /^160000 [0-9a-f]+ \d\t([\s\S]+)$/.exec(reg);
    if (m) conflito.add(m[1] as string);
  }
  const urls = new Map<string, string>();
  const cfg = await rodarGit(raiz, ["config", "-z", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.(path|url)$"], { ...op, tolerar: [1, 128] });
  const porNome = new Map<string, { path?: string; url?: string }>();
  for (const reg of cfg.stdout.split("\0")) {
    const nl = reg.indexOf("\n");
    const m = /^submodule\.(.+)\.(path|url)$/.exec(nl < 0 ? "" : reg.slice(0, nl));
    if (!m) continue;
    const e = porNome.get(m[1] as string) ?? {};
    e[m[2] as "path" | "url"] = reg.slice(nl + 1);
    porNome.set(m[1] as string, e);
  }
  for (const e of porNome.values()) if (e.path !== undefined && e.url !== undefined) urls.set(e.path, semCredenciais(e.url));
  const out: Submodulo[] = [];
  for (const [caminho, hash] of links) {
    let estado: EstadoSubmodulo;
    let hashAtual: string | null = null;
    if (conflito.has(caminho)) estado = "conflito";
    else if (!(await existe(join(raiz, caminho, ".git")))) estado = "nao-inicializado";
    else {
      const r = await rodarGit(join(raiz, caminho), ["rev-parse", "--verify", "--quiet", "HEAD"], { ...op, tolerar: [1, 128] }).catch(() => null);
      hashAtual = r !== null && r.codigo === 0 ? r.stdout.trim() : null;
      estado = hashAtual === hash ? "atual" : "divergente";
    }
    out.push({ caminho, hash, estado, url: urls.get(caminho) ?? null, hashAtual, aviso: AVISO[estado] });
  }
  return out.sort((a, b) => a.caminho.localeCompare(b.caminho));
}

/** O git recusou o protocolo da URL do submódulo (ex.: `file` em submódulo, `ext`): bloqueio de segurança, não falha de rede. */
export class ProtocoloBloqueadoErro extends GitErro {
  override name = "ProtocoloBloqueadoErro";
  constructor(readonly protocolo: string) {
    super(`O protocolo "${protocolo}" do submódulo foi bloqueado por segurança.${protocolo === "file" ? " Se o caminho local é confiável, repita com permitirArquivoLocal." : ""}`);
  }
}

/**
 * `git submodule update --init` (rede): exige `confirmado: true`. Sem `caminho`, todos os submódulos listados.
 * Nunca recursivo; o caminho precisa ser um submódulo conhecido.
 */
export async function inicializarSubmodulos(raiz: string, opcoes: OpcoesRede & { confirmado: boolean; caminho?: string; permitirArquivoLocal?: boolean }): Promise<{ inicializados: string[] }> {
  const { confirmado, caminho, permitirArquivoLocal, ...op } = opcoes;
  if (confirmado !== true) throw new OperacaoRecusadaErro("Inicializar submódulos usa a rede: confirme explicitamente.", "confirmacao-invalida");
  const lista = await listarSubmodulos(raiz, op);
  let alvo = lista.filter((s) => s.estado === "nao-inicializado");
  if (caminho !== undefined) {
    const c = caminhoSeguro(caminho);
    const achado = lista.find((s) => s.caminho === c);
    if (achado === undefined) throw new GitErro(`${c} não é um submódulo deste repositório.`);
    alvo = [achado];
  }
  if (alvo.length === 0) return { inicializados: [] };
  const r = await rodarRemoto(raiz, ["-c", `protocol.file.allow=${permitirArquivoLocal === true ? "always" : "user"}`, "-c", "protocol.ext.allow=never", "submodule", "update", "--init", "--", ...alvo.map((s) => s.caminho)], { ...op, timeoutMs: op.timeoutMs ?? 120_000 });
  if (/transport '(\w+)' not allowed/i.test(r.stderr)) throw new ProtocoloBloqueadoErro(/transport '(\w+)' not allowed/i.exec(r.stderr)?.[1] ?? "?");
  if (r.codigo !== 0) throw classificarErroRemoto(r.stderr, alvo[0]?.caminho) ?? new GitErro(`submodule update falhou (${r.codigo}): ${semCredenciais(r.stderr.trim().split("\n").slice(-1)[0] ?? "")}`, [], r.codigo, semCredenciais(r.stderr));
  return { inicializados: alvo.map((s) => s.caminho) };
}
