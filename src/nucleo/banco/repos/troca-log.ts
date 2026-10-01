import type { Banco, Parametros } from "../banco";
import { agora } from "../tempo";
import { NaoEncontradoErro } from "../../dominio";
import { ADIADA_POR, MODOS_TROCA, MOTIVOS_TROCA, STATUS_TROCA, TIPOS_TROCA, type Troca } from "../../../compartilhado/harness";
import { exigirEnum, limiteDe, novoId, textoObrigatorio } from "./comum";
import { numeroEm } from "./json";

/** Troca + os campos de ligação que o contrato público (`Troca`) não expõe. */
export interface RegistroTroca extends Troca {
  workspace_id: string;
  mission_id: string | null;
  task_ref: string | null;
  pane_antigo_id: string | null;
  pane_novo_id: string | null;
  faixa: string | null;
  decisao_id: string | null;
}
export interface NovaTroca {
  workspace_id: string;
  mission_id?: string | null;
  task_ref?: string | null;
  pane_antigo_id?: string | null;
  pane_novo_id?: string | null;
  de: Troca["de"];
  para: Troca["para"];
  faixa?: string | null;
  motivo: Troca["motivo"];
  modo: Troca["modo"];
  tipo_troca: Troca["tipo_troca"];
  consumo_origem_pct?: number | null;
  consumo_destino_pct?: number | null;
  status: Troca["status"];
  adiada_por?: string | null;
  decisao_id?: string | null;
  recibo: string;
}
interface Linha {
  id: string;
  criado_em: string;
  workspace_id: string;
  mission_id: string | null;
  task_ref: string | null;
  pane_antigo_id: string | null;
  pane_novo_id: string | null;
  de_conta_id: string | null;
  para_conta_id: string | null;
  de_provedor: string | null;
  para_provedor: string | null;
  de_modelo: string | null;
  para_modelo: string | null;
  faixa: string | null;
  motivo: Troca["motivo"];
  modo: Troca["modo"];
  tipo_troca: Troca["tipo_troca"];
  consumo_origem_pct: number | null;
  consumo_destino_pct: number | null;
  status: Troca["status"];
  adiada_por: string | null;
  decisao_id: string | null;
  recibo: string;
}
const mapear = (l: Linha): RegistroTroca => ({
  id: l.id,
  criado_em: l.criado_em,
  status: l.status,
  motivo: l.motivo,
  modo: l.modo,
  tipo_troca: l.tipo_troca,
  de: { conta_id: l.de_conta_id, provedor: l.de_provedor ?? "", modelo: l.de_modelo },
  para: { conta_id: l.para_conta_id, provedor: l.para_provedor ?? "", modelo: l.para_modelo },
  consumo_origem_pct: l.consumo_origem_pct,
  consumo_destino_pct: l.consumo_destino_pct,
  adiada_por: l.adiada_por,
  recibo: l.recibo,
  workspace_id: l.workspace_id,
  mission_id: l.mission_id,
  task_ref: l.task_ref,
  pane_antigo_id: l.pane_antigo_id,
  pane_novo_id: l.pane_novo_id,
  faixa: l.faixa,
  decisao_id: l.decisao_id,
});

export function criarRepoTrocaLog(banco: Banco) {
  const obter = (id: string): RegistroTroca | undefined => {
    const l = banco.consultarUm<Linha>("SELECT * FROM troca_log WHERE id = ?", [id]);
    return l ? mapear(l) : undefined;
  };
  const exigir = (id: string): RegistroTroca => {
    const t = obter(id);
    if (!t) throw new NaoEncontradoErro("Troca", id);
    return t;
  };
  return {
    obter,
    exigir,
    inserir(d: NovaTroca, instante: string = agora()): RegistroTroca {
      textoObrigatorio("workspace_id", d.workspace_id);
      textoObrigatorio("recibo", d.recibo);
      exigirEnum("motivo", d.motivo, MOTIVOS_TROCA);
      exigirEnum("modo", d.modo, MODOS_TROCA);
      exigirEnum("tipo_troca", d.tipo_troca, TIPOS_TROCA);
      exigirEnum("status", d.status, STATUS_TROCA);
      if (d.adiada_por != null) exigirEnum("adiada_por", d.adiada_por, ADIADA_POR);
      if (d.consumo_origem_pct != null) numeroEm("consumo_origem_pct", d.consumo_origem_pct, 0, 100);
      if (d.consumo_destino_pct != null) numeroEm("consumo_destino_pct", d.consumo_destino_pct, 0, 100);
      const id = novoId("conta", "trc");
      banco.executar(
        `INSERT INTO troca_log (id,criado_em,workspace_id,mission_id,task_ref,pane_antigo_id,pane_novo_id,de_conta_id,para_conta_id,de_provedor,para_provedor,de_modelo,para_modelo,faixa,motivo,modo,tipo_troca,consumo_origem_pct,consumo_destino_pct,status,adiada_por,decisao_id,recibo)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id, instante, d.workspace_id, d.mission_id ?? null, d.task_ref ?? null, d.pane_antigo_id ?? null, d.pane_novo_id ?? null, d.de.conta_id, d.para.conta_id,
          d.de.provedor, d.para.provedor, d.de.modelo, d.para.modelo, d.faixa ?? null, d.motivo, d.modo, d.tipo_troca, d.consumo_origem_pct ?? null,
          d.consumo_destino_pct ?? null, d.status, d.adiada_por ?? null, d.decisao_id ?? null, d.recibo,
        ],
      );
      return exigir(id);
    },
    /** Muda o status (sugerida → feita/ignorada/adiada/falhou). `adiada_por` só vale com status `adiada`. */
    atualizarStatus(id: string, status: Troca["status"], extra: { adiada_por?: string | null; pane_novo_id?: string | null; recibo?: string } = {}): RegistroTroca {
      exigir(id);
      exigirEnum("status", status, STATUS_TROCA);
      if (extra.adiada_por != null) exigirEnum("adiada_por", extra.adiada_por, ADIADA_POR);
      banco.executar(
        "UPDATE troca_log SET status = ?, adiada_por = ?, pane_novo_id = COALESCE(?, pane_novo_id), recibo = COALESCE(?, recibo) WHERE id = ?",
        [status, status === "adiada" ? (extra.adiada_por ?? null) : null, extra.pane_novo_id ?? null, extra.recibo ?? null, id],
      );
      return exigir(id);
    },
    /** Mais recentes primeiro (ULID), paginado por cursor. */
    listar(op: { desde?: string; cursor?: string; limite?: number; workspace_id?: string } = {}): { itens: RegistroTroca[]; proximo: string | null } {
      const limite = limiteDe(op.limite === undefined ? undefined : { limite: op.limite });
      const cond: string[] = [];
      const params: (string | number)[] = [];
      if (op.desde !== undefined) {
        cond.push("criado_em >= ?");
        params.push(op.desde);
      }
      if (op.workspace_id !== undefined) {
        cond.push("workspace_id = ?");
        params.push(op.workspace_id);
      }
      if (op.cursor !== undefined) {
        cond.push("id < ?");
        params.push(op.cursor);
      }
      params.push(limite + 1);
      const onde = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
      const linhas = banco.consultar<Linha>(`SELECT * FROM troca_log ${onde} ORDER BY id DESC LIMIT ?`, params as Parametros);
      const temMais = linhas.length > limite;
      const itens = (temMais ? linhas.slice(0, limite) : linhas).map(mapear);
      return { itens, proximo: temMais ? (itens[itens.length - 1] as RegistroTroca).id : null };
    },
    /** Sugestões ainda pendentes de um Pane (para a faixa de sugestão e para não repetir). */
    pendentesDoPane(paneId: string): RegistroTroca[] {
      return banco.consultar<Linha>("SELECT * FROM troca_log WHERE pane_antigo_id = ? AND status IN ('sugerida','adiada') ORDER BY id DESC", [paneId]).map(mapear);
    },
  };
}
export type RepoTrocaLog = ReturnType<typeof criarRepoTrocaLog>;
