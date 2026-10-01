import type { Banco, Parametros } from "../banco";
import { agora } from "../tempo";
import { NaoEncontradoErro, type Conta, type OpcoesPagina, type Pagina } from "../../dominio";
import { bool, fecharPagina, int, limiteDe, novoId, textoObrigatorio } from "./comum";

type LinhaConta = Omit<Conta, "habilitada"> & { habilitada: number };
const mapear = (l: LinhaConta): Conta => ({ ...l, habilitada: bool(l.habilitada) });

export interface NovaConta {
  provedor: string;
  rotulo: string;
  config_dir_ref?: string | null;
  habilitada?: boolean;
}

export function criarRepoConta(banco: Banco) {
  const obter = (id: string): Conta | undefined => {
    const l = banco.consultarUm<LinhaConta>("SELECT * FROM conta WHERE id = ?", [id]);
    return l ? mapear(l) : undefined;
  };
  const exigir = (id: string): Conta => {
    const c = obter(id);
    if (!c) throw new NaoEncontradoErro("Conta", id);
    return c;
  };
  return {
    obter,
    exigir,
    criar(d: NovaConta): Conta {
      const provedor = textoObrigatorio("provedor", d.provedor);
      const rotulo = textoObrigatorio("rotulo", d.rotulo);
      const id = novoId("conta", "conta");
      const ts = agora();
      banco.executar("INSERT INTO conta (id,provedor,rotulo,config_dir_ref,habilitada,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?)", [
        id, provedor, rotulo, d.config_dir_ref ?? null, int(d.habilitada ?? true), ts, ts,
      ]);
      return exigir(id);
    },
    listar(op?: OpcoesPagina & { provedor?: string; apenasHabilitadas?: boolean }): Pagina<Conta> {
      const limite = limiteDe(op);
      const cond: string[] = [];
      const params: (string | number)[] = [];
      if (op?.provedor !== undefined) {
        cond.push("provedor = ?");
        params.push(op.provedor);
      }
      if (op?.apenasHabilitadas) cond.push("habilitada = 1");
      if (op?.depois) {
        cond.push("id > ?");
        params.push(op.depois);
      }
      params.push(limite + 1);
      const onde = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
      const p = fecharPagina(banco.consultar<LinhaConta>(`SELECT * FROM conta ${onde} ORDER BY id LIMIT ?`, params as Parametros), limite);
      return { itens: p.itens.map(mapear), proximo: p.proximo };
    },
    definirHabilitada(id: string, habilitada: boolean): Conta {
      exigir(id);
      banco.executar("UPDATE conta SET habilitada = ?, atualizado_em = ? WHERE id = ?", [int(habilitada), agora(), id]);
      return exigir(id);
    },
    renomear(id: string, rotulo: string): Conta {
      exigir(id);
      banco.executar("UPDATE conta SET rotulo = ?, atualizado_em = ? WHERE id = ?", [textoObrigatorio("rotulo", rotulo), agora(), id]);
      return exigir(id);
    },
    remover(id: string): void {
      banco.executar("DELETE FROM conta WHERE id = ?", [id]);
    },
  };
}

export type RepoConta = ReturnType<typeof criarRepoConta>;
