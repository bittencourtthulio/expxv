// Abre o conhecimento.db (T-15.03): arquivo próprio, WAL, migrations próprias, FTS5 por tentativa. Só o worker (ou o serviço)
// abre este arquivo; o banco do domínio nunca habilita extensão. `sqlite-vec` não é usado (D-81: índice exato em JS).
import { abrirBanco, type Banco } from "../banco/banco";
import { migrar } from "../banco/migrar";
import { garantirFts } from "./fts";
import { MIGRACOES_CONHECIMENTO } from "./migracoes";

export interface BancoConhecimento {
  banco: Banco;
  fts5: boolean;
}

export function abrirBancoConhecimento(caminho: string, opcoes: { semFts?: boolean } = {}): BancoConhecimento {
  const banco = abrirBanco(caminho);
  try {
    // `secure_delete`: todo DELETE zera as páginas (esquecer de verdade, auditoria A-03; a fila e os chunks nunca deixam resíduo legível)
    try {
      banco.executar("PRAGMA secure_delete = ON");
    } catch {
      /* sem o pragma: segue com o DELETE comum */
    }
    migrar(banco, { caminho, migracoes: MIGRACOES_CONHECIMENTO });
    const fts5 = garantirFts(banco, opcoes.semFts === true ? { simularAusencia: true } : {});
    return { banco, fts5 };
  } catch (e) {
    banco.fechar();
    throw e;
  }
}
