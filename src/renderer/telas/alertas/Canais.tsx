import { useCallback, useEffect, useState } from "react";
import type { ApiAlertas, CanalVisao } from "../../../compartilhado/alertas";
import { TelegramAssistente } from "./TelegramAssistente";
import type { WorkspaceOpcao } from "./Lista";

function CartaoSo({ api, canal, aoMudar }: { api: ApiAlertas; canal: CanalVisao | undefined; aoMudar: (c: CanalVisao) => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (canal === undefined) return <section className="alertas-cartao" aria-label="Notificação do sistema"><h2>Notificação do sistema</h2><p className="alertas-nota">Canal indisponível nesta janela.</p></section>;
  const ligado = canal.saida_ligada;
  const alternar = async (): Promise<void> => {
    setOcupado(true);
    try { aoMudar(await (ligado ? api.canais.desligarSaida(canal.id) : api.canais.ligarSaida(canal.id))); setMsg(null); } catch { setMsg("Não foi possível alterar o canal."); } finally { setOcupado(false); }
  };
  const testar = async (): Promise<void> => {
    setOcupado(true);
    try { const r = await api.canais.testeEnvio(canal.id); setMsg(r.ok ? `Teste enviado: ${r.detalhe}` : `O teste falhou: ${r.detalhe}`); } catch { setMsg("O teste falhou."); } finally { setOcupado(false); }
  };
  return (
    <section className="alertas-cartao" aria-label="Notificação do sistema">
      <h2>Notificação do sistema</h2>
      <p className="alertas-estado" role="status"><span aria-hidden="true">{ligado ? "✓" : "○"}</span> {ligado ? "Ligada" : "Desligada"} · só metadados (tipo, ID, tempo, pontos), só com a janela sem foco.</p>
      <div className="alertas-linha-botoes">
        <button type="button" className="botao alertas-mini" disabled={ocupado} aria-pressed={ligado} onClick={() => void alternar()}>{ligado ? "Desligar" : "Ligar"}</button>
        <button type="button" className="botao alertas-mini" disabled={ocupado || !ligado} onClick={() => void testar()}>Enviar teste</button>
      </div>
      {msg !== null ? <p role="status" className="alertas-aviso">{msg}</p> : null}
    </section>
  );
}

export function Canais({ api, workspaces }: { api: ApiAlertas; workspaces: readonly WorkspaceOpcao[] }) {
  const [canais, setCanais] = useState<CanalVisao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(async (): Promise<void> => {
    try { setCanais(await api.canais.listar()); setErro(null); } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível ler os canais."); }
  }, [api]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => api.assinarCanal((c) => setCanais((a) => (a === null ? a : [...a.filter((x) => x.id !== c.id), c]))), [api]);
  const trocar = (c: CanalVisao): void => setCanais((a) => (a === null ? [c] : [...a.filter((x) => x.id !== c.id), c]));
  if (erro !== null) return <div role="alert" className="alertas-erro">{erro} <button type="button" className="botao alertas-mini" onClick={() => void carregar()}>Tentar de novo</button></div>;
  if (canais === null) return <p className="alertas-nota" role="status" aria-busy="true">Lendo canais…</p>;
  return (
    <div className="alertas-canais">
      <CartaoSo api={api} canal={canais.find((c) => c.tipo === "so")} aoMudar={trocar} />
      <TelegramAssistente api={api} workspaces={workspaces} />
    </div>
  );
}
