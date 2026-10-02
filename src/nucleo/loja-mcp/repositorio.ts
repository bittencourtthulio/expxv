// Estado local da Loja de MCPs (Fase 7B, T-07B.04): a PORTA `RepoLojaMcp` (síncrona, no estilo dos repos do
// banco) e uma implementação em memória usada pelos testes e como contrato executável. O repositório SQLite
// (tabelas `catalogo_mcp_*` do plano) implementa a mesma interface — ver docs/ade/pedidos/7b-b-pedidos.md.
// Nunca guarda valor de segredo: só metadado (`definida`). Deny-by-default: sem linha = desabilitado.

import type { EscopoMcp, MetodoInstalacaoMcp, NivelVerificacao } from "./esquema";

export type EstadoInstalacao = "instalando" | "instalado" | "falhou" | "removendo";
export type AlvoTipo = EscopoMcp;
export type OrigemConsentimento = "loja" | "kit" | "atualizacao" | "cli_usuario";
export type CliLoja = "claude" | "codex" | "opencode" | "gemini";
export type NivelLog = "info" | "aviso" | "erro";

export interface RegistroInstalado {
  servidor_id: string;
  versao: string;
  metodo: MetodoInstalacaoMcp;
  estado: EstadoInstalacao;
  nivel_verificacao: NivelVerificacao;
  integridade: string | null;
  /** relativo a `userData` (`mcp/<id>`); `null` em remoto. */
  pasta_rel: string | null;
  comando_hash: string;
  seed_versao: string;
  erro_codigo: string | null;
  instalado_em: string;
  atualizado_em: string;
}

export interface RegistroConsentimento {
  id: string;
  servidor_id: string;
  versao: string;
  comando_hash: string;
  /** riscos, hosts, nomes de variáveis, pasta, nível, comando exato: nunca valor de segredo. */
  permissoes_json: string;
  origem: OrigemConsentimento;
  aceito_em: string;
}

export interface RegistroVariavel { servidor_id: string; nome: string; definida: boolean; atualizada_em: string | null }

export interface RegistroHabilitacao {
  id: string;
  servidor_id: string;
  alvo_tipo: AlvoTipo;
  alvo_valor: string;
  habilitado: boolean;
  atualizado_em: string;
}

export interface RegistroSaude {
  servidor_id: string;
  estado: "ok" | "indisponivel" | "nao_testado";
  testado_em: string | null;
  latencia_ms: number | null;
  n_ferramentas: number | null;
  erro_codigo: string | null;
}

export interface RegistroFerramenta { servidor_id: string; nome: string; descricao: string | null; visto_em: string }
export interface RegistroCliInstalacao { servidor_id: string; cli: CliLoja; nome_na_cli: string; escopo: string; criado_em: string }
export interface RegistroLog { id: string; servidor_id: string; nivel: NivelLog; evento: string; detalhe_json: string; em: string }

export interface FiltroHabilitacao { servidor_id?: string; alvo_tipo?: AlvoTipo; alvo_valor?: string }

export const RETENCAO_LOG_POR_SERVIDOR = 200;
export const RETENCAO_LOG_DIAS = 30;

export interface RepoLojaMcp {
  gravarInstalado(r: RegistroInstalado): void;
  obterInstalado(id: string): RegistroInstalado | null;
  listarInstalados(): RegistroInstalado[];
  /** Remove o servidor e tudo que depende dele (variáveis, habilitações, saúde, ferramentas, CLI). Mantém a auditoria de consentimento. */
  removerServidor(id: string): void;

  gravarConsentimento(r: RegistroConsentimento): void;
  consentimentosDe(id: string): RegistroConsentimento[];

  gravarVariavel(r: RegistroVariavel): void;
  variaveisDe(id: string): RegistroVariavel[];
  apagarVariavel(id: string, nome: string): void;

  /** Upsert por (servidor, alvo). */
  habilitar(r: Omit<RegistroHabilitacao, "id"> & { id?: string }): RegistroHabilitacao;
  listarHabilitacoes(filtro?: FiltroHabilitacao): RegistroHabilitacao[];
  removerHabilitacoes(servidor_id: string): void;

  salvarSaude(r: RegistroSaude): void;
  obterSaude(id: string): RegistroSaude | null;
  substituirFerramentas(id: string, ferramentas: Array<{ nome: string; descricao: string | null }>, em: string): void;
  ferramentasDe(id: string): RegistroFerramenta[];

  cliInstalacaoGravar(r: RegistroCliInstalacao): void;
  cliInstalacoesDe(id: string): RegistroCliInstalacao[];
  cliInstalacaoRemover(id: string, cli: CliLoja): void;

  /** Retenção: 200 por servidor (descarta o mais antigo) e 30 dias. */
  registrarLog(r: Omit<RegistroLog, "id"> & { id?: string }): void;
  logsDe(id: string, limite?: number): RegistroLog[];
  podarLogs(antesDe: string): number;

  kitOptOut(): boolean;
  definirKitOptOut(valor: boolean, em: string): void;
}

export function criarRepoMemoria(gerarId: () => string = (() => { let n = 0; return () => `mcpx_${String(++n).padStart(6, "0")}`; })()): RepoLojaMcp {
  const instalados = new Map<string, RegistroInstalado>();
  const consentimentos: RegistroConsentimento[] = [];
  const variaveis = new Map<string, RegistroVariavel>();
  const habilitacoes = new Map<string, RegistroHabilitacao>();
  const saudes = new Map<string, RegistroSaude>();
  const ferramentas = new Map<string, RegistroFerramenta[]>();
  const clis = new Map<string, RegistroCliInstalacao>();
  const logs: RegistroLog[] = [];
  let optOut = false;
  const chaveVar = (id: string, nome: string): string => `${id}\u0000${nome}`;
  const chaveHab = (id: string, t: string, v: string): string => `${id}\u0000${t}\u0000${v}`;
  const clone = <T>(x: T): T => structuredClone(x);

  return {
    gravarInstalado: (r) => { instalados.set(r.servidor_id, clone(r)); },
    obterInstalado: (id) => { const r = instalados.get(id); return r ? clone(r) : null; },
    listarInstalados: () => [...instalados.values()].sort((a, b) => a.servidor_id.localeCompare(b.servidor_id)).map(clone),
    removerServidor: (id) => {
      instalados.delete(id); saudes.delete(id); ferramentas.delete(id);
      for (const k of [...variaveis.keys()]) if (k.startsWith(`${id}\u0000`)) variaveis.delete(k);
      for (const k of [...habilitacoes.keys()]) if (k.startsWith(`${id}\u0000`)) habilitacoes.delete(k);
      for (const k of [...clis.keys()]) if (k.startsWith(`${id}\u0000`)) clis.delete(k);
    },
    gravarConsentimento: (r) => { consentimentos.push(clone(r)); },
    consentimentosDe: (id) => consentimentos.filter((c) => c.servidor_id === id).sort((a, b) => a.aceito_em.localeCompare(b.aceito_em)).map(clone),
    gravarVariavel: (r) => { variaveis.set(chaveVar(r.servidor_id, r.nome), clone(r)); },
    variaveisDe: (id) => [...variaveis.values()].filter((v) => v.servidor_id === id).map(clone),
    apagarVariavel: (id, nome) => { variaveis.delete(chaveVar(id, nome)); },
    habilitar: (r) => {
      const k = chaveHab(r.servidor_id, r.alvo_tipo, r.alvo_valor);
      const reg: RegistroHabilitacao = { id: habilitacoes.get(k)?.id ?? r.id ?? gerarId(), servidor_id: r.servidor_id, alvo_tipo: r.alvo_tipo, alvo_valor: r.alvo_valor, habilitado: r.habilitado, atualizado_em: r.atualizado_em };
      habilitacoes.set(k, reg);
      return clone(reg);
    },
    listarHabilitacoes: (f = {}) => [...habilitacoes.values()]
      .filter((h) => (f.servidor_id === undefined || h.servidor_id === f.servidor_id) && (f.alvo_tipo === undefined || h.alvo_tipo === f.alvo_tipo) && (f.alvo_valor === undefined || h.alvo_valor === f.alvo_valor))
      .map(clone),
    removerHabilitacoes: (id) => { for (const k of [...habilitacoes.keys()]) if (k.startsWith(`${id}\u0000`)) habilitacoes.delete(k); },
    salvarSaude: (r) => { saudes.set(r.servidor_id, clone(r)); },
    obterSaude: (id) => { const s = saudes.get(id); return s ? clone(s) : null; },
    substituirFerramentas: (id, lista, em) => { ferramentas.set(id, lista.map((f) => ({ servidor_id: id, nome: f.nome, descricao: f.descricao, visto_em: em }))); },
    ferramentasDe: (id) => (ferramentas.get(id) ?? []).map(clone),
    cliInstalacaoGravar: (r) => { clis.set(`${r.servidor_id}\u0000${r.cli}`, clone(r)); },
    cliInstalacoesDe: (id) => [...clis.values()].filter((c) => c.servidor_id === id).map(clone),
    cliInstalacaoRemover: (id, cli) => { clis.delete(`${id}\u0000${cli}`); },
    registrarLog: (r) => {
      logs.push({ id: r.id ?? gerarId(), servidor_id: r.servidor_id, nivel: r.nivel, evento: r.evento, detalhe_json: r.detalhe_json.slice(0, 1024), em: r.em });
      const doServidor = logs.filter((l) => l.servidor_id === r.servidor_id);
      for (let i = 0; i < doServidor.length - RETENCAO_LOG_POR_SERVIDOR; i++) logs.splice(logs.indexOf(doServidor[i]!), 1);
    },
    logsDe: (id, limite = 50) => logs.filter((l) => l.servidor_id === id).slice(-limite).reverse().map(clone),
    podarLogs: (antesDe) => { let n = 0; for (let i = logs.length - 1; i >= 0; i--) if (logs[i]!.em < antesDe) { logs.splice(i, 1); n++; } return n; },
    kitOptOut: () => optOut,
    definirKitOptOut: (v) => { optOut = v; },
  };
}
