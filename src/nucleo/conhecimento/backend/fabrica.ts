// Fábrica dos armazenamentos online e teste de conexão. Valida a URL (HTTPS obrigatório fora de loopback/rede privada, sem credencial
// embutida) e os campos obrigatórios; só fala com o provedor pelo transporte injetado (consentimento é do transporte).
import type { ProvedorRag, ResultadoTestarBackend } from "../../../compartilhado/rag";
import type { ArmazenamentoConhecimento } from "../armazenamento/interface";
import { ArmazenamentoPinecone } from "./adaptadores/pinecone";
import { ArmazenamentoQdrant } from "./adaptadores/qdrant";
import { TABELA_PADRAO_SUPABASE, ArmazenamentoSupabase } from "./adaptadores/supabase";
import { ArmazenamentoUpstash } from "./adaptadores/upstash";
import type { ArmazenamentoHttp } from "./adaptadores/comum";
import { PROVEDORES, sanitizarErro } from "./config";
import { CAMPOS_OBRIGATORIOS_SECRETOS } from "./provedores";
import type { TransporteHttpRag } from "./transporte";
import { validarUrlBackend } from "./url";

export interface PedidoFabricaRag {
  provedor: ProvedorRag | string;
  url: string;
  colecao_remota: string;
  /** campos do formulário que o main leu do cofre (ou o que acabou de digitar, em "testar sem salvar"). */
  segredos: Record<string, string>;
  transporte: TransporteHttpRag;
  projeto_id: string;
  equipe_id?: string;
  timeoutMs?: number;
  loteMaximo?: number;
  sinal?: AbortSignal;
}

const ehProvedor = (p: string): p is ProvedorRag => (PROVEDORES as readonly string[]).includes(p);

/** Pinecone: o usuário costuma colar o host sem esquema. */
export function normalizarUrlProvedor(provedor: string, url: string): string {
  const u = url.trim();
  return provedor === "pinecone" && u !== "" && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? `https://${u}` : u;
}

function criarAdaptador(p: PedidoFabricaRag): ArmazenamentoHttp {
  if (!ehProvedor(p.provedor)) throw new Error("provedor inválido");
  const url = normalizarUrlProvedor(p.provedor, p.url);
  const v = validarUrlBackend(url);
  if (!v.ok) throw new Error(v.erro ?? "URL inválida");
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(p.colecao_remota)) throw new Error("nome da coleção remota inválido");
  if (typeof p.projeto_id !== "string" || p.projeto_id === "") throw new Error("projeto_id obrigatório");
  for (const campo of CAMPOS_OBRIGATORIOS_SECRETOS[p.provedor]) {
    if (typeof p.segredos[campo] !== "string" || p.segredos[campo] === "") throw new Error(`o campo "${campo}" é obrigatório para ${p.provedor}`);
  }
  const base = {
    transporte: p.transporte,
    url,
    segredos: p.segredos,
    ...(p.timeoutMs === undefined ? {} : { timeoutMs: p.timeoutMs }),
    ...(p.loteMaximo === undefined ? {} : { loteMaximo: p.loteMaximo }),
    ...(p.sinal === undefined ? {} : { sinal: p.sinal }),
  };
  const ns = (p.segredos.namespace ?? "") !== "" ? (p.segredos.namespace as string) : p.colecao_remota;
  switch (p.provedor) {
    case "qdrant":
      return new ArmazenamentoQdrant({ ...base, colecao: p.colecao_remota });
    case "supabase":
      return new ArmazenamentoSupabase({ ...base, colecao: (p.segredos.tabela ?? "") !== "" ? (p.segredos.tabela as string) : /^[a-z_][a-z0-9_]{0,40}$/.test(p.colecao_remota) ? p.colecao_remota : TABELA_PADRAO_SUPABASE });
    case "upstash":
      return new ArmazenamentoUpstash({ ...base, colecao: ns });
    case "pinecone":
      return new ArmazenamentoPinecone({ ...base, colecao: ns });
  }
}

/** Cria o armazenamento do provedor. Lança `Error` (sem segredo) para URL/provedor/campo inválido. */
export function criarArmazenamentoRag(p: PedidoFabricaRag): ArmazenamentoConhecimento {
  return criarAdaptador(p);
}

/** Testa a conexão SEM gravar nem criar coleção. Nunca lança; o motivo sai sanitizado. */
export async function testarConexaoRag(p: PedidoFabricaRag): Promise<ResultadoTestarBackend> {
  const segredos = Object.values(p.segredos);
  try {
    const a = criarAdaptador(p);
    const r = await a.testarConexao();
    if (!r.ok) return { ok: false, motivo: sanitizarErro(r.motivo ?? "falha ao conectar", segredos) };
    const saida: ResultadoTestarBackend = { ok: true, ...(r.versao === undefined ? {} : { versao: r.versao }) };
    try {
      const c = await a.lerConfigRemota(); // só leitura: informa o modelo/dimensão já gravados na coleção, se houver
      if (c !== null) {
        saida.dimensao_remota = c.dimensao;
        saida.modelo_remoto = c.modeloEmbedding;
      }
    } catch {
      /* ainda não existe configuração remota: tudo bem */
    }
    return saida;
  } catch (e) {
    return { ok: false, motivo: sanitizarErro(e instanceof Error ? e.message : "falha ao conectar", segredos) };
  }
}
