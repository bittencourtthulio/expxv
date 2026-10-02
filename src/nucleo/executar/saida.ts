// Tradução do código de saída para texto de gente ("Build falhou: veja o painel Execução"). Pura.
import type { TipoExecucao } from "./modelo";

export interface Saida { codigo: number | null; sinal: number | null; parado_pelo_usuario: boolean }

const SINAIS: Record<number, string> = { 1: "SIGHUP", 2: "SIGINT", 3: "SIGQUIT", 6: "SIGABRT", 9: "SIGKILL", 11: "SIGSEGV", 15: "SIGTERM" };

export function traduzirSaida(tipo: TipoExecucao, s: Saida, nome: string): { resultado: "sucesso" | "falha" | "parada"; mensagem: string } {
  if (s.parado_pelo_usuario) return { resultado: "parada", mensagem: `${nome} foi parado.` };
  const sinal = s.sinal !== null && s.sinal > 0 ? s.sinal : s.codigo !== null && s.codigo > 128 && s.codigo < 160 ? s.codigo - 128 : null;
  if (s.codigo === 0 && sinal === null) {
    const m = tipo === "build" ? "Build concluído com sucesso." : tipo === "teste" ? "Testes passaram." : `${nome} terminou sem erros.`;
    return { resultado: "sucesso", mensagem: m };
  }
  if (s.codigo === 127) return { resultado: "falha", mensagem: "Comando não encontrado: confira se o programa está instalado e no PATH." };
  if (s.codigo === 126) return { resultado: "falha", mensagem: "Sem permissão para executar o comando." };
  if (sinal === 2) return { resultado: "falha", mensagem: `${nome} foi interrompido (Ctrl+C).` };
  if (sinal === 9) return { resultado: "falha", mensagem: `${nome} foi encerrado à força (SIGKILL; pode ter faltado memória).` };
  if (sinal === 15) return { resultado: "falha", mensagem: `${nome} foi encerrado (SIGTERM).` };
  if (sinal === 11) return { resultado: "falha", mensagem: `${nome} travou (falha de segmentação).` };
  if (sinal !== null) return { resultado: "falha", mensagem: `${nome} foi encerrado pelo sinal ${SINAIS[sinal] ?? sinal}.` };
  const cod = s.codigo === null ? "sem código" : `código ${s.codigo}`;
  if (tipo === "build") return { resultado: "falha", mensagem: `Build falhou (${cod}): veja o painel Execução.` };
  if (tipo === "teste") return { resultado: "falha", mensagem: `Testes falharam (${cod}): veja o painel Execução.` };
  return { resultado: "falha", mensagem: `${nome} saiu com ${cod}: veja o painel Execução.` };
}

export function formatarDuracao(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}
