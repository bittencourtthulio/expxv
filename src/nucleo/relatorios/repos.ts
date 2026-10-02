// Portas de repositório da Fase 19 (síncronas, como o `node:sqlite`). A implementação SQLite está em `banco/repos/relatorios.ts`; esta, em memória, serve aos testes.
import type { ArquivoPacote, ConfigRelatorios, EnvioDivulgacao, EstadoPacote, ExportacaoRegistro, ModoRedacao, RevisaoPacote, Verificacao } from "./tipos";

export interface RegistroPacote {
  id: string; workspace_id: string; sprint_id: string; titulo: string; versao: number; versao_lancamento: string | null; hash_fatos: string; hash_geracao: string;
  modo_redacao: ModoRedacao; modo_bloco: Record<string, string>; estado: EstadoPacote; etapa: string | null; revisao_usuario: RevisaoPacote; aprovado_em: string | null;
  pasta_ref: string; bytes: number; avisos: string[]; metricas: Record<string, number | boolean | null>; verificacao: Verificacao | null; motivo_falha: string | null; gerado_em: string;
}
export interface RepoRelatorios {
  configObter(ws: string): ConfigRelatorios | undefined;
  configGravar(ws: string, c: ConfigRelatorios, quando: string): void;
  pacoteInserir(p: RegistroPacote): void;
  pacoteAtualizar(id: string, patch: Partial<RegistroPacote>): void;
  pacoteObter(id: string): RegistroPacote | undefined;
  pacotesListar(ws: string, filtros?: { sprint_id?: string; estado?: EstadoPacote }): RegistroPacote[];
  ultimaVersao(ws: string, sprintId: string): number;
  pacotePorGeracao(ws: string, sprintId: string, hashGeracao: string): RegistroPacote | undefined;
  arquivosSubstituir(pacoteId: string, arquivos: readonly ArquivoPacote[]): void;
  arquivosListar(pacoteId: string): ArquivoPacote[];
  ajusteGravar(ws: string, sprintId: string, blocoId: string, texto: string, quando: string): void;
  ajusteApagar(ws: string, sprintId: string, blocoId: string): void;
  ajustesListar(ws: string, sprintId: string): Map<string, string>;
  exportacaoInserir(e: ExportacaoRegistro): void;
  envioInserir(e: EnvioDivulgacao): void;
  envioAtualizar(id: string, patch: Partial<EnvioDivulgacao>): void;
  envioObter(id: string): EnvioDivulgacao | undefined;
  enviosListar(pacoteId: string): EnvioDivulgacao[];
  transacao<T>(fn: () => T): T;
}

export function criarRepoMemoria(): RepoRelatorios {
  const configs = new Map<string, ConfigRelatorios>();
  const pacotes = new Map<string, RegistroPacote>();
  const arquivos = new Map<string, ArquivoPacote[]>();
  const ajustes = new Map<string, string>();
  const envios = new Map<string, EnvioDivulgacao>();
  const exportacoes: ExportacaoRegistro[] = [];
  const ordenados = (l: RegistroPacote[]): RegistroPacote[] => l.sort((a, b) => b.gerado_em.localeCompare(a.gerado_em) || b.versao - a.versao || a.id.localeCompare(b.id));
  return {
    configObter: (ws) => configs.get(ws),
    configGravar: (ws, c) => void configs.set(ws, structuredClone(c)),
    pacoteInserir(p) {
      if ([...pacotes.values()].some((x) => x.workspace_id === p.workspace_id && x.sprint_id === p.sprint_id && x.versao === p.versao)) throw new Error("UNIQUE: versão do pacote já existe");
      pacotes.set(p.id, structuredClone(p));
    },
    pacoteAtualizar(id, patch) { const p = pacotes.get(id); if (p) pacotes.set(id, { ...p, ...structuredClone(patch) }); },
    pacoteObter: (id) => { const p = pacotes.get(id); return p ? structuredClone(p) : undefined; },
    pacotesListar: (ws, f = {}) => ordenados([...pacotes.values()].filter((p) => p.workspace_id === ws && (!f.sprint_id || p.sprint_id === f.sprint_id) && (!f.estado || p.estado === f.estado))).map((p) => structuredClone(p)),
    ultimaVersao: (ws, s) => Math.max(0, ...[...pacotes.values()].filter((p) => p.workspace_id === ws && p.sprint_id === s).map((p) => p.versao)),
    pacotePorGeracao: (ws, s, h) => { const p = ordenados([...pacotes.values()].filter((x) => x.workspace_id === ws && x.sprint_id === s && x.hash_geracao === h && x.estado === "pronto"))[0]; return p ? structuredClone(p) : undefined; },
    arquivosSubstituir: (id, a) => void arquivos.set(id, structuredClone([...a])),
    arquivosListar: (id) => structuredClone([...(arquivos.get(id) ?? [])].sort((a, b) => (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0))),
    ajusteGravar: (ws, s, b, t) => void ajustes.set(`${ws}|${s}|${b}`, t),
    ajusteApagar: (ws, s, b) => void ajustes.delete(`${ws}|${s}|${b}`),
    ajustesListar: (ws, s) => new Map([...ajustes].filter(([k]) => k.startsWith(`${ws}|${s}|`)).map(([k, v]) => [k.split("|")[2] as string, v])),
    exportacaoInserir: (e) => void exportacoes.push(structuredClone(e)),
    envioInserir: (e) => void envios.set(e.id, structuredClone(e)),
    envioAtualizar(id, patch) { const e = envios.get(id); if (e) envios.set(id, { ...e, ...patch }); },
    envioObter: (id) => { const e = envios.get(id); return e ? structuredClone(e) : undefined; },
    enviosListar: (pid) => [...envios.values()].filter((e) => e.pacote_id === pid).sort((a, b) => a.criado_em.localeCompare(b.criado_em) || a.id.localeCompare(b.id)).map((e) => structuredClone(e)),
    transacao: (fn) => fn(),
  };
}
