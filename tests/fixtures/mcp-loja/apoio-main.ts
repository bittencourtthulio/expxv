// Apoio dos testes do serviço da Loja de MCPs no main (Fase 7B, onda C): banco SQLite real em memória, catálogo e executor de npm
// FALSOS, cofre real com cifrador falso (nunca o Keychain) e servidores MCP falsos. Nada de rede nem de pacote real.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EventoLojaMcp } from "../../../src/compartilhado/loja-mcp";
import { abrirBanco } from "../../../src/nucleo/banco/banco";
import { migrar } from "../../../src/nucleo/banco/migrar";
import { criarRepoCatalogoMcp } from "../../../src/nucleo/banco/repos/catalogo-mcp";
import type { RepoLojaMcp } from "../../../src/nucleo/loja-mcp";
import { criarLojaMcp, type AlvoPaneLoja, type DepsLojaMcp, type LojaMcpMain } from "../../../src/main/loja-mcp";
import { catalogoFalso, cofreDeTeste, executorNpmFalso, novaPasta, type ExecutorFalso } from "./apoio-ciclo";

export const SEGREDO_VAZADO_SENTINELA = "SENTINELA-main-9d3f-nunca-vazar";
export const DIAG = { npm: { ok: true, versao: "10.0.0" }, node: { ok: true, versao: "v22.0.0" }, cofre: { disponivel: true } };

export async function aguardar(cond: () => boolean, ms = 8000): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("tempo esgotado esperando a condição");
    await new Promise((r) => setTimeout(r, 15));
  }
}

export interface MontagemLoja {
  loja: LojaMcpMain;
  repo: RepoLojaMcp;
  executor: ExecutorFalso;
  eventos: EventoLojaMcp[];
  barramento: Array<[string, Record<string, unknown>]>;
  ws: string;
  urlSegredos: string;
  vivos: Set<string>;
  limpezas: string[];
  userData: string;
  alvo(paneId: string, cli?: string): AlvoPaneLoja;
  cofreAbertoVezes(): number;
  instalar(id: string): Promise<void>;
  repoTexto(): string;
}

export interface OpcoesMontarLoja {
  semCatalogo?: boolean;
  /** repositório já migrado (ex.: o do banco de domínio de um teste maior). */
  repo?: RepoLojaMcp;
  /** `true` se o Pane existe e não acabou (padrão: o conjunto `vivos` da montagem). */
  paneAtivo?: (id: string) => boolean;
  /** id do workspace → raiz absoluta (padrão: um workspace fixo). */
  raizDoWorkspace?: (id: string) => string | null;
  userData?: string;
  /** regras da lista de bloqueio já na montagem (padrão: nenhuma). */
  bloqueios?: Array<{ id: string; motivo: string; desde: string }>;
  /** `fetch` falso (só a descoberta no Registro Oficial usa; nenhum teste toca a rede). */
  fetch?: typeof fetch;
  /** dependências extras do serviço (ex.: persistência do snapshot do Pane, Fase 7C). */
  extras?: Partial<DepsLojaMcp>;
}

export function montarLoja(opcoes: OpcoesMontarLoja = {}): MontagemLoja {
  const userData = opcoes.userData ?? novaPasta("ud-main-");
  const pasta = novaPasta("recursos-mcp-");
  writeFileSync(join(pasta, "bloqueio.json"), JSON.stringify({ schema_version: 1, regras: opcoes.bloqueios ?? [] }));
  const raiz = novaPasta("ws-raiz-");
  mkdirSync(join(raiz, ".git"), { recursive: true });
  const banco = opcoes.repo === undefined ? abrirBanco(":memory:") : null;
  if (banco !== null) migrar(banco);
  const repo = opcoes.repo ?? criarRepoCatalogoMcp(banco!);
  const cat = catalogoFalso();
  const executor = executorNpmFalso(cat);
  const cofre = cofreDeTeste(novaPasta("cofre-main-"));
  let aberturas = 0;
  const eventos: EventoLojaMcp[] = [];
  const barramento: MontagemLoja["barramento"] = [];
  const vivos = new Set<string>();
  const limpezas: string[] = [];
  const ws = "ws_01J8ZXAMPLE0000000000000A1";
  const loja = criarLojaMcp({
    repo, userData, pasta: opcoes.semCatalogo ? null : pasta, ...(opcoes.semCatalogo ? {} : { catalogo: cat }),
    cofre: async () => { aberturas++; return cofre; },
    raizDoWorkspace: opcoes.raizDoWorkspace ?? ((id) => (id === ws ? raiz : null)),
    paneAtivo: opcoes.paneAtivo ?? ((id) => vivos.has(id)),
    emitirRenderer: (e) => eventos.push(e),
    barramento: (n, p) => barramento.push([n, p]),
    node: process.execPath, nodeEhElectron: false,
    limparArquivosDoPane: (id) => limpezas.push(id),
    ...(opcoes.fetch ? { fetch: opcoes.fetch } : {}),
    executor, diagnostico: async () => DIAG,
    localizar: (n) => (n === "npm" ? "/falso/npm" : n === "node" ? process.execPath : null),
    ...(opcoes.extras ?? {}),
  });
  const urlSegredos = "http://127.0.0.1:1234/loja/segredos";
  const m: MontagemLoja = {
    loja, repo, executor, eventos, barramento, ws, urlSegredos, vivos, limpezas, userData,
    alvo: (paneId, cli = "claude") => ({ pane_id: paneId, workspace_id: ws, missao_id: null, agente_id: null, modo: "livre", cli, raiz }),
    cofreAbertoVezes: () => aberturas,
    async instalar(id) {
      const plano = await loja.planoInstalacao([id], null);
      if (plano.planos.length !== 1) throw new Error(`plano recusado: ${JSON.stringify(plano.bloqueios)}`);
      const antes = eventos.length;
      await loja.instalar({ ids: [id], consentimento: { aceito: true, comando_hashes: { [id]: plano.planos[0]!.comando_hash } }, workspace_id: null });
      await aguardar(() => eventos.slice(antes).some((e) => e.tipo === "saude" && e.id === id) || eventos.slice(antes).some((e) => e.tipo === "estado" && e.id === id && e.estado === "falhou"));
    },
    repoTexto: () => banco === null ? "" : JSON.stringify(banco.consultar("SELECT * FROM catalogo_mcp_consentimento UNION ALL SELECT servidor_id,nome,definida,atualizada_em,NULL,NULL,NULL FROM catalogo_mcp_variavel").concat(banco.consultar("SELECT * FROM catalogo_mcp_log"))),
  };
  return m;
}
