// Localiza transcrições das CLIs no disco (somente LEITURA; P-51). Claude: `<home>/.claude/projects/<slug>/<sessao>.jsonl`;
// Codex: `<CODEX_HOME|home/.codex>/sessions/AAAA/MM/DD/rollout-*.jsonl` (a pasta de trabalho está nas primeiras linhas). A leitura do
// arquivo inteiro é limitada (20 MB); o parser descarta saída de ferramenta e raciocínio. Nada aqui grava.
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SessaoTranscricao } from "./transcricoes";

export const TRANSCRICAO_MAX_BYTES = 20 * 1024 * 1024;
const SESSAO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

/** `/Users/x/proj` → `-Users-x-proj` (como o Claude Code nomeia a pasta de projeto). */
export const slugClaude = (raiz: string): string => raiz.replace(/[^A-Za-z0-9]/g, "-");

async function lerLimitado(caminho: string): Promise<{ texto: string; mtime: number } | null> {
  try {
    const fh = await open(caminho, "r");
    try {
      const st = await fh.stat();
      if (!st.isFile() || st.size > TRANSCRICAO_MAX_BYTES) return null;
      const buf = Buffer.alloc(st.size);
      await fh.read(buf, 0, st.size, 0);
      return { texto: buf.toString("utf8"), mtime: st.mtimeMs };
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

export interface OpcoesListarSessoes {
  home: string;
  raiz: string;
  /** só estas sessões (as iniciadas pelo app); `null` = todas (histórico: exige consentimento). */
  somenteIds: ReadonlySet<string> | null;
  /** ignora sessões mais antigas que isto (ms desde a época), p.ex. retenção. */
  desdeMs?: number;
  limite?: number;
  codexHome?: string;
}

export async function listarSessoesClaude(o: OpcoesListarSessoes): Promise<SessaoTranscricao[]> {
  const pasta = join(o.home, ".claude", "projects", slugClaude(o.raiz));
  let nomes: string[];
  try {
    nomes = await readdir(pasta);
  } catch {
    return [];
  }
  const saida: SessaoTranscricao[] = [];
  for (const nome of nomes.sort().reverse()) {
    if (saida.length >= (o.limite ?? 200)) break;
    if (!nome.endsWith(".jsonl")) continue;
    const id = nome.slice(0, -".jsonl".length);
    if (!SESSAO_ID.test(id) || (o.somenteIds !== null && !o.somenteIds.has(id))) continue;
    const l = await lerLimitado(join(pasta, nome));
    if (l === null || (o.desdeMs !== undefined && l.mtime < o.desdeMs)) continue;
    saida.push({ sessao_id: id, cli: "claude", modelo: null, mission_id: null, pane_id: null, jsonl: l.texto, iniciadaPeloApp: o.somenteIds !== null, ocorrido_em: new Date(l.mtime).toISOString() });
  }
  return saida;
}

async function* arquivosCodex(base: string, profundidade = 0): AsyncGenerator<string> {
  if (profundidade > 4) return;
  let itens: import("node:fs").Dirent[];
  try {
    itens = await readdir(base, { withFileTypes: true });
  } catch {
    return;
  }
  for (const it of itens.sort((a, b) => (a.name < b.name ? 1 : -1))) {
    if (it.isSymbolicLink()) continue;
    const p = join(base, it.name);
    if (it.isDirectory()) yield* arquivosCodex(p, profundidade + 1);
    else if (it.isFile() && /^rollout-.*\.jsonl$/.test(it.name)) yield p;
  }
}

export async function listarSessoesCodex(o: OpcoesListarSessoes): Promise<SessaoTranscricao[]> {
  const base = join(o.codexHome ?? join(o.home, ".codex"), "sessions");
  const saida: SessaoTranscricao[] = [];
  for await (const arq of arquivosCodex(base)) {
    if (saida.length >= (o.limite ?? 200)) break;
    const nome = arq.slice(arq.lastIndexOf("/") + 1).replace(/\.jsonl$/, "");
    const id = nome.replace(/^rollout-/, "");
    if (!SESSAO_ID.test(id) || (o.somenteIds !== null && !o.somenteIds.has(id))) continue;
    const l = await lerLimitado(arq);
    if (l === null || (o.desdeMs !== undefined && l.mtime < o.desdeMs)) continue;
    // só sessões desta pasta de trabalho: o `cwd` aparece nas primeiras linhas
    const cabecalho = l.texto.slice(0, 4000);
    if (!cabecalho.includes(JSON.stringify(o.raiz).slice(1, -1))) continue;
    saida.push({ sessao_id: id, cli: "codex", modelo: null, mission_id: null, pane_id: null, jsonl: l.texto, iniciadaPeloApp: o.somenteIds !== null, ocorrido_em: new Date(l.mtime).toISOString() });
  }
  return saida;
}

export async function existeArquivo(caminho: string): Promise<boolean> {
  try {
    return (await stat(caminho)).isFile();
  } catch {
    return false;
  }
}
