import "./provedores.css";
import { useEffect, useState } from "react";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Pagina } from "../../componentes/Pagina";
import { storeProvedores, useProvedores, type StoreProvedores } from "../../estado/provedores";
import { CartaoProvedor } from "./Conta";

export function TelaProvedores({ store = storeProvedores }: { store?: StoreProvedores }) {
  const { lista, carregando, erro } = useProvedores(store);
  const [diagnostico, setDiagnostico] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => { if (store.obter().lista === null) void store.carregar(false); }, [store]);

  const gerar = async () => { setCopiado(false); setDiagnostico(await store.diagnostico()); };
  const copiar = async () => {
    try { await navigator.clipboard.writeText(diagnostico ?? ""); setCopiado(true); } catch { setCopiado(false); }
  };

  return (
    <Pagina titulo="CLIs e contas" subtitulo="CLIs detectadas nesta máquina e suas contas.">
      <div className="barra-acoes">
        <button type="button" className="botao" disabled={carregando} onClick={() => void store.carregar(true)}>{carregando ? "Atualizando…" : "Atualizar"}</button>
        <button type="button" className="botao" onClick={() => void gerar()}>Diagnóstico</button>
      </div>
      {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      {diagnostico !== null ? (
        <div className="prov-diagnostico">
          <textarea readOnly aria-label="Diagnóstico" value={diagnostico} rows={8} />
          <button type="button" className="botao" onClick={() => void copiar()}>{copiado ? "Copiado" : "Copiar"}</button>
        </div>
      ) : null}
      {lista === null ? <div aria-busy="true" /> : lista.length === 0 ? (
        <EstadoVazio icone="provedores" titulo="Nenhuma CLI detectada" texto="Instale uma CLI de IA (por exemplo Claude Code ou Codex) e clique em Atualizar." />
      ) : (
        <ul className="prov-lista" aria-label="CLIs detectadas">
          {lista.map((p) => (
            <CartaoProvedor key={p.ferramenta.id} info={p} aoCriarConta={(r) => store.criarConta(p.ferramenta.id, r)} aoHabilitar={(id, h) => void store.habilitarConta(id, h)} />
          ))}
        </ul>
      )}
    </Pagina>
  );
}

export default function Tela() {
  return <TelaProvedores />;
}
