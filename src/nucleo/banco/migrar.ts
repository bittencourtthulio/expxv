import { copyFileSync, existsSync } from "node:fs";
import type { Banco } from "./banco";
import { MIGRACOES } from "./migracoes";
import { agora } from "./tempo";

export interface Migracao {
  /** Inteiro sequencial a partir de 1; vira o `PRAGMA user_version` ao concluir. */
  versao: number;
  nome: string;
  aplicar(banco: Banco): void;
}

export class BancoVersaoFuturaErro extends Error {
  override name = "BancoVersaoFuturaErro";
  constructor(
    readonly versaoDoBanco: number,
    readonly versaoSuportada: number,
  ) {
    super(
      `O banco está na versão ${versaoDoBanco}, mas esta versão do app suporta até a ${versaoSuportada}. ` +
        "Atualize o app; o banco não foi alterado.",
    );
  }
}

export interface OpcoesMigrar {
  /** Caminho do arquivo do banco; habilita o backup antes de migrar um banco existente. */
  caminho?: string;
  /** Substitui a lista oficial (testes). */
  migracoes?: readonly Migracao[];
}

export interface ResultadoMigrar {
  de: number;
  para: number;
  aplicadas: string[];
  /** Caminho da cópia de segurança, quando houve. */
  backup?: string;
}

export function versaoAtual(banco: Banco): number {
  return Number(banco.consultarUm<{ user_version: number }>("PRAGMA user_version")?.user_version ?? 0);
}

function validarSequencia(migracoes: readonly Migracao[]): void {
  migracoes.forEach((m, i) => {
    if (m.versao !== i + 1) {
      throw new Error(`Migrações fora de sequência: esperada a versão ${i + 1}, encontrada ${m.versao} (${m.nome}).`);
    }
  });
}

/**
 * Leva o banco à última versão. Cada migration roda em uma transação junto com a atualização de
 * `user_version` (que é transacional no SQLite): falha reverte a migration inteira e a versão não
 * avança; as anteriores permanecem. Banco de versão maior que a suportada é recusado sem ser tocado.
 */
export function migrar(banco: Banco, opcoes: OpcoesMigrar = {}): ResultadoMigrar {
  const lista = opcoes.migracoes ?? MIGRACOES;
  validarSequencia(lista);
  const suportada = lista.length;
  const de = versaoAtual(banco);
  if (de > suportada) throw new BancoVersaoFuturaErro(de, suportada);

  const pendentes = lista.filter((m) => m.versao > de);
  const resultado: ResultadoMigrar = { de, para: de, aplicadas: [] };
  if (pendentes.length === 0) return resultado;

  const { caminho } = opcoes;
  if (de > 0 && caminho && caminho !== ":memory:" && existsSync(caminho)) {
    banco.executar("PRAGMA wal_checkpoint(TRUNCATE)"); // a cópia do arquivo principal fica completa
    const destino = `${caminho}.bak-v${de}-${agora().replace(/[:.]/g, "-")}`;
    copyFileSync(caminho, destino);
    resultado.backup = destino;
  }

  for (const m of pendentes) {
    banco.transacao((tx) => {
      m.aplicar(tx);
      tx.executar(`PRAGMA user_version = ${m.versao}`);
    });
    resultado.para = m.versao;
    resultado.aplicadas.push(m.nome);
  }
  return resultado;
}
