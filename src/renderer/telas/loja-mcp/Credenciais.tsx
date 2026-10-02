// Assistente de credenciais: um campo mascarado por variável; o valor vive só no estado local do campo, é zerado ANTES da resposta
// e nunca vai a store, storage, log nem DOM depois de salvar. Depois só existe `definida: boolean` (`variaveisEstado`).
import { useCallback, useEffect, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { DetalheMcp, ResultadoTesteMcp, VariavelMcpEstado } from "../../../compartilhado/loja-mcp";
import { Dialogo } from "../../componentes/Dialogo";
import { formatarLatencia, mensagemDoCodigo, mensagemDoErro, problemaDoValor } from "./logica";

type Api = ApiAde["lojaMcp"];

export interface PropsCredenciais {
  api: Api;
  detalhe: Pick<DetalheMcp, "id" | "nome" | "permissoes">;
  cofreDisponivel: boolean;
  workspaceId: string | null;
  aoMudar: () => void;
  aoFechar: () => void;
}

const linkSeguro = (url: string | null): string | null => (url !== null && /^https:\/\/[^\s]+$/.test(url) ? url : null);

function Campo({ api, id, v, ajuda, onde, cofreDisponivel, aoMudar }: { api: Api; id: string; v: VariavelMcpEstado; ajuda: string; onde: string | null; cofreDisponivel: boolean; aoMudar: () => void }) {
  const [valor, setValor] = useState("");
  const [problema, setProblema] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const link = linkSeguro(onde);

  const salvar = async () => {
    const p = problemaDoValor(valor);
    setProblema(p);
    if (p !== null) return;
    const enviar = valor;
    setValor(""); // limpa antes da resposta: o valor não fica no estado nem no DOM
    setOcupado(true); setAviso(null);
    try {
      const r = await api.gravarVariavel(id, v.nome, enviar);
      if (r.ok) { setAviso("Salvo no cofre."); aoMudar(); } else setProblema(mensagemDoCodigo(r.codigo));
    } catch (e) { setProblema(mensagemDoErro(e)); }
    finally { setOcupado(false); }
  };
  const apagar = async () => {
    setOcupado(true); setAviso(null);
    try { await api.apagarVariavel(id, v.nome); setAviso("Removida do cofre."); aoMudar(); }
    catch (e) { setProblema(mensagemDoErro(e)); }
    finally { setOcupado(false); }
  };
  const idCampo = `lm-var-${id}-${v.nome}`;
  return (
    <div className="lm-var" role="group" aria-label={`Variável ${v.nome}`}>
      <div className="lm-var-cab">
        <label htmlFor={idCampo}><code>{v.nome}</code></label>
        <span className="lst-selo" data-tom={v.obrigatoria ? "aviso" : "neutro"}>{v.obrigatoria ? "obrigatória" : "opcional"}</span>
        <span className="lst-selo" data-tom={v.definida ? "sucesso" : "neutro"}>{v.definida ? "definida" : "não definida"}</span>
      </div>
      {ajuda !== "" ? <p className="lm-nota">{ajuda}{link !== null ? <> <a href={link} target="_blank" rel="noreferrer noopener">Onde conseguir</a></> : null}</p> : null}
      <div className="lm-var-linha">
        <input
          id={idCampo}
          type="password"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={valor}
          disabled={!cofreDisponivel || ocupado}
          placeholder={v.definida ? "•••• (cole um novo valor para trocar)" : "Cole o valor"}
          aria-invalid={problema !== null}
          aria-describedby={problema !== null ? `${idCampo}-erro` : undefined}
          onChange={(e) => { setValor(e.target.value); setProblema(null); }}
        />
        <button type="button" className="botao lm-mini" disabled={!cofreDisponivel || ocupado || valor === ""} onClick={() => void salvar()}>Salvar no cofre</button>
        {v.definida ? <button type="button" className="botao lm-mini" disabled={ocupado} onClick={() => void apagar()}>Apagar</button> : null}
      </div>
      {problema !== null ? <p id={`${idCampo}-erro`} className="campo-erro" role="alert">{problema}</p> : null}
      {aviso !== null ? <p className="lm-nota" role="status">{aviso}</p> : null}
    </div>
  );
}

export function DialogoCredenciais({ api, detalhe, cofreDisponivel, workspaceId, aoMudar, aoFechar }: PropsCredenciais) {
  const [vars, setVars] = useState<VariavelMcpEstado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [teste, setTeste] = useState<ResultadoTesteMcp | null>(null);
  const [testando, setTestando] = useState(false);

  const recarregar = useCallback(() => {
    api.variaveisEstado(detalhe.id).then((v) => { setVars(v); setErro(null); }, (e: unknown) => setErro(mensagemDoErro(e)));
  }, [api, detalhe.id]);
  useEffect(() => { recarregar(); }, [recarregar]);

  const testar = async () => {
    setTestando(true); setTeste(null); setErro(null);
    try { setTeste(await api.testar(detalhe.id, workspaceId)); }
    catch (e) { setErro(mensagemDoErro(e)); }
    finally { setTestando(false); aoMudar(); }
  };
  const meta = new Map((detalhe.permissoes?.variaveis ?? []).map((m) => [m.nome, m]));
  return (
    <Dialogo titulo={`Configurar ${detalhe.nome}`} aoFechar={aoFechar} largura={600}>
      <div className="dialogo-corpo">
        {!cofreDisponivel ? <p className="aviso-caixa" role="alert"><strong>Cofre indisponível.</strong> O cofre do sistema não está acessível, então não é possível guardar chaves. Nada é gravado em arquivo solto.</p> : (
          <p className="lm-nota">As chaves ficam no cofre do sistema. O valor nunca volta para esta tela.</p>
        )}
        {vars === null && erro === null ? <p aria-busy="true">Carregando variáveis…</p> : null}
        {vars !== null && vars.length === 0 ? <p>Este servidor não pede variáveis.</p> : null}
        {vars?.map((v) => <Campo key={v.nome} api={api} id={detalhe.id} v={v} ajuda={meta.get(v.nome)?.ajuda ?? ""} onde={meta.get(v.nome)?.onde_conseguir ?? null} cofreDisponivel={cofreDisponivel} aoMudar={() => { recarregar(); aoMudar(); }} />)}
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
        {teste !== null ? (
          <p role="status" className={teste.estado === "ok" ? "lm-ok" : "erro-caixa"}>
            {teste.estado === "ok"
              ? `ok · ${teste.n_ferramentas} ferramentas · ${formatarLatencia(teste.latencia_ms)}`
              : `Falhou: ${mensagemDoCodigo(teste.erro, teste.variaveis_faltando.length > 0 ? `Faltam variáveis: ${teste.variaveis_faltando.join(", ")}.` : "o servidor não respondeu.")}`}
          </p>
        ) : null}
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" disabled={testando} onClick={() => void testar()}>{testando ? "Testando…" : "Testar"}</button>
        <button type="button" className="botao botao-primario" data-foco-inicial onClick={aoFechar}>Concluir</button>
      </div>
    </Dialogo>
  );
}
