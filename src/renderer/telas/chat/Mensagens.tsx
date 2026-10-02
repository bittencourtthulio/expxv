// Lista de mensagens VIRTUALIZADA de altura variável: só as visíveis (mais 3 de margem) existem no DOM (1000 mensagens a 60 fps).
// Texto sempre como texto (nunca HTML); `[n]` vira botão só quando a citação existe. Streaming vai por um região `status` educada à parte,
// para o leitor de tela não ler token a token.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CitacaoChat, EventoChatProgresso, MensagemChatDto, PlanoChatDto } from "../../../compartilhado/chat";
import type { PedidoDecidirPlano } from "../../../compartilhado/chat";
import { PlanoCard } from "./PlanoCard";
import { alturaEstimada, calcularJanela, linhaDeCitacao, partirCitacoes } from "./logica";

export interface PropsMensagens {
  mensagens: readonly MensagemChatDto[];
  planos: readonly PlanoChatDto[];
  progresso: Readonly<Record<string, readonly EventoChatProgresso[]>>;
  transmitindoId: string | null;
  aoDecidir: (p: PedidoDecidirPlano) => Promise<boolean>;
  aoPararPlano: (id: string) => void;
  aoTrechos: (c: CitacaoChat) => Promise<string[] | null>;
  aoAbrirFonte: () => void;
  aoAbrirTela: (t: "terminais" | "missoes") => void;
  clisDisponiveis: readonly string[];
  alturaPadrao?: number;
}

const NOME: Record<string, string> = { usuario: "Você", assistente: "Assistente", sistema: "Sistema", progresso: "Progresso" };

function Corpo({ m, aberta, aoCitar }: { m: MensagemChatDto; aberta: ReadonlySet<number>; aoCitar: (n: number) => void }): ReactNode {
  const seg = partirCitacoes(m.texto, m.citacoes);
  return (
    <p className={`chat-texto${m.estado === "transmitindo" ? " chat-cursor" : ""}`}>
      {seg.map((s, i) => s.tipo === "texto"
        ? <span key={i}>{s.valor}</span>
        : <button key={i} type="button" className="chat-cit" aria-expanded={aberta.has(s.n)} aria-label={`Fonte ${s.n}: ${m.citacoes.find((c) => c.n === s.n)?.titulo ?? ""}`} onClick={() => aoCitar(s.n)}>[{s.n}]</button>)}
    </p>
  );
}

export function Mensagens({ mensagens, planos, progresso, transmitindoId, aoDecidir, aoPararPlano, aoTrechos, aoAbrirFonte, aoAbrirTela, clisDisponiveis, alturaPadrao = 480 }: PropsMensagens) {
  const rolagem = useRef<HTMLDivElement>(null);
  const [topo, setTopo] = useState(0);
  const [altura, setAltura] = useState(alturaPadrao);
  const [largura, setLargura] = useState(720);
  const medidas = useRef(new Map<string, number>());
  const [versao, setVersao] = useState(0);
  const colado = useRef(true);
  const quadro = useRef(0);
  const [abertas, setAbertas] = useState<Record<string, Set<number>>>({});
  const [trechos, setTrechos] = useState<Record<string, string[] | "carregando" | "erro">>({});
  const linhas = useRef(new Map<string, HTMLDivElement>());

  const medirJanela = useCallback(() => {
    const el = rolagem.current;
    if (el === null) return;
    if (el.clientHeight > 0) setAltura(el.clientHeight);
    if (el.clientWidth > 0) setLargura(el.clientWidth);
  }, []);
  useEffect(() => {
    medirJanela();
    const el = rolagem.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medirJanela);
    obs.observe(el);
    return () => obs.disconnect();
  }, [medirJanela]);
  useEffect(() => () => cancelAnimationFrame(quadro.current), []);

  const colunas = Math.floor(largura / 7.2);
  const alturas = useMemo(() => mensagens.map((m) => medidas.current.get(m.id) ?? alturaEstimada(m, colunas)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mensagens, colunas, versao]);
  const j = calcularJanela(alturas, topo, altura, 3);

  // mede as linhas desenhadas e corrige a estimativa (converge em poucos quadros)
  useLayoutEffect(() => {
    let mudou = false;
    for (let i = j.primeiro; i < j.ultimo; i++) {
      const m = mensagens[i];
      if (m === undefined) continue;
      const h = linhas.current.get(m.id)?.offsetHeight ?? 0;
      if (h > 0 && Math.abs((medidas.current.get(m.id) ?? 0) - h) > 1) { medidas.current.set(m.id, h); mudou = true; }
    }
    if (mudou) setVersao((v) => v + 1);
  });

  // cola no fim enquanto o usuário não rolou para cima
  useLayoutEffect(() => {
    const el = rolagem.current;
    if (el !== null && colado.current) { el.scrollTop = el.scrollHeight; if (topo !== el.scrollTop) setTopo(el.scrollTop); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensagens, versao, altura]);

  const aoRolar = (): void => {
    if (quadro.current !== 0) return;
    quadro.current = requestAnimationFrame(() => {
      quadro.current = 0;
      const el = rolagem.current;
      if (el === null) return;
      colado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      setTopo(el.scrollTop);
    });
  };

  const citar = (m: MensagemChatDto, n: number): void => {
    setAbertas((a) => { const s = new Set(a[m.id] ?? []); if (s.has(n)) s.delete(n); else s.add(n); return { ...a, [m.id]: s }; });
    const c = m.citacoes.find((x) => x.n === n);
    const chave = `${m.id}:${n}`;
    if (c !== undefined && trechos[chave] === undefined) {
      setTrechos((t) => ({ ...t, [chave]: "carregando" }));
      void aoTrechos(c).then((r) => setTrechos((t) => ({ ...t, [chave]: r ?? "erro" })));
    }
  };

  const anunciar = useMemo(() => {
    const ultima = mensagens[mensagens.length - 1];
    if (ultima === undefined || ultima.papel !== "assistente") return "";
    return transmitindoId === ultima.id || ultima.estado === "transmitindo" ? "Assistente respondendo…" : `Assistente respondeu: ${ultima.texto.slice(0, 240)}`;
  }, [mensagens, transmitindoId]);

  const visiveis: ReactNode[] = [];
  let y = j.deslocamento;
  for (let i = j.primeiro; i < j.ultimo; i++) {
    const m = mensagens[i] as MensagemChatDto;
    const abertasM = abertas[m.id] ?? new Set<number>();
    const plano = m.plano_id !== null ? planos.find((p) => p.id === m.plano_id) : undefined;
    visiveis.push(
      <div key={m.id} ref={(el) => { if (el !== null) linhas.current.set(m.id, el); else linhas.current.delete(m.id); }} role="listitem" className="chat-msg" data-papel={m.papel} data-estado={m.estado} style={{ top: y }} aria-posinset={i + 1} aria-setsize={mensagens.length}>
        <div className="chat-msg-in">
          <div className="quem">{NOME[m.papel] ?? m.papel}{m.estado === "erro" ? " · erro" : m.estado === "cancelada" ? " · interrompida" : ""}</div>
          <Corpo m={m} aberta={abertasM} aoCitar={(n) => citar(m, n)} />
          {m.citacoes.length > 0 ? (
            <ul className="chat-fontes" aria-label="Fontes citadas">
              {m.citacoes.map((c) => {
                const t = trechos[`${m.id}:${c.n}`];
                return (
                  <li key={c.n}>
                    <span>{linhaDeCitacao(c)}</span>
                    {abertasM.has(c.n) ? (
                      <div className="chat-fonte-aberta" role="region" aria-label={`Fonte ${c.n}`}>
                        {t === "carregando" ? "Carregando trecho…" : Array.isArray(t) ? (t.length === 0 ? "Sem trecho disponível." : t.map((x, k) => <div key={k}>{x}</div>)) : t === "erro" ? "Não foi possível ler o trecho." : null}
                        <div><button type="button" className="chat-mini" onClick={aoAbrirFonte}>Abrir em Conhecimento</button></div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {plano !== undefined ? <PlanoCard plano={plano} progresso={progresso[plano.id] ?? []} aoDecidir={aoDecidir} aoParar={aoPararPlano} aoAbrirTela={aoAbrirTela} clisDisponiveis={clisDisponiveis} /> : null}
        </div>
      </div>,
    );
    y += alturas[i] as number;
  }

  return (
    <>
      <div ref={rolagem} className="chat-mensagens" role="list" aria-label="Mensagens da conversa" aria-live="off" aria-busy={transmitindoId !== null} tabIndex={0} onScroll={aoRolar} data-total={mensagens.length}>
        <div className="chat-janela" style={{ height: j.alturaTotal }}>{visiveis}</div>
      </div>
      <div className="chat-sr" role="status" aria-live="polite">{anunciar}</div>
    </>
  );
}
