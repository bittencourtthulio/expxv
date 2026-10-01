import { variavelDeAmbiente } from "../nucleo/produto";

/** Modo smoke: o app abre a janela, espera `ready-to-show` e sai com código 0 (verificação do pacote). */
export function smokeAtivo(env: Record<string, string | undefined>): boolean {
  return env[variavelDeAmbiente("SMOKE")] === "1";
}
