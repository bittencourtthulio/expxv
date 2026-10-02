// "Contexto do projeto" (D-495): o que o método GERA com comandos depois da suíte instalada (convenções, design system, produto, memória, perfil do legado).
// NÃO é instalação: é artefato que uma skill grava no repositório. Funções PURAS: situação de cada item, linhas para a tela, resumo e ordem da sequência
// "Gerar o que falta". O app só lê o índice (D-04) e dispara `/expx:<skill>` (D-20); quem escreve o arquivo é a skill.
import type { GestoMetodo } from "../../compartilhado/dominio";
import type { ModuloId } from "../suite/modulos";
import { comandoDeContexto } from "./comandos";
import type { CamadaComData, CamadasProjeto } from "./tipos";

export type ContextoId = "convencoes" | "design_system" | "produto" | "memoria" | "perfil_legado";

export interface DefContexto {
  id: ContextoId;
  chave: CamadaComData & keyof CamadasProjeto;
  modulo: ModuloId;
  gesto: GestoMetodo;
  /** linguagem simples */
  nome: string;
  /** uma frase: para que serve */
  paraQue: string;
  /** arquivo que a skill grava (relativo à raiz do projeto) */
  artefato: string;
}

/** Ordem de exibição. */
export const CONTEXTOS: readonly DefContexto[] = [
  { id: "convencoes", chave: "convencoes", modulo: "stackx", gesto: "gerar_convencoes", nome: "Convenções do stack", paraQue: "Descobre as convenções do seu código para os agentes seguirem.", artefato: "docs/stack/CONVENCOES.md" },
  { id: "design_system", chave: "design_system", modulo: "designx", gesto: "gerar_design_system", nome: "Design system", paraQue: "Mapeia cores, tipografia e componentes para as telas novas ficarem coerentes.", artefato: "docs/design-system/DESIGN-SYSTEM.md" },
  { id: "produto", chave: "produto", modulo: "prodx", gesto: "gerar_produto", nome: "Contexto de produto", paraQue: "Registra o que o produto é e não é, para decidir se um pedido vale a pena.", artefato: "docs/produto/PRODUTO.md" },
  { id: "memoria", chave: "memoria", modulo: "memox", gesto: "gerar_memoria", nome: "Memória do projeto", paraQue: "Indexa relatórios, causas raiz e decisões para os agentes lembrarem do que já aconteceu.", artefato: ".expx/memoria/indice.json" },
  { id: "perfil_legado", chave: "perfil_legado", modulo: "legadox", gesto: "gerar_perfil_legado", nome: "Perfil do legado", paraQue: "Mapeia um sistema antigo e as zonas de risco antes de mexer nele.", artefato: "docs/legado/PERFIL.md" },
];

/** Ordem da sequência "Gerar o que falta": convenções primeiro (os demais as consultam), depois produto, memória e design system; o legado por último. */
export const ORDEM_DA_SEQUENCIA: readonly ContextoId[] = ["convencoes", "produto", "memoria", "design_system", "perfil_legado"];

export type SituacaoContexto = "gerado" | "ausente" | "desligado" | "indisponivel";

export interface EntradaContexto {
  camadas: Pick<CamadasProjeto, CamadaComData & keyof CamadasProjeto>;
  mtime?: Partial<Record<CamadaComData, string>> | undefined;
  /** módulo → ligado; `null` = ainda não lido (não bloqueia nada) */
  modulos: Readonly<Record<string, boolean>> | null;
  /** a suíte está instalada; `null` = desconhecido (fora do app ou ainda lendo) */
  suiteInstalada: boolean | null;
  /** skills que o lock da suíte diz faltar */
  skillsFaltando?: readonly string[];
}

export interface LinhaContexto {
  def: DefContexto;
  situacao: SituacaoContexto;
  /** ISO da modificação do arquivo (só `gerado`, e só quando medida) */
  data: string | null;
  /** o comando exato (forma do Claude Code), para copiar */
  comando: string;
  /** frase do estado, em linguagem simples */
  texto: string;
}

/** Gerado vence tudo (o arquivo existe, mesmo com o módulo desligado depois); suíte/módulo ausente vence "desligado"; senão, falta gerar. */
export function situacaoDoContexto(def: DefContexto, e: EntradaContexto): SituacaoContexto {
  if (e.camadas[def.chave]) return "gerado";
  if (e.suiteInstalada === false) return "indisponivel";
  if ((e.skillsFaltando ?? []).includes(def.modulo)) return "indisponivel";
  if (e.modulos !== null) {
    const ligado = e.modulos[def.modulo];
    if (ligado === undefined) return "indisponivel";
    if (!ligado) return "desligado";
  }
  return "ausente";
}

const TEXTO: Record<SituacaoContexto, (def: DefContexto) => string> = {
  gerado: () => "Gerado",
  ausente: () => "Ainda não gerado",
  desligado: (d) => `Desligado — módulo ${d.modulo} desligado`,
  indisponivel: () => "Indisponível: suíte não instalada ou módulo ausente",
};

export function linhasDoContexto(e: EntradaContexto): LinhaContexto[] {
  return CONTEXTOS.map((def) => {
    const situacao = situacaoDoContexto(def, e);
    return {
      def,
      situacao,
      data: situacao === "gerado" ? e.mtime?.[def.chave] ?? null : null,
      comando: comandoDeContexto(def.gesto, "claude").comando,
      texto: TEXTO[situacao](def),
    };
  });
}

/** "Contexto do projeto: 2 de 4 gerados". Só conta o que pode ser gerado (gerado ou ausente); desligado/indisponível fica de fora da conta. */
export function resumoDoContexto(linhas: readonly LinhaContexto[]): string {
  const contaveis = linhas.filter((l) => l.situacao === "gerado" || l.situacao === "ausente");
  const gerados = contaveis.filter((l) => l.situacao === "gerado").length;
  if (contaveis.length === 0) return "Contexto do projeto: nada disponível para gerar agora";
  if (gerados === contaveis.length) return `Contexto do projeto: ${gerados === 1 ? "o único disponível está gerado" : `todos os ${gerados} gerados`}`;
  if (gerados === 0) return `Contexto do projeto: nada gerado ainda (0 de ${contaveis.length})`;
  return `Contexto do projeto: ${gerados} de ${contaveis.length} ${contaveis.length === 1 ? "gerado" : "gerados"}`;
}

/** O que a sequência dispara, na ordem: só o que está `ausente` (módulo ligado e disponível); nunca o desligado, nunca o já gerado. */
export function sequenciaDoQueFalta(linhas: readonly LinhaContexto[]): ContextoId[] {
  const faltam = new Set(linhas.filter((l) => l.situacao === "ausente").map((l) => l.def.id));
  return ORDEM_DA_SEQUENCIA.filter((id) => faltam.has(id));
}

export const defDoContexto = (id: ContextoId): DefContexto => CONTEXTOS.find((c) => c.id === id) as DefContexto;

/** Data curta em pt-BR ("04/03/2026"); inválida vira `null`. Fuso local. */
export function formatarDataDoContexto(iso: string | null | undefined): string | null {
  if (iso === null || iso === undefined) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString("pt-BR");
}
