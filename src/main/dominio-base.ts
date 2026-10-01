import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PRODUTO } from "../nucleo/produto";
import type { Banco } from "../nucleo/banco";
import type { ServicoWorkspaces } from "../nucleo/workspaces/servico";

/**
 * Base do domínio: banco SQLite (WAL, migrado) e o serviço de workspaces. Criada logo DEPOIS de a
 * janela ser criada (P-01) e ANTES dos terminais, porque o contexto dos terminais precisa de
 * `resolverCwd`/`permissaoDe` do workspace. O diálogo de pasta é injetado (só o main abre diálogos).
 */

export interface DominioBase {
  banco: Banco;
  workspaces: ServicoWorkspaces;
  fechar(): void;
}

export async function abrirDominioBase(op: {
  pastaDeDados: string;
  escolherPasta: () => Promise<string | null>;
  /** permissão dos workspaces novos (config `permissao_padrao`). */
  permissaoPadrao?: () => "seguro" | "automatico";
}): Promise<DominioBase> {
  const [{ abrirBanco, migrar }, { criarRepositorios }, { criarServicoWorkspaces }] = await Promise.all([
    import("../nucleo/banco"),
    import("../nucleo/banco/repos"),
    import("../nucleo/workspaces/servico"),
  ]);
  mkdirSync(op.pastaDeDados, { recursive: true });
  const caminho = join(op.pastaDeDados, `${PRODUTO.id}.db`);
  const banco = abrirBanco(caminho);
  migrar(banco, { caminho }); // AUD-08: com o caminho, um banco existente é copiado antes de migrar
  const workspaces = criarServicoWorkspaces({ repos: criarRepositorios(banco), escolherPasta: op.escolherPasta, ...(op.permissaoPadrao === undefined ? {} : { permissaoPadrao: op.permissaoPadrao }) });
  let fechado = false;
  return {
    banco,
    workspaces,
    fechar() {
      if (fechado) return;
      fechado = true;
      try {
        banco.fechar();
      } catch {
        // o banco já fechou
      }
    },
  };
}
