// Restore idempotente (T-08.14): orquestra "Restaurar" de um Pane encerrado. Gate de release: AC-08.01 (1 prompt, 1 envelope),
// AC-08.02 (brief velho é SUBSTITUÍDO) e AC-08.08 (duplo clique = exatamente 1 Pane). A abertura em si é uma porta injetada
// (`servicoPanes.respawn`); aqui moram o lock, a decisão do modo, a montagem do brief e a defesa contra duplicata.
import type { Banco } from "../banco";
import { ehUnicoViolado } from "../banco/repos/comum";
import { NaoEncontradoErro } from "../dominio";
import type { PreviaBrief, ResultadoRestaurar } from "../../compartilhado/memoria";
import { buildBrief, type BriefMontado } from "./brief";
import { resolverContextoDoPane, type OpcoesContexto } from "./contexto";
import { criarRepoMemoria } from "./repo";
import { substituirBrief } from "./sanear-brief";
import { MemoriaErro, type ContextoMemoria } from "./tipos";

export { substituirBrief };

export type ModoRestauro = "auto" | "retomar" | "brief";

export interface AvisoMemoria {
  pane_id: string | null;
  codigo: "brief_falhou" | "fts5_indisponivel" | "limite_atingido";
  mensagem: string;
}

export interface PortasRestaurar extends OpcoesContexto {
  banco: Banco;
  agora?: () => Date;
  /** `servicoPanes.respawn`: abre o filho. O brief NUNCA é persistido (nem como argv): vai em `contexto.brief`/`prompt_inicial`. */
  respawn(paneId: string, op: { contexto: { brief: string | null }; prompt_inicial: string | null; modo: ResultadoRestaurar["modo"] }): Promise<{ pane_id: string; sessao_id: string }>;
  /** a CLI tem retomada nativa de conversa e há conversa conhecida (`argumentosDeRetomada` + `terminais:conversas`). */
  podeRetomar(pane: { id: string; cli: string | null }): boolean | Promise<boolean>;
  /** `.claude/skills/memox/assets/memox.py` existe na raiz do workspace? */
  memoxInstalado?(workspaceId: string): boolean;
  /** prompt inicial que o Pane tinha (se o chamador o conhece): qualquer envelope antigo dele é removido. */
  promptAnterior?(paneId: string): string | null;
  aviso?(a: AvisoMemoria): void;
  emitir?(tipo: "pane.restore_requested" | "memory.brief_built", payload: Record<string, string | number | boolean>): void;
}

export interface BriefDoPane extends PreviaBrief {
  ctx: ContextoMemoria;
  display_id: number | null;
}

/** Brief do Pane (usado por restore, `memoria:brief_previa` e `memory_brief`): exatamente o que o restore injetaria. */
export function montarBriefDoPane(p: Pick<PortasRestaurar, "banco" | "agora" | "memoxInstalado" | "cliTemMcp">, paneId: string, op: { orcamento?: number } = {}): BriefDoPane {
  const ctx = resolverContextoDoPane(p.banco, paneId, p.cliTemMcp ? { cliTemMcp: p.cliTemMcp } : {});
  const repo = criarRepoMemoria(p.banco, p.agora);
  const pane = p.banco.consultarUm<{ display_id: number }>("SELECT display_id FROM pane WHERE id = ?", [paneId]);
  if (ctx.modo === "off" || ctx.linhagem_id === null) return { markdown: "", caracteres: 0, truncado: false, modo: ctx.modo, ctx, display_id: pane?.display_id ?? null };
  const cfg = repo.obterConfig(ctx.workspace_id);
  const dados = repo.carregarParaBrief(ctx.linhagem_id);
  const b: BriefMontado = buildBrief({
    display_id: pane?.display_id ?? null,
    agora: (p.agora ?? (() => new Date()))().toISOString(),
    checkpoint: dados.checkpoint, decisoes: dados.decisoes, riscos: dados.riscos, eventos: dados.eventos,
    orcamento_chars: op.orcamento ?? cfg.orcamento_brief_chars,
    memox_instalado: p.memoxInstalado?.(ctx.workspace_id) ?? false,
  });
  return { markdown: b.markdown, caracteres: b.caracteres, truncado: b.truncado, modo: ctx.modo, ctx, display_id: pane?.display_id ?? null };
}

export function criarRestaurador(p: PortasRestaurar) {
  const emVoo = new Map<string, Promise<ResultadoRestaurar>>();

  const filhoVivo = (paneId: string): { id: string } | undefined =>
    p.banco.consultarUm<{ id: string }>("SELECT id FROM pane WHERE respawn_de = ? AND estado <> 'encerrado' ORDER BY id DESC LIMIT 1", [paneId]);
  const sessaoDe = (paneId: string): string => p.banco.consultarUm<{ id: string }>("SELECT id FROM sessao WHERE pane_id = ? ORDER BY criado_em DESC, id DESC LIMIT 1", [paneId])?.id ?? "";

  async function executar(paneId: string, modo: ModoRestauro): Promise<ResultadoRestaurar> {
    const pane = p.banco.consultarUm<{ id: string; estado: string; cli: string | null; workspace_id: string }>("SELECT id, estado, cli, workspace_id FROM pane WHERE id = ?", [paneId]);
    if (!pane) throw new NaoEncontradoErro("Pane", paneId);
    p.emitir?.("pane.restore_requested", { pane_id: paneId });
    const existente = filhoVivo(paneId);
    if (existente) return { pane_id: existente.id, sessao_id: sessaoDe(existente.id), modo: "sem_memoria", brief_injetado: false, truncado: false, ja_existia: true };
    if (pane.estado !== "encerrado") throw new MemoriaErro("invalid_argument", "O Pane ainda está em uso; só se restaura um Pane encerrado.");

    const ctx = resolverContextoDoPane(p.banco, paneId, p.cliTemMcp ? { cliTemMcp: p.cliTemMcp } : {});
    const retomavel = modo !== "brief" && (await p.podeRetomar({ id: paneId, cli: pane.cli }));
    let decidido: ResultadoRestaurar["modo"];
    if (retomavel) decidido = "retomada";
    else decidido = ctx.modo === "off" ? "sem_memoria" : "brief";

    let brief: string | null = null;
    let truncado = false;
    if (decidido === "brief") {
      try {
        const b = montarBriefDoPane(p, paneId);
        if (b.markdown !== "") {
          brief = b.markdown;
          truncado = b.truncado;
          p.emitir?.("memory.brief_built", { pane_id: paneId, caracteres: b.caracteres, truncado: b.truncado });
        }
      } catch {
        p.aviso?.({ pane_id: paneId, codigo: "brief_falhou", mensagem: "Não foi possível montar o brief; o painel abriu sem ele." });
      }
    }
    const promptInicial = brief === null ? null : substituirBrief(p.promptAnterior?.(paneId) ?? null, brief);
    try {
      const r = await p.respawn(paneId, { contexto: { brief }, prompt_inicial: promptInicial, modo: decidido });
      return { pane_id: r.pane_id, sessao_id: r.sessao_id, modo: decidido, brief_injetado: brief !== null, truncado, ja_existia: false };
    } catch (e) {
      if (ehUnicoViolado(e, "pane.respawn_de")) {
        const vivo = filhoVivo(paneId);
        if (vivo) return { pane_id: vivo.id, sessao_id: sessaoDe(vivo.id), modo: decidido, brief_injetado: false, truncado: false, ja_existia: true };
      }
      throw e;
    }
  }

  return {
    /** Chamadas concorrentes para o mesmo Pane se JUNTAM à primeira: 20 cliques = 1 Pane. */
    restaurarPane(paneId: string, modo: ModoRestauro = "auto"): Promise<ResultadoRestaurar> {
      const atual = emVoo.get(paneId);
      if (atual) return atual.then((r) => ({ ...r, ja_existia: true }));
      const prom = executar(paneId, modo).finally(() => emVoo.delete(paneId));
      emVoo.set(paneId, prom);
      return prom;
    },
  };
}

export type Restaurador = ReturnType<typeof criarRestaurador>;
