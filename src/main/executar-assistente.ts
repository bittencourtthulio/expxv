// Assistente de execução com IA no main (D-582…): "Configurar com IA" do ▶. Fluxo: PRÉVIA (o que será enviado, CLI e custo estimado) → CONSENTIMENTO
// (amarrado ao hash do dossiê exato) → proposta em segundo plano (dossiê redigido, CLI headless SEM ferramentas, validação rígida, 1 retentativa, fallback
// determinístico) → REVISÃO humana → SALVAR (só então grava no arquivo de configurações de execução da pasta do produto pelo MESMO serviço de execução). A IA nunca concede confiança: a
// primeira execução continua pedindo a confirmação normal. Um assistente por workspace por vez. Nada é executado pela análise. O conteúdo do projeto e da
// resposta NUNCA vai ao log nem ao `evento_dominio` (só contagens).
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { CLIS_ASSISTENTE, LIMITE_TEMPO_ASSISTENTE_S, type CliAssistente, type CodigoErroAssistente, type ErroAssistenteIpc, type EventoAssistente, type PreviaAssistente, type PropostaItemIpc, type ResultadoAssistente } from "../compartilhado/executar-assistente";
import type { ConfigExecucaoIpc, ListaExecucao } from "../compartilhado/executar";
import { leitorDeDisco } from "../nucleo/executar/armazem";
import { detectarConfiguracoes, type LeitorProjeto } from "../nucleo/executar/detectar";
import { montarDossie, type Dossie } from "../nucleo/executar/assistente/dossie";
import { ErroAssistente, executarPipeline, type PortaLlmAssistente } from "../nucleo/executar/assistente/pipeline";
import { LIMITES_IA } from "../nucleo/executar/assistente/validar-ia";
import { resolverCwd } from "../nucleo/executar/resolver";
import { validarConfig } from "../nucleo/executar/validacao";
import { redigirSegredos } from "../nucleo/privacidade/redacao";
import { ErroExecutar, type ServicoExecutar } from "./executar";
import type { CliAssistenteMain } from "./executar-assistente-cli";

export interface DependenciasAssistente {
  raizDe(workspaceId: string): string | null;
  /** o serviço de execução (grava no MESMO arquivo e validador do editor) */
  executar(): Promise<Pick<ServicoExecutar, "listar" | "gravarConfig" | "definirPadrao">>;
  cli: CliAssistenteMain;
  /** redação extra (cofre aberto); o padrão do app é aplicado sempre */
  redigir?(): Promise<(texto: string) => string>;
  emitir(evento: EventoAssistente): void;
  /** `evento_dominio` SEM conteúdo (só contagens) */
  registrarEvento?(tipo: string, payload: Record<string, unknown>): void;
  aviso?(mensagem: string): void;
  // ---- injeções de teste
  leitor?(raiz: string): LeitorProjeto;
  agora?(): number;
  timeoutMs?: number;
}

export interface PedidoPropor { cli: CliAssistente; dossie_hash: string; consentimento: boolean }
export interface PedidoSalvar { assistente_id: string; configs: ConfigExecucaoIpc[]; padrao_id: string | null }

export interface ServicoAssistente {
  previa(workspaceId: string, cli?: CliAssistente): Promise<PreviaAssistente>;
  propor(workspaceId: string, pedido: PedidoPropor): Promise<{ assistente_id: string }>;
  cancelar(workspaceId: string): Promise<boolean>;
  salvar(workspaceId: string, pedido: PedidoSalvar): Promise<ListaExecucao>;
  /** ao sair do app: cancela o que estiver em curso (a CLI morre junto) */
  encerrar(): void;
}

const MENSAGEM_GENERICA = "O assistente não conseguiu concluir. Tente de novo ou use a detecção automática.";

export function criarServicoAssistente(d: DependenciasAssistente): ServicoAssistente {
  const agora = d.agora ?? Date.now;
  const ativos = new Map<string, { id: string; ctrl: AbortController }>();
  /** última proposta concluída por workspace: o salvar só vale para ela (e uma vez) */
  const ultimas = new Map<string, string>();
  const registrar = (tipo: string, payload: Record<string, unknown>): void => { try { d.registrarEvento?.(tipo, payload); } catch { /* auditoria é cortesia */ } };

  const raizObrigatoria = (ws: string): string => {
    const r = d.raizDe(ws);
    if (r === null) throw new ErroExecutar("Workspace desconhecido.");
    return r;
  };
  const leitorDe = (raiz: string): LeitorProjeto => (d.leitor ?? leitorDeDisco)(raiz);

  async function montar(raiz: string): Promise<{ dossie: Dossie; leitor: LeitorProjeto; deteccao: ReturnType<typeof detectarConfiguracoes> }> {
    const leitor = leitorDe(raiz);
    const deteccao = detectarConfiguracoes(leitor);
    let extra: (t: string) => string = (t) => t;
    try { if (d.redigir !== undefined) extra = await d.redigir(); } catch { /* sem cofre aberto: só a redação padrão */ }
    const dossie = montarDossie(leitor, { redigir: (t) => redigirSegredos(extra(t)), deteccao });
    return { dossie, leitor, deteccao };
  }

  async function escolha(ws: string, cli: CliAssistente | undefined): Promise<{ clis: PreviaAssistente["clis"]; cli: CliAssistente | null; modelo: string | null }> {
    const clis = await d.cli.clis();
    const padrao = await d.cli.padrao(ws);
    const escolhida = cli !== undefined ? cli : padrao.cli;
    // trocar a CLI zera o modelo (o modelo do harness vale para a CLI que ele escolheu)
    return { clis, cli: escolhida, modelo: escolhida !== null && escolhida === padrao.cli ? padrao.modelo : null };
  }

  const erroIpc = (codigo: CodigoErroAssistente, mensagem: string, sugestao: string): ErroAssistenteIpc => ({ codigo, mensagem, sugestao });

  return {
    async previa(ws, cli) {
      const raiz = raizObrigatoria(ws);
      const { dossie, deteccao } = await montar(raiz);
      const e = await escolha(ws, cli);
      return {
        workspace_id: ws, dossie_hash: dossie.hash, arquivos: dossie.arquivos, itens_arvore: dossie.itens_arvore, bytes: dossie.bytes, tokens_estimados: dossie.tokens_estimados,
        omitidos_sensiveis: dossie.omitidos_sensiveis, clis: e.clis, cli: e.cli, modelo: e.modelo, pistas: deteccao.configuracoes.length, limite_tempo_s: LIMITE_TEMPO_ASSISTENTE_S,
      };
    },

    async propor(ws, pedido) {
      if (pedido.consentimento !== true) throw new ErroExecutar("Sem o seu consentimento o projeto não é enviado à IA.");
      if (!CLIS_ASSISTENTE.includes(pedido.cli)) throw new ErroExecutar("CLI desconhecida.");
      const raiz = raizObrigatoria(ws);
      if (ativos.has(ws)) throw new ErroExecutar("Já há um assistente trabalhando neste projeto. Cancele-o ou espere terminar.");
      const { dossie, leitor, deteccao } = await montar(raiz);
      // o consentimento vale só para o conteúdo EXATO que foi mostrado
      if (dossie.hash !== pedido.dossie_hash) throw new ErroExecutar("O projeto mudou depois da prévia. Abra o assistente de novo para rever o que será enviado.");
      const e = await escolha(ws, pedido.cli);
      const id = `ass_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
      const ctrl = new AbortController();
      ativos.set(ws, { id, ctrl });
      const t0 = agora();
      const emitir = (ev: EventoAssistente): void => { try { d.emitir(ev); } catch { /* janela fechou */ } };
      emitir({ tipo: "progresso", workspace_id: ws, assistente_id: id, fase: "preparando", decorrido_ms: 0 });
      registrar("run.assistant.requested", { workspace_id: ws, cli: pedido.cli, arquivos: dossie.arquivos.length, bytes: dossie.bytes, tokens_estimados: dossie.tokens_estimados });

      void (async () => {
        try {
          let raizReal = raiz;
          try { raizReal = realpathSync(raiz); } catch { /* resolverCwd acusa */ }
          const llm: PortaLlmAssistente = d.cli.criarLlm({ cli: pedido.cli, modelo: e.modelo });
          const r = await executarPipeline({
            dossie: dossie.texto, llm, deteccao, sinal: ctrl.signal, ...(d.timeoutMs === undefined ? {} : { timeoutMs: d.timeoutMs }),
            ctx: { leitor, raiz: raizReal, deteccao, verificarCwd: (rel) => { const c = resolverCwd(raiz, rel); return c.ok ? null : c.erro; } },
            progresso: (fase) => emitir({ tipo: "progresso", workspace_id: ws, assistente_id: id, fase, decorrido_ms: agora() - t0 }),
          });
          const itens: PropostaItemIpc[] = r.itens.map((x) => {
            const { origem, ...config } = x.config;
            void origem;
            return { config, justificativa: x.justificativa, confianca: x.confianca, novo: x.novo, padrao: x.padrao, comando: x.comando };
          });
          const avisos = [...r.avisos, ...r.itens.flatMap((x) => x.notas.map((n) => `${x.config.nome}: ${n}`))].slice(0, LIMITES_IA.avisos * 3);
          const resultado: ResultadoAssistente = {
            assistente_id: id, workspace_id: ws, fonte: r.fonte, aviso_fonte: r.aviso_fonte, itens, avisos, descartados: r.descartados.slice(0, 20), cli: pedido.cli, tentativas: r.tentativas,
            duracao_ms: agora() - t0, deteccao_total: deteccao.configuracoes.length,
          };
          ultimas.set(ws, id);
          registrar("run.assistant.proposed", { workspace_id: ws, cli: pedido.cli, fonte: r.fonte, itens: itens.length, descartados: r.descartados.length, tentativas: r.tentativas, duracao_ms: resultado.duracao_ms });
          emitir({ tipo: "concluido", workspace_id: ws, assistente_id: id, resultado });
        } catch (erro) {
          if (erro instanceof ErroAssistente && erro.codigo === "cancelado") {
            registrar("run.assistant.cancelled", { workspace_id: ws, cli: pedido.cli, duracao_ms: agora() - t0 });
            emitir({ tipo: "cancelado", workspace_id: ws, assistente_id: id });
          } else if (erro instanceof ErroAssistente) {
            registrar("run.assistant.failed", { workspace_id: ws, cli: pedido.cli, codigo: erro.codigo, duracao_ms: agora() - t0 });
            emitir({ tipo: "erro", workspace_id: ws, assistente_id: id, erro: erroIpc(erro.codigo as CodigoErroAssistente, erro.message, erro.sugestao) });
          } else {
            d.aviso?.("executar: o assistente falhou por erro interno");
            registrar("run.assistant.failed", { workspace_id: ws, cli: pedido.cli, codigo: "indisponivel", duracao_ms: agora() - t0 });
            emitir({ tipo: "erro", workspace_id: ws, assistente_id: id, erro: erroIpc("indisponivel", MENSAGEM_GENERICA, "Tente de novo em instantes.") });
          }
        } finally {
          if (ativos.get(ws)?.id === id) ativos.delete(ws);
        }
      })();
      return { assistente_id: id };
    },

    async cancelar(ws) {
      const a = ativos.get(ws);
      if (a === undefined) return false;
      a.ctrl.abort();
      return true;
    },

    async salvar(ws, pedido) {
      const raiz = raizObrigatoria(ws);
      if (ultimas.get(ws) !== pedido.assistente_id) throw new ErroExecutar("Esta proposta já foi salva ou expirou. Peça ao assistente de novo.");
      if (pedido.configs.length === 0) throw new ErroExecutar("Marque ao menos uma configuração para salvar.");
      if (pedido.configs.length > LIMITES_IA.configuracoes) throw new ErroExecutar(`No máximo ${LIMITES_IA.configuracoes} configurações por vez.`);
      const servico = await d.executar();
      const existentes = new Set(servico.listar(ws).configuracoes.map((c) => c.id));
      const usados = new Set<string>();
      const finais: ConfigExecucaoIpc[] = [];
      const mapa = new Map<string, string>();
      if (new Set(pedido.configs.map((c) => c.id)).size !== pedido.configs.length) throw new ErroExecutar("Há configurações repetidas na seleção.");
      for (const c of pedido.configs) {
        // a IA nunca gera shell e o assistente nunca o salva; o resto passa pelo MESMO validador estrito do editor
        if (c.shell !== null) throw new ErroExecutar(`"${c.nome.slice(0, 40)}": o assistente não salva comandos em shell. Use o editor de configurações para isso.`);
        const v = validarConfig({ ...c, origem: "usuario" }, "usuario");
        if (!v.ok) throw new ErroExecutar(`"${c.nome.slice(0, 40)}": ${v.erro}`);
        const cwd = resolverCwd(raiz, v.valor.cwd);
        if (!cwd.ok) throw new ErroExecutar(`"${c.nome.slice(0, 40)}": ${cwd.erro}`);
        let id = v.valor.id;
        for (let n = 2; existentes.has(id) || usados.has(id); n += 1) id = `${v.valor.id.slice(0, 36)}-${n}`;
        usados.add(id);
        mapa.set(c.id, id);
        const { origem, ...resto } = { ...v.valor, id };
        void origem;
        finais.push(resto);
      }
      if (pedido.padrao_id !== null && !mapa.has(pedido.padrao_id)) throw new ErroExecutar("A configuração padrão precisa estar entre as marcadas.");
      for (const c of finais) servico.gravarConfig(ws, { ...c, origem: "usuario" }, false);
      let lista: ListaExecucao;
      if (pedido.padrao_id !== null) lista = servico.definirPadrao(ws, mapa.get(pedido.padrao_id)!);
      else lista = servico.listar(ws);
      ultimas.delete(ws);
      registrar("run.assistant.saved", { workspace_id: ws, quantidade: finais.length, com_padrao: pedido.padrao_id !== null });
      return lista;
    },

    encerrar() {
      for (const a of ativos.values()) a.ctrl.abort();
    },
  };
}
