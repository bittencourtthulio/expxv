// Auxiliares dos scanners: leitura de skills/agentes/comandos em pastas, com cache `mtime+size`, limites e regras de symlink.
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CliCatalogo, EscopoCatalogo, OrigemCatalogo, PapelSugerido, TipoCatalogo } from "../../../compartilhado/catalogo";
import { lerFrontmatterSkill } from "../frontmatter";
import { normalizarNome } from "../normalizar";
import { abortado, LIMITES, listarPasta, relativoA, sha256, type ContextoVarredura, type EntradaDir } from "../raizes";
import { sanearNome, sanearTexto } from "../sanear";
import type { ErroScanner, InstalacaoEscaneada, ItemEscaneado } from "../tipos";

export interface RaizDeItens {
  cli: CliCatalogo;
  escopo: EscopoCatalogo;
  /** '' = global */
  workspace_id: string;
  base: "home" | "workspace";
  /** absoluta da base (home ou raiz do workspace) */
  baseAbs: string;
  /** absoluta da pasta a varrer */
  dirAbs: string;
  /** plugin dono (skill de plugin) */
  plugin?: string | null;
  habilitada?: boolean;
  origemPadrao?: OrigemCatalogo;
  /** `SKILL.md` em subpastas (skills) ou `*.md` direto (agentes, comandos) */
  forma: "pasta_skill" | "arquivo_md";
  tipo: Extract<TipoCatalogo, "skill" | "agent" | "command">;
  /** profundidade máxima de subpastas (skills: ocultas como `.system` entram) */
  profundidade?: number;
}

export function sugerirPapel(nome: string, descricao: string | null): PapelSugerido | null {
  const t = `${nome} ${descricao ?? ""}`.toLowerCase();
  if (/scout|explor/.test(nome.toLowerCase())) return "explorador";
  if (/review|audit|revis/.test(nome.toLowerCase())) return "revisor";
  if (/build|implement/.test(nome.toLowerCase())) return "executor";
  if (/\b(scout|explor)/.test(t)) return "explorador";
  return null;
}

export function origemDe(ctx: ContextoVarredura, nome: string, hash: string | null, plugin: string | null, autor: string | null, padrao: OrigemCatalogo): OrigemCatalogo {
  const conhecidos = ctx.embarcadas.get(normalizarNome(nome));
  if (conhecidos !== undefined && hash !== null && conhecidos.has(hash)) return "embarcada";
  if (plugin !== null || autor !== null) return padrao === "nativa" ? "nativa" : "terceiro";
  return padrao;
}

async function lerItem(ctx: ContextoVarredura, r: RaizDeItens, arquivoAbs: string, nomePadrao: string, erros: ErroScanner[], extra: { ehSymlink: boolean; metodoInstalacao: "nativo" | "symlink" }): Promise<ItemEscaneado | null> {
  const baseRel = relativoA(r.baseAbs, arquivoAbs) ?? basename(arquivoAbs);
  let s;
  try {
    s = await stat(arquivoAbs);
  } catch {
    return null;
  }
  if (!s.isFile()) return null;
  const chave = `${r.cli}|${r.base}|${r.workspace_id}|${r.tipo}|${baseRel}|${r.plugin ?? ""}|${r.habilitada === false ? 0 : 1}`;
  const c = ctx.cache.get(chave);
  if (c !== undefined && c.mtime_ms === Math.trunc(s.mtimeMs) && c.tamanho === s.size && c.itens[0] !== undefined) {
    return { ...c.itens[0], instalacao: { ...c.itens[0].instalacao }, };
  }
  let hash: string | null = null;
  let fm: ReturnType<typeof lerFrontmatterSkill> = {};
  let grande = false;
  try {
    if (s.size > LIMITES.skillMd) {
      grande = true;
      fm = lerFrontmatterSkill(await ctx.lerArquivo(arquivoAbs, LIMITES.frontmatter));
    } else {
      const buf = await ctx.lerArquivo(arquivoAbs, LIMITES.skillMd);
      hash = sha256(buf);
      fm = lerFrontmatterSkill(buf);
    }
  } catch (e) {
    erros.push({ cli: r.cli, tipo: r.tipo, codigo: "leitura_falhou", mensagem: e instanceof Error ? sanearTexto(e.name, 40) : "erro" });
    return null;
  }
  const nome = sanearNome(fm.name ?? nomePadrao) || nomePadrao;
  const descricao = sanearTexto(fm.description, 600) || null;
  const autor = fm.author === undefined ? null : sanearNome(fm.author) || null;
  const plugin = r.plugin ?? null;
  const inst: InstalacaoEscaneada = {
    cli: r.cli,
    escopo: r.escopo,
    workspace_id: r.workspace_id,
    base: r.base,
    caminho_rel: baseRel,
    metodo: extra.metodoInstalacao === "symlink" ? "symlink" : "nativo",
    estado: "presente",
    habilitada: r.habilitada !== false,
    criado_pelo_app: false,
    hash_conteudo: hash,
    tamanho: s.size,
    mtime_ms: Math.trunc(s.mtimeMs),
    detalhe: grande ? { motivo: "arquivo_grande" } : {},
  };
  const item: ItemEscaneado = {
    tipo: r.tipo,
    nome,
    nome_normalizado: normalizarNome(nome),
    plugin,
    autor,
    origem: origemDe(ctx, nome, hash, plugin, autor, r.origemPadrao ?? "usuario"),
    descricao,
    papel_sugerido: sugerirPapel(nome, descricao),
    instalacao: inst,
  };
  ctx.cache.set(chave, { mtime_ms: Math.trunc(s.mtimeMs), tamanho: s.size, itens: [item] });
  return item;
}

function itemQuebrado(r: RaizDeItens, e: EntradaDir, motivo: string): ItemEscaneado {
  const nome = sanearNome(e.nome.replace(/\.md$/i, "")) || "item";
  return {
    tipo: r.tipo,
    nome,
    nome_normalizado: normalizarNome(nome),
    plugin: r.plugin ?? null,
    autor: null,
    origem: r.origemPadrao ?? "usuario",
    descricao: null,
    papel_sugerido: null,
    instalacao: {
      cli: r.cli,
      escopo: r.escopo,
      workspace_id: r.workspace_id,
      base: r.base,
      caminho_rel: relativoA(r.baseAbs, e.abs) ?? e.nome,
      metodo: "symlink",
      estado: "quebrado",
      habilitada: r.habilitada !== false,
      criado_pelo_app: false,
      hash_conteudo: null,
      tamanho: null,
      mtime_ms: null,
      detalhe: { motivo },
    },
  };
}

/** Varre uma raiz de itens. Nunca lança; raiz ausente = vazio. Symlink fora das raízes = `quebrado` sem leitura; ciclo termina por `realpath`. */
export async function varrerRaiz(ctx: ContextoVarredura, r: RaizDeItens, raizes: readonly string[], erros: ErroScanner[]): Promise<ItemEscaneado[]> {
  const itens: ItemEscaneado[] = [];
  const visitados = new Set<string>();
  const prof = r.profundidade ?? (r.forma === "pasta_skill" ? 3 : 2);

  async function descer(dir: string, nivel: number): Promise<void> {
    if (abortado(ctx) || nivel > Math.min(prof, LIMITES.profundidade)) return;
    const entradas = await listarPasta(ctx, dir, raizes);
    for (const e of entradas) {
      if (abortado(ctx)) return;
      if (e.ehSymlink && e.foraDasRaizes) {
        itens.push(itemQuebrado(r, e, "fora_das_raizes"));
        continue;
      }
      if (e.ehSymlink && e.alvo === null) {
        itens.push(itemQuebrado(r, e, "alvo_ausente"));
        continue;
      }
      if (r.forma === "pasta_skill") {
        if (!e.ehDir) continue;
        const real = e.alvo ?? e.abs;
        if (visitados.has(real)) continue;
        visitados.add(real);
        const arquivo = join(e.abs, "SKILL.md");
        const it = await lerItem(ctx, r, arquivo, e.nome, erros, { ehSymlink: e.ehSymlink, metodoInstalacao: e.ehSymlink ? "symlink" : "nativo" });
        if (it !== null) itens.push(it);
        else if (nivel < prof) await descer(e.abs, nivel + 1);
      } else {
        if (e.ehDir) {
          const real = e.alvo ?? e.abs;
          if (visitados.has(real)) continue;
          visitados.add(real);
          await descer(e.abs, nivel + 1);
          continue;
        }
        if (!e.ehArquivo || !/\.md$/i.test(e.nome)) continue;
        const it = await lerItem(ctx, r, e.abs, e.nome.replace(/\.md$/i, ""), erros, { ehSymlink: e.ehSymlink, metodoInstalacao: e.ehSymlink ? "symlink" : "nativo" });
        if (it !== null) itens.push(it);
      }
    }
  }
  await descer(r.dirAbs, 1);
  return itens;
}
