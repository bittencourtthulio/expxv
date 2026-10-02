// Contratos da atualização (Fase 21, T-21.02, D-340..D-343). Tipos e constantes compartilhados entre main e renderer.
// Nenhum campo carrega URL vinda do renderer, token ou credencial: o feed é fixo no build (build/distribuicao.json).

export const CANAIS_ATUALIZACAO = ["stable", "beta"] as const;
export type CanalAtualizacao = (typeof CANAIS_ATUALIZACAO)[number];

export const FASES_ATUALIZACAO = ["desligado", "ocioso", "verificando", "disponivel", "baixando", "verificado", "pronto", "instalando", "erro"] as const;
export type FaseAtualizacao = (typeof FASES_ATUALIZACAO)[number];

export const PLATAFORMAS_ATUALIZACAO = ["darwin", "win32"] as const;
export type PlataformaAtualizacao = (typeof PLATAFORMAS_ATUALIZACAO)[number];
export const ARQUITETURAS_ATUALIZACAO = ["arm64", "x64", "universal"] as const;
export type ArquiteturaAtualizacao = (typeof ARQUITETURAS_ATUALIZACAO)[number];

/** Códigos nominais de motivo (nunca texto de servidor). */
export const MOTIVOS_ATUALIZACAO = [
  "manifesto_invalido",
  "assinatura_ausente",
  "assinatura_invalida",
  "chave_revogada",
  "canal_cruzado",
  "canal_nao_permitido",
  "downgrade",
  "expirado",
  "manifesto_antigo",
  "abaixo_da_versao_minima",
  "fora_do_rollout",
  "sem_artefato",
  "hash_diferente",
  "tamanho_diferente",
  "host_nao_permitido",
  "redirecionamento_recusado",
  "servidor_hostil",
  "cancelado",
  "desligado",
  "sem_consentimento",
  "panes_trabalhando",
  "protocolo_do_daemon",
  "backend_indisponivel",
  "versao_nao_instalada_antes",
  "ja_atual",
  "falha_de_rede",
] as const;
export type MotivoAtualizacao = (typeof MOTIVOS_ATUALIZACAO)[number];

export interface ArtefatoAtualizacao {
  plataforma: PlataformaAtualizacao;
  arquitetura: ArquiteturaAtualizacao;
  /** relativa ao feed fixo do build; nunca absoluta. */
  url_relativa: string;
  /** sha512 em hexadecimal minúsculo (128 caracteres). */
  sha512: string;
  tamanho: number;
}

/** Manifesto de atualização (conteúdo assinado). O app só o aceita com assinatura Ed25519 destacada válida (D-343). */
export interface ManifestoAtualizacao {
  esquema: 1;
  versao: string;
  canal: CanalAtualizacao;
  publicado_em: string;
  valido_ate: string;
  artefatos: ArtefatoAtualizacao[];
  /** texto puro (Keep a Changelog); a UI usa textContent (AU-15). */
  notas: string;
  /** percentual 0..100 do rollout gradual (AU-16). */
  staging: number;
  /** abaixo desta versão a atualização é obrigatória/revoga as anteriores. */
  versao_minima?: string;
  /** chaves públicas (base64) revogadas por este manifesto. */
  chaves_revogadas?: string[];
  /** emitido sem chave de assinatura: o app recusa (D-348). */
  nao_assinado?: boolean;
}

export interface ConfigAtualizacao {
  ligada: boolean;
  canal: CanalAtualizacao;
  baixar_automatico: boolean;
  instalar_ao_sair: boolean;
  verificar_ao_abrir: boolean;
  /** versão do texto de consentimento aceito (0 = nenhum). */
  consentimento_versao: number;
}

export const CONFIG_ATUALIZACAO_PADRAO: Readonly<ConfigAtualizacao> = Object.freeze({
  ligada: false,
  canal: "stable",
  baixar_automatico: false,
  instalar_ao_sair: false,
  verificar_ao_abrir: false,
  consentimento_versao: 0,
});

/** Versão atual do texto de consentimento (lista exatamente o que sai: host do feed e versão atual). */
export const CONSENTIMENTO_ATUALIZACAO_VERSAO = 1;

export interface DisponivelAtualizacao {
  versao: string;
  canal: CanalAtualizacao;
  notas: string;
  tamanho: number;
  publicado_em: string;
}

export interface EstadoAtualizacao {
  fase: FaseAtualizacao;
  versao_atual: string;
  canal: CanalAtualizacao;
  disponivel?: DisponivelAtualizacao;
  /** 0..1, coalescido (≤ 4 eventos/s). */
  progresso?: number;
  habilitada_no_build: boolean;
  consentimento: boolean;
  ultima_verificacao: string | null;
  motivo?: MotivoAtualizacao;
}

export const TIPOS_EVENTO_ATUALIZACAO = ["verificada", "disponivel", "baixada", "verificacao_falhou", "instalada", "revertida", "recusada", "config_alterada"] as const;
export type TipoEventoAtualizacao = (typeof TIPOS_EVENTO_ATUALIZACAO)[number];

export interface AtualizacaoEvento {
  id: string;
  tipo: TipoEventoAtualizacao;
  canal: CanalAtualizacao;
  versao_de: string;
  versao_para: string | null;
  motivo: MotivoAtualizacao | null;
  criado_em: string;
}

export const LIMITES_ATUALIZACAO = {
  historico_max: 100,
  notas_max: 20_000,
  versao_max: 64,
  artefatos_max: 8,
  manifesto_bytes_max: 256 * 1024,
  /** teto do artefato (o app tem teto de 400 MB; instalador pode ser menor, mas nunca maior que isto). */
  artefato_bytes_max: 600 * 1024 * 1024,
} as const;
