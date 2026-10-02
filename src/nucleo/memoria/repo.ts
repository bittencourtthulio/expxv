// Repositório da memória (T-08.04). SQL só aqui; regras de negócio ficam em escrita/leitura/ciclo.
import type { Banco, Valor } from "../banco";
import { novoId } from "../banco/repos/comum";
import type { EscopoMemoria, LinhaEntrada, TipoMemoria } from "./tipos";
import { BRIEF_PADRAO, DECISOES_NO_BRIEF, EVENTOS_NO_BRIEF, RETENCAO_PADRAO_DIAS, RISCOS_NO_BRIEF } from "./constantes";
import type { ConfigMemoria } from "../../compartilhado/memoria";

export const novoIdMemoria = (): string => novoId("evento", "mem");

export interface ItemBrief {
  tipo: TipoMemoria;
  fonte: "sistema" | "agente" | "usuario";
  conteudo: string;
  importancia: number;
  atualizado_em: string;
  criado_em: string;
}

export interface DadosBrief {
  checkpoint: ItemBrief | null;
  decisoes: ItemBrief[];
  riscos: ItemBrief[];
  eventos: ItemBrief[];
}

export interface FiltroListagem {
  workspace_id: string;
  escopo?: EscopoMemoria | null;
  mission_id?: string | null;
  linhagem_id?: string | null;
  tipos?: TipoMemoria[] | null;
  busca?: string | null;
  depois?: string | null;
  limite?: number;
  /** inclui entradas não ativas (padrão: só ativas). */
  todas?: boolean;
}

export interface LinhaListada extends LinhaEntrada {
  display_id: number | null;
}

type LinhaConfig = {
  workspace_id: string;
  ativa: number;
  solo: number;
  squad: number;
  orcamento_brief_chars: number;
  retencao_dias: number;
  teto_mb: number;
  pacote_workers: number;
  embedding_modelo: string | null;
};

export type PatchConfig = Partial<Omit<ConfigMemoria, "workspace_id" | "global_ativa">>;

const COLUNAS = "id, workspace_id, mission_id, pane_id, linhagem_id, squad_slug, escopo, anel, tipo, conteudo, fonte, autor_pane_id, importancia, substitui_id, estado, expira_em, redigido, hash_conteudo, contagem, criado_em, atualizado_em";

/** Entrada viva: não vencida pelo `expira_em` (a varredura em ocioso só muda o `estado` depois; até lá o vencido já não pode aparecer). */
const VIVA = "(expira_em IS NULL OR expira_em > ?)";

export function criarRepoMemoria(banco: Banco, relogio?: () => Date) {
  const agoraIso = (): string => (relogio ?? ((): Date => new Date()))().toISOString();
  const stInserir = banco.preparar(
    `INSERT INTO memoria_entrada (${COLUNAS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const stObter = banco.preparar<LinhaEntrada>(`SELECT ${COLUNAS} FROM memoria_entrada WHERE id = ?`);
  const stToque = banco.preparar("UPDATE memoria_entrada SET contagem = contagem + 1, atualizado_em = ? WHERE id = ?");

  const bool = (v: unknown): boolean => Number(v) === 1;
  const mapearConfig = (l: LinhaConfig, global: boolean): ConfigMemoria => ({
    workspace_id: l.workspace_id,
    ativa: bool(l.ativa),
    solo: bool(l.solo),
    squad: bool(l.squad),
    orcamento_brief_chars: Number(l.orcamento_brief_chars),
    retencao_dias: Number(l.retencao_dias),
    teto_mb: Number(l.teto_mb),
    pacote_workers: bool(l.pacote_workers),
    embedding_modelo: l.embedding_modelo,
    global_ativa: global,
  });

  const repo = {
    inserir(l: LinhaEntrada): void {
      stInserir.executar([
        l.id, l.workspace_id, l.mission_id, l.pane_id, l.linhagem_id, l.squad_slug, l.escopo, l.anel, l.tipo, l.conteudo, l.fonte,
        l.autor_pane_id, l.importancia, l.substitui_id, l.estado, l.expira_em, l.redigido, l.hash_conteudo, l.contagem, l.criado_em, l.atualizado_em,
      ]);
    },
    obter: (id: string): LinhaEntrada | undefined => stObter.consultarUm([id]),

    /** Dedupe: mesma entrada (hash+tipo) ativa, no mesmo "dono" do escopo, atualizada desde `desde`. */
    buscarDuplicada(p: { escopo: EscopoMemoria; tipo: TipoMemoria; hash: string; workspace_id: string | null; linhagem_id: string | null; mission_id: string | null; squad_slug: string | null; desde: string }): LinhaEntrada | undefined {
      const dono: string[] = [];
      const par: Valor[] = [p.escopo, p.hash, p.tipo, p.desde];
      if (p.escopo === "pane") {
        dono.push("linhagem_id = ?");
        par.push(p.linhagem_id);
      } else if (p.escopo === "missao") {
        dono.push("mission_id = ?");
        par.push(p.mission_id);
      } else if (p.escopo === "squad") {
        dono.push("workspace_id = ? AND squad_slug = ?");
        par.push(p.workspace_id, p.squad_slug);
      } else if (p.escopo === "workspace") {
        dono.push("workspace_id = ?");
        par.push(p.workspace_id);
      }
      return banco.consultarUm<LinhaEntrada>(
        `SELECT ${COLUNAS} FROM memoria_entrada WHERE escopo = ? AND hash_conteudo = ? AND tipo = ? AND estado = 'ativa' AND atualizado_em >= ? ${dono.length ? "AND " + dono.join(" AND ") : ""} ORDER BY atualizado_em DESC LIMIT 1`,
        par,
      );
    },
    tocarDuplicada: (id: string, agora: string): void => void stToque.executar([agora, id]),

    /** Marca o(s) checkpoint(s) ativo(s) anteriores como substituídos (mesma linhagem para Pane, mesma Missão para Missão). */
    substituirCheckpointsAnteriores(p: { escopo: EscopoMemoria; linhagem_id: string | null; mission_id: string | null; exceto: string; agora: string }): number {
      const coluna = p.escopo === "pane" ? "linhagem_id" : "mission_id";
      const valor = p.escopo === "pane" ? p.linhagem_id : p.mission_id;
      if (valor === null) return 0;
      return banco.executar(
        `UPDATE memoria_entrada SET estado = 'substituida', atualizado_em = ? WHERE ${coluna} = ? AND escopo = ? AND tipo = 'checkpoint' AND estado = 'ativa' AND id <> ?`,
        [p.agora, valor, p.escopo, p.exceto],
      ).alteracoes;
    },
    ligarSubstituicao: (id: string, substitui: string): void => void banco.executar("UPDATE memoria_entrada SET substitui_id = ? WHERE id = ?", [substitui, id]),
    ultimoCheckpointAnteriorAtivo: (p: { escopo: EscopoMemoria; linhagem_id: string | null; mission_id: string | null; exceto: string }): string | undefined => {
      const coluna = p.escopo === "pane" ? "linhagem_id" : "mission_id";
      const valor = p.escopo === "pane" ? p.linhagem_id : p.mission_id;
      if (valor === null) return undefined;
      return banco.consultarUm<{ id: string }>(`SELECT id FROM memoria_entrada WHERE ${coluna} = ? AND escopo = ? AND tipo = 'checkpoint' AND estado = 'ativa' AND id <> ? ORDER BY atualizado_em DESC LIMIT 1`, [valor, p.escopo, p.exceto])?.id;
    },

    contarAtivasLinhagem: (linhagem: string): number => Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM memoria_entrada WHERE linhagem_id = ? AND estado = 'ativa'", [linhagem])?.n ?? 0),
    contarAtivasWorkspace: (ws: string): number => Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM memoria_entrada WHERE workspace_id = ? AND estado = 'ativa'", [ws])?.n ?? 0),

    /** Expira o `evento` ativo de menor importância (mais antigo) dentro do recorte; false se não há. */
    expirarEventoMaisFraco(recorte: { coluna: "linhagem_id" | "workspace_id"; valor: string }, agora: string): boolean {
      const alvo = banco.consultarUm<{ id: string }>(
        `SELECT id FROM memoria_entrada WHERE ${recorte.coluna} = ? AND estado = 'ativa' AND tipo = 'evento' ORDER BY importancia ASC, atualizado_em ASC LIMIT 1`,
        [recorte.valor],
      );
      if (!alvo) return false;
      banco.executar("UPDATE memoria_entrada SET estado = 'expirada', atualizado_em = ? WHERE id = ?", [agora, alvo.id]);
      return true;
    },

    /** Uma consulta por seção (checkpoint, top decisões, riscos, últimos eventos) — P-14/P-32. */
    carregarParaBrief(linhagem: string): DadosBrief {
      const sel = "tipo, fonte, conteudo, importancia, atualizado_em, criado_em";
      const checkpoint = banco.consultarUm<ItemBrief>(`SELECT ${sel} FROM memoria_entrada WHERE linhagem_id = ? AND tipo = 'checkpoint' AND estado = 'ativa' AND ${VIVA} ORDER BY atualizado_em DESC LIMIT 1`, [linhagem, agoraIso()]) ?? null;
      const decisoes = banco.consultar<ItemBrief>(`SELECT ${sel} FROM memoria_entrada WHERE linhagem_id = ? AND tipo = 'decisao' AND estado = 'ativa' AND ${VIVA} ORDER BY importancia DESC, atualizado_em DESC LIMIT ${DECISOES_NO_BRIEF}`, [linhagem, agoraIso()]);
      const riscos = banco.consultar<ItemBrief>(`SELECT ${sel} FROM memoria_entrada WHERE linhagem_id = ? AND tipo = 'risco' AND estado = 'ativa' AND ${VIVA} ORDER BY importancia DESC, atualizado_em DESC LIMIT ${RISCOS_NO_BRIEF}`, [linhagem, agoraIso()]);
      const eventos = banco.consultar<ItemBrief>(`SELECT ${sel} FROM memoria_entrada WHERE linhagem_id = ? AND tipo IN ('evento','handoff') AND estado = 'ativa' AND ${VIVA} ORDER BY atualizado_em DESC LIMIT ${EVENTOS_NO_BRIEF}`, [linhagem, agoraIso()]);
      return { checkpoint, decisoes, riscos, eventos };
    },

    listarPaginado(f: FiltroListagem): { itens: LinhaListada[]; proximo: string | null } {
      const limite = Math.min(200, Math.max(1, Math.floor(f.limite ?? 50)));
      const onde: string[] = ["e.workspace_id = ?"];
      const par: Valor[] = [f.workspace_id];
      if (!f.todas) (onde.push("e.estado = 'ativa'", "(e.expira_em IS NULL OR e.expira_em > ?)"), par.push(agoraIso()));
      if (f.escopo) (onde.push("e.escopo = ?"), par.push(f.escopo));
      if (f.mission_id) (onde.push("e.mission_id = ?"), par.push(f.mission_id));
      if (f.linhagem_id) (onde.push("e.linhagem_id = ?"), par.push(f.linhagem_id));
      if (f.tipos && f.tipos.length > 0) (onde.push(`e.tipo IN (${f.tipos.map(() => "?").join(",")})`), par.push(...f.tipos));
      if (f.busca && f.busca.trim() !== "") (onde.push("e.conteudo LIKE ? ESCAPE '\\'"), par.push(`%${f.busca.replace(/[\\%_]/g, "\\$&")}%`));
      if (f.depois) (onde.push("e.id < ?"), par.push(f.depois));
      const linhas = banco.consultar<LinhaListada>(
        `SELECT ${COLUNAS.split(", ").map((c) => `e.${c}`).join(", ")}, p.display_id AS display_id FROM memoria_entrada e LEFT JOIN pane p ON p.id = e.pane_id WHERE ${onde.join(" AND ")} ORDER BY e.id DESC LIMIT ${limite + 1}`,
        par,
      );
      const temMais = linhas.length > limite;
      const itens = temMais ? linhas.slice(0, limite) : linhas;
      return { itens, proximo: temMais ? (itens[itens.length - 1] as LinhaListada).id : null };
    },

    contagensPorEscopo(ws: string): Record<EscopoMemoria, number> {
      const base: Record<EscopoMemoria, number> = { pane: 0, missao: 0, squad: 0, workspace: 0, usuario: 0 };
      for (const l of banco.consultar<{ escopo: EscopoMemoria; n: number }>(`SELECT escopo, count(*) AS n FROM memoria_entrada WHERE workspace_id = ? AND estado = 'ativa' AND ${VIVA} GROUP BY escopo`, [ws, agoraIso()])) base[l.escopo] = Number(l.n);
      base.usuario = Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM memoria_entrada WHERE escopo = 'usuario' AND estado = 'ativa'")?.n ?? 0);
      return base;
    },
    /** tamanho aproximado do conteúdo em bytes (soma de length em bytes do texto) do workspace. */
    tamanhoBytes: (ws: string): number => Number(banco.consultarUm<{ n: number | null }>("SELECT sum(length(CAST(conteudo AS BLOB)) + 220) AS n FROM memoria_entrada WHERE workspace_id = ?", [ws])?.n ?? 0),

    apagarEntrada: (id: string): number => banco.executar("DELETE FROM memoria_entrada WHERE id = ?", [id]).alteracoes,
    apagarLinhagem: (linhagem: string): number => banco.executar("DELETE FROM memoria_entrada WHERE linhagem_id = ?", [linhagem]).alteracoes,
    apagarWorkspace(ws: string, escopo: EscopoMemoria | "tudo"): number {
      if (escopo === "tudo") return banco.executar("DELETE FROM memoria_entrada WHERE workspace_id = ?", [ws]).alteracoes;
      if (escopo === "usuario") return 0; // anel 3 não pertence a workspace: só se apaga por `preferencias`
      return banco.executar("DELETE FROM memoria_entrada WHERE workspace_id = ? AND escopo = ?", [ws, escopo]).alteracoes;
    },

    // ----- configuração (criada preguiçosamente com os padrões) -----
    obterConfig(ws: string): ConfigMemoria {
      let l = banco.consultarUm<LinhaConfig>("SELECT * FROM memoria_config WHERE workspace_id = ?", [ws]);
      if (!l) {
        banco.executar("INSERT OR IGNORE INTO memoria_config (workspace_id, orcamento_brief_chars, retencao_dias, atualizado_em) VALUES (?, ?, ?, ?)", [ws, BRIEF_PADRAO, RETENCAO_PADRAO_DIAS, new Date().toISOString()]);
        l = banco.consultarUm<LinhaConfig>("SELECT * FROM memoria_config WHERE workspace_id = ?", [ws]) as LinhaConfig;
      }
      return mapearConfig(l, repo.globalAtiva());
    },
    gravarConfig(ws: string, patch: PatchConfig, agora: string): ConfigMemoria {
      repo.obterConfig(ws);
      const mapa: Record<string, Valor> = {};
      const b = (v: boolean | undefined): Valor | undefined => (v === undefined ? undefined : v ? 1 : 0);
      const cand: Record<string, Valor | undefined> = {
        ativa: b(patch.ativa), solo: b(patch.solo), squad: b(patch.squad), pacote_workers: b(patch.pacote_workers),
        orcamento_brief_chars: patch.orcamento_brief_chars, retencao_dias: patch.retencao_dias, teto_mb: patch.teto_mb,
        embedding_modelo: patch.embedding_modelo === undefined ? undefined : patch.embedding_modelo,
      };
      for (const [k, v] of Object.entries(cand)) if (v !== undefined) mapa[k] = v;
      const chaves = Object.keys(mapa);
      if (chaves.length > 0) banco.executar(`UPDATE memoria_config SET ${chaves.map((k) => `${k} = ?`).join(", ")}, atualizado_em = ? WHERE workspace_id = ?`, [...chaves.map((k) => mapa[k] as Valor), agora, ws]);
      return repo.obterConfig(ws);
    },
    globalAtiva(): boolean {
      const l = banco.consultarUm<{ valor_json: string }>("SELECT valor_json FROM config WHERE chave = 'memoria.ativa'");
      if (!l) return true;
      try {
        return JSON.parse(l.valor_json) !== false;
      } catch {
        return true;
      }
    },
    definirGlobalAtiva(ativa: boolean, agora: string): void {
      banco.executar("INSERT INTO config (chave, valor_json, criado_em, atualizado_em) VALUES ('memoria.ativa', ?, ?, ?) ON CONFLICT(chave) DO UPDATE SET valor_json = excluded.valor_json, atualizado_em = excluded.atualizado_em", [JSON.stringify(ativa), agora, agora]);
    },
    /** null = herda do workspace. */
    missaoAtiva: (mission: string): boolean | null => {
      const l = banco.consultarUm<{ ativa: number }>("SELECT ativa FROM memoria_missao_config WHERE mission_id = ?", [mission]);
      return l ? bool(l.ativa) : null;
    },
    definirMissaoAtiva(mission: string, ativa: boolean | null, agora: string): void {
      if (ativa === null) banco.executar("DELETE FROM memoria_missao_config WHERE mission_id = ?", [mission]);
      else banco.executar("INSERT INTO memoria_missao_config (mission_id, ativa, atualizado_em) VALUES (?, ?, ?) ON CONFLICT(mission_id) DO UPDATE SET ativa = excluded.ativa, atualizado_em = excluded.atualizado_em", [mission, ativa ? 1 : 0, agora]);
    },
  };
  return repo;
}

export type RepoMemoria = ReturnType<typeof criarRepoMemoria>;
