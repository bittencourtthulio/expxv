import { useEffect, useState } from "react";
import { TIPOS_APRENDIZADO, type Aprendizado, type EstadoAprendizado, type TipoAprendizado, type ValorFeedback } from "../../../compartilhado/conhecimento";
import { Badge } from "../../componentes/Badge";
import { Dialogo } from "../../componentes/Dialogo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { VirtualLista } from "../../componentes/VirtualLista";
import type { EstadoStoreConhecimento, StoreConhecimento } from "../../estado/conhecimento";

const ESTADOS: readonly EstadoAprendizado[] = ["candidato", "ativo", "arquivado", "rejeitado"];
const TOM = { ativo: "sucesso", candidato: "aviso", arquivado: "neutro", rejeitado: "alerta" } as const;
const FB: ReadonlyArray<[ValorFeedback, string, string]> = [["util", "👍", "Útil"], ["inutil", "👎", "Inútil"], ["errado", "⚠", "Errado"]];

/** Janela abaixo de 1000 px: a linha quebra em duas (proveniência/feedback/ações caem para baixo) e fica mais alta. */
function useLinhaAlta(): boolean {
  const [alta, setAlta] = useState(() => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 1000px)").matches : false));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(max-width: 1000px)");
    const mudou = (): void => setAlta(mq.matches);
    mudou();
    mq.addEventListener?.("change", mudou);
    return () => mq.removeEventListener?.("change", mudou);
  }, []);
  return alta;
}

export interface PropsAprendizados { store: StoreConhecimento; estado: EstadoStoreConhecimento }

export function Aprendizados({ store, estado }: PropsAprendizados) {
  const a = estado.aprendizados;
  const [editando, setEditando] = useState<Aprendizado | null>(null);
  const [texto, setTexto] = useState("");
  const linhaAlta = useLinhaAlta();
  const filtrando = a.filtros.estado !== null || a.filtros.tipo !== null || a.filtros.busca.trim() !== "";

  return (
    <div className="con-apr">
      <div className="con-barra" role="group" aria-label="Filtros dos aprendizados">
        <select aria-label="Estado do aprendizado" value={a.filtros.estado ?? ""} onChange={(e) => { store.definirFiltrosAprendizados({ estado: e.target.value === "" ? null : (e.target.value as EstadoAprendizado) }); void store.carregarAprendizados(); }}>
          <option value="">Estado: todos</option>{ESTADOS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Tipo do aprendizado" value={a.filtros.tipo ?? ""} onChange={(e) => { store.definirFiltrosAprendizados({ tipo: e.target.value === "" ? null : (e.target.value as TipoAprendizado) }); void store.carregarAprendizados(); }}>
          <option value="">Tipo: todos</option>{TIPOS_APRENDIZADO.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="search" aria-label="Buscar aprendizados" placeholder="Buscar…" value={a.filtros.busca} onChange={(e) => store.definirFiltrosAprendizados({ busca: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") void store.carregarAprendizados(); }} />
        <button type="button" className="con-mini" onClick={() => void store.carregarAprendizados()}>Filtrar</button>
        {estado.aprendizadosNovos > 0 ? <span role="status">{estado.aprendizadosNovos} {estado.aprendizadosNovos === 1 ? "novo" : "novos"} <button type="button" className="con-mini" onClick={() => void store.carregarAprendizados()}>Atualizar</button></span> : null}
      </div>
      {a.erro !== null ? <p className="con-faixa" data-tom="erro" role="alert">{a.erro} <button type="button" onClick={() => void store.carregarAprendizados()}>Tentar de novo</button></p> : null}
      {a.carregando && a.itens.length === 0 ? <p className="con-vazio" role="status" aria-busy="true">Carregando aprendizados…</p> : null}
      {!a.carregando && a.erro === null && a.itens.length === 0 ? (
        <EstadoVazio icone="memoria" titulo={filtrando ? "Nada com esse filtro" : "Nenhum aprendizado ainda"} texto={filtrando ? "Limpe os filtros para ver todos." : "Aprendizados nascem de decisões, causas-raiz e correções registradas. Eles aparecem aqui como candidatos para você ativar."} />
      ) : null}
      {a.itens.length > 0 ? (
        <>
          <div className="con-apr-linha con-apr-cab" aria-hidden="true"><span>Estado</span><span>Tipo</span><span>Título</span><span>Proveniência</span><span>Feedback</span><span>Ações</span></div>
          <VirtualLista itens={a.itens} alturaItem={linhaAlta ? 64 : 40} alturaPadrao={360} rotulo="Aprendizados" chave={(x) => x.id} renderItem={(x) => (
            <div className="con-apr-linha">
              <span><Badge tom={TOM[x.estado]}>{x.estado}</Badge></span>
              <span>{x.tipo}</span>
              <span title={x.texto}>{x.titulo}</span>
              <span title={`confiança ${Math.round(x.confianca * 100)}%`}>{x.fonte} · visto {x.vezes_visto}×</span>
              <span className="con-apr-acoes" role="group" aria-label={`Feedback de ${x.titulo}`}>
                {FB.map(([v, g, t]) => <button key={v} type="button" className="con-icone-btn" aria-label={`${t}: ${x.titulo}`} title={`${t} (${v === "util" ? x.util : v === "inutil" ? x.inutil : x.errado})`} onClick={() => void store.darFeedback("aprendizado", x.id, v)}>{g}</button>)}
              </span>
              <span className="con-apr-acoes" role="group" aria-label={`Ações de ${x.titulo}`}>
                {x.estado !== "ativo" ? <button type="button" className="con-mini" aria-label={`Ativar ${x.titulo}`} onClick={() => void store.atualizarAprendizado(x.id, "ativar")}>Ativar</button> : null}
                {x.estado !== "arquivado" ? <button type="button" className="con-mini" aria-label={`Arquivar ${x.titulo}`} onClick={() => void store.atualizarAprendizado(x.id, "arquivar")}>Arquivar</button> : null}
                {x.estado !== "rejeitado" ? <button type="button" className="con-mini" aria-label={`Rejeitar ${x.titulo}`} onClick={() => void store.atualizarAprendizado(x.id, "rejeitar")}>Rejeitar</button> : null}
                <button type="button" className="con-mini" aria-label={`Editar ${x.titulo}`} onClick={() => { setEditando(x); setTexto(x.texto); }}>Editar</button>
              </span>
            </div>
          )} />
          {a.proximo !== null ? <div className="con-acoes-linha"><button type="button" className="con-mini" disabled={a.carregando} onClick={() => void store.carregarAprendizados(true)}>Carregar mais</button></div> : null}
        </>
      ) : null}
      {editando !== null ? (
        <Dialogo titulo="Editar aprendizado" aoFechar={() => setEditando(null)} largura={560}>
          <div className="dialogo-corpo">
            <p>{editando.titulo}</p>
            <div className="campo"><label htmlFor="con-apr-texto">Texto</label><textarea id="con-apr-texto" data-foco-inicial value={texto} maxLength={4000} onChange={(e) => setTexto(e.target.value)} /></div>
          </div>
          <div className="dialogo-acoes">
            <button type="button" className="botao" onClick={() => setEditando(null)}>Cancelar</button>
            <button type="button" className="botao botao-primario" disabled={texto.trim() === ""} onClick={() => { const id = editando.id; const t = texto; setEditando(null); void store.atualizarAprendizado(id, "editar", t); }}>Salvar</button>
          </div>
        </Dialogo>
      ) : null}
    </div>
  );
}
