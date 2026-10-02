// Serviço de squads (Fase 14, T-14.09). Camada fina e testável sobre a `LojaDeSquads` (arquivos = fonte da verdade, D-201):
// CRUD, duplicar de fábrica, atualização de fábrica em 3 vias, lixeira, prompt por membro (ler, gravar, prévia, restaurar),
// perfil por membro, opções de perfil por CLI e eventos de domínio. Sem Electron e sem I/O próprio: tudo entra por injeção.
// Regras que moram aqui (e não na UI): o erro de loja vira resultado nominal para o renderer; squad sem orquestrador,
// com dois ou sem revisor nunca é gravada (a validação de gravação da loja a recusa); fábrica nunca é escrita.
import type {
  AgenteResumo,
  Achado,
  EventoSquad,
  FabricaAtualizacao,
  FabricaDiff,
  ItemLixeiraSquad,
  Membro,
  OpcoesPerfilCli,
  PedidoApagarSquad,
  PedidoDuplicarSquad,
  PedidoFabricaAplicar,
  PedidoFabricaDiff,
  PedidoGravarPrompt,
  PedidoGravarSquad,
  PedidoListarSquads,
  PedidoPreviaPrompt,
  PromptLido,
  ResultadoGravarPrompt,
  ResultadoGravarSquad,
  ResultadoPreviaPrompt,
  Squad,
  SquadResumo,
} from "./tipos";
import { PADRAO_SLUG } from "./tipos";
import { LojaError, type LojaDeSquads } from "./loja";
import { extrairVariaveis, temErro, validarPrompt, validarSquad, type ContextoValidacao } from "./validar";
import { renderizarPromptDoMembro } from "./prompt";
import { snippetDeRigor } from "./rigor";
import { niveisDaCli, TABELA_ESFORCO_PADRAO, type TabelaEsforco } from "./esforco";
import { PRODUTO } from "../produto";
import { modelosDaFerramenta } from "../terminais/catalogo";

/** Campos de um membro que a UI pode mudar sem reenviar a squad inteira (o prompt tem canal próprio). */
export type MudancaDeMembro = Partial<Pick<Membro, "rotulo" | "descricao" | "papel" | "perfil" | "skills_permitidas" | "mcps_permitidos" | "hooks" | "max_instancias" | "orcamento" | "rigidez" | "permissao">>;
export interface PedidoAtualizarMembro {
  agent_id: string;
  hash_esperado: string;
  mudanca: MudancaDeMembro;
}

export interface DepsServicoSquads {
  loja: LojaDeSquads;
  /** eventos de domínio (`squad.saved`, `squad.deleted`, `squad.factory_update_available`…); barramento interno. */
  emitir?: (tipo: string, payload: Record<string, unknown>) => void;
  /** `squads:evento` para o renderer. */
  aoMudar?: (evento: EventoSquad) => void;
  /** invocações abertas por `agente_id` (`invocacao_agente`); ausente = 0. */
  vivasPorAgente?: (squad?: string) => Record<string, number>;
  /** contexto de validação (CLIs instaladas, skills/MCPs conhecidos, permissão do workspace); lido a cada validação. */
  contextoDe?: (workspaceId: string | null) => ContextoValidacao;
  cliInstalada?: (cli: string) => boolean;
  tabelaEsforco?: () => TabelaEsforco;
}

/** `<squad>.<membro>` → partes; `null` se o formato não é de agent_id. Slugs nunca têm ponto. */
export function partirAgentId(agentId: string): { squad: string; membro: string } | null {
  const i = agentId.indexOf(".");
  if (i <= 0) return null;
  const squad = agentId.slice(0, i);
  const membro = agentId.slice(i + 1);
  return PADRAO_SLUG.test(squad) && PADRAO_SLUG.test(membro) ? { squad, membro } : null;
}

/** `<slug>-<AAAAMMDDHHMMSS>-<hex4>` → item da lixeira (a data vem do nome; nunca do relógio atual). */
export function itemDaLixeira(nome: string): ItemLixeiraSquad {
  const m = /^(.+)-(\d{14})-[0-9a-f]{4}$/.exec(nome);
  if (m === null) return { nome, slug: nome, apagada_em: null };
  const d = m[2] as string;
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:${d.slice(10, 12)}:${d.slice(12, 14)}.000Z`;
  return { nome, slug: m[1] as string, apagada_em: Number.isNaN(Date.parse(iso)) ? null : iso };
}

const TAREFA_DO_PAPEL: Record<Membro["papel"], string> = {
  orchestrator: "Planeje o objetivo, divida em cards, delegue aos agentes da squad (agent_list e agent_invoke) e só conclua a Missão depois do handoff ok do revisor.",
  scout: "Explore o código e a documentação do card, sem alterar nada, e entregue um relatório com evidências (arquivo:linha).",
  executor: "Implemente o card dentro do escopo travado no briefing, com testes, e entregue o handoff com a evidência.",
  reviewer: "Revise o entregue contra o contrato do card, de forma independente; aprove só com evidência.",
};
/** Prompt inicial de um membro novo (o usuário o edita depois). Só variáveis fechadas; nada de caminho nem segredo. */
export function promptInicialDe(m: Pick<Membro, "papel" | "rotulo">): string {
  return `# {{rotulo}} — {{squad}}\n\nVocê é o ${m.rotulo.replace(/[\r\n{}]/g, " ").trim() || "membro"} desta squad. ${TAREFA_DO_PAPEL[m.papel]}\n\n## Objetivo\n{{objetivo}}\n\n## Contexto\n{{contexto_rag}}\n\n## Rigor\n{{rigor}}\n`;
}

const EXEMPLO_PADRAO = { objetivo: "(objetivo de exemplo: descreva aqui o que a squad deve entregar)", arquivos: ["src/exemplo.ts", "src/exemplo.test.ts"] } as const;
const CONTEXTO_RAG_EXEMPLO = "(contexto de exemplo do RAG: este bloco é fictício na prévia)";

export function criarServicoSquads(deps: DepsServicoSquads) {
  const { loja } = deps;
  const emitir = (tipo: string, payload: Record<string, unknown>): void => deps.emitir?.(tipo, payload);
  const tabela = (): TabelaEsforco => deps.tabelaEsforco?.() ?? TABELA_ESFORCO_PADRAO;
  const contexto = (workspaceId: string | null): ContextoValidacao => deps.contextoDe?.(workspaceId) ?? {};

  /** erro de loja que o renderer entende como resultado (o resto continua sendo exceção). */
  function resultadoDeErro(e: unknown): Extract<ResultadoGravarSquad, { ok: false }> {
    if (e instanceof LojaError && (e.codigo === "fabrica_somente_leitura" || e.codigo === "conflito_de_hash" || e.codigo === "invalida")) {
      return { ok: false, erro: e.codigo, achados: e.achados };
    }
    throw e;
  }

  function exigirAgente(agentId: string): { squad: string; membro: string } {
    const p = partirAgentId(agentId);
    if (p === null) throw new LojaError("nao_encontrada", "identificador de agente inválido");
    return p;
  }

  const salvou = (slug: string): void => {
    emitir("squad.saved", { slug });
    deps.aoMudar?.({ slug, tipo: "gravada" });
  };

  const api = {
    /** Carrega em ocioso. Avisa (evento) as cópias cuja fábrica subiu de versão. */
    async carregar(): Promise<void> {
      await loja.carregar();
      for (const r of loja.listar()) if (r.atualizacao_de_fabrica) emitir("squad.factory_update_available", { slug: r.slug });
    },
    /** Relê o disco (edição fora do app) e avisa o renderer. */
    async recarregar(): Promise<EventoSquad[]> {
      const ev = await loja.recarregar();
      for (const e of ev) deps.aoMudar?.(e);
      return ev;
    },

    listar: (filtro: PedidoListarSquads = {}): SquadResumo[] => loja.listar(filtro),
    obter: (slug: string): Squad => loja.obter(slug),
    emUso: (slug: string): boolean => loja.listar().find((r) => r.slug === slug)?.em_uso ?? false,
    avisosDeCarga: (): string[] => loja.avisos(),

    /** Lista plana de agentes (membros de todas as squads, ou de uma). */
    listarAgentes(squad?: string): AgenteResumo[] {
      const vivas = deps.vivasPorAgente?.(squad) ?? {};
      const saida: AgenteResumo[] = [];
      for (const r of loja.listar()) {
        if (squad !== undefined && r.slug !== squad) continue;
        for (const m of loja.obter(r.slug).membros) {
          const id = `${r.slug}.${m.slug}`;
          saida.push({ agent_id: id, squad: r.slug, rotulo: m.rotulo, papel: m.papel, perfil: { ...m.perfil }, vivos: vivas[id] ?? 0 });
        }
      }
      return saida;
    },

    /** Membro de uma squad pelo `agent_id`; lança `nao_encontrada` se a squad ou o membro não existem. */
    membroDe(agentId: string): { squad: Squad; membro: Membro } {
      const p = exigirAgente(agentId);
      const squad = loja.obter(p.squad);
      const membro = squad.membros.find((m) => m.slug === p.membro);
      if (membro === undefined) throw new LojaError("nao_encontrada", `membro não encontrado: ${p.membro.slice(0, 40)}`);
      return { squad, membro };
    },

    /** Gravar: orquestrador obrigatório, revisor obrigatório, `hash_esperado` contra edição concorrente, fábrica recusada. */
    async gravar(p: PedidoGravarSquad): Promise<ResultadoGravarSquad> {
      try {
        // membro novo (squad nova ou membro acrescentado) nasce com um prompt inicial do papel; os existentes mantêm o arquivo
        const atuais = loja.listar().some((r) => r.slug === p.squad.slug) ? new Set(loja.obter(p.squad.slug).membros.map((m) => m.slug)) : new Set<string>();
        const iniciais: Record<string, string> = {};
        for (const m of p.squad.membros) if (!atuais.has(m.slug)) iniciais[m.slug] = promptInicialDe(m);
        const r = await loja.gravar(p.squad, Object.keys(iniciais).length === 0 ? undefined : iniciais, p.hash_esperado);
        salvou(r.squad.slug);
        return { ok: true, squad: r.squad, hash: r.hash, achados: r.achados };
      } catch (e) {
        return resultadoDeErro(e);
      }
    },

    /** Validação ao vivo de um rascunho (nunca grava). `cli_nao_instalada` só entra quando há workspace. */
    validar(squad: Squad, workspaceId: string | null): Achado[] {
      const ctx = contexto(workspaceId);
      if (workspaceId === null) return validarSquad(squad, { ...ctx, clisInstaladas: null });
      const instaladas = ctx.clisInstaladas ?? (deps.cliInstalada === undefined ? null : [...new Set(squad.membros.map((m) => m.perfil.cli))].filter((c) => deps.cliInstalada?.(c) === true));
      return validarSquad(squad, { ...ctx, clisInstaladas: instaladas });
    },

    async duplicar(p: PedidoDuplicarSquad): Promise<Squad> {
      const s = await loja.duplicar(p.slug, p.novo_slug, p.novo_nome);
      salvou(s.slug);
      return s;
    },

    async apagar(p: PedidoApagarSquad): Promise<{ ok: true }> {
      await loja.apagar(p.slug, p.confirmar_slug);
      emitir("squad.deleted", { slug: p.slug });
      deps.aoMudar?.({ slug: p.slug, tipo: "apagada" });
      return { ok: true };
    },

    fabricaAtualizacao: (slug: string): Promise<FabricaAtualizacao> => loja.fabricaAtualizacao(slug),
    fabricaDiff: (p: PedidoFabricaDiff): Promise<FabricaDiff> => loja.fabricaDiff(p.slug, p.membro),
    async fabricaAplicar(p: PedidoFabricaAplicar): Promise<Squad> {
      // `sobrescrever_editados` só vale para quem também está em `membros`: a escolha do usuário é sempre explícita
      const sobrescrever = (p.sobrescrever_editados ?? []).filter((m) => p.membros.includes(m));
      const s = await loja.fabricaAplicar(p.slug, p.membros, sobrescrever);
      salvou(s.slug);
      return s;
    },

    // ---------- lixeira ----------
    /** Squads apagadas (a pasta só é movida; nunca removida). Mais recentes primeiro. */
    async listarLixeira(): Promise<ItemLixeiraSquad[]> {
      const nomes = await loja.listarLixeira();
      return nomes.map(itemDaLixeira).sort((a, b) => (b.apagada_em ?? "").localeCompare(a.apagada_em ?? "") || a.nome.localeCompare(b.nome));
    },
    async restaurarDaLixeira(nome: string): Promise<Squad> {
      const s = await loja.restaurar(nome);
      salvou(s.slug);
      return s;
    },

    /** Muda perfil/limites/permissões de UM membro (o resto da squad e o prompt ficam como estão). */
    async atualizarMembro(p: PedidoAtualizarMembro): Promise<ResultadoGravarSquad> {
      const { squad, membro } = api.membroDe(p.agent_id);
      const novo: Squad = { ...squad, membros: squad.membros.map((m) => (m.slug === membro.slug ? { ...m, ...structuredClone(p.mudanca) } : m)) };
      return api.gravar({ squad: novo, hash_esperado: p.hash_esperado });
    },

    // ---------- prompt por membro ----------
    async lerPrompt(agentId: string): Promise<PromptLido> {
      const p = exigirAgente(agentId);
      return loja.lerPrompt(p.squad, p.membro);
    },

    async gravarPrompt(p: PedidoGravarPrompt): Promise<ResultadoGravarPrompt> {
      const a = exigirAgente(p.agent_id);
      try {
        const r = await loja.gravarPrompt(a.squad, a.membro, p.texto, p.hash_esperado);
        salvou(a.squad);
        return { ok: true, hash: r.hash, achados: r.achados };
      } catch (e) {
        const r = resultadoDeErro(e);
        return { ok: false, erro: r.erro, achados: r.achados };
      }
    },

    /** Volta o prompt de uma cópia de fábrica ao texto original. */
    async restaurarPrompt(agentId: string): Promise<{ hash: string }> {
      const a = exigirAgente(agentId);
      const r = await loja.restaurarPrompt(a.squad, a.membro);
      salvou(a.squad);
      return r;
    },

    /**
     * Prévia com valores de EXEMPLO fixos: nunca consulta o RAG real nem lê o workspace. Os blocos de dado aparecem
     * marcados (`<dado …>`), como na execução. `texto` ad hoc tem precedência sobre o arquivo do agente.
     */
    async previaPrompt(p: PedidoPreviaPrompt): Promise<ResultadoPreviaPrompt> {
      let squadNome = "Squad de exemplo";
      let membroSlug = "membro";
      let rotulo = "Membro de exemplo";
      let texto = p.texto;
      if (p.agent_id !== null) {
        const { squad, membro } = api.membroDe(p.agent_id);
        squadNome = squad.nome;
        membroSlug = membro.slug;
        rotulo = membro.rotulo;
        texto ??= (await api.lerPrompt(p.agent_id)).texto;
      }
      if (texto === undefined) throw new LojaError("invalida", "nada para pré-visualizar (agent_id ou texto)");
      const exemplo = p.exemplo ?? EXEMPLO_PADRAO;
      const renderizado = renderizarPromptDoMembro(texto, {
        objetivo: exemplo.objetivo,
        contexto_rag: CONTEXTO_RAG_EXEMPLO,
        arquivos: exemplo.arquivos,
        squad: squadNome,
        membro: membroSlug,
        rotulo,
        missao: "missao-exemplo",
        card: "t-1",
        pasta: `${PRODUTO.pastaNoProjeto}/missoes/missao-exemplo`,
        rigor: snippetDeRigor(null),
      });
      return { renderizado, variaveis_usadas: extrairVariaveis(texto), achados: validarPrompt(texto) };
    },

    /** Opções do seletor de perfil de uma CLI (`agentes:perfil_opcoes`): modelos, níveis de esforço, modo e instalada. */
    perfilOpcoes(cli: string): OpcoesPerfilCli {
      const modelos = modelosDaFerramenta(cli).map((m) => ({ modelo: m.modelo, ...(m.padrao === true ? { padrao: true } : {}) }));
      let niveis: string[] = [];
      let modo: OpcoesPerfilCli["esforco_modo"] = "nenhum";
      try {
        const n = niveisDaCli(cli, tabela());
        niveis = n.niveis;
        modo = n.modo;
      } catch {
        // CLI fora da tabela: sem esforço configurável
      }
      return { modelos, niveis_esforco: niveis, esforco_modo: modo, instalada: deps.cliInstalada?.(cli) ?? false };
    },

    /** Squad pronta para uma Missão: existe, tem 0 erros de validação e todos os prompts são válidos (lidos agora). */
    async prontaParaExecutar(slug: string, workspaceId: string | null): Promise<{ ok: boolean; achados: Achado[] }> {
      const squad = loja.obter(slug);
      const achados: Achado[] = [...api.validar(squad, workspaceId)];
      for (const [i, m] of squad.membros.entries()) {
        const texto = (await loja.lerPrompt(slug, m.slug)).texto;
        achados.push(...validarPrompt(texto, `membros[${i}].prompt`));
      }
      return { ok: !temErro(achados), achados };
    },
  };
  return api;
}
export type ServicoSquads = ReturnType<typeof criarServicoSquads>;
