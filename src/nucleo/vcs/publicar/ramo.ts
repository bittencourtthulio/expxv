// Nome de branch (D-632): validação ESTRITA antes de entrar numa instrução. Branch e título vêm da UI/do repositório e são DADOS: nunca viram opção
// (`-x`), nunca contêm `..`, espaço, aspas, `$`, crase etc. A regra do pedido: `^[A-Za-z0-9._/-]{1,100}$`, sem `..`, sem `-` inicial.
import { REGEX_RAMO_PUBLICAR } from "../../../compartilhado/vcs-publicar";

export type ResultadoNome = { ok: true; nome: string } | { ok: false; motivo: string };

export function validarNomeRamo(entrada: unknown): ResultadoNome {
  if (typeof entrada !== "string") return { ok: false, motivo: "Nome de branch inválido." };
  const n = entrada;
  if (!REGEX_RAMO_PUBLICAR.test(n)) return { ok: false, motivo: "Use só letras, números, ponto, hífen, sublinhado e barra (até 100 caracteres)." };
  if (n.includes("..")) return { ok: false, motivo: "O nome não pode conter '..'." };
  if (n.startsWith("-")) return { ok: false, motivo: "O nome não pode começar com '-'." };
  if (n.startsWith("/") || n.endsWith("/") || n.includes("//")) return { ok: false, motivo: "Barras no começo, no fim ou duplicadas não são aceitas." };
  if (n.endsWith(".") || n.endsWith(".lock") || n.split("/").some((p) => p.startsWith("."))) return { ok: false, motivo: "Partes do nome não podem começar com '.' nem terminar com '.lock' ou '.'." };
  if (n === "HEAD" || n === "@") return { ok: false, motivo: "Nome reservado." };
  return { ok: true, nome: n };
}

/** Branches que o app trata como padrão: o do repositório mais os nomes clássicos (D-36: nunca commit/push direto sem confirmação digitada). */
export const RAMOS_PADRAO_CLASSICOS: readonly string[] = ["main", "master", "develop"];
export function ehRamoPadrao(ramo: string | null, padrao: string | null): boolean {
  if (ramo === null) return false;
  return ramo === padrao || RAMOS_PADRAO_CLASSICOS.includes(ramo);
}

/** Frase exata que o dono digita, em diálogo à parte, para confirmar push no branch padrão. */
export const frasePushNoPadrao = (ramo: string): string => `push na ${ramo}`;

const DOCS_E_CONFIG = /(^|\/)(docs?|\.github|\.vscode|\.husky)\/|\.(md|txt|json|ya?ml|toml|lock|config\.[a-z]+)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.gitignore|\.editorconfig|LICENSE)$/i;

function fatiar(texto: string): string {
  return texto
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
}

/** Sugestão segura e editável: `feat/<resumo-curto>` ou `chore/<resumo>` (só docs/config). Determinística; o dono pode trocar. */
export function sugerirNomeRamo(caminhos: readonly string[], hoje: Date = new Date()): string {
  const lista = caminhos.filter((c) => c !== "");
  const prefixo = lista.length > 0 && lista.every((c) => DOCS_E_CONFIG.test(c)) ? "chore" : "feat";
  const contagem = new Map<string, number>();
  for (const c of lista) {
    const partes = c.split("/");
    const chave = partes.length > 1 ? (partes[0] === "src" && partes.length > 2 ? (partes[1] ?? "") : (partes[0] ?? "")) : (partes[0] ?? "").replace(/\.[^.]+$/, "");
    const s = fatiar(chave);
    if (s !== "") contagem.set(s, (contagem.get(s) ?? 0) + 1);
  }
  const melhor = [...contagem.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const dia = `${String(hoje.getMonth() + 1).padStart(2, "0")}${String(hoje.getDate()).padStart(2, "0")}`;
  const nome = `${prefixo}/${melhor ?? "alteracoes"}-${dia}`;
  return validarNomeRamo(nome).ok ? nome : `${prefixo}/alteracoes-${dia}`;
}
