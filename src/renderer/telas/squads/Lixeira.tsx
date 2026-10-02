// Lixeira de squads (Fase 14, onda 6): apagar nunca remove de verdade; aqui o usuário vê o que foi apagado e restaura. Slug que já
// existe de novo é recusado pelo main (nada é sobrescrito) e o motivo aparece aqui.
import { useCallback, useEffect, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { ItemLixeiraSquad, Squad } from "../../../compartilhado/squads";
import { Dialogo } from "../../componentes/Dialogo";

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const quando = (iso: string | null): string => (iso === null ? "data desconhecida" : new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }));

export function DialogoLixeira({ api, aoFechar, aoRestaurada }: { api: ApiAde["squads"] | undefined; aoFechar: () => void; aoRestaurada: (s: Squad) => void }) {
  const [itens, setItens] = useState<ItemLixeiraSquad[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async (): Promise<void> => {
    if (api === undefined) { setItens([]); return; }
    try { setItens(await api.listarLixeira()); setErro(null); }
    catch (e) { setErro(`Não foi possível ler a lixeira: ${msg(e)}`); setItens([]); }
  }, [api]);
  useEffect(() => { void carregar(); }, [carregar]);

  const restaurar = async (nome: string): Promise<void> => {
    if (api === undefined) return;
    setOcupado(nome);
    setErro(null);
    try { aoRestaurada(await api.restaurarDaLixeira(nome)); }
    catch (e) { await carregar(); setErro(`Não foi possível restaurar: ${msg(e)}`); setOcupado(null); }
  };

  return (
    <Dialogo titulo="Lixeira de squads" aoFechar={aoFechar} largura={480}>
      <div className="dialogo-corpo">
        {itens === null ? <div aria-busy="true" /> : null}
        {itens !== null && itens.length === 0 ? <p className="sq-vazio" role="status">A lixeira está vazia. Squads apagadas ficam aqui até você restaurá-las.</p> : null}
        {itens !== null && itens.length > 0 ? (
          <ul className="sq-fab-lista" aria-label="Squads apagadas">
            {itens.map((i) => (
              <li key={i.nome}>
                <code>{i.slug}</code>
                <span className="sq-vazio">apagada em {quando(i.apagada_em)}</span>
                <button type="button" className="botao sq-btn sq-direita" disabled={ocupado !== null} aria-label={`Restaurar ${i.slug}`} onClick={() => void restaurar(i.nome)}>Restaurar</button>
              </li>
            ))}
          </ul>
        ) : null}
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      </div>
      <div className="dialogo-acoes"><button type="button" className="botao botao-primario" onClick={aoFechar}>Fechar</button></div>
    </Dialogo>
  );
}
