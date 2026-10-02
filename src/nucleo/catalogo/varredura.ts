// Orquestrador de varredura (T-07.11): puro (sem Electron), cancelável por `AbortSignal`, erro de um scanner vira erro nominal e os demais seguem.
// Une os itens de todas as CLIs por `(tipo, nome_normalizado)`: 1 linha, N instalações (D-45). No app roda em `worker_threads` (worker.ts).
import { CLIS_CATALOGO, TIPOS_CATALOGO, type CliCatalogo, type OrigemCatalogo, type TipoCatalogo } from "../../compartilhado/catalogo";
import { abortado, type ContextoVarredura } from "./raizes";
import { varrerClaude } from "./scanners/claude";
import { varrerCodex, varrerGemini, varrerOpenCode, varrerPortatil } from "./scanners/outras";
import { varrerMetodo } from "./scanners/metodo";
import type { ErroScanner, InstalacaoEscaneada, ItemEscaneado, ResultadoScanner } from "./tipos";

export interface ItemAgregado {
  tipo: TipoCatalogo;
  nome: string;
  nome_normalizado: string;
  plugin: string | null;
  autor: string | null;
  origem: OrigemCatalogo;
  descricao: string | null;
  papel_sugerido: ItemEscaneado["papel_sugerido"];
  instalacoes: InstalacaoEscaneada[];
}

export interface ResultadoVarredura {
  itens: ItemAgregado[];
  erros: ErroScanner[];
  duracao_ms: number;
  /** o que foi coberto: base para marcar ausentes */
  cobertura: { clis: CliCatalogo[]; tipos: TipoCatalogo[]; workspace_ids: string[] };
  cancelada: boolean;
}

export interface ProgressoScanner {
  cli: CliCatalogo | null;
  tipo: TipoCatalogo | null;
  feitos: number;
  total: number | null;
}

export interface OpcoesVarredura {
  contexto: ContextoVarredura;
  tipos?: readonly TipoCatalogo[] | null;
  clis?: readonly CliCatalogo[] | null;
  onProgresso?: (p: ProgressoScanner) => void;
}

const PRIORIDADE: Record<OrigemCatalogo, number> = { metodo: 5, embarcada: 4, nativa: 3, terceiro: 2, usuario: 1 };

type Scanner = (ctx: ContextoVarredura, tipos: ReadonlySet<TipoCatalogo>) => Promise<ResultadoScanner>;
const SCANNERS: ReadonlyArray<{ cli: CliCatalogo; fn: Scanner }> = [
  { cli: "claude", fn: varrerClaude },
  { cli: "codex", fn: varrerCodex },
  { cli: "opencode", fn: varrerOpenCode },
  { cli: "gemini", fn: varrerGemini },
  { cli: "portatil", fn: varrerPortatil },
];

const chaveInst = (i: InstalacaoEscaneada): string => `${i.cli}|${i.escopo}|${i.workspace_id}`;

export function agregar(itens: readonly ItemEscaneado[]): ItemAgregado[] {
  const mapa = new Map<string, ItemAgregado>();
  for (const it of itens) {
    const k = `${it.tipo}|${it.nome_normalizado}`;
    let a = mapa.get(k);
    if (a === undefined) {
      a = { tipo: it.tipo, nome: it.nome, nome_normalizado: it.nome_normalizado, plugin: it.plugin, autor: it.autor, origem: it.origem, descricao: it.descricao, papel_sugerido: it.papel_sugerido, instalacoes: [it.instalacao] };
      mapa.set(k, a);
      continue;
    }
    if (PRIORIDADE[it.origem] > PRIORIDADE[a.origem]) a.origem = it.origem;
    if (a.descricao === null && it.descricao !== null) a.descricao = it.descricao;
    if (a.plugin === null && it.plugin !== null) a.plugin = it.plugin;
    if (a.autor === null && it.autor !== null) a.autor = it.autor;
    if (a.papel_sugerido === null && it.papel_sugerido !== null) a.papel_sugerido = it.papel_sugerido;
    const i = a.instalacoes.findIndex((x) => chaveInst(x) === chaveInst(it.instalacao));
    if (i < 0) a.instalacoes.push(it.instalacao);
    else {
      const atual = a.instalacoes[i] as InstalacaoEscaneada;
      // mantém a leitura mais rica (com hash); presente vence quebrado
      if ((atual.hash_conteudo === null && it.instalacao.hash_conteudo !== null) || (atual.estado !== "presente" && it.instalacao.estado === "presente")) a.instalacoes[i] = it.instalacao;
    }
  }
  return [...mapa.values()].sort((x, y) => (x.tipo + x.nome_normalizado < y.tipo + y.nome_normalizado ? -1 : 1));
}

export async function executarVarredura(o: OpcoesVarredura): Promise<ResultadoVarredura> {
  const ctx = o.contexto;
  const t0 = performance.now();
  const tipos = new Set<TipoCatalogo>(o.tipos ?? TIPOS_CATALOGO);
  const clis = new Set<CliCatalogo>(o.clis ?? CLIS_CATALOGO);
  const erros: ErroScanner[] = [];
  const brutos: ItemEscaneado[] = [];
  let feitos = 0;
  for (const s of SCANNERS) {
    if (!clis.has(s.cli)) continue;
    if (abortado(ctx)) break;
    try {
      const r = await s.fn(ctx, tipos);
      brutos.push(...r.itens);
      erros.push(...r.erros);
    } catch (e) {
      erros.push({ cli: s.cli, tipo: null, codigo: "scanner_falhou", mensagem: e instanceof Error ? e.name.slice(0, 40) : "erro" });
    }
    feitos++;
    o.onProgresso?.({ cli: s.cli, tipo: null, feitos, total: null });
    await new Promise<void>((r) => setImmediate(r));
  }
  if (clis.has("claude") && !abortado(ctx)) {
    try {
      const r = await varrerMetodo(ctx, tipos);
      brutos.push(...r.itens);
      erros.push(...r.erros);
    } catch (e) {
      erros.push({ cli: "claude", tipo: null, codigo: "scanner_falhou", mensagem: e instanceof Error ? e.name.slice(0, 40) : "erro" });
    }
  }
  const itens = agregar(brutos.filter((b) => clis.has(b.instalacao.cli) && tipos.has(b.tipo)));
  return {
    itens,
    erros,
    duracao_ms: Math.round(performance.now() - t0),
    cobertura: { clis: [...clis], tipos: [...tipos], workspace_ids: ["", ...ctx.workspaces.map((w) => w.id)] },
    cancelada: abortado(ctx),
  };
}
