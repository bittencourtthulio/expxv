// Painel "Progresso" da tela Terminais (D-660…): coluna FIXA à direita da grade, estreita (232–280 px; padrão 248, 200–320 pelo divisor), com a lista TO-DO do que a
// pipeline vai fazer. Aparece sozinha quando algo começa, marca cada etapa conforme termina e fecha sozinha ao fim (ciclo em `nucleo/progresso/ciclo`).
// Não sobrepõe terminais (a grade encolhe); abaixo de ~1000 px de janela vira uma barra fina de 24 px que expande por cima ao clicar. Só tokens de cor.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as TecladoReact, type PointerEvent as PonteiroReact, type ReactElement } from "react";
import {
  LARGURA_JANELA_PROGRESSO,
  LARGURA_PROGRESSO_MAX,
  LARGURA_PROGRESSO_MIN,
  LARGURA_PROGRESSO_PADRAO,
  LARGURA_PROGRESSO_RECOLHIDO,
  MAX_ABAS_PROGRESSO,
  limitarLarguraProgresso,
  type ItemProgresso,
  type Progresso,
} from "../../../compartilhado/progresso";
import { contagem, formatarDuracao, itemAtual, resumoDoProgresso, type EntradaCiclo } from "../../../nucleo/progresso/cliente";
import { PRODUTO } from "../../../nucleo/produto";
import { Icone } from "../../componentes/Icone";
import { storeProgresso, useProgresso, type StoreProgresso } from "../../estado/progresso";
import "./progresso.css";

export const CHAVE_LARGURA_PROGRESSO = `${PRODUTO.id}.progresso.largura`;
const PASSO_TECLADO = 16;

// ---------------------------------------------------------------- largura persistida
function lerLargura(): number {
  try {
    const t = globalThis.localStorage?.getItem(CHAVE_LARGURA_PROGRESSO);
    return t === null || t === undefined ? LARGURA_PROGRESSO_PADRAO : limitarLarguraProgresso(Number(t));
  } catch { return LARGURA_PROGRESSO_PADRAO; }
}
function gravarLargura(n: number): void {
  try { globalThis.localStorage?.setItem(CHAVE_LARGURA_PROGRESSO, String(n)); } catch { /* sem armazenamento: vale só nesta sessão */ }
}

/** Largura da JANELA (não da tela): decide a barra fina. Recalcula em quadro de animação, nunca por evento de resize cru. */
function useLarguraJanela(forcada: number | undefined): number {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  useEffect(() => {
    if (forcada !== undefined || typeof window === "undefined") return;
    let quadro = 0;
    const aoRedimensionar = (): void => {
      if (quadro !== 0) return;
      quadro = requestAnimationFrame(() => { quadro = 0; setW(window.innerWidth); });
    };
    window.addEventListener("resize", aoRedimensionar);
    return () => { window.removeEventListener("resize", aoRedimensionar); if (quadro !== 0) cancelAnimationFrame(quadro); };
  }, [forcada]);
  return forcada ?? w;
}

/** Relógio de baixa frequência: só corre com etapa em andamento medida e painel aberto (nenhum timer com tudo parado). */
function useAgora(ativo: boolean, intervaloMs = 15_000): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!ativo) return;
    setT(Date.now());
    const id = setInterval(() => setT(Date.now()), intervaloMs);
    return () => clearInterval(id);
  }, [ativo, intervaloMs]);
  return t;
}

// ---------------------------------------------------------------- marcas dos itens (SVG, só tokens)
const TEXTO_ESTADO: Readonly<Record<ItemProgresso["estado"], string>> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  aguardando: "Aguardando você",
  concluido: "Concluído",
  falhou: "Falhou",
  pulado: "Pulado",
};

function Marca({ estado }: { estado: ItemProgresso["estado"] }): ReactElement {
  return (
    <span className="prog-marca" data-estado={estado} aria-hidden="true">
      {estado === "concluido" ? (
        <svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="7" className="prog-marca-fundo" /><path d="M4.6 8.4l2.3 2.3 4.5-4.9" className="prog-marca-check" pathLength="1" /></svg>
      ) : estado === "falhou" ? (
        <svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="7" className="prog-marca-fundo" /><path d="M8 4.6v4.2M8 11.3v.2" className="prog-marca-sinal" /></svg>
      ) : estado === "aguardando" ? (
        <svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="7" className="prog-marca-fundo" /><path d="M6.3 5.6v4.8M9.7 5.6v4.8" className="prog-marca-sinal" /></svg>
      ) : estado === "em_andamento" ? (
        <svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6.5" className="prog-marca-trilho" /><circle cx="8" cy="8" r="6.5" className="prog-marca-anel" pathLength="100" /></svg>
      ) : estado === "pulado" ? (
        <svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6.5" className="prog-marca-vazio" /><path d="M5.6 8h4.8" className="prog-marca-sinal" /></svg>
      ) : (
        <svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6.5" className="prog-marca-vazio" /></svg>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- itens
function tempoDoItem(i: ItemProgresso, agora: number): string | null {
  if (i.estado === "concluido" && i.desde !== undefined && i.fim_em !== undefined && i.fim_em >= i.desde) return formatarDuracao(i.fim_em - i.desde);
  if ((i.estado === "em_andamento" || i.estado === "aguardando") && i.desde !== undefined && agora >= i.desde) return formatarDuracao(agora - i.desde);
  return null;
}

interface PropsItem {
  item: ItemProgresso;
  atual: boolean;
  novo: boolean;
  agora: number;
  aoAbrir(item: ItemProgresso): void;
}

const Item = memo(function Item({ item, atual, novo, agora, aoAbrir }: PropsItem): ReactElement {
  const tempo = tempoDoItem(item, agora);
  const clicavel = item.sessao_id !== undefined && item.sessao_id !== null;
  const corpo = (
    <>
      <Marca estado={item.estado} />
      <span className="prog-texto">
        <span className="prog-rotulo">{item.rotulo}</span>
        <span className="terminais-sr">: {TEXTO_ESTADO[item.estado]}{item.detalhe !== undefined ? `, ${item.detalhe}` : ""}</span>
        {item.detalhe !== undefined ? <span className="prog-detalhe" aria-hidden="true">{item.detalhe}</span> : null}
      </span>
      {tempo !== null ? <span className="prog-tempo" aria-hidden="true">{tempo}</span> : null}
    </>
  );
  return (
    <li className="prog-item" data-estado={item.estado} data-atual={atual || undefined} data-novo={novo || undefined} aria-current={atual ? "step" : undefined} data-item={item.id}>
      {clicavel ? (
        <button type="button" className="prog-linha" title="Ir para o terminal desta etapa" onClick={() => aoAbrir(item)}>{corpo}</button>
      ) : (
        <div className="prog-linha" data-estatica>{corpo}</div>
      )}
    </li>
  );
});

interface Secao { grupo: string | null; itens: ItemProgresso[] }
function secoes(itens: readonly ItemProgresso[]): Secao[] {
  const out: Secao[] = [];
  for (const i of itens) {
    const g = i.grupo ?? null;
    const ultima = out[out.length - 1];
    if (ultima !== undefined && ultima.grupo === g) ultima.itens.push(i); else out.push({ grupo: g, itens: [i] });
  }
  return out;
}

// ---------------------------------------------------------------- lista
function Lista({ p, atualId, novos, agora, aoAbrir }: { p: Progresso; atualId: string | null; novos: ReadonlySet<string>; agora: number; aoAbrir(i: ItemProgresso): void }): ReactElement {
  const partes = useMemo(() => secoes(p.itens), [p.itens]);
  const [abertas, setAbertas] = useState<Record<string, boolean>>({});
  const comGrupo = partes.some((s) => s.grupo !== null);
  const render = (itens: readonly ItemProgresso[]): ReactElement => (
    <ol className="prog-itens">
      {itens.map((i) => <Item key={i.id} item={i} atual={i.id === atualId} novo={novos.has(i.id)} agora={agora} aoAbrir={aoAbrir} />)}
    </ol>
  );
  if (!comGrupo) return render(p.itens);
  return (
    <ol className="prog-grupos">
      {partes.map((s, n) => {
        const feitos = s.itens.filter((i) => i.estado === "concluido").length;
        const completo = feitos === s.itens.length;
        const contemAtual = s.itens.some((i) => i.id === atualId);
        // fases concluídas recolhem sozinhas; a que tem a etapa atual abre; o dono pode inverter qualquer uma
        const aberta = abertas[s.grupo ?? String(n)] ?? (contemAtual || !completo);
        return (
          <li key={s.grupo ?? n} className="prog-grupo" data-completo={completo || undefined}>
            <button type="button" className="prog-grupo-cab" aria-expanded={aberta} onClick={() => setAbertas((a) => ({ ...a, [s.grupo ?? String(n)]: !aberta }))}>
              <Icone nome="chevron" className={aberta ? "prog-chevron prog-chevron-aberto" : "prog-chevron"} />
              <span className="prog-grupo-nome">{s.grupo}</span>
              <span className="prog-grupo-conta">{feitos}/{s.itens.length}</span>
            </button>
            {aberta ? render(s.itens) : null}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- painel
export interface PropsPainelProgresso {
  store?: StoreProgresso;
  /** força a largura da JANELA (o teste; em produção vem de `window.innerWidth`). */
  larguraJanela?: number | undefined;
  /** área de terminais em foco único (D-32): o painel fica na barra fina. */
  compacto?: boolean | undefined;
}

function tomDe(e: EntradaCiclo): "normal" | "aguardando" | "falha" | "concluido" {
  if (e.progresso.resultado === "falhou") return "falha";
  if (e.progresso.resultado === "aguardando") return "aguardando";
  if (e.progresso.resultado === "concluido") return "concluido";
  return "normal";
}

export const PainelProgresso = memo(function PainelProgresso({ store = storeProgresso, larguraJanela, compacto = false }: PropsPainelProgresso): ReactElement | null {
  const ciclo = useProgresso((e) => e.ciclo, store);
  const anuncio = useProgresso((e) => e.anuncio, store);
  const lista = useMemo(
    () => (ciclo.ligado ? Object.values(ciclo.itens).filter((c) => c.fase !== "oculto" && c.progresso.workspace_id === ciclo.workspace_id).sort((a, b) => a.progresso.iniciado_em - b.progresso.iniciado_em || (a.progresso.id < b.progresso.id ? -1 : 1)) : []),
    [ciclo],
  );
  const janela = useLarguraJanela(larguraJanela);
  const estreita = compacto || janela < LARGURA_JANELA_PROGRESSO;
  const [largura, setLargura] = useState<number>(() => lerLargura());
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [expandido, setExpandido] = useState(false); // só no modo barra fina: expansão sobreposta
  const [menu, setMenu] = useState(false);
  const [todasAbas, setTodasAbas] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const rolagem = useRef<HTMLDivElement>(null);
  const arrasto = useRef<{ x: number; largura: number } | null>(null);

  // qual progresso aparece: o escolhido; senão o que pede atenção (falha/aguardando); senão o mais antigo
  const mostrado = useMemo<EntradaCiclo | null>(() => {
    if (lista.length === 0) return null;
    return lista.find((c) => c.progresso.id === escolhido) ?? lista.find((c) => c.progresso.resultado === "falhou" || c.progresso.resultado === "aguardando") ?? lista[0] ?? null;
  }, [lista, escolhido]);

  const p = mostrado?.progresso ?? null;
  const atual = p === null ? null : itemAtual(p);
  const atualId = atual?.id ?? null;
  const medindo = p !== null && p.itens.some((i) => (i.estado === "em_andamento" || i.estado === "aguardando") && i.desde !== undefined);
  const agora = useAgora(medindo && (!estreita || expandido));

  // animação curta de "check": só nos itens que acabaram de concluir
  const anteriores = useRef<Map<string, string>>(new Map());
  const [novos, setNovos] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (p === null) { anteriores.current = new Map(); return; }
    const antes = anteriores.current;
    const agoraConcluidos = p.itens.filter((i) => i.estado === "concluido" && antes.get(i.id) !== undefined && antes.get(i.id) !== "concluido").map((i) => i.id);
    anteriores.current = new Map(p.itens.map((i) => [i.id, i.estado]));
    if (agoraConcluidos.length === 0) return;
    setNovos(new Set(agoraConcluidos));
    const t = setTimeout(() => setNovos(new Set()), 500);
    return () => clearTimeout(t);
  }, [p]);

  // a lista ROLA para manter a etapa atual à vista
  useEffect(() => {
    if (atualId === null || rolagem.current === null) return;
    const el = rolagem.current.querySelector<HTMLElement>(`[data-item="${CSS.escape(atualId)}"]`);
    (el as (HTMLElement & { scrollIntoView?: (o?: ScrollIntoViewOptions) => void }) | null)?.scrollIntoView?.({ block: "nearest" });
  }, [atualId, mostrado?.recolhido, expandido, estreita]);

  // fechar o menu e a expansão sobreposta com Esc ou clique fora
  useEffect(() => {
    if (!menu && !(estreita && expandido)) return;
    const fora = (e: MouseEvent): void => { if (raiz.current !== null && e.target instanceof Node && !raiz.current.contains(e.target)) { setMenu(false); if (estreita) setExpandido(false); } };
    const tecla = (e: KeyboardEvent): void => { if (e.key === "Escape") { setMenu(false); if (estreita) setExpandido(false); } };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", tecla); };
  }, [menu, estreita, expandido]);

  const abrirItem = useCallback((i: ItemProgresso) => { if (i.sessao_id !== undefined && i.sessao_id !== null) store.focarEtapa(i.sessao_id); }, [store]);

  const iniciarBorda = (e: PonteiroReact<HTMLDivElement>): void => { e.currentTarget.setPointerCapture?.(e.pointerId); arrasto.current = { x: e.clientX, largura }; };
  const moverBorda = (e: PonteiroReact<HTMLDivElement>): void => { if (arrasto.current !== null) setLargura(limitarLarguraProgresso(arrasto.current.largura + (arrasto.current.x - e.clientX))); };
  const soltarBorda = (e: PonteiroReact<HTMLDivElement>): void => {
    if (arrasto.current === null) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    arrasto.current = null;
    gravarLargura(largura);
  };
  const teclaBorda = (e: TecladoReact<HTMLDivElement>): void => {
    const delta = e.key === "ArrowLeft" ? PASSO_TECLADO : e.key === "ArrowRight" ? -PASSO_TECLADO : 0;
    if (delta === 0) return;
    e.preventDefault();
    const n = limitarLarguraProgresso(largura + delta);
    setLargura(n);
    gravarLargura(n);
  };

  if (mostrado === null || p === null) {
    // região viva sempre presente enquanto há algo a anunciar não faz sentido sem painel: nada a renderizar
    return null;
  }

  const { feitos, total } = contagem(p);
  const tom = tomDe(mostrado);
  const recolhido = estreita ? !expandido : mostrado.recolhido;
  const sobreposto = estreita && expandido;
  const resumo = mostrado.fase === "resumo" || mostrado.fase === "leitura" || mostrado.fase === "fechando" || mostrado.progresso.resultado !== "em_andamento";
  const ocultas = lista.length > MAX_ABAS_PROGRESSO ? lista.length - MAX_ABAS_PROGRESSO : 0;
  const abas = todasAbas ? lista : lista.slice(0, MAX_ABAS_PROGRESSO);
  const pedeAtencao = p.resultado === "aguardando" || p.resultado === "falhou";
  const alvoAbrir = p.itens.find((i) => i.estado === "aguardando" && i.sessao_id) ?? p.itens.find((i) => i.estado === "falhou" && i.sessao_id) ?? null;
  const pct = total === 0 ? 0 : Math.round((feitos / total) * 100);

  const aoFechar = (): void => { store.dispensar(p.id); setMenu(false); };
  const aoRecolher = (): void => { if (estreita) setExpandido(false); else store.recolher(p.id, true); };

  const live = <div className="terminais-sr" role="status" aria-live="polite" aria-atomic="true">{anuncio}</div>;

  const envolver = (conteudo: ReactElement, larguraSlot: number): ReactElement => (
    <div ref={raiz} className="prog-slot" data-fase={mostrado.fase} data-estreita={estreita || undefined} style={{ width: larguraSlot }}>{conteudo}</div>
  );

  if (recolhido) {
    return envolver(
      <aside className="prog prog-barra" data-fase={mostrado.fase} data-tom={tom} aria-label="Progresso da pipeline">
        {live}
        <button
          type="button"
          className="prog-barra-botao"
          aria-label={`Mostrar o progresso: ${p.titulo}, ${feitos} de ${total}. ${resumoDoProgresso(p)}`}
          title={`${p.titulo} · ${feitos}/${total}`}
          onClick={() => { if (estreita) setExpandido(true); else store.recolher(p.id, false); }}
        >
          <span className="prog-barra-marca" data-estado={p.resultado === "falhou" ? "falhou" : p.resultado === "aguardando" ? "aguardando" : p.resultado === "concluido" ? "concluido" : "em_andamento"} aria-hidden="true" />
          <span className="prog-barra-conta">{feitos}/{total}</span>
        </button>
        {lista.length > 1 ? <span className="prog-barra-mais" aria-hidden="true">+{lista.length - 1}</span> : null}
      </aside>,
      LARGURA_PROGRESSO_RECOLHIDO,
    );
  }

  return envolver(
    <aside
      className="prog"
      data-fase={mostrado.fase}
      data-tom={tom}
      data-sobreposto={sobreposto || undefined}
      data-leitura={mostrado.fase === "leitura" || undefined}
      style={sobreposto ? { width: largura } : undefined}
      aria-label="Progresso da pipeline"
    >
      {live}
      {!estreita ? (
        <div
          className="prog-borda"
          role="separator"
          aria-orientation="vertical"
          aria-label="Largura do painel de progresso"
          aria-valuemin={LARGURA_PROGRESSO_MIN}
          aria-valuemax={LARGURA_PROGRESSO_MAX}
          aria-valuenow={largura}
          tabIndex={0}
          onPointerDown={iniciarBorda}
          onPointerMove={moverBorda}
          onPointerUp={soltarBorda}
          onPointerCancel={soltarBorda}
          onKeyDown={teclaBorda}
        />
      ) : null}
      <header className="prog-cab">
        <h2 className="prog-titulo" title={p.pedido !== undefined ? `${p.titulo} — ${p.pedido}` : p.titulo}>{p.titulo}</h2>
        <span className="prog-conta" aria-label={`${feitos} de ${total} etapas`}>{feitos}/{total}</span>
        <button type="button" className="prog-botao" aria-label="Mais opções do progresso" aria-haspopup="menu" aria-expanded={menu} title="Mais opções" onClick={() => setMenu((v) => !v)}>
          <Icone nome="reticencias" />
        </button>
        <button type="button" className="prog-botao" aria-label="Recolher o painel de progresso" title="Recolher para uma barra fina" onClick={aoRecolher}>
          <Icone nome="chevron" />
        </button>
        <button type="button" className="prog-botao" aria-label="Fechar este progresso" title="Fechar (só este progresso)" onClick={aoFechar}>
          <Icone nome="fechar" />
        </button>
        {menu ? (
          <div className="prog-menu" role="menu" aria-label="Opções do progresso">
            <button type="button" role="menuitemcheckbox" aria-checked={mostrado.fixado} className="prog-menu-item" onClick={() => { store.fixar(p.id, !mostrado.fixado); setMenu(false); }}>
              <Icone nome="fixar" />
              <span>Fixar aberto</span>
              <span className="prog-menu-marca" aria-hidden="true">{mostrado.fixado ? "✓" : ""}</span>
            </button>
            <button type="button" role="menuitem" className="prog-menu-item" onClick={() => { store.abrirDetalhes(p); setMenu(false); }}>
              <Icone nome="externo" />
              <span>Ver detalhes na tela Pipelines</span>
            </button>
          </div>
        ) : null}
      </header>
      {lista.length > 1 ? (
        <div className="prog-abas" role="tablist" aria-label="Progressos deste workspace">
          {abas.map((c) => {
            const t = contagem(c.progresso);
            return (
              <button key={c.progresso.id} type="button" role="tab" aria-selected={c.progresso.id === p.id} className="prog-aba" data-tom={tomDe(c)} title={c.progresso.titulo} onClick={() => setEscolhido(c.progresso.id)}>
                <span className="prog-aba-nome">{c.progresso.titulo.replace(/^Pipeline: /, "")}</span>
                <span className="prog-aba-conta">{t.feitos}/{t.total}</span>
              </button>
            );
          })}
          {ocultas > 0 ? <button type="button" className="prog-aba prog-aba-mais" aria-expanded={todasAbas} onClick={() => setTodasAbas((v) => !v)}>{todasAbas ? "menos" : `e mais ${ocultas}`}</button> : null}
        </div>
      ) : null}
      <div className="prog-barra-fina" role="progressbar" aria-label="Etapas concluídas" aria-valuemin={0} aria-valuemax={total} aria-valuenow={feitos}>
        <span className="prog-barra-preench" style={{ width: `${pct}%` }} />
      </div>
      {p.previsto || p.pedido !== undefined ? (
        <p className="prog-sub">{p.previsto ? <span className="prog-previsto" title="A lista é a sequência conhecida desta skill, não um plano medido">Etapas previstas</span> : null}{p.previsto && p.pedido !== undefined ? " · " : ""}{p.pedido !== undefined ? <span className="prog-pedido">“{p.pedido}”</span> : null}</p>
      ) : null}
      <div className="prog-rolagem" ref={rolagem}>
        <Lista p={p} atualId={atualId} novos={novos} agora={agora} aoAbrir={abrirItem} />
      </div>
      {resumo || pedeAtencao ? (
        <footer className="prog-rodape" data-tom={tom}>
          <span className="prog-resumo">{resumoDoProgresso(p)}</span>
          {alvoAbrir !== null && pedeAtencao ? <button type="button" className="prog-acao" onClick={() => abrirItem(alvoAbrir)}>Abrir</button> : null}
          {p.resultado === "falhou" ? <button type="button" className="prog-acao" onClick={aoFechar}>Dispensar</button> : null}
        </footer>
      ) : null}
    </aside>,
    estreita ? LARGURA_PROGRESSO_RECOLHIDO : largura,
  );
});
