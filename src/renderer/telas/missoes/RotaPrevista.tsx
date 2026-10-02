import { useEffect, useState } from "react";
import type { Papel } from "../../../compartilhado/dominio";
import type { ResultadoDeRota } from "../../../compartilhado/harness";
import type { ApiAde } from "../../../compartilhado/ipc";
import { CLI_AUTOMATICA, perfilAutomatico, resumirRota, textoErroRota } from "./automatico";
import { ROTULO_PAPEL } from "./rotulos";

type Estado = { s: "carregando" } | { s: "ok"; rota: ResultadoDeRota } | { s: "erro"; texto: string };

/** Prévia local da rota do papel "Automático" (sem texto do pedido; nada sai da máquina). O recibo definitivo aparece no Pane. */
export function RotaPrevista({ papel, workspaceId, api }: { papel: Papel; workspaceId: string; api: ApiAde["harness"] | undefined }) {
  const [estado, setEstado] = useState<Estado>({ s: "carregando" });
  useEffect(() => {
    let vivo = true;
    setEstado({ s: "carregando" });
    if (api?.resolverPerfil === undefined) { setEstado({ s: "erro", texto: textoErroRota(new Error("No handler registered")) }); return undefined; }
    Promise.resolve().then(() => api.resolverPerfil({ perfil: perfilAutomatico(), ctx: { workspace_id: workspaceId, papel, mission_id: null } })).then(
      (rota) => { if (vivo) setEstado({ s: "ok", rota }); },
      (e) => { if (vivo) setEstado({ s: "erro", texto: textoErroRota(e) }); },
    );
    return () => { vivo = false; };
  }, [api, workspaceId, papel]);
  const rotulo = `Rota prevista: ${ROTULO_PAPEL[papel]}`;
  return (
    <div className="mis-squad-resumo" role="note" aria-label={rotulo} data-cli={CLI_AUTOMATICA}>
      {estado.s === "carregando" ? <span aria-busy="true">Calculando a rota prevista…</span>
        : estado.s === "erro" ? <span>{estado.texto}</span>
        : (
          <>
            <strong>Rota prevista:</strong> {resumirRota(estado.rota)}
            {estado.rota.recibo !== "" ? <><br /><span>Recibo: {estado.rota.recibo}</span></> : null}
            {estado.rota.avisos.length > 0 ? <><br /><span>Avisos: {estado.rota.avisos.join("; ")}</span></> : null}
            <br /><small>Prévia pela política atual; o tipo de tarefa final sai do pedido e o recibo definitivo aparece no Pane.</small>
          </>
        )}
    </div>
  );
}
