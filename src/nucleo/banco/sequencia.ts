import type { Banco } from "./banco";

/**
 * Próximo valor de um contador persistido (começa em 1, nunca é reutilizado, mesmo se as linhas que
 * usaram os números forem apagadas). Use dentro da mesma `transacao` que grava a linha: o contador
 * é transacional. Ex.: `display_id` de pane com chave `pane:<workspace_id>`.
 */
export function proximoValor(banco: Banco, chave: string): number {
  const r = banco.consultarUm<{ valor: number }>(
    "INSERT INTO sequencia (chave, valor) VALUES (?, 1) ON CONFLICT(chave) DO UPDATE SET valor = valor + 1 RETURNING valor",
    [chave],
  );
  if (!r) throw new Error(`Falha ao avançar a sequência "${chave}".`);
  return Number(r.valor);
}
