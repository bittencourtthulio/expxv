import { useCallback, useEffect, useState } from "react";
import type { ApiAlertas, AuditoriaTelegramVisao } from "../../../compartilhado/alertas";
import { EstadoVazio } from "../../componentes/EstadoVazio";

export function Auditoria({ api }: { api: ApiAlertas }) {
  const [itens, setItens] = useState<AuditoriaTelegramVisao[]>([]);
  const [proximo, setProximo] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async (depois: string | null): Promise<void> => {
    setCarregando(true);
    try {
      const p = await api.telegram.auditoriaListar(depois, 50);
      setItens((a) => (depois === null ? p.itens : [...a, ...p.itens]));
      setProximo(p.proximo);
      setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível ler a auditoria."); } finally { setCarregando(false); }
  }, [api]);
  useEffect(() => { void carregar(null); }, [carregar]);

  const exportar = async (): Promise<void> => {
    try { const r = await api.telegram.auditoriaExportar(); setAviso(r.ok ? "Arquivo CSV salvo." : r.cancelado === true ? "Exportação cancelada." : "Não foi possível exportar."); }
    catch { setAviso("Não foi possível exportar."); }
  };
  return (
    <div className="alertas-auditoria">
      <div className="alertas-bloco-cab">
        <h2>Pedidos remotos, pareamentos e bloqueios</h2>
        <button type="button" className="botao alertas-mini" onClick={() => void exportar()}>Exportar CSV</button>
      </div>
      {aviso !== null ? <p role="status" className="alertas-aviso">{aviso}</p> : null}
      {erro !== null ? <div role="alert" className="alertas-erro">{erro} <button type="button" className="botao alertas-mini" onClick={() => void carregar(null)}>Tentar de novo</button></div> : null}
      {carregando && itens.length === 0 ? <p className="alertas-nota" role="status" aria-busy="true">Lendo auditoria…</p>
        : itens.length === 0 && erro === null ? <EstadoVazio icone="alerta" titulo="Sem registros" texto="Pareamentos, pedidos recebidos pelo Telegram, aprovações e bloqueios aparecem aqui, sem texto integral e sem segredo." />
        : (
          <table className="alertas-tabela">
            <caption className="sr-only">Auditoria do Telegram</caption>
            <thead><tr><th>Quando</th><th>Evento</th><th>Usuário</th><th>Workspace</th><th>Plano</th><th>Resultado</th></tr></thead>
            <tbody>
              {itens.map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.ts).toLocaleString("pt-BR")}</td><td>{a.evento}</td><td>{a.user_id ?? "—"}</td><td>{a.workspace_id ?? "—"}</td><td>{a.plano_id ?? "—"}</td><td>{a.resultado ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      {proximo !== null ? <div className="alertas-mais"><button type="button" className="botao alertas-mini" disabled={carregando} onClick={() => void carregar(proximo)}>Carregar mais</button></div> : null}
    </div>
  );
}
