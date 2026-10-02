import { useEffect, useRef, useState } from "react";
import type { AlvoDisponivel, ApiBench, Estimativa } from "../../../compartilhado/bench";
import { Dialogo } from "../../componentes/Dialogo";
import { ROTULO_ACAO, textoCustoEstimado, textoSandbox, duracaoTexto } from "./logica";

export type Finalidade = "rodar" | "rerodar" | "julgar";
export interface PedidoEstimativa { tarefas: string[]; alvos: string[]; max_paralelo: number; teto_usd: number | null; juiz_alvo: string | null }

/**
 * Diálogo de consentimento (próprio, nunca `window.confirm`). Mostra o que vai rodar, a estimativa de custo ("custo desconhecido" nunca vira 0), o modo de sandbox e o aviso em destaque;
 * o botão só habilita com a frase EXATA. Sandbox indisponível mostra o motivo e NÃO oferece "rodar mesmo assim". Fechar descarta o token. Reaparece a cada Run, re-run e julgamento.
 */
export function DialogoConsentimento({ api, finalidade, pedido, juizes, aoToken, aoFechar }: {
  api: ApiBench;
  finalidade: Finalidade;
  pedido: PedidoEstimativa;
  /** só em `julgar`: alvos que podem ser o juiz. */
  juizes?: readonly AlvoDisponivel[];
  aoToken: (e: Estimativa, token: string, juiz: string | null) => Promise<string | null>;
  aoFechar: () => void;
}) {
  const [juiz, setJuiz] = useState<string | null>(pedido.juiz_alvo);
  const [est, setEst] = useState<Estimativa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [frase, setFrase] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const atual = useRef<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setEst(null); setErro(null); setFrase("");
    void api.estimar({ ...pedido, juiz_alvo: finalidade === "julgar" ? juiz : pedido.juiz_alvo }).then((e) => {
      if (!vivo) { void api.descartarConsentimento(e.estimativa_id); return; }
      if (atual.current !== null) void api.descartarConsentimento(atual.current);
      atual.current = e.estimativa_id;
      setEst(e);
    }, (x: unknown) => { if (vivo) setErro(x instanceof Error ? x.message : "Não consegui estimar."); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [juiz]);

  const fechar = (): void => {
    if (atual.current !== null) void api.descartarConsentimento(atual.current); // fechar descarta o token
    atual.current = null;
    aoFechar();
  };
  const exigida = est?.frase_exigida ?? null;
  const pode = est !== null && exigida !== null && frase === exigida && !ocupado && (finalidade !== "julgar" || juiz !== null);

  const confirmar = async (): Promise<void> => {
    if (est === null || exigida === null) return;
    setOcupado(true); setErro(null);
    try {
      const c = await api.consentir(est.estimativa_id, frase, finalidade);
      if ("erro" in c) { setErro(c.erro === "confirmacao_invalida" ? "A frase não confere." : "Esta estimativa expirou: feche e abra de novo."); return; }
      const e = await aoToken(est, c.token, finalidade === "julgar" ? juiz : null);
      if (e !== null) { setErro(e); return; }
      atual.current = null; // o token foi consumido
      aoFechar();
    } catch (x) {
      setErro(x instanceof Error ? x.message : "Falha ao iniciar.");
    } finally { setOcupado(false); }
  };

  return (
    <Dialogo titulo={`${ROTULO_ACAO[finalidade]}: confirmação`} aoFechar={fechar} largura={560}>
      <div className="dialogo-corpo bn-consent">
        {finalidade === "julgar" && juizes !== undefined && (
          <label className="bn-campo">Juiz (outro modelo, nunca um dos executores)
            <select value={juiz ?? ""} onChange={(e) => setJuiz(e.target.value === "" ? null : e.target.value)} data-foco-inicial>
              <option value="">Escolha o juiz…</option>
              {juizes.map((a) => <option key={a.slug} value={a.slug} disabled={!a.disponivel}>{a.rotulo}{a.disponivel ? "" : " (indisponível)"}</option>)}
            </select>
          </label>
        )}
        {est === null && erro === null && <p role="status" className="bn-meta">Calculando a estimativa…</p>}
        {est !== null && (
          <>
            <dl className="bn-resumo">
              <dt>Execuções</dt><dd>{est.execucoes} ({est.tarefas.length} tarefa(s) × {est.alvos.length} alvo(s))</dd>
              <dt>Custo estimado</dt><dd>{textoCustoEstimado(est)}</dd>
              <dt>Duração estimada</dt><dd>{est.duracao_estimada_s === null ? "desconhecida" : duracaoTexto(est.duracao_estimada_s)}</dd>
              <dt>Teto por Run</dt><dd>{est.teto_usd === null ? "sem teto" : `US$ ${est.teto_usd}`}</dd>
              <dt>Isolamento</dt><dd data-sandbox={est.sandbox}>{textoSandbox(est.sandbox)}</dd>
            </dl>
            {est.avisos.length > 0 && <ul className="bn-avisos">{est.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
            <p className="bn-destaque"><strong>Isto executa código gerado por IA sem pedir confirmação.</strong> Cada execução roda numa pasta descartável, com ambiente limpo e conta dedicada.</p>
            {exigida === null ? (
              <p role="alert" className="bn-bloqueio">Não é possível rodar agora. Resolva os avisos acima; não há opção de rodar mesmo assim.</p>
            ) : (
              <label className="bn-campo">Digite <strong>{exigida}</strong> para confirmar
                <input value={frase} onChange={(e) => setFrase(e.target.value)} autoComplete="off" spellCheck={false} aria-label={`Digite ${exigida} para confirmar`} data-foco-inicial={finalidade === "julgar" ? undefined : true} />
              </label>
            )}
          </>
        )}
        {erro !== null && <p role="alert" className="bn-erro">{erro}</p>}
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={fechar}>Cancelar</button>
        {exigida !== null && <button type="button" className="botao botao-primario" disabled={!pode} onClick={() => void confirmar()}>{ROTULO_ACAO[finalidade]}</button>}
      </div>
    </Dialogo>
  );
}
