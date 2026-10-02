import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

// Detecção (somente PRESENÇA) de ferramentas externas opcionais (T-17.37): ctags, scc, dot. Procura SÓ nos diretórios do PATH do
// sistema e em locais padrão; NUNCA em `node_modules/.bin` nem em pastas do projeto analisado. Não executa nada (a versão por
// `--version` só será pedida quando um adaptador for realmente usado). Sem as ferramentas, toda a fase funciona.

export interface FerramentasMapa {
  ctags: boolean;
  scc: boolean;
  dot: boolean;
}

const LOCAIS_PADRAO = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
const NOMES: Record<keyof FerramentasMapa, readonly string[]> = { ctags: ["ctags", "universal-ctags"], scc: ["scc"], dot: ["dot"] };

function executavel(caminho: string): boolean {
  try {
    if (!statSync(caminho).isFile()) return false;
    accessSync(caminho, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function detectarFerramentas(env: NodeJS.ProcessEnv = process.env, extras: readonly string[] = LOCAIS_PADRAO): FerramentasMapa {
  const pastas = [...(env["PATH"] ?? "").split(delimiter), ...extras].filter((p) => p !== "" && !/(^|[\\/])node_modules([\\/]|$)/.test(p));
  const achar = (nomes: readonly string[]): boolean => {
    for (const p of pastas) for (const n of nomes) if (executavel(join(p, n)) || executavel(join(p, `${n}.exe`))) return true;
    return false;
  };
  return { ctags: achar(NOMES.ctags), scc: achar(NOMES.scc), dot: achar(NOMES.dot) };
}
