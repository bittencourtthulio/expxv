// Liga o controlador do passeio ao store do bichinho: preferências (passear, travessuras, minutos, mostrar, silenciar) e as visões (trabalho).
import type { StoreBichinho } from "../estado";
import type { ControlePasseio } from "./controle";

export function ligarStore(controle: ControlePasseio, store: StoreBichinho): () => void {
  let ultimoPrefs = "";
  let ultimasVisoes: unknown = null;
  const aplicar = (): void => {
    const e = store.obter();
    const chave = [e.passear, e.travessuras, e.ociosidadeMin, e.mostrar && e.disponivel, e.silenciar].join("|");
    if (chave !== ultimoPrefs) {
      ultimoPrefs = chave;
      controle.definirPreferencias({ ligado: e.passear, travessuras: e.travessuras, minutos: e.ociosidadeMin, mostrar: e.mostrar && e.disponivel, silenciar: e.silenciar });
    }
    if (e.visoes !== ultimasVisoes) { ultimasVisoes = e.visoes; controle.definirVisoes(e.visoes); }
  };
  aplicar();
  return store.assinar(aplicar);
}
