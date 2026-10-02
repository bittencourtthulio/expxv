// Gerador do trecho `statusLine` das settings POR PANE do Claude (T-09.06). Junta-se aos demais `--settings` por
// `juntarSettingsDoClaude`. Nunca edita arquivo de configuração do usuário: só argv/ambiente do Pane.
import { variavelDeAmbiente } from "../produto";
import { caminhoStatusline } from "./adaptadores/claude-statusline";

/** Nome da variável de ambiente do Pane que aponta o arquivo de limites da conta. */
export const VARIAVEL_ARQUIVO_STATUSLINE = variavelDeAmbiente("LIMITES_ARQUIVO");
/** Chave de config do opt-out (`false` desliga). */
export const CONFIG_CLAUDE_STATUSLINE = "limites.claude_statusline";

const aspas = (c: string): string | null => (/["\n\r\0]/.test(c) ? null : `"${c}"`);

export interface OpcoesStatusline {
  /** caminho ABSOLUTO do `statusline-claude.mjs` (copiado para fora do asar). */
  script: string;
  /** executável do Node na máquina (padrão `node`). */
  node?: string;
}

/** `{statusLine:{type:"command",command}}`; caminho com aspas/quebra de linha → null (não monta comando inseguro). */
export function fragmentoStatusLine(o: OpcoesStatusline): { statusLine: { type: "command"; command: string } } | null {
  const node = aspas(o.node ?? "node");
  const script = aspas(o.script);
  if (node === null || script === null) return null;
  return { statusLine: { type: "command", command: `${node} ${script} ${VARIAVEL_ARQUIVO_STATUSLINE}` } };
}

/** Argv e ambiente do Pane; `null` se a conta ou o script não permitem (o Pane abre normalmente, sem statusline). */
export function statuslineDoPane(o: OpcoesStatusline & { pastaDeDados: string; contaId: string }): { argumentos: string[]; ambiente: Record<string, string> } | null {
  const frag = fragmentoStatusLine(o);
  const arquivo = caminhoStatusline(o.pastaDeDados, o.contaId);
  if (frag === null || arquivo === null) return null;
  return { argumentos: ["--settings", JSON.stringify(frag)], ambiente: { [VARIAVEL_ARQUIVO_STATUSLINE]: arquivo } };
}
