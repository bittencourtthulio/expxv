// Protocolo main ⇄ processo de reconhecimento (Fase 11, D-544). Mensagens PEQUENAS e tipadas; o áudio vai como bytes PCM16 (nunca em arquivo) e o texto volta só no `resultado`.
// Erros carregam SÓ um código fixo (nunca texto de fala, caminho nem saída do runtime).
export type CodigoErroWorker = "runtime_indisponivel" | "modelo_corrompido" | "falha";

/** o que o runtime precisa para criar o reconhecedor: já montado pelo main a partir do catálogo e da pasta VERIFICADA. */
export interface ConfigCarga {
  /** identifica o reconhecedor carregado (modelo + idioma): chave diferente = recarrega. */
  chave: string;
  /** objeto de configuração do `OfflineRecognizer` do sherpa-onnx-node (caminhos absolutos dentro da pasta do modelo). */
  sherpa: Record<string, unknown>;
  /** trechos maiores são divididos antes de decodificar (Whisper ≤ 30 s). */
  trecho_max_s: number;
}

export type MensagemParaWorker =
  | { t: "carregar"; req: number; config: ConfigCarga }
  | { t: "transcrever"; req: number; pcm: Uint8Array }
  | { t: "sair" };

export type MensagemDoWorker =
  | { t: "pronto" }
  | { t: "carregado"; req: number; ms: number; ram_mb: number }
  | { t: "resultado"; req: number; texto: string; ms: number; duracao_ms: number; ram_mb: number }
  | { t: "erro"; req: number; codigo: CodigoErroWorker };
