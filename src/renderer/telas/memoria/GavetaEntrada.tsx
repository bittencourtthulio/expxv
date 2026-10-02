import { useEffect, useId, useRef, useState } from "react";
import type { EntradaMemoria } from "../../../compartilhado/memoria";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { CONTEUDO_MAX, ROTULO_ESCOPO, ROTULO_FONTE, ROTULO_TIPO, validarTexto } from "./logica";

export interface PropsGaveta {
  entrada: EntradaMemoria;
  aoFechar: () => void;
  aoAtualizar: (id: string, mudanca: { conteudo?: string; importancia?: 1 | 2 | 3 | 4 | 5 }) => Promise<unknown>;
  aoEsquecer: (id: string) => Promise<boolean>;
  aoEsquecerPane: (paneId: string) => Promise<number | null>;
}

/** Painel lateral de 320 px: o conteúdo completo COMO TEXTO (nunca HTML), a origem, editar, fixar e esquecer (sempre com confirmação da UI). */
export function GavetaEntrada({ entrada, aoFechar, aoAtualizar, aoEsquecer, aoEsquecerPane }: PropsGaveta) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(entrada.conteudo);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<"entrada" | "pane" | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const titulo = useId();
  const raiz = useRef<HTMLElement>(null);
  const fixada = entrada.importancia === 5;

  useEffect(() => { setEditando(false); setErro(null); setRascunho(entrada.conteudo); }, [entrada.id, entrada.conteudo]);
  useEffect(() => { raiz.current?.focus(); }, [entrada.id]);

  const salvar = async (): Promise<void> => {
    const v = validarTexto(rascunho, CONTEUDO_MAX, "texto da entrada");
    if (!v.ok) { setErro(v.erro); return; }
    setOcupado(true);
    const r = await aoAtualizar(entrada.id, { conteudo: v.valor });
    setOcupado(false);
    if (r !== null) { setEditando(false); setErro(null); } else setErro("Não foi possível salvar a edição.");
  };
  const fixar = async (): Promise<void> => {
    setOcupado(true);
    await aoAtualizar(entrada.id, { importancia: fixada ? 3 : 5 });
    setOcupado(false);
  };
  const executar = async (): Promise<void> => {
    const qual = confirmar;
    setOcupado(true);
    const ok = qual === "pane" && entrada.pane_id !== null ? (await aoEsquecerPane(entrada.pane_id)) !== null : await aoEsquecer(entrada.id);
    setOcupado(false);
    setConfirmar(null);
    if (ok) aoFechar();
  };

  return (
    <aside ref={raiz} className="mem-gaveta" aria-labelledby={titulo} tabIndex={-1} onKeyDown={(e) => { if (e.key === "Escape" && !editando && confirmar === null) { e.stopPropagation(); aoFechar(); } }}>
      <h2 id={titulo}>{ROTULO_TIPO[entrada.tipo]} · {ROTULO_ESCOPO[entrada.escopo]}</h2>
      {editando ? (
        <div className="mem-form">
          <label htmlFor="mem-edicao">Texto da entrada</label>
          <textarea id="mem-edicao" value={rascunho} aria-invalid={erro !== null} aria-describedby="mem-edicao-ajuda" onChange={(e) => { setRascunho(e.target.value); setErro(null); }} data-foco-inicial />
          <p id="mem-edicao-ajuda" className="mem-contador">{Array.from(rascunho).length} de {CONTEUDO_MAX}. Segredos são mascarados ao salvar; a entrada passa a constar como escrita por você.</p>
          {erro !== null ? <p role="alert" className="mem-erro">{erro}</p> : null}
          <div className="mem-acoes">
            <button type="button" disabled={ocupado} onClick={() => void salvar()}>Salvar</button>
            <button type="button" onClick={() => { setEditando(false); setRascunho(entrada.conteudo); setErro(null); }}>Cancelar</button>
          </div>
        </div>
      ) : (
        <>
          <pre className="mem-texto" aria-label="Conteúdo da entrada">{entrada.conteudo}</pre>
          {entrada.redigido ? <p className="mem-nota"><span aria-hidden="true">⛨ </span>Um segredo foi mascarado nesta entrada ([REDACTED]) antes de gravar. O valor original nunca é guardado.</p> : null}
          {erro !== null ? <p role="alert" className="mem-erro">{erro}</p> : null}
        </>
      )}
      <dl className="mem-meta">
        <dt>Origem</dt><dd>{ROTULO_FONTE[entrada.fonte]}</dd>
        <dt>Importância</dt><dd>{fixada ? "5 (fixada)" : entrada.importancia}</dd>
        <dt>Painel</dt><dd>{entrada.display_id !== null ? `#${entrada.display_id}` : "—"}</dd>
        <dt>Criada</dt><dd>{entrada.criado_em}</dd>
        <dt>Atualizada</dt><dd>{entrada.atualizado_em}</dd>
        {entrada.contagem > 1 ? (<><dt>Repetida</dt><dd>{entrada.contagem} vezes</dd></>) : null}
      </dl>
      {!editando ? (
        <div className="mem-acoes">
          <button type="button" disabled={ocupado} onClick={() => setEditando(true)}>Editar</button>
          <button type="button" aria-pressed={fixada} disabled={ocupado} title={fixada ? "Voltar à importância 3" : "Importância 5: fica fora da compactação e da retenção"} onClick={() => void fixar()}>{fixada ? "Desafixar" : "Fixar"}</button>
          <button type="button" className="mem-perigo" disabled={ocupado} onClick={() => setConfirmar("entrada")}>Esquecer</button>
          {entrada.pane_id !== null ? <button type="button" className="mem-perigo" disabled={ocupado} onClick={() => setConfirmar("pane")}>Esquecer este Pane inteiro</button> : null}
          <button type="button" onClick={aoFechar}>Fechar</button>
        </div>
      ) : null}
      {confirmar === "entrada" ? (
        <DialogoConfirmacao titulo="Esquecer esta entrada?" rotuloConfirmar="Esquecer" perigoso ocupado={ocupado} aoCancelar={() => setConfirmar(null)} aoConfirmar={() => void executar()}
          texto={<p>A entrada é apagada deste computador e não aparece mais em briefs, buscas nem exportações. Não dá para desfazer.</p>} />
      ) : null}
      {confirmar === "pane" ? (
        <DialogoConfirmacao titulo="Esquecer este Pane inteiro?" rotuloConfirmar="Esquecer o Pane" perigoso ocupado={ocupado} aoCancelar={() => setConfirmar(null)} aoConfirmar={() => void executar()}
          texto={<p>Apaga TODA a memória deste Pane e dos Panes reabertos a partir dele (a linhagem inteira). Não dá para desfazer.</p>} />
      ) : null}
    </aside>
  );
}
