// Figura = sprite + os atributos que ligam as animações (quieto, pausado, espiar). Quem a usa só passa a visão do main.
import type { ReactNode } from "react";
import type { BichinhoVisao } from "../../compartilhado/bichinho";
import { BichinhoSprite } from "./Sprite";
import { useEspiar, useJanelaOculta } from "./hooks";
import { nivelDaVisao, rotuloDoBichinho } from "./util";

export interface PropsFigura {
  visao: BichinhoVisao;
  nomeProjeto: string | null;
  cabeca?: boolean;
  /** o estágio subiu há instantes: comemoração única. */
  subiu?: boolean;
  silenciar?: boolean;
  /** `false` quando o rótulo já está no botão que contém a figura (evita leitura dupla). */
  rotulado?: boolean;
  /** o bichinho acabou de nascer: animação única da casca (D-671). */
  nasceu?: boolean;
}

export function Figura({ visao, nomeProjeto, cabeca = false, subiu = false, silenciar = false, rotulado = true, nasceu = false }: PropsFigura): ReactNode {
  const oculta = useJanelaOculta();
  const espiando = useEspiar(visao.humor === "ocioso" && !oculta && !silenciar);
  return (
    <span className="bi-wrap" data-quieto={silenciar || undefined} data-pausado={oculta || undefined} data-espiar={espiando || undefined}>
      <BichinhoSprite
        especie={visao.especie}
        estagio={visao.estagio}
        humor={visao.humor}
        doente={visao.doente}
        cabeca={cabeca}
        maturidade={visao.maturidade}
        subiu={subiu}
        nivel={nivelDaVisao(visao)}
        {...(visao.variante === undefined ? {} : { variante: visao.variante })}
        {...(visao.ovo?.progresso === undefined ? {} : { progressoOvo: visao.ovo.progresso })}
        nasceu={nasceu}
        {...(rotulado ? { rotulo: rotuloDoBichinho(visao, nomeProjeto) } : {})}
      />
    </span>
  );
}
