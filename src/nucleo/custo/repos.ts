// Repositórios SQLite do custo (T-10.02): preço, fonte de uso, registro de uso, janela de task, agregado, teto e alerta. Sem regra de negócio: só persistência
// idempotente. Tudo que é "desconhecido" é NULL. Datas UTC ISO com ms. Os repositórios de domínio (task, pane…) continuam em `banco/repos`.
import type { Banco, Declaracao, Parametros, Valor } from "../banco/banco";
import { novoId } from "../banco/repos/comum";
import { agora } from "../banco/tempo";
import { ValorInvalidoErro } from "../dominio";
import type { Atribuicao, BaseFonte, EscopoAgregado, EstadoFonte, OrigemPreco, OrigemUsd, PedidoGravarPreco, Preco } from "../../compartilhado/custo";
import type { LinhaAgregada } from "./agregar";
import type { JanelaTask } from "./atribuicao";
import { PRECOS_COLETADO_EM, PRECOS_FONTE, PRECOS_PADRAO, PRECOS_VALIDOS_DESDE } from "./precos-padrao";

export interface FonteUso {
  id: string;
  cli: string;
  conta_id: string | null;
  pane_id: string | null;
  mission_id: string | null;
  workspace_id: string | null;
  base: BaseFonte | "nenhuma";
  relativo: string;
  offset: number;
  tamanho: number;
  mtime_ms: number | null;
  inode: string | null;
  estado: EstadoFonte;
  erro_codigo: string | null;
  linhas_puladas: number;
  ultima_leitura_em: string | null;
}
export interface NovaFonteUso {
  cli: string;
  base: FonteUso["base"];
  relativo?: string;
  conta_id?: string | null;
  pane_id?: string | null;
  mission_id?: string | null;
  workspace_id?: string | null;
  estado?: EstadoFonte;
}
export interface RegistroUso {
  id: string;
  fonte_id: string;
  chave: string;
  ts: string;
  modelo: string | null;
  tokens_entrada: number;
  tokens_cache_escrita: number;
  tokens_cache_leitura: number;
  tokens_saida: number;
  usd: number | null;
  usd_origem: OrigemUsd;
  preco_id: string | null;
  aproximado: number;
  pane_id: string | null;
  mission_id: string | null;
  workspace_id: string | null;
  conta_id: string | null;
  trabalho_id: string | null;
  task_id: string | null;
  atribuicao: Atribuicao;
}
export type NovoRegistroUso = Omit<RegistroUso, "id">;

export interface DeltaAgregado extends LinhaAgregada {
  escopo: EscopoAgregado;
  chave: string;
  dia: string;
}
export interface TetoMissao {
  mission_id: string;
  teto_usd: number;
  alertado_em: string | null;
}

interface LinhaPreco {
  id: string; padrao: string; familia: string | null; entrada_por_mtok: number; saida_por_mtok: number; cache_escrita_por_mtok: number | null; cache_leitura_por_mtok: number | null;
  origem: OrigemPreco; confirmado: number; valido_desde: string; fonte: string | null; coletado_em: string | null;
}
const mapearPreco = (l: LinhaPreco): Preco => ({ ...l, confirmado: l.confirmado === 1 });
const COL_PRECO = "id,padrao,familia,entrada_por_mtok,saida_por_mtok,cache_escrita_por_mtok,cache_leitura_por_mtok,origem,confirmado,valido_desde,fonte,coletado_em";
const COL_FONTE = "id,cli,conta_id,pane_id,mission_id,workspace_id,base,relativo,offset,tamanho,mtime_ms,inode,estado,erro_codigo,linhas_puladas,ultima_leitura_em";
const SQL_INSERT_USO = "INSERT OR IGNORE INTO uso_registro (id,fonte_id,chave,ts,modelo,tokens_entrada,tokens_cache_escrita,tokens_cache_leitura,tokens_saida,usd,usd_origem,preco_id,aproximado,pane_id,mission_id,workspace_id,conta_id,trabalho_id,task_id,atribuicao) VALUES ";
const LINHA_USO = "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
/** 40 linhas × 20 colunas = 800 parâmetros (abaixo do limite do SQLite). */
const LINHAS_POR_INSERT = 40;
const COL_AGR = "atribuicao,modelo,registros,registros_sem_preco,registros_aproximados,tokens_entrada,tokens_cache_escrita,tokens_cache_leitura,tokens_saida,usd_conhecido";

/** `dia` UTC (`YYYY-MM-DD`) de um instante ISO. */
export const diaDe = (iso: string): string => iso.slice(0, 10);

function precoValido(p: PedidoGravarPreco): void {
  const ok = (x: unknown): boolean => typeof x === "number" && Number.isFinite(x) && x >= 0;
  if (typeof p.padrao !== "string" || p.padrao.trim() === "" || p.padrao.length > 120) throw new ValorInvalidoErro("padrao", p.padrao);
  if (!ok(p.entrada_por_mtok)) throw new ValorInvalidoErro("entrada_por_mtok", p.entrada_por_mtok);
  if (!ok(p.saida_por_mtok)) throw new ValorInvalidoErro("saida_por_mtok", p.saida_por_mtok);
  for (const c of ["cache_escrita_por_mtok", "cache_leitura_por_mtok"] as const) {
    const v = p[c];
    if (v !== undefined && v !== null && !ok(v)) throw new ValorInvalidoErro(c, v);
  }
}

export function criarRepoCusto(banco: Banco) {
  const insertsPorTamanho = new Map<number, Declaracao>();
  /** Instrução preparada de INSERT de `n` linhas (cache por tamanho: preparar 800 parâmetros a cada lote custaria mais que inserir). */
  const declaracaoInsert = (n: number): Declaracao => {
    let d = insertsPorTamanho.get(n);
    if (d === undefined) {
      d = banco.preparar(`${SQL_INSERT_USO}${Array(n).fill(LINHA_USO).join(",")}`);
      insertsPorTamanho.set(n, d);
    }
    return d;
  };
  // ---------------------------------------------------------------- preços
  const precos = {
    listar(): Preco[] {
      return banco.consultar<LinhaPreco>(`SELECT ${COL_PRECO} FROM preco_modelo ORDER BY padrao, valido_desde DESC, origem`).map(mapearPreco);
    },
    obter(id: string): Preco | undefined {
      const l = banco.consultarUm<LinhaPreco>(`SELECT ${COL_PRECO} FROM preco_modelo WHERE id = ?`, [id]);
      return l ? mapearPreco(l) : undefined;
    },
    /** Insere as entradas embutidas que faltam (idempotente; nunca sobrescreve uma confirmada pelo dono). Sem rede. */
    semearEmbutidos(ts: string = agora()): number {
      let novas = 0;
      banco.transacao((tx) => {
        const ins = tx.preparar(
          `INSERT OR IGNORE INTO preco_modelo (id,padrao,familia,entrada_por_mtok,saida_por_mtok,cache_escrita_por_mtok,cache_leitura_por_mtok,origem,confirmado,valido_desde,fonte,coletado_em,criado_em,atualizado_em)
           VALUES (?,?,?,?,?,?,?,'embutido',0,?,?,?,?,?)`,
        );
        for (const p of PRECOS_PADRAO) {
          novas += ins.executar([`pr_emb_${p.padrao}`, p.padrao, p.familia, p.entrada_por_mtok, p.saida_por_mtok, p.cache_escrita_por_mtok, p.cache_leitura_por_mtok, PRECOS_VALIDOS_DESDE, PRECOS_FONTE, PRECOS_COLETADO_EM, ts, ts]).alteracoes;
        }
      });
      return novas;
    },
    /** Grava/atualiza o preço do USUÁRIO (vence o embutido). A primeira entrada de um padrão vale desde o início; edições viram nova versão (`valido_desde = agora`). */
    gravarUsuario(p: PedidoGravarPreco, ts: string = agora()): Preco {
      precoValido(p);
      const padrao = p.padrao.trim();
      return banco.transacao((tx) => {
        const existe = tx.consultarUm<{ x: number }>("SELECT 1 AS x FROM preco_modelo WHERE origem = 'usuario' AND padrao = ?", [padrao]);
        const desde = existe ? ts : PRECOS_VALIDOS_DESDE;
        const id = novoId("evento", "pr");
        tx.executar(
          `INSERT INTO preco_modelo (id,padrao,familia,entrada_por_mtok,saida_por_mtok,cache_escrita_por_mtok,cache_leitura_por_mtok,origem,confirmado,valido_desde,fonte,coletado_em,criado_em,atualizado_em)
           VALUES (?,?,?,?,?,?,?,'usuario',1,?,'informado pelo usuário',?,?,?)
           ON CONFLICT(origem, padrao, valido_desde) DO UPDATE SET familia=excluded.familia, entrada_por_mtok=excluded.entrada_por_mtok, saida_por_mtok=excluded.saida_por_mtok,
             cache_escrita_por_mtok=excluded.cache_escrita_por_mtok, cache_leitura_por_mtok=excluded.cache_leitura_por_mtok, atualizado_em=excluded.atualizado_em`,
          [id, padrao, p.familia ?? null, p.entrada_por_mtok, p.saida_por_mtok, p.cache_escrita_por_mtok ?? null, p.cache_leitura_por_mtok ?? null, desde, ts, ts, ts],
        );
        return mapearPreco(tx.consultarUm<LinhaPreco>(`SELECT ${COL_PRECO} FROM preco_modelo WHERE origem='usuario' AND padrao=? AND valido_desde=?`, [padrao, desde]) as LinhaPreco);
      });
    },
    /** Só apaga entrada do USUÁRIO (embutido e OpenRouter não se apagam por aqui). */
    apagarUsuario(id: string): boolean {
      return banco.executar("DELETE FROM preco_modelo WHERE id = ? AND origem = 'usuario'", [id]).alteracoes > 0;
    },
    /** Reflete `openrouter_modelo.preco_*` (Fase 9) em entradas `openrouter/confirmado`, exatas por id; remove as de modelos que perderam o preço. Sem rede. */
    sincronizarOpenRouter(ts: string = agora()): { gravados: number; removidos: number } {
      return banco.transacao((tx) => {
        const modelos = tx.consultar<{ id: string; e: number; s: number }>("SELECT id, preco_entrada_por_mtok AS e, preco_saida_por_mtok AS s FROM openrouter_modelo WHERE preco_entrada_por_mtok IS NOT NULL AND preco_saida_por_mtok IS NOT NULL");
        const ids = new Set(modelos.map((m) => m.id));
        let gravados = 0;
        const up = tx.preparar(
          `INSERT INTO preco_modelo (id,padrao,familia,entrada_por_mtok,saida_por_mtok,cache_escrita_por_mtok,cache_leitura_por_mtok,origem,confirmado,valido_desde,fonte,coletado_em,criado_em,atualizado_em)
           VALUES (?,?,NULL,?,?,NULL,NULL,'openrouter',1,?,'lista de modelos do OpenRouter',?,?,?)
           ON CONFLICT(origem, padrao, valido_desde) DO UPDATE SET entrada_por_mtok=excluded.entrada_por_mtok, saida_por_mtok=excluded.saida_por_mtok, coletado_em=excluded.coletado_em, atualizado_em=excluded.atualizado_em`,
        );
        for (const m of modelos) {
          const atual = tx.consultarUm<{ e: number; s: number }>("SELECT entrada_por_mtok AS e, saida_por_mtok AS s FROM preco_modelo WHERE origem='openrouter' AND padrao=? AND valido_desde=?", [m.id, PRECOS_VALIDOS_DESDE]);
          if (atual && atual.e === m.e && atual.s === m.s) continue;
          up.executar([`pr_or_${m.id}`, m.id, m.e, m.s, PRECOS_VALIDOS_DESDE, ts, ts, ts]);
          gravados++;
        }
        let removidos = 0;
        for (const l of tx.consultar<{ id: string; padrao: string }>("SELECT id, padrao FROM preco_modelo WHERE origem = 'openrouter'")) {
          if (!ids.has(l.padrao)) removidos += tx.executar("DELETE FROM preco_modelo WHERE id = ?", [l.id]).alteracoes;
        }
        return { gravados, removidos };
      });
    },
  };

  // ---------------------------------------------------------------- fontes de uso
  const fontes = {
    obter(id: string): FonteUso | undefined {
      return banco.consultarUm<FonteUso>(`SELECT ${COL_FONTE} FROM uso_fonte WHERE id = ?`, [id]);
    },
    porPane(paneId: string, base?: FonteUso["base"]): FonteUso[] {
      return base === undefined
        ? banco.consultar<FonteUso>(`SELECT ${COL_FONTE} FROM uso_fonte WHERE pane_id = ? ORDER BY criado_em, id`, [paneId])
        : banco.consultar<FonteUso>(`SELECT ${COL_FONTE} FROM uso_fonte WHERE pane_id = ? AND base = ? ORDER BY criado_em, id`, [paneId, base]);
    },
    /** Cria (ou devolve a existente, pela unicidade `base+conta+relativo` ou `pane+base` quando `relativo` é vazio). */
    garantir(n: NovaFonteUso, ts: string = agora()): FonteUso {
      const relativo = n.relativo ?? "";
      const existente =
        relativo !== ""
          ? banco.consultarUm<FonteUso>(`SELECT ${COL_FONTE} FROM uso_fonte WHERE base = ? AND COALESCE(conta_id,'') = ? AND relativo = ?`, [n.base, n.conta_id ?? "", relativo])
          : n.pane_id
            ? banco.consultarUm<FonteUso>(`SELECT ${COL_FONTE} FROM uso_fonte WHERE pane_id = ? AND base = ? AND relativo = ''`, [n.pane_id, n.base])
            : undefined;
      if (existente) return existente;
      const id = novoId("evento", "uf");
      banco.executar(
        `INSERT INTO uso_fonte (id,cli,conta_id,pane_id,mission_id,workspace_id,base,relativo,offset,tamanho,estado,linhas_puladas,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,0,0,?,0,?,?)`,
        [id, n.cli, n.conta_id ?? null, n.pane_id ?? null, n.mission_id ?? null, n.workspace_id ?? null, n.base, relativo, n.estado ?? "lendo", ts, ts],
      );
      return fontes.obter(id) as FonteUso;
    },
    atualizar(id: string, patch: Partial<Pick<FonteUso, "offset" | "tamanho" | "mtime_ms" | "inode" | "estado" | "erro_codigo" | "linhas_puladas" | "ultima_leitura_em" | "mission_id">>, ts: string = agora()): void {
      const sets: string[] = [];
      const params: (string | number | null)[] = [];
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        sets.push(`${k} = ?`);
        params.push(v as string | number | null);
      }
      if (sets.length === 0) return;
      sets.push("atualizado_em = ?");
      params.push(ts, id);
      banco.executar(`UPDATE uso_fonte SET ${sets.join(", ")} WHERE id = ?`, params as Parametros);
    },
    listar(workspaceId?: string | null): FonteUso[] {
      return workspaceId
        ? banco.consultar<FonteUso>(`SELECT ${COL_FONTE} FROM uso_fonte WHERE workspace_id = ? ORDER BY criado_em, id`, [workspaceId])
        : banco.consultar<FonteUso>(`SELECT ${COL_FONTE} FROM uso_fonte ORDER BY criado_em, id`);
    },
    /** CLIs sem leitor (`sem_fonte`) no escopo: vira `sem_fonte:<cli>` em `fontes_ausentes`. */
    ausentes(escopo: { pane_id?: string; mission_id?: string; workspace_id?: string }): string[] {
      const col = escopo.pane_id ? "pane_id" : escopo.mission_id ? "mission_id" : "workspace_id";
      const val = escopo.pane_id ?? escopo.mission_id ?? escopo.workspace_id;
      if (!val) return [];
      return banco.consultar<{ cli: string }>(`SELECT DISTINCT cli FROM uso_fonte WHERE estado = 'sem_fonte' AND ${col} = ? ORDER BY cli`, [val]).map((l) => `sem_fonte:${l.cli}`);
    },
  };

  // ---------------------------------------------------------------- registros brutos
  const registros = {
    /**
     * Insere em lote, idempotente por `(fonte_id, chave)`. Devolve, por posição, se o registro era novo (chave repetida dentro do próprio lote: só a primeira conta).
     * Duas consultas por lote (existentes + INSERT de várias linhas) em vez de uma instrução por linha: é o que mantém o lote de 500 dentro do orçamento (P-113).
     */
    inserirLote(lote: readonly NovoRegistroUso[]): boolean[] {
      const flags: boolean[] = lote.map(() => false);
      if (lote.length === 0) return flags;
      // um ULID por LOTE + contador: ids continuam crescentes (paginação por `id >`) sem gerar um ULID por linha
      const baseId = novoId("evento", "ur");
      const porFonte = new Map<string, number[]>();
      lote.forEach((r, i) => (porFonte.get(r.fonte_id) ?? porFonte.set(r.fonte_id, []).get(r.fonte_id))?.push(i));
      for (const [fonteId, idxs] of porFonte) {
        const vistos = new Set<string>();
        for (let ini = 0; ini < idxs.length; ini += 400) {
          const fatia = idxs.slice(ini, ini + 400);
          const chaves = fatia.map((i) => (lote[i] as NovoRegistroUso).chave);
          const existentes = new Set(banco.consultar<{ chave: string }>(`SELECT chave FROM uso_registro WHERE fonte_id = ? AND chave IN (${chaves.map(() => "?").join(",")})`, [fonteId, ...chaves]).map((l) => l.chave));
          const novos = fatia.filter((i) => {
            const c = (lote[i] as NovoRegistroUso).chave;
            if (existentes.has(c) || vistos.has(c)) return false;
            vistos.add(c);
            return true;
          });
          for (let k = 0; k < novos.length; k += LINHAS_POR_INSERT) {
            const grupo = novos.slice(k, k + LINHAS_POR_INSERT);
            const params: Valor[] = [];
            for (const i of grupo) {
              const r = lote[i] as NovoRegistroUso;
              params.push(`${baseId}.${i.toString(36).padStart(4, "0")}`, r.fonte_id, r.chave, r.ts, r.modelo, r.tokens_entrada, r.tokens_cache_escrita, r.tokens_cache_leitura, r.tokens_saida, r.usd, r.usd_origem, r.preco_id, r.aproximado, r.pane_id, r.mission_id, r.workspace_id, r.conta_id, r.trabalho_id, r.task_id, r.atribuicao);
            }
            const res = declaracaoInsert(grupo.length).executar(params);
            if (res.alteracoes === grupo.length) for (const i of grupo) flags[i] = true;
            else {
              // INSERT OR IGNORE descartou alguma (corrida improvável): confere linha a linha para não contar errado
              for (const i of grupo) flags[i] = banco.consultarUm("SELECT 1 AS x FROM uso_registro WHERE id = ?", [`${baseId}.${i.toString(36).padStart(4, "0")}`]) !== undefined;
            }
          }
        }
      }
      return flags;
    },
    doPaneDesde(paneId: string, desde: string): RegistroUso[] {
      return banco.consultar<RegistroUso>("SELECT * FROM uso_registro WHERE pane_id = ? AND ts >= ? ORDER BY ts, id", [paneId, desde]);
    },
    desde(ts: string, limite = 5000, depoisDeId = ""): RegistroUso[] {
      return banco.consultar<RegistroUso>("SELECT * FROM uso_registro WHERE ts >= ? AND id > ? ORDER BY id LIMIT ?", [ts, depoisDeId, limite]);
    },
    atribuir(id: string, a: { atribuicao: Atribuicao; trabalho_id: string | null; task_id: string | null }): void {
      banco.executar("UPDATE uso_registro SET atribuicao = ?, trabalho_id = ?, task_id = ? WHERE id = ?", [a.atribuicao, a.trabalho_id, a.task_id, id]);
    },
    atualizarUsd(id: string, u: { usd: number | null; usd_origem: OrigemUsd; preco_id: string | null; aproximado: number }): void {
      banco.executar("UPDATE uso_registro SET usd = ?, usd_origem = ?, preco_id = ?, aproximado = ? WHERE id = ?", [u.usd, u.usd_origem, u.preco_id, u.aproximado, id]);
    },
    contar(): number {
      return Number(banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM uso_registro")?.n ?? 0);
    },
    apagarAntes(ts: string): number {
      return banco.executar("DELETE FROM uso_registro WHERE ts < ?", [ts]).alteracoes;
    },
    apagarDoEscopo(escopo: { workspace_id?: string | null }): number {
      return escopo.workspace_id ? banco.executar("DELETE FROM uso_registro WHERE workspace_id = ?", [escopo.workspace_id]).alteracoes : banco.executar("DELETE FROM uso_registro").alteracoes;
    },
    /** Uso de UM card agrupado por modelo e origem do valor (bruto indexado por `ix_uso_card`; só dentro da retenção). */
    porCard(workspaceId: string, trabalhoId: string, taskId: string): Array<{ modelo: string | null; usd_origem: OrigemUsd; aproximado: number; registros: number; sem_preco: number; entrada: number; cache_escrita: number; cache_leitura: number; saida: number; usd: number }> {
      return banco.consultar(
        `SELECT modelo, usd_origem, MAX(aproximado) AS aproximado, COUNT(*) AS registros, SUM(CASE WHEN usd IS NULL THEN 1 ELSE 0 END) AS sem_preco, SUM(tokens_entrada) AS entrada,
                SUM(tokens_cache_escrita) AS cache_escrita, SUM(tokens_cache_leitura) AS cache_leitura, SUM(tokens_saida) AS saida, COALESCE(SUM(usd),0) AS usd
         FROM uso_registro WHERE workspace_id = ? AND trabalho_id = ? AND task_id = ? AND atribuicao = 'card' GROUP BY modelo, usd_origem ORDER BY modelo, usd_origem`,
        [workspaceId, trabalhoId, taskId],
      ) as never;
    },
    modelosSemPreco(): string[] {
      return banco.consultar<{ modelo: string }>("SELECT DISTINCT modelo FROM uso_registro WHERE usd IS NULL AND modelo IS NOT NULL ORDER BY modelo").map((l) => l.modelo);
    },
  };

  // ---------------------------------------------------------------- janelas de task
  const janelas = {
    /** Troca TODAS as janelas de uma origem para o (workspace, trabalho) — o cache é sempre reconstruído do banco/rastro. */
    substituir(workspaceId: string, trabalhoId: string, origem: "banco" | "rastro", lista: ReadonlyArray<JanelaTask & { pane_id?: string | null; cwd_rel?: string | null }>): void {
      banco.transacao((tx) => {
        tx.executar("DELETE FROM janela_task WHERE workspace_id = ? AND trabalho_id = ? AND origem = ?", [workspaceId, trabalhoId, origem]);
        const ins = tx.preparar("INSERT OR REPLACE INTO janela_task (workspace_id,trabalho_id,task_id,origem,pane_id,cwd_rel,inicio,fim) VALUES (?,?,?,?,?,?,?,?)");
        for (const j of lista) ins.executar([workspaceId, trabalhoId, j.task_id, origem, j.pane_id ?? null, j.cwd_rel ?? null, j.inicio, j.fim]);
      });
    },
    /** Janelas que valem para um Pane: as do banco ligadas a ele e as do rastro do trabalho da Missão do Pane (rastro não sabe o Pane: `pane_id` NULL). */
    doPane(paneId: string, trabalho?: { workspace_id: string; trabalho_id: string } | null): JanelaTask[] {
      if (!trabalho) return banco.consultar<JanelaTask>("SELECT trabalho_id, task_id, inicio, fim FROM janela_task WHERE pane_id = ? ORDER BY inicio", [paneId]);
      return banco.consultar<JanelaTask>(
        "SELECT trabalho_id, task_id, inicio, fim FROM janela_task WHERE pane_id = ? OR (pane_id IS NULL AND origem = 'rastro' AND workspace_id = ? AND trabalho_id = ?) ORDER BY inicio",
        [paneId, trabalho.workspace_id, trabalho.trabalho_id],
      );
    },
    doCard(workspaceId: string, trabalhoId: string, taskId: string): Array<JanelaTask & { origem: "banco" | "rastro"; pane_id: string | null }> {
      return banco.consultar("SELECT trabalho_id, task_id, inicio, fim, origem, pane_id FROM janela_task WHERE workspace_id = ? AND trabalho_id = ? AND task_id = ? ORDER BY inicio", [workspaceId, trabalhoId, taskId]) as Array<JanelaTask & { origem: "banco" | "rastro"; pane_id: string | null }>;
    },
  };

  // ---------------------------------------------------------------- agregado materializado
  const agregado = {
    /** Soma deltas (idempotência é do chamador: só aplica o que o registro novo trouxe). */
    aplicar(deltas: readonly DeltaAgregado[]): void {
      const up = banco.preparar(
        `INSERT INTO custo_agregado (escopo,chave,dia,modelo,atribuicao,registros,registros_sem_preco,registros_aproximados,tokens_entrada,tokens_cache_escrita,tokens_cache_leitura,tokens_saida,usd_conhecido)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(escopo,chave,dia,modelo,atribuicao) DO UPDATE SET registros=registros+excluded.registros, registros_sem_preco=registros_sem_preco+excluded.registros_sem_preco,
           registros_aproximados=registros_aproximados+excluded.registros_aproximados, tokens_entrada=tokens_entrada+excluded.tokens_entrada,
           tokens_cache_escrita=tokens_cache_escrita+excluded.tokens_cache_escrita, tokens_cache_leitura=tokens_cache_leitura+excluded.tokens_cache_leitura,
           tokens_saida=tokens_saida+excluded.tokens_saida, usd_conhecido=round(usd_conhecido+excluded.usd_conhecido, 9)`,
      );
      for (const d of deltas) up.executar([d.escopo, d.chave, d.dia, d.modelo, d.atribuicao, d.registros, d.registros_sem_preco, d.registros_aproximados, d.tokens_entrada, d.tokens_cache_escrita, d.tokens_cache_leitura, d.tokens_saida, d.usd_conhecido]);
    },
    /** Linhas (somadas sobre os dias) de um escopo/chave por (atribuição, modelo). */
    consultar(escopo: EscopoAgregado, chave: string, periodo?: { desde?: string; ate?: string }): LinhaAgregada[] {
      const cond = ["escopo = ?", "chave = ?"];
      const params: (string | number)[] = [escopo, chave];
      if (periodo?.desde) (cond.push("dia >= ?"), params.push(periodo.desde));
      if (periodo?.ate) (cond.push("dia <= ?"), params.push(periodo.ate));
      return banco.consultar<LinhaAgregada>(
        `SELECT atribuicao, modelo, SUM(registros) AS registros, SUM(registros_sem_preco) AS registros_sem_preco, SUM(registros_aproximados) AS registros_aproximados,
                SUM(tokens_entrada) AS tokens_entrada, SUM(tokens_cache_escrita) AS tokens_cache_escrita, SUM(tokens_cache_leitura) AS tokens_cache_leitura,
                SUM(tokens_saida) AS tokens_saida, SUM(usd_conhecido) AS usd_conhecido
         FROM custo_agregado WHERE ${cond.join(" AND ")} GROUP BY atribuicao, modelo`,
        params as Parametros,
      );
    },
    /** Agrupa um escopo inteiro por `chave` (ou por `dia`/`modelo`) no período, para o relatório. `prefixoChave` filtra por `LIKE 'prefixo%'`. */
    agrupar(escopo: EscopoAgregado, por: "chave" | "dia" | "modelo", periodo: { desde: string; ate: string }, filtro?: { prefixoChave?: string; sufixoChave?: string; chave?: string; modelo?: string }): Array<LinhaAgregada & { grupo: string }> {
      const cond = ["escopo = ?", "dia >= ?", "dia <= ?"];
      const params: (string | number)[] = [escopo, periodo.desde, periodo.ate];
      if (filtro?.chave) (cond.push("chave = ?"), params.push(filtro.chave));
      if (filtro?.prefixoChave) (cond.push("chave LIKE ? ESCAPE '\\'"), params.push(`${filtro.prefixoChave.replace(/[\\%_]/g, "\\$&")}%`));
      if (filtro?.sufixoChave) (cond.push("chave LIKE ? ESCAPE '\\'"), params.push(`%${filtro.sufixoChave.replace(/[\\%_]/g, "\\$&")}`));
      if (filtro?.modelo !== undefined) (cond.push("modelo = ?"), params.push(filtro.modelo));
      return banco.consultar<LinhaAgregada & { grupo: string }>(
        `SELECT ${por} AS grupo, atribuicao, modelo, SUM(registros) AS registros, SUM(registros_sem_preco) AS registros_sem_preco, SUM(registros_aproximados) AS registros_aproximados,
                SUM(tokens_entrada) AS tokens_entrada, SUM(tokens_cache_escrita) AS tokens_cache_escrita, SUM(tokens_cache_leitura) AS tokens_cache_leitura,
                SUM(tokens_saida) AS tokens_saida, SUM(usd_conhecido) AS usd_conhecido
         FROM custo_agregado WHERE ${cond.join(" AND ")} GROUP BY ${por}, atribuicao, modelo`,
        params as Parametros,
      );
    },
    /** TODOS os cards de um workspace de uma vez (uma consulta; alimenta o board sem N consultas). Chave: `<ws>|<trabalho>|<task>`. */
    cardsDoWorkspace(workspaceId: string): Map<string, LinhaAgregada[]> {
      const linhas = banco.consultar<LinhaAgregada & { chave: string }>(
        `SELECT chave, atribuicao, modelo, SUM(registros) AS registros, SUM(registros_sem_preco) AS registros_sem_preco, SUM(registros_aproximados) AS registros_aproximados,
                SUM(tokens_entrada) AS tokens_entrada, SUM(tokens_cache_escrita) AS tokens_cache_escrita, SUM(tokens_cache_leitura) AS tokens_cache_leitura,
                SUM(tokens_saida) AS tokens_saida, SUM(usd_conhecido) AS usd_conhecido
         FROM custo_agregado WHERE escopo = 'card' AND chave LIKE ? ESCAPE '\\' GROUP BY chave, atribuicao, modelo`,
        [`${workspaceId.replace(/[\\%_]/g, "\\$&")}|%`],
      );
      const mapa = new Map<string, LinhaAgregada[]>();
      for (const l of linhas) (mapa.get(l.chave) ?? mapa.set(l.chave, []).get(l.chave))?.push(l);
      return mapa;
    },
    /** Agrupa direto dos brutos (fallback para combinações que o agregado não responde; só dentro da retenção). */
    agruparBruto(por: "task_id" | "mission_id" | "trabalho_id" | "workspace_id" | "conta_id" | "pane_id" | "modelo" | "dia", periodo: { desde: string; ate: string }, filtros: { workspace_id?: string; mission_id?: string; trabalho_id?: string; conta_id?: string; modelo?: string }): Array<LinhaAgregada & { grupo: string }> {
      const cond = ["ts >= ?", "ts < ?"];
      const params: (string | number)[] = [`${periodo.desde}T00:00:00.000Z`, `${diaSeguinte(periodo.ate)}T00:00:00.000Z`];
      for (const k of ["workspace_id", "mission_id", "trabalho_id", "conta_id"] as const) {
        const v = filtros[k];
        if (v) (cond.push(`${k} = ?`), params.push(v));
      }
      if (filtros.modelo !== undefined) (cond.push("COALESCE(modelo,'') = ?"), params.push(filtros.modelo));
      const expr = por === "dia" ? "substr(ts,1,10)" : por === "modelo" ? "COALESCE(modelo,'')" : por;
      return banco.consultar<LinhaAgregada & { grupo: string }>(
        `SELECT COALESCE(${expr},'') AS grupo, atribuicao, COALESCE(modelo,'') AS modelo, COUNT(*) AS registros, SUM(CASE WHEN usd IS NULL THEN 1 ELSE 0 END) AS registros_sem_preco,
                SUM(aproximado) AS registros_aproximados, SUM(tokens_entrada) AS tokens_entrada, SUM(tokens_cache_escrita) AS tokens_cache_escrita,
                SUM(tokens_cache_leitura) AS tokens_cache_leitura, SUM(tokens_saida) AS tokens_saida, COALESCE(SUM(usd),0) AS usd_conhecido
         FROM uso_registro WHERE ${cond.join(" AND ")} GROUP BY grupo, atribuicao, COALESCE(modelo,'')`,
        params as Parametros,
      );
    },
    /** Apaga o agregado do período recente (`dia >= desde`) para reconstruí-lo dos brutos; os dias mais antigos que a retenção dos brutos ficam. */
    limparDesde(desdeDia: string): number {
      return banco.executar("DELETE FROM custo_agregado WHERE dia >= ?", [desdeDia]).alteracoes;
    },
    contar(): number {
      return Number(banco.consultarUm<{ n: number }>("SELECT COUNT(*) AS n FROM custo_agregado")?.n ?? 0);
    },
  };

  // ---------------------------------------------------------------- teto e alertas
  const tetos = {
    obter(missionId: string): TetoMissao | undefined {
      return banco.consultarUm<TetoMissao>("SELECT mission_id, teto_usd, alertado_em FROM custo_teto WHERE mission_id = ?", [missionId]);
    },
    definir(missionId: string, tetoUsd: number | null): void {
      if (tetoUsd === null) {
        banco.executar("DELETE FROM custo_teto WHERE mission_id = ?", [missionId]);
        banco.executar("DELETE FROM custo_alerta WHERE alvo = ? AND tipo IN ('teto_missao','aviso_teto_missao')", [missionId]);
        return;
      }
      if (!(typeof tetoUsd === "number" && Number.isFinite(tetoUsd) && tetoUsd > 0)) throw new ValorInvalidoErro("teto_usd", tetoUsd);
      banco.transacao((tx) => {
        const antes = tx.consultarUm<{ teto_usd: number }>("SELECT teto_usd FROM custo_teto WHERE mission_id = ?", [missionId]);
        tx.executar("INSERT INTO custo_teto (mission_id, teto_usd, alertado_em) VALUES (?,?,NULL) ON CONFLICT(mission_id) DO UPDATE SET teto_usd = excluded.teto_usd", [missionId, tetoUsd]);
        // teto novo/alterado reabilita o aviso (uma vez por teto)
        if (!antes || antes.teto_usd !== tetoUsd) {
          tx.executar("UPDATE custo_teto SET alertado_em = NULL WHERE mission_id = ?", [missionId]);
          tx.executar("DELETE FROM custo_alerta WHERE alvo = ? AND tipo IN ('teto_missao','aviso_teto_missao')", [missionId]);
        }
      });
    },
    marcarAlertado(missionId: string, ts: string): void {
      banco.executar("UPDATE custo_teto SET alertado_em = ? WHERE mission_id = ?", [ts, missionId]);
    },
    listar(): TetoMissao[] {
      return banco.consultar<TetoMissao>("SELECT mission_id, teto_usd, alertado_em FROM custo_teto ORDER BY mission_id");
    },
  };
  const alertas = {
    /** `true` só na PRIMEIRA vez para (tipo, alvo): é o que garante "avisa uma vez" mesmo após reiniciar o app. */
    registrarUmaVez(tipo: string, alvo: string, ts: string = agora()): boolean {
      return banco.executar("INSERT OR IGNORE INTO custo_alerta (tipo, alvo, criado_em) VALUES (?,?,?)", [tipo, alvo, ts]).alteracoes > 0;
    },
    limpar(tipo: string, alvo: string): void {
      banco.executar("DELETE FROM custo_alerta WHERE tipo = ? AND alvo = ?", [tipo, alvo]);
    },
    listar(): Array<{ tipo: string; alvo: string; criado_em: string }> {
      return banco.consultar("SELECT tipo, alvo, criado_em FROM custo_alerta ORDER BY criado_em, tipo, alvo") as Array<{ tipo: string; alvo: string; criado_em: string }>;
    },
  };

  return { precos, fontes, registros, janelas, agregado, tetos, alertas };
}
export type RepoCusto = ReturnType<typeof criarRepoCusto>;

function diaSeguinte(dia: string): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}
