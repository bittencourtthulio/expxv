import { useCallback, useEffect, useState } from "react";
import type { EnvioDivulgacao, EstadoCanalDivulgacao } from "../../../compartilhado/relatorios";
import { avisar } from "../../estado/avisos";
import type { PropsPainel } from "./Detalhe";
import { Carregando, FaixaErro } from "./comum";
import { contador, podeEnviar, textoDoErro, variantesDeRedes } from "./logica";

const ROTULO_VARIANTE = { curta: "Curta", media: "Média", longa: "Longa" } as const;
const ROTULO_ENVIO: Record<EnvioDivulgacao["estado"], string> = { rascunho: "rascunho", aprovado: "aprovado", enviado: "enviado", falhou: "falhou", cancelado: "cancelado" };

/**
 * Aba Divulgação: variantes de texto com contador, COPIAR (sempre disponível) e fila de envio por canal. Nada é publicado sozinho: enviar exige relatório aprovado, item aprovado,
 * canal disponível e o seu consentimento para o canal. Sem canal configurado (Fase 20), a divulgação serve para copiar e colar.
 */
export function Divulgacao({ api, ws, pacote, recarregar }: Omit<PropsPainel, "aoSelecionar">) {
  const [variantes, setVariantes] = useState<ReturnType<typeof variantesDeRedes> | null>(null);
  const [canais, setCanais] = useState<EstadoCanalDivulgacao[]>([]);
  const [fila, setFila] = useState<EnvioDivulgacao[]>([]);
  const [erro, setErro] = useState<unknown>(null);
  const falha = (e: unknown): void => { avisar(textoDoErro(e), "erro"); };
  const aprovado = pacote.revisao_usuario === "aprovado";

  const carregar = useCallback(() => {
    if (pacote.estado !== "pronto") return;
    void Promise.all([api.previa(ws, pacote.id, "divulgacao/resumo-redes.txt"), api.divulgacaoEstado(ws), api.divulgacaoFila(ws, pacote.id)]).then(
      ([p, c, f]) => { setVariantes(variantesDeRedes(p.conteudo)); setCanais(c); setFila(f); setErro(null); }, (e: unknown) => setErro(e));
  }, [api, ws, pacote.id, pacote.estado]);
  useEffect(() => { setVariantes(null); carregar(); }, [carregar, pacote.aprovado_em]);

  const copiar = (texto: string): void => {
    const cb = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard;
    if (cb === undefined) { avisar("A área de transferência não está disponível aqui.", "aviso"); return; }
    void cb.writeText(texto).then(() => avisar("Texto copiado.", "sucesso"), falha);
  };
  const aposAcao = (): void => { carregar(); recarregar(); };

  if (pacote.estado !== "pronto") return <p className="rl-vazio">A divulgação fica disponível quando o pacote estiver pronto.</p>;
  if (erro !== null) return <FaixaErro erro={erro} aoTentar={carregar} />;
  if (variantes === null) return <Carregando />;

  return (
    <div className="rl-divulgacao">
      <p className="rl-faixa" data-tom="info" role="note">Nada é publicado automaticamente. Todo texto é rascunho até você aprovar; o envio por canal só acontece com o seu consentimento.</p>
      <section aria-labelledby="rl-canais-t">
        <h4 id="rl-canais-t">Canais</h4>
        {canais.map((c) => (
          <div key={c.canal} className="rl-canal">
            <label className="rl-check">
              <input type="checkbox" checked={c.consentido} onChange={(e) => void api.consentimentoCanal(ws, c.canal, e.target.checked).then((r) => { setCanais(r); }, falha)} />
              Consinto em enviar por {c.canal === "telegram" ? "Telegram" : c.canal}
            </label>
            <span className="rl-meta">{c.disponivel ? (c.consentido ? "pronto para enviar itens aprovados" : "falta o seu consentimento") : "canal ainda não configurado neste app"}</span>
          </div>
        ))}
      </section>
      {variantes.length === 0 && <p className="rl-vazio">Nenhum texto de divulgação neste pacote.</p>}
      {variantes.map((v) => {
        const c = contador(v.texto, v.limite);
        const canal = canais[0];
        return (
          <section key={v.variante} className="rl-variante" aria-label={`Variante ${ROTULO_VARIANTE[v.variante]}`}>
            <header><h4>{ROTULO_VARIANTE[v.variante]}</h4><span className="rl-meta" data-estoura={c.estoura || undefined}>{c.rotulo} caracteres</span></header>
            <pre className="rl-previa-texto">{v.texto}</pre>
            <div className="rl-acoes">
              <button type="button" className="rl-btn" onClick={() => copiar(v.texto)}>Copiar</button>
              <button type="button" className="rl-btn" disabled={canal === undefined} onClick={() => canal && void api.divulgacaoEnfileirar(ws, pacote.id, canal.canal, v.variante).then(() => { avisar("Item criado como rascunho na fila.", "sucesso"); aposAcao(); }, falha)}>Colocar na fila do Telegram</button>
            </div>
          </section>
        );
      })}
      <section aria-labelledby="rl-fila-t">
        <h4 id="rl-fila-t">Fila de envio</h4>
        {fila.length === 0 && <p className="rl-vazio" role="status">A fila está vazia. Coloque uma variante na fila para aprová-la e enviá-la.</p>}
        <ul className="rl-fila">
          {fila.map((e) => {
            const r = podeEnviar(e, canais.find((c) => c.canal === e.canal), aprovado);
            const ativo = e.estado === "rascunho" || e.estado === "aprovado" || e.estado === "falhou";
            return (
              <li key={e.id} data-estado={e.estado}>
                <div className="rl-linha"><strong>{ROTULO_VARIANTE[e.variante]}</strong><span className="rl-selo" data-estado={e.estado}>{ROTULO_ENVIO[e.estado]}</span>{e.erro !== null && <span className="rl-meta">{e.erro}</span>}</div>
                <pre className="rl-previa-texto">{e.texto}</pre>
                <div className="rl-acoes">
                  {(e.estado === "rascunho" || e.estado === "aprovado") && <button type="button" className="rl-btn" disabled={e.estado === "rascunho" && !aprovado} title={e.estado === "rascunho" && !aprovado ? "Aprove primeiro o relatório do cliente" : undefined} onClick={() => void api.divulgacaoAprovar(ws, e.id, e.estado === "rascunho").then(aposAcao, falha)}>{e.estado === "rascunho" ? "Aprovar item" : "Desaprovar item"}</button>}
                  <button type="button" className="rl-btn" data-primario disabled={!r.pode} title={r.motivo ?? "Enviar agora"} onClick={() => void api.divulgacaoEnviar(ws, e.id).then((x) => { avisar(x.estado === "enviado" ? "Enviado." : `Não foi possível enviar: ${x.erro ?? "falha"}`, x.estado === "enviado" ? "sucesso" : "erro"); aposAcao(); }, falha)}>Enviar</button>
                  {ativo && <button type="button" className="rl-btn" onClick={() => void api.divulgacaoCancelar(ws, e.id).then(aposAcao, falha)}>Cancelar</button>}
                </div>
                {!r.pode && ativo && <p className="rl-meta">{e.estado === "rascunho" && !aprovado ? "Aprove primeiro o relatório do cliente." : r.motivo}</p>}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
