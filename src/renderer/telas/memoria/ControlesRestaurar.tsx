import { useEffect, useRef, useState } from "react";
import type { PreviaBrief } from "../../../compartilhado/memoria";
import { Dialogo } from "../../componentes/Dialogo";
import { avisar } from "../../estado/avisos";
import { storeMemoria, type StoreMemoria } from "../../estado/memoria";
import { useBriefDoPane } from "../../estado/memoria-eventos";
import { textoRestauracao } from "./logica";
import "./memoria.css";

type ModoRestaurar = "auto" | "retomar" | "brief";

/** Prévia somente leitura do que o restore injeta (`memoria:brief_previa`). O markdown é mostrado COMO TEXTO. */
export function DialogoPreviaBrief({ paneId, store = storeMemoria, aoFechar }: { paneId: string; store?: StoreMemoria; aoFechar: () => void }) {
  const [previa, setPrevia] = useState<PreviaBrief | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    void store.previa(paneId, true).then((p) => { if (vivo) setPrevia(p); });
    return () => { vivo = false; };
  }, [paneId, store]);
  return (
    <Dialogo titulo="Prévia do brief" aoFechar={aoFechar} largura={640}>
      <div className="dialogo-corpo">
        {previa === undefined ? <p role="status" aria-busy="true">Montando…</p> : previa === null ? <p role="alert" className="mem-erro">Não foi possível montar a prévia.</p> : (
          <>
            <p className="mem-nota">Modo: {previa.modo} · {previa.caracteres} caracteres{previa.truncado ? " · resumido para caber no orçamento" : ""}. É exatamente o que será entregue ao agente, como dado histórico (nunca como instrução).</p>
            {previa.markdown === "" ? <p className="mem-vazio">Sem brief: a memória está desligada ou ainda não há nada gravado para este painel.</p> : <pre className="mem-previa" aria-label="Texto do brief">{previa.markdown}</pre>}
          </>
        )}
      </div>
      <div className="dialogo-acoes"><button type="button" className="botao" data-foco-inicial onClick={aoFechar}>Fechar</button></div>
    </Dialogo>
  );
}

/**
 * Restaurar um Pane encerrado: botão (desabilitado enquanto roda; duplo clique = 1 Pane, o serviço garante o resto), modo de restauração
 * ("automático", "com brief", "retomar conversa") e a prévia do brief. Cabe no cabeçalho de 18 px (D-32).
 */
export function ControlesRestaurar({ paneId, rotulo, store = storeMemoria, aoRestaurado }: { paneId: string; rotulo: string; store?: StoreMemoria; aoRestaurado?: (pane: string) => void }) {
  const [modo, setModo] = useState<ModoRestaurar>("auto");
  const [ocupado, setOcupado] = useState(false);
  const [previa, setPrevia] = useState(false);
  const emCurso = useRef(false);

  const restaurar = async (): Promise<void> => {
    if (emCurso.current) return; // guarda síncrona: o state só reflete no próximo quadro
    emCurso.current = true;
    setOcupado(true);
    try {
      const r = await store.restaurar(paneId, modo);
      if (r !== null) { avisar(textoRestauracao(r), "sucesso"); aoRestaurado?.(r.pane_id); }
    } finally { emCurso.current = false; setOcupado(false); }
  };

  return (
    <span className="mem-pane-restaurar">
      <button type="button" aria-label={`Restaurar ${rotulo} com a memória`} title="Reabrir este painel sabendo onde parou" disabled={ocupado} aria-busy={ocupado} onClick={() => void restaurar()}>{ocupado ? "Restaurando…" : "Restaurar"}</button>
      <select aria-label={`Modo de restauração de ${rotulo}`} title="Como restaurar" value={modo} onChange={(e) => setModo(e.target.value as ModoRestaurar)} disabled={ocupado}>
        <option value="auto">Automático</option>
        <option value="brief">Com brief</option>
        <option value="retomar">Retomar conversa</option>
      </select>
      <button type="button" aria-label={`Prévia do brief de ${rotulo}`} title="Ver o que será injetado" onClick={() => setPrevia(true)}>Prévia</button>
      {previa ? <DialogoPreviaBrief paneId={paneId} store={store} aoFechar={() => setPrevia(false)} /> : null}
    </span>
  );
}

/** Indicador discreto "brief carregado" no cabeçalho do Pane (ícone de 10 px + `title` com tamanho e truncamento); abre a prévia. */
export function IndicadorBrief({ paneId, respawnDe, store = storeMemoria }: { paneId: string; respawnDe?: string | null; store?: StoreMemoria }) {
  const proprio = useBriefDoPane(paneId);
  const deOrigem = useBriefDoPane(respawnDe ?? undefined);
  const [aberto, setAberto] = useState(false);
  const b = proprio ?? deOrigem;
  if (b === undefined) return null;
  const texto = `Brief de memória carregado: ${b.caracteres} caracteres${b.truncado ? " (resumido)" : ""}`;
  return (
    <>
      <button type="button" className="mem-brief-ind" aria-label={texto} title={texto} {...(b.truncado ? { "data-truncado": "" } : {})} onClick={() => setAberto(true)}><span aria-hidden="true">◉</span> brief</button>
      {aberto ? <DialogoPreviaBrief paneId={paneId} store={store} aoFechar={() => setAberto(false)} /> : null}
    </>
  );
}
