// D-570: rolagem de cada terminal (linhas acima do fim) guardada quando o xterm é desmontado (workspace oculto, aba trocada) e devolvida quando ele volta. Só números, em memória, limitada.
export const rolagemSalva = new Map<string, number>();
const MAXIMO = 256;

export function guardarRolagem(sessaoId: string, linhasAcimaDoFim: number): void {
  if (!(linhasAcimaDoFim > 0)) { rolagemSalva.delete(sessaoId); return; }
  rolagemSalva.delete(sessaoId);
  rolagemSalva.set(sessaoId, Math.round(linhasAcimaDoFim));
  while (rolagemSalva.size > MAXIMO) rolagemSalva.delete(rolagemSalva.keys().next().value as string);
}
