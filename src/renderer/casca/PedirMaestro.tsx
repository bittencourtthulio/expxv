// "Pedir ao Maestro" (paleta ⌘K e atalho do painel): campo compacto (1 linha, expande) que envia `maestro:pedir` DIRETO ao Maestro,
// sem passar pela CLI (não gasta token) e sem escrever no PTY. O plano aparece na tela Pipelines; nada executa sem confirmar.
import { useEffect, useRef, useState } from "react";
import { TEXTO_PEDIDO_MAX, type ContextoPedido } from "../../compartilhado/maestro";
import { Dialogo } from "../componentes/Dialogo";
import { aoPedirMaestro } from "../estado/maestro-acoes";
import { storeMaestro } from "../estado/maestro";
import { pedirTela } from "../estado/navegacao";
import { storeWorkspaces } from "../estado/workspaces";
import { problemaDoTexto } from "../telas/pipelines/logica";

export function PedirMaestro() {
  const [aberto, setAberto] = useState<{ contexto: ContextoPedido | null; origem: string | null } | null>(null);
  useEffect(() => aoPedirMaestro((p) => setAberto({ contexto: p.contexto, origem: p.origem })), []);
  return aberto === null ? null : <Campo contexto={aberto.contexto} origem={aberto.origem} aoFechar={() => setAberto(null)} />;
}

function Campo({ contexto, origem, aoFechar }: { contexto: ContextoPedido | null; origem: string | null; aoFechar: () => void }) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const expandido = texto.length > 90 || texto.includes("\n");
  const enviar = async (): Promise<void> => {
    const problema = problemaDoTexto(texto);
    if (problema !== null) { setErro(problema); return; }
    const ws = storeWorkspaces.obter().atual?.id ?? null;
    if (ws === null) { setErro("Abra um projeto antes de pedir ao Maestro."); return; }
    setEnviando(true);
    await storeMaestro.definirWorkspace(ws);
    const ok = await storeMaestro.pedir(texto, contexto);
    setEnviando(false);
    if (ok) { aoFechar(); pedirTela("pipelines"); } else setErro(storeMaestro.obter().erroPedido ?? "Não foi possível montar o plano.");
  };
  return (
    <Dialogo titulo={origem === null ? "Pedir ao Maestro" : `Pedir ao Maestro — ${origem}`} aoFechar={aoFechar} largura={560}>
      <label htmlFor="pedir-maestro" className="pl-discreto">O que você quer fazer? O pedido vai direto ao Maestro (não passa pela CLI).</label>
      <textarea
        id="pedir-maestro"
        ref={ref}
        data-foco-inicial
        rows={expandido ? 4 : 1}
        className="pl-campo-compacto"
        value={texto}
        maxLength={TEXTO_PEDIDO_MAX + 200}
        aria-invalid={erro !== null || undefined}
        onChange={(e) => { setTexto(e.target.value); setErro(null); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
      />
      <div className="pl-discreto">{texto.length}/{TEXTO_PEDIDO_MAX} · Enter envia · Shift+Enter quebra a linha{contexto?.mission_id != null ? " · com o contexto da Missão" : ""}</div>
      {erro !== null ? <p className="pl-erro" role="alert">{erro}</p> : null}
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
        <button type="button" className="botao botao-primario" disabled={enviando || texto.trim() === ""} onClick={() => void enviar()}>{enviando ? "Enviando…" : "Propor plano"}</button>
      </div>
    </Dialogo>
  );
}
