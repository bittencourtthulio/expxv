import { useState } from "react";
import type { EstadoMemoriaApp } from "../../../compartilhado/memoria";
import { ade } from "../../ade";
import { useTerminais, storeTerminais, type StoreTerminais } from "../../estado/terminais";
import { avisar } from "../../estado/avisos";

/** CLIs que entendem os comandos `/expx:*` (as que o método instala). */
export const CLIS_DO_METODO: readonly string[] = ["claude", "opencode"];
export const COMANDO_REINDEXAR = "/expx:memox-indexar";
export const comandoBuscar = (termo: string): string => `/expx:memox-buscar ${termo.replace(/[\r\n]+/g, " ").trim()}`;

/**
 * Cartão "Memória do método" (memox): mostra o estado e DIGITA o comando do método no terminal escolhido (D-20). O ADE nunca roda
 * `memox.py indexar` nem escreve em `.expx/` ou `docs/`: indexar é ação do usuário, pela CLI dele.
 */
export function CartaoMemox({ memox, terminais = storeTerminais }: { memox: EstadoMemoriaApp["memox"]; terminais?: StoreTerminais }) {
  const { sessoes } = useTerminais(terminais);
  const elegiveis = sessoes.filter((s) => s.estado === "executando" && CLIS_DO_METODO.includes(s.ferramenta_id));
  const [alvo, setAlvo] = useState("");
  const [termo, setTermo] = useState("");
  const escolhido = elegiveis.find((s) => s.sessao_id === alvo) ?? elegiveis[0];

  const digitar = (comando: string): void => {
    if (escolhido === undefined) return;
    try {
      ade()?.terminais.escrever(escolhido.sessao_id, `${comando}\r`);
      avisar(`Comando enviado ao painel #${escolhido.numero}.`, "sucesso");
    } catch (e) { avisar(`Não foi possível digitar o comando: ${e instanceof Error ? e.message : String(e)}`, "erro"); }
  };

  return (
    <section className="mem-cartao" aria-label="Memória do método">
      <strong>Memória do método (memox)</strong>
      {!memox.instalado ? (
        <p className="mem-nota">O memox não está instalado neste projeto. Ele guarda o que o projeto já viveu com cada arquivo. Para instalar: <code>expxdev add memox</code>. Nada aqui depende dele.</p>
      ) : (
        <>
          <p className="mem-nota">{memox.texto !== null && memox.texto !== "" ? memox.texto : "Instalado. O estado do índice não respondeu."}</p>
          <div className="mem-linha-controles">
            <label htmlFor="mem-memox-alvo">Painel</label>
            <select id="mem-memox-alvo" value={escolhido?.sessao_id ?? ""} disabled={elegiveis.length === 0} onChange={(e) => setAlvo(e.target.value)}>
              {elegiveis.length === 0 ? <option value="">Nenhum painel com a CLI do método</option> : elegiveis.map((s) => <option key={s.sessao_id} value={s.sessao_id}>#{s.numero} · {s.ferramenta_id}</option>)}
            </select>
            <button type="button" className="mem-btn" disabled={escolhido === undefined} title="Digita /expx:memox-indexar no painel escolhido" onClick={() => digitar(COMANDO_REINDEXAR)}>Reindexar</button>
          </div>
          <div className="mem-linha-controles">
            <label htmlFor="mem-memox-termo">Buscar no memox</label>
            <input id="mem-memox-termo" className="mem-campo" style={{ width: "14em" }} value={termo} onChange={(e) => setTermo(e.target.value)} />
            <button type="button" className="mem-btn" disabled={escolhido === undefined || termo.trim() === ""} onClick={() => digitar(comandoBuscar(termo))}>Buscar</button>
          </div>
          {elegiveis.length === 0 ? <p className="mem-nota">Abra um terminal com Claude Code ou OpenCode para usar estes botões.</p> : null}
        </>
      )}
    </section>
  );
}
