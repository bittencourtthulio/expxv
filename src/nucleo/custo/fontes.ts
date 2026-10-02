// Fontes de uso por Pane (T-10.06). Localiza o arquivo que a CLI gravou SEM varrer o home: Claude — `transcript_path` do hook (validado) ou o `<id>.jsonl` dentro de
// `projects/*` do config dir; Codex — só `sessions/AAAA/MM/DD` do CODEX_HOME (dias recentes) pelo id da conversa; demais CLIs — `sem_fonte` visível (nunca 0).
// OpenCode (P-82): base `opencode_data` (a pasta de dados do OpenCode, `~/.local/share/opencode`); `relativo` = `opencode.db#<id da sessão>` (uma fonte por sessão; só esse arquivo, sem varredura).
// Referência é `base + relativo` (D-109): caminho absoluto só existe em memória, nunca no banco. Symlink que sai da base é recusado.
import { readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { ehIdSessaoOpenCode, NOME_BANCO_OPENCODE } from "./leitores/opencode";
import type { FonteUso } from "./repos";
import type { ServicoCusto } from "./servico";

export const CLIS_SEM_LEITOR: readonly string[] = ["gemini", "opencode", "aider", "qwen", "kilo", "grok"];
const ID_CONVERSA = /^[A-Za-z0-9_-]{8,80}$/;
const DIAS_CODEX = 14;

export type BaseArquivo = "claude_config" | "codex_home" | "opencode_data";
export interface PaneParaFonte {
  id: string;
  cli: string | null;
  conta_id: string | null;
  mission_id: string | null;
  workspace_id: string | null;
}
export interface BasesFonte {
  /** diretório ABSOLUTO da base para a conta (CLAUDE_CONFIG_DIR/CODEX_HOME da conta, ou o padrão); `null` = indisponível. */
  absoluto(base: BaseArquivo, contaId: string | null): string | null;
}
export interface FsFontes {
  realpath(p: string): Promise<string>;
  eArquivo(p: string): Promise<boolean>;
  listar(p: string): Promise<string[]>;
}
export const fsReal: FsFontes = {
  realpath: (p) => realpath(p),
  eArquivo: async (p) => {
    try {
      return (await stat(p)).isFile();
    } catch {
      return false;
    }
  },
  listar: async (p) => {
    try {
      return await readdir(p);
    } catch {
      return [];
    }
  },
};

/** Relativo à base (com `/`) se `abs` é absoluto, `.jsonl` e está DENTRO da base (sem `..`); senão `null`. Puro. */
export function relativoDentro(baseAbs: string, abs: string): string | null {
  if (!isAbsolute(abs) || !abs.endsWith(".jsonl") || !isAbsolute(baseAbs)) return null;
  const r = relative(baseAbs, abs);
  if (r === "" || r.startsWith("..") || isAbsolute(r)) return null;
  return r.split(sep).join("/");
}

export interface PedidoSessaoOpenCode {
  /** `cli_ref_conversa` do Pane (id `ses_…` quando o hook o informou). */
  conversa: string | null;
  /** diretório de trabalho do Pane. */
  cwd: string | null;
  /** criação do Pane (ms). */
  desdeMs: number;
}
export interface DepsFontes {
  servico: Pick<ServicoCusto, "registrarFonte" | "marcarSemFonte"> & Partial<Pick<ServicoCusto, "repo">>;
  bases: BasesFonte;
  fs?: FsFontes;
  /** acha a sessão do OpenCode no `opencode.db` (no worker; o main nunca abre o banco): devolve o id `ses_…` ou `null`. */
  localizarSessaoOpenCode?(caminhoDb: string, p: PedidoSessaoOpenCode): Promise<string | null>;
}

export function criarFontes(d: DepsFontes) {
  const fs = d.fs ?? fsReal;

  /** `baseAbs` real e `abs` real precisam continuar dentro um do outro (symlink para fora ⇒ recusado). */
  async function validar(base: BaseArquivo, contaId: string | null, abs: string): Promise<string | null> {
    const raiz = d.bases.absoluto(base, contaId);
    if (raiz === null) return null;
    const rel = relativoDentro(raiz, abs);
    if (rel === null) return null;
    try {
      const [rb, ra] = await Promise.all([fs.realpath(raiz), fs.realpath(abs)]);
      return relativoDentro(rb, ra) === null ? null : rel;
    } catch {
      return null;
    }
  }
  const garantir = (cli: string, base: BaseArquivo, pane: PaneParaFonte, relativo: string): FonteUso =>
    d.servico.registrarFonte({ cli, base, relativo, conta_id: pane.conta_id, pane_id: pane.id, mission_id: pane.mission_id, workspace_id: pane.workspace_id });

  /** Id da sessão de uma fonte do OpenCode (`opencode.db#ses_…`); `null` se a referência não é válida. */
  function sessaoDe(f: Pick<FonteUso, "base" | "relativo">): string | null {
    if (f.base !== "opencode_data") return null;
    const [arquivo, sessao, ...resto] = f.relativo.split("#");
    return arquivo === NOME_BANCO_OPENCODE && sessao !== undefined && resto.length === 0 && ehIdSessaoOpenCode(sessao) ? sessao : null;
  }
  /** Caminho absoluto de uma fonte (em memória; nunca persistir). Para o OpenCode é o `opencode.db` (a sessão vem de `sessaoDe`). */
  function resolver(f: Pick<FonteUso, "base" | "relativo" | "conta_id">): string | null {
    if (f.base === "opencode_data") {
      if (!sessaoDe(f)) return null;
      const raizOc = d.bases.absoluto("opencode_data", f.conta_id);
      return raizOc === null ? null : join(raizOc, NOME_BANCO_OPENCODE);
    }
    if (f.base !== "claude_config" && f.base !== "codex_home") return null;
    if (f.relativo === "" || f.relativo.split("/").includes("..") || isAbsolute(f.relativo)) return null;
    const raiz = d.bases.absoluto(f.base, f.conta_id);
    return raiz === null ? null : join(raiz, ...f.relativo.split("/"));
  }

  async function registrarClaude(pane: PaneParaFonte, transcriptPath: string): Promise<FonteUso | null> {
    const rel = await validar("claude_config", pane.conta_id, transcriptPath);
    return rel === null ? null : garantir("claude", "claude_config", pane, rel);
  }
  /** Subagentes/sidechains: `<sessão>/subagents/agent-*.jsonl` (lista só ESSA pasta) — contam no MESMO Pane. */
  async function descobrirSubagentes(pane: PaneParaFonte, transcriptAbs: string): Promise<FonteUso[]> {
    const pasta = join(dirname(transcriptAbs), basename(transcriptAbs, ".jsonl"), "subagents");
    const nomes = (await fs.listar(pasta)).filter((n) => /^agent-[A-Za-z0-9_-]+\.jsonl$/.test(n)).sort();
    const out: FonteUso[] = [];
    for (const n of nomes) {
      const f = await registrarClaude(pane, join(pasta, n));
      if (f !== null) out.push(f);
    }
    return out;
  }
  /** Sem hook ainda: procura `<id>.jsonl` só nas pastas de `projects/` do config dir (um `stat` por pasta; nada fora da base). */
  async function localizarClaudePorConversa(pane: PaneParaFonte, conversaId: string): Promise<FonteUso | null> {
    if (!ID_CONVERSA.test(conversaId)) return null;
    const raiz = d.bases.absoluto("claude_config", pane.conta_id);
    if (raiz === null) return null;
    const projetos = join(raiz, "projects");
    for (const p of await fs.listar(projetos)) {
      const abs = join(projetos, p, `${conversaId}.jsonl`);
      if (await fs.eArquivo(abs)) return registrarClaude(pane, abs);
    }
    return null;
  }

  async function localizarCodex(pane: PaneParaFonte, conversaId: string): Promise<FonteUso | null> {
    if (!ID_CONVERSA.test(conversaId)) return null;
    const raiz = d.bases.absoluto("codex_home", pane.conta_id);
    if (raiz === null) return null;
    const sessoes = join(raiz, "sessions");
    const desc = (xs: string[]): string[] => xs.filter((x) => /^\d+$/.test(x)).sort().reverse();
    let dias = 0;
    for (const a of desc(await fs.listar(sessoes)))
      for (const m of desc(await fs.listar(join(sessoes, a))))
        for (const dia of desc(await fs.listar(join(sessoes, a, m)))) {
          if (dias++ >= DIAS_CODEX) return null;
          const pasta = join(sessoes, a, m, dia);
          const nome = (await fs.listar(pasta)).find((n) => n.startsWith("rollout-") && n.endsWith(`-${conversaId}.jsonl`));
          if (nome === undefined) continue;
          const abs = join(pasta, nome);
          const rel = await validar("codex_home", pane.conta_id, abs);
          return rel === null ? null : garantir("codex", "codex_home", pane, rel);
        }
    return null;
  }

  /**
   * OpenCode: só o `opencode.db` dentro da pasta de dados (um `stat`; arquivo e pasta reais continuam um dentro do outro), e a sessão é achada no worker.
   * Sem banco ou sem sessão ainda ⇒ `null` (o chamador deixa o Pane em `sem_fonte` visível e tenta de novo no próximo evento). Achada: a fonte nasce e o
   * `sem_fonte` anterior do mesmo Pane é encerrado (não vira alerta eterno).
   */
  async function localizarOpenCode(pane: PaneParaFonte, p: PedidoSessaoOpenCode): Promise<FonteUso | null> {
    if (d.localizarSessaoOpenCode === undefined) return null;
    const raiz = d.bases.absoluto("opencode_data", pane.conta_id);
    if (raiz === null) return null;
    const db = join(raiz, NOME_BANCO_OPENCODE);
    try {
      if (!(await fs.eArquivo(db))) return null;
      const [rb, rd] = await Promise.all([fs.realpath(raiz), fs.realpath(db)]);
      if (dirname(rd) !== rb) return null;
    } catch {
      return null;
    }
    let sessao: string | null = null;
    try {
      sessao = await d.localizarSessaoOpenCode(db, p);
    } catch {
      return null;
    }
    if (sessao === null || !ehIdSessaoOpenCode(sessao)) return null;
    const f = garantir("opencode", "opencode_data", pane, `${NOME_BANCO_OPENCODE}#${sessao}`);
    try {
      for (const o of d.servico.repo?.fontes.porPane(pane.id, "nenhuma") ?? []) if (o.estado === "sem_fonte") d.servico.repo?.fontes.atualizar(o.id, { estado: "encerrada" });
    } catch {
      /* o aviso antigo fica; a leitura nova segue */
    }
    return f;
  }

  function registrarSemLeitor(pane: PaneParaFonte): FonteUso | null {
    if (pane.cli === null || !CLIS_SEM_LEITOR.includes(pane.cli)) return null;
    return d.servico.marcarSemFonte({ cli: pane.cli, pane_id: pane.id, conta_id: pane.conta_id, mission_id: pane.mission_id, workspace_id: pane.workspace_id });
  }

  return { resolver, sessaoDe, localizarOpenCode, registrarClaude, descobrirSubagentes, localizarClaudePorConversa, localizarCodex, registrarSemLeitor };
}
export type Fontes = ReturnType<typeof criarFontes>;
