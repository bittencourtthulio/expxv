// Templates do "Novo projeto" (D-604): pequenos, locais, sem rede e sem instalar dependência. Puros: devolvem arquivos RELATIVOS à pasta alvo.
import type { TemplateProjeto } from "../../../compartilhado/workspaces-adicionar";

export interface ArquivoTemplate {
  /** relativo, com `/`, sem `..` e sem raiz. */
  caminho: string;
  conteudo: string;
}

export interface OpcoesTemplate {
  nome: string;
  template: TemplateProjeto;
  readme: boolean;
  gitignore: boolean;
}

/** nome de pacote seguro (npm/pyproject): minúsculas, números, hífen. */
export function slugDoProjeto(nome: string): string {
  const s = nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return s === "" ? "projeto" : s;
}

// arquivos de ambiente ficam FORA do git (o app nunca os lê nem os escreve); o exemplo continua versionável
const GITIGNORE_BASE = [".DS_Store", "Thumbs.db", "*.log", ".env", ".env.*", "!.env.example"];
const GITIGNORE_POR_TEMPLATE: Record<TemplateProjeto, string[]> = {
  vazio: [],
  node: ["node_modules/", "dist/", "coverage/"],
  python: ["__pycache__/", "*.pyc", ".venv/", "dist/", "*.egg-info/"],
  docs: [],
};

export function gerarTemplate(op: OpcoesTemplate): ArquivoTemplate[] {
  const slug = slugDoProjeto(op.nome);
  const arquivos: ArquivoTemplate[] = [];
  const titulo = op.nome.replace(/[\r\n]+/g, " ").trim();
  if (op.template === "node") {
    arquivos.push({ caminho: "package.json", conteudo: `${JSON.stringify({ name: slug, version: "0.1.0", private: true, description: "", scripts: {} }, null, 2)}\n` });
  } else if (op.template === "python") {
    arquivos.push({ caminho: "pyproject.toml", conteudo: `[project]\nname = "${slug}"\nversion = "0.1.0"\ndescription = ""\nrequires-python = ">=3.9"\ndependencies = []\n` });
  } else if (op.template === "docs") {
    arquivos.push({ caminho: "docs/index.md", conteudo: `# ${titulo}\n\nDocumentação do projeto.\n` });
  }
  if (op.readme || op.template === "docs") arquivos.push({ caminho: "README.md", conteudo: `# ${titulo}\n` });
  if (op.gitignore) arquivos.push({ caminho: ".gitignore", conteudo: `${[...GITIGNORE_BASE, ...GITIGNORE_POR_TEMPLATE[op.template]].join("\n")}\n` });
  return arquivos;
}

/** Garante que um caminho de template é relativo, sem `..` e sem barra inicial. */
export function caminhoRelativoSeguro(c: string): boolean {
  return c !== "" && !c.startsWith("/") && !/^[A-Za-z]:/.test(c) && !c.includes("\\") && !c.includes("\0") && c.split("/").every((p) => p !== "" && p !== "." && p !== "..");
}
