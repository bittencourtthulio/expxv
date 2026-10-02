// Popover do Bichinho (clique): nome, espécie, estágio, maturidade com os dois componentes, tokens, itens de conhecimento e as ações do dono.
// Não modal: Escape fecha e devolve o foco; clique fora fecha. Posição fixa ao lado da âncora (o menu corta conteúdo com overflow).
import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { TAMANHO_MAX_APELIDO, type BichinhoVisao } from "../../compartilhado/bichinho";
import { CATALOGO } from "../../nucleo/bichinho/catalogo";
import { faltaParaProximo, OVO } from "../../nucleo/bichinho/crescimento";
import { Figura } from "./Figura";
import { useBichinhos, type StoreBichinho } from "./estado";
import { faltaParaChocar, formatarContagem, nivelDaVisao, posicionarPopover, ROTULO_ESTAGIO, ROTULO_HUMOR, textoEsforco, textoOvo, type Retangulo } from "./util";
import "./seletor.css";

/** A grade de espécies só é baixada e montada quando o dono abre "Trocar bichinho". */
const SeletorEspecie = lazy(() => import("./SeletorEspecie"));

export interface PropsPopover {
  visao: BichinhoVisao;
  nomeProjeto: string | null;
  store: StoreBichinho;
  silenciar: boolean;
  ancora: Retangulo;
  aoFechar: () => void;
}

function Medidor({ rotulo, valor, detalhe, grande = false }: { rotulo: string; valor: number; detalhe?: string; grande?: boolean }): ReactNode {
  return (
    <div className="bi-pop-medidor">
      <div><span>{rotulo}</span><strong>{valor}/100</strong></div>
      <div className="bi-barra" role="progressbar" aria-label={rotulo} aria-valuemin={0} aria-valuemax={100} aria-valuenow={valor} style={grande ? { height: 5 } : undefined}><i style={{ width: `${valor}%` }} /></div>
      {detalhe !== undefined && <small>{detalhe}</small>}
    </div>
  );
}

export function PopoverBichinho({ visao, nomeProjeto, store, silenciar, ancora, aoFechar }: PropsPopover): ReactNode {
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [apelido, setApelido] = useState(visao.apelido ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [seletor, setSeletor] = useState(false);
  const { metaOvo } = useBichinhos(store);
  const pos = posicionarPopover(ancora, { largura: window.innerWidth, altura: window.innerHeight });
  const especie = CATALOGO[visao.especie];
  const falta = faltaParaProximo(visao.maturidade);
  const nome = visao.apelido ?? especie.rotulo;

  useEffect(() => {
    raiz.current?.focus();
    const fora = (e: PointerEvent): void => { if (raiz.current !== null && !raiz.current.contains(e.target as Node) && !(e.target as Element).closest?.("[data-bichinho-ancora]")) aoFechar(); };
    const tecla = (e: KeyboardEvent): void => { if (e.key === "Escape" && raiz.current?.querySelector(".bi-seletor") === null) { e.stopPropagation(); aoFechar(); } };
    document.addEventListener("pointerdown", fora, true);
    document.addEventListener("keydown", tecla, true);
    return () => { document.removeEventListener("pointerdown", fora, true); document.removeEventListener("keydown", tecla, true); };
  }, [aoFechar]);

  const renomear = async (): Promise<void> => {
    const limpo = apelido.trim();
    setErro(await store.renomear(visao.workspace_id, limpo === "" ? null : limpo));
  };

  return (
    <div ref={raiz} className="bi-popover" role="dialog" aria-label={`Bichinho de ${nomeProjeto ?? "projeto"}`} aria-describedby={`${id}-resumo`} tabIndex={-1} style={{ left: pos.left, bottom: pos.bottom }}>
      <div className="bi-pop-topo">
        <span className="bi-pop-figura"><Figura visao={visao} nomeProjeto={nomeProjeto} silenciar={silenciar} rotulado={false} /></span>
        <div className="bi-pop-nome" id={`${id}-resumo`}>
          <strong>{nome}</strong>
          <span>{especie.rotulo} · {ROTULO_ESTAGIO[visao.estagio]}{visao.manual ? " (escolha sua)" : ""}</span>
          <span>{ROTULO_HUMOR[visao.humor]}{visao.doente ? " · cota de consumo alta" : ""}</span>
          <span className="bi-pop-esforco" data-nivel={nivelDaVisao(visao)}>Agora: {textoEsforco(visao)}</span>
        </div>
      </div>
      {visao.ovo === null || visao.ovo === undefined ? (
        <Medidor rotulo="Maturidade" valor={visao.maturidade} grande detalhe={falta === null ? "Estágio máximo." : `Faltam ${falta.faltam} ponto${falta.faltam === 1 ? "" : "s"} para ${ROTULO_ESTAGIO[falta.proximo]}.`} />
      ) : (
        <>
          <Medidor rotulo="Chocando" valor={visao.ovo.progresso} grande detalhe={textoOvo(visao.ovo)} />
          <p className="bi-pop-ovo-dica">O ovo nasce com atividade de verdade: tarefas concluídas e consumo de tokens. {faltaParaChocar(visao.ovo) === null ? "Quase lá." : `Faltam ${faltaParaChocar(visao.ovo)}.`}</p>
          <label>Tarefas para chocar
            <select value={metaOvo} onChange={(e) => void store.definirMetaOvo(Number(e.target.value))}>
              {Array.from({ length: OVO.metaMax - OVO.metaMin + 1 }, (_, i) => OVO.metaMin + i).map((n) => <option key={n} value={n}>{n} tarefas{n === OVO.metaTarefas ? " (padrão)" : ""}</option>)}
            </select>
          </label>
        </>
      )}
      <Medidor rotulo="Tokens" valor={visao.componentes.tokens} detalhe={`${formatarContagem(visao.tokens_total)} tokens acumulados (entrada e saída)`} />
      <Medidor rotulo="Conhecimento" valor={visao.componentes.conhecimento} detalhe={`${formatarContagem(visao.conhecimento_itens.total)} itens: ${formatarContagem(visao.conhecimento_itens.memoria)} de memória${visao.conhecimento_itens.chunks === null ? "" : ` e ${formatarContagem(visao.conhecimento_itens.chunks)} trechos indexados`}`} />
      <p className="bi-pop-motivo">{especie.personalidade} {visao.manual ? `Espécie automática seria ${CATALOGO[visao.especie_automatica].rotulo.toLowerCase()}.` : visao.motivo[0] ?? ""}</p>
      <div className="bi-pop-acoes">
        <button type="button" className="bi-botao" aria-haspopup="dialog" aria-expanded={seletor} onClick={() => setSeletor(true)}>Trocar bichinho{visao.manual ? "" : " (automático)"}</button>
        <label>Renomear
          <span className="bi-pop-linha">
            <input type="text" value={apelido} maxLength={TAMANHO_MAX_APELIDO} placeholder={especie.rotulo} onChange={(e) => setApelido(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void renomear(); }} />
            <button type="button" className="bi-botao" onClick={() => void renomear()}>Renomear</button>
          </span>
        </label>
        {erro !== null && <p role="alert" className="bi-pop-aviso">{erro}</p>}
        <button type="button" className="bi-botao" role="switch" aria-checked={silenciar} onClick={() => void store.definirSilenciar(!silenciar)}>{silenciar ? "Animações silenciadas" : "Silenciar animações"}</button>
        <button type="button" className="bi-botao" onClick={() => { void store.definirMostrar(false); aoFechar(); }}>Ocultar bichinhos</button>
      </div>
      {seletor && <Suspense fallback={null}><SeletorEspecie visao={visao} store={store} silenciar={silenciar} aoFechar={() => setSeletor(false)} /></Suspense>}
    </div>
  );
}
