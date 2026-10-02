// Portabilidade de squads (Fase 14, T-14.10; D-207, D-208). Exportar para `<repo>/<pasta do produto>/squads/<slug>/` (configuração se
// versiona; o app nunca comita nem escreve em `docs/**`) ou para um arquivo escolhido no seletor nativo do main; importar com
// PRÉVIA obrigatória. Importação é NÃO CONFIÁVEL: remove MCPs e hooks, filtra skills ao catálogo, marca `importada`, não executa
// nada, recusa segredo e caminho absoluto. O renderer nunca envia nem recebe caminho: só `repo`/`arquivo` e um id de prévia.
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Achado, EventoSquad, PedidoExportarSquad, PedidoImportarConfirmar, PedidoImportarPrevia, PreviaImportacao, ResultadoExportarSquad, Squad } from "./tipos";
import { PADRAO_SLUG } from "./tipos";
import { LojaError, type LojaDeSquads, type PacoteSquad, type PreviaDeImportacao } from "./loja";
import { contemCaminhoAbsoluto, contemCaminhoAbsolutoEmValores, validarPrompt } from "./validar";

const LIMITE_ARQUIVO = 2 * 1024 * 1024;
const TTL_PADRAO_MS = 10 * 60 * 1000;
const MAX_PREVIAS = 8;

export interface DepsPortabilidade {
  loja: LojaDeSquads;
  /** raiz do workspace (absoluta, só no main); `null` = workspace desconhecido. */
  raizDoWorkspace(workspaceId: string): string | null;
  /** pasta do produto dentro do repositório (`.<id>`); vem de `PRODUTO.pastaNoProjeto`, nunca literal aqui. */
  pastaProduto: string;
  /** seletor nativo de "salvar como"; devolve o caminho absoluto escolhido ou `null` (cancelado). */
  escolherDestino(nomeSugerido: string): Promise<string | null>;
  /** seletor nativo de "abrir"; `null` = cancelado. */
  escolherOrigem(): Promise<string | null>;
  /** catálogo de skills conhecidas (Fase 7 ou lista embarcada); `null`/ausente = não filtra. */
  skillsConhecidas?: () => ReadonlySet<string> | null;
  emitir?: (tipo: string, payload: Record<string, unknown>) => void;
  aoMudar?: (evento: EventoSquad) => void;
  agora?: () => number;
  ttlMs?: number;
}

interface PreviaGuardada {
  previa: PreviaDeImportacao;
  expiraEm: number;
}

const achado = (codigo: Achado["codigo"], caminho: string, mensagem: string): Achado => ({ severidade: "erro", codigo, caminho, mensagem });

/** O pacote exportado não pode carregar segredo nem caminho absoluto (D-207, T-14.27). Lança `invalida`. */
function exigirPacoteLimpo(pacote: PacoteSquad): void {
  const achados: Achado[] = [];
  for (const [membro, texto] of Object.entries(pacote.prompts)) {
    achados.push(...validarPrompt(texto, `prompts.${membro}`).filter((a) => a.codigo === "prompt_com_segredo"));
    if (contemCaminhoAbsoluto(texto)) achados.push(achado("limite_invalido", `prompts.${membro}`, "O prompt cita um caminho absoluto; use caminhos relativos ao repositório."));
  }
  if (contemCaminhoAbsolutoEmValores(pacote.squad)) achados.push(achado("limite_invalido", "squad", "A squad cita um caminho absoluto; use caminhos relativos."));
  if (achados.length > 0) throw new LojaError("invalida", "A squad tem segredo ou caminho absoluto e não pode ser exportada.", achados);
}

export function criarPortabilidade(deps: DepsPortabilidade) {
  const { loja } = deps;
  const agora = deps.agora ?? ((): number => Date.now());
  const ttl = deps.ttlMs ?? TTL_PADRAO_MS;
  const emitir = (tipo: string, payload: Record<string, unknown>): void => deps.emitir?.(tipo, payload);
  const previas = new Map<string, PreviaGuardada>();

  function podar(): void {
    const t = agora();
    for (const [id, p] of previas) if (p.expiraEm <= t) previas.delete(id);
    while (previas.size >= MAX_PREVIAS) {
      const primeiro = previas.keys().next().value;
      if (primeiro === undefined) break;
      previas.delete(primeiro);
    }
  }

  const raizOu = (workspaceId: string | undefined): string => {
    const raiz = workspaceId === undefined ? null : deps.raizDoWorkspace(workspaceId);
    if (raiz === null) throw new LojaError("destino_invalido", "workspace desconhecido");
    return raiz;
  };

  async function gravarArquivoAtomico(caminho: string, texto: string): Promise<void> {
    const existente = await lstat(caminho).catch(() => null);
    if (existente !== null && (existente.isSymbolicLink() || !existente.isFile())) throw new LojaError("destino_invalido", "O destino escolhido não é um arquivo comum.");
    await mkdir(dirname(caminho), { recursive: true });
    const tmp = `${caminho}.tmp-${process.pid}-${randomBytes(3).toString("hex")}`;
    try {
      await writeFile(tmp, texto, { mode: 0o644, flag: "wx" });
      await rename(tmp, caminho);
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw e;
    }
  }

  async function exportar(p: PedidoExportarSquad): Promise<ResultadoExportarSquad> {
    // valida ANTES de qualquer escrita (e antes do seletor): segredo ou caminho absoluto recusam tudo
    const pacote = JSON.parse(await loja.exportarJson(p.slug)) as PacoteSquad;
    exigirPacoteLimpo(pacote);
    if (p.destino === "repo") {
      const raiz = raizOu(p.workspace_id);
      const r = await loja.exportarParaRepositorio(p.slug, { raiz, pastaProduto: deps.pastaProduto });
      emitir("squad.exported", { slug: p.slug, destino: "repo" });
      return { caminho_relativo: r.caminho_relativo };
    }
    const alvo = await deps.escolherDestino(`${p.slug}.squad.json`);
    if (alvo === null) throw new LojaError("destino_invalido", "Exportação cancelada.");
    await gravarArquivoAtomico(alvo, `${JSON.stringify(pacote, null, 2)}\n`);
    emitir("squad.exported", { slug: p.slug, destino: "arquivo" });
    return { caminho_relativo: null };
  }

  /** Nada de caminho absoluto entra: o que passou pela loja ainda é varrido (squad e prompts). */
  function recusarCaminhoAbsoluto(previa: PreviaDeImportacao): void {
    if (contemCaminhoAbsolutoEmValores(previa.squad) || Object.values(previa.prompts).some((t) => contemCaminhoAbsoluto(t))) throw new LojaError("importacao_invalida", "A squad importada cita um caminho absoluto de outra máquina; recusada.");
  }

  async function lerArquivoDeImportacao(caminho: string): Promise<string> {
    const st = await lstat(caminho).catch(() => null);
    if (st === null) throw new LojaError("importacao_invalida", "O arquivo não existe.");
    if (st.isSymbolicLink() || !st.isFile()) throw new LojaError("importacao_invalida", "Escolha um arquivo comum (não atalho nem pasta).");
    if (st.size > LIMITE_ARQUIVO) throw new LojaError("importacao_invalida", "O arquivo é grande demais para importar.");
    return readFile(caminho, "utf8");
  }

  async function importarPrevia(p: PedidoImportarPrevia): Promise<PreviaImportacao> {
    const opc = { skillsConhecidas: deps.skillsConhecidas?.() ?? null };
    let previa: PreviaDeImportacao;
    if (p.origem === "repo") {
      if (p.nome === undefined || !PADRAO_SLUG.test(p.nome)) throw new LojaError("destino_invalido", "nome da squad inválido");
      previa = await loja.importarDoRepositorio(p.nome, { raiz: raizOu(p.workspace_id), pastaProduto: deps.pastaProduto }, opc);
    } else {
      const origem = await deps.escolherOrigem();
      if (origem === null) throw new LojaError("destino_invalido", "Importação cancelada.");
      previa = loja.importarPrevia(await lerArquivoDeImportacao(origem), opc);
    }
    recusarCaminhoAbsoluto(previa);
    podar();
    const id = `prv_${randomBytes(8).toString("hex")}`;
    previas.set(id, { previa, expiraEm: agora() + ttl });
    return { previa_id: id, squad: structuredClone(previa.squad), achados: previa.achados, mcps_removidos: previa.mcps_removidos, skills_removidas: previa.skills_removidas, prompts: { ...previa.prompts } };
  }

  function guardada(id: string): PreviaGuardada {
    const g = previas.get(id);
    if (g === undefined || g.expiraEm <= agora()) {
      previas.delete(id);
      throw new LojaError("importacao_invalida", "A prévia expirou ou não existe; importe de novo.");
    }
    return g;
  }

  return {
    exportar,
    importarPrevia,
    /** Texto completo dos prompts da prévia (a UI os mostra ANTES de confirmar; nunca vão para o disco antes). */
    promptsDaPrevia(previaId: string): Record<string, string> {
      return { ...guardada(previaId).previa.prompts };
    },
    async importarConfirmar(p: PedidoImportarConfirmar): Promise<Squad> {
      const g = guardada(p.previa_id);
      const r = await loja.importarConfirmar(g.previa, p.slug);
      previas.delete(p.previa_id); // uso único: só some depois de gravar (erro de slug deixa tentar de novo)
      emitir("squad.imported", { slug: r.squad.slug });
      deps.aoMudar?.({ slug: r.squad.slug, tipo: "gravada" });
      return r.squad;
    },
    /** Só para diagnóstico/teste. */
    previasPendentes: (): number => previas.size,
  };
}
export type Portabilidade = ReturnType<typeof criarPortabilidade>;
