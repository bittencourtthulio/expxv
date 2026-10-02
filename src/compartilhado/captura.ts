import type { ApiVozModelos } from "./voz-local";

// Contratos da Fase 11 (voz e captura). Tipos puros e constantes, sem runtime além delas. O renderer NUNCA envia caminho, cwd nem executável: captura é identificada por id
// (o main resolve o arquivo) e o destino de uma anexação é o Pane (sessão) validado pelo main. Agente não captura tela nem ouve microfone: não existe tool MCP (D-65).

export type EstadoPermissao = "concedida" | "negada" | "indeterminada" | "restrita";
export type FonteCaptura = "tela" | "janela_app";
export type TipoCaptura = "imagem" | "quadros";
export type FormatoImagem = "png" | "jpeg";

export type CodigoErroCaptura =
  | "permissao_tela_negada"
  | "sem_janela"
  | "sem_tela"
  | "selecao_pequena"
  | "token_invalido"
  | "ja_gravando"
  | "nao_gravando"
  | "captura_inexistente"
  | "sem_terminal"
  | "disco_sem_escrita"
  | "indisponivel";

export const LIMITES_CAPTURA = {
  /** imagem acima disso sai em JPEG q85 (PNG abaixo). */
  png_max_bytes: 800 * 1024,
  jpeg_qualidade: 85,
  /** seleção menor que isto (px lógicos) cancela. */
  selecao_min_px: 5,
  /** quadro congelado vale por este tempo; depois o main solta a memória. */
  congelado_ttl_ms: 90_000,
  quadros_max: 120,
  quadros_duracao_max_ms: 60_000,
  edicao_max_bytes: 25 * 1024 * 1024,
  pagina: 50,
} as const;

export const ATALHOS_CAPTURA_PADRAO = { regiao: "CommandOrControl+Shift+5", quadros: "CommandOrControl+Shift+6" } as const;

export interface EstadoCaptura {
  tela: EstadoPermissao;
  /** a janela do app é capturada por `capturePage`, sem permissão do SO. */
  janela_app: true;
  plataforma: "mac" | "windows" | "linux";
  /** o aviso de primeira captura ("fica local, pode conter segredos") já foi mostrado. */
  aviso_visto: boolean;
  fps_padrao: 1 | 2;
  atalhos_globais: boolean;
  /** atalhos que o menu e o registro global usam (aceleradores do Electron). */
  atalho_regiao: string;
  atalho_quadros: string;
  gravando_quadros: boolean;
  /** por que o registro global falhou (atalho em uso por outro app); `null` quando ok ou desligado. */
  atalho_erro: string | null;
}

export interface ConfigCaptura {
  fps_padrao: 1 | 2;
  atalhos_globais: boolean;
  aviso_visto: boolean;
}

export interface ItemCaptura {
  id: string;
  tipo: TipoCaptura;
  formato: FormatoImagem | null;
  /** relativo à raiz do workspace (ou a `<userData>` sem workspace); nunca absoluto. */
  caminho: string;
  bytes: number;
  largura: number | null;
  altura: number | null;
  anotada: boolean;
  fps: number | null;
  quadros: number | null;
  criado_em: string;
}

export interface PaginaCapturas {
  itens: ItemCaptura[];
  proximo: string | null;
}

export type ResultadoRegiaoIniciar =
  | {
      ok: true;
      token: string;
      /** imagem congelada (JPEG) já no tamanho LÓGICO do display: o renderer a desenha 1:1 e devolve coordenadas lógicas. */
      imagem: Uint8Array;
      largura: number;
      altura: number;
      fator: number;
    }
  | { ok: false; codigo: CodigoErroCaptura; instrucao: string };

export type ResultadoAcaoCaptura = { ok: true; captura_id: string } | { ok: false; codigo: CodigoErroCaptura; instrucao: string };

export interface RetanguloLogico { x: number; y: number; largura: number; altura: number }

export interface ResultadoAnexoCaptura { caminhos: string[]; texto: string }

export type EventoCapturaIpc =
  | { tipo: "mudou"; captura_id: string; acao: "criada" | "editada" | "removida" }
  | { tipo: "quadros_progresso"; quadros: number; maximo: number; decorrido_ms: number; fps: number }
  | { tipo: "quadros_fim"; captura_id: string | null; motivo: "parou" | "limite" | "erro"; instrucao: string | null }
  | { tipo: "atalho"; acao: "regiao" | "quadros" };

export interface ApiCaptura {
  estado(): Promise<EstadoCaptura>;
  configGravar(patch: Partial<ConfigCaptura>): Promise<EstadoCaptura>;
  /** só depois do diálogo explicativo do app; no macOS a permissão de tela só vale depois de reabrir o app. */
  pedirTela(): Promise<{ estado: EstadoPermissao; reiniciar_app: boolean }>;
  regiaoIniciar(fonte: FonteCaptura): Promise<ResultadoRegiaoIniciar>;
  regiaoConfirmar(token: string, selecao: RetanguloLogico, workspaceId: string | null): Promise<ResultadoAcaoCaptura>;
  regiaoCancelar(token: string): Promise<boolean>;
  janelaInteira(workspaceId: string | null): Promise<ResultadoAcaoCaptura>;
  quadrosIniciar(fonte: FonteCaptura, fps: 1 | 2, workspaceId: string | null): Promise<{ ok: true } | { ok: false; codigo: CodigoErroCaptura; instrucao: string }>;
  quadrosParar(): Promise<{ captura_id: string | null }>;
  listar(workspaceId: string | null, depois: string | null): Promise<PaginaCapturas>;
  ler(capturaId: string, workspaceId: string | null): Promise<{ bytes: Uint8Array; tipo: FormatoImagem }>;
  salvarEdicao(capturaId: string, workspaceId: string | null, png: Uint8Array): Promise<{ ok: true }>;
  anexarAoPane(capturaId: string, workspaceId: string | null, sessaoId: string): Promise<ResultadoAnexoCaptura>;
  anexarQuadrosAoPane(capturaId: string, workspaceId: string | null, sessaoId: string): Promise<ResultadoAnexoCaptura>;
  copiarCaminho(capturaId: string, workspaceId: string | null): Promise<boolean>;
  remover(capturaId: string, workspaceId: string | null): Promise<boolean>;
  assinar(cb: (e: EventoCapturaIpc) => void): () => void;
}

// ------------------------------------------------------------------------------------------------ voz

export type CodigoErroVoz =
  | "sem_rede"
  | "chave_recusada"
  | "limite_de_uso"
  | "microfone_negado"
  | "microfone_indisponivel"
  | "motor_ausente"
  | "motor_falhou"
  | "modelo_ausente"
  | "modelo_corrompido"
  | "runtime_indisponivel"
  | "consentimento_ausente"
  | "fala_vazia"
  | "fala_curta"
  | "tempo_esgotado"
  | "sem_terminal_em_foco"
  | "cancelado"
  | "ocupado"
  | "indisponivel";

export type EstadoDitado = "ocioso" | "gravando" | "transcrevendo" | "injetando" | "erro";
/** `local_embutido` = voz local embutida (modelo baixado com consentimento, roda neste computador; Fase 11 / D-540). */
export type MotorVoz = "nenhum" | "local_embutido" | "comando_local" | "http_compativel";
export type IdiomaVoz = "pt" | "en";
export type DisparoVoz = "segurar" | "alternar";
export type ServicoConsentimento = "voz_stt";

export const NOMES_SEGREDO_VOZ = ["voz_chave_stt"] as const;
export type NomeSegredoVoz = (typeof NOMES_SEGREDO_VOZ)[number];

export const LIMITES_VOZ = {
  /** bloco de PCM por `voz:audio`. */
  bloco_max_bytes: 64 * 1024,
  taxa_hz: 16_000,
  fala_max_ms: 120_000,
  fala_min_ms: 300,
  /** 120 s de PCM16 16 kHz mono. */
  pcm_max_bytes: 3_840_000,
  texto_max: 4_000,
  historico_memoria: 50,
  termos_max: 500,
} as const;

/** versão do texto de consentimento: mudar invalida os consentimentos antigos. */
export const VERSAO_CONSENTIMENTO_VOZ = "2026-10-01.1";

export interface ConfigVoz {
  motor: MotorVoz;
  /** `comando_local`: executável + argumentos (lista, nunca string de shell) com marcadores `{wav}`, `{idioma}`, `{modelo}`. */
  comando_executavel: string | null;
  comando_args: string[];
  /** `http_compativel`: URL base (`https:` ou loopback `http://127.0.0.1`). */
  url: string | null;
  modelo: string | null;
  /** `local_embutido`: id do modelo ativo (do catálogo versionado); só vale com o modelo instalado. */
  modelo_local: string | null;
  /** `local_embutido`: segundos de ociosidade até descarregar o modelo da memória. */
  ociosidade_s: number;
  idioma: IdiomaVoz;
  disparo: DisparoVoz;
  atalho: string;
  alternar_global: boolean;
}

export interface EstadoVoz extends ConfigVoz {
  motor_pronto: boolean;
  /** `http_compativel`: o host atual tem consentimento vigente. `comando_local`/`nenhum`: true (nada sai da máquina). */
  consentimento: boolean;
  host: string | null;
  tem_chave: boolean;
  microfone: EstadoPermissao;
  ditado: EstadoDitado;
  aviso_microfone_visto: boolean;
  plataforma: "mac" | "windows" | "linux";
  /** por que o registro do alternar global falhou; `null` quando ok ou desligado. */
  atalho_erro: string | null;
}

export interface TermoVoz { termo: string; dica: string | null }

export interface EntradaHistoricoVoz { id: string; criado_em: string; texto: string; injetada: boolean; codigo: CodigoErroVoz | null; duracao_ms: number }

export type EventoVozIpc =
  | { tipo: "estado"; sequencia: number; ditado: EstadoDitado }
  | { tipo: "texto"; fala_id: string; injetada: boolean; palavras: number; codigo: CodigoErroVoz | null }
  | { tipo: "erro"; codigo: CodigoErroVoz; estagio: EstadoDitado }
  | { tipo: "aviso"; codigo: "fala_cortada" }
  | { tipo: "atalho"; acao: "alternar" };

export interface ApiVoz extends ApiVozModelos {
  estado(): Promise<EstadoVoz>;
  configGravar(patch: Partial<ConfigVoz> & { aviso_microfone_visto?: boolean }): Promise<EstadoVoz>;
  /** a chave entra uma vez e nunca volta; `null` apaga. Vai para o cofre do SO. */
  segredoGravar(nome: NomeSegredoVoz, valor: string | null): Promise<{ ok: true }>;
  consentir(servico: ServicoConsentimento, host: string, aceitar: boolean): Promise<{ ok: true }>;
  testarMotor(): Promise<{ ok: boolean; latencia_ms: number | null; erro: CodigoErroVoz | null }>;
  pedirMicrofone(): Promise<{ estado: EstadoPermissao }>;
  abrirAjustes(painel: "microfone" | "tela"): Promise<boolean>;
  iniciar(sessaoId: string, disparo: DisparoVoz): Promise<{ ok: boolean; codigo: CodigoErroVoz | null }>;
  parar(): Promise<{ ok: boolean }>;
  cancelar(): Promise<{ ok: boolean }>;
  /** envio sem resposta: PCM16 LE, 16 kHz, mono, até 64 KiB, sequência monotônica. */
  audio(sequencia: number, dados: Uint8Array): void;
  dicionarioListar(): Promise<TermoVoz[]>;
  dicionarioSalvar(termo: string, dica: string | null): Promise<TermoVoz[]>;
  dicionarioRemover(termo: string): Promise<TermoVoz[]>;
  historicoListar(): Promise<EntradaHistoricoVoz[]>;
  historicoLimpar(): Promise<{ ok: true }>;
  assinar(cb: (e: EventoVozIpc) => void): () => void;
}
