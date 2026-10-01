import { useState } from "react";
import type { ProvedorInfo } from "../../../compartilhado/dominio";
import { Badge } from "../../componentes/Badge";
import { estadoDaFerramenta, instrucao } from "./textos";

export interface PropsProvedor {
  info: ProvedorInfo;
  aoCriarConta: (rotulo: string) => Promise<boolean>;
  aoHabilitar: (contaId: string, habilitada: boolean) => void;
}

export function CartaoProvedor({ info, aoCriarConta, aoHabilitar }: PropsProvedor) {
  const { ferramenta: f, contas } = info;
  const [rotulo, setRotulo] = useState("");
  const est = estadoDaFerramenta(f);
  const dica = instrucao(f);
  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = rotulo.trim();
    if (r === "") return;
    if (await aoCriarConta(r)) setRotulo("");
  };
  return (
    <li className="prov-cartao">
      <div className="prov-cabecalho">
        <strong>{f.nome}</strong>
        <Badge tom={est.tom}>{est.texto}</Badge>
        {f.versao !== null ? <code className="prov-versao">{f.versao}</code> : null}
      </div>
      <p className="prov-desc">{f.descricao}</p>
      {dica !== null ? <p className="aviso-caixa" role="note">{dica}</p> : null}
      {f.instalado && f.id !== "terminal" ? (
        <div className="prov-contas">
          <h3>Contas</h3>
          {contas.length === 0 ? <p className="prov-desc">Nenhuma conta. A CLI usa o login padrão da máquina.</p> : (
            <ul>
              {contas.map((c) => (
                <li key={c.id}>
                  <label>
                    <input type="checkbox" role="switch" checked={c.habilitada} onChange={(e) => aoHabilitar(c.id, e.target.checked)} />
                    {c.rotulo}
                  </label>
                  <Badge tom={c.habilitada ? "sucesso" : "neutro"}>{c.habilitada ? "habilitada" : "desabilitada"}</Badge>
                </li>
              ))}
            </ul>
          )}
          <form className="prov-nova" onSubmit={(e) => void criar(e)}>
            <input aria-label={`Rótulo da nova conta de ${f.nome}`} placeholder="Rótulo da conta (ex.: pessoal)" value={rotulo} onChange={(e) => setRotulo(e.target.value)} maxLength={60} />
            <button type="submit" className="botao" disabled={rotulo.trim() === ""}>Criar conta</button>
          </form>
        </div>
      ) : null}
    </li>
  );
}
