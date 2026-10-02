// Fixtures de teste da tela Versionamento (não entram no bundle: só os testes importam).
import { vi, type Mock } from "vitest";
import type { Workspace } from "../../../compartilhado/dominio";
import type { ApiVcs, EstadoVcs, ResumoVcs } from "../../../compartilhado/vcs";
import type { Diff, DiffArquivo, Hunk, LinhaDiff, Mudanca, StatusRepo } from "../../../nucleo/vcs/tipos";
import { CAPABILITIES_GIT, CAPABILITIES_SVN } from "../../../nucleo/vcs/tipos";

export const WS: Workspace = { id: "ws_01J8ZXAMPLE0000000000000A1", nome: "proj", raiz: "/p", e_git: true, acesso_externo: "nenhum", permissao: "seguro", ultimo_uso_em: null, criado_em: "x", atualizado_em: "x" } as Workspace;

export const mud = (caminho: string, indice: Mudanca["indice"], arvore: Mudanca["arvore"], tipo: Mudanca["tipo"] = "ordinario"): Mudanca => ({ caminho, tipo, indice, arvore });

export function statusDe(arquivos: Mudanca[], extra: Partial<StatusRepo> = {}): StatusRepo {
  return {
    estado: "pronto", branch: "feature/x", oid: "abc1234", upstream: "origin/feature/x", ahead: 1, behind: 0, semCommits: false, arquivos, degradado: false, duracaoMs: 3,
    contagens: { staged: arquivos.filter((a) => a.indice !== " " && a.tipo === "ordinario").length, naoStaged: arquivos.filter((a) => a.arvore !== " " && a.tipo === "ordinario").length, naoRastreados: arquivos.filter((a) => a.tipo === "naorastreado").length, conflitos: arquivos.filter((a) => a.tipo === "conflito").length, ignorados: 0 },
    ...extra,
  };
}

export function resumoDe(s: StatusRepo, tipo: ResumoVcs["tipo"] = "git"): ResumoVcs {
  return { tipo, branch: s.branch, oid: s.oid?.slice(0, 7) ?? null, sujo: s.arquivos.length > 0, ahead: s.ahead, behind: s.behind, staged: s.contagens.staged, nao_staged: s.contagens.naoStaged, nao_rastreados: s.contagens.naoRastreados, conflitos: s.contagens.conflitos, operacao: null, calculando: false, degradado: false };
}

export function estadoDe(arquivos: Mudanca[], extra: Partial<EstadoVcs> = {}, st: Partial<StatusRepo> = {}): EstadoVcs {
  const status = statusDe(arquivos, st);
  return { tipo: "git", local: ".", capabilities: { ...CAPABILITIES_GIT }, status, resumo: resumoDe(status), operacao: null, ramo_padrao: "main", ramo_protegido: false, svn_binario: null, mensagem: null, ...extra };
}

export function estadoSvn(arquivos: Mudanca[]): EstadoVcs {
  const status = statusDe(arquivos, { branch: null, upstream: null, ahead: 0, behind: 0 });
  return { tipo: "svn", local: ".", capabilities: { ...CAPABILITIES_SVN }, status, resumo: resumoDe(status, "svn"), operacao: null, ramo_padrao: null, ramo_protegido: false, svn_binario: true, mensagem: null };
}

export function linhaDiff(tipo: LinhaDiff["tipo"], texto: string, antiga: number | null, nova: number | null): LinhaDiff {
  return { tipo, texto, antiga, nova };
}

export function diffSimples(caminho = "src/a.ts"): Diff {
  const hunk: Hunk = {
    cabecalho: "@@ -1,3 +1,3 @@", antigaInicio: 1, antigaQtd: 3, novaInicio: 1, novaQtd: 3, secao: "",
    linhas: [linhaDiff("ctx", "const a = 1;", 1, 1), linhaDiff("del", "const b = 2; // velho", 2, null), linhaDiff("add", "const b = 3; // novo", null, 2), linhaDiff("ctx", "return a;", 3, 3)],
  };
  const f: DiffArquivo = { caminho, caminhoAntigo: caminho, estado: "modificado", binario: false, mudouModo: false, eol: "lf", soFimDeLinha: false, insercoes: 1, delecoes: 1, hunks: [hunk] };
  return { arquivos: [f], truncado: false, grande: false };
}

/** Diff sintético de ~`mb` MB (linhas de 60 caracteres). */
export function diffGrande(mb: number): Diff {
  const porLinha = 62;
  const n = Math.ceil((mb * 1024 * 1024) / porLinha);
  const linhas: LinhaDiff[] = [];
  for (let i = 0; i < n; i++) linhas.push(linhaDiff(i % 3 === 0 ? "add" : i % 3 === 1 ? "del" : "ctx", `const variavel_${i} = calcular(${i}, "texto de exemplo longo"); // c`, i % 3 === 0 ? null : i, i % 3 === 1 ? null : i));
  const hunks: Hunk[] = [];
  const por = 500;
  for (let h = 0; h * por < n; h++) hunks.push({ cabecalho: `@@ -${h * por},${por} +${h * por},${por} @@`, antigaInicio: h * por, antigaQtd: por, novaInicio: h * por, novaQtd: por, secao: "", linhas: linhas.slice(h * por, (h + 1) * por) });
  return { arquivos: [{ caminho: "grande.ts", caminhoAntigo: "grande.ts", estado: "modificado", binario: false, mudouModo: false, eol: "lf", soFimDeLinha: false, insercoes: Math.floor(n / 3), delecoes: Math.floor(n / 3), hunks }], truncado: false, grande: false };
}

/** ApiVcs falsa: cada operação é um `vi.fn` (sobrescreva o que o teste precisa). */
export function apiFalsa(estado: EstadoVcs, sobre: Partial<Record<keyof ApiVcs, unknown>> = {}) {
  const ouvintes = new Set<(e: Parameters<Parameters<ApiVcs["assinar"]>[0]>[0]) => void>();
  const api = {
    estado: vi.fn().mockResolvedValue(estado),
    observar: vi.fn().mockResolvedValue(estado.resumo),
    diff: vi.fn().mockResolvedValue(diffSimples()),
    estagio: vi.fn().mockResolvedValue({ ok: true }),
    commit: vi.fn().mockResolvedValue({ hash: "h", hashCurto: "abc1234", assunto: "ok", amend: false, hooksPulados: false, avisos: [], saida: "" }),
    ramos: vi.fn().mockResolvedValue([]),
    stash: vi.fn().mockResolvedValue([]),
    historico: vi.fn().mockResolvedValue({ commits: [], grafo: [], proximo: null, duracaoMs: 1 }),
    remoto: vi.fn().mockResolvedValue({}),
    operacao: vi.fn().mockResolvedValue({}),
    conflitos: vi.fn().mockResolvedValue([]),
    svn: vi.fn().mockResolvedValue({}),
    forge: vi.fn().mockResolvedValue({ forge: null, provedor: null }),
    missao: vi.fn().mockResolvedValue({}),
    assinar: vi.fn((cb) => { ouvintes.add(cb); return () => void ouvintes.delete(cb); }),
    ...sobre,
  };
  return { api: api as unknown as ApiVcs, mocks: api as unknown as Record<keyof ApiVcs, Mock>, emitir: (e: Parameters<Parameters<ApiVcs["assinar"]>[0]>[0]) => ouvintes.forEach((o) => o(e)) };
}
