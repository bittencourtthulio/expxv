// Operações puras sobre o RASCUNHO de uma squad na tela (sem I/O, sem React): quem valida de verdade é o main (`squads:validar`).
// Tudo é imutável: devolve cópias. O texto do prompt de um membro nunca está aqui (só o caminho `membros/<slug>.md`).
import type { Achado, Faixa, Membro, PapelSquad, Squad, SubstituicaoCli } from "../../../compartilhado/squads";
import { CLIS_COM_INTAKE, LIMITES_SQUAD, caminhoPromptDe } from "../../../compartilhado/squads";

const ROTULO_PAPEL: Record<PapelSquad, string> = { orchestrator: "Orquestrador", scout: "Explorador", executor: "Executor", reviewer: "Revisor" };
export const descreverPapel = (p: PapelSquad): string => ROTULO_PAPEL[p];
const BASE_SLUG: Record<PapelSquad, string> = { orchestrator: "orquestrador", scout: "explorador", executor: "executor", reviewer: "revisor" };
const FAIXA_DO_PAPEL: Record<PapelSquad, Faixa> = { orchestrator: "topo", scout: "medio", executor: "medio", reviewer: "alto" };

/** `Squad de Pesquisa Ágil!` → `squad-de-pesquisa-agil` (padrão `^[a-z0-9][a-z0-9-]{0,39}$`; vazio vira `squad`). */
export function slugDeNome(nome: string): string {
  const s = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LIMITES_SQUAD.slug_max)
    .replace(/-+$/g, "");
  return s === "" ? "squad" : s;
}

const orcamentoVazio = (): Membro["orcamento"] => ({ tempo_min: null, tokens: null, modo: "soft" });

function slugLivre(base: string, usados: ReadonlySet<string>): string {
  if (!usados.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const s = `${base.slice(0, LIMITES_SQUAD.slug_max - String(n).length - 1)}-${n}`;
    if (!usados.has(s)) return s;
  }
  return `${base.slice(0, 30)}-${Date.now().toString(36)}`;
}

/** Arquétipo inicial de um membro novo: o prompt de partida é criado pelo main ao gravar (o usuário o edita depois). */
export function novoMembro(papel: PapelSquad, existentes: readonly Membro[], cli = "claude"): Membro {
  const slug = slugLivre(BASE_SLUG[papel], new Set(existentes.map((m) => m.slug)));
  const n = existentes.filter((m) => m.papel === papel).length;
  return {
    slug,
    papel,
    rotulo: n === 0 ? ROTULO_PAPEL[papel] : `${ROTULO_PAPEL[papel]} ${n + 1}`,
    descricao: "",
    prompt: caminhoPromptDe(slug),
    perfil: { cli, modelo: null, esforco: null, faixa: FAIXA_DO_PAPEL[papel] },
    skills_permitidas: [],
    mcps_permitidos: [],
    hooks: [],
    max_instancias: papel === "orchestrator" || papel === "reviewer" ? 1 : 2,
    orcamento: orcamentoVazio(),
    rigidez: null,
    permissao: null,
  };
}

export function squadNova(slug: string, nome: string): Squad {
  const membros: Membro[] = [];
  for (const p of ["orchestrator", "executor", "reviewer"] as const) membros.push(novoMembro(p, membros));
  return {
    slug,
    nome,
    descricao: "",
    escopo: "desenvolvimento",
    rigidez_padrao: null,
    max_instancias_paralelas: 4,
    orcamento: orcamentoVazio(),
    portoes: null,
    fabrica: null,
    origem: "usuario",
    membros,
  };
}

const comMembros = (s: Squad, membros: Membro[]): Squad => ({ ...s, membros });

export function mudarMembro(s: Squad, slug: string, patch: Partial<Membro>): Squad {
  return comMembros(s, s.membros.map((m) => (m.slug === slug ? { ...m, ...patch } : m)));
}
export function mudarPerfil(s: Squad, slug: string, patch: Partial<Membro["perfil"]>): Squad {
  return comMembros(s, s.membros.map((m) => (m.slug === slug ? { ...m, perfil: { ...m.perfil, ...patch } } : m)));
}

/** O orquestrador não é removível (a squad sempre tem exatamente um). */
export function removerMembro(s: Squad, slug: string): Squad {
  const alvo = s.membros.find((m) => m.slug === slug);
  if (alvo === undefined || alvo.papel === "orchestrator") return s;
  return comMembros(s, s.membros.filter((m) => m.slug !== slug));
}

/** Duplica um membro (inclusive para outra CLI: o modelo some, pois a lista de modelos é da CLI). Orquestrador não duplica. */
export function duplicarMembro(s: Squad, slug: string, cli?: string): Squad {
  const origem = s.membros.find((m) => m.slug === slug);
  if (origem === undefined || origem.papel === "orchestrator" || s.membros.length >= LIMITES_SQUAD.membros_max) return s;
  const novo = slugLivre(origem.slug, new Set(s.membros.map((m) => m.slug)));
  const trocou = cli !== undefined && cli !== origem.perfil.cli;
  const copia: Membro = {
    ...origem,
    slug: novo,
    rotulo: `${origem.rotulo} 2`.slice(0, LIMITES_SQUAD.rotulo_max),
    prompt: caminhoPromptDe(novo),
    perfil: { ...origem.perfil, cli: cli ?? origem.perfil.cli, modelo: trocou ? null : origem.perfil.modelo },
    skills_permitidas: [...origem.skills_permitidas],
    mcps_permitidos: [...origem.mcps_permitidos],
    hooks: [...origem.hooks],
    orcamento: { ...origem.orcamento },
  };
  const i = s.membros.findIndex((m) => m.slug === slug);
  return comMembros(s, [...s.membros.slice(0, i + 1), copia, ...s.membros.slice(i + 1)]);
}

export interface AvisoDeMembro {
  membro: string;
  mensagem: string;
}
const temIntake = (cli: string): boolean => (CLIS_COM_INTAKE as readonly string[]).includes(cli);

/** Cadeado: aplica a CLI a todos mantendo papel e faixa; modelo que a CLI não oferece vira `default` (null), com aviso por membro. */
export function aplicarCadeado(s: Squad, cli: string, modelosDaCli: readonly string[]): { squad: Squad; avisos: AvisoDeMembro[] } {
  const avisos: AvisoDeMembro[] = [];
  const membros = s.membros.map((m) => {
    if (m.papel === "orchestrator" && cli !== "auto" && !temIntake(cli) && temIntake(m.perfil.cli)) {
      avisos.push({ membro: m.slug, mensagem: `o orquestrador mantém ${m.perfil.cli}: ${cli} não tem contrato de intake` });
      return m;
    }
    let modelo = m.perfil.modelo;
    if (modelo !== null && modelo !== "default" && m.perfil.cli !== cli && !modelosDaCli.includes(modelo)) {
      avisos.push({ membro: m.slug, mensagem: `o modelo ${modelo} não existe em ${cli}: voltou para o default da CLI` });
      modelo = null;
    } else if (modelo !== null && modelo !== "default" && m.perfil.cli === cli && !modelosDaCli.includes(modelo) && modelosDaCli.length > 0) {
      // mesma CLI e modelo personalizado ("outro…"): mantém
      modelo = m.perfil.modelo;
    }
    return { ...m, perfil: { ...m.perfil, cli, modelo } };
  });
  return { squad: comMembros(s, membros), avisos };
}

/** Pré-voo: aplica as substituições sugeridas (CLI ausente → instalada compatível). */
export function aplicarSubstituicoes(s: Squad, subs: readonly SubstituicaoCli[]): Squad {
  const por = new Map(subs.map((x) => [x.membro, x]));
  return comMembros(
    s,
    s.membros.map((m) => {
      const x = por.get(m.slug);
      return x === undefined || m.perfil.cli === x.para ? m : { ...m, perfil: { ...m.perfil, cli: x.para, modelo: null } };
    }),
  );
}

// ---- achados de validação ----
export function indiceDoAchado(a: Achado): number | null {
  const r = /^membros\[(\d+)\]/.exec(a.caminho);
  return r === null ? null : Number(r[1]);
}
export const achadosDoMembro = (achados: readonly Achado[], indice: number): Achado[] => achados.filter((a) => indiceDoAchado(a) === indice);
export const temErro = (achados: readonly Achado[]): boolean => achados.some((a) => a.severidade === "erro");
export function resumoDeAchados(achados: readonly Achado[]): { erros: number; avisos: number } {
  const erros = achados.filter((a) => a.severidade === "erro").length;
  return { erros, avisos: achados.length - erros };
}

/** Por que o botão Enviar fica desabilitado (null = pode enviar). Squad sem orquestrador nunca envia (CT-14.01). */
export function motivoDeNaoEnviar(s: Squad, achados: readonly Achado[]): string | null {
  if (s.membros.filter((m) => m.papel === "orchestrator").length !== 1) return "A squad precisa de exatamente 1 orquestrador.";
  const e = achados.find((a) => a.severidade === "erro");
  return e === undefined ? null : e.mensagem;
}
