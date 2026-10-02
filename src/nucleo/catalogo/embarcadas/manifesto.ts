// Skills embarcadas `ev-*` (T-07.16/17): manifesto com sha256, materialização por Pane (plugin efêmero, padrão, D-43), instalação global OPT-IN
// (cópia, nunca symlink para dentro do pacote), atualização por hash (nunca sobrescreve o que a pessoa editou) e `opt_out` persistente.
// Nada aqui roda no boot: só sob demanda. Sem ação do usuário, NENHUM arquivo é criado na casa do usuário.
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { CliCatalogo, EstadoEmbarcada } from "../../../compartilhado/catalogo";
import type { RepoCatalogo } from "../../banco/repos/catalogo";
import { RAIZ_GLOBAL_SKILLS } from "../instalacao";
import { nomeValido, normalizarNome } from "../normalizar";

export interface SkillManifesto {
  name: string;
  version: number;
  path: string;
  description: string;
  clis: string[];
  sha256: string;
}
export interface Manifesto {
  manifest_version: number;
  skills: SkillManifesto[];
}

const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
const CLIS_EMBARCADAS: readonly CliCatalogo[] = ["claude", "codex", "opencode", "portatil"];

/** Lê `manifesto.json` (≤ 256 KB). Inválido = lista vazia (nada instalável). */
export async function lerManifesto(dirSkills: string): Promise<Manifesto> {
  try {
    const bruto = JSON.parse(await readFile(join(dirSkills, "manifesto.json"), "utf8")) as unknown;
    const o = bruto as { manifest_version?: unknown; skills?: unknown };
    if (typeof o.manifest_version !== "number" || !Array.isArray(o.skills)) return { manifest_version: 0, skills: [] };
    const skills: SkillManifesto[] = [];
    for (const s of o.skills.slice(0, 50)) {
      const x = s as Partial<SkillManifesto>;
      if (typeof x.name !== "string" || !nomeValido(x.name) || typeof x.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(x.sha256) || typeof x.version !== "number") continue;
      skills.push({ name: x.name, version: x.version, path: `${x.name}/SKILL.md`, description: typeof x.description === "string" ? x.description.slice(0, 200) : "", clis: Array.isArray(x.clis) ? x.clis.filter((c): c is string => typeof c === "string") : [], sha256: x.sha256 });
    }
    return { manifest_version: o.manifest_version, skills };
  } catch {
    return { manifest_version: 0, skills: [] };
  }
}

/** nome normalizado → hashes conhecidos (alimenta `origem=embarcada` nos scanners). */
export function hashesDasEmbarcadas(m: Manifesto): Array<[string, string[]]> {
  return m.skills.map((s) => [normalizarNome(s.name), [s.sha256]] as [string, string[]]);
}

/** Lê o SKILL.md empacotado e confere o hash do manifesto (integridade do pacote). `null` se divergir. */
async function lerConferido(dirSkills: string, s: SkillManifesto): Promise<Buffer | null> {
  try {
    const buf = await readFile(join(dirSkills, s.name, "SKILL.md"));
    return sha(buf) === s.sha256 ? buf : null;
  } catch {
    return null;
  }
}

export interface PedidoMaterializar {
  dirApp: string;
  paneId: string;
  nomes: readonly string[];
  dirSkills: string;
  manifesto: Manifesto;
}

/** Cria `<dirApp>/panes/<pane_id>/plugin/` (plugin efêmero lido por `--plugin-dir`) só com as `ev-*` PERMITIDAS e íntegras. Devolve a pasta e os nomes copiados. */
export async function materializarEmbarcadasDoPane(p: PedidoMaterializar): Promise<{ dir: string; nomes: string[] }> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(p.paneId)) throw new Error("pane_id inválido");
  const quer = new Set(p.nomes.map(normalizarNome));
  const dir = join(p.dirApp, "panes", p.paneId, "plugin");
  const copiados: string[] = [];
  await rm(dir, { recursive: true, force: true });
  for (const s of p.manifesto.skills) {
    if (!quer.has(normalizarNome(s.name))) continue;
    const buf = await lerConferido(p.dirSkills, s);
    if (buf === null) continue;
    const alvo = join(dir, "skills", s.name);
    await mkdir(alvo, { recursive: true, mode: 0o700 });
    await writeFile(join(alvo, "SKILL.md"), buf, { mode: 0o600 });
    copiados.push(s.name);
  }
  if (copiados.length > 0) {
    await mkdir(join(dir, ".claude-plugin"), { recursive: true, mode: 0o700 });
    await writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "ev-embarcadas", version: String(p.manifesto.manifest_version), description: "Skills do ambiente entregues a este Pane" }), { mode: 0o600 });
  }
  return { dir, nomes: copiados };
}

/** Texto resumido (CLIs sem plugin efêmero recebem isto no arquivo de instruções): nome e descrição, nunca o corpo. */
export function resumoParaInstrucoes(m: Manifesto, nomes: readonly string[]): string {
  const quer = new Set(nomes.map(normalizarNome));
  const linhas = m.skills.filter((s) => quer.has(normalizarNome(s.name))).map((s) => `- ${s.name}: ${s.description}`);
  return linhas.length === 0 ? "" : `Skills do ambiente disponíveis (use somente estas):\n${linhas.join("\n")}`;
}

export interface ContextoEmbarcadas {
  repo: RepoCatalogo;
  home: string;
  dirSkills: string;
  manifesto: Manifesto;
  agora?: () => string;
}

const dirGlobal = (home: string, cli: CliCatalogo): string | null => {
  const rel = RAIZ_GLOBAL_SKILLS[cli];
  return rel === null ? null : join(home, rel);
};

async function hashInstalado(abs: string): Promise<string | null> {
  try {
    return sha(await readFile(join(abs, "SKILL.md")));
  } catch {
    return null;
  }
}

/** Estado por skill × CLI. Só lê (um `stat`/leitura por skill instalada). */
export async function estadoEmbarcadas(c: ContextoEmbarcadas): Promise<EstadoEmbarcada[]> {
  const saida: EstadoEmbarcada[] = [];
  for (const s of c.manifesto.skills) {
    const clis: EstadoEmbarcada["clis"] = [];
    for (const cli of CLIS_EMBARCADAS) {
      const raiz = dirGlobal(c.home, cli);
      const reg = c.repo.obterEmbarcada(s.name, cli);
      const h = raiz === null ? null : await hashInstalado(join(raiz, s.name));
      clis.push({ cli, instalada: h !== null, versao: reg?.versao_instalada ?? null, editada: h !== null && reg?.hash_instalado != null && h !== reg.hash_instalado, opt_out: reg?.opt_out ?? false });
    }
    saida.push({ nome: s.name, versao_pacote: String(s.version), descricao: s.description, clis });
  }
  return saida;
}

/**
 * Instala (copia) as embarcadas no escopo GLOBAL da CLI. `nome === null`: todas (pula `opt_out`). Regra de atualização (RF-05.33): versão do pacote maior E hash do
 * arquivo instalado igual ao `hash_instalado` registrado → sobrescreve; hash diferente (editada) → preserva e devolve em `preservadas_editadas`. Cópia atômica (tmp + rename).
 */
export async function instalarEmbarcadas(c: ContextoEmbarcadas, nome: string | null, cli: CliCatalogo): Promise<{ instaladas: string[]; preservadas_editadas: string[] }> {
  const raiz = dirGlobal(c.home, cli);
  if (raiz === null || !CLIS_EMBARCADAS.includes(cli)) return { instaladas: [], preservadas_editadas: [] };
  const agora = (c.agora ?? ((): string => new Date().toISOString()))();
  const alvo = nome === null ? c.manifesto.skills : c.manifesto.skills.filter((s) => s.name === nome);
  const instaladas: string[] = [];
  const preservadas: string[] = [];
  for (const s of alvo) {
    const reg = c.repo.obterEmbarcada(s.name, cli);
    if (nome === null && reg?.opt_out === true) continue;
    const buf = await lerConferido(c.dirSkills, s);
    if (buf === null) continue;
    const destino = join(raiz, s.name);
    const atual = await hashInstalado(destino);
    if (atual !== null) {
      const intacta = reg?.hash_instalado != null && atual === reg.hash_instalado;
      const versaoNova = reg?.versao_instalada == null || Number(reg.versao_instalada) < s.version;
      if (atual === s.sha256) {
        c.repo.gravarEmbarcada({ nome: s.name, cli, versao_instalada: String(s.version), hash_instalado: s.sha256, opt_out: false, atualizado_em: agora });
        continue;
      }
      if (!intacta) {
        preservadas.push(s.name);
        continue;
      }
      if (!versaoNova) continue;
    } else {
      // existe algo que não é nosso (pasta sem SKILL.md legível)? não mexe
      try {
        await stat(destino);
        preservadas.push(s.name);
        continue;
      } catch {
        /* ausente: segue */
      }
    }
    const tmp = `${destino}.tmp-${process.pid}`;
    try {
      await mkdir(raiz, { recursive: true });
      await rm(tmp, { recursive: true, force: true });
      await mkdir(tmp, { recursive: true });
      await writeFile(join(tmp, "SKILL.md"), buf, { mode: 0o644 });
      if (atual !== null) await rm(destino, { recursive: true, force: true });
      await rename(tmp, destino);
      c.repo.gravarEmbarcada({ nome: s.name, cli, versao_instalada: String(s.version), hash_instalado: s.sha256, opt_out: false, atualizado_em: agora });
      instaladas.push(s.name);
    } catch {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  return { instaladas, preservadas_editadas: preservadas };
}

export function definirOptOut(c: ContextoEmbarcadas, nome: string, cli: CliCatalogo, valor: boolean): void {
  const reg = c.repo.obterEmbarcada(nome, cli);
  c.repo.gravarEmbarcada({ nome, cli, versao_instalada: reg?.versao_instalada ?? null, hash_instalado: reg?.hash_instalado ?? null, opt_out: valor, atualizado_em: (c.agora ?? ((): string => new Date().toISOString()))() });
}
