// Tipos do mapa lógico do código (Fase 17, T-17.01). Puro: sem Electron, sem I/O.
// O mapa guarda NOMES, assinaturas sanitizadas, `arquivo:linha` e a 1ª linha de comentário redigida
// (D-163, P-277). Nunca o código-fonte.

/** Versão do formato do armazém (`PRAGMA user_version`). Cresce quando o DDL muda de forma incompatível. */
export const SCHEMA_VERSION = 1;
/** Versão do extrator: mudar invalida só as extrações antigas (coluna `extracao.versao_extrator`). */
export const VERSAO_EXTRATOR = 1;

export const LINGUAGENS = ["typescript", "javascript", "tsx", "jsx", "python", "java", "php", "csharp", "go", "ruby", "rust", "c", "cpp", "outra"] as const;
export type Linguagem = (typeof LINGUAGENS)[number];

/** D-164: `exata` = resolvida por regra da linguagem/manifesto; `heuristica` = por nome, convenção ou candidatos. */
export const CONFIANCAS = ["exata", "heuristica"] as const;
export type Confianca = (typeof CONFIANCAS)[number];

// ---------------------------------------------------------------------------------------------
// Nós e arestas do grafo (§4.1 e §4.2 do plano)

export const TIPOS_NO = ["arquivo", "modulo", "simbolo", "entrada", "tabela", "externo"] as const;
export type TipoNo = (typeof TIPOS_NO)[number];

export const SUBTIPOS_SIMBOLO = ["funcao", "classe", "metodo", "interface", "enum", "tipo", "constante", "struct", "trait"] as const;
export type SubtipoSimbolo = (typeof SUBTIPOS_SIMBOLO)[number];

export const SUBTIPOS_ENTRADA = ["main", "rota", "cli", "job", "handler", "fila", "webhook", "evento"] as const;
export type SubtipoEntrada = (typeof SUBTIPOS_ENTRADA)[number];

export const SUBTIPOS_EXTERNO = ["npm", "pip", "composer", "maven", "nuget", "go", "cargo", "gem", "sistema", "stdlib", "builtin"] as const;
export type SubtipoExterno = (typeof SUBTIPOS_EXTERNO)[number];

export const TIPOS_ARESTA = ["importa", "reexporta", "chama", "instancia", "herda", "implementa", "referencia", "aciona", "le_tabela", "escreve_tabela", "testa"] as const;
export type TipoAresta = (typeof TIPOS_ARESTA)[number];

export type FonteAresta = "extracao" | "scip" | "regra";

export interface No {
  /** `arq:<caminho>` · `mod:<pasta>` · `sim:<caminho>#<qualificado>` · `ent:<caminho>#<chave>` · `tab:<nome>` · `ext:<eco>:<nome>`. */
  id: string;
  tipo: TipoNo;
  subtipo: string | null;
  rotulo: string;
  arquivo_id: number | null;
  linha_ini: number | null;
  linha_fim: number | null;
  exportado: boolean | null;
  /** Atributos livres (JSON). Nunca código-fonte. */
  atributos: Record<string, unknown> | null;
}

export interface Aresta {
  id?: number;
  tipo: TipoAresta;
  de: string;
  para: string;
  confianca: Confianca;
  peso: number;
  /** Número de candidatos quando a resolução foi por nome (≤ 5). */
  candidatos: number | null;
  fonte: FonteAresta;
  arquivo_id: number | null;
  linha: number | null;
  /** Até 5 evidências `arquivo:linha`. */
  evidencias: string[] | null;
}

export const MAX_EVIDENCIAS = 5;
export const MAX_CANDIDATOS = 5;

// ---------------------------------------------------------------------------------------------
// Extração por arquivo (saída do extrator de cada linguagem; cada `*Bruto` carrega `linha`)

export const VISIBILIDADES = ["publica", "privada", "protegida", "pacote"] as const;
export type Visibilidade = (typeof VISIBILIDADES)[number];

export interface SimboloBruto {
  nome: string;
  /** Nome qualificado, único dentro do arquivo (duplicata ganha `~2`, `~3`…). */
  qualificado: string;
  tipo: SubtipoSimbolo;
  linha: number;
  linha_fim: number;
  exportado: boolean;
  visibilidade: Visibilidade | null;
  complexidade: number;
  /** Assinatura sanitizada: literais de texto viram `"…"`. */
  assinatura: string;
  /** 1ª linha do comentário de documentação (≤ 160 caracteres, redigida). */
  doc: string | null;
  decoradores: string[];
}

export const TIPOS_IMPORT = ["estatico", "dinamico", "require", "reexport"] as const;
export type TipoImport = (typeof TIPOS_IMPORT)[number];

export interface NomeImportado {
  /** Nome exportado pelo módulo; `default` e `*` são valores reservados. */
  nome: string;
  alias: string | null;
}

export interface ImportBruto {
  /** Especificador como escrito (`./a`, `react`, `os.path`). */
  especificador: string;
  tipo: TipoImport;
  linha: number;
  /** `import type` (sem efeito em tempo de execução). */
  so_tipo: boolean;
  nomes: NomeImportado[];
}

export const TIPOS_CHAMADA = ["chamada", "instancia", "referencia"] as const;
export type TipoChamada = (typeof TIPOS_CHAMADA)[number];

export interface ChamadaBruta {
  /** Qualificado do símbolo contenedor; `null` = topo do arquivo. */
  de: string | null;
  alvo: string;
  /** Texto simples do receptor (`this`, `a.b`), quando houver. */
  receptor: string | null;
  tipo: TipoChamada;
  linha: number;
}

export interface HerancaBruta {
  classe: string;
  base: string;
  tipo: "herda" | "implementa";
  linha: number;
}

export interface EntradaBruta {
  tipo: SubtipoEntrada;
  /** Ex.: `GET /users/:id`, `ipc:canal`, `cron:* * * * *`. */
  chave: string;
  framework: string;
  /** Qualificado do símbolo-handler no mesmo arquivo, ou nome simples a resolver depois; `null` = função inline. */
  handler: string | null;
  linha: number;
  confianca: Confianca;
}

export const OPERACOES_DADO = ["le", "escreve", "define", "desconhecida"] as const;
export type OperacaoDado = (typeof OPERACOES_DADO)[number];

export interface AcessoDadoBruto {
  tabela: string;
  operacao: OperacaoDado;
  de: string | null;
  linha: number;
  confianca: Confianca;
  /** `sql`, `prisma`, `typeorm`, `sequelize`, `mongoose`, `knex`… */
  fonte: string;
}

export const TIPOS_PADRAO = ["throw", "catch_vazio", "env"] as const;
export type TipoPadrao = (typeof TIPOS_PADRAO)[number];

export interface PadraoBruto {
  tipo: TipoPadrao;
  /** Só o NOME da variável de ambiente; nunca o valor. */
  nome: string | null;
  linha: number;
}

export const TIPOS_DINAMICO = ["eval", "new_function", "require_dinamico", "import_dinamico", "chamada_computada", "reflexao"] as const;
export type TipoDinamico = (typeof TIPOS_DINAMICO)[number];

export interface DinamicoBruto {
  tipo: TipoDinamico;
  linha: number;
}

export interface Extracao {
  versao_extrator: number;
  linguagem: Linguagem;
  hash: string;
  loc: number;
  loc_codigo: number;
  loc_comentario: number;
  complexidade_total: number;
  complexidade_max: number;
  erros_parse: number;
  e_teste: boolean;
  e_gerado: boolean;
  /** `true` quando passou do teto de símbolos (5 000) e a lista foi cortada. */
  truncado: boolean;
  simbolos: SimboloBruto[];
  imports: ImportBruto[];
  chamadas: ChamadaBruta[];
  herancas: HerancaBruta[];
  entradas: EntradaBruta[];
  dados: AcessoDadoBruto[];
  padroes: PadraoBruto[];
  dinamicos: DinamicoBruto[];
  shingles?: Array<[number, number]>;
}

// ---------------------------------------------------------------------------------------------
// Raio de impacto provisório e limiares (§7.3; fiel ao `02-raio-de-impacto.md` do legadox)

export type FaixaRaio = "BAIXO" | "MEDIO" | "ALTO";

export interface Limiares {
  /** BAIXO até este número de chamadores (arquivos distintos). */
  chamadores_baixo_max: number;
  /** MEDIO até este número; acima é ALTO. */
  chamadores_medio_max: number;
}

/** Limiares padrão do legadox: BAIXO ≤ 3 chamadores; MEDIO 4–15; ALTO > 15. */
export const limiaresPadrao: Readonly<Limiares> = Object.freeze({ chamadores_baixo_max: 3, chamadores_medio_max: 15 });

export interface SinalRaio {
  id: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  nome: string;
  /** Valor mínimo (só arestas exatas) e máximo (com heurísticas) quando numérico. */
  min: number | null;
  max: number | null;
  /** Descrição curta do achado (sem código). */
  valor: string;
  metodo: string;
  pior_caso: boolean;
}

export interface RaioProvisorio {
  arquivos: string[];
  sinais: SinalRaio[];
  faixa: FaixaRaio;
  faixa_pior_caso: FaixaRaio;
  pior_caso: Array<{ sinal: number; motivo: string }>;
  candidatos_costura: string[];
  nota: string;
}

export const NOTA_RAIO = "provisório — quem classifica é o avaliador-de-raio do legadox; aprovação ALTO é humana";
