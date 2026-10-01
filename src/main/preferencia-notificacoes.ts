// Liga/desliga das notificações nativas, guardado na preferência `notificacoes` de preferencias.ts
// (booleano, o mesmo da tela de Configurações; "desligado" legado ainda é lido; ausente = ligado). Só o booleano: nada de conteúdo de sessão aqui.
//
// Como ligar em main.ts:
//   const notif = criarPreferenciaNotificacoes(preferencias);
//   criarNotificador({ ..., ativo: notif.ativo });
//   criarTray({ ..., notificacoes: notif });
import type { Preferencias } from "./preferencias";

export const CHAVE_NOTIFICACOES = "notificacoes";

export interface PreferenciaNotificacoes {
  /** notificações ligadas? (lê a cada chamada: a bandeja e as Configurações mudam o valor em voo). */
  ativo(): boolean;
  definir(ligado: boolean): Promise<void>;
  /** inverte e devolve o novo estado. */
  alternar(): Promise<boolean>;
}

export function criarPreferenciaNotificacoes(prefs: Pick<Preferencias, "obter" | "definir">): PreferenciaNotificacoes {
  const ativo = (): boolean => {
    const v = prefs.obter(CHAVE_NOTIFICACOES);
    return !(v === "desligado" || v === false);
  };
  const definir = (ligado: boolean): Promise<void> => prefs.definir(CHAVE_NOTIFICACOES, ligado);
  return {
    ativo,
    definir,
    async alternar() {
      const novo = !ativo();
      await definir(novo);
      return novo;
    },
  };
}
