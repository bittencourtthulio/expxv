import type { FerramentaDetectada } from "../../../compartilhado/terminais";

export const INSTALACAO: Record<string, string> = {
  claude: "npm install -g @anthropic-ai/claude-code",
  codex: "npm install -g @openai/codex",
  gemini: "npm install -g @google/gemini-cli",
  opencode: "npm install -g opencode-ai",
  aider: "python -m pip install aider-chat",
  qwen: "npm install -g @qwen-code/qwen-code",
  kilo: "npm install -g @kilocode/cli",
};

export function estadoDaFerramenta(f: FerramentaDetectada): { texto: string; tom: "sucesso" | "aviso" | "alerta" | "neutro" } {
  if (f.instalado) return { texto: "Instalada", tom: "sucesso" };
  if (f.erro_codigo === "sem_permissao") return { texto: "Sem permissão", tom: "alerta" };
  if (f.erro_codigo === "nao_mapeado") return { texto: "Não mapeada", tom: "aviso" };
  return { texto: "Ausente", tom: "neutro" };
}

export function instrucao(f: FerramentaDetectada): string | null {
  if (f.instalado) return null;
  if (f.erro_codigo === "sem_permissao") return "O arquivo foi encontrado, mas o app não pode executá-lo. Ajuste a permissão de execução (por exemplo: chmod +x) e atualize.";
  if (f.erro_codigo === "nao_mapeado") return "Um executável foi encontrado, mas o app não sabe como abri-lo com segurança. Atualize o app ou escolha outro executável.";
  const cmd = INSTALACAO[f.id];
  return cmd === undefined ? "Instale a CLI e clique em Atualizar." : `Para instalar: ${cmd} — depois clique em Atualizar.`;
}
