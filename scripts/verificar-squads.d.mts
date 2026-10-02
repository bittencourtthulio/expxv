export interface ResultadoVerificacaoSquads {
  ok: boolean;
  erros: string[];
  resumo: { squads: number; membros: number; versao_pacote?: number | null };
}
export function verificarSquads(opcoes?: { raiz?: string; gerar?: boolean }): Promise<ResultadoVerificacaoSquads>;
