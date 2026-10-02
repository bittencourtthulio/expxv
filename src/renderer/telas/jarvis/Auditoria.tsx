import { useCallback, useEffect, useState } from "react";
import type { ApiJarvis, ApiRemoto, EntradaAuditoriaJarvis } from "../../../compartilhado/jarvis";

type Pagina = { itens: EntradaAuditoriaJarvis[]; proximo: string | null };

/** Auditoria dos dois atores: uma linha por passo, argumentos já REDIGIDOS pelo main (nunca texto de fala, token nem chave). */
export function Auditoria({ jarvis, remoto }: { jarvis: ApiJarvis; remoto: ApiRemoto }) {
  const [fonte, setFonte] = useState<"jarvis" | "remoto">("jarvis");
  const [itens, setItens] = useState<EntradaAuditoriaJarvis[] | null>(null);
  const [proximo, setProximo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const buscar = useCallback((depois: string | null): Promise<Pagina> => (fonte === "jarvis" ? jarvis.historico(depois) : remoto.auditoria(depois)), [fonte, jarvis, remoto]);
  const carregar = useCallback(async () => {
    setItens(null);
    try {
      const p = await buscar(null);
      setItens(p.itens);
      setProximo(p.proximo);
      setErro(null);
    } catch {
      setErro("Não foi possível ler a auditoria.");
    }
  }, [buscar]);
  useEffect(() => void carregar(), [carregar]);
  const mais = async (): Promise<void> => {
    if (proximo === null) return;
    try {
      const p = await buscar(proximo);
      setItens((x) => [...(x ?? []), ...p.itens]);
      setProximo(p.proximo);
    } catch {
      setErro("Não foi possível carregar mais.");
    }
  };
  return (
    <div>
      <div className="jarvis-linha" role="group" aria-label="Fonte da auditoria">
        <button type="button" className="jarvis-botao" aria-pressed={fonte === "jarvis"} onClick={() => setFonte("jarvis")}>Jarvis</button>
        <button type="button" className="jarvis-botao" aria-pressed={fonte === "remoto"} onClick={() => setFonte("remoto")}>Controle remoto</button>
        <span className="jarvis-nota">Guardada por 30 dias, sem texto de fala, token nem chave.</span>
      </div>
      {erro !== null ? <p role="alert" className="jarvis-erro">{erro} <button type="button" className="jarvis-botao" onClick={() => void carregar()}>Tentar de novo</button></p> : null}
      {itens === null && erro === null ? <p className="jarvis-nota" role="status" aria-busy="true">Carregando…</p> : null}
      {itens !== null && itens.length === 0 ? <p className="jarvis-nota" role="status">Nada registrado ainda. As ações aparecem aqui assim que acontecem.</p> : null}
      {itens !== null && itens.length > 0 ? (
        <table className="jarvis-tabela">
          <caption className="jarvis-oculto">Auditoria de {fonte === "jarvis" ? "Jarvis" : "controle remoto"}</caption>
          <thead><tr><th scope="col">Quando</th><th scope="col">Evento</th><th scope="col">Resultado</th><th scope="col">Resumo</th></tr></thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.id}>
                <td>{new Date(i.ts).toLocaleString("pt-BR")}</td>
                <td>{i.evento}{i.acao === null ? "" : ` · ${i.acao}`}</td>
                <td>{i.ok ? "ok" : `recusado${i.codigo === null ? "" : ` (${i.codigo})`}`}</td>
                <td>{i.resumo ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {proximo !== null ? <button type="button" className="jarvis-botao" onClick={() => void mais()}>Carregar mais</button> : null}
    </div>
  );
}
