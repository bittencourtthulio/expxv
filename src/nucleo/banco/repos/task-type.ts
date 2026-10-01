import type { Banco } from "../banco";
import { agora } from "../tempo";
import { ErroDominio, NaoEncontradoErro, ValorInvalidoErro } from "../../dominio";
import type { TaskType, TaskTypeEntrada } from "../../../compartilhado/harness";
import { bool, int, textoObrigatorio } from "./comum";

interface Linha {
  slug: string;
  categoria: string;
  rotulo: string;
  descricao: string | null;
  embutido: number;
}
const mapear = (l: Linha): TaskType => ({ slug: l.slug, categoria: l.categoria, rotulo: l.rotulo, descricao: l.descricao, embutido: bool(l.embutido) });

export class TaskTypeEmbutidoErro extends ErroDominio {
  override name = "TaskTypeEmbutidoErro";
  constructor(readonly slug: string) {
    super(`O tipo de tarefa "${slug}" é embutido e não pode ser apagado.`);
  }
}

const SLUG = /^[a-z][a-z0-9-]{0,39}$/;

export function criarRepoTaskType(banco: Banco) {
  const obter = (slug: string): TaskType | undefined => {
    const l = banco.consultarUm<Linha>("SELECT slug,categoria,rotulo,descricao,embutido FROM task_type WHERE slug = ?", [slug]);
    return l ? mapear(l) : undefined;
  };
  const checar = (d: TaskTypeEntrada): void => {
    if (!SLUG.test(d.slug)) throw new ValorInvalidoErro("slug", d.slug);
    if (!SLUG.test(d.categoria)) throw new ValorInvalidoErro("categoria", d.categoria);
    textoObrigatorio("rotulo", d.rotulo);
  };
  return {
    obter,
    exigir(slug: string): TaskType {
      const t = obter(slug);
      if (!t) throw new NaoEncontradoErro("TaskType", slug);
      return t;
    },
    listar(): TaskType[] {
      return banco.consultar<Linha>("SELECT slug,categoria,rotulo,descricao,embutido FROM task_type ORDER BY categoria, slug").map(mapear);
    },
    /** Cria ou atualiza um tipo do usuário. Não altera a marca `embutido` de um tipo existente. */
    gravar(d: TaskTypeEntrada): TaskType {
      checar(d);
      const ts = agora();
      banco.executar(
        `INSERT INTO task_type (slug,categoria,rotulo,descricao,embutido,criado_em,atualizado_em) VALUES (?,?,?,?,0,?,?)
         ON CONFLICT(slug) DO UPDATE SET categoria = excluded.categoria, rotulo = excluded.rotulo, descricao = excluded.descricao, atualizado_em = excluded.atualizado_em`,
        [d.slug, d.categoria, d.rotulo, d.descricao, ts, ts],
      );
      return this.exigir(d.slug);
    },
    /** Semente dos embutidos: idempotente, não sobrescreve edição do usuário. Devolve quantos entraram. */
    semear(tipos: readonly TaskTypeEntrada[]): number {
      const ts = agora();
      let novos = 0;
      banco.transacao((tx) => {
        for (const t of tipos) {
          checar(t);
          const r = tx.executar(
            "INSERT OR IGNORE INTO task_type (slug,categoria,rotulo,descricao,embutido,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?)",
            [t.slug, t.categoria, t.rotulo, t.descricao, int(true), ts, ts],
          );
          novos += r.alteracoes;
        }
      });
      return novos;
    },
    /** Só tipos não embutidos; as políticas do tipo caem em cascata. */
    apagar(slug: string): boolean {
      const t = obter(slug);
      if (!t) return false;
      if (t.embutido) throw new TaskTypeEmbutidoErro(slug);
      return banco.executar("DELETE FROM task_type WHERE slug = ?", [slug]).alteracoes > 0;
    },
  };
}
export type RepoTaskType = ReturnType<typeof criarRepoTaskType>;
