// Painel de workspaces (D-450…): coluna fixa entre o menu e o resto, de cima a baixo, com um cartão por workspace, os agentes que
// rodam nele em ÁRVORE (Missão → piloto → workers, subagentes internos só como contagem e a Execução do projeto) e o que cada um faz
// agora. Clicar troca o workspace do projeto (as sessões dos outros seguem vivas) e leva o foco ao painel do agente na tela Terminais.
// Só monta quando fixado (chunk lazy); desmontado, o main para de acompanhar. O estado ao vivo vem do store de terminais, que já existe.
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type DragEvent, type KeyboardEvent, type PointerEvent as PointerReact } from "react";
import { createPortal } from "react-dom";
import type { ItemWorkspaceResumo } from "../../compartilhado/workspaces-resumo";
import { Icone } from "../componentes/Icone";
import { MiniBichinho } from "./SlotBichinho";
import { pedirFocoSessao, pedirTela } from "../estado/navegacao";
import {
  abreviarMeio, aplicarAoVivo, anunciosDeMudanca, confirmacaoTerminar, descreverAgora, filtrarItens, formatarDuracao, rotuloHa, larguraPorTecla, limitarLargura, linhasDoCard,
  moverNaOrdem, moverUmPasso, ordenarItens, passoNaLista, precisaAtencao, rotuloDoEstado, rotuloFaseExecucao, somarAtencaoFora, LARGURA_JANELA_SOBREPOSICAO, LARGURA_MAX, LARGURA_MIN,
  type LinhaCard,
} from "../estado/painel-workspaces-logica";
import { storePainelWorkspaces, usePainelWorkspaces, type StorePainelWorkspaces } from "../estado/painel-workspaces";
import { indicadorDe, useProgresso } from "../estado/progresso";
import { storeTerminais, useTerminais, type StoreTerminais } from "../estado/terminais";
import { idsConhecidos } from "../telas/terminais/por-workspace";
import { useContagemTerminais } from "../estado/terminais-contagem";
import { storeVisaoTerminais, useVisaoSemProjeto } from "../estado/terminais-visao";
import { storeWorkspaces, useWorkspaces, type StoreWorkspaces } from "../estado/workspaces";
import { storeAdicionarWorkspace } from "../estado/adicionar-workspace";
import "./painel-workspaces.css";
import { LinhaSuite } from "./LinhaSuite";

const EH_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

// ---- relógio compartilhado: UM intervalo para todos os "há 5 min", parado com a janela oculta (nenhuma chamada ao main) ----
const RELOGIO_MS = 30_000;
let tique = 0;
const ouvintesRelogio = new Set<() => void>();
let intervalo: ReturnType<typeof setInterval> | null = null;
function assinarRelogio(o: () => void): () => void {
  ouvintesRelogio.add(o);
  if (intervalo === null) intervalo = setInterval(() => { if (typeof document !== "undefined" && document.visibilityState === "hidden") return; tique += 1; ouvintesRelogio.forEach((f) => f()); }, RELOGIO_MS);
  return () => { ouvintesRelogio.delete(o); if (ouvintesRelogio.size === 0 && intervalo !== null) { clearInterval(intervalo); intervalo = null; } };
}
const Tempo = memo(function Tempo({ desde, rotulo }: { desde: number | null; rotulo: string }) {
  useSyncExternalStore(assinarRelogio, () => tique);
  const t = formatarDuracao(desde, Date.now());
  return t === "" ? null : <time className="pws-tempo" title={rotulo}>{t}</time>;
});

// ---- glifo de estado: forma + texto (a cor nunca é o único sinal) ----
function Glifo({ estado }: { estado: ReturnType<typeof rotuloDoEstado>["forma"] }) {
  return (
    <span className="pws-glifo" data-forma={estado} aria-hidden="true">
      {estado === "alerta" ? "!" : estado === "check" ? "✓" : estado === "erro" ? "×" : estado === "pausa" ? "…" : null}
    </span>
  );
}

interface CallbacksCartao {
  trocar(id: string): void;
  /** clique no cartão (nome, bichinho ou área morta): troca o workspace e leva à tela Terminais. */
  abrir(id: string): void;
  irParaAgente(wsId: string, sessaoId: string): void;
  /** chip do cartão: troca de workspace e leva à tela Terminais (focando a sessão indicada, quando houver). */
  irParaTerminais(wsId: string, sessaoId: string | null): void;
  abrirMissao(wsId: string): void;
  pedirTerminar(sessaoId: string | null): void;
  confirmarTerminar(wsId: string, sessaoId: string): void;
  alternarRecolhido(id: string): void;
  alternarFavorito(id: string): void;
  pedirRemover(id: string | null): void;
  confirmarRemover(id: string): void;
  revelar(id: string): void;
  copiarCaminho(id: string): void;
  focoCartao(id: string): void;
}

interface PropsCartao {
  item: ItemWorkspaceResumo;
  ativo: boolean;
  recolhido: boolean;
  favorito: boolean;
  compacto: boolean;
  /** sessão aguardando a confirmação de "terminar" NESTE cartão (null = nenhuma). */
  terminando: string | null;
  removendo: boolean;
  tabulavel: boolean;
  arrastando: boolean;
  alvoSolto: boolean;
  /** quantos caracteres da pasta cabem na largura atual do painel. */
  maxPasta: number;
  /** D-570: terminais deste workspace na tela Terminais (os que existem no daemon, ao vivo). */
  terminais: number;
  cb: CallbacksCartao;
  aoArrastar: { inicio(id: string): void; sobre(e: DragEvent, id: string): void; soltar(e: DragEvent, id: string): void; fim(): void };
}

const rotuloPasta = (): string => (EH_MAC ? "Revelar no Finder" : "Mostrar no Explorador");

/** Linha do nome: SOMENTE [mini-bichinho] [nome]. Nada mais disputa esse espaço (atenção, chips, ações vivem na linha de baixo). */
function LinhaNome({ item, ativo, tabulavel, compacto, cb }: { item: ItemWorkspaceResumo; ativo: boolean; tabulavel: boolean; compacto: boolean; cb: CallbacksCartao }) {
  return (
    <div className="pws-linha-nome">
      <span className="pws-bichinho"><MiniBichinho workspaceId={item.id} /></span>
      <button
        type="button" className="pws-nome-botao" data-nav="cartao" data-ws={item.id} tabIndex={tabulavel ? 0 : -1} aria-current={ativo ? "true" : undefined} onFocus={() => cb.focoCartao(item.id)}
        onClick={() => cb.abrir(item.id)} title={`${item.nome}${ativo ? " (workspace atual)" : ""}${compacto ? `\n${item.pasta_mascarada}` : ""}`}
      >
        {item.nome}
      </button>
    </div>
  );
}

const MARGEM_MENU = 8;

/**
 * Menu suspenso FORA do cartão: o cartão usa `content-visibility: auto` (contenção de pintura) e a lista rola com `overflow: hidden`,
 * então um menu filho era cortado pelo cartão. Vai para um portal no <body>, com `position: fixed` calculado a partir do botão:
 * abre para baixo e alinhado à direita do botão; se não couber embaixo, abre para cima; nunca sai da janela. Fecha ao rolar/redimensionar.
 */
function MenuFlutuante({ ancora, aoFechar, rotulo, children }: { ancora: { current: HTMLElement | null }; aoFechar(): void; rotulo: string; children: ReactNode }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const botao = ancora.current;
    const menu = caixa.current;
    if (botao === null || menu === null) return;
    const r = botao.getBoundingClientRect();
    const largura = menu.offsetWidth;
    const altura = menu.offsetHeight;
    const cabeEmbaixo = r.bottom + 2 + altura + MARGEM_MENU <= window.innerHeight;
    const top = cabeEmbaixo ? r.bottom + 2 : Math.max(MARGEM_MENU, r.top - 2 - altura);
    const left = Math.min(Math.max(MARGEM_MENU, r.right - largura), Math.max(MARGEM_MENU, window.innerWidth - largura - MARGEM_MENU));
    setPos({ top, left });
  }, [ancora]);
  useEffect(() => {
    const aoRedimensionar = (): void => aoFechar();
    // só fecha quando rola um ANCESTRAL do botão (a lista de cartões); a saída contínua dos terminais também dispara `scroll` e não pode fechar o menu
    const aoRolar = (e: Event): void => { const alvo = e.target; if (alvo instanceof Node && ancora.current !== null && alvo.contains(ancora.current)) aoFechar(); };
    window.addEventListener("resize", aoRedimensionar);
    window.addEventListener("scroll", aoRolar, true);
    return () => { window.removeEventListener("resize", aoRedimensionar); window.removeEventListener("scroll", aoRolar, true); };
  }, [aoFechar, ancora]);
  return createPortal(
    <div ref={caixa} className="pws-menu" role="menu" aria-label={rotulo} style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos === null ? "hidden" : "visible" }}>{children}</div>,
    document.body,
  );
}

/** Ações do cartão (recolher, fixar no topo, ⋯): ícones pequenos com área de 28 px, reveladas no hover/foco (sempre visíveis no toque). */
function Acoes({ item, favorito, recolhido, comChevron, menu, setMenu, cb, pastaId }: { item: ItemWorkspaceResumo; favorito: boolean; recolhido: boolean; comChevron: boolean; menu: boolean; setMenu(v: boolean): void; cb: CallbacksCartao; pastaId: string }) {
  const botaoMenu = useRef<HTMLButtonElement>(null);
  return (
    <div className="pws-acoes" data-aberto={menu || undefined} data-favorito={favorito || undefined}>
      {comChevron ? (
        <button type="button" className="pws-icone-botao pws-chevron" aria-expanded={!recolhido} aria-controls={`${pastaId}-corpo`} aria-label={`${recolhido ? "Expandir" : "Recolher"} ${item.nome}`} title={recolhido ? "Mostrar agentes" : "Recolher agentes"} onClick={() => cb.alternarRecolhido(item.id)}>
          <Icone nome="chevron" className="pws-chevron-icone" />
        </button>
      ) : null}
      <button type="button" className="pws-icone-botao pws-fav" aria-pressed={favorito} aria-label={favorito ? `Desafixar ${item.nome} do topo` : `Fixar ${item.nome} no topo`} title={favorito ? "Tirar do topo" : "Fixar no topo"} onClick={() => cb.alternarFavorito(item.id)}>
        <Icone nome="estrela" />
      </button>
      <div className="pws-menu-raiz">
        <button ref={botaoMenu} type="button" className="pws-icone-botao" aria-haspopup="menu" aria-expanded={menu} aria-label={`Mais ações de ${item.nome}`} onClick={() => setMenu(!menu)}>
          <Icone nome="reticencias" />
        </button>
        {menu ? (
          <MenuFlutuante ancora={botaoMenu} aoFechar={() => setMenu(false)} rotulo={`Ações de ${item.nome}`}>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); cb.revelar(item.id); }}><Icone nome="externo" />{rotuloPasta()}</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); cb.copiarCaminho(item.id); }}><Icone nome="copiar" />Copiar caminho</button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); cb.alternarFavorito(item.id); }}><Icone nome="estrela" />{favorito ? "Tirar do topo" : "Fixar no topo"}</button>
            <button type="button" role="menuitem" className="pws-menu-perigo" onClick={() => { setMenu(false); cb.pedirRemover(item.id); }}><Icone nome="lixeira" />Remover da lista</button>
          </MenuFlutuante>
        ) : null}
      </div>
    </div>
  );
}

/** Sessão alvo de um chip: a primeira (raiz antes de worker) no estado pedido; o chip de agentes prefere quem está trabalhando. */
function sessaoDoChip(item: ItemWorkspaceResumo, estados: readonly string[]): string | null {
  const ordenados = [...item.agentes].sort((x, y) => x.profundidade - y.profundidade);
  for (const e of estados) { const a = ordenados.find((x) => x.estado === e); if (a !== undefined) return a.sessao_id; }
  return null;
}

/** D-660…: "etapa 4/9" do progresso em andamento neste workspace (acompanhado em segundo plano). Seletor primitivo: o snapshot do store é estável. */
function ChipProgresso({ item, cb }: { item: ItemWorkspaceResumo; cb: CallbacksCartao }) {
  const bruto = useProgresso((e) => { const i = indicadorDe(e, item.id); return i === null ? "" : `${i.feitos}|${i.total}|${i.aguardando ? 1 : 0}|${i.falhou ? 1 : 0}`; });
  if (bruto === "") return null;
  const [feitos = 0, total = 0, aguardando = 0, falhou = 0] = bruto.split("|").map(Number);
  const etapa = Math.min(feitos + 1, total);
  const rotulo = falhou === 1 ? `parou na etapa ${etapa}/${total}` : aguardando === 1 ? `etapa ${etapa}/${total} aguarda você` : `etapa ${etapa}/${total}`;
  return (
    <button type="button" className="pws-chip pws-chip-acao" data-tom={falhou === 1 ? "erro" : aguardando === 1 ? "aguardando" : "neutro"} data-nav="chip" data-progresso title="Progresso da pipeline deste workspace — abrir nos Terminais" onClick={() => cb.irParaTerminais(item.id, null)}>
      {rotulo}
    </button>
  );
}

/** Estado dominante do resumo de agentes (a cor vem de token; o texto do chip diz o resto). */
function tomResumo(c: ItemWorkspaceResumo["contagens"]): "erro" | "aguardando" | "trabalhando" | "suave" {
  return c.erro > 0 ? "erro" : c.aguardando > 0 ? "aguardando" : c.trabalhando > 0 ? "trabalhando" : "suave";
}

/** Quando o agente mais recente mexeu: última mudança de atividade, ou o início da sessão. Só dados que o resumo já traz. */
function ultimaAtividade(item: ItemWorkspaceResumo): number | null {
  let t: number | null = null;
  for (const a of item.agentes) { const v = a.atividade_em ?? a.desde; if (v !== null && (t === null || v > t)) t = v; }
  return t;
}
const UltimaAtividade = memo(function UltimaAtividade({ desde }: { desde: number | null }) {
  useSyncExternalStore(assinarRelogio, () => tique);
  const t = rotuloHa(desde, Date.now());
  return t === "" ? null : <time className="pws-ultima" title="Última atividade dos agentes deste workspace">{t}</time>;
});

/** Segunda linha do cartão: SEMPRE presente. Resumo de agentes, o que precisa de você, execução, etapa da pipeline e há quanto tempo.
 *  Cada chip é um BOTÃO que troca para o workspace e leva à tela Terminais, focando o agente certo. */
function Chips({ item, cb }: { item: ItemWorkspaceResumo; cb: CallbacksCartao }) {
  const c = item.contagens;
  const prog = <ChipProgresso item={item} cb={cb} />;
  if (c.agentes === 0 && c.terminais === 0 && item.execucao === null) return <><span className="pws-sem-agentes">sem agentes</span>{prog}</>;
  const ir = (sessao: string | null) => () => cb.irParaTerminais(item.id, sessao);
  return (
    <>
      {c.agentes > 0 ? (
        <button type="button" className="pws-chip pws-chip-acao pws-chip-resumo" data-tom="neutro" data-estado={tomResumo(c)} data-nav="chip" title={`${c.trabalhando} trabalhando agora — abrir nos Terminais`} onClick={ir(sessaoDoChip(item, ["trabalhando", "pronto", "ocioso", "aguardando", "erro"]) ?? item.agentes[0]?.sessao_id ?? null)}>
          <span className="pws-resumo-ponto" aria-hidden="true" />
          {c.agentes} {c.agentes === 1 ? "agente" : "agentes"}{c.trabalhando > 0 ? ` · ${c.trabalhando} ${c.trabalhando === 1 ? "ativo" : "ativos"}` : ""}
        </button>
      ) : null}
      {c.aguardando > 0 ? <button type="button" className="pws-chip pws-chip-acao" data-tom="aguardando" data-nav="chip" title="Abrir o agente que aguarda você, nos Terminais" onClick={ir(sessaoDoChip(item, ["aguardando"]))}>{c.aguardando} aguardando você</button> : null}
      {c.erro > 0 ? <button type="button" className="pws-chip pws-chip-acao" data-tom="erro" data-nav="chip" title="Abrir o agente com erro, nos Terminais" onClick={ir(sessaoDoChip(item, ["erro"]))}>{c.erro} com erro</button> : null}
      {item.execucao !== null ? <button type="button" className="pws-chip pws-chip-acao" data-tom="execucao" data-nav="chip" title="Abrir a execução, nos Terminais" onClick={ir(item.execucao.sessao_id)}>executando{item.execucao.porta !== null ? ` :${item.execucao.porta}` : ""}</button> : null}
      {prog}
    </>
  );
}

/** "Codex · executor #2": o nome da CLI fica inteiro e o papel (mais discreto) é o que encolhe. */
function NomeAgente({ titulo }: { titulo: string }) {
  const i = titulo.indexOf(" · ");
  return (
    <span className="pws-agente-nome">
      <span className="pws-agente-cli">{i < 0 ? titulo : titulo.slice(0, i)}</span>
      {i < 0 ? null : <span className="pws-agente-papel">{titulo.slice(i + 3)}</span>}
    </span>
  );
}

function LinhaAgente({ l, item, terminando, cb, filhos }: { l: Extract<LinhaCard, { tipo: "agente" }>; item: ItemWorkspaceResumo; terminando: boolean; cb: CallbacksCartao; filhos: number }) {
  const a = l.agente;
  const r = rotuloDoEstado(a.estado);
  const conf = terminando ? confirmacaoTerminar(a, filhos) : null;
  const refConf = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (terminando) refConf.current?.focus(); }, [terminando]);
  return (
    <li className="pws-no" data-nivel={l.nivel} data-ultimo={l.ultimo || undefined} data-estado={a.estado} style={{ "--nivel": Math.min(l.nivel, 2), "--fundo": Math.max(0, l.nivel - 2) } as CSSProperties}>
      {conf === null ? (
        <>
          <button
            type="button" className="pws-agente" data-nav="agente" data-ws={item.id} data-sessao={a.sessao_id} onClick={() => cb.irParaAgente(item.id, a.sessao_id)}
            title={`${a.titulo} — ${r.texto}. Clique para ir ao terminal.`}
          >
            <Glifo estado={r.forma} />
            <span className="pws-agente-texto">
              <span className="pws-agente-titulo">
                <NomeAgente titulo={a.titulo} />
                <Tempo desde={a.estado === "trabalhando" || a.estado === "aguardando" ? (a.atividade_em ?? a.desde) : a.desde} rotulo={a.estado === "trabalhando" || a.estado === "aguardando" ? "há quanto tempo neste estado" : "há quanto tempo está aberto"} />
              </span>
              <span className="pws-agente-linha2">
                <span className="pws-agente-agora"><span className="sr-somente">{r.texto}. </span>{descreverAgora(a)}</span>
                {a.subagentes !== null && a.subagentes.total > 0 ? <span className="pws-sub" title={`${a.subagentes.ativos} de ${a.subagentes.total} subagentes internos da CLI ativos (somente leitura)`}>{a.subagentes.ativos > 0 ? `${a.subagentes.ativos}/` : ""}{a.subagentes.total} sub</span> : null}
              </span>
            </span>
          </button>
          <button type="button" className="pws-icone-botao pws-terminar" data-sem-travessura data-nav="terminar" aria-label={`Terminar ${a.titulo}`} title="Terminar este agente" onClick={() => cb.pedirTerminar(a.sessao_id)}>
            <span className="pws-parar" aria-hidden="true" />
          </button>
        </>
      ) : (
        <div className="pws-confirmar" role="alertdialog" aria-label={conf.pergunta} data-forte={conf.forte || undefined}>
          <p className="pws-confirmar-texto"><strong>{conf.pergunta}</strong>{conf.detalhe !== null ? <span> {conf.detalhe}</span> : null}</p>
          <div className="pws-confirmar-acoes">
            <button ref={refConf} type="button" className="pws-botao pws-botao-perigo" onClick={() => cb.confirmarTerminar(item.id, a.sessao_id)}>Sim, terminar</button>
            <button type="button" className="pws-botao" onClick={() => cb.pedirTerminar(null)}>Não</button>
          </div>
        </div>
      )}
    </li>
  );
}

const Cartao = memo(function Cartao({ item, ativo, recolhido, favorito, compacto, terminando, removendo, tabulavel, arrastando, alvoSolto, maxPasta, terminais, cb, aoArrastar }: PropsCartao) {
  const [menu, setMenu] = useState(false);
  const idBase = useId();
  const raiz = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!menu) return;
    const fora = (e: MouseEvent): void => { if (raiz.current !== null && !raiz.current.querySelector(".pws-menu-raiz")?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".pws-menu")) setMenu(false); };
    const esc = (e: globalThis.KeyboardEvent): void => { if (e.key === "Escape") { e.stopPropagation(); setMenu(false); raiz.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus(); } };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc, true); };
  }, [menu]);
  const linhas = useMemo(() => (recolhido || compacto ? [] : linhasDoCard(item)), [item, recolhido, compacto]);
  const filhosDe = (sessaoId: string): number => item.agentes.filter((x) => x.pai_sessao_id === sessaoId).length;
  const idCorpo = `${idBase}-corpo`;

  return (
    <li
      ref={raiz} className="pws-cartao" data-ativo={ativo || undefined} data-favorito={favorito || undefined} data-atencao={(!ativo && precisaAtencao(item)) || undefined} data-compacto={compacto || undefined}
      data-arrastando={arrastando || undefined} data-alvo={alvoSolto || undefined} data-ws-cartao={item.id}
      draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", item.id); } catch { /* jsdom */ } aoArrastar.inicio(item.id); }}
      onDragOver={(e) => aoArrastar.sobre(e, item.id)} onDrop={(e) => aoArrastar.soltar(e, item.id)} onDragEnd={aoArrastar.fim}
      // o card inteiro troca o workspace: qualquer área "morta" (pasta, ramo, chips, folga) vale; controles e confirmações têm o clique próprio
      onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a, input, select, textarea, summary, label, [role="menu"], [role="menuitem"], [role="alertdialog"]')) cb.abrir(item.id); }}
    >
      <LinhaNome item={item} ativo={ativo} tabulavel={tabulavel} compacto={compacto} cb={cb} />
      {compacto ? (
        <>
          {!ativo && precisaAtencao(item) ? <span className="pws-selo-compacto" role="img" aria-label={`${item.contagens.aguardando + item.contagens.erro} ${item.contagens.aguardando + item.contagens.erro === 1 ? "agente precisa" : "agentes precisam"} de atenção`}>{item.contagens.aguardando + item.contagens.erro}</span> : null}
          <Acoes item={item} favorito={favorito} recolhido comChevron={false} menu={menu} setMenu={setMenu} cb={cb} pastaId={idBase} />
        </>
      ) : (
        <>
          <div className="pws-linha-estado">
            <div className="pws-chips">
              {!ativo && precisaAtencao(item) ? <span className="pws-atencao-ponto" role="img" aria-label="precisa de atenção" /> : null}
              <Chips item={item} cb={cb} />
              {terminais > 0 ? <span className="pws-chip pws-chip-terminais" data-tom="neutro" title={`${terminais} ${terminais === 1 ? "terminal aberto" : "terminais abertos"} neste workspace`} aria-label={`${terminais} ${terminais === 1 ? "terminal" : "terminais"}`}>{terminais} {terminais === 1 ? "terminal" : "terminais"}</span> : null}
              {item.contagens.agentes > 0 ? <UltimaAtividade desde={ultimaAtividade(item)} /> : null}
            </div>
          </div>
          <div className="pws-meta" data-favorito={favorito || undefined}>
            {item.branch !== null ? (
              <span className="pws-ramo" title={`Ramo ${item.branch}${item.sujo === true ? " — com alterações" : item.sujo === false ? " — limpo" : ""}`}>
                <Icone nome="ramo" />
                <span className="pws-ramo-nome">{abreviarMeio(item.branch, 18)}</span>
                {item.sujo === true ? <span className="pws-sujo" role="img" aria-label="com alterações" /> : null}
              </span>
            ) : null}
            <span className="pws-pasta" title={item.pasta_mascarada}>{abreviarMeio(item.pasta_mascarada, maxPasta)}</span>
            <Acoes item={item} favorito={favorito} recolhido={recolhido} comChevron menu={menu} setMenu={setMenu} cb={cb} pastaId={idBase} />
          </div>
        </>
      )}
      <LinhaSuite workspaceId={item.id} atual={ativo} compacta aoAtivar={() => cb.trocar(item.id)} />
      {removendo ? (
        <div className="pws-confirmar" role="alertdialog" aria-label={`Remover ${item.nome} da lista?`}>
          <p className="pws-confirmar-texto"><strong>Remover {item.nome} da lista?</strong> <span>A pasta não é apagada. As sessões dele continuam.</span></p>
          <div className="pws-confirmar-acoes">
            <button type="button" className="pws-botao pws-botao-perigo" autoFocus onClick={() => cb.confirmarRemover(item.id)}>Sim, remover</button>
            <button type="button" className="pws-botao" onClick={() => cb.pedirRemover(null)}>Não</button>
          </div>
        </div>
      ) : null}
      {!recolhido && !compacto && linhas.length > 0 ? (
        <ul className="pws-arvore" id={idCorpo} aria-label={`Agentes em ${item.nome}`}>
          {linhas.map((l) => {
            if (l.tipo === "agente") return <LinhaAgente key={l.id} l={l} item={item} terminando={terminando === l.agente.sessao_id} cb={cb} filhos={filhosDe(l.agente.sessao_id)} />;
            if (l.tipo === "missao") {
              return (
                <li key={l.id} className="pws-no pws-no-missao" data-nivel={0}>
                  <button type="button" className="pws-missao" data-nav="agente" data-ws={item.id} onClick={() => cb.abrirMissao(item.id)} title="Abrir a Missão">
                    <Icone nome="missoes" />
                    <span className="pws-agente-texto">
                      <span className="pws-agente-titulo"><span className="pws-agente-nome">{l.titulo}</span></span>
                      <span className="pws-agente-agora">Missão · {l.modo} · {l.estado}{l.mais > 0 ? ` · +${l.mais} ativa${l.mais === 1 ? "" : "s"}` : ""}</span>
                    </span>
                    <span className="pws-abrir-missao">Abrir Missão</span>
                  </button>
                </li>
              );
            }
            if (l.tipo === "execucao") {
              return (
                <li key={l.id} className="pws-no pws-no-exec" data-nivel={0}>
                  <button type="button" className="pws-agente pws-exec" data-nav="agente" data-ws={item.id} onClick={() => (l.sessao_id !== null ? cb.irParaAgente(item.id, l.sessao_id) : cb.trocar(item.id))} title="Execução do projeto (botão Executar)">
                    <Glifo estado={l.fase === "falhou" ? "erro" : l.fase === "rodando" ? "anel" : "pausa"} />
                    <span className="pws-agente-texto">
                      <span className="pws-agente-titulo"><span className="pws-agente-nome">Execução{l.nome !== null ? ` · ${l.nome}` : ""}</span><Tempo desde={l.iniciado_em} rotulo="há quanto tempo está rodando" /></span>
                      <span className="pws-agente-agora">{rotuloFaseExecucao(l.fase)}{l.porta !== null ? ` · porta ${l.porta}` : ""}</span>
                    </span>
                  </button>
                </li>
              );
            }
            return <li key={l.id} className="pws-mais" >e mais {l.quantos} {l.quantos === 1 ? "agente" : "agentes"}</li>;
          })}
        </ul>
      ) : null}
    </li>
  );
});

// ---- container ----

export interface PropsPainelWorkspaces {
  store?: StorePainelWorkspaces;
  workspaces?: StoreWorkspaces;
  terminais?: StoreTerminais;
  /** troca de tela / foco de sessão (injetáveis em teste). */
  irParaSessao?: (sessaoId: string) => void;
  irParaTela?: (id: "missoes" | "terminais") => void;
  /** a casca é estreita: o painel vira sobreposição (Esc fecha). */
  sobreposto?: boolean;
  /** raiz que recebe a variável CSS de largura (padrão: o ancestral `.casca`). */
  raizLargura?: () => HTMLElement | null;
}

function useJanelaEstreita(): boolean {
  const consulta = `(max-width: ${LARGURA_JANELA_SOBREPOSICAO}px)`;
  return useSyncExternalStore(
    (o) => { if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined; const m = window.matchMedia(consulta); m.addEventListener("change", o); return () => m.removeEventListener("change", o); },
    () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(consulta).matches : false),
  );
}

export function PainelWorkspaces({ store = storePainelWorkspaces, workspaces = storeWorkspaces, terminais = storeTerminais, irParaSessao = pedirFocoSessao, irParaTela = (id) => pedirTela(id), sobreposto, raizLargura }: PropsPainelWorkspaces) {
  const { prefs, resumo, erro, carregando, disponivel } = usePainelWorkspaces(store);
  const { atual, recentes, carregado } = useWorkspaces(workspaces);
  const { sessoes } = useTerminais(terminais);
  const estreita = useJanelaEstreita();
  const modoSobreposto = sobreposto ?? estreita;
  const [filtro, setFiltro] = useState("");
  const [focoId, setFocoId] = useState<string | null>(null);
  const [terminando, setTerminando] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [atualOtimista, setAtualOtimista] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const [arrasto, setArrasto] = useState<{ id: string; alvo: string | null } | null>(null);
  const raiz = useRef<HTMLElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const anterior = useRef<readonly ItemWorkspaceResumo[]>([]);

  // só acompanha o main enquanto o painel existe (fixado)
  useEffect(() => { void store.ativar(); return () => store.desativar(); }, [store]);
  useEffect(() => { void workspaces.iniciar(); }, [workspaces]);

  // largura: variável CSS no ancestral `.casca` (nada de re-render das telas)
  useEffect(() => {
    const alvo = raizLargura?.() ?? raiz.current?.closest<HTMLElement>(".casca") ?? null;
    alvo?.style.setProperty("--painel-ws-largura", `${prefs.largura}px`);
    return () => { alvo?.style.removeProperty("--painel-ws-largura"); };
  }, [prefs.largura, raizLargura]);

  const atualId = atualOtimista ?? atual?.id ?? null;
  useEffect(() => { if (atualOtimista !== null && atual?.id === atualOtimista) setAtualOtimista(null); }, [atual?.id, atualOtimista]);

  // estado ao vivo (store de terminais) por cima do snapshot do main
  const porSessao = useMemo(() => new Map(sessoes.map((s) => [s.sessao_id, s])), [sessoes]);
  const itensVivos = useMemo(() => {
    const agora = Date.now();
    return (resumo?.itens ?? []).map((i) => aplicarAoVivo(i, (id) => porSessao.get(id), agora));
  }, [resumo, porSessao]);

  // anúncios discretos (aria-live polite) das mudanças que importam
  useEffect(() => {
    const msgs = anunciosDeMudanca(anterior.current, itensVivos);
    anterior.current = itensVivos;
    if (msgs.length > 0) setAnuncio(msgs.join(". "));
  }, [itensVivos]);

  const ordenados = useMemo(() => ordenarItens(itensVivos, prefs), [itensVivos, prefs]);
  const visiveis = useMemo(() => filtrarItens(ordenados, filtro), [ordenados, filtro]);
  const atencaoFora = useMemo(() => somarAtencaoFora(itensVivos.map((i) => ({ ...i, atual: i.id === atualId }))), [itensVivos, atualId]);
  const ids = useMemo(() => visiveis.map((i) => i.id), [visiveis]);
  // D-570/D-571: terminais por workspace (contagem viva) e o grupo "Sem projeto"
  const conhecidos = useMemo(() => (carregado ? idsConhecidos(atual, recentes) : null), [carregado, atual, recentes]);
  const contagem = useContagemTerminais(conhecidos, terminais);
  const semProjetoAtivo = useVisaoSemProjeto();
  const todosRecolhidos = ordenados.length > 0 && ordenados.every((i) => prefs.recolhidos.includes(i.id));
  const compacto = prefs.modo === "compacto";
  const maxPasta = Math.max(16, Math.floor((prefs.largura - 36) / 7));

  // refs estáveis para os callbacks (o cartão é memorizado)
  const vivo = useRef({ atualId, ids, ordenados, prefs });
  vivo.current = { atualId, ids, ordenados, prefs };

  const trocar = useCallback((id: string) => {
    storeVisaoTerminais.sairDeSemProjeto(); // D-571: escolher um workspace sai do grupo "Sem projeto"
    if (id === vivo.current.atualId) return;
    setAtualOtimista(id);
    void workspaces.definirAtual(id);
  }, [workspaces]);

  const cb = useMemo<CallbacksCartao>(() => ({
    trocar,
    abrir: (id) => { trocar(id); irParaTela("terminais"); },
    irParaAgente: (wsId, sessaoId) => { trocar(wsId); irParaSessao(sessaoId); },
    irParaTerminais: (wsId, sessaoId) => { trocar(wsId); if (sessaoId !== null) irParaSessao(sessaoId); else irParaTela("terminais"); },
    abrirMissao: (wsId) => { trocar(wsId); irParaTela("missoes"); },
    pedirTerminar: (sessaoId) => setTerminando(sessaoId),
    confirmarTerminar: (wsId, sessaoId) => {
      setTerminando(null);
      void store.encerrarAgente(wsId, sessaoId).then((r) => setAnuncio(r.ok ? "Agente terminado." : "Não foi possível terminar o agente."));
    },
    alternarRecolhido: (id) => store.alternarRecolhido(id),
    alternarFavorito: (id) => store.alternarFavorito(id),
    pedirRemover: (id) => setRemovendo(id),
    confirmarRemover: (id) => {
      setRemovendo(null);
      void workspaces.remover(id).then(() => store.atualizar());
    },
    revelar: (id) => void store.revelar(id),
    copiarCaminho: (id) => void store.copiarCaminho(id).then((ok) => setAnuncio(ok ? "Caminho copiado." : "Não foi possível copiar o caminho.")),
    focoCartao: (id) => setFocoId(id),
  }), [trocar, irParaSessao, irParaTela, store, workspaces]);

  // arrastar para reordenar (persistido)
  const arrastoRef = useRef(arrasto);
  arrastoRef.current = arrasto;
  const aoArrastar = useMemo(() => ({
    inicio: (id: string) => setArrasto({ id, alvo: null }),
    sobre: (e: DragEvent, id: string) => { if (arrastoRef.current === null) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; setArrasto((a) => (a !== null && a.alvo !== id ? { ...a, alvo: id } : a)); },
    soltar: (e: DragEvent, id: string) => {
      e.preventDefault();
      const a = arrastoRef.current;
      if (a !== null) store.definirOrdem(moverNaOrdem(vivo.current.ordenados.map((i) => i.id), a.id, id));
      setArrasto(null);
    },
    fim: () => setArrasto(null),
  }), [store]);
  // teclado: ↑/↓ entre cartões, → entra nos agentes, ← volta ao cartão, Delete pede terminar, Alt+↑/↓ reordena, Esc fecha confirmações
  const teclar = (e: KeyboardEvent<HTMLElement>): void => {
    const alvo = e.target as HTMLElement;
    const nav = alvo.closest<HTMLElement>("[data-nav]");
    if (e.key === "Escape") {
      if (terminando !== null || removendo !== null) { e.preventDefault(); e.stopPropagation(); const ws = alvo.closest<HTMLElement>("[data-ws-cartao]")?.dataset["wsCartao"]; setTerminando(null); setRemovendo(null); if (ws !== undefined) requestAnimationFrame(() => raiz.current?.querySelector<HTMLElement>(`[data-nav="cartao"][data-ws="${CSS.escape(ws)}"]`)?.focus()); }
      return;
    }
    if (nav === null || e.ctrlKey || e.metaKey) return;
    const tipo = nav.dataset["nav"];
    const cartoes = [...(lista.current?.querySelectorAll<HTMLElement>('[data-nav="cartao"]') ?? [])];
    if (tipo === "cartao") {
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const id = nav.dataset["ws"] ?? "";
        store.definirOrdem(moverUmPasso(ordenados.map((x) => x.id), id, e.key === "ArrowUp" ? -1 : 1));
        requestAnimationFrame(() => raiz.current?.querySelector<HTMLElement>(`[data-nav="cartao"][data-ws="${CSS.escape(id)}"]`)?.focus());
        return;
      }
      const i = cartoes.indexOf(nav);
      const ir = passoNaLista(e.key, i, cartoes.length);
      if (ir !== null) { e.preventDefault(); cartoes[ir]?.focus(); return; }
      if (e.key === "ArrowRight") {
        const ws = nav.dataset["ws"] ?? "";
        const primeiro = lista.current?.querySelector<HTMLElement>(`[data-ws-cartao="${CSS.escape(ws)}"] [data-nav="agente"]`);
        if (primeiro !== null && primeiro !== undefined) { e.preventDefault(); primeiro.focus(); } else if (prefs.recolhidos.includes(ws)) { e.preventDefault(); store.alternarRecolhido(ws); }
      } else if (e.key === "ArrowLeft" && !prefs.recolhidos.includes(nav.dataset["ws"] ?? "")) { e.preventDefault(); store.alternarRecolhido(nav.dataset["ws"] ?? ""); }
      return;
    }
    // dentro dos agentes do cartão
    const ws = nav.dataset["ws"] ?? "";
    const linhas = [...(lista.current?.querySelectorAll<HTMLElement>(`[data-ws-cartao="${CSS.escape(ws)}"] [data-nav="agente"]`) ?? [])];
    const i = linhas.indexOf(nav);
    if (tipo === "agente") {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const j = e.key === "ArrowDown" ? Math.min(linhas.length - 1, i + 1) : i - 1; if (j < 0) lista.current?.querySelector<HTMLElement>(`[data-nav="cartao"][data-ws="${CSS.escape(ws)}"]`)?.focus(); else linhas[j]?.focus(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); lista.current?.querySelector<HTMLElement>(`[data-nav="cartao"][data-ws="${CSS.escape(ws)}"]`)?.focus(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); nav.parentElement?.querySelector<HTMLElement>('[data-nav="terminar"]')?.focus(); }
      else if (e.key === "Delete" || e.key === "Backspace") { const s = nav.dataset["sessao"]; if (s !== undefined) { e.preventDefault(); setTerminando(s); } }
    } else if (tipo === "terminar") {
      if (e.key === "ArrowLeft") { e.preventDefault(); nav.parentElement?.querySelector<HTMLElement>('[data-nav="agente"]')?.focus(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const atualLinha = nav.parentElement?.querySelector<HTMLElement>('[data-nav="agente"]'); const k = atualLinha === null || atualLinha === undefined ? -1 : linhas.indexOf(atualLinha); const j = e.key === "ArrowDown" ? Math.min(linhas.length - 1, k + 1) : k - 1; if (j < 0) lista.current?.querySelector<HTMLElement>(`[data-nav="cartao"][data-ws="${CSS.escape(ws)}"]`)?.focus(); else linhas[j]?.focus(); }
    }
  };

  // Esc fecha o painel sobreposto (depois das confirmações)
  const aoEscapar = (e: KeyboardEvent<HTMLElement>): void => {
    teclar(e);
    if (e.key === "Escape" && !e.isPropagationStopped() && modoSobreposto) { e.preventDefault(); store.definirFixado(false); }
  };

  // redimensionar pela borda (arrastar ou teclado)
  const arrastoBorda = useRef<{ x: number; largura: number } | null>(null);
  const iniciarBorda = (e: PointerReact<HTMLDivElement>): void => { e.currentTarget.setPointerCapture(e.pointerId); arrastoBorda.current = { x: e.clientX, largura: prefs.largura }; };
  const moverBorda = (e: PointerReact<HTMLDivElement>): void => {
    const a = arrastoBorda.current;
    if (a === null) return;
    const l = limitarLargura(a.largura + e.clientX - a.x);
    (raizLargura?.() ?? raiz.current?.closest<HTMLElement>(".casca") ?? null)?.style.setProperty("--painel-ws-largura", `${l}px`);
    e.currentTarget.setAttribute("aria-valuenow", String(l));
  };
  const soltarBorda = (e: PointerReact<HTMLDivElement>): void => {
    const a = arrastoBorda.current;
    arrastoBorda.current = null;
    if (a !== null) store.definirLargura(a.largura + e.clientX - a.x);
  };
  const teclaBorda = (e: KeyboardEvent<HTMLDivElement>): void => {
    const l = larguraPorTecla(e.key, prefs.largura, e.shiftKey);
    if (l !== null) { e.preventDefault(); store.definirLargura(l); }
  };

  const vazio = disponivel && carregado && atual === null && ordenados.length === 0 && erro === null;
  const sembarra = !disponivel;
  const tabulavelId = focoId !== null && ids.includes(focoId) ? focoId : (ids.includes(atualId ?? "") ? atualId : ids[0]) ?? null;

  return (
    <aside ref={raiz} className="painel-ws" data-modo="cheia" data-sobreposto={modoSobreposto || undefined} data-compacto={compacto || undefined} aria-label="Workspaces" onKeyDown={aoEscapar}>
      <header className="pws-topo">
        <div className="pws-titulo-linha">
          <h2 className="pws-titulo">Workspaces</h2>
          <span className="pws-contagem" aria-label={`${ordenados.length} ${ordenados.length === 1 ? "workspace" : "workspaces"}`}>{ordenados.length}</span>
          {atencaoFora > 0 ? <span className="pws-selo" role="img" aria-label={`${atencaoFora} ${atencaoFora === 1 ? "agente precisa" : "agentes precisam"} de atenção em outros workspaces`} title="Agentes aguardando você ou com erro em outros workspaces">{atencaoFora}</span> : null}
          <span className="pws-espaco" />
          {modoSobreposto ? <button type="button" className="pws-icone-botao" aria-label="Soltar o painel" title="Fechar o painel (Esc)" onClick={() => store.definirFixado(false)}><Icone nome="fechar" /></button> : null}
          <button type="button" className="pws-icone-botao" aria-label={todosRecolhidos ? "Expandir todos os cartões" : "Recolher todos os cartões"} title={todosRecolhidos ? "Expandir tudo" : "Recolher tudo"} disabled={compacto || ordenados.length === 0} onClick={() => (todosRecolhidos ? store.expandirTodos() : store.recolherTodos(ordenados.map((i) => i.id)))}>
            <Icone nome={todosRecolhidos ? "desdobrar" : "dobrar"} />
          </button>
          <button type="button" className="pws-icone-botao" aria-pressed={compacto} aria-label="Visão geral compacta" title={compacto ? "Voltar aos cartões detalhados" : "Visão geral: uma linha por workspace"} onClick={() => store.definirModo(compacto ? "detalhado" : "compacto")}>
            <Icone nome="lista" />
          </button>
          <button type="button" className="pws-icone-botao" aria-label="Adicionar workspace" title="Adicionar workspace: abrir pasta, clonar repositório ou novo projeto" onClick={() => storeAdicionarWorkspace.abrir("pasta")}>
            <Icone nome="mais" />
          </button>
        </div>
        <label className="pws-busca">
          <Icone nome="busca" />
          <span className="sr-somente">Filtrar workspaces</span>
          <input type="search" value={filtro} placeholder="Filtrar por nome, ramo ou agente" autoComplete="off" spellCheck={false} onChange={(e) => setFiltro(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && filtro !== "") { e.stopPropagation(); setFiltro(""); } else if (e.key === "ArrowDown") { e.preventDefault(); lista.current?.querySelector<HTMLElement>('[data-nav="cartao"]')?.focus(); } }} />
        </label>
      </header>

      <div className="pws-corpo">
        {sembarra ? <p className="pws-vazio">O painel só funciona no aplicativo.</p> : null}
        {erro !== null ? (
          <div className="pws-erro" role="alert">
            <span>{erro}</span>
            <span className="pws-erro-acoes">
              <button type="button" className="pws-botao" onClick={() => { store.limparErro(); void store.atualizar(); }}>Tentar de novo</button>
              <button type="button" className="pws-botao" onClick={() => store.limparErro()}>Dispensar</button>
            </span>
          </div>
        ) : null}
        {carregando && resumo === null && erro === null ? <div className="pws-esqueleto" role="status" aria-busy="true"><span className="sr-somente">Carregando workspaces…</span><i /><i /><i /></div> : null}
        {vazio ? (
          <div className="pws-vazio">
            <Icone nome="workspaces" />
            <p><strong>Nenhum projeto aberto</strong> — abra uma pasta.</p>
            <button type="button" className="pws-botao pws-botao-primario" onClick={() => storeAdicionarWorkspace.abrir("pasta")}>Adicionar workspace…</button>
          </div>
        ) : null}
        {resumo !== null && visiveis.length === 0 && ordenados.length > 0 ? <p className="pws-vazio">Nenhum workspace combina com “{filtro}”.</p> : null}
        {visiveis.length > 0 ? (
          <ul ref={lista} className="pws-lista" aria-label="Workspaces e seus agentes">
            {visiveis.map((item) => (
              <Cartao
                key={item.id}
                item={item}
                ativo={item.id === atualId}
                recolhido={prefs.recolhidos.includes(item.id)}
                favorito={prefs.favoritos.includes(item.id)}
                compacto={compacto}
                terminando={terminando !== null && item.agentes.some((a) => a.sessao_id === terminando) ? terminando : null}
                removendo={removendo === item.id}
                tabulavel={item.id === tabulavelId}
                arrastando={arrasto?.id === item.id}
                alvoSolto={arrasto !== null && arrasto.alvo === item.id && arrasto.id !== item.id}
                maxPasta={maxPasta}
                terminais={contagem.porWorkspace.get(item.id) ?? 0}
                cb={cb}
                aoArrastar={aoArrastar}
              />
            ))}
          </ul>
        ) : null}
        {contagem.semProjeto > 0 ? (
          <button type="button" className="pws-sem-projeto" aria-current={semProjetoAtivo ? "true" : undefined} title="Terminais que não pertencem a nenhum workspace" onClick={() => { storeVisaoTerminais.entrarEmSemProjeto(); pedirTela("terminais"); }}>
            Sem projeto ({contagem.semProjeto})
          </button>
        ) : null}
      </div>

      <div className="sr-somente" role="status" aria-live="polite" aria-atomic="true">{anuncio}</div>
      <div
        className="pws-borda" role="separator" aria-orientation="vertical" aria-label="Largura do painel de workspaces" aria-valuemin={LARGURA_MIN} aria-valuemax={LARGURA_MAX} aria-valuenow={prefs.largura} tabIndex={0}
        onPointerDown={iniciarBorda} onPointerMove={moverBorda} onPointerUp={soltarBorda} onPointerCancel={soltarBorda} onKeyDown={teclaBorda}
      />
    </aside>
  );
}

export default PainelWorkspaces;
