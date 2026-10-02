import { useEffect, useRef, useState } from "react";
import { MAX_NUCLEOS_VISIVEIS, PONTOS_HISTORICO, tomDoUso, type DetalheSistema, type ProcessoVisto } from "../../compartilhado/sistema";
import { ade } from "../ade";
import { storeSistema, useSistema, type StoreSistema } from "../estado/sistema";
import { pontosSparkline, SEM_AMOSTRA, textoMb, textoPct } from "../estado/sistema-formato";

const RENOVAR_MS = 2_000;

function Barra({ pct, rotulo }: { pct: number; rotulo: string }) {
  return (
    <span className="sis-pbarra" data-tom={tomDoUso(pct)} role="meter" aria-label={rotulo} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <i style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </span>
  );
}

function Sparkline({ serie, rotulo }: { serie: readonly number[]; rotulo: string }) {
  if (serie.length < 2) return <span className="sis-spark sis-spark-vazio" role="img" aria-label={`${rotulo}: coletando`}>coletando…</span>;
  return (
    <svg className="sis-spark" viewBox="0 0 120 26" preserveAspectRatio="none" role="img" aria-label={`${rotulo}: últimos ${Math.round((serie.length * 2) / 60 * 10) / 10} min`}>
      <polyline points={pontosSparkline(serie, 120, 26, PONTOS_HISTORICO)} fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function LinhasProcesso({ lista, valor }: { lista: readonly ProcessoVisto[]; valor: (p: ProcessoVisto) => string }) {
  if (lista.length === 0) return <p className="sis-vazio">{SEM_AMOSTRA}</p>;
  return (
    <ol className="sis-top">
      {lista.map((p, i) => (
        <li key={`${p.nome}-${p.sessao ?? "app"}-${i}`}>
          <span className="sis-top-nome" title={p.sessao === null ? p.nome : `${p.nome} · ${p.sessao}`}>{p.nome}<small>{p.sessao === null ? " · app" : ` · ${p.sessao}`}</small></span>
          <span className="sis-top-valor">{valor(p)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Popover não modal (role=dialog, Esc fecha, clique fora fecha). O detalhe é pedido ao main SÓ enquanto está aberto (a cada 2 s). */
export function PopoverSistema({ store = storeSistema }: { store?: StoreSistema }) {
  const aberto = useSistema((e) => e.aberto, store);
  const amostra = useSistema((e) => e.amostra, store);
  const hCpu = useSistema((e) => e.historicoCpu, store);
  const hRam = useSistema((e) => e.historicoRam, store);
  const [detalhe, setDetalhe] = useState<DetalheSistema | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const api = ade()?.sistema;
    let vivo = true;
    let emVoo = false;
    const pedir = (): void => {
      if (emVoo || typeof api?.detalhe !== "function") return;
      emVoo = true;
      void Promise.resolve(api.detalhe(true)).then((d) => { if (vivo) setDetalhe(d); }).catch(() => undefined).finally(() => { emVoo = false; });
    };
    pedir();
    const t = setInterval(pedir, RENOVAR_MS);
    const anterior = document.activeElement as HTMLElement | null;
    caixa.current?.focus();
    const esc = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.stopPropagation(); store.fechar(); } };
    const fora = (e: MouseEvent): void => {
      const alvo = e.target as Element | null;
      if (alvo !== null && !caixa.current?.contains(alvo) && alvo.closest(".sis-chip") === null) store.fechar();
    };
    document.addEventListener("keydown", esc, true);
    document.addEventListener("mousedown", fora);
    return () => {
      vivo = false;
      clearInterval(t);
      document.removeEventListener("keydown", esc, true);
      document.removeEventListener("mousedown", fora);
      setDetalhe(null);
      void Promise.resolve(api?.detalhe?.(false)).catch(() => undefined);
      if (anterior?.isConnected) anterior.focus();
    };
  }, [aberto, store]);

  if (!aberto) return null;
  const nucleos = detalhe?.nucleos ?? [];
  const visiveis = nucleos.slice(0, MAX_NUCLEOS_VISIVEIS);
  const cpu = amostra?.cpu ?? detalhe?.cpu_total ?? 0;
  const ram = amostra?.ram ?? detalhe?.ram.pct ?? 0;
  return (
    <div ref={caixa} className="sis-pop" role="dialog" aria-modal="false" aria-label="CPU e memória da máquina" tabIndex={-1}>
      <div className="sis-pop-topo">
        <strong>CPU e memória</strong>
        <button type="button" className="botao-mini" onClick={() => void store.definirMostrar(false)}>Ocultar este medidor</button>
        <button type="button" className="botao-mini" aria-label="Fechar" onClick={() => store.fechar()}>Fechar</button>
      </div>

      <section aria-label="CPU">
        <div className="sis-linha"><span>CPU total</span><Barra pct={cpu} rotulo="CPU total" /><span className="sis-valor">{textoPct(amostra?.cpu ?? detalhe?.cpu_total)}</span></div>
        <div className="sis-historico" style={{ color: "var(--destaque-texto)" }}><Sparkline serie={hCpu} rotulo="Histórico de CPU" /></div>
        {visiveis.length > 0 ? (
          <div className="sis-nucleos" role="group" aria-label="CPU por núcleo">
            {visiveis.map((n, i) => (
              <span key={i} className="sis-nucleo" data-tom={tomDoUso(n)}>
                <span className="sis-nucleo-cab"><span>N{i + 1}</span><span>{textoPct(n)}</span></span>
                <Barra pct={n} rotulo={`Núcleo ${i + 1}`} />
              </span>
            ))}
          </div>
        ) : null}
        {nucleos.length > MAX_NUCLEOS_VISIVEIS ? <p className="sis-vazio">e mais {nucleos.length - MAX_NUCLEOS_VISIVEIS}</p> : null}
      </section>

      <section aria-label="Memória">
        <div className="sis-linha"><span>Memória</span><Barra pct={ram} rotulo="Memória em uso" /><span className="sis-valor">{textoPct(amostra?.ram ?? detalhe?.ram.pct)}</span></div>
        <div className="sis-historico" style={{ color: "var(--destaque-texto)" }}><Sparkline serie={hRam} rotulo="Histórico de memória" /></div>
        {detalhe !== null ? (
          <p className="sis-detalhe-linha">
            em uso {textoMb(detalhe.ram.usada_mb)} de {textoMb(detalhe.ram.total_mb)} · disponível {textoMb(detalhe.ram.disponivel_mb)}
            {detalhe.swap !== null && detalhe.swap.total_mb > 0 ? ` · swap ${textoMb(detalhe.swap.usado_mb)} de ${textoMb(detalhe.swap.total_mb)}` : ""}
          </p>
        ) : <p className="sis-vazio">carregando detalhes…</p>}
      </section>

      {detalhe !== null ? (
        <>
          <section aria-label="Este app">
            <h3 className="sis-titulo">Este app <span>{detalhe.app.cpu}% · {textoMb(detalhe.app.mem_mb)}</span></h3>
            <ul className="sis-lista">
              {detalhe.app.processos.map((p, i) => <li key={`${p.nome}-${i}`}><span>{p.nome}</span><span>{p.cpu}% · {textoMb(p.mem_mb)}</span></li>)}
            </ul>
          </section>
          <section aria-label="Agentes">
            <h3 className="sis-titulo">Agentes (CLIs de IA) <span>{detalhe.agentes.cpu}% · {textoMb(detalhe.agentes.mem_mb)}</span></h3>
            {detalhe.agentes.sessoes.length === 0 ? <p className="sis-vazio">nenhuma sessão de terminal ativa</p> : (
              <ul className="sis-lista">
                {detalhe.agentes.sessoes.map((s, i) => <li key={`${s.rotulo}-${i}`}><span>{s.rotulo}<small> · {s.processos} proc.</small></span><span>{s.cpu}% · {textoMb(s.mem_mb)}</span></li>)}
              </ul>
            )}
          </section>
          <div className="sis-tops">
            <section aria-label="Top 5 por CPU"><h3 className="sis-titulo">Top 5 · CPU</h3><LinhasProcesso lista={detalhe.top_cpu} valor={(p) => `${p.cpu}%`} /></section>
            <section aria-label="Top 5 por memória"><h3 className="sis-titulo">Top 5 · memória</h3><LinhasProcesso lista={detalhe.top_mem} valor={(p) => textoMb(p.mem_mb)} /></section>
          </div>
        </>
      ) : null}
      <p className="sis-nota">Medido a cada 2 s, só com este painel aberto. Só nomes de executáveis; nada de argumentos ou caminhos.</p>
    </div>
  );
}
