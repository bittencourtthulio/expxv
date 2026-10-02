// Reexporta os contratos compartilhados que o núcleo usa e acrescenta o que só existe nele.
export type {
  Afirmacao, ArquivoPacote, Bloco, CanalDivulgacao, ConfigRelatorios, EnvioDivulgacao, EscopoRelatorio, EstadoPacote, FatosSprint, ModoRedacao, ModoExportacao, RevisaoPacote, Verificacao,
} from "../../compartilhado/relatorios";
export interface ExportacaoRegistro { id: string; pacote_id: string; modo: "pasta" | "zip"; destino: string; arquivos: string[]; bytes: number; em: string }
