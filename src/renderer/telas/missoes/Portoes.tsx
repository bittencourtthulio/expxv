import { useState } from "react";
import type { EstadoPortoes, PortaoMissao } from "../../../compartilhado/dominio";
import { PORTOES_MISSAO } from "../../../compartilhado/dominio";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { ROTULO_PORTAO, PAPEL_DO_PORTAO } from "./rotulos";

export interface PropsPortoes {
  estado: EstadoPortoes;
  /** a missão ainda aceita liberação (não terminou) */
  ativa: boolean;
  /** há piloto na missão (o aviso de bloqueio só faz sentido com ele) */
  temPiloto: boolean;
  liberar: (portao: PortaoMissao) => Promise<void>;
}

function Marca({ liberado }: { liberado: boolean }) {
  // ícone pequeno; o estado também vai por texto (a cor nunca é o único sinal)
  return (
    <svg className="mis-portao-icone" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {liberado ? <path d="M2.5 6.5 5 9l4.5-5.5" /> : <circle cx="6" cy="6" r="3.8" />}
    </svg>
  );
}

/** Painel compacto (uma linha por portão): quem libera é a pessoa, com confirmação pelo Dialogo. */
export function PainelPortoes({ estado, ativa, temPiloto, liberar }: PropsPortoes) {
  const [alvo, setAlvo] = useState<PortaoMissao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const bloqueantes = estado.pendentes.filter((p) => PAPEL_DO_PORTAO[p] !== null);

  const confirmar = async () => {
    if (alvo === null) return;
    setOcupado(true);
    setErro(null);
    try { await liberar(alvo); }
    catch (e) { setErro(`Não foi possível liberar o portão: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setOcupado(false); setAlvo(null); }
  };

  return (
    <section className="mis-portoes" aria-label="Portões">
      <h3>Portões</h3>
      {ativa && temPiloto && bloqueantes.length > 0 ? (
        <p role="status" className="mis-portoes-aviso">
          O piloto fica bloqueado (gate_pending) ao abrir {bloqueantes.map((p) => PAPEL_DO_PORTAO[p]).join(", ")} até você liberar o portão correspondente.
        </p>
      ) : null}
      {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      <ul className="mis-portoes-lista" aria-label="Estado dos portões">
        {PORTOES_MISSAO.map((p) => {
          const liberado = estado.liberados.includes(p);
          const papel = PAPEL_DO_PORTAO[p];
          return (
            <li key={p} data-portao={p} data-estado={liberado ? "liberado" : "pendente"}>
              <Marca liberado={liberado} />
              <span className="mis-portao-nome">{ROTULO_PORTAO[p]}</span>
              <span className="mis-portao-estado">{liberado ? "liberado" : "pendente"}</span>
              {papel !== null ? <span className="mis-portao-papel">abre {papel}</span> : null}
              {!liberado && ativa ? (
                <button type="button" className="mis-portao-botao" aria-label={`Liberar ${ROTULO_PORTAO[p]}`} onClick={() => setAlvo(p)}>Liberar</button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {alvo !== null ? (
        <DialogoConfirmacao
          titulo={`Liberar o portão ${ROTULO_PORTAO[alvo]}?`}
          rotuloConfirmar="Liberar portão"
          ocupado={ocupado}
          aoCancelar={() => setAlvo(null)}
          aoConfirmar={() => void confirmar()}
          texto={<p>{PAPEL_DO_PORTAO[alvo] !== null ? `O piloto poderá abrir ${PAPEL_DO_PORTAO[alvo]}.` : "O piloto poderá seguir para a próxima etapa."} A decisão fica registrada e vale até o fim da missão.</p>}
        />
      ) : null}
    </section>
  );
}
