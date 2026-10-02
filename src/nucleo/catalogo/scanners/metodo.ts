// Scanner do método Expx (T-07.10): marca como `origem=metodo` as skills do `.expx/expx-lock.json` presentes em `.claude/skills/<nome>` e lista os hooks
// de `.expx/hooks.json` com o modo (aviso/bloqueio/desligado). SOMENTE LEITURA: usa os leitores do método e nunca grava em `.expx/` nem em `.claude/` (D-04).
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { TipoCatalogo } from "../../../compartilhado/catalogo";
import { lerHooks } from "../../metodo/hooks";
import { lerLockDoProjeto } from "../../metodo/instalacao";
import { normalizarNome } from "../normalizar";
import type { ContextoVarredura } from "../raizes";
import { sanearNome } from "../sanear";
import type { ErroScanner, ItemEscaneado, ResultadoScanner } from "../tipos";
import { lerFrontmatterSkill } from "../frontmatter";
import { sanearTexto } from "../sanear";

export async function varrerMetodo(ctx: ContextoVarredura, tipos: ReadonlySet<TipoCatalogo>): Promise<ResultadoScanner> {
  const erros: ErroScanner[] = [];
  const itens: ItemEscaneado[] = [];
  for (const w of ctx.workspaces) {
    if (ctx.abort?.aborted === true) break;
    let lock;
    try {
      lock = (await lerLockDoProjeto(w.raiz)).lock;
    } catch {
      continue;
    }
    if (tipos.has("skill")) {
      for (const s of lock.skills) {
        const dir = join(w.raiz, ".claude", "skills", s.nome);
        const arq = join(dir, "SKILL.md");
        let st;
        try {
          st = await stat(arq);
        } catch {
          continue;
        }
        if (!st.isFile()) continue;
        let descricao: string | null = null;
        try {
          descricao = sanearTexto(lerFrontmatterSkill(await ctx.lerArquivo(arq, 8 * 1024)).description, 600) || null;
        } catch {
          descricao = null;
        }
        const nome = sanearNome(s.nome);
        itens.push({
          tipo: "skill", nome, nome_normalizado: normalizarNome(nome), plugin: null, autor: null, origem: "metodo", descricao, papel_sugerido: null,
          instalacao: { cli: "claude", escopo: "projeto", workspace_id: w.id, base: "workspace", caminho_rel: `.claude/skills/${nome}/SKILL.md`, metodo: "nativo", estado: "presente", habilitada: true, criado_pelo_app: false, hash_conteudo: null, tamanho: st.size, mtime_ms: Math.trunc(st.mtimeMs), detalhe: { commit: s.commit === null ? null : s.commit.slice(0, 12) } },
        });
      }
    }
    if (tipos.has("hook")) {
      try {
        const h = await lerHooks(w.raiz);
        if (h.presente) {
          for (const x of h.hooks) {
            const nome = sanearNome(`expx:${x.nome}`);
            itens.push({
              tipo: "hook", nome, nome_normalizado: normalizarNome(nome), plugin: null, autor: null, origem: "metodo", descricao: null, papel_sugerido: null,
              instalacao: { cli: "claude", escopo: "projeto", workspace_id: w.id, base: "workspace", caminho_rel: ".expx/hooks.json", metodo: "nativo", estado: "presente", habilitada: x.modo !== "desligado", criado_pelo_app: false, hash_conteudo: null, tamanho: null, mtime_ms: null, detalhe: { evento: "metodo", cli: "claude", escopo: "projeto", gerenciado_pelo_app: false, gerenciado_pelo_metodo: true, modo: x.modo, tipo_hook: x.tipo } },
            });
          }
        }
      } catch (e) {
        erros.push({ cli: "claude", tipo: "hook", codigo: "hooks_ilegiveis", mensagem: e instanceof Error ? sanearTexto(e.name, 40) : "erro" });
      }
    }
  }
  return { itens, erros };
}
