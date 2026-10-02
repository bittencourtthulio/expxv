// Diálogo próprio para as duas exigências do main: confirmação digitada ("baixar") e justificativa (≥ 20 caracteres). Nunca window.confirm/prompt.
import { useEffect, useState } from "react";
import { Dialogo } from "../../componentes/Dialogo";
import { FRASE_CONFIRMACAO, JUSTIFICATIVA_MIN, fraseValida, justificativaValida, type Exigencia } from "./logica";

export function ExigenciaDialogo({ exigencia, ocupado = false, aoConfirmar, aoCancelar }: { exigencia: Exigencia; ocupado?: boolean; aoConfirmar: (valor: string) => void; aoCancelar: () => void }) {
  const [texto, setTexto] = useState("");
  useEffect(() => { setTexto(""); }, [exigencia.tipo]);
  const confirmacao = exigencia.tipo === "confirmacao";
  const valido = confirmacao ? fraseValida(texto) : justificativaValida(texto);
  const enviar = (): void => { if (valido && !ocupado) aoConfirmar(confirmacao ? texto.trim().toLowerCase() : texto.trim()); };
  return (
    <Dialogo titulo={confirmacao ? "Confirmar rigidez baixa" : "Justificar nível abaixo do mínimo"} aoFechar={aoCancelar} largura={440}>
      <p>{exigencia.mensagem}</p>
      {confirmacao ? (
        <label className="pl-campo">Digite <strong>{FRASE_CONFIRMACAO}</strong> para confirmar
          <input data-foco-inicial value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") enviar(); }} autoComplete="off" />
        </label>
      ) : (
        <label className="pl-campo">Justificativa (mín. {JUSTIFICATIVA_MIN} caracteres; fica registrada)
          <textarea data-foco-inicial rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
          <span className="pl-discreto" aria-live="polite">{texto.trim().length}/{JUSTIFICATIVA_MIN}</span>
        </label>
      )}
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoCancelar}>Cancelar</button>
        <button type="button" className="botao botao-primario" disabled={!valido || ocupado} onClick={enviar}>Confirmar</button>
      </div>
    </Dialogo>
  );
}
