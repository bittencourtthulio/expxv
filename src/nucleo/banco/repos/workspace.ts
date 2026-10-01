import type { Banco } from "../banco";
import { agora } from "../tempo";
import {
  ACESSOS_EXTERNOS,
  DuplicadoErro,
  NaoEncontradoErro,
  PERMISSOES,
  type AcessoExterno,
  type OpcoesPagina,
  type Pagina,
  type Permissao,
  type Workspace,
} from "../../dominio";
import { atualizarCampos, bool, ehUnicoViolado, exigirEnum, fecharPagina, int, limiteDe, novoId, textoObrigatorio } from "./comum";

interface Linha {
  id: string;
  nome: string;
  raiz: string;
  e_git: number;
  acesso_externo: AcessoExterno;
  permissao: Permissao;
  ultimo_uso_em: string | null;
  removido_em: string | null;
  criado_em: string;
  atualizado_em: string;
}

function mapear(l: Linha): Workspace {
  const { removido_em: _removido, ...resto } = l;
  return { ...resto, e_git: bool(l.e_git) };
}

export interface NovoWorkspace {
  nome: string;
  raiz: string;
  e_git?: boolean;
  acesso_externo?: AcessoExterno;
  permissao?: Permissao;
}

export function criarRepoWorkspace(banco: Banco) {
  const obter = (id: string): Workspace | undefined => {
    const l = banco.consultarUm<Linha>("SELECT * FROM workspace WHERE id = ? AND removido_em IS NULL", [id]);
    return l ? mapear(l) : undefined;
  };
  const exigir = (id: string): Workspace => {
    const w = obter(id);
    if (!w) throw new NaoEncontradoErro("Workspace", id);
    return w;
  };
  return {
    obter,
    exigir,
    criar(dados: NovoWorkspace): Workspace {
      const nome = textoObrigatorio("nome", dados.nome);
      const raiz = textoObrigatorio("raiz", dados.raiz);
      const acesso = exigirEnum("acesso_externo", dados.acesso_externo ?? "nenhum", ACESSOS_EXTERNOS);
      const permissao = exigirEnum("permissao", dados.permissao ?? "seguro", PERMISSOES);
      const id = novoId("workspace", "ws");
      const ts = agora();
      try {
        banco.executar(
          "INSERT INTO workspace (id,nome,raiz,e_git,acesso_externo,permissao,ultimo_uso_em,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,NULL,?,?)",
          [id, nome, raiz, int(dados.e_git ?? false), acesso, permissao, ts, ts],
        );
      } catch (e) {
        if (ehUnicoViolado(e, "workspace.raiz")) throw new DuplicadoErro("Workspace", raiz);
        throw e;
      }
      return exigir(id);
    },
    obterPorRaiz(raiz: string): Workspace | undefined {
      const l = banco.consultarUm<Linha>("SELECT * FROM workspace WHERE raiz = ? AND removido_em IS NULL", [raiz]);
      return l ? mapear(l) : undefined;
    },
    /** AUD-11: workspace removido de forma lógica, achado pelo caminho (reabrir o restaura). */
    obterRemovidoPorRaiz(raiz: string): Workspace | undefined {
      const l = banco.consultarUm<Linha>("SELECT * FROM workspace WHERE raiz = ? AND removido_em IS NOT NULL", [raiz]);
      return l ? mapear(l) : undefined;
    },
    /** Mais recentemente usados primeiro (índice ix_workspace_ultimo_uso). */
    recentes(limite = 20): Workspace[] {
      return banco
        .consultar<Linha>("SELECT * FROM workspace WHERE ultimo_uso_em IS NOT NULL AND removido_em IS NULL ORDER BY ultimo_uso_em DESC LIMIT ?", [limiteDe({ limite })])
        .map(mapear);
    },
    listar(op?: OpcoesPagina): Pagina<Workspace> {
      const limite = limiteDe(op);
      const linhas = op?.depois
        ? banco.consultar<Linha>("SELECT * FROM workspace WHERE removido_em IS NULL AND id > ? ORDER BY id LIMIT ?", [op.depois, limite + 1])
        : banco.consultar<Linha>("SELECT * FROM workspace WHERE removido_em IS NULL ORDER BY id LIMIT ?", [limite + 1]);
      const p = fecharPagina(linhas, limite);
      return { itens: p.itens.map(mapear), proximo: p.proximo };
    },
    marcarUso(id: string, quando: string = agora()): Workspace {
      exigir(id);
      banco.executar("UPDATE workspace SET ultimo_uso_em = ?, atualizado_em = ? WHERE id = ?", [quando, agora(), id]);
      return exigir(id);
    },
    atualizar(id: string, patch: Partial<Pick<Workspace, "nome" | "e_git" | "acesso_externo" | "permissao">>): Workspace {
      exigir(id);
      if (patch.acesso_externo !== undefined) exigirEnum("acesso_externo", patch.acesso_externo, ACESSOS_EXTERNOS);
      if (patch.permissao !== undefined) exigirEnum("permissao", patch.permissao, PERMISSOES);
      atualizarCampos(
        banco,
        "workspace",
        id,
        {
          nome: patch.nome === undefined ? undefined : textoObrigatorio("nome", patch.nome),
          e_git: patch.e_git === undefined ? undefined : int(patch.e_git),
          acesso_externo: patch.acesso_externo,
          permissao: patch.permissao,
        },
        ["nome", "e_git", "acesso_externo", "permissao"],
        agora(),
      );
      return exigir(id);
    },
    /** AUD-11: remoção LÓGICA. O histórico (Missões, Panes, cards, handoffs) fica; só some das listagens. Nunca toca o disco. */
    remover(id: string): void {
      banco.executar("UPDATE workspace SET removido_em = ?, atualizado_em = ? WHERE id = ? AND removido_em IS NULL", [agora(), agora(), id]);
    },
    /** Desfaz `remover`: devolve o workspace e todo o histórico. */
    restaurar(id: string): Workspace {
      banco.executar("UPDATE workspace SET removido_em = NULL, atualizado_em = ? WHERE id = ?", [agora(), id]);
      return exigir(id);
    },
    /** Apaga de verdade, em cascata (Missões, Panes, cards, handoffs). Só pela ação explícita "apagar histórico". */
    apagarDefinitivo(id: string): boolean {
      const r = banco.executar("DELETE FROM workspace WHERE id = ?", [id]);
      return r.alteracoes > 0;
    },
  };
}

export type RepoWorkspace = ReturnType<typeof criarRepoWorkspace>;
