// Ponte entre o catálogo (Fase 7) e a orquestração dos Panes (T-07.19/20/22): resolve a política no lançamento, grava o SNAPSHOT do Pane, materializa o
// plugin efêmero das skills embarcadas, decide o gate `pre-skill`/`pre-mcp` e serve `catalog_list`/`pane_spawn.skills`. Sem Electron: tudo por injeção.
//
// Persistência (R-3): o snapshot mora no banco (`catalogo_pane_politica`), então um Pane que SOBREVIVEU ao reinício do app (daemon vivo) continua com o gate
// correto; a leitura é cacheada em memória e invalidada a cada novo preparo. Pane de Missão `squad`/`agentico` SEM snapshot é NEGADO (falha fechada): só o
// Pane livre (ou fora de Missão) sem snapshot é liberado.
import type { CliCatalogo, ItemCatalogo, PoliticaResolvida, TipoCatalogo } from "../compartilhado/catalogo";
import type { RepoCatalogo } from "../nucleo/banco/repos/catalogo";
import type { ModoMissao, Papel } from "../nucleo/dominio";
import { decidirGate, type DecisaoGate, type SnapshotPane } from "../nucleo/catalogo/gate";
import { lerManifesto, materializarEmbarcadasDoPane } from "../nucleo/catalogo/embarcadas/manifesto";
import { EMBARCADAS_EXIBICAO, NOMES_EMBARCADAS, NIVEL_POR_CLI, normalizarNomeSkill, resolverPolitica, type ItemSkillCatalogo } from "../nucleo/catalogo/politica";
import type { ItemCatalogoMcp, PedidoCatalogoMcp, PortaCatalogo, TipoCatalogList } from "../nucleo/mcp/portas";
import type { PoliticaNoComando } from "../nucleo/orquestracao/piloto";

export interface AlvoDaPolitica {
  pane_id: string;
  workspace_id: string;
  mission_id: string | null;
  agente_id: string | null;
  modo: ModoMissao;
  papel: Papel;
  cli: string;
  /** `pane_spawn.skills` (só estreita) */
  pedidas: string[] | null;
  /** perfil do membro de squad (`skills_permitidas`/`mcps_permitidos`) */
  membro: { skills_permitidas: readonly string[]; mcps_permitidos: readonly string[] } | null;
}

export interface DepsCatalogoOrquestracao {
  repo: Pick<RepoCatalogo, "listarPorTipo" | "listarPoliticas" | "gravarSnapshotPane" | "lerSnapshotPane" | "apagarSnapshotPane">;
  /** o Pane é de Missão squad/agentico? (decide a falha fechada sem snapshot). `null` = Pane livre/avulso/desconhecido. */
  modoDoPane(paneId: string): ModoMissao | null;
  /** a Missão tem origem diferente de `livre` (o piloto recebe o grupo do método). */
  missaoComMetodo(missionId: string | null): boolean;
  /** perfil do membro de squad, para validar `pane_spawn.skills` do novo worker. */
  membroDoAgente?(agenteId: string): { skills_permitidas: readonly string[]; mcps_permitidos: readonly string[] } | null;
  /** copia as `ev-*` permitidas para `<dirApp>/panes/<pane_id>/plugin` (T-07.17). Ausente/erro = o Pane abre sem o plugin (as instruções cobrem). */
  materializarEmbarcadas?(p: { paneId: string; nomes: readonly string[] }): Promise<{ dir: string; nomes: string[] }>;
  emitir?(tipo: string, payload: unknown): void;
  agora?(): Date;
  avisar?(mensagem: string): void;
}

export interface CatalogoDaOrquestracao {
  /** Resolve, grava o snapshot e devolve a política para o comando; `null` = Pane sem isolamento (livre). */
  preparar(a: AlvoDaPolitica): Promise<PoliticaNoComando | null>;
  gate(paneId: string, tipo: "skill" | "mcp", nome: string): DecisaoGate;
  portaMcp: PortaCatalogo;
  /** descarta o cache do Pane (fechamento/respawn). O snapshot persistido some por cascade com o Pane. */
  liberar(paneId: string): void;
}

const LIMITE_CURSOR = 5000;

function itensSkill(repo: DepsCatalogoOrquestracao["repo"], ws: string): ItemCatalogo[] {
  return repo.listarPorTipo("skill", ws, 0).itens;
}
const paraItemSkill = (i: ItemCatalogo): ItemSkillCatalogo => ({ nome_normalizado: i.nome_normalizado, nome: i.nome, origem: i.origem, plugin: i.plugin });

export function criarCatalogoDaOrquestracao(d: DepsCatalogoOrquestracao): CatalogoDaOrquestracao {
  const cache = new Map<string, SnapshotPane | null>();
  const agora = (): Date => d.agora?.() ?? new Date();

  function snapshotDe(paneId: string): SnapshotPane | null {
    if (cache.has(paneId)) return cache.get(paneId) ?? null;
    const r = d.repo.lerSnapshotPane(paneId);
    const s: SnapshotPane | null = r === null ? null : { cli: r.cli, nivel: r.nivel_isolamento, skills: r.skills, mcp_do_usuario: r.mcp_do_usuario, servidores_mcp: r.servidores_mcp };
    if (s !== null) cache.set(paneId, s); // ausência não é cacheada: o preparo logo depois grava
    return s;
  }

  function resolver(a: Omit<AlvoDaPolitica, "pane_id" | "cli" | "pedidas"> & { cli: string; pedidas: string[] | null }) {
    const itens = itensSkill(d.repo, a.workspace_id);
    const entrada = {
      modo: a.modo,
      papel: a.papel,
      agente_id: a.agente_id,
      mission_id: a.mission_id,
      cli: (a.cli in NIVEL_POR_CLI ? a.cli : "claude") as CliCatalogo,
      pedidas: a.pedidas,
      politicas: d.repo.listarPoliticas(a.workspace_id),
      skillsDoCatalogo: itens.map(paraItemSkill),
      metodoInstalado: itens.some((i) => i.origem === "metodo"),
      missaoComMetodo: d.missaoComMetodo(a.mission_id),
      membro: a.membro,
    };
    return { r: resolverPolitica(entrada), itens };
  }

  const portaMcp: PortaCatalogo = {
    async permitidasDoPane(paneId) {
      const s = snapshotDe(paneId)?.skills;
      return s === undefined || s === null ? null : [...s];
    },
    async permitidasDoPapel(p) {
      if (p.modo === "livre") return null;
      const membro = p.agente_id === null ? null : (d.membroDoAgente?.(p.agente_id) ?? null);
      const { r } = resolver({ workspace_id: p.workspace_id, mission_id: p.mission_id, agente_id: p.agente_id, modo: p.modo, papel: p.papel, cli: "claude", pedidas: null, membro });
      return r.skills;
    },
    async listar(p: PedidoCatalogoMcp) {
      return listarCatalogo(p);
    },
  };

  function listarCatalogo(p: PedidoCatalogoMcp): { items: ItemCatalogoMcp[]; next_cursor: string | null; truncated: boolean } {
    const tipo = p.kind as TipoCatalogo;
    let itens = d.repo.listarPorTipo(tipo, p.workspace_id, 200).itens.filter((i) => i.instalacoes.some((x) => x.estado === "presente"));
    const snap = snapshotDe(p.pane_id);
    const sinteticas: ItemCatalogoMcp[] = [];
    if (p.kind === "skill" && p.permitidas !== null) {
      const ok = new Set(p.permitidas);
      itens = itens.filter((i) => ok.has(i.nome_normalizado));
      // `ev-*` vão por Pane (plugin efêmero) e podem não estar no catálogo varrido
      const vistos = new Set(itens.map((i) => i.nome_normalizado));
      for (const n of NOMES_EMBARCADAS) if (ok.has(n) && !vistos.has(n)) sinteticas.push({ name: EMBARCADAS_EXIBICAO[n] ?? n, kind: "skill", origin: "embarcada", description: null, clis: ["claude"], allowed: true });
    } else if (p.kind === "mcp_server" && snap !== null && snap.skills !== null) {
      const ok = new Set(snap.mcp_do_usuario === "lista" ? snap.servidores_mcp.map(normalizarNomeSkill) : []);
      itens = itens.filter((i) => ok.has(normalizarNomeSkill(i.nome)));
    }
    if (p.query !== null) {
      const q = normalizarNomeSkill(p.query);
      if (q !== "") itens = itens.filter((i) => i.nome_normalizado.includes(q));
    }
    const todos: ItemCatalogoMcp[] = [
      ...sinteticas.filter((s) => p.query === null || normalizarNomeSkill(s.name).includes(normalizarNomeSkill(p.query))),
      ...itens.map((i): ItemCatalogoMcp => ({ name: i.nome, kind: i.tipo as TipoCatalogList, origin: i.origem, description: i.descricao, clis: [...new Set(i.instalacoes.filter((x) => x.estado === "presente").map((x) => x.cli))].sort(), allowed: true })),
    ].sort((a, b) => a.name.localeCompare(b.name));
    const inicio = p.cursor === null ? 0 : Number.parseInt(p.cursor, 10);
    const de = Number.isInteger(inicio) && inicio >= 0 && inicio <= LIMITE_CURSOR ? inicio : 0;
    const pagina = todos.slice(de, de + p.limit);
    const fim = de + pagina.length;
    return { items: pagina, next_cursor: fim < todos.length ? String(fim) : null, truncated: fim < todos.length };
  }

  return {
    portaMcp,
    liberar(paneId) {
      cache.delete(paneId);
    },
    gate(paneId, tipo, nome) {
      try {
        const snap = snapshotDe(paneId);
        if (snap === null) {
          // Pane de Missão squad/agentico sem snapshot: falha FECHADA. Livre/avulso: sem política, libera.
          const modo = d.modoDoPane(paneId);
          if (modo === "squad" || modo === "agentico") {
            return { permitido: false, motivo: tipo === "skill" ? "skill_not_allowed: a política deste Pane não está disponível." : "mcp_not_allowed: a política deste Pane não está disponível." };
          }
          return { permitido: true };
        }
        return decidirGate({ tipo, nome, snapshot: snap });
      } catch {
        return { permitido: false, motivo: "O gate de skills falhou: ação bloqueada." };
      }
    },
    async preparar(a) {
      if (a.modo === "livre") {
        d.repo.apagarSnapshotPane(a.pane_id);
        cache.delete(a.pane_id);
        return null;
      }
      const { r, itens } = resolver(a);
      const cli = a.cli;
      const nivel = (NIVEL_POR_CLI as Record<string, "duro" | "parcial" | "nenhum">)[cli] ?? "nenhum";
      const resolvida: PoliticaResolvida = { skills: r.skills, faltando: r.faltando, mcp_do_usuario: r.mcp_do_usuario, servidores_mcp: r.servidores_mcp, isolamento: r.isolamento };
      d.repo.gravarSnapshotPane({ pane_id: a.pane_id, cli, nivel_isolamento: nivel, skills: r.skills, mcp_do_usuario: r.mcp_do_usuario, servidores_mcp: r.servidores_mcp, resolvido_em: agora().toISOString() });
      cache.delete(a.pane_id);
      d.emitir?.(nivel === "duro" ? "catalog.isolation_applied" : "catalog.isolation_partial", { pane_id: a.pane_id, cli, nivel, n_skills: r.skills?.length ?? 0 });
      let temPlugin = false;
      if (cli === "claude" && d.materializarEmbarcadas !== undefined) {
        const nomes = (r.skills ?? []).filter((n) => NOMES_EMBARCADAS.includes(n)).map((n) => EMBARCADAS_EXIBICAO[n] ?? n);
        if (nomes.length > 0) {
          try {
            temPlugin = (await d.materializarEmbarcadas({ paneId: a.pane_id, nomes })).nomes.length > 0;
          } catch (erro) {
            d.avisar?.(`As skills do produto não entraram no Pane (${erro instanceof Error ? erro.message : "erro"}).`);
          }
        }
      }
      const mcps = d.repo.listarPorTipo("mcp_server", a.workspace_id, 0).itens.map((i) => i.nome);
      return { resolvida, skillsConhecidas: itens.map((i) => i.nome), servidoresUsuario: mcps, temPluginEfemero: temPlugin };
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Montagem para o main: liga o adaptador aos repositórios reais, ao perfil do membro de squad e ao plugin efêmero das skills embarcadas.
export interface DepsCatalogoDoMain {
  repos: { catalogo: DepsCatalogoOrquestracao["repo"]; pane: { obter(id: string): { mission_id: string | null; papel: Papel } | undefined }; mission: { obter(id: string): { modo: ModoMissao; origem: string } | undefined } };
  membroDoAgente?: DepsCatalogoOrquestracao["membroDoAgente"];
  dirApp: string;
  /** pasta com `manifesto.json` e `ev-*` (resources/skills) */
  dirSkills: () => string;
  emitir?: DepsCatalogoOrquestracao["emitir"];
  avisar?: DepsCatalogoOrquestracao["avisar"];
}

export function criarCatalogoOrqDoMain(a: DepsCatalogoDoMain): CatalogoDaOrquestracao {
  return criarCatalogoDaOrquestracao({
    repo: a.repos.catalogo,
    // só Pane ORQUESTRADO (piloto/worker) de Missão squad/agentico entra na falha fechada; terminal avulso (`papel: nenhum`) e Pane livre não têm política
    modoDoPane(paneId) {
      const p = a.repos.pane.obter(paneId);
      if (p === undefined || p.mission_id === null || p.papel === "nenhum") return null;
      const m = a.repos.mission.obter(p.mission_id);
      return m === undefined || m.modo === "livre" ? null : m.modo;
    },
    missaoComMetodo(missionId) {
      if (missionId === null) return false;
      const m = a.repos.mission.obter(missionId);
      return m !== undefined && m.origem !== "livre";
    },
    ...(a.membroDoAgente === undefined ? {} : { membroDoAgente: a.membroDoAgente }),
    async materializarEmbarcadas({ paneId, nomes }) {
      const dirSkills = a.dirSkills();
      const manifesto = await lerManifesto(dirSkills);
      return materializarEmbarcadasDoPane({ dirApp: a.dirApp, paneId, nomes, dirSkills, manifesto });
    },
    ...(a.emitir === undefined ? {} : { emitir: a.emitir }),
    ...(a.avisar === undefined ? {} : { avisar: a.avisar }),
  });
}
