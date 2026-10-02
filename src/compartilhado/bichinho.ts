// Contrato do Bichinho do workspace (D-460…): tipos puros, sem runtime pesado. O bichinho é um "ser vivo" do projeto na sidebar: espécie
// determinística (sinais baratos e locais), humor que reage às CLIs e maturidade que cresce com tokens + base de conhecimento.
// SÓ contadores e metadados: nenhum conteúdo de conversa, de arquivo ou de segredo atravessa este contrato.

/**
 * Catálogo fechado de 100 espécies (D-670…): as 14 originais primeiro (arte "legada", preservada), depois as 86 do sistema de partes, por grupo.
 * Ids ASCII estáveis (nunca renomear: ficam gravados em `workspace_bichinho.especie`). Rótulos, grupos e afinidades: `nucleo/bichinho/catalogo.ts`.
 */
export const ESPECIES = [
  "caranguejo", "piton", "esquilo", "raposa", "camaleao", "lontra", "tucano", "elefante", "ourico", "coruja", "polvo", "gato", "sapo", "urso",
  // mamíferos
  "capivara", "lobo", "tigre", "leao", "pantera", "lince", "guepardo", "onca", "panda", "coala", "canguru", "preguica", "tamandua", "tatu", "anta", "suricato", "lemure",
  "macaco", "gorila", "cervo", "alce", "camelo", "lhama", "cavalo", "zebra", "girafa", "rinoceronte", "hipopotamo", "javali", "porco-espinho", "castor", "ornitorrinco",
  "vombate", "quokka", "morcego", "coelho", "ovelha", "guaxinim", "texugo", "bisao", "foca",
  // aves
  "arara", "pinguim", "falcao", "corvo", "pavao", "flamingo", "pato", "cisne", "pelicano", "beija-flor", "avestruz", "gaivota",
  // répteis
  "tartaruga", "jacare", "lagarto", "iguana", "komodo", "osga",
  // anfíbios
  "axolote", "salamandra", "perereca",
  // peixes e cetáceos
  "baleia", "golfinho", "tubarao", "arraia", "baiacu", "cavalo-marinho", "peixe-lua",
  // invertebrados
  "agua-viva", "estrela-do-mar", "lula", "lagosta", "nautilo", "caracol",
  // insetos e aracnídeos
  "abelha", "joaninha", "borboleta", "louva-a-deus", "escaravelho", "formiga", "libelula", "grilo", "vaga-lume", "aranha", "escorpiao",
] as const;
export type EspecieId = (typeof ESPECIES)[number];

export const GRUPOS_ESPECIE = ["mamiferos", "aves", "repteis", "anfibios", "aquaticos", "invertebrados", "insetos"] as const;
export type GrupoEspecie = (typeof GRUPOS_ESPECIE)[number];

/** As 14 espécies originais: a arte delas é a "legada" (desenho próprio), preservada para quem já tem esses bichinhos. */
export const ESPECIES_LEGADAS = ESPECIES.slice(0, 14) as ReadonlyArray<EspecieId>;

/** Variantes visuais (paleta rotacionada + marca) usadas quando as 100 espécies já estão em uso e uma delas se repete: 0 = original. */
export const VARIANTES_MAX = 4;

export const ESTAGIOS = ["ovo", "filhote", "jovem", "adulto", "veterano", "lendario"] as const;
export type EstagioId = (typeof ESTAGIOS)[number];

export const HUMORES = ["ocioso", "dormindo", "curioso", "trabalhando", "pensando", "aguardando", "comemorando", "preocupado"] as const;
export type HumorId = (typeof HUMORES)[number];

export const NIVEIS_ESFORCO = ["parado", "atento", "trabalhando", "acelerado", "frenético"] as const;
export type NivelEsforco = 0 | 1 | 2 | 3 | 4;
/** `medido` = tokens/min de leitor de transcript; `estimado` = vazão de saída do PTY; `estado` = só o estado do Pane; `nenhuma` = sem atividade. */
export type OrigemEsforco = "medido" | "estimado" | "estado" | "nenhuma";

/** Esforço atual do workspace (D-500…): só números agregados, nunca conteúdo. */
export interface EsforcoVisao {
  nivel: NivelEsforco;
  origem: OrigemEsforco;
  /** tokens/min na janela de 60 s quando há fonte medida; `null` caso contrário. */
  tokens_por_min: number | null;
  /** bytes/s de saída do PTY (todas as sessões do workspace, janela de ~4 s). */
  bytes_por_s: number;
  /** sessões com saída fluindo agora. */
  sessoes_fluindo: number;
}

export const TAMANHO_MAX_APELIDO = 24;

export interface ComponentesMaturidade {
  /** 0–100, escala logarítmica sobre tokens in+out acumulados. */
  tokens: number;
  /** 0–100, escala logarítmica sobre entradas de memória + chunks do RAG. */
  conhecimento: number;
}

export interface BichinhoVisao {
  workspace_id: string;
  /** espécie efetiva (manual vence a automática). */
  especie: EspecieId;
  especie_automatica: EspecieId;
  manual: boolean;
  /** linhas legíveis que explicam a escolha automática (PT-BR). */
  motivo: string[];
  apelido: string | null;
  estagio: EstagioId;
  /** 0–100 inteiro; nunca regride (guarda-se o máximo atingido). */
  maturidade: number;
  componentes: ComponentesMaturidade;
  tokens_total: number;
  conhecimento_itens: { memoria: number; chunks: number | null; total: number };
  humor: HumorId;
  /** consumo de cota ≥ 85%: sinal de saúde, mostrado junto de qualquer humor. */
  doente: boolean;
  esforco: EsforcoVisao;
  /** epoch ms da última atualização desta visão. */
  em: number;
  /** variante visual (0 = original): só passa de 0 quando as 100 espécies estão em uso e esta se repete. */
  variante?: number;
  /** progresso do ovo (D-671): `null` fora do ovo. Ausente em versões antigas do main. */
  ovo?: OvoVisao | null;
  /** aviso único de reatribuição por repetição (D-673): a espécie anterior; `null` quando não há (ou já foi dado). */
  reatribuido?: { de: EspecieId } | null;
}

/**
 * O ovo só nasce com ATIVIDADE REAL (D-671): `tarefas` concluídas (método, Missões e pipelines do Maestro, sem repetir id) E `tokens` acumulados.
 * `progresso` = min(tarefas/meta, tokens/piso), 0–100 inteiro; a 100% o bichinho nasce e nunca volta a ser ovo.
 */
export interface OvoVisao {
  tarefas: number;
  meta_tarefas: number;
  tokens: number;
  piso_tokens: number;
  progresso: number;
}

/** Uso das espécies pelos workspaces conhecidos (para o seletor marcar "já em uso em <workspace>"). */
export interface UsoEspecie {
  especie: EspecieId;
  workspace_id: string;
  workspace_nome: string;
}

export interface EventoBichinhoMudou {
  workspace_id: string;
  visao: BichinhoVisao;
  /** o estágio subiu agora: comemoração única + aviso discreto. */
  estagio_novo: boolean;
  /** o ovo acabou de chocar (D-671): animação de nascimento única e aviso "Seu bichinho nasceu". */
  nasceu?: boolean;
}
