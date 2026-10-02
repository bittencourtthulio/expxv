// "Instalar na minha CLI": prévia do comando e confirmação DIGITADA (o nome mostrado na prévia). Só escopo `user`; segredo nunca vai.
import { useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { CliLojaMcp, PreviaCliMcp } from "../../../compartilhado/loja-mcp";
import { Dialogo } from "../../componentes/Dialogo";
import { CLIS, confirmacaoConfere, mensagemDoCodigo, mensagemDoErro, ROTULO_CLI } from "./logica";

type Api = ApiAde["lojaMcp"];

export interface PropsCliUsuario {
  api: Api;
  id: string;
  nome: string;
  workspaceId: string | null;
  jaNaCli: ReadonlyArray<{ cli: CliLojaMcp; nome_na_cli: string }>;
  aoMudar: () => void;
  aoFechar: () => void;
}

export function DialogoCliUsuario({ api, id, nome, workspaceId, jaNaCli, aoMudar, aoFechar }: PropsCliUsuario) {
  const [cli, setCli] = useState<CliLojaMcp>("claude");
  const [previa, setPrevia] = useState<PreviaCliMcp | null>(null);
  const [digitado, setDigitado] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const instalada = jaNaCli.find((x) => x.cli === cli) ?? null;

  const ver = async () => {
    setOcupado(true); setErro(null); setMsg(null); setPrevia(null); setDigitado("");
    try {
      const r = await api.previaCliUsuario(id, cli, workspaceId);
      if (r.ok) setPrevia(r.previa); else setErro(r.motivo !== "" ? r.motivo : mensagemDoCodigo(r.codigo));
    } catch (e) { setErro(mensagemDoErro(e)); }
    finally { setOcupado(false); }
  };
  const instalar = async () => {
    if (previa === null) return;
    setOcupado(true); setErro(null);
    try {
      const r = await api.instalarNaCli(id, cli, digitado.trim(), workspaceId);
      if (r.ok) { setMsg(`Instalado na sua CLI (${ROTULO_CLI[cli]}) como ${previa.nome_na_cli}.`); setPrevia(null); aoMudar(); }
      else setErro(r.motivo ?? mensagemDoCodigo(r.codigo));
    } catch (e) { setErro(mensagemDoErro(e)); }
    finally { setOcupado(false); }
  };
  const remover = async () => {
    setOcupado(true); setErro(null);
    try {
      const r = await api.removerDaCli(id, cli);
      if (r.ok) { setMsg(`Removido da sua CLI (${ROTULO_CLI[cli]}).`); aoMudar(); } else setErro(r.motivo ?? mensagemDoCodigo(r.codigo));
    } catch (e) { setErro(mensagemDoErro(e)); }
    finally { setOcupado(false); }
  };
  return (
    <Dialogo titulo={`Instalar ${nome} na minha CLI`} aoFechar={aoFechar} largura={640}>
      <div className="dialogo-corpo">
        <p>Isto altera a configuração <strong>global</strong> da sua CLI (escopo do usuário). Por padrão a Loja não faz isso: ela só injeta o servidor nos terminais do app.</p>
        <label className="lm-rot">CLI
          <select value={cli} onChange={(e) => { setCli(e.target.value as CliLojaMcp); setPrevia(null); setErro(null); setMsg(null); }}>
            {CLIS.map((c) => <option key={c} value={c}>{ROTULO_CLI[c]}</option>)}
          </select>
        </label>
        {instalada !== null ? <p className="lm-nota">Já instalado nesta CLI como <code>{instalada.nome_na_cli}</code>. <button type="button" className="botao lm-mini" disabled={ocupado} onClick={() => void remover()}>Remover da {ROTULO_CLI[cli]}</button></p> : null}
        {previa === null ? <button type="button" className="botao lm-mini" disabled={ocupado} onClick={() => void ver()}>Ver prévia do comando</button> : (
          <>
            <pre className="lm-codigo" aria-label="Prévia do comando">{previa.texto}</pre>
            {previa.avisos.map((a) => <p key={a} className="lm-aviso-linha" data-nivel="atencao">{a}</p>)}
            <label className="lm-rot">Para confirmar, digite <code>{previa.nome_na_cli}</code>
              <input value={digitado} autoComplete="off" spellCheck={false} aria-label="Confirmação digitada" onChange={(e) => setDigitado(e.target.value)} />
            </label>
          </>
        )}
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
        {msg !== null ? <p role="status" className="lm-ok">{msg}</p> : null}
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" data-foco-inicial onClick={aoFechar}>Fechar</button>
        <button type="button" className="botao botao-primario" disabled={previa === null || ocupado || !confirmacaoConfere(digitado, previa.nome_na_cli)} onClick={() => void instalar()}>Instalar na minha CLI</button>
      </div>
    </Dialogo>
  );
}
