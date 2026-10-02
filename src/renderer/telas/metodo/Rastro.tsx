import { useEffect, useMemo, useState } from "react";
import type { EventoRastro } from "../../../nucleo/metodo/tipos";
import { ade } from "../../ade";
import { VirtualLista } from "../../componentes/VirtualLista";

const TETO_EVENTOS = 50_000;
const hora = (ts: string) => (ts.length >= 19 ? ts.slice(11, 19) : ts);

export function Rastro({ workspaceId, trabalhoId }: { workspaceId: string; trabalhoId: string }) {
  const [eventos, setEventos] = useState<EventoRastro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [agente, setAgente] = useState("");
  const [evento, setEvento] = useState("");

  useEffect(() => {
    let vivo = true;
    setEventos([]);
    setCarregando(true);
    setErro(null);
    (async () => {
      const api = ade();
      if (!api) { setCarregando(false); return; }
      let depois = 0;
      let acumulado: EventoRastro[] = [];
      try {
        while (vivo && acumulado.length < TETO_EVENTOS) {
          const pag = await api.metodo.rastro(workspaceId, trabalhoId, depois);
          if (!vivo) return;
          if (pag.eventos.length === 0 || pag.proximo <= depois) break;
          acumulado = acumulado.concat(pag.eventos);
          depois = pag.proximo;
          setEventos(acumulado);
        }
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : "Falha ao ler o rastro.");
      }
      if (vivo) setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [workspaceId, trabalhoId]);

  const agentes = useMemo(() => [...new Set(eventos.map((e) => e.agente).filter((a): a is string => !!a))].sort(), [eventos]);
  const tipos = useMemo(() => [...new Set(eventos.map((e) => e.evento))].sort(), [eventos]);
  const filtrados = useMemo(() => eventos.filter((e) => (!agente || e.agente === agente) && (!evento || e.evento === evento)), [eventos, agente, evento]);

  return (
    <div className="met-rastro">
      <div className="met-filtros">
        <label>Agente
          <select value={agente} onChange={(e) => setAgente(e.target.value)}>
            <option value="">Todos</option>
            {agentes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>Evento
          <select value={evento} onChange={(e) => setEvento(e.target.value)}>
            <option value="">Todos</option>
            {tipos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <span className="met-suave" role="status">{carregando ? "Lendo o rastro…" : `${filtrados.length} de ${eventos.length} eventos`}</span>
      </div>
      {erro ? <p className="met-erro" role="alert">{erro}</p> : null}
      {!carregando && eventos.length === 0 && !erro ? <p className="met-suave">Sem eventos no rastro deste trabalho.</p> : (
        <VirtualLista
          itens={filtrados} alturaItem={36} alturaPadrao={420} rotulo="Eventos do rastro" chave={(e, i) => `${e.ts}-${i}`}
          renderItem={(e) => (
            <div className="met-evento" data-resultado={e.resultado}>
              <time>{hora(e.ts)}</time>
              <b>{e.evento}</b>
              <span>{e.agente ?? "—"}</span>
              <span>{e.task ?? e.fase ?? ""}</span>
              <span className="met-evento-res">{e.resultado}</span>
              <span className="met-evento-det">{e.detalhe}</span>
            </div>
          )}
        />
      )}
    </div>
  );
}
