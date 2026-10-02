import { useState, type ReactNode } from "react";
import { Dialogo } from "../../componentes/Dialogo";

/** Pergunta um texto (nome de branch, mensagem…). */
export function DialogoCampo({ titulo, rotulo, inicial = "", rotuloConfirmar, texto, aoConfirmar, aoCancelar, validar }: { titulo: string; rotulo: string; inicial?: string; rotuloConfirmar: string; texto?: ReactNode; aoConfirmar: (v: string) => void; aoCancelar: () => void; validar?: (v: string) => string | null }) {
  const [v, setV] = useState(inicial);
  const erro = v.trim() === "" ? null : (validar?.(v.trim()) ?? null);
  const ok = v.trim() !== "" && erro === null;
  return (
    <Dialogo titulo={titulo} aoFechar={aoCancelar}>
      <form onSubmit={(e) => { e.preventDefault(); if (ok) aoConfirmar(v.trim()); }}>
        <div className="dialogo-corpo">
          {texto}
          <label className="vc-campo-rotulo">{rotulo}
            <input className="vc-campo" data-foco-inicial value={v} onChange={(e) => setV(e.target.value)} />
          </label>
          {erro !== null ? <p className="vc-aviso" role="alert">{erro}</p> : null}
        </div>
        <div className="dialogo-acoes">
          <button type="button" className="botao" onClick={aoCancelar}>Cancelar</button>
          <button type="submit" className="botao botao-primario" disabled={!ok}>{rotuloConfirmar}</button>
        </div>
      </form>
    </Dialogo>
  );
}

/** Confirmação DIGITADA (D-36): o botão só habilita quando o texto digitado é igual ao esperado (ex.: nome do branch). */
export function DialogoDigitar({ titulo, texto, esperado, rotuloConfirmar, ocupado = false, aoConfirmar, aoCancelar }: { titulo: string; texto: ReactNode; esperado: string; rotuloConfirmar: string; ocupado?: boolean; aoConfirmar: (digitado: string) => void; aoCancelar: () => void }) {
  const [v, setV] = useState("");
  const ok = v === esperado;
  return (
    <Dialogo titulo={titulo} aoFechar={aoCancelar} largura={560}>
      <form onSubmit={(e) => { e.preventDefault(); if (ok && !ocupado) aoConfirmar(v); }}>
        <div className="dialogo-corpo">
          {texto}
          <label className="vc-campo-rotulo">Digite <code>{esperado}</code> para confirmar
            <input className="vc-campo" data-foco-inicial value={v} autoComplete="off" onChange={(e) => setV(e.target.value)} />
          </label>
        </div>
        <div className="dialogo-acoes">
          <button type="button" className="botao" onClick={aoCancelar}>Cancelar</button>
          <button type="submit" className="botao botao-perigo" disabled={!ok || ocupado}>{rotuloConfirmar}</button>
        </div>
      </form>
    </Dialogo>
  );
}
