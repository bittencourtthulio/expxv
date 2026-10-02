// Duas chaves de ligação (Fase 21, T-21.16, D-342): chave de BUILD (`build/distribuicao.json` → `atualizacao.habilitada`) e chave de EXECUÇÃO
// (preferência `ligada` + consentimento versionado). Sem as duas, o módulo do atualizador NUNCA é importado: 0 sockets, 0 timers (AU-12).
import { CONSENTIMENTO_ATUALIZACAO_VERSAO, type ConfigAtualizacao, type MotivoAtualizacao } from "../../compartilhado/atualizacao";

export interface EntradaGate {
  habilitadaNoBuild: boolean;
  config: Pick<ConfigAtualizacao, "ligada" | "consentimento_versao">;
}
export type ResultadoGate = { carregar: true } | { carregar: false; motivo: Extract<MotivoAtualizacao, "desligado" | "sem_consentimento"> };

export function decidirCarregamento(e: EntradaGate): ResultadoGate {
  if (!e.habilitadaNoBuild) return { carregar: false, motivo: "desligado" };
  if (!e.config.ligada) return { carregar: false, motivo: "desligado" };
  if (e.config.consentimento_versao !== CONSENTIMENTO_ATUALIZACAO_VERSAO) return { carregar: false, motivo: "sem_consentimento" };
  return { carregar: true };
}

/** Só chama `importar` (o `import()` dinâmico do módulo do atualizador) se as duas chaves estiverem ligadas. */
export async function carregarSePermitido<T>(e: EntradaGate, importar: () => Promise<T>): Promise<{ carregado: true; modulo: T } | { carregado: false; motivo: "desligado" | "sem_consentimento" }> {
  const d = decidirCarregamento(e);
  if (!d.carregar) return { carregado: false, motivo: d.motivo };
  return { carregado: true, modulo: await importar() };
}
