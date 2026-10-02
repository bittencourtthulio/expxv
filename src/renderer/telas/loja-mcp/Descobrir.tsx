// Descobrir no Registro Oficial (T-07B.32): UMA consulta por clique. O que volta é dado de terceiro (não curado, não instalável, sem
// comando); "Sugerir ao catálogo" só copia um rascunho de entrada para a curadoria humana (nada é gravado nem enviado).
import { useId, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { ResultadoDescobertaMcp } from "../../../compartilhado/loja-mcp";
import { Dialogo } from "../../componentes/Dialogo";
import { mensagemDoErro, rascunhoDeEntrada } from "./logica";

type Api = ApiAde["lojaMcp"];

export function DialogoDescobrir({ api, aoFechar }: { api: Api; aoFechar: () => void }) {
  const [consulta, setConsulta] = useState("");
  const [r, setR] = useState<ResultadoDescobertaMcp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const idCampo = useId();
  const valida = consulta.trim().length >= 2;

  const buscar = async () => {
    if (!valida || ocupado) return;
    setOcupado(true); setErro(null); setR(null); setCopiado(null);
    try { setR(await api.descobrir(consulta.trim())); }
    catch (e) { setErro(mensagemDoErro(e)); }
    finally { setOcupado(false); }
  };
  const sugerir = async (nome: string) => {
    const c = r?.candidatos.find((x) => x.nome === nome);
    if (c === undefined) return;
    try { await navigator.clipboard.writeText(rascunhoDeEntrada(c, new Date().toISOString().slice(0, 10))); setCopiado(nome); }
    catch { setErro("Não foi possível copiar o rascunho."); }
  };
  return (
    <Dialogo titulo="Descobrir no Registro Oficial" aoFechar={aoFechar} largura={640}>
      <div className="dialogo-corpo">
        <p>Consulta o Registro Oficial do MCP (<code>registry.modelcontextprotocol.io</code>) só quando você clica em Buscar. Os resultados <strong>não são curados e não podem ser instalados</strong> por aqui.</p>
        <form className="lm-descobrir-form" onSubmit={(e) => { e.preventDefault(); void buscar(); }}>
          <label className="lm-rot" htmlFor={idCampo}>Buscar
            <input id={idCampo} type="search" value={consulta} maxLength={100} autoComplete="off" data-foco-inicial placeholder="ex.: banco de dados, navegador" onChange={(e) => setConsulta(e.target.value)} />
          </label>
          <button type="submit" className="botao botao-primario lm-mini" disabled={!valida || ocupado}>{ocupado ? "Buscando…" : "Buscar"}</button>
        </form>
        {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
        {r !== null && r.candidatos.length === 0 ? <p role="status">Nada encontrado{r.descartados > 0 ? ` (${r.descartados} descartados como suspeitos)` : ""}.</p> : null}
        {r !== null && r.candidatos.length > 0 ? (
          <ul className="lm-descobertos" aria-label="Resultados do Registro Oficial">
            {r.candidatos.map((c) => (
              <li key={c.nome}>
                <div className="lm-desc-cab">
                  <strong>{c.nome}</strong>
                  <span className="lst-selo" data-tom="aviso">não curado</span>
                  {c.namespace_verificado ? <span className="lst-selo" data-tom="sucesso">namespace verificado</span> : null}
                  {c.versao !== null ? <span className="lm-nota">v{c.versao}</span> : null}
                </div>
                <p className="lm-nota">{c.descricao}</p>
                <div className="lm-acoes">
                  {c.repositorio !== null ? <a className="botao lm-mini" href={c.repositorio} target="_blank" rel="noreferrer noopener">Repositório</a> : null}
                  <button type="button" className="botao lm-mini" onClick={() => void sugerir(c.nome)}>{copiado === c.nome ? "Rascunho copiado" : "Sugerir ao catálogo"}</button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {r?.aviso != null ? <p className="lm-nota">{r.aviso}</p> : null}
      </div>
      <div className="dialogo-acoes"><button type="button" className="botao" onClick={aoFechar}>Fechar</button></div>
    </Dialogo>
  );
}
