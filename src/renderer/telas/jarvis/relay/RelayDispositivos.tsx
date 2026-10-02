import { useCallback, useEffect, useState } from "react";
import type { ApiRelay, DispositivoRelay } from "../../../../compartilhado/relay";
import { ItemLista } from "../../../componentes/ItemLista";
import { ROTULO_PERMISSAO } from "../logica";
import { ROTULO_TRANSPORTE, textoDispositivo } from "./relay-logica";

/** Dispositivos pareados do relay: lista de entidades no padrão único (D-694) — nome ≫ permissão · transporte · último
 *  visto, e UMA ação (Revogar, com confirmação inline). Revogado vira selo e a linha perde as ações. */
export function RelayDispositivos({ api, versao, agora = () => Date.now() }: { api: ApiRelay; versao: unknown; agora?: () => number }) {
  const [lista, setLista] = useState<DispositivoRelay[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const ler = useCallback(async () => {
    try {
      setLista(await api.dispositivos());
      setErro(null);
    } catch {
      setErro("Não foi possível listar os dispositivos.");
    }
  }, [api]);
  useEffect(() => {
    void ler();
  }, [ler, versao]);
  const revogar = async (id: string): Promise<void> => {
    setConfirmar(null);
    try {
      await api.revogar(id);
    } catch {
      setErro("Não foi possível revogar.");
    }
    void ler();
  };
  return (
    <section aria-labelledby="relay-disp" className="jarvis-bloco">
      <h2 id="relay-disp">Dispositivos</h2>
      {erro !== null ? (
        <div>
          <p role="alert" className="jarvis-erro">{erro}</p>
          <button type="button" className="jarvis-botao" onClick={() => void ler()}>Tentar de novo</button>
        </div>
      ) : lista === null ? (
        <p className="jarvis-nota" role="status" aria-busy="true">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="jarvis-nota">Nenhum celular pareado. Ligue o relay e use «Parear celular».</p>
      ) : (
        <ul className="jarvis-lista">
          {lista.map((d) => (
            <li key={d.id} data-revogado={d.revogado_em !== null ? "sim" : "nao"}>
              <ItemLista
                densa
                titulo={d.nome}
                descricao={`${ROTULO_PERMISSAO[d.permissao]} · ${ROTULO_TRANSPORTE[d.transporte]} · ${textoDispositivo(d, agora())}`}
                {...(d.revogado_em === null
                  ? { acao: <button type="button" className="botao" aria-label={`Revogar ${d.nome}`} onClick={() => setConfirmar(d.id)}>Revogar</button> }
                  : {})}
              />
              {confirmar === d.id && d.revogado_em === null ? (
                <div className="jarvis-linha jarvis-dispositivo-form">
                  <button type="button" className="jarvis-botao jarvis-botao-perigo" onClick={() => void revogar(d.id)}>Confirmar revogação de {d.nome}</button>
                  <button type="button" className="jarvis-botao" onClick={() => setConfirmar(null)}>Cancelar</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
