// Repositório SQLite do Catálogo (Fase 7, T-07.02): itens (1 linha, N instalações), políticas por papel/agente/Missão, snapshot por Pane,
// skills embarcadas e histórico de varredura. Só METADADO saneado: nunca `env`, headers, argumentos nem texto de comando (a redação é dos scanners).
import type { CliCatalogo, ItemCatalogo, InstalacaoCatalogo, OrigemCatalogo, PapelSugerido, PoliticaSkills, TipoCatalogo, GatilhoVarredura, NivelIsolamento } from "../../../compartilhado/catalogo";
import type { ItemAgregado } from "../../catalogo/varredura";
import type { InstalacaoEscaneada } from "../../catalogo/tipos";
import type { Banco } from "../banco";
import { bool, int, novoId } from "./comum";

export const LIMITE_LISTA_CATALOGO = 5000;
export const RETENCAO_VARREDURAS = 20;

interface LinhaItem {
  id: string; tipo: string; nome: string; nome_normalizado: string; plugin: string | null; autor: string | null; origem: string;
  descricao: string | null; papel_sugerido: string | null; atualizado_em: string;
}
interface LinhaInst {
  item_id: string; cli: string; escopo: string; workspace_id: string; base: string; caminho_rel: string; metodo: string; estado: string;
  habilitada: number; criado_pelo_app: number; hash_conteudo: string | null; tamanho: number | null; mtime_ms: number | null; detalhe_json: string;
}

export interface InstalacaoRegistro extends InstalacaoCatalogo {
  tamanho: number | null;
  mtime_ms: number | null;
}

export interface SnapshotPane {
  pane_id: string;
  cli: string;
  nivel_isolamento: NivelIsolamento;
  /** `null` = sem filtro (livre) */
  skills: string[] | null;
  mcp_do_usuario: "nenhum" | "lista";
  servidores_mcp: string[];
  resolvido_em: string;
}

export interface EmbarcadaRegistro {
  nome: string;
  cli: string;
  versao_instalada: string | null;
  hash_instalado: string | null;
  opt_out: boolean;
  atualizado_em: string;
}

export interface VarreduraRegistro {
  id: string;
  gatilho: GatilhoVarredura;
  iniciada_em: string;
  duracao_ms: number | null;
  adicionados: number | null;
  atualizados: number | null;
  ausentes: number | null;
  erros_json: string;
}

export interface RepoCatalogo {
  upsertLote(itens: readonly ItemAgregado[], vistoEm: string): { adicionados: number; atualizados: number; ids: string[] };
  marcarAusentes(inicio: string, cobertura: { clis: readonly string[]; tipos: readonly string[]; workspace_ids: readonly string[] }): number;
  listarPorTipo(tipo: TipoCatalogo, workspaceId: string | null, descricaoMax?: number): { itens: ItemCatalogo[]; truncado: boolean };
  obter(id: string, descricaoMax?: number): ItemCatalogo | null;
  obterPorNome(tipo: TipoCatalogo, nomeNormalizado: string): ItemCatalogo | null;
  /** nomes normalizados dos itens do tipo que têm ao menos uma instalação presente no escopo (global + workspace). */
  nomesPresentes(tipo: TipoCatalogo, workspaceId: string | null): Set<string>;
  obterInstalacao(itemId: string, cli: string, escopo: string, workspaceId: string): InstalacaoRegistro | null;
  gravarInstalacao(itemId: string, i: InstalacaoEscaneada, agora: string): void;
  removerInstalacao(itemId: string, cli: string, escopo: string, workspaceId: string): void;
  removerItem(id: string): boolean;
  limparAusentes(tipo: TipoCatalogo): number;
  contarAusentes(tipo: TipoCatalogo): number;
  gravarFerramentasMcp(itemId: string, ferramentas: ReadonlyArray<{ nome: string; descricao: string | null }>, agora: string): void;
  ferramentasMcp(itemId: string): Array<{ nome: string; descricao: string | null }>;
  iniciarVarredura(gatilho: GatilhoVarredura, agora: string): string;
  concluirVarredura(id: string, r: { duracao_ms: number; adicionados: number; atualizados: number; ausentes: number; erros_json: string }): void;
  ultimaVarredura(): VarreduraRegistro | null;
  listarPoliticas(workspaceId: string): PoliticaSkills[];
  obterPolitica(workspaceId: string, alvoTipo: string, alvoValor: string): PoliticaSkills | null;
  gravarPolitica(p: Omit<PoliticaSkills, "id" | "atualizado_em">, agora: string): PoliticaSkills;
  removerPolitica(workspaceId: string, alvoTipo: string, alvoValor: string): boolean;
  gravarSnapshotPane(s: SnapshotPane): void;
  lerSnapshotPane(paneId: string): SnapshotPane | null;
  apagarSnapshotPane(paneId: string): void;
  obterEmbarcada(nome: string, cli: string): EmbarcadaRegistro | null;
  listarEmbarcadas(): EmbarcadaRegistro[];
  gravarEmbarcada(r: EmbarcadaRegistro): void;
}

const jsonLista = (s: string | null): string[] => {
  if (s === null) return [];
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const DETALHE_VAZIO: Readonly<Record<string, string | number | boolean | null>> = Object.freeze({});
function detalheDe(s: string): Readonly<Record<string, string | number | boolean | null>> {
  if (s === "{}") return DETALHE_VAZIO;
  try {
    const v: unknown = JSON.parse(s);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    const out: Record<string, string | number | boolean | null> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x === null || ["string", "number", "boolean"].includes(typeof x)) out[k] = x as string | number | boolean | null;
    return out;
  } catch {
    return {};
  }
}

const aInst = (l: LinhaInst): InstalacaoRegistro => ({
  cli: l.cli as CliCatalogo,
  escopo: l.escopo as "global" | "projeto",
  workspace_id: l.workspace_id === "" ? null : l.workspace_id,
  base: l.base as "home" | "workspace",
  caminho_rel: l.caminho_rel,
  metodo: l.metodo as InstalacaoCatalogo["metodo"],
  estado: l.estado as InstalacaoCatalogo["estado"],
  habilitada: bool(l.habilitada),
  criado_pelo_app: bool(l.criado_pelo_app),
  hash_conteudo: l.hash_conteudo,
  tamanho: l.tamanho,
  mtime_ms: l.mtime_ms,
  detalhe: detalheDe(l.detalhe_json),
});

const corta = (s: string | null, max: number): string | null => (s === null ? null : Array.from(s).length <= max ? s : Array.from(s).slice(0, max).join(""));

function montarItem(l: LinhaItem, insts: InstalacaoRegistro[], descMax: number): ItemCatalogo {
  const hashes = new Set(insts.filter((i) => i.estado === "presente" && i.hash_conteudo !== null).map((i) => i.hash_conteudo as string));
  return {
    id: l.id,
    tipo: l.tipo as TipoCatalogo,
    nome: l.nome,
    nome_normalizado: l.nome_normalizado,
    plugin: l.plugin,
    autor: l.autor,
    origem: l.origem as OrigemCatalogo,
    descricao: corta(l.descricao, descMax),
    papel_sugerido: l.papel_sugerido as PapelSugerido | null,
    instalacoes: insts,
    variantes: hashes.size,
    editavel: l.origem === "usuario",
    atualizado_em: l.atualizado_em,
  };
}

const mesmaInst = (a: LinhaInst, i: InstalacaoEscaneada): boolean =>
  a.base === i.base && a.caminho_rel === i.caminho_rel && a.metodo === i.metodo && a.estado === i.estado && bool(a.habilitada) === i.habilitada && bool(a.criado_pelo_app) === i.criado_pelo_app &&
  a.hash_conteudo === i.hash_conteudo && a.tamanho === i.tamanho && a.mtime_ms === i.mtime_ms && a.detalhe_json === JSON.stringify(i.detalhe);

export function criarRepoCatalogo(banco: Banco): RepoCatalogo {
  const gravarInst = (itemId: string, i: InstalacaoEscaneada, agora: string): boolean => {
    const atual = banco.consultarUm<LinhaInst>("SELECT * FROM catalogo_instalacao WHERE item_id=? AND cli=? AND escopo=? AND workspace_id=?", [itemId, i.cli, i.escopo, i.workspace_id]);
    const detalhe = JSON.stringify(i.detalhe).slice(0, 2048);
    if (atual === undefined) {
      banco.executar(
        `INSERT INTO catalogo_instalacao (item_id,cli,escopo,workspace_id,base,caminho_rel,metodo,estado,habilitada,criado_pelo_app,hash_conteudo,tamanho,mtime_ms,detalhe_json,visto_em,criado_em,atualizado_em)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [itemId, i.cli, i.escopo, i.workspace_id, i.base, i.caminho_rel, i.metodo, i.estado, int(i.habilitada), int(i.criado_pelo_app), i.hash_conteudo, i.tamanho, i.mtime_ms, detalhe, agora, agora, agora],
      );
      return true;
    }
    if (mesmaInst(atual, { ...i, detalhe: JSON.parse(detalhe) as InstalacaoEscaneada["detalhe"] })) {
      banco.executar("UPDATE catalogo_instalacao SET visto_em=? WHERE item_id=? AND cli=? AND escopo=? AND workspace_id=?", [agora, itemId, i.cli, i.escopo, i.workspace_id]);
      return false;
    }
    banco.executar(
      `UPDATE catalogo_instalacao SET base=?,caminho_rel=?,metodo=?,estado=?,habilitada=?,criado_pelo_app=?,hash_conteudo=?,tamanho=?,mtime_ms=?,detalhe_json=?,visto_em=?,atualizado_em=?
       WHERE item_id=? AND cli=? AND escopo=? AND workspace_id=?`,
      [i.base, i.caminho_rel, i.metodo, i.estado, int(i.habilitada), int(i.criado_pelo_app || bool(atual.criado_pelo_app)), i.hash_conteudo, i.tamanho, i.mtime_ms, detalhe, agora, agora, itemId, i.cli, i.escopo, i.workspace_id],
    );
    return true;
  };

  const instsDe = (ids: readonly string[]): Map<string, InstalacaoRegistro[]> => {
    const m = new Map<string, InstalacaoRegistro[]>();
    for (let k = 0; k < ids.length; k += 500) {
      const fatia = ids.slice(k, k + 500);
      const linhas = banco.consultar<LinhaInst>(`SELECT * FROM catalogo_instalacao WHERE item_id IN (${fatia.map(() => "?").join(",")}) ORDER BY item_id, cli, escopo, workspace_id`, fatia);
      for (const l of linhas) {
        const a = m.get(l.item_id) ?? [];
        a.push(aInst(l));
        m.set(l.item_id, a);
      }
    }
    return m;
  };

  const aPolitica = (l: Record<string, unknown>): PoliticaSkills => ({
    id: String(l["id"]),
    workspace_id: String(l["workspace_id"]),
    alvo_tipo: l["alvo_tipo"] as PoliticaSkills["alvo_tipo"],
    alvo_valor: String(l["alvo_valor"]),
    skills: jsonLista(l["skills_json"] as string),
    mcp_do_usuario: l["mcp_do_usuario"] as "nenhum" | "lista",
    servidores_mcp: jsonLista(l["servidores_mcp_json"] as string),
    atualizado_em: String(l["atualizado_em"]),
  });

  return {
    upsertLote(itens, vistoEm) {
      let adicionados = 0;
      let atualizados = 0;
      const ids: string[] = [];
      banco.transacao((b) => {
        for (const it of itens) {
          const ex = b.consultarUm<LinhaItem>("SELECT * FROM catalogo_item WHERE tipo=? AND nome_normalizado=?", [it.tipo, it.nome_normalizado]);
          let id: string;
          let mudou = false;
          if (ex === undefined) {
            id = novoId("evento", "cat");
            b.executar(
              "INSERT INTO catalogo_item (id,tipo,nome,nome_normalizado,plugin,autor,origem,descricao,papel_sugerido,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              [id, it.tipo, it.nome, it.nome_normalizado, it.plugin, it.autor, it.origem, it.descricao, it.papel_sugerido, vistoEm, vistoEm],
            );
            adicionados++;
            mudou = true;
          } else {
            id = ex.id;
            if (ex.nome !== it.nome || ex.plugin !== it.plugin || ex.autor !== it.autor || ex.origem !== it.origem || ex.descricao !== it.descricao || ex.papel_sugerido !== it.papel_sugerido) {
              b.executar("UPDATE catalogo_item SET nome=?,plugin=?,autor=?,origem=?,descricao=?,papel_sugerido=?,atualizado_em=? WHERE id=?", [it.nome, it.plugin, it.autor, it.origem, it.descricao, it.papel_sugerido, vistoEm, id]);
              mudou = true;
            }
          }
          let instMudou = false;
          for (const i of it.instalacoes) if (gravarInst(id, i, vistoEm)) instMudou = true;
          if (instMudou && !mudou) b.executar("UPDATE catalogo_item SET atualizado_em=? WHERE id=?", [vistoEm, id]);
          if (ex !== undefined && (mudou || instMudou)) atualizados++;
          if (mudou || instMudou) ids.push(id);
        }
      });
      return { adicionados, atualizados, ids };
    },

    marcarAusentes(inicio, cob) {
      if (cob.clis.length === 0 || cob.tipos.length === 0 || cob.workspace_ids.length === 0) return 0;
      const q = (n: number): string => Array.from({ length: n }, () => "?").join(",");
      const r = banco.executar(
        `UPDATE catalogo_instalacao SET estado='ausente', atualizado_em=?
         WHERE estado <> 'ausente' AND visto_em < ? AND cli IN (${q(cob.clis.length)}) AND workspace_id IN (${q(cob.workspace_ids.length)})
           AND item_id IN (SELECT id FROM catalogo_item WHERE tipo IN (${q(cob.tipos.length)}))`,
        [inicio, inicio, ...cob.clis, ...cob.workspace_ids, ...cob.tipos],
      );
      return r.alteracoes;
    },

    listarPorTipo(tipo, workspaceId, descMax = 160) {
      const linhas = banco.consultar<LinhaItem & LinhaInst>(
        `SELECT i.id,i.tipo,i.nome,i.nome_normalizado,i.plugin,i.autor,i.origem,i.descricao,i.papel_sugerido,i.atualizado_em,
                n.item_id,n.cli,n.escopo,n.workspace_id,n.base,n.caminho_rel,n.metodo,n.estado,n.habilitada,n.criado_pelo_app,n.hash_conteudo,n.tamanho,n.mtime_ms,n.detalhe_json
         FROM catalogo_item i JOIN catalogo_instalacao n ON n.item_id = i.id
         WHERE i.tipo = ? AND n.workspace_id IN ('', ?) ORDER BY i.nome_normalizado, i.id, n.cli, n.escopo`,
        [tipo, workspaceId ?? ""],
      );
      const itens: ItemCatalogo[] = [];
      let atual: { l: LinhaItem; insts: InstalacaoRegistro[] } | null = null;
      let truncado = false;
      const fechar = (): void => {
        if (atual !== null) itens.push(montarItem(atual.l, atual.insts, descMax));
      };
      for (const l of linhas) {
        if (atual === null || atual.l.id !== l.id) {
          fechar();
          if (itens.length >= LIMITE_LISTA_CATALOGO) {
            truncado = true;
            atual = null;
            break;
          }
          atual = { l, insts: [] };
        }
        atual.insts.push(aInst(l));
      }
      if (atual !== null) fechar();
      return { itens, truncado };
    },

    obter(id, descMax = 600) {
      const l = banco.consultarUm<LinhaItem>("SELECT * FROM catalogo_item WHERE id=?", [id]);
      if (l === undefined) return null;
      return montarItem(l, instsDe([id]).get(id) ?? [], descMax);
    },

    obterPorNome(tipo, nn) {
      const l = banco.consultarUm<LinhaItem>("SELECT * FROM catalogo_item WHERE tipo=? AND nome_normalizado=?", [tipo, nn]);
      return l === undefined ? null : montarItem(l, instsDe([l.id]).get(l.id) ?? [], 600);
    },

    nomesPresentes(tipo, workspaceId) {
      const linhas = banco.consultar<{ nome_normalizado: string }>(
        `SELECT DISTINCT i.nome_normalizado FROM catalogo_item i JOIN catalogo_instalacao n ON n.item_id=i.id
         WHERE i.tipo=? AND n.estado='presente' AND n.habilitada=1 AND n.workspace_id IN ('', ?)`,
        [tipo, workspaceId ?? ""],
      );
      return new Set(linhas.map((x) => x.nome_normalizado));
    },

    obterInstalacao(itemId, cli, escopo, ws) {
      const l = banco.consultarUm<LinhaInst>("SELECT * FROM catalogo_instalacao WHERE item_id=? AND cli=? AND escopo=? AND workspace_id=?", [itemId, cli, escopo, ws]);
      return l === undefined ? null : aInst(l);
    },
    gravarInstalacao(itemId, i, agora) {
      gravarInst(itemId, i, agora);
    },
    removerInstalacao(itemId, cli, escopo, ws) {
      banco.executar("DELETE FROM catalogo_instalacao WHERE item_id=? AND cli=? AND escopo=? AND workspace_id=?", [itemId, cli, escopo, ws]);
    },

    removerItem(id) {
      const p = banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM catalogo_instalacao WHERE item_id=? AND estado='presente'", [id]);
      if ((p?.n ?? 0) > 0) return false;
      return banco.executar("DELETE FROM catalogo_item WHERE id=?", [id]).alteracoes > 0;
    },
    limparAusentes(tipo) {
      return banco.transacao((b) => b.executar(
        `DELETE FROM catalogo_item WHERE tipo=? AND NOT EXISTS (SELECT 1 FROM catalogo_instalacao n WHERE n.item_id = catalogo_item.id AND n.estado='presente')`,
        [tipo],
      ).alteracoes);
    },
    contarAusentes(tipo) {
      return banco.consultarUm<{ n: number }>(
        `SELECT COUNT(*) AS n FROM catalogo_item WHERE tipo=? AND NOT EXISTS (SELECT 1 FROM catalogo_instalacao n WHERE n.item_id = catalogo_item.id AND n.estado='presente')`,
        [tipo],
      )?.n ?? 0;
    },

    gravarFerramentasMcp(itemId, fs, agora) {
      banco.transacao((b) => {
        b.executar("DELETE FROM catalogo_mcp_tool WHERE servidor_id=?", [itemId]);
        for (const f of fs.slice(0, 500)) b.executar("INSERT INTO catalogo_mcp_tool (id,servidor_id,nome,descricao,verificado_em) VALUES (?,?,?,?,?)", [novoId("evento", "cat"), itemId, f.nome, f.descricao, agora]);
      });
    },
    ferramentasMcp(itemId) {
      return banco.consultar<{ nome: string; descricao: string | null }>("SELECT nome,descricao FROM catalogo_mcp_tool WHERE servidor_id=? ORDER BY nome", [itemId]);
    },

    iniciarVarredura(gatilho, agora) {
      const id = novoId("evento", "cat");
      banco.transacao((b) => {
        b.executar("INSERT INTO catalogo_varredura (id,gatilho,iniciada_em) VALUES (?,?,?)", [id, gatilho, agora]);
        b.executar(`DELETE FROM catalogo_varredura WHERE id NOT IN (SELECT id FROM catalogo_varredura ORDER BY iniciada_em DESC, id DESC LIMIT ${RETENCAO_VARREDURAS})`);
      });
      return id;
    },
    concluirVarredura(id, r) {
      banco.executar("UPDATE catalogo_varredura SET duracao_ms=?,adicionados=?,atualizados=?,ausentes=?,erros_json=? WHERE id=?", [r.duracao_ms, r.adicionados, r.atualizados, r.ausentes, r.erros_json.slice(0, 8192), id]);
    },
    ultimaVarredura() {
      return banco.consultarUm<VarreduraRegistro>("SELECT * FROM catalogo_varredura WHERE duracao_ms IS NOT NULL ORDER BY iniciada_em DESC, id DESC LIMIT 1") ?? null;
    },

    listarPoliticas(ws) {
      return banco.consultar("SELECT * FROM catalogo_politica WHERE workspace_id=? ORDER BY alvo_tipo, alvo_valor", [ws]).map(aPolitica);
    },
    obterPolitica(ws, tipo, valor) {
      const l = banco.consultarUm("SELECT * FROM catalogo_politica WHERE workspace_id=? AND alvo_tipo=? AND alvo_valor=?", [ws, tipo, valor]);
      return l === undefined ? null : aPolitica(l);
    },
    gravarPolitica(p, agora) {
      banco.executar(
        `INSERT INTO catalogo_politica (id,workspace_id,alvo_tipo,alvo_valor,skills_json,mcp_do_usuario,servidores_mcp_json,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(workspace_id,alvo_tipo,alvo_valor) DO UPDATE SET skills_json=excluded.skills_json, mcp_do_usuario=excluded.mcp_do_usuario, servidores_mcp_json=excluded.servidores_mcp_json, atualizado_em=excluded.atualizado_em`,
        [novoId("evento", "cat"), p.workspace_id, p.alvo_tipo, p.alvo_valor, JSON.stringify(p.skills), p.mcp_do_usuario, JSON.stringify(p.servidores_mcp), agora, agora],
      );
      return aPolitica(banco.consultarUm("SELECT * FROM catalogo_politica WHERE workspace_id=? AND alvo_tipo=? AND alvo_valor=?", [p.workspace_id, p.alvo_tipo, p.alvo_valor]) as Record<string, unknown>);
    },
    removerPolitica(ws, tipo, valor) {
      return banco.executar("DELETE FROM catalogo_politica WHERE workspace_id=? AND alvo_tipo=? AND alvo_valor=?", [ws, tipo, valor]).alteracoes > 0;
    },

    gravarSnapshotPane(s) {
      banco.executar(
        `INSERT INTO catalogo_pane_politica (pane_id,cli,nivel_isolamento,skills_json,mcp_do_usuario,servidores_mcp_json,resolvido_em) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(pane_id) DO UPDATE SET cli=excluded.cli, nivel_isolamento=excluded.nivel_isolamento, skills_json=excluded.skills_json, mcp_do_usuario=excluded.mcp_do_usuario, servidores_mcp_json=excluded.servidores_mcp_json, resolvido_em=excluded.resolvido_em`,
        [s.pane_id, s.cli, s.nivel_isolamento, s.skills === null ? null : JSON.stringify(s.skills), s.mcp_do_usuario, JSON.stringify(s.servidores_mcp), s.resolvido_em],
      );
    },
    lerSnapshotPane(paneId) {
      const l = banco.consultarUm<{ pane_id: string; cli: string; nivel_isolamento: string; skills_json: string | null; mcp_do_usuario: string; servidores_mcp_json: string; resolvido_em: string }>("SELECT * FROM catalogo_pane_politica WHERE pane_id=?", [paneId]);
      if (l === undefined) return null;
      return {
        pane_id: l.pane_id, cli: l.cli, nivel_isolamento: l.nivel_isolamento as NivelIsolamento, skills: l.skills_json === null ? null : jsonLista(l.skills_json),
        mcp_do_usuario: l.mcp_do_usuario as "nenhum" | "lista", servidores_mcp: jsonLista(l.servidores_mcp_json), resolvido_em: l.resolvido_em,
      };
    },
    apagarSnapshotPane(paneId) {
      banco.executar("DELETE FROM catalogo_pane_politica WHERE pane_id=?", [paneId]);
    },

    obterEmbarcada(nome, cli) {
      const l = banco.consultarUm<Omit<EmbarcadaRegistro, "opt_out"> & { opt_out: number }>("SELECT * FROM catalogo_embarcada WHERE nome=? AND cli=?", [nome, cli]);
      return l === undefined ? null : { ...l, opt_out: bool(l.opt_out) };
    },
    listarEmbarcadas() {
      return banco.consultar<Omit<EmbarcadaRegistro, "opt_out"> & { opt_out: number }>("SELECT * FROM catalogo_embarcada ORDER BY nome, cli").map((l) => ({ ...l, opt_out: bool(l.opt_out) }));
    },
    gravarEmbarcada(r) {
      banco.executar(
        `INSERT INTO catalogo_embarcada (nome,cli,versao_instalada,hash_instalado,opt_out,atualizado_em) VALUES (?,?,?,?,?,?)
         ON CONFLICT(nome,cli) DO UPDATE SET versao_instalada=excluded.versao_instalada, hash_instalado=excluded.hash_instalado, opt_out=excluded.opt_out, atualizado_em=excluded.atualizado_em`,
        [r.nome, r.cli, r.versao_instalada, r.hash_instalado, int(r.opt_out), r.atualizado_em],
      );
    },
  };
}
