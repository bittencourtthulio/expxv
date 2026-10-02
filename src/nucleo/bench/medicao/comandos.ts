// Lista FECHADA de comandos que uma checagem `command_exit_zero` pode executar (sempre no sandbox e no workdir). Argv separado, nunca shell: `node --test` vira ["node","--test"].
// Nada de operador de shell, caminho ou variável: o texto precisa casar EXATAMENTE com uma entrada.
export const COMANDOS_PERMITIDOS: readonly (readonly string[])[] = [
  ["node", "--test"],
  ["node", "--check", "index.js"],
  ["node", "--check", "main.js"],
  ["node", "--check", "script.js"],
  ["node", "--check", "app.js"],
];

export function comandoPermitido(texto: string): string[] | null {
  const partes = texto.trim().split(/\s+/);
  for (const c of COMANDOS_PERMITIDOS) if (c.length === partes.length && c.every((x, i) => x === partes[i])) return [...c];
  return null;
}
