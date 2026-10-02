import { useState } from "react";
import { avisar } from "../../estado/avisos";
import type { PropsPainel } from "./Detalhe";
import { textoDoErro } from "./logica";

/**
 * Aba Revisão: o texto do relatório do USUÁRIO, bloco a bloco. A pessoa pode reescrever qualquer bloco (o ajuste vale em TODAS as regenerações) ou voltar ao texto padrão;
 * itens sem texto próprio e problemas de linguagem aparecem em destaque. Salvar não muda o pacote atual: regenerar cria a próxima versão com o ajuste.
 */
export function Revisao({ api, ws, pacote, recarregar, aoSelecionar }: PropsPainel) {
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({});
  const [pendente, setPendente] = useState(false);
  const violacoes = (pacote.verificacao?.violacoes ?? []).filter((v) => v.bloco.startsWith("u_") || v.bloco === "usuario");
  const falha = (e: unknown): void => { avisar(textoDoErro(e), "erro"); };

  if (pacote.estado !== "pronto") return <p className="rl-vazio">A revisão fica disponível quando o pacote estiver pronto.</p>;
  if (pacote.blocos_usuario.length === 0) return <p className="rl-vazio" role="status">Não há texto do cliente para revisar neste pacote.</p>;

  const salvar = (id: string, texto: string | null): void => {
    void api.ajusteGravar(ws, pacote.sprint_id, id, texto).then(() => {
      setPendente(true);
      if (texto === null) setRascunhos((r) => { const { [id]: _x, ...resto } = r; void _x; return resto; });
      avisar(texto === null ? "Voltou ao texto padrão. Gere de novo para aplicar." : "Ajuste salvo. Gere de novo para aplicar.", "sucesso");
    }, falha);
  };
  const regenerar = (): void => {
    void api.regenerar(ws, pacote.id).then((r) => { setPendente(false); aoSelecionar(r.pacote_id); recarregar(); avisar(r.reaproveitado ? "Nada mudou." : "Nova versão gerada com os seus ajustes.", r.reaproveitado ? "info" : "sucesso"); }, falha);
  };

  return (
    <div className="rl-revisao">
      {violacoes.length > 0 && (
        <div className="rl-faixa" role="alert">
          <strong>{violacoes.length} problema(s) no texto do cliente:</strong>
          <ul>{violacoes.slice(0, 12).map((v, i) => <li key={i}>{v.detalhe}</li>)}</ul>
        </div>
      )}
      {pendente && (
        <p className="rl-faixa" data-tom="info" role="status">Há ajustes salvos que ainda não estão neste pacote. <button type="button" className="rl-btn" data-primario onClick={regenerar}>Regenerar com os ajustes</button></p>
      )}
      {pacote.blocos_usuario.map((b) => {
        const valor = rascunhos[b.id] ?? b.texto;
        const idCampo = `rl-bloco-${b.id}`;
        return (
          <section key={b.id} className="rl-bloco" aria-labelledby={`${idCampo}-t`}>
            <h4 id={`${idCampo}-t`}>{b.titulo}{b.precisa_revisao && <span className="rl-selo" data-estado="falhou"> precisa de revisão</span>}{b.ajustado && <span className="rl-selo"> texto da equipe</span>}</h4>
            <label className="rl-campo" htmlFor={idCampo}><span className="rl-so-leitor">Texto do bloco {b.titulo}</span></label>
            <textarea id={idCampo} rows={Math.min(8, Math.max(2, valor.split("\n").length + 1))} value={valor} onChange={(e) => setRascunhos((r) => ({ ...r, [b.id]: e.target.value }))} />
            <div className="rl-acoes">
              <button type="button" className="rl-btn" disabled={valor.trim() === "" || valor === b.texto} onClick={() => salvar(b.id, valor)}>Salvar ajuste</button>
              {b.ajustado && <button type="button" className="rl-btn" onClick={() => salvar(b.id, null)}>Voltar ao texto padrão</button>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
