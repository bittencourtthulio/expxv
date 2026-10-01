// Registro de comandos da paleta (⌘K / Ctrl+Shift+P). Puro: recebe o contexto (workspace, recentes,
// trabalhos do método, tema) e devolve a lista de comandos; quem executa são as `acoes` injetadas.
// Comando só aparece quando faz sentido: sem workspace não há "Nova Missão" nem "Novo terminal".
import { TELAS, type TelaId } from "../casca/telas";
import { pedirAcao, pedirTela } from "./navegacao";

export type GrupoComando = "Navegar" | "Ações" | "Tema" | "Método" | "Workspaces";

export interface Comando {
  id: string;
  titulo: string;
  grupo: GrupoComando;
  detalhe?: string;
  atalho?: string;
  /** texto extra só para a busca (sinônimos). */
  busca?: string;
  executar: () => void;
}

export interface AcoesPaleta {
  navegar(tela: TelaId): void;
  abrirProjeto(): void;
  novaMissao(): void;
  novoTerminal(): void;
  alternarTema(): void;
  irParaWorkspace(id: string): void;
  abrirTrabalho(id: string): void;
}

export interface ContextoPaleta {
  mac: boolean;
  workspaceAtual: { id: string; nome: string } | null;
  recentes: ReadonlyArray<{ id: string; nome: string; raiz?: string }>;
  trabalhos: ReadonlyArray<{ id: string; titulo: string; tipo: string; estagio: string }>;
  temaEfetivo: "claro" | "escuro";
  acoes: AcoesPaleta;
}

/** Teto de itens de "trabalho" e "workspace" no registro (a busca é local, mas a lista é curta e barata). */
const MAX_TRABALHOS = 2000;
const MAX_RECENTES = 30;

export function montarComandos(c: ContextoPaleta): Comando[] {
  const { acoes } = c;
  const tecla = (mac: string, outro: string) => (c.mac ? mac : outro);
  const lista: Comando[] = [];
  for (const t of TELAS) {
    lista.push({ id: `ir:${t.id}`, titulo: `Ir para ${t.rotulo}`, grupo: "Navegar", executar: () => acoes.navegar(t.id) });
  }
  lista.push({ id: "abrir-projeto", titulo: "Abrir projeto…", grupo: "Ações", detalhe: "Escolher uma pasta", busca: "workspace pasta", executar: acoes.abrirProjeto });
  if (c.workspaceAtual !== null) {
    lista.push({ id: "nova-missao", titulo: "Nova Missão", grupo: "Ações", detalhe: c.workspaceAtual.nome, executar: acoes.novaMissao });
    lista.push({ id: "novo-terminal", titulo: "Novo terminal", grupo: "Ações", atalho: tecla("⌘N", "Ctrl+Shift+N"), busca: "aba sessao", executar: acoes.novoTerminal });
  }
  lista.push({
    id: "tema", titulo: c.temaEfetivo === "escuro" ? "Trocar para tema claro" : "Trocar para tema escuro", grupo: "Tema",
    atalho: tecla("⌘⇧L", "Ctrl+Shift+L"), busca: "tema claro escuro aparencia", executar: acoes.alternarTema,
  });
  for (const t of c.trabalhos.slice(0, MAX_TRABALHOS)) {
    lista.push({ id: `trabalho:${t.id}`, titulo: t.titulo, grupo: "Método", detalhe: `${t.id} · ${t.tipo} · ${t.estagio}`, busca: t.id, executar: () => acoes.abrirTrabalho(t.id) });
  }
  for (const w of c.recentes.slice(0, MAX_RECENTES)) {
    if (w.id === c.workspaceAtual?.id) continue;
    lista.push({ id: `ws:${w.id}`, titulo: `Ir para ${w.nome}`, grupo: "Workspaces", detalhe: "workspace recente", busca: w.nome, executar: () => acoes.irParaWorkspace(w.id) });
  }
  return lista;
}

/** Texto pesquisável de um comando (título + detalhe + sinônimos). */
export const textoDeBusca = (c: Comando): string => `${c.titulo} ${c.detalhe ?? ""} ${c.busca ?? ""}`;

/**
 * Ações ligadas à casca por eventos próprios (`estado/navegacao`): navegar pede a tela; "Nova Missão" e
 * "Novo terminal" pedem a ação à tela dona, que a trata (mesmo se ainda estiver carregando).
 */
export function criarAcoesDom(extras: Pick<AcoesPaleta, "abrirProjeto" | "alternarTema" | "irParaWorkspace">): AcoesPaleta {
  return {
    ...extras,
    navegar: (tela) => pedirTela(tela),
    novaMissao() { pedirTela("missoes"); pedirAcao("nova-missao"); },
    novoTerminal() { pedirTela("terminais"); pedirAcao("novo-terminal"); },
    abrirTrabalho() { pedirTela("metodo"); },
  };
}
