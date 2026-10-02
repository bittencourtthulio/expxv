// Gateway MCP (Fase 7C): tipos do núcleo (sem Electron, sem rede, sem listener). O gateway NÃO escuta: o endpoint `POST /gateway` vive no servidor loopback
// do app (`nucleo/mcp/servidor.ts`, D-370); este módulo só agrega servidores já habilitados pela Loja e decide o que o Pane enxerga.
import type { ConfigGateway, DecisaoAuditoriaGateway, ModoSuperficieGateway, PapelGateway } from "../../compartilhado/catalogo";

export type { ConfigGateway, DecisaoAuditoriaGateway, ModoSuperficieGateway, PapelGateway };
export type ModoMissaoGw = "livre" | "squad" | "agentico";

/** Uma ferramenta de um servidor de terceiro, já lida por `tools/list` (dado de terceiro: nunca instrução). */
export interface FerramentaRemota {
  nome: string;
  descricao: string | null;
  esquema: Record<string, unknown>;
  /** `annotations.readOnlyHint` quando o servidor declara */
  somente_leitura: boolean | null;
  /** `annotations.destructiveHint` quando o servidor declara */
  destrutiva: boolean | null;
}

export interface ConteudoTexto { type: "text"; text: string }
export interface ResultadoFerramenta { content: ConteudoTexto[]; isError: boolean }

/** Conexão com UM servidor da Loja (stdio ou remoto). Quem a cria resolve segredos: o Pane nunca os vê. */
export interface ClienteServidor {
  listarFerramentas(): Promise<FerramentaRemota[]>;
  chamar(nome: string, args: Record<string, unknown>, limiteMs: number): Promise<ResultadoFerramenta>;
  fechar(): Promise<void>;
}
export type Conectar = (servidorId: string, contexto: { raiz: string | null }) => Promise<ClienteServidor>;

/** Retrato do Pane que o gateway serve (gravado no lançamento; persistido para sobreviver a restart: R-3). Só ids/papel/modo; nunca segredo nem token. */
export interface SnapshotGateway {
  pane_id: string;
  workspace_id: string;
  mission_id: string | null;
  agente_id: string | null;
  papel: PapelGateway;
  modo: ModoMissaoGw;
  /** ids de servidores da Loja já resolvidos pela política de habilitação (teto) */
  servidores: string[];
  /** raiz onde o Pane trabalha (`{{WORKSPACE}}` dos servidores) */
  raiz: string | null;
}

export interface RegraFiltro { servidor_id: string; ferramenta: string; papel: PapelGateway; habilitada: boolean }

export interface FerramentaExposta {
  /** nome visto pelo Pane (`<servidor>__<ferramenta>`, alfabeto do protocolo, ≤ 64) */
  nome: string;
  servidor_id: string;
  ferramenta: string;
  descricao: string;
  esquema: Record<string, unknown>;
  risco: "leitura" | "escrita" | "desconhecido";
}

export interface EntradaAuditoria {
  workspace_id: string;
  pane_id: string;
  papel: string;
  servidor_id: string | null;
  ferramenta: string | null;
  decisao: DecisaoAuditoriaGateway;
  duracao_ms: number | null;
  bytes_entrada: number | null;
  bytes_saida: number | null;
}
