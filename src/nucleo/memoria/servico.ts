// Fachada do núcleo da memória: uma entrada só para o main (IPC `memoria:*`) e para as tools MCP `memory_*`. Sem Electron.
// A identidade vem SEMPRE do `pane_id` do token e é re-resolvida no banco a cada chamada (modo, Missão, linhagem, squad), o que
// reconfere "memória desligada depois de o token ser emitido" (→ `memory_disabled`) e ignora `mission_id` vindo de argumento.
import type { Banco } from "../banco";
import type { Scrubber } from "../cofre/scrubber";
import type { ConfigMemoria, EntradaMemoria, EstadoMemoriaApp, PreviaBrief } from "../../compartilhado/memoria";
import { TIPOS_MEMORIA } from "../../compartilhado/memoria";
import { criarCiclo } from "./ciclo";
import { ligarColetor, type BarramentoColetor } from "./coletor";
import { resolverContextoDoPane } from "./contexto";
import { consultarAntesDeImplementar } from "./consulta-previa";
import { BRIEF_MIN, CONTEUDO_MAX } from "./constantes";
import { atualizarEntrada, type PedidoEdicao } from "./edicao";
import { criarEscritor, criarLimitador, type Limitador } from "./escrita";
import { conhecimentoNulo, type PortaConhecimento } from "./eventos-conhecimento";
import { ftsDisponivel } from "./fts";
import { buscar } from "./leitura";
import { KIND_PARA_TIPO, SCOPE_BUSCA } from "./mapas";
import { criarMetricas, type Metricas } from "./metricas";
import { gravarPreferencia, listarPreferencias, removerPreferencia } from "./preferencias";
import { esquecer, esquecerComoAgente, esquecerPane, exportar, purgar, type DepsPrivacidade } from "./privacidade";
import { estadoMemox, memoxInstalado } from "./ponte-memox";
import { criarRepoMemoria, type FiltroListagem, type PatchConfig } from "./repo";
import { criarRestaurador, montarBriefDoPane, type PortasRestaurar } from "./restaurar";
import { MemoriaErro, type ContextoMemoria, type LinhaEntrada } from "./tipos";
import { buscarHibrida, indexarVetores, pendentesDeVetor } from "./vetorial/busca";
import type { ProvedorEmbedding } from "./vetorial/embedding";
import { linhagemDe } from "./linhagem";
import { pacoteDoBanco } from "./pacote";

export interface DepsServico {
  banco: Banco;
  agora?: () => Date;
  porta?: PortaConhecimento;
  scrubber?: Pick<Scrubber, "scrub">;
  metricas?: Metricas;
  limitador?: Limitador;
  raizDoWorkspace?: (workspaceId: string) => string | undefined;
  cliTemMcp?: (cli: string | null) => boolean;
  /** barramento de domínio (só metadados). */
  emitir?: (tipo: string, payload: Record<string, string | number | boolean>) => void;
  /** provedor de embedding ESCOLHIDO (local por padrão; remoto já deve vir envolvido por `exigirConsentimento`). */
  provedorEmbedding?: () => ProvedorEmbedding | null;
}

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const inv = (m: string): MemoriaErro => new MemoriaErro("invalid_argument", m);

function texto(args: Record<string, unknown>, campo: string, max: number, obrigatorio = true): string | undefined {
  const v = args[campo];
  if (v === undefined || v === null) {
    if (obrigatorio) throw inv(`${campo} é obrigatório.`);
    return undefined;
  }
  if (typeof v !== "string") throw inv(`${campo} deve ser texto.`);
  if (v.length > 20_000 || Array.from(v).length > max) throw new MemoriaErro("too_large", `${campo} passa de ${max} caracteres.`);
  return v;
}
function inteiro(args: Record<string, unknown>, campo: string): number | undefined {
  const v = args[campo];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) throw inv(`${campo} deve ser inteiro.`);
  return v;
}
function lista(args: Record<string, unknown>, campo: string, maxItens: number, maxChars: number): string[] {
  const v = args[campo];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > maxItens || v.some((x) => typeof x !== "string")) throw inv(`${campo} deve ser uma lista de até ${maxItens} textos.`);
  return (v as string[]).map((x) => {
    if (Array.from(x).length > maxChars) throw new MemoriaErro("too_large", `item de ${campo} passa de ${maxChars} caracteres.`);
    return x;
  });
}

const paraEntrada = (l: LinhaEntrada & { display_id?: number | null }): EntradaMemoria => ({
  id: l.id, escopo: l.escopo, anel: l.anel, tipo: l.tipo, conteudo: l.conteudo, fonte: l.fonte, importancia: l.importancia, redigido: l.redigido === 1, estado: l.estado,
  mission_id: l.mission_id, pane_id: l.pane_id, squad_slug: l.squad_slug, display_id: l.display_id ?? null, contagem: l.contagem, criado_em: l.criado_em, atualizado_em: l.atualizado_em,
});

export function criarServicoMemoria(d: DepsServico) {
  const banco = d.banco;
  const repo = criarRepoMemoria(banco, d.agora);
  const metricas = d.metricas ?? criarMetricas();
  const porta = d.porta ?? conhecimentoNulo;
  const limitador = d.limitador ?? criarLimitador();
  const base = { banco, ...(d.agora ? { agora: d.agora } : {}), ...(d.scrubber ? { scrubber: d.scrubber } : {}) };
  const escritor = criarEscritor({ ...base, porta, limitador, metricas, ...(d.raizDoWorkspace ? { raizDoWorkspace: d.raizDoWorkspace } : {}) });
  const ciclo = criarCiclo({ ...base, porta, metricas, ...(d.raizDoWorkspace ? { raizDoWorkspace: d.raizDoWorkspace } : {}), emitir: (t, p) => d.emitir?.(t, p) });
  const priv: DepsPrivacidade = { ...base, ...(d.raizDoWorkspace ? { raizDoWorkspace: d.raizDoWorkspace } : {}), emitir: (t, p) => d.emitir?.(t, p) };

  /** Identidade re-resolvida do banco a cada chamada; `off` vira `memory_disabled`. */
  function ctxDoToken(paneId: unknown): ContextoMemoria {
    if (typeof paneId !== "string" || paneId === "") throw new MemoriaErro("unauthorized", "token sem Pane.");
    let ctx: ContextoMemoria;
    try {
      ctx = resolverContextoDoPane(banco, paneId, d.cliTemMcp ? { cliTemMcp: d.cliTemMcp } : {});
    } catch {
      throw new MemoriaErro("unauthorized", "Pane do token não existe mais.");
    }
    if (ctx.modo === "off") throw new MemoriaErro("memory_disabled", "A memória está desligada para este Pane.");
    return ctx;
  }

  const servico = {
    repo,
    ciclo,
    metricas,
    ctxDoToken,

    // ---------- tools MCP (entrada = argumentos crus do agente; saída = contrato externo) ----------
    memory_write(paneId: unknown, bruto: unknown): { entry_id: string; redacted: boolean } {
      const a = obj(bruto);
      const ctx = ctxDoToken(paneId);
      const content = texto(a, "content", CONTEUDO_MAX) as string;
      const kind = texto(a, "kind", 30) as string;
      const tipo = KIND_PARA_TIPO[kind];
      if (!tipo || kind === "event" || kind === "handoff" || kind === "summary") throw inv("kind inválido.");
      const importance = inteiro(a, "importance");
      const scope = a.scope === undefined || a.scope === null ? undefined : a.scope;
      if (scope !== undefined && scope !== "pane" && scope !== "mission") throw inv("scope deve ser pane ou mission.");
      const r = escritor.gravar({ ctx, tipo, conteudo: content, ...(importance !== undefined ? { importancia: importance } : {}), ...(scope ? { escopo: scope === "mission" ? ("missao" as const) : ("pane" as const) } : {}), origem: "agente" });
      if (!r) throw inv("entrada descartada.");
      d.emitir?.("memory.entry_created", { entrada_id: r.entry_id, tipo, escopo: scope === "mission" ? "missao" : "pane" });
      return { entry_id: r.entry_id, redacted: r.redacted };
    },

    memory_checkpoint(paneId: unknown, bruto: unknown): { entry_ids: string[] } {
      const a = obj(bruto);
      const ctx = ctxDoToken(paneId);
      if (ctx.papel !== "piloto" && ctx.modo !== "solo") throw new MemoriaErro("unauthorized", "só o piloto e o Pane livre gravam checkpoint.");
      const summary = texto(a, "summary", CONTEUDO_MAX) as string;
      const proximos = lista(a, "next_steps", 10, 300);
      const riscos = lista(a, "risks", 10, CONTEUDO_MAX);
      const conteudo = Array.from(proximos.length > 0 ? `${summary} Próximos passos: ${proximos.join("; ")}` : summary).slice(0, CONTEUDO_MAX).join("");
      const ids: string[] = [];
      banco.transacao(() => {
        const cp = escritor.gravar({ ctx, tipo: "checkpoint", conteudo, origem: "agente" });
        if (cp) ids.push(cp.entry_id);
        for (const r of riscos) {
          const x = escritor.gravar({ ctx, tipo: "risco", conteudo: r, importancia: 4, origem: "agente" });
          if (x) ids.push(x.entry_id);
        }
      });
      return { entry_ids: ids };
    },

    async memory_search(paneId: unknown, bruto: unknown): Promise<ReturnType<typeof buscar>> {
      const a = obj(bruto);
      const ctx = ctxDoToken(paneId);
      const query = texto(a, "query", 200, false);
      const scope = a.scope === undefined || a.scope === null ? "pane" : a.scope;
      if (typeof scope !== "string" || !(SCOPE_BUSCA as readonly string[]).includes(scope)) throw inv("scope inválido.");
      const kinds = lista(a, "kinds", 20, 30);
      const tipos = kinds.map((k) => {
        const t = KIND_PARA_TIPO[k];
        if (!t) throw inv("kind inválido.");
        return t;
      });
      const paneAlvo = a.pane_id === undefined || a.pane_id === null ? null : a.pane_id;
      if (paneAlvo !== null && typeof paneAlvo !== "string") throw inv("pane_id deve ser texto.");
      const limit = inteiro(a, "limit");
      const pedido = { ctx, ...(query ? { query } : {}), scope: scope as (typeof SCOPE_BUSCA)[number], pane_id: paneAlvo, tipos, ...(limit !== undefined ? { limit } : {}) };
      const prov = d.provedorEmbedding?.() ?? null;
      const r = prov && query ? await buscarHibrida({ ...base, provedor: prov }, pedido) : buscar(base, pedido);
      return { entries: r.entries, truncated: r.truncated, notice: r.notice };
    },

    memory_brief(paneId: unknown, bruto: unknown): { markdown: string; truncated: boolean } {
      const a = obj(bruto);
      const ctx = ctxDoToken(paneId);
      const alvo = a.pane_id === undefined || a.pane_id === null ? ctx.pane_id : a.pane_id;
      if (typeof alvo !== "string") throw inv("pane_id deve ser texto.");
      if (alvo !== ctx.pane_id) {
        // só o próprio Pane ou a própria linhagem (respawns dele)
        let raizAlvo: string | undefined;
        try {
          raizAlvo = linhagemDe(banco, alvo).at(-1);
        } catch {
          throw new MemoriaErro("not_found", "Pane não encontrado.");
        }
        if (raizAlvo !== ctx.linhagem_id) throw new MemoriaErro("unauthorized", "memory_brief só do próprio Pane/linhagem.");
      }
      const budget = inteiro(a, "budget_chars");
      const cfg = repo.obterConfig(ctx.workspace_id);
      const orcamento = budget === undefined ? cfg.orcamento_brief_chars : Math.min(cfg.orcamento_brief_chars, Math.max(BRIEF_MIN, budget));
      const b = montarBriefDoPane({ ...base, ...(d.cliTemMcp ? { cliTemMcp: d.cliTemMcp } : {}), memoxInstalado: (ws) => d.raizDoWorkspace?.(ws) !== undefined && memoxInstalado(d.raizDoWorkspace(ws) as string) }, alvo, { orcamento });
      d.emitir?.("memory.brief_built", { pane_id: alvo, caracteres: b.caracteres, truncado: b.truncado });
      return { markdown: b.markdown, truncated: b.truncado };
    },

    memory_forget(paneId: unknown, bruto: unknown): { ok: true } {
      const a = obj(bruto);
      const ctx = ctxDoToken(paneId);
      const id = texto(a, "entry_id", 80) as string;
      return esquecerComoAgente(priv, ctx, id);
    },

    /** `mission_complete` (T-03.02) devolve `aviso: "no_learning_recorded"` quando isto for false. */
    missaoTemAprendizado: (missionId: string): boolean =>
      Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM memoria_entrada WHERE mission_id = ? AND tipo = 'aprendizado' AND fonte = 'agente' AND estado = 'ativa'", [missionId])?.n ?? 0) > 0,

    // ---------- IPC `memoria:*` (ação humana) ----------
    listar(f: FiltroListagem): { itens: EntradaMemoria[]; proximo: string | null } {
      const p = repo.listarPaginado(f);
      return { itens: p.itens.map(paraEntrada), proximo: p.proximo };
    },
    async estado(workspaceId: string): Promise<EstadoMemoriaApp> {
      const config = repo.obterConfig(workspaceId);
      const raiz = d.raizDoWorkspace?.(workspaceId);
      const bytes = repo.tamanhoBytes(workspaceId);
      const memox = raiz ? await estadoMemox(raiz) : { instalado: false, texto: null, aviso: null };
      const missoes = Object.fromEntries(banco.consultar<{ mission_id: string; ativa: number }>("SELECT c.mission_id AS mission_id, c.ativa AS ativa FROM memoria_missao_config c JOIN mission m ON m.id = c.mission_id WHERE m.workspace_id = ?", [workspaceId]).map((l) => [l.mission_id, l.ativa === 1]));
      return { config, missoes, contagens: repo.contagensPorEscopo(workspaceId), tamanho_bytes: bytes, aviso_teto: bytes >= config.teto_mb * 1024 * 1024 * 0.8, fts5: ftsDisponivel(banco), memox: { instalado: memox.instalado, texto: memox.texto } };
    },
    gravarConfig(workspaceId: string, patch: PatchConfig & { global_ativa?: boolean }): ConfigMemoria {
      const agora = (d.agora ?? (() => new Date()))().toISOString();
      if (patch.global_ativa !== undefined) repo.definirGlobalAtiva(patch.global_ativa, agora);
      const { global_ativa: _g, ...resto } = patch;
      void _g;
      return repo.gravarConfig(workspaceId, resto, agora);
    },
    esquecer: (entradaId: string) => esquecer(priv, entradaId),
    esquecerPane: (paneId: string) => esquecerPane(priv, paneId),
    purgar: (p: Parameters<typeof purgar>[1]) => purgar(priv, p),
    /** UI: "Editar" e "Fixar" (importância 5). Só ação humana. */
    atualizar: (p: PedidoEdicao): EntradaMemoria => paraEntrada(atualizarEntrada(base, p)),
    exportar: (p: Parameters<typeof exportar>[1]) => exportar(priv, p),
    preferencias: {
      listar: (): EntradaMemoria[] => listarPreferencias(banco).map(paraEntrada),
      gravar: (p: { id: string | null; conteudo: string; importancia?: number }): EntradaMemoria => paraEntrada(gravarPreferencia(base, p)),
      remover: (id: string): { ok: boolean } => ({ ok: removerPreferencia(banco, id) }),
    },
    briefPrevia(paneId: string): PreviaBrief {
      const b = montarBriefDoPane({ ...base, ...(d.cliTemMcp ? { cliTemMcp: d.cliTemMcp } : {}), memoxInstalado: (ws) => d.raizDoWorkspace?.(ws) !== undefined && memoxInstalado(d.raizDoWorkspace(ws) as string) }, paneId);
      return { markdown: b.markdown, caracteres: b.caracteres, truncado: b.truncado, modo: b.modo };
    },
    restaurador: (portas: Omit<PortasRestaurar, "banco" | "agora">) => criarRestaurador({ ...portas, banco, ...(d.agora ? { agora: d.agora } : {}), ...(d.cliTemMcp && !portas.cliTemMcp ? { cliTemMcp: d.cliTemMcp } : {}) }),
    coletor: (barramento: BarramentoColetor, op: { agendar?: (fn: () => void) => void } = {}) =>
      ligarColetor({ ...base, barramento, porta, metricas, ciclo, ...(d.cliTemMcp ? { cliTemMcp: d.cliTemMcp } : {}), ...(d.raizDoWorkspace ? { raizDoWorkspace: d.raizDoWorkspace } : {}), ...(op.agendar ? { agendar: op.agendar } : {}) }),

    // ---------- pacote da Missão e consulta prévia ----------
    pacoteDaMissao: (paneId: string, papel: "piloto" | "worker") => {
      const ctx = resolverContextoDoPane(banco, paneId, d.cliTemMcp ? { cliTemMcp: d.cliTemMcp } : {});
      if (ctx.modo === "off") return { markdown: "", caracteres: 0, vazio: true, truncado: false };
      if (papel === "worker" && !repo.obterConfig(ctx.workspace_id).pacote_workers) return { markdown: "", caracteres: 0, vazio: true, truncado: false };
      return pacoteDoBanco(banco, ctx, papel, undefined, d.agora);
    },
    consultaPrevia: (paneId: string, descricao: string) => {
      const ctx = resolverContextoDoPane(banco, paneId, d.cliTemMcp ? { cliTemMcp: d.cliTemMcp } : {});
      const prov = d.provedorEmbedding?.() ?? null;
      return consultarAntesDeImplementar({ ...base, ...(prov ? { vetorial: { provedor: prov } } : {}) }, { ctx, descricao });
    },
    /** fatia de indexação de vetores (chamada em ocioso pelo main); no-op sem provedor. */
    async indexarVetoresPendentes(lote = 50): Promise<{ indexadas: number; restantes: number }> {
      const prov = d.provedorEmbedding?.() ?? null;
      if (!prov) return { indexadas: 0, restantes: 0 };
      const r = await indexarVetores({ ...base, provedor: prov }, { lote });
      return r;
    },
    vetoresPendentes: (): number => {
      const prov = d.provedorEmbedding?.() ?? null;
      return prov ? pendentesDeVetor(banco, prov.id) : 0;
    },
  };
  return servico;
}

export type ServicoMemoria = ReturnType<typeof criarServicoMemoria>;
export { TIPOS_MEMORIA };
