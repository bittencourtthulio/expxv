import { homedir } from "node:os";
import { LIMITES_TERMINAIS, type AtividadeTerminal, type DiagnosticoTerminais, type EstadoSessao } from "../../compartilhado/terminais";

export interface DadosDiagnostico {
  versao_app: string;
  versao_electron: string;
  versao_protocolo_daemon: number;
  so: string;
  arquitetura: string;
  persistente: boolean;
  ferramentas: ReadonlyArray<{ id: string; instalado: boolean; erro_codigo: string | null }>;
  sessoes: ReadonlyArray<{
    sessao_id: string;
    ferramenta_id: string;
    estado: EstadoSessao;
    atividade: AtividadeTerminal | null;
    pid: number;
    criada_em: number | null;
    quantidade_argumentos: number;
  }>;
}

/** Troca a pasta pessoal por `~` (nas duas grafias de separador). */
export function ocultarPastaPessoal(texto: string, casa: string = homedir()): string {
  if (casa.length < 2) return texto;
  return [casa, casa.replaceAll("\\", "/")].reduce((t, c) => t.split(c).join("~"), texto);
}

/**
 * Diagnóstico copiável: só metadados. Campo a campo, por construção: saída de terminal, ambiente,
 * argumentos (só a quantidade), token, porta e diretório de trabalho não têm caminho até aqui.
 */
export function montarDiagnostico(dados: DadosDiagnostico, casa: string = homedir()): Record<string, unknown> {
  const saida = {
    app: { versao: dados.versao_app, electron: dados.versao_electron, protocolo_daemon: dados.versao_protocolo_daemon },
    sistema: { so: dados.so, arquitetura: dados.arquitetura },
    sessoes_persistentes: dados.persistente,
    limites: { ...LIMITES_TERMINAIS },
    ferramentas: dados.ferramentas.map((f) => ({ id: f.id, instalado: f.instalado, erro_codigo: f.erro_codigo })),
    sessoes: dados.sessoes.map((s) => ({
      sessao_id: s.sessao_id,
      ferramenta_id: s.ferramenta_id,
      estado: s.estado,
      atividade: s.atividade,
      pid: s.pid,
      criada_em: s.criada_em,
      quantidade_argumentos: s.quantidade_argumentos,
    })),
  };
  return JSON.parse(ocultarPastaPessoal(JSON.stringify(saida), casa)) as Record<string, unknown>;
}

export function diagnosticoEmTexto(dados: DadosDiagnostico, casa: string = homedir()): DiagnosticoTerminais {
  return { texto: JSON.stringify(montarDiagnostico(dados, casa), null, 2) };
}
