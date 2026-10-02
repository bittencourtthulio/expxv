// Máquina do ditado (Fase 11, T-11.09): pura, relógio injetado. ocioso -> gravando -> transcrevendo -> injetando -> ocioso; `cancelar` vale em qualquer estado; erro volta a ocioso em 3 s.
// Uma fala por vez: pedir para falar durante `transcrevendo` é RECUSADO (toast), nunca enfileirado. Alternar tem debounce de 300 ms e nunca desliga sozinho.
import type { CodigoErroVoz, DisparoVoz, EstadoDitado } from "../../compartilhado/captura";

export const DEBOUNCE_ALTERNAR_MS = 300;
export const ERRO_VOLTA_A_OCIOSO_MS = 3_000;

export type EventoDitado =
  | { tipo: "iniciar"; disparo: DisparoVoz }
  | { tipo: "soltar" }
  /** a pessoa pediu para encerrar a fala (botão/atalho do app): vale em qualquer disparo, sem debounce. */
  | { tipo: "parar" }
  | { tipo: "alternar" }
  | { tipo: "cancelar" }
  | { tipo: "transcrito" }
  | { tipo: "injetado" }
  | { tipo: "falha"; codigo: CodigoErroVoz }
  | { tipo: "tempo" };

export type AcaoDitado = "abrir_microfone" | "finalizar_fala" | "cancelar_tudo" | "injetar" | "mostrar_erro" | "recusar_ocupado" | "nenhuma";

export interface MaquinaDitado {
  readonly estado: EstadoDitado;
  readonly disparo: DisparoVoz | null;
  readonly codigoErro: CodigoErroVoz | null;
  transitar(e: EventoDitado): { estado: EstadoDitado; acao: AcaoDitado };
}

export function criarMaquinaDitado(agora: () => number): MaquinaDitado {
  let estado: EstadoDitado = "ocioso";
  let disparo: DisparoVoz | null = null;
  let inicio = 0;
  let desde = 0;
  let codigo: CodigoErroVoz | null = null;

  const ir = (e: EstadoDitado, acao: AcaoDitado): { estado: EstadoDitado; acao: AcaoDitado } => {
    estado = e;
    desde = agora();
    return { estado, acao };
  };
  const iniciar = (d: DisparoVoz): { estado: EstadoDitado; acao: AcaoDitado } => {
    disparo = d;
    codigo = null;
    inicio = agora();
    return ir("gravando", "abrir_microfone");
  };
  const nada = (): { estado: EstadoDitado; acao: AcaoDitado } => ({ estado, acao: "nenhuma" });

  return {
    get estado() { return estado; },
    get disparo() { return disparo; },
    get codigoErro() { return codigo; },
    transitar(e) {
      switch (e.tipo) {
        case "cancelar":
          if (estado === "ocioso") return nada();
          disparo = null;
          codigo = null;
          return ir("ocioso", "cancelar_tudo");
        case "iniciar":
          if (estado === "ocioso" || estado === "erro") return iniciar(e.disparo);
          return { estado, acao: "recusar_ocupado" };
        case "alternar":
          if (estado === "ocioso" || estado === "erro") return iniciar("alternar");
          if (estado === "gravando") {
            if (disparo !== "alternar") return nada();
            if (agora() - inicio < DEBOUNCE_ALTERNAR_MS) return nada(); // segundo toque dentro do debounce
            return ir("transcrevendo", "finalizar_fala");
          }
          return { estado, acao: "recusar_ocupado" };
        case "soltar":
          if (estado === "gravando" && disparo === "segurar") return ir("transcrevendo", "finalizar_fala");
          return nada();
        case "parar":
          return estado === "gravando" ? ir("transcrevendo", "finalizar_fala") : nada();
        case "transcrito":
          return estado === "transcrevendo" ? ir("injetando", "injetar") : nada();
        case "injetado":
          if (estado !== "injetando") return nada();
          disparo = null;
          return ir("ocioso", "nenhuma");
        case "falha":
          if (estado === "ocioso" || estado === "erro") return nada();
          codigo = e.codigo;
          disparo = null;
          return ir("erro", "mostrar_erro");
        case "tempo":
          if (estado === "erro" && agora() - desde >= ERRO_VOLTA_A_OCIOSO_MS) { codigo = null; return ir("ocioso", "nenhuma"); }
          return nada();
      }
    },
  };
}
