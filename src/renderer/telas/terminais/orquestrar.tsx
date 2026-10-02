// "Orquestrar neste painel" (D-420): o painel livre passa a abrir workers como terminais na grade. Aqui moram o fluxo (preferência do workspace,
// aviso, reabertura da CLI), o interruptor do cabeçalho, o chip de subagentes internos e a faixa que oferece ligar. Nada de segredo neste
// arquivo: tudo que vem do main é id de sessão/Pane e texto curto.
import { useCallback, useEffect, useRef, useState, type Dispatch, type ReactElement, type ReactNode } from "react";
import { CLIS_QUE_ORQUESTRAM, garantiasDaCli, ROTULO_DO_SELO, TEXTO_ORQUESTRADOR_SO_DELEGA, type GarantiasDoOrquestrador } from "../../../compartilhado/orquestrador";
import { LIMITES_PAINEL_LIVRE, type RespostaPonteGrok } from "../../../compartilhado/painel-livre";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { FerramentaDetectada } from "../../../compartilhado/terminais";
import { confirmacaoTotalValida, type NivelAprovacaoWorker } from "../../../compartilhado/aprovacao-workers";
import { Dialogo, DialogoConfirmacao } from "../../componentes/Dialogo";
import { SeletorNiveisAprovacao } from "./aprovacao-workers";
import { ade } from "../../ade";
import type { SessaoUI, StoreTerminais } from "../../estado/terminais";
import type { AcaoGrade } from "./estado";

export type ApiPainelLivre = ApiAde["painelLivre"];

/** O que a grade usa para desenhar interruptor, chip e faixa (tudo por id de sessão). */
export interface ControleOrquestrar {
  /** sem projeto aberto o interruptor fica desabilitado. */
  semProjeto: boolean;
  ocupados: ReadonlySet<string>;
  erros: Readonly<Record<string, string>>;
  dispensadas: ReadonlySet<string>;
  /** `ligada`: o painel já orquestra agora (o clique desliga). */
  aoAlternar(sessaoId: string, ligada: boolean): void;
  aoDispensarFaixa(sessaoId: string): void;
  /** opt-out do projeto "orquestrador pode editar" (D-512): vale para o PRÓXIMO orquestrador aberto; o orquestrador atual segue como foi lançado. */
  edita: boolean;
  aoAlternarEdita(): void;
  /** "Fechar workers ao terminar" (D-520, padrão LIGADO): o painel do worker fecha sozinho ~3 s depois de entregar; desligado, fica aberto para inspeção. */
  fecharWorkers: boolean;
  aoAlternarFecharWorkers(): void;
  /** o que "Orquestrar" garante nesta CLI (selo honesto); `null` = sessão desconhecida. */
  garantiasDe(sessaoId: string): GarantiasDoOrquestrador | null;
}

/** Só estas CLIs podem orquestrar (o Grok, com a ponte do projeto autorizada). As demais explicam por quê. */
const podeOrquestrarUmDia = (cli: string): boolean => CLIS_QUE_ORQUESTRAM.includes(cli) || cli === "grok";

export const TEXTO_AVISO_ORQUESTRAR =
  `Orquestrar neste painel permite que o agente deste painel abra até ${LIMITES_PAINEL_LIVRE.workers_por_painel} agentes (terminais) novos na tela, com custo e limites do seu plano. Eles herdam a permissão deste painel (nunca mais ampla), não abrem outros agentes e não aprovam nada por você. O painel reinicia a CLI retomando a conversa quando a CLI suporta.`;

const NOME_DA_CLI: Readonly<Record<string, string>> = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode", grok: "Grok", gemini: "Gemini CLI", aider: "Aider", qwen: "Qwen Code", kilo: "Kilo Code" };
const nomeDaCli = (cli: string): string => NOME_DA_CLI[cli] ?? cli;

const mensagemDe = (e: unknown): string => (e instanceof Error ? e.message : "Não foi possível orquestrar neste painel.");

interface Entrada {
  store: StoreTerminais;
  dispatch: Dispatch<AcaoGrade>;
  sessoes: Readonly<Record<string, SessaoUI>>;
  /** workspace do projeto aberto (`null` = nenhum). */
  workspaceId: string | null;
  api?: ApiPainelLivre | undefined;
}

export interface OrquestrarPainel {
  controle: ControleOrquestrar;
  /** diálogo de aviso (renderizar na Tela); `null` = fechado. */
  dialogo: ReactElement | null;
  /** abre uma sessão já como painel que orquestra (pede permissão se a preferência está desligada); `null` = cancelou/falhou. */
  abrirNovo(ferramenta: FerramentaDetectada): Promise<string | null>;
  /** há API do main para orquestrar. */
  disponivel: boolean;
}

export function useOrquestrarPainel({ store, dispatch, sessoes, workspaceId, api }: Entrada): OrquestrarPainel {
  const pl = api ?? ade()?.painelLivre;
  const [ocupados, setOcupados] = useState<ReadonlySet<string>>(new Set());
  const [erros, setErros] = useState<Readonly<Record<string, string>>>({});
  const [dispensadas, setDispensadas] = useState<ReadonlySet<string>>(new Set());
  type DialogoOrq =
    | { tipo: "permissao"; cli: string; editaInicial: boolean; resolver(ok: boolean, edita: boolean): void }
    | { tipo: "ponte"; resumo: RespostaPonteGrok; resolver(ok: boolean): void }
    | { tipo: "nao_orquestra"; cli: string };
  const [pedido, setPedido] = useState<DialogoOrq | null>(null);
  const [edita, setEdita] = useState(false);
  const [fecharWorkers, setFecharWorkers] = useState(true);
  const [ponteAtiva, setPonteAtiva] = useState(false);
  const [editaMarcado, setEditaMarcado] = useState(false);
  // D-640: nível de aprovações dos workers escolhido neste aviso (o do projeto, ou o padrão global, é o ponto de partida)
  const [aprovNivel, setAprovNivel] = useState<NivelAprovacaoWorker>("automatico_seguro");
  const [aprovConfirmacao, setAprovConfirmacao] = useState("");
  const sessoesRef = useRef(sessoes);
  sessoesRef.current = sessoes;
  const aprovRef = useRef({ nivel: aprovNivel, confirmacao: aprovConfirmacao });
  aprovRef.current = { nivel: aprovNivel, confirmacao: aprovConfirmacao };

  const marcar = useCallback((id: string, ocupado: boolean) => setOcupados((o) => { const n = new Set(o); if (ocupado) n.add(id); else n.delete(id); return n; }), []);
  const erro = useCallback((id: string, texto: string | null) => setErros((e) => { const { [id]: _a, ...resto } = e; void _a; return texto === null ? resto : { ...resto, [id]: texto }; }), []);

  /** preferência do workspace; desligada → aviso (com o selo da CLI e o opt-out) e só segue com o "sim" da pessoa (que a grava). */
  const garantirPermissao = useCallback(async (cli: string): Promise<boolean> => {
    if (pl === undefined || workspaceId === null) return false;
    const atual = await pl.preferencia(workspaceId);
    const editaAtual = atual.orquestrador_edita === true;
    setEdita(editaAtual);
    if (atual.ativa) return true;
    setEditaMarcado(editaAtual);
    const aprovAtual = await Promise.resolve().then(() => pl.aprovacao({ workspace_id: workspaceId })).then((x) => x.nivel).catch((): NivelAprovacaoWorker => "automatico_seguro");
    setAprovNivel(aprovAtual);
    setAprovConfirmacao("");
    const r = await new Promise<{ ok: boolean; edita: boolean }>((resolver) => setPedido({ tipo: "permissao", cli, editaInicial: editaAtual, resolver: (ok, e) => resolver({ ok, edita: e }) }));
    if (!r.ok) return false;
    // D-640: a escolha do aviso vale para o projeto (o `total` só grava com a palavra digitada, que o botão já exigiu)
    const escolhido = aprovRef.current;
    if (escolhido.nivel !== aprovAtual) await pl.aprovacao({ workspace_id: workspaceId, nivel: escolhido.nivel, ...(escolhido.nivel === "total" ? { confirmacao: escolhido.confirmacao } : {}) });
    // o terceiro argumento só vai quando a pessoa mudou o opt-out neste aviso (o fluxo padrão grava só a permissão)
    const gravada = r.edita !== editaAtual ? await pl.preferencia(workspaceId, true, r.edita) : await pl.preferencia(workspaceId, true);
    setEdita(gravada.orquestrador_edita === true);
    return gravada.ativa;
  }, [pl, workspaceId]);

  /** D-514: o Grok só orquestra com a ponte do projeto; sem ela, mostra o arquivo EXATO e só grava com o "sim" da pessoa. */
  const garantirPonte = useCallback(async (): Promise<boolean> => {
    if (pl === undefined || workspaceId === null) return false;
    const estado = await pl.ponteGrok(workspaceId, "estado");
    if (estado.estado === "ativa") { setPonteAtiva(true); return true; }
    const ok = await new Promise<boolean>((resolver) => setPedido({ tipo: "ponte", resumo: estado, resolver }));
    if (!ok || estado.estado === "bloqueada") return false;
    const r = await pl.ponteGrok(workspaceId, "aplicar");
    setPonteAtiva(r.estado === "ativa");
    return r.estado === "ativa";
  }, [pl, workspaceId]);

  const executar = useCallback(async (sessaoId: string, ligar: boolean): Promise<void> => {
    if (pl === undefined || workspaceId === null) return;
    marcar(sessaoId, true);
    erro(sessaoId, null);
    const soltar = store.segurarSincronia();
    try {
      const r = await pl.orquestrar({ workspace_id: workspaceId, sessao_id: sessaoId, ligar });
      const ferramenta = sessoesRef.current[sessaoId]?.ferramenta_id ?? "claude";
      store.adotar({ sessao_id: r.sessao_id, ferramenta_id: ferramenta, estado: "executando", workspace_id: workspaceId });
      dispatch({ tipo: "trocar", de: sessaoId, para: r.sessao_id });
      store.fechar(sessaoId);
      if (r.aviso !== null) erro(r.sessao_id, r.aviso);
    } catch (e) {
      erro(sessaoId, mensagemDe(e)); // o painel continua como estava
    } finally {
      soltar();
      marcar(sessaoId, false);
    }
  }, [pl, workspaceId, store, dispatch, marcar, erro]);

  const aoAlternar = useCallback((sessaoId: string, ligada: boolean) => {
    if (ligada) { void executar(sessaoId, false); return; }
    const cli = sessoesRef.current[sessaoId]?.ferramenta_id ?? "claude";
    if (!podeOrquestrarUmDia(cli)) { setPedido({ tipo: "nao_orquestra", cli }); return; }
    void (async () => {
      if (!(await garantirPermissao(cli))) return;
      if (cli === "grok" && !(await garantirPonte())) return;
      await executar(sessaoId, true);
    })().catch((e: unknown) => erro(sessaoId, mensagemDe(e)));
  }, [executar, garantirPermissao, garantirPonte, erro]);

  const aoAlternarEdita = useCallback(() => {
    if (pl === undefined || workspaceId === null) return;
    const novo = !edita;
    setEdita(novo);
    void pl.preferencia(workspaceId, undefined, novo).then((r) => setEdita(r.orquestrador_edita === true)).catch(() => setEdita(!novo));
  }, [pl, workspaceId, edita]);

  const aoAlternarFecharWorkers = useCallback(() => {
    if (pl === undefined || workspaceId === null) return;
    const novo = !fecharWorkers;
    setFecharWorkers(novo);
    void pl.preferencia(workspaceId, undefined, undefined, novo).then((r) => setFecharWorkers(r.fechar_workers !== false)).catch(() => setFecharWorkers(!novo));
  }, [pl, workspaceId, fecharWorkers]);

  // o opt-out aparece no cabeçalho do orquestrador: lê o valor do projeto uma vez (só quando há painel orquestrando)
  const haCliAberta = Object.values(sessoes).some((x) => x.ferramenta_id !== "terminal");
  const lido = useRef<string | null>(null);
  useEffect(() => {
    if (pl === undefined || workspaceId === null || !haCliAberta || lido.current === workspaceId) return;
    lido.current = workspaceId;
    void pl.preferencia(workspaceId).then((r) => { setEdita(r.orquestrador_edita === true); setFecharWorkers(r.fechar_workers !== false); }).catch(() => undefined);
  }, [pl, workspaceId, haCliAberta]);

  const garantiasDe = useCallback((sessaoId: string): GarantiasDoOrquestrador | null => {
    const cli = sessoesRef.current[sessaoId]?.ferramenta_id;
    return cli === undefined ? null : garantiasDaCli(cli, { orquestradorEdita: edita, ponteGrok: ponteAtiva });
  }, [edita, ponteAtiva]);

  const abrirNovo = useCallback(async (f: FerramentaDetectada): Promise<string | null> => {
    if (pl === undefined || workspaceId === null) return null;
    const soltar = store.segurarSincronia();
    try {
      if (!podeOrquestrarUmDia(f.id)) { setPedido({ tipo: "nao_orquestra", cli: f.id }); return null; }
      if (!(await garantirPermissao(f.id))) return null;
      if (f.id === "grok" && !(await garantirPonte())) return null;
      const r = await pl.abrir({ workspace_id: workspaceId, ferramenta_id: f.id, orquestrar: true });
      store.adotar({ sessao_id: r.sessao_id, ferramenta_id: f.id, estado: "executando", workspace_id: workspaceId });
      return r.sessao_id;
    } catch {
      return null;
    } finally {
      soltar();
    }
  }, [pl, workspaceId, store, garantirPermissao, garantirPonte]);

  // o aviso some junto com a tela (promessa pendente = "não")
  const pedidoRef = useRef(pedido);
  pedidoRef.current = pedido;
  useEffect(() => () => { const p = pedidoRef.current; if (p?.tipo === "permissao") p.resolver(false, false); else if (p?.tipo === "ponte") p.resolver(false); }, []);

  let dialogo: ReactElement | null = null;
  if (pedido?.tipo === "permissao") {
    const g = garantiasDaCli(pedido.cli, { orquestradorEdita: editaMarcado, ponteGrok: true });
    dialogo = (
      <DialogoConfirmacao
        titulo="Orquestrar neste painel"
        texto={(
          <>
            <p>{TEXTO_AVISO_ORQUESTRAR}</p>
            <p>{TEXTO_ORQUESTRADOR_SO_DELEGA}</p>
            <p><strong>{nomeDaCli(pedido.cli)}: {ROTULO_DO_SELO[g.selo]}.</strong> {g.resumo}</p>
            {g.limites.length > 0 ? <ul>{g.limites.map((l) => <li key={l}>{l}</li>)}</ul> : null}
            <label><input type="checkbox" checked={editaMarcado} onChange={(e) => setEditaMarcado(e.target.checked)} /> Orquestrador pode editar arquivos neste projeto</label>
            <p><strong>Aprovações dos agentes que ele abrir.</strong> Para o trabalho automático não travar pedindo permissão a cada passo, escolha o que eles podem fazer sozinhos neste projeto.</p>
            <div className="apw-rolagem"><SeletorNiveisAprovacao nivel={aprovNivel} aoMudar={(n) => { setAprovNivel(n); if (n !== "total") setAprovConfirmacao(""); }} confirmacao={aprovConfirmacao} aoConfirmacao={setAprovConfirmacao} cli={pedido.cli} /></div>
          </>
        )}
        ocupado={aprovNivel === "total" && !confirmacaoTotalValida(aprovConfirmacao)}
        perigoso={aprovNivel === "total"}
        rotuloConfirmar="Permitir neste projeto e ligar"
        aoConfirmar={() => { pedido.resolver(true, editaMarcado); setPedido(null); }}
        aoCancelar={() => { pedido.resolver(false, editaMarcado); setPedido(null); }}
      />
    );
  } else if (pedido?.tipo === "ponte") {
    const bloqueada = pedido.resumo.estado === "bloqueada";
    dialogo = (
      <DialogoConfirmacao
        titulo="Adicionar o servidor do app em .grok do projeto?"
        texto={(
          <>
            <p>O Grok só lê servidores MCP de arquivos (nunca por flag nem variável). Para o Grok orquestrar, o app precisa criar o arquivo abaixo na raiz deste projeto. Ele não tem segredo (a URL local e o token de cada painel vêm do ambiente da sessão), aparece no git como arquivo novo e é removido quando você desliga a orquestração do Grok. O app nunca mexe na configuração global do Grok.</p>
            <p><code>{pedido.resumo.arquivo}</code></p>
            <pre className="terminais-ponte-arquivo" aria-label={`Conteúdo exato de ${pedido.resumo.arquivo}`}>{pedido.resumo.conteudo}</pre>
            <p>{pedido.resumo.detalhe}</p>
            <p>O Grok só carrega o servidor se confiar na pasta do projeto, e esta ponte ainda não foi validada de ponta a ponta com o Grok real. Se preferir, use Claude Code, Codex ou OpenCode como orquestrador.</p>
          </>
        )}
        rotuloConfirmar={bloqueada ? "Entendi" : "Criar o arquivo e ligar"}
        aoConfirmar={() => { pedido.resolver(!bloqueada); setPedido(null); }}
        aoCancelar={() => { pedido.resolver(false); setPedido(null); }}
      />
    );
  } else if (pedido?.tipo === "nao_orquestra") {
    const g = garantiasDaCli(pedido.cli);
    dialogo = (
      <Dialogo titulo={`${nomeDaCli(pedido.cli)} ainda não orquestra`} aoFechar={() => setPedido(null)}>
        <div className="dialogo-corpo">
          <p>{g.resumo}</p>
          {g.limites.map((l) => <p key={l}>{l}</p>)}
          {g.alternativa !== null ? <p>{g.alternativa}</p> : null}
        </div>
        <div className="dialogo-acoes"><button type="button" className="botao botao-primario" data-foco-inicial onClick={() => setPedido(null)}>Entendi</button></div>
      </Dialogo>
    );
  }

  return {
    controle: {
      semProjeto: workspaceId === null,
      ocupados,
      erros,
      dispensadas,
      aoAlternar,
      aoDispensarFaixa: (id) => setDispensadas((d) => new Set(d).add(id)),
      edita,
      aoAlternarEdita,
      fecharWorkers,
      aoAlternarFecharWorkers,
      garantiasDe,
    },
    dialogo,
    abrirNovo,
    disponivel: pl !== undefined,
  };
}

/** Interruptor `role="switch"` do cabeçalho do painel. */
export function InterruptorOrquestrar({ sessaoId, ligada, controle }: { sessaoId: string; ligada: boolean; controle: ControleOrquestrar }): ReactElement {
  const ocupado = controle.ocupados.has(sessaoId);
  const g = controle.garantiasDe?.(sessaoId) ?? null;
  // selo honesto: o que a CLI garante e o que ficou só na instrução (D-510 a D-513)
  const selo = g === null ? "" : `\n${ROTULO_DO_SELO[g.selo]}: ${g.resumo}${g.limites.length > 0 ? `\n- ${g.limites.join("\n- ")}` : ""}`;
  const titulo = controle.semProjeto
    ? "Abra um projeto para orquestrar neste painel"
    : ligada ? `Orquestrando: o agente deste painel só delega; os agentes que ele abrir aparecem como terminais. Clique para desligar.${selo}` : `Orquestrar neste painel: o agente abre até ${LIMITES_PAINEL_LIVRE.workers_por_painel} terminais novos (desligado)${selo}`;
  const parcial = ligada && g !== null && g.selo !== "completo";
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={ligada}
        className="terminais-orquestrar"
        data-selo={ligada && g !== null ? g.selo : undefined}
        title={titulo}
        disabled={controle.semProjeto || ocupado}
        onClick={() => controle.aoAlternar(sessaoId, ligada)}
      >
        {ocupado ? "reiniciando…" : parcial ? "Orquestrar · parcial" : "Orquestrar"}
      </button>
      {ligada && controle.aoAlternarEdita !== undefined ? (
        <button
          type="button"
          role="switch"
          aria-checked={controle.edita}
          aria-label="Orquestrador pode editar"
          className="terminais-orquestrar terminais-orquestrar-edita"
          title={`Orquestrador pode editar arquivos (opção do projeto, desligada por padrão). ${TEXTO_ORQUESTRADOR_SO_DELEGA} Vale a partir do próximo orquestrador aberto.`}
          onClick={() => controle.aoAlternarEdita()}
        >
          pode editar
        </button>
      ) : null}
      {ligada && controle.aoAlternarFecharWorkers !== undefined ? (
        <button
          type="button"
          role="switch"
          aria-checked={controle.fecharWorkers}
          aria-label="Fechar workers ao terminar"
          className="terminais-orquestrar terminais-chave-fechar"
          title="Fechar workers ao terminar (opção do projeto, ligada por padrão): o painel de cada agente fecha sozinho ~3 s depois de ele entregar o relatório. Desligada, os painéis ficam abertos para você inspecionar; o orquestrador ainda os fecha quando terminar."
          onClick={() => controle.aoAlternarFecharWorkers()}
        >
          fechar ao terminar
        </button>
      ) : null}
    </>
  );
}

/** Chip somente leitura: subagentes internos da CLI (invisíveis para o ADE; nunca são terminais). */
export function ChipSubagentes({ s }: { s: SessaoUI | undefined }): ReactElement | null {
  const sub = s?.subagentes;
  if (sub === undefined || sub.total < 1) return null;
  return (
    <span className="terminais-painel-subagentes" role="img" aria-label={`Subagentes internos: ${sub.ativos} ativos de ${sub.total}`} title={`Subagentes internos desta CLI (invisíveis para o ADE): ${sub.ativos} ativos de ${sub.total} · não são terminais`}>
      <i aria-hidden="true">⧉</i> {sub.ativos > 0 ? sub.ativos : sub.total}
    </span>
  );
}

/** Faixa discreta: só em painel SEM orquestração (nunca em shell nem em Pane de Missão). */
export function FaixaSubagentes({ sessaoId, s, controle }: { sessaoId: string; s: SessaoUI; controle: ControleOrquestrar }): ReactElement | null {
  const total = s.subagentes?.total ?? 0;
  if (total < 1 || controle.dispensadas.has(sessaoId)) return null;
  const ocupado = controle.ocupados.has(sessaoId);
  const erro = controle.erros[sessaoId];
  const corpo: ReactNode = (
    <>
      <span>Este agente abriu subagentes internos ({total}). Quer que eles apareçam como terminais? Ative Orquestrar neste painel</span>
      <button type="button" disabled={controle.semProjeto || ocupado} onClick={() => controle.aoAlternar(sessaoId, false)}>{ocupado ? "reiniciando…" : "Ativar"}</button>
      <button type="button" aria-label="Dispensar aviso de subagentes internos" onClick={() => controle.aoDispensarFaixa(sessaoId)}>×</button>
    </>
  );
  return (
    <div className="terminais-faixa-subagentes" role="note">
      {corpo}
      {erro !== undefined ? <span role="alert" className="terminais-faixa-erro">{erro}</span> : null}
    </div>
  );
}
