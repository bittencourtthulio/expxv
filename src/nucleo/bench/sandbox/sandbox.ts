// Sandbox do Bench (T-12.06). `always-approve` SÓ roda dentro de sandbox, em diretório descartável. Sem sandbox utilizável a Run é RECUSADA, não degradada. O mecanismo fica atrás desta interface
// (o `sandbox-exec` do macOS é obsoleto: se parar de funcionar, `disponivel()` falha e a Run é recusada). Windows (P-38): sem sandbox, só com consentimento REFORÇADO digitado.
import type { ModoSandbox } from "../tipos";

export interface PoliticaSandbox {
  /** única pasta de escrita do trabalho (já `realpath`). */
  workdir: string;
  /** pastas extras com escrita (tmp da Run, HOME e config da conta dedicada). */
  escrita: readonly string[];
  /** caminhos ABSOLUTOS com leitura negada (credenciais, perfis de navegador, dados do app). */
  leitura_negada: readonly string[];
  /** caminhos reabertos para leitura depois da negação (ex.: a conta dedicada dentro de `userData`). */
  leitura_liberada?: readonly string[];
  /** modo do juiz: nada é gravável (só tmp). */
  somente_leitura?: boolean;
}
export interface ComandoEnvolvido { executavel: string; args: string[]; limpar(): void }

export interface Sandbox {
  /** `nenhum` = sem sandbox (Windows, consentimento reforçado); `nativo_cli` = a própria CLI isola (Codex). */
  readonly modo: ModoSandbox | "indisponivel";
  /** teste de sanidade REAL (roda um comando trivial dentro do sandbox). */
  disponivel(): Promise<boolean>;
  envolver(executavel: string, args: readonly string[], politica: PoliticaSandbox): ComandoEnvolvido;
}

/** CLI com sandbox próprio (Codex em workspace-write): nada a envolver (aninhar `sandbox-exec` falharia). */
export function criarSandboxNativo(): Sandbox {
  return { modo: "nativo_cli", disponivel: async () => true, envolver: (executavel, args) => ({ executavel, args: [...args], limpar: () => undefined }) };
}

/** Windows: sem sandbox. Só usável com a frase reforçada; a Run é marcada `isolamento: parcial`. */
export function criarSandboxNenhum(): Sandbox {
  return { modo: "nenhum", disponivel: async () => true, envolver: (executavel, args) => ({ executavel, args: [...args], limpar: () => undefined }) };
}

export function criarSandboxIndisponivel(): Sandbox {
  return { modo: "indisponivel", disponivel: async () => false, envolver: () => { throw new Error("sandbox indisponível"); } };
}
