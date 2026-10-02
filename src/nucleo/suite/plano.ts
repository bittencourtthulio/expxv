// Plano da instalação (D-473): ambiente seguro do filho, comandos exatos, resolução de node/npm e requisitos do primeiro passo do modal.
// A DECISÃO de segurança sobre npx/.npmrc mora aqui (e em 01-DECISOES.md D-473): o app NÃO usa `npx` no cwd do projeto. Baixa o pacote
// com `npm install --prefix <pasta temporária>` (cwd neutro, `--userconfig`/`--globalconfig` vazios, registro explícito, `--ignore-scripts`) e roda
// o binário baixado com `node <caminho absoluto>`: o `.npmrc` e o `node_modules/.bin` do projeto nunca são lidos pelo npm/npx.
import { readdir, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExecutavelPty } from "../terminais/lancamento";
import { ambienteSeguro } from "../terminais/ambiente";
import { resolverExecutavel } from "../executar/resolver";
import { executarProcesso, type PedidoProcesso, type ResultadoProcesso } from "./processo";
import {
  CATALOGO_SUITE, FLAGS_DO_APP, HARNESS_PADRAO, HARNESS_VALIDOS, LIMITES_SUITE, NODE_MINIMO_VERSAO, PACOTE_SUITE, PASTAS_GRAVADAS, REGISTRO_PADRAO, SKILLS_DA_SUITE,
  VARIAVEIS_DO_INSTALADOR_BLOQUEADAS, comTil, nodeAtende,
  type ArquivosExistentes, type ModoInstalacao, type PlanoSuite, type RequisitoSuite, type SkillPlano,
} from "./modelo";

const SENSIVEL = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|CREDENTIAL|AUTH)/i;
const REMOVER_FIXAS = new Set(["NODE_OPTIONS", "NODE_PATH", "NODE_ENV", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_EXEC_PATH", "GIT_SSH_COMMAND", "GIT_ASKPASS", "SSH_ASKPASS", "NPM_TOKEN", ...VARIAVEIS_DO_INSTALADOR_BLOQUEADAS]);

export interface OpcoesAmbienteInstalador {
  origem?: NodeJS.ProcessEnv;
  inicio?: string;
  plataforma?: NodeJS.Platform;
  scrub?: ((texto: string) => string) | null;
  /** dir do `node` (completa o PATH, igual aos terminais) */
  caminhoNode?: string;
}

/**
 * Ambiente do processo filho do instalador: `ambienteSeguro` (sem identidade de sessão do Claude Code, sem `ORCA_*`, PATH completo) MAIS:
 * nenhuma variável `npm_config_*`/`NODE_OPTIONS`/`NODE_PATH`, nenhum segredo por nome (o instalador usa só pacotes públicos), nada de redirecionar o git;
 * `CI=1` e sem cor. Quem baixa acrescenta as `NPM_CONFIG_*` neutras com `ambienteNpm`.
 */
export function ambienteDoInstalador(o: OpcoesAmbienteInstalador = {}): Record<string, string> {
  const base = ambienteSeguro({ caminho: o.caminhoNode ?? "" } as Pick<ExecutavelPty, "caminho">, {
    ...(o.origem === undefined ? {} : { origem: o.origem }),
    ...(o.inicio === undefined ? {} : { inicio: o.inicio }),
    ...(o.plataforma === undefined ? {} : { plataforma: o.plataforma }),
    ...(o.scrub === undefined ? {} : { scrub: o.scrub }),
  });
  const saida: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(base)) {
    if (/^npm_/i.test(nome) || REMOVER_FIXAS.has(nome) || /^GIT_CONFIG/i.test(nome) || SENSIVEL.test(nome)) continue;
    saida[nome] = valor;
  }
  // `GIT_TERMINAL_PROMPT=0`: o `init` baixa as skills com `git clone`; o git nunca pode ficar esperando usuário/senha
  Object.assign(saida, { CI: "1", NO_COLOR: "1", FORCE_COLOR: "0", TERM: "dumb", ADBLOCK: "1", DISABLE_OPENCOLLECTIVE: "1", GIT_TERMINAL_PROMPT: "0" });
  return saida;
}

/** Acrescenta a configuração neutra do npm (sem `.npmrc` de ninguém, registro explícito, sem scripts de ciclo de vida). */
export function ambienteNpm(base: Record<string, string>, pastaTemp: string, registro: string): Record<string, string> {
  return {
    ...base,
    NPM_CONFIG_USERCONFIG: join(pastaTemp, "npmrc-usuario-vazio"),
    NPM_CONFIG_GLOBALCONFIG: join(pastaTemp, "npmrc-global-vazio"),
    NPM_CONFIG_REGISTRY: registro,
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_PROGRESS: "false",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
  };
}

// ---------------------------------------------------------------- ferramentas
export interface Ferramentas {
  node: string | null;
  npm: string | null;
  /** o `init` baixa cada skill com `git clone` */
  git: string | null;
  /** Windows: `npm` é um `.cmd`; roda-se `node npm-cli.js` (nunca shell) */
  npmCli: string | null;
}

export function resolverFerramentas(ambiente: Record<string, string>, cwd: string, plataforma: NodeJS.Platform = process.platform): Ferramentas {
  const path = ambiente["PATH"] ?? ambiente["Path"] ?? "";
  const r = (exe: string): string | null => { const x = resolverExecutavel(cwd, exe, { path, plataforma }); return x.ok ? x.caminho : null; };
  const node = r("node");
  const npm = r("npm");
  const git = r("git");
  let npmCli: string | null = null;
  if (plataforma === "win32" && node !== null) npmCli = join(dirname(node), "node_modules", "npm", "bin", "npm-cli.js");
  return { node, npm, git, npmCli };
}

/** Executável + argumentos fixos para chamar o npm com segurança. */
export function comandoNpm(f: Ferramentas, plataforma: NodeJS.Platform = process.platform): { executavel: string; prefixo: string[] } | null {
  if (plataforma === "win32") return f.node !== null && f.npmCli !== null ? { executavel: f.node, prefixo: [f.npmCli] } : null;
  return f.npm === null ? null : { executavel: f.npm, prefixo: [] };
}

// ---------------------------------------------------------------- comandos exatos
export const subcomandoDoModo = (modo: ModoInstalacao): string => (modo === "atualizar" ? "update" : "init");

export interface OpcoesInit {
  skills: readonly string[];
  harness?: readonly string[];
  /** flags extras do usuário (já validadas); nunca repetem as do app */
  extras?: readonly string[];
}

/** Extras do usuário sem as flags que o app já controla (`--yes`, `--skills`, `--harness`, `--check`…). */
export const extrasSeguros = (extras: readonly string[] = []): string[] => extras.filter((f) => !FLAGS_DO_APP.includes(f.split("=")[0] ?? f));

/**
 * Argumentos do instalador baixado: `[bin, init, --yes, --skills a,b, --harness claude,opencode, ...extras]` (cwd = raiz do workspace). O `init` SEM `--skills`
 * sai com "nenhuma skill selecionada" e SEM `--yes` só simula: o app nunca monta o comando sem as duas. `update` leva `--yes` e as skills nomeadas.
 */
export function argumentosInit(bin: string, modo: ModoInstalacao, o: OpcoesInit): string[] {
  const skills = [...new Set(o.skills)];
  const extras = extrasSeguros(o.extras);
  // `update` sem nomes atualiza todas as instaladas (nomear uma skill não instalada seria erro)
  if (modo === "atualizar") return [bin, "update", "--yes", ...extras];
  if (skills.length === 0) throw new Error("argumentosInit: nenhuma skill (o app nunca monta o comando sem --skills)");
  const harness = [...new Set((o.harness ?? HARNESS_PADRAO).filter((h) => HARNESS_VALIDOS.includes(h)))];
  return [bin, "init", "--yes", "--skills", skills.join(","), "--harness", (harness.length > 0 ? harness : HARNESS_PADRAO).join(","), ...extras];
}

export interface PedidoComandos {
  versao: string;
  modo: ModoInstalacao;
  skills: readonly string[];
  registro?: string;
  harness?: readonly string[];
  extras?: readonly string[];
}

/** Texto do comando exato que o modal mostra (o que o usuário veria num terminal). */
export function comandoExibido(p: PedidoComandos): string[] {
  const [, ...resto] = argumentosInit("<instalador>", p.modo, { skills: p.skills, ...(p.harness === undefined ? {} : { harness: p.harness }), ...(p.extras === undefined ? {} : { extras: p.extras }) });
  return [
    `npm install --prefix <pasta temporária> --ignore-scripts --registry ${p.registro ?? REGISTRO_PADRAO} ${PACOTE_SUITE}@${p.versao}`,
    ["node", "<instalador baixado>/dist/cli/expx-bin.js", ...resto].join(" "),
    "node <instalador baixado>/dist/cli/expx-bin.js doctor",
  ];
}

/** Argumentos do download (cwd = pasta temporária neutra). `pastaTemp` entra como `--prefix`. */
export function argumentosDownload(versao: string, pastaTemp: string, registro: string = REGISTRO_PADRAO): string[] {
  return [
    "install", "--prefix", pastaTemp, "--no-save", "--no-package-lock", "--no-audit", "--no-fund", "--ignore-scripts", "--progress=false",
    "--registry", registro, `${PACOTE_SUITE}@${versao}`,
  ];
}

/**
 * Lê o catálogo REAL de skills do pacote baixado (`dist/nucleo/catalogo.js` exporta `NOMES`), num processo de Node separado (cwd neutro, sem rede, curto).
 * Devolve `null` se não deu para ler (o chamador cai na lista conhecida do app). O app nunca importa código do pacote no próprio processo.
 */
export async function lerCatalogoDoPacote(o: {
  node: string;
  pacote: string;
  cwd: string;
  env: Record<string, string>;
  executar?: (p: PedidoProcesso) => Promise<ResultadoProcesso>;
  sinal?: AbortSignal;
  plataforma?: NodeJS.Platform;
}): Promise<string[] | null> {
  let saida = "";
  const programa = "import(process.argv[1]).then((m)=>{const n=m.NOMES??m.default?.NOMES;process.stdout.write(JSON.stringify(Array.isArray(n)?n:null));}).catch(()=>process.exit(3));";
  const url = `file://${join(o.pacote, "dist", "nucleo", "catalogo.js").split("\\").join("/")}`;
  const r = await (o.executar ?? executarProcesso)({
    executavel: o.node, argumentos: ["--input-type=commonjs", "-e", programa, url], cwd: o.cwd, env: o.env, tempoTotalMs: LIMITES_SUITE.verificacao_ms, silencioMs: LIMITES_SUITE.verificacao_ms, maxBytes: 64 * 1024,
    ...(o.sinal === undefined ? {} : { sinal: o.sinal }), ...(o.plataforma === undefined ? {} : { plataforma: o.plataforma }),
    aoLinha: (l, canal) => { if (canal === "stdout") saida += l; },
  });
  if (r.motivo !== "saiu" || r.codigo !== 0) return null;
  try {
    const v: unknown = JSON.parse(saida);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[a-z][a-z0-9-]{0,30}$/.test(x)).slice(0, 64) : null;
  } catch { return null; }
}

/** Interseção do que o usuário quer com o catálogo da versão baixada, na ordem do catálogo conhecido. `disponiveis` nulo = leitura falhou: vale a lista pedida. */
export function skillsParaInstalar(pedidas: readonly string[], disponiveis: readonly string[] | null): { skills: string[]; ignoradas: string[] } {
  const conhecidas = SKILLS_DA_SUITE.filter((n) => pedidas.includes(n));
  if (disponiveis === null) return { skills: conhecidas, ignoradas: [] };
  return { skills: conhecidas.filter((n) => disponiveis.includes(n)), ignoradas: conhecidas.filter((n) => !disponiveis.includes(n)) };
}

// ---------------------------------------------------------------- arquivos pré-existentes
export async function contarArquivos(raiz: string, pasta: string, teto = 5_000): Promise<number> {
  let n = 0;
  async function descer(rel: string): Promise<void> {
    let nomes: string[];
    try { nomes = await readdir(join(raiz, rel)); } catch { return; }
    for (const nome of nomes) {
      if (n >= teto) return;
      if (nome === "node_modules" || nome === ".git") continue;
      const r = `${rel}/${nome}`;
      try {
        const s = await lstat(join(raiz, r));
        if (s.isDirectory()) await descer(r);
        else n += 1;
      } catch { /* sumiu */ }
    }
  }
  await descer(pasta);
  return n;
}

export async function arquivosExistentes(raiz: string): Promise<ArquivosExistentes[]> {
  const saida: ArquivosExistentes[] = [];
  for (const pasta of PASTAS_GRAVADAS) saida.push({ pasta, quantidade: await contarArquivos(raiz, pasta) });
  return saida;
}

// ---------------------------------------------------------------- requisitos
export interface SondasRequisitos {
  /** `node --version` → "v20.11.0" ou `null` */
  versaoNode(): Promise<string | null>;
  versaoNpm(): Promise<string | null>;
  gravavel(raiz: string): Promise<boolean>;
  /** `null` = pasta sem git */
  statusGit(raiz: string): Promise<{ alteracoes: number } | null>;
  /** `git --version` ou `null` se o git não está instalado (o `init` baixa as skills com `git clone`) */
  versaoGit(): Promise<string | null>;
}


export async function verificarRequisitosLocais(raiz: string, s: SondasRequisitos): Promise<RequisitoSuite[]> {
  const [node, npm, gravavel, git, versaoGit] = await Promise.all([s.versaoNode(), s.versaoNpm(), s.gravavel(raiz), s.statusGit(raiz).catch(() => null), s.versaoGit().catch(() => null)]);
  const r: RequisitoSuite[] = [];
  r.push(node === null
    ? { id: "node", rotulo: "Node.js", situacao: "falha", detalhe: "Não encontrado nesta máquina.", correcao: `Instale o Node.js ${NODE_MINIMO_VERSAO} ou mais novo (nodejs.org) e abra o app de novo.`, bloqueante: true }
    : !nodeAtende(node)
      ? { id: "node", rotulo: "Node.js", situacao: "falha", detalhe: `Versão ${node.trim()} é antiga demais (o instalador precisa do ${NODE_MINIMO_VERSAO} ou mais novo).`, correcao: `Atualize o Node.js para a versão ${NODE_MINIMO_VERSAO} ou mais nova (nodejs.org).`, bloqueante: true }
      : { id: "node", rotulo: "Node.js", situacao: "ok", detalhe: `Versão ${node.trim()}.`, correcao: null, bloqueante: true });
  r.push(npm === null
    ? { id: "npm", rotulo: "npm", situacao: "falha", detalhe: "Não encontrado nesta máquina.", correcao: "O npm vem com o Node.js: reinstale o Node.js (nodejs.org).", bloqueante: true }
    : { id: "npm", rotulo: "npm", situacao: "ok", detalhe: `Versão ${npm.trim()}.`, correcao: null, bloqueante: true });
  r.push({ id: "internet", rotulo: "Internet", situacao: "pendente", detalhe: "Será verificada ao clicar em Instalar agora (o app não acessa a rede antes do seu clique).", correcao: null, bloqueante: false });
  r.push(gravavel
    ? { id: "pasta", rotulo: "Pasta do projeto gravável", situacao: "ok", detalhe: "O app pode gravar em .claude, .expx e .opencode.", correcao: null, bloqueante: true }
    : { id: "pasta", rotulo: "Pasta do projeto gravável", situacao: "falha", detalhe: "Sem permissão de escrita nesta pasta.", correcao: "Ajuste as permissões da pasta (por exemplo, `chmod u+w`) ou abra um projeto em que você possa gravar.", bloqueante: true });
  // o git é requisito de verdade (o instalador baixa cada skill com `git clone`); o estado da ÁRVORE do projeto é só informativo
  const arvore = git === null ? "A pasta não é um repositório git (tudo bem: a instalação não usa o git do projeto)." : git.alteracoes === 0 ? "Repositório com a árvore limpa." : `Há ${git.alteracoes} alteração(ões) não commitada(s); a instalação não mexe nelas nem faz commit.`;
  r.push(versaoGit === null
    ? { id: "git", rotulo: "Git", situacao: "falha", detalhe: "Não encontrado nesta máquina: o instalador baixa as skills com `git clone`.", correcao: "Instale o Git (git-scm.com) e abra o app de novo.", bloqueante: true }
    : { id: "git", rotulo: "Git", situacao: "ok", detalhe: `${versaoGit.trim().replace(/^git version\s+/i, "versão ")}. ${arvore}`, correcao: null, bloqueante: true });
  return r;
}

export function montarPlano(o: {
  workspace_id: string; raiz: string; modo: ModoInstalacao; versao: string; registro?: string; harness?: readonly string[]; extras?: readonly string[];
  requisitos: RequisitoSuite[]; existentes: ArquivosExistentes[]; instaladas?: readonly string[]; inicio?: string;
}): PlanoSuite {
  const inicio = o.inicio ?? homedir();
  const skills: SkillPlano[] = CATALOGO_SUITE.map((c) => ({ nome: c.nome, papel: c.papel, instalada: (o.instaladas ?? []).includes(c.nome) }));
  return {
    workspace_id: o.workspace_id,
    modo: o.modo,
    versao: o.versao,
    skills,
    comando: comandoExibido({ versao: o.versao, modo: o.modo, skills: SKILLS_DA_SUITE, ...(o.registro === undefined ? {} : { registro: o.registro }), ...(o.harness === undefined ? {} : { harness: o.harness }), ...(o.extras === undefined ? {} : { extras: o.extras }) }),
    pasta_alvo: comTil(o.raiz, inicio),
    pastas_gravadas: [...PASTAS_GRAVADAS],
    existentes: o.existentes,
    requisitos: o.requisitos,
    pode_instalar: o.requisitos.every((r) => !(r.bloqueante && r.situacao === "falha")),
    rede: `Baixa o instalador (pacote ${PACOTE_SUITE}@${o.versao}) do registro npm e, com ele, cada skill do repositório público dela no GitHub (via git). Nada do seu projeto é enviado.`,
    efeitos_fora: [
      "Se o Claude Code estiver instalado, o instalador também registra o plugin no Claude Code desta máquina (comandos `claude plugin marketplace add` e `claude plugin install`, que gravam na pasta do Claude Code do seu usuário). É o que habilita os comandos /expx:.",
      "O instalador troca a pasta .expx inteira: o que não faz parte da instalação (por exemplo .expx/hooks.json) o app guarda numa cópia de segurança e devolve.",
    ],
  };
}

/** Roda `<exe> --version` (cwd neutro, saída mínima, curto) e devolve a primeira linha, ou `null` se falhou. */
export async function lerVersao(o: {
  executavel: string;
  argumentos: readonly string[];
  cwd: string;
  env: Record<string, string>;
  executar?: (p: PedidoProcesso) => Promise<ResultadoProcesso>;
  sinal?: AbortSignal;
  plataforma?: NodeJS.Platform;
}): Promise<string | null> {
  let saida = "";
  const r = await (o.executar ?? executarProcesso)({
    executavel: o.executavel, argumentos: o.argumentos, cwd: o.cwd, env: o.env, tempoTotalMs: LIMITES_SUITE.verificacao_ms, silencioMs: LIMITES_SUITE.verificacao_ms, maxBytes: 64 * 1024,
    ...(o.sinal === undefined ? {} : { sinal: o.sinal }), ...(o.plataforma === undefined ? {} : { plataforma: o.plataforma }),
    aoLinha: (l, canal) => { if (canal === "stdout" && saida === "") saida = l.trim(); },
  });
  return r.motivo === "saiu" && r.codigo === 0 && saida !== "" ? saida.slice(0, 40) : null;
}
