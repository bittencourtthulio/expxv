import type { ApiAde } from "../../compartilhado/ipc";
import { pedirPaleta, pedirTela } from "./navegacao";

export interface DepsMenu {
  api: () => ApiAde["menu"] | undefined;
  abrirProjeto: () => void;
  alternarTema: () => void;
}

/**
 * ÚNICO assinante do evento `app:menu` (menu nativo e bandeja): executa a ação pedida.
 * abrir-projeto → diálogo de pasta; paleta → abre a paleta; tema → alterna claro/escuro; sobre → Configurações.
 * Devolve o cancelamento (sem ponte, nada a fazer).
 */
export function ligarMenuNativo(d: DepsMenu): () => void {
  const api = d.api();
  if (api === undefined) return () => undefined;
  return api.assinar(({ acao }) => {
    switch (acao) {
      case "abrir-projeto": d.abrirProjeto(); break;
      case "paleta": pedirPaleta(); break;
      case "tema": d.alternarTema(); break;
      case "sobre": pedirTela("config"); break;
    }
  });
}
