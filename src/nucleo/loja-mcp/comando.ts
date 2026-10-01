// Comando completo e permissões a exibir antes de instalar (Fase 7B, T-07B.07). Funções puras: montam o
// comando EXATO, a pasta isolada, os hosts de rede e as variáveis (secretas só pelo NOME) sem executar nada.
// `montarComando` devolve a especificação que o coordenador liga a `terminais/catalogo.ts`.

import { statSync } from "node:fs";
import { posix, win32 } from "node:path";
import { nivelVerificacao, placeholdersDe, type EntradaMcp, type NivelVerificacao, type RiscoMcp, type VariavelMcp } from "./esquema";

export class ErroComando extends Error {
  readonly codigo: "id_invalido" | "placeholder_desconhecido" | "workspace_invalido" | "variavel_ausente" | "segredo_nao_declarado" | "docker_inseguro" | "entrada_incompleta";
  constructor(codigo: ErroComando["codigo"], mensagem: string) {
    super(mensagem);
    this.name = "ErroComando";
    this.codigo = codigo;
  }
}

export interface ContextoComando {
  /** Pasta de dados do app (`<userData>`); o servidor mora em `<userData>/mcp/<id>/`. */
  userData: string;
  /** Raiz absoluta do workspace (para `{{WORKSPACE}}`). */
  workspace?: string | undefined;
  plataforma?: NodeJS.Platform;
  /** Executável Node para servidores npm com `comando: "node"` (padrão: o do processo). */
  node?: string;
  /** `node` é o Electron (precisa de ELECTRON_RUN_AS_NODE=1). */
  nodeEhElectron?: boolean;
  /** Valores NÃO secretos das variáveis (`{{VAR:NOME}}`). */
  variaveis?: Readonly<Record<string, string>>;
  /** Valores de segredo, só no lançador (modo `execucao`); nunca em `texto`. */
  segredos?: Readonly<Record<string, string>>;
  /** `exibicao` (padrão do consentimento): placeholders faltantes viram `<NOME>`; `execucao`: faltando lança. */
  modo?: "exibicao" | "execucao";
  /** Teste de existência de diretório (padrão: `fs.statSync`). */
  ehDiretorio?: (caminho: string) => boolean;
}

export interface HostsRede { instalacao: string[]; execucao: string[]; execucao_livre: boolean }

export interface ComandoMcp {
  tipo: "stdio" | "remoto";
  executavel: string | null;
  /** Em `execucao` sem `segredos`, `{{SEGREDO:X}}` permanece literal para o lançador resolver. */
  args: string[];
  url: string | null;
  /** `<userData>/mcp/<id>`; `null` em remoto. */
  pasta: string | null;
  /** Nomes das variáveis declaradas (nunca valores). */
  env_nomes: string[];
  /** Variável secreta → chave do cofre (`mcp/<id>/<NOME>`); o valor nunca está aqui. */
  env_cofre: Record<string, string>;
  /** Variáveis fixas exigidas pelo comando (ex.: ELECTRON_RUN_AS_NODE). */
  env_fixas: Record<string, string>;
  hosts_rede: HostsRede;
  /** Comando exato para mostrar (segredos como `<segredo:NOME>`). */
  texto: string;
}

const RE_ID_SEGURO = /^[a-z0-9][a-z0-9-]{0,47}$/;
const DOCKER_PROIBIDOS = [/^--privileged(=|$)/, /^--(network|net)(=host|$)/, /^--pid(=host|$)/, /^--ipc(=host|$)/, /^--userns(=host|$)/, /^--cap-add/, /^--device/, /^--security-opt/, /^--add-host/];

export const caminhoDe = (plataforma: NodeJS.Platform): typeof posix => (plataforma === "win32" ? win32 : posix);

/** `<userData>/mcp/<id>`; recusa id fora do padrão (sem escape de pasta). */
export function pastaDoServidor(userData: string, id: string, plataforma: NodeJS.Platform = process.platform): string {
  if (!RE_ID_SEGURO.test(id)) throw new ErroComando("id_invalido", `id de servidor inválido: ${id}`);
  return caminhoDe(plataforma).join(userData, "mcp", id);
}

export function chaveCofre(id: string, nome: string): string { return `mcp/${id}/${nome}`; }

function hostDe(url: string): string | null {
  try { return new URL(url.replace(/\{\{[^{}]*\}\}/g, "x")).hostname || null; } catch { return null; }
}

/** Hosts de rede por fase: instalação (download) e execução (o que o servidor remoto usa). */
export function hostsDeRede(e: EntradaMcp): HostsRede {
  const m = e.instalacao.metodo;
  let instalacao: string[] = [];
  if (m === "npm") instalacao = ["registry.npmjs.org"];
  else if (m === "uvx") instalacao = ["pypi.org", "files.pythonhosted.org"];
  else if (m === "binario") {
    const hs = Object.values(e.instalacao.artefatos ?? {}).map((a) => hostDe(a.url)).filter((h): h is string => h !== null);
    instalacao = [...new Set([...hs, "objects.githubusercontent.com", "release-assets.githubusercontent.com"])];
  } else if (m === "docker") instalacao = ["registry-1.docker.io"];
  const host = e.url ? hostDe(e.url) : null;
  const execucao = host ? [host] : [];
  return { instalacao: instalacao.sort(), execucao, execucao_livre: execucao.length === 0 && e.riscos.includes("rede_saida") };
}

function validarWorkspace(ctx: ContextoComando, plataforma: NodeJS.Platform): string {
  const p = caminhoDe(plataforma);
  const ws = ctx.workspace;
  if (!ws || !p.isAbsolute(ws)) throw new ErroComando("workspace_invalido", "workspace deve ser caminho absoluto");
  if (ws.split(/[\\/]/).includes("..") || ws.includes("\0")) throw new ErroComando("workspace_invalido", "workspace não pode conter '..'");
  const ehDir = ctx.ehDiretorio ?? ((c: string) => { try { return statSync(c).isDirectory(); } catch { return false; } });
  if (!ehDir(ws)) throw new ErroComando("workspace_invalido", "workspace não existe ou não é pasta");
  return p.normalize(ws);
}

/** Aspas só para exibição (POSIX). Não é usado para executar: a execução separa executável e argumentos. */
export function citar(argumento: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(argumento) ? argumento : `'${argumento.replace(/'/g, "'\\''")}'`;
}

interface Resolvido { valor: string | null; descartar: boolean }

function resolverPlaceholders(texto: string, e: EntradaMcp, ctx: ContextoComando, pasta: string | null, plataforma: NodeJS.Platform, exibir: boolean, ehUrl: boolean): Resolvido {
  const decl = new Map(e.variaveis.map((v) => [v.nome, v] as const));
  const modo = ctx.modo ?? "execucao";
  let descartar = false;
  let wsCache: string | null = null;
  const valor = texto.replace(/\{\{([^{}]*)\}\}/g, (_inteiro, token: string) => {
    if (token === "WORKSPACE") {
      if (modo === "exibicao" && !ctx.workspace) return "<workspace>";
      return (wsCache ??= validarWorkspace(ctx, plataforma));
    }
    if (token === "SERVIDOR_DIR") {
      if (!pasta) throw new ErroComando("placeholder_desconhecido", "{{SERVIDOR_DIR}} em servidor remoto");
      return pasta;
    }
    const m = /^(SEGREDO|VAR):([A-Z][A-Z0-9_]{1,63})$/.exec(token);
    if (!m) throw new ErroComando("placeholder_desconhecido", `placeholder desconhecido {{${token}}}`);
    const tipo = m[1]!, nome = m[2]!;
    const d: VariavelMcp | undefined = decl.get(nome);
    if (!d) throw new ErroComando("segredo_nao_declarado", `{{${tipo}:${nome}}} sem variável declarada`);
    if (tipo === "SEGREDO") {
      if (!d.secreta) throw new ErroComando("segredo_nao_declarado", `{{SEGREDO:${nome}}} exige variável secreta`);
      if (exibir) return `<segredo:${nome}>`;
      const v = ctx.segredos?.[nome];
      if (v !== undefined) return v;
      if (modo === "execucao" && ctx.segredos !== undefined) throw new ErroComando("variavel_ausente", `segredo ${nome} não informado`);
      return `{{SEGREDO:${nome}}}`; // o lançador resolve por loopback
    }
    const v = ctx.variaveis?.[nome];
    if (v !== undefined && v !== "") return v;
    if (modo === "exibicao") return `<${nome}>`;
    if (!d.obrigatoria && !ehUrl) { descartar = true; return ""; }
    throw new ErroComando("variavel_ausente", `variável ${nome} não informada`);
  });
  return { valor, descartar };
}

function validarDocker(args: string[], workspace: string | null): void {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (/docker\.sock/.test(a)) throw new ErroComando("docker_inseguro", "docker.sock não pode ser montado");
    const duplo = a === "--network" || a === "--net" || a === "--pid" || a === "--ipc" || a === "--userns";
    if (duplo && args[i + 1] === "host") throw new ErroComando("docker_inseguro", `${a} host não é permitido`);
    if (DOCKER_PROIBIDOS.some((r) => r.test(a))) throw new ErroComando("docker_inseguro", `opção docker proibida: ${a}`);
    const montagem = a === "-v" || a === "--volume" || a === "--mount" ? args[i + 1] : /^(-v|--volume|--mount)=/.test(a) ? a.slice(a.indexOf("=") + 1) : undefined;
    if (montagem !== undefined) {
      const origem = montagem.replace(/^type=bind,/, "").replace(/^(source|src)=/, "");
      const ok = workspace !== null && (origem === workspace || origem.startsWith(`${workspace}:`) || origem.startsWith(`${workspace}/`) || origem.startsWith(`${workspace},`));
      if (!ok) throw new ErroComando("docker_inseguro", "só o workspace pode ser montado (nunca / nem a casa)");
    }
  }
}

/**
 * Comando completo de um servidor, sem executar nada. npm → `<pasta>/node_modules/.bin/<bin>` (ou Node + shim);
 * uvx → `<pasta>/venv/bin/<bin>`; binário → `<pasta>/bin/<bin>`; docker → `docker run --rm -i --pull never …`;
 * remoto → só a URL. Placeholder desconhecido lança.
 */
export function montarComando(e: EntradaMcp, ctx: ContextoComando): ComandoMcp {
  const plataforma = ctx.plataforma ?? process.platform;
  const win = plataforma === "win32";
  const p = caminhoDe(plataforma);
  const metodo = e.instalacao.metodo;
  const remoto = metodo === "remoto";
  const pasta = remoto ? null : pastaDoServidor(ctx.userData, e.id, plataforma);
  const env_cofre: Record<string, string> = {};
  for (const v of e.variaveis) if (v.secreta) env_cofre[v.nome] = chaveCofre(e.id, v.nome);
  const hosts_rede = hostsDeRede(e);
  const env_fixas: Record<string, string> = {};

  const resolver = (lista: string[], exibir: boolean): string[] => {
    const saida: string[] = [];
    for (const a of lista) {
      const r = resolverPlaceholders(a, e, ctx, pasta, plataforma, exibir, false);
      if (!r.descartar) saida.push(r.valor!);
    }
    return saida;
  };
  const base = { env_nomes: e.variaveis.map((v) => v.nome), env_cofre, hosts_rede, pasta };

  if (remoto) {
    if (!e.url) throw new ErroComando("entrada_incompleta", "servidor remoto sem url");
    const url = resolverPlaceholders(e.url, e, ctx, null, plataforma, true, true).valor!;
    const urlReal = resolverPlaceholders(e.url, e, ctx, null, plataforma, false, true).valor!;
    return { ...base, tipo: "remoto", executavel: null, args: [], url: urlReal, env_fixas, texto: url };
  }

  if (!e.bin && metodo !== "docker") throw new ErroComando("entrada_incompleta", "servidor sem bin");
  let executavel: string;
  let prefixo: string[] = [];
  if (metodo === "npm") {
    const shim = p.join(pasta!, "node_modules", ".bin", win ? `${e.bin}.cmd` : e.bin!);
    if (e.comando === "node" && !win) {
      executavel = ctx.node ?? process.execPath;
      prefixo = [shim];
      if (ctx.nodeEhElectron) env_fixas["ELECTRON_RUN_AS_NODE"] = "1";
    } else executavel = shim;
  } else if (metodo === "uvx") {
    executavel = win ? p.join(pasta!, "venv", "Scripts", `${e.bin}.exe`) : p.join(pasta!, "venv", "bin", e.bin!);
  } else if (metodo === "binario") {
    executavel = p.join(pasta!, "bin", win ? `${e.bin}.exe` : e.bin!);
  } else {
    // docker: só roda a imagem já baixada por ação explícita
    const imagem = e.instalacao.pacote;
    if (!imagem) throw new ErroComando("entrada_incompleta", "servidor docker sem imagem");
    const resolvidos = resolver(e.args, false);
    const usaWorkspace = e.args.some((a) => a.includes("{{WORKSPACE}}"));
    let workspace: string | null = null;
    if (usaWorkspace || ctx.workspace) { try { workspace = validarWorkspace(ctx, plataforma); } catch (erro) { if (usaWorkspace) throw erro; } }
    validarDocker(resolvidos, workspace);
    const envDocker = e.variaveis.flatMap((v) => ["-e", v.nome]);
    const args = ["run", "--rm", "-i", "--pull", "never", ...envDocker, imagem, ...resolvidos];
    const exib = ["docker", ...["run", "--rm", "-i", "--pull", "never", ...envDocker, imagem, ...resolver(e.args, true)]];
    return { ...base, tipo: "stdio", executavel: "docker", args, url: null, env_fixas, texto: exib.map(citar).join(" ") };
  }
  const args = [...prefixo, ...resolver(e.args, false)];
  const exib = [executavel, ...prefixo, ...resolver(e.args, true)];
  return { ...base, tipo: "stdio", executavel, args, url: null, env_fixas, texto: exib.map(citar).join(" ") };
}

export interface PermissaoVariavel { nome: string; obrigatoria: boolean; secreta: boolean; ajuda: string; onde_conseguir: string | null }

/** O que a pessoa vê antes de instalar. Variáveis secretas só pelo NOME (valor nunca existe aqui). */
export interface PermissoesMcp {
  comando_exato: string;
  versao_pinada: string | null;
  integridade: string | null;
  pasta: string | null;
  /** O que o instalador grava (sempre dentro da pasta do app). */
  escrita_em_disco: string[];
  hosts_rede: HostsRede;
  variaveis: PermissaoVariavel[];
  riscos: RiscoMcp[];
  riscos_texto: string;
  nivel_verificacao: NivelVerificacao;
  scripts_permitidos: boolean;
}

export function montarPermissoes(e: EntradaMcp, ctx: ContextoComando): PermissoesMcp {
  const c = montarComando(e, { ...ctx, modo: "exibicao" });
  return {
    comando_exato: c.texto,
    versao_pinada: e.instalacao.versao,
    integridade: e.instalacao.integridade,
    pasta: c.pasta,
    escrita_em_disco: c.pasta ? [c.pasta] : [],
    hosts_rede: c.hosts_rede,
    variaveis: e.variaveis.map((v) => ({ nome: v.nome, obrigatoria: v.obrigatoria, secreta: v.secreta, ajuda: v.ajuda, onde_conseguir: v.onde_conseguir })),
    riscos: [...e.riscos],
    riscos_texto: e.riscos_texto,
    nivel_verificacao: nivelVerificacao(e),
    scripts_permitidos: e.instalacao.scripts_permitidos === true,
  };
}

export { placeholdersDe };
