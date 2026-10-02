// Configuração do backend online (sem segredo): provedor, URL, coleção remota, modo, tipos, consentimento. Credenciais vivem SÓ no
// cofre do SO (porta injetada); o renderer envia o segredo uma vez e NUNCA o recebe de volta (só a máscara).
import { createHash } from "node:crypto";
import type { ConsentimentoBackend, ModoBackend, TipoDocumento } from "../../../compartilhado/conhecimento";
import { POLITICA_VERSAO } from "../constantes";
import { validarUrlBackend } from "./url";

export const PROVEDORES = ["qdrant", "supabase", "upstash", "pinecone"] as const;
export type Provedor = (typeof PROVEDORES)[number];

export const TIPOS_MIGRAVEIS_PADRAO: readonly TipoDocumento[] = ["aprendizado", "decisao", "doc", "relatorio", "causa_raiz", "qa", "commit", "task", "handoff"];
/** Desligados por padrão e com aviso forte: outras pessoas verão (P-55: opt-in por tipo). */
export const TIPOS_COM_AVISO: readonly TipoDocumento[] = ["codigo", "transcricao", "chat"];

export interface ConfigBackend {
  provedor: Provedor;
  url: string;
  colecao_remota: string;
  regiao?: string;
  modo: ModoBackend;
  /** nomes dos segredos no cofre (nunca o valor). */
  id_segredos: string[];
  projeto_id: string;
  equipe_id?: string;
  /** rótulo de autor (pseudônimo); nunca o usuário do SO. */
  autor?: string;
  tipos: TipoDocumento[];
  consentimento: ConsentimentoBackend | null;
}

/** `projeto_id = sha256(remote git origin normalizado)[:16]` (D-92); sem remote usa o slug informado. Nunca caminho absoluto. */
export function projetoIdDoRemote(remote: string | null, slug?: string): string {
  const base = remote !== null && remote.trim() !== "" ? normalizarRemote(remote) : `slug:${(slug ?? "").trim().toLowerCase()}`;
  return createHash("sha256").update(base, "utf8").digest("hex").slice(0, 16);
}

export function normalizarRemote(remote: string): string {
  let r = remote.trim().toLowerCase();
  r = r.replace(/^git@([^:]+):/, "https://$1/").replace(/^ssh:\/\/(?:[^@]+@)?/, "https://").replace(/^https?:\/\/(?:[^@/]+@)?/, "https://").replace(/\/+$/, "").replace(/\.git$/, "").replace(/\/+$/, "");
  return r;
}

export function nomeSegredo(provedor: string, campo: string): string {
  return `RAG_${provedor.toUpperCase()}_${campo.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/** `••••` + últimos 4 (ou só "configurada" para valores curtos). */
export function mascarar(valor: string): string {
  return valor.length >= 12 ? `••••${valor.slice(-4)}` : "configurada";
}

export interface PortaCofreRag {
  /** recusa quando o cofre não é seguro (ex.: backend `basic_text` no Linux). */
  guardar(nome: string, valor: string): Promise<void>;
  existe(nome: string): Promise<boolean>;
  apagar(nome: string): Promise<void>;
  obter(nome: string): Promise<string | null>;
}

/** Guarda os segredos do formulário e devolve SÓ as máscaras. */
export async function guardarSegredos(cofre: PortaCofreRag, provedor: string, campos: Readonly<Record<string, string>>): Promise<{ ids: string[]; mascarado: Record<string, string> }> {
  const ids: string[] = [];
  const mascarado: Record<string, string> = {};
  for (const [campo, valor] of Object.entries(campos)) {
    if (typeof valor !== "string" || valor === "") continue;
    const nome = nomeSegredo(provedor, campo);
    await cofre.guardar(nome, valor);
    ids.push(nome);
    mascarado[campo] = mascarar(valor);
  }
  return { ids, mascarado };
}

/** Remove valores secretos (e partes de URL com query) de uma mensagem de erro antes de exibir/logar. */
export function sanitizarErro(msg: string, segredos: readonly string[]): string {
  let t = msg;
  for (const s of segredos) if (s.length >= 4) t = t.split(s).join("••••");
  return t.replace(/https?:\/\/[^\s"']+/gi, (u) => u.split("?")[0] as string).replace(/\b(?:api[-_]?key|authorization|bearer)\b[^\s,;]*/gi, "••••").slice(0, 300);
}

export function validarConfig(c: Partial<ConfigBackend>): { ok: true } | { ok: false; erros: string[] } {
  const erros: string[] = [];
  if (!c.provedor || !(PROVEDORES as readonly string[]).includes(c.provedor)) erros.push("provedor inválido");
  const u = validarUrlBackend(c.url ?? "");
  if (!u.ok) erros.push(u.erro ?? "URL inválida");
  if (!c.colecao_remota || !/^[A-Za-z0-9_.-]{1,80}$/.test(c.colecao_remota)) erros.push("nome da coleção remota inválido");
  if (!c.projeto_id || !/^[0-9a-f]{16}$/.test(c.projeto_id)) erros.push("projeto_id inválido");
  if (c.modo === undefined || !["local", "espelho", "compartilhado"].includes(c.modo)) erros.push("modo inválido");
  if (!Array.isArray(c.tipos) || c.tipos.length === 0) erros.push("escolha ao menos um tipo");
  return erros.length === 0 ? { ok: true } : { ok: false, erros };
}

/** O consentimento vale só para (provedor, coleção, host, versão da política): mudou o destino, pede de novo. */
export function consentimentoVale(c: ConsentimentoBackend | null, alvo: { provedor: string; host: string; colecao: string }): boolean {
  return c !== null && c.provedor === alvo.provedor && c.host === alvo.host && c.colecao === alvo.colecao && c.versao_politica === POLITICA_VERSAO;
}
