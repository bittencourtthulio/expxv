// Regra de consulta obrigatória (DEC-4 d, P-53): pura, para o coordenador ligar em `orquestracao/regras.ts`. A camada (b) (injeção)
// registra a consulta, então o bloqueio só dispara se a injeção estiver desligada E o agente não chamou a tool. RAG desligado/fora
// nunca bloqueia; `aviso` é o padrão.
export type ModoConsultaObrigatoria = "off" | "aviso" | "bloqueio";
export type VereditoConsulta = { acao: "permitir" } | { acao: "avisar"; codigo: "rag_consult_required" } | { acao: "bloquear"; codigo: "rag_consult_required" };

export const JANELA_CONSULTA_MS = 30 * 60 * 1000;

export function avaliarConsultaObrigatoria(e: { modo: ModoConsultaObrigatoria; ragAtivo: boolean; ragDisponivel: boolean; consultouNaJanela: boolean; injecaoLigada: boolean; papel: string }): VereditoConsulta {
  if (e.modo === "off" || !e.ragAtivo || !e.ragDisponivel) return { acao: "permitir" };
  if (e.papel !== "executor" && e.papel !== "explorador") return { acao: "permitir" };
  if (e.consultouNaJanela) return { acao: "permitir" };
  if (e.modo === "bloqueio" && !e.injecaoLigada) return { acao: "bloquear", codigo: "rag_consult_required" };
  return { acao: "avisar", codigo: "rag_consult_required" };
}
