// Descritores dos provedores do backend online para a UI (formulário de configuração). Tipo compatível com `ProvedorRagDto`.
// Campos secretos vão ao cofre do SO (nunca voltam ao renderer); `url` e campos não secretos ficam na configuração.
import type { CampoProvedor, ProvedorRag, ProvedorRagDto } from "../../../compartilhado/rag";
import type { Capacidades } from "../armazenamento/interface";
import { CAPACIDADES_PINECONE } from "./adaptadores/pinecone";
import { CAPACIDADES_QDRANT } from "./adaptadores/qdrant";
import { CAPACIDADES_SUPABASE, SCRIPT_PREPARACAO_SUPABASE } from "./adaptadores/supabase";
import { CAPACIDADES_UPSTASH } from "./adaptadores/upstash";

const campo = (chave: string, rotulo: string, secreto: boolean, obrigatorio: boolean, dica: string | null): CampoProvedor => ({ chave, rotulo, secreto, obrigatorio, dica });

const cap = (c: Capacidades): ProvedorRagDto["capacidades"] => ({ hibrido: c.hibrido, filtroNativo: c.filtroNativo, dimensaoMaxima: c.dimensaoMaxima ?? null, loteMaximo: c.loteMaximo, consistenciaEventual: c.consistenciaEventual });

export const CAMPOS_OBRIGATORIOS_SECRETOS: Readonly<Record<ProvedorRag, readonly string[]>> = {
  qdrant: [],
  supabase: ["service_key"],
  upstash: ["token"],
  pinecone: ["api_key"],
};

const DESCRITORES: readonly ProvedorRagDto[] = [
  {
    id: "qdrant",
    nome: "Qdrant",
    campos: [
      campo("url", "URL do cluster", false, true, "Cloud: https://<cluster>.cloud.qdrant.io:6333. Self-host: http://localhost:6333 (http só em loopback ou rede privada)."),
      campo("api_key", "Chave de API", true, false, "Opcional em self-host sem autenticação. Fica só no cofre do sistema."),
    ],
    capacidades: cap({ ...CAPACIDADES_QDRANT }),
    script_preparacao: null,
  },
  {
    id: "supabase",
    nome: "Supabase (pgvector)",
    campos: [
      campo("url", "URL do projeto", false, true, "https://<ref>.supabase.co"),
      campo("service_key", "Chave service_role", true, true, "Use a chave service_role (nunca a anon). Fica só no cofre do sistema."),
      campo("tabela", "Tabela", false, false, "Padrão: o nome da coleção remota. Minúsculas, números e _; a mesma do script de preparação."),
    ],
    capacidades: cap({ ...CAPACIDADES_SUPABASE }),
    script_preparacao: SCRIPT_PREPARACAO_SUPABASE,
  },
  {
    id: "upstash",
    nome: "Upstash Vector",
    campos: [
      campo("url", "URL do índice", false, true, "https://<nome>-vector.upstash.io"),
      campo("token", "Token", true, true, "Token de leitura e escrita do índice. Fica só no cofre do sistema."),
      campo("namespace", "Namespace", false, false, "Padrão: o nome da coleção remota."),
    ],
    capacidades: cap({ ...CAPACIDADES_UPSTASH }),
    script_preparacao: null,
  },
  {
    id: "pinecone",
    nome: "Pinecone",
    campos: [
      campo("url", "Host do índice", false, true, "O host do índice (ex.: meu-indice-abc123.svc.aped-1234.pinecone.io), não o da API de controle."),
      campo("api_key", "Chave de API", true, true, "Fica só no cofre do sistema."),
      campo("namespace", "Namespace", false, false, "Padrão: o nome da coleção remota."),
    ],
    capacidades: cap({ ...CAPACIDADES_PINECONE }),
    script_preparacao: null,
  },
];

export function listarProvedores(): ProvedorRagDto[] {
  return DESCRITORES.map((d) => ({ ...d, campos: d.campos.map((c) => ({ ...c })), capacidades: { ...d.capacidades } }));
}

export function descritorDe(id: string): ProvedorRagDto | undefined {
  return listarProvedores().find((d) => d.id === id);
}
