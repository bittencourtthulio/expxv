import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ID_CONVERSA } from "./catalogo";

export const MAX_CONVERSAS = 200;
const ID_SESSAO = /^[\w.-]{1,80}$/;
const ID_FERRAMENTA = /^[a-z0-9_]{1,64}$/i;

interface EntradaConversa { ferramenta_id: string; conversa_id: string; atualizado_em: number }
type Conteudo = Record<string, EntradaConversa>;

export interface ArmazemConversas {
  /** sessao_id → conversa_id */
  listar(): Record<string, string>;
  gravar(sessao_id: string, ferramenta_id: string, conversa_id: string): void;
  apagar(sessao_id: string): void;
}

function valido(bruto: unknown): Conteudo {
  const saida: Conteudo = {};
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return saida;
  for (const [sessao, valor] of Object.entries(bruto as Record<string, unknown>)) {
    const v = valor as Partial<EntradaConversa> | null;
    if (!ID_SESSAO.test(sessao) || v === null || typeof v !== "object") continue;
    if (typeof v.ferramenta_id !== "string" || !ID_FERRAMENTA.test(v.ferramenta_id)) continue;
    if (typeof v.conversa_id !== "string" || !ID_CONVERSA.test(v.conversa_id)) continue;
    if (typeof v.atualizado_em !== "number" || !Number.isFinite(v.atualizado_em)) continue;
    saida[sessao] = { ferramenta_id: v.ferramenta_id, conversa_id: v.conversa_id, atualizado_em: v.atualizado_em };
  }
  return saida;
}

/** Um arquivo 0600 por raiz (chave = hash da raiz) na pasta de dados do app. Fora do daemon. */
export function criarArmazemConversas(dir: string, raiz: string, agora: () => number = Date.now): ArmazemConversas {
  const arquivo = join(dir, `${createHash("sha1").update(raiz).digest("hex").slice(0, 16)}.json`);
  const ler = (): Conteudo => {
    try { return valido(JSON.parse(readFileSync(arquivo, "utf8"))); } catch { return {}; }
  };
  const gravarTudo = (conteudo: Conteudo): void => {
    const ordenadas = Object.entries(conteudo).sort((a, b) => b[1].atualizado_em - a[1].atualizado_em).slice(0, MAX_CONVERSAS);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temporario = `${arquivo}.${process.pid}.tmp`;
    writeFileSync(temporario, JSON.stringify(Object.fromEntries(ordenadas)), { mode: 0o600 });
    renameSync(temporario, arquivo);
    if (process.platform !== "win32") chmodSync(arquivo, 0o600);
  };
  return {
    listar: () => Object.fromEntries(Object.entries(ler()).map(([sessao, e]) => [sessao, e.conversa_id])),
    gravar(sessao_id, ferramenta_id, conversa_id) {
      if (!ID_SESSAO.test(sessao_id) || !ID_FERRAMENTA.test(ferramenta_id) || !ID_CONVERSA.test(conversa_id)) return;
      const conteudo = ler();
      conteudo[sessao_id] = { ferramenta_id, conversa_id, atualizado_em: agora() };
      gravarTudo(conteudo);
    },
    apagar(sessao_id) {
      const conteudo = ler();
      if (!(sessao_id in conteudo)) return;
      delete conteudo[sessao_id];
      gravarTudo(conteudo);
    },
  };
}
