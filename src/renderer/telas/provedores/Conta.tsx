import { useState } from "react";
import type { ProvedorInfo } from "../../../compartilhado/dominio";
import { Badge } from "../../componentes/Badge";
import { ItemLista } from "../../componentes/ItemLista";
import { estadoDaFerramenta, instrucao } from "./textos";

export interface PropsProvedor {
  info: ProvedorInfo;
  aoCriarConta: (rotulo: string) => Promise<boolean>;
  aoHabilitar: (contaId: string, habilitada: boolean) => void;
}

export function CartaoProvedor({ info, aoCriarConta, aoHabilitar }: PropsProvedor) {
  const { ferramenta: f, contas, login_contas: login } = info;
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
    <li className="prov-item">
      {/* D-694: a CLI é uma entidade por linha — nome ≫ descrição ≫ selo de estado, versão na meta mono */}
      <ItemLista
        titulo={f.nome}
        descricao={f.descricao}
        selos={[{ texto: est.texto, tom: est.tom }]}
        meta={f.versao !== null ? <span title={f.versao}>{f.versao}</span> : undefined}
      />
      {dica !== null || (f.instalado && f.id !== "terminal") ? (
        <div className="prov-corpo">
          {dica !== null ? <p className="aviso-caixa" role="note">{dica}</p> : null}
          {f.instalado && f.id !== "terminal" ? (
            <div className="prov-contas">
              <h3>Contas</h3>
              {contas.length === 0 ? <p className="prov-desc">Nenhuma conta ainda. Ao atualizar, a conta padrão (login existente da CLI) é detectada; ou crie uma conta isolada abaixo.</p> : (
                <ul>
                  {contas.map((c) => (
                    <li key={c.id}>
                      <label>
                        <input type="checkbox" role="switch" checked={c.habilitada} onChange={(e) => aoHabilitar(c.id, e.target.checked)} />
                        {c.rotulo}
                      </label>
                      <Badge tom={c.habilitada ? "sucesso" : "neutro"}>{c.habilitada ? "habilitada" : "desabilitada"}</Badge>
                      {login?.[c.id] === "autenticada" ? <Badge tom="sucesso">login existente</Badge> : null}
                      {login?.[c.id] === "nao_autenticada" ? <Badge tom="aviso">não autenticada</Badge> : null}
                      {login?.[c.id] === "nao_autenticada" ? <span className="prov-desc">{f.id === "grok" ? <>Entre na CLI uma vez (rode <code>grok login</code> no terminal; o app nunca executa o login nem lê a credencial) e clique em Atualizar.</> : <>Entre na CLI uma vez (rode <code>{f.id}</code> no terminal e faça login) e clique em Atualizar.</>}</span> : null}
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
        </div>
      ) : null}
    </li>
  );
}
