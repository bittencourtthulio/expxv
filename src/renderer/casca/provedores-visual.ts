// Mapeamento ÚNICO provedor → nome, logo e ordem, e modelo → rótulo legível (Fase 9, consumo por provedor/modelo).
// Puro, sem React e sem I/O. Regra: nunca inventar nome — o que não é reconhecido aparece como o id curto.

export type LogoId = "claude" | "openai" | "gemini" | "xai" | "opencode" | "qwen" | "kilo" | "aider" | "openrouter";

export interface InfoProvedor {
  /** id canônico (`claude`, `codex`…); o desconhecido mantém o id recebido. */
  id: string;
  nome: string;
  /** Posição estável na lista (menor primeiro); desconhecidos vão ao fim, por nome. */
  ordem: number;
  /** `null` = sem logo: a UI usa as iniciais. */
  logo: LogoId | null;
  conhecido: boolean;
  /** 1–2 letras para o fallback. */
  iniciais: string;
}

const PROVEDORES: ReadonlyArray<{ id: string; nome: string; logo: LogoId; aliases: readonly string[] }> = [
  { id: "claude", nome: "Claude", logo: "claude", aliases: ["anthropic", "claude-code"] },
  { id: "codex", nome: "Codex", logo: "openai", aliases: ["openai"] },
  { id: "gemini", nome: "Gemini", logo: "gemini", aliases: ["google"] },
  { id: "grok", nome: "Grok", logo: "xai", aliases: ["xai"] },
  { id: "opencode", nome: "OpenCode", logo: "opencode", aliases: [] },
  { id: "qwen", nome: "Qwen", logo: "qwen", aliases: [] },
  { id: "kilo", nome: "Kilo", logo: "kilo", aliases: ["kilocode"] },
  { id: "aider", nome: "Aider", logo: "aider", aliases: [] },
  { id: "openrouter", nome: "OpenRouter", logo: "openrouter", aliases: [] },
];

const POR_ID = new Map<string, number>();
PROVEDORES.forEach((p, i) => { POR_ID.set(p.id, i); for (const a of p.aliases) POR_ID.set(a, i); });
/** Ordem dos desconhecidos: depois de todos os conhecidos. */
export const ORDEM_DESCONHECIDO = PROVEDORES.length;

const maiuscula = (s: string): string => (s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1));

export function infoProvedor(id: string | null | undefined): InfoProvedor {
  const bruto = typeof id === "string" ? id.trim() : "";
  const i = POR_ID.get(bruto.toLowerCase());
  if (i !== undefined) {
    const p = PROVEDORES[i]!;
    return { id: p.id, nome: p.nome, ordem: i, logo: p.logo, conhecido: true, iniciais: p.nome.slice(0, 2) };
  }
  const nome = bruto === "" ? "Provedor" : maiuscula(bruto.slice(0, 24));
  return { id: bruto, nome, ordem: ORDEM_DESCONHECIDO, logo: null, conhecido: false, iniciais: (bruto.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "?").toUpperCase() };
}

/** Agrupa por provedor na ordem visual (conhecidos pela ordem fixa; desconhecidos por nome); preserva a ordem interna. */
export function agruparPorProvedor<T extends { provider: string }>(itens: readonly T[]): Array<{ provedor: InfoProvedor; itens: T[] }> {
  const mapa = new Map<string, { provedor: InfoProvedor; itens: T[] }>();
  for (const it of itens) {
    const info = infoProvedor(it.provider);
    const g = mapa.get(info.id);
    if (g === undefined) mapa.set(info.id, { provedor: info, itens: [it] }); else g.itens.push(it);
  }
  return [...mapa.values()].sort((a, b) => a.provedor.ordem - b.provedor.ordem || a.provedor.nome.localeCompare(b.provedor.nome, "pt-BR"));
}

// ---- modelos ----
const FAMILIAS_CLAUDE = ["opus", "sonnet", "haiku"] as const;
const SUFIXO_DATA = /-(?:20\d{6}|\d{4}-\d{2}-\d{2})$/;
const versao = (partes: readonly string[]): string => partes.join(".");

function curto(id: string): string {
  return id.length <= 28 ? id : `${id.slice(0, 27)}…`;
}

/** `claude-opus-4-1-20250805` → "Opus 4.1"; `gpt-5-codex` → "GPT-5 Codex"; desconhecido → id curto (nunca um nome inventado). */
export function rotuloModelo(modelo: string | null | undefined): string {
  const bruto = typeof modelo === "string" ? modelo.trim() : "";
  if (bruto === "") return "modelo desconhecido";
  // OpenRouter: `anthropic/claude-sonnet-4.5` → rótulo do modelo, sem o fornecedor
  const semFornecedor = bruto.includes("/") ? bruto.slice(bruto.lastIndexOf("/") + 1) : bruto;
  const id = semFornecedor.toLowerCase().replace(SUFIXO_DATA, "").replace(/:(free|beta|thinking|online|nitro|extended)$/, "");

  // Claude: família isolada ("opus") ou id completo em qualquer ordem (claude-opus-4-1 / claude-3-5-haiku)
  if ((FAMILIAS_CLAUDE as readonly string[]).includes(id)) return maiuscula(id);
  const fam = FAMILIAS_CLAUDE.find((f) => id.includes(f));
  if (fam !== undefined && (id.startsWith("claude") || id.startsWith(fam))) {
    const nums = (id.match(/\d+(?:\.\d+)?/g) ?? []).flatMap((n) => n.split(".")).slice(0, 2);
    return nums.length === 0 ? maiuscula(fam) : `${maiuscula(fam)} ${versao(nums)}`;
  }
  // OpenAI / Codex
  let m = /^gpt-(\d+(?:\.\d+)?)(?:-(.+))?$/.exec(id);
  if (m !== null) {
    const resto = (m[2] ?? "").split("-").filter(Boolean).map((p) => (p === "codex" || p === "mini" || p === "nano" || p === "pro" ? maiuscula(p) : p)).join(" ");
    return `GPT-${m[1]}${resto ? ` ${resto}` : ""}`;
  }
  m = /^(o\d)(?:-(mini|pro))?$/.exec(id);
  if (m !== null) return `${m[1]}${m[2] ? ` ${m[2]}` : ""}`;
  // Gemini
  m = /^gemini-(\d+(?:\.\d+)?)-(.+)$/.exec(id);
  if (m !== null) return `Gemini ${m[1]} ${m[2]!.split("-").map(maiuscula).join(" ")}`;
  // Grok
  m = /^grok-?(\d+(?:\.\d+)?)(?:-(.+))?$/.exec(id);
  if (m !== null) return `Grok ${m[1]}${m[2] ? ` ${m[2]!.split("-").map(maiuscula).join(" ")}` : ""}`;
  m = /^grok-code(?:-(.+))?$/.exec(id);
  if (m !== null) return `Grok Code${m[1] ? ` ${m[1].split("-").map(maiuscula).join(" ")}` : ""}`;
  // Qwen
  m = /^qwen(\d*(?:\.\d+)?)(?:-(.+))?$/.exec(id);
  if (m !== null && (m[1] !== "" || m[2] !== undefined)) return `Qwen${m[1]}${m[2] ? ` ${m[2]!.split("-").map(maiuscula).join(" ")}` : ""}`;
  return curto(semFornecedor);
}

/** Chave estável de ordenação de baldes: maior uso primeiro; sem dado por último; empate por rótulo. */
export function ordenarBaldes<T extends { used_pct: number | null; nome: string }>(baldes: readonly T[]): T[] {
  return [...baldes].sort((a, b) => {
    const pa = a.used_pct ?? -1;
    const pb = b.used_pct ?? -1;
    return pb - pa || rotuloModelo(a.nome).localeCompare(rotuloModelo(b.nome), "pt-BR");
  });
}
