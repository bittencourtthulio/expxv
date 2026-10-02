// Leitor incremental de CONTAGENS de tokens do Grok (D-503). A CLI grava `<GROK_HOME>/sessions/<cwd codificado>/<id da sessão>/usage.json` com os totais
// da sessão (`session.inputTokens`, `session.outputTokens`…). Lemos SOMENTE esses dois números: nunca `chat_history`, `updates`, `events`, `auth` nem qualquer
// outro arquivo, e nada além de contagens sai daqui. Sem timer e sem polling próprio: quem chama decide quando perguntar (o main, com a saída do PTY do Grok).
// As portas de disco são injetadas (disco no main, objeto nos testes); o formato é tolerante: campo ausente/estranho = sem leitura.
import * as fs from "node:fs/promises";
import { join } from "node:path";

/** `usage.json` pequeno (≈1,4 KB reais); acima disto é outro formato e é ignorado. */
export const TAMANHO_MAX_USAGE = 64 * 1024;
/** Quantas sessões mais recentes da pasta do projeto são observadas (ids são UUIDv7, ordenáveis por tempo). */
export const MAX_SESSOES_OBSERVADAS = 8;

export interface PortasGrok {
  /** nomes dos itens de uma pasta; `[]` se não existe. */
  listar(dir: string): Promise<string[]>;
  /** conteúdo de um arquivo regular pequeno ou `null`. */
  ler(caminho: string): Promise<string | null>;
  /** mtime em ms ou `null` se não existe. */
  mtime(caminho: string): Promise<number | null>;
}

/** Pasta de sessões do projeto: o Grok codifica o cwd inteiro como componente de URL. */
export const pastaSessoesGrok = (home: string, cwd: string): string => join(home, "sessions", encodeURIComponent(cwd));

/** Tokens de entrada + saída da sessão (a mesma conta do custo: `tokens_entrada + tokens_saida`); `null` se o formato não é o esperado. */
export function tokensDaSessao(texto: string): number | null {
  if (texto.length > TAMANHO_MAX_USAGE) return null;
  try {
    const j: unknown = JSON.parse(texto);
    if (typeof j !== "object" || j === null) return null;
    const s = (j as { session?: unknown }).session;
    if (typeof s !== "object" || s === null) return null;
    const { inputTokens, outputTokens } = s as { inputTokens?: unknown; outputTokens?: unknown };
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
    const a = num(inputTokens);
    const b = num(outputTokens);
    return a === null || b === null ? null : a + b;
  } catch {
    return null;
  }
}

export interface LeitorTokensGrok {
  /** Tokens consumidos desde a última pergunta para esta pasta de projeto. A primeira pergunta só fixa a linha de base e devolve 0. */
  delta(cwd: string): Promise<number>;
  /** Esquece o estado de um projeto. */
  esquecer(cwd: string): void;
}

export function criarLeitorTokensGrok(p: { home: string; portas: PortasGrok; maxSessoes?: number }): LeitorTokensGrok {
  const max = p.maxSessoes ?? MAX_SESSOES_OBSERVADAS;
  const estados = new Map<string, { iniciado: boolean; sessoes: Map<string, { mtime: number; total: number }> }>();
  return {
    async delta(cwd) {
      const pasta = pastaSessoesGrok(p.home, cwd);
      let e = estados.get(cwd);
      if (e === undefined) { e = { iniciado: false, sessoes: new Map() }; estados.set(cwd, e); }
      const nomes = (await p.portas.listar(pasta)).filter((n) => /^[0-9a-f-]{16,64}$/i.test(n)).sort().reverse().slice(0, max);
      let soma = 0;
      for (const nome of nomes) {
        const arq = join(pasta, nome, "usage.json");
        const m = await p.portas.mtime(arq);
        if (m === null) continue;
        const antes = e.sessoes.get(nome);
        if (antes !== undefined && antes.mtime === m) continue;
        const texto = await p.portas.ler(arq);
        const total = texto === null ? null : tokensDaSessao(texto);
        if (total === null) continue;
        if (e.iniciado) soma += antes === undefined ? total : Math.max(0, total - antes.total);
        e.sessoes.set(nome, { mtime: m, total });
      }
      e.iniciado = true;
      return soma;
    },
    esquecer(cwd) { estados.delete(cwd); },
  };
}

/** Portas reais sobre `node:fs/promises`: só arquivos regulares pequenos, nunca symlink. */
export function portasDeDisco(): PortasGrok {
  return {
    listar: async (dir) => { try { return await fs.readdir(dir); } catch { return []; } },
    mtime: async (c) => { try { const st = await fs.lstat(c); return st.isFile() ? Math.round(st.mtimeMs) : null; } catch { return null; } },
    ler: async (c) => { try { const st = await fs.lstat(c); return st.isFile() && st.size <= TAMANHO_MAX_USAGE ? await fs.readFile(c, "utf8") : null; } catch { return null; } },
  };
}
