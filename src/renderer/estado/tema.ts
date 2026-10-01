import { useSyncExternalStore } from "react";
import type { TemaEfetivo, TemaPreferencia } from "../../compartilhado/ipc";
import { ponte, type PonteApp } from "../ponte";

export interface EstadoTema {
  preferencia: TemaPreferencia;
  efetivo: TemaEfetivo;
}

interface Deps {
  api: Pick<PonteApp, "tema"> | undefined;
  prefereEscuro: () => boolean;
  raiz: HTMLElement;
}

/** Store mínimo de tema (sem biblioteca). Usa o main quando existe; senão prefers-color-scheme. */
export function criarStoreTema({ api, prefereEscuro, raiz }: Deps) {
  const sistema = (): TemaEfetivo => (prefereEscuro() ? "escuro" : "claro");
  let estado: EstadoTema = { preferencia: "sistema", efetivo: sistema() };
  const ouvintes = new Set<() => void>();

  const aplicar = (novo: EstadoTema) => {
    if (novo.efetivo === estado.efetivo && novo.preferencia === estado.preferencia) {
      raiz.dataset.theme = novo.efetivo;
      return;
    }
    estado = novo;
    raiz.dataset.theme = novo.efetivo;
    ouvintes.forEach((o) => o());
  };

  return {
    obter: () => estado,
    assinar(ouvinte: () => void) {
      ouvintes.add(ouvinte);
      return () => void ouvintes.delete(ouvinte);
    },
    iniciar() {
      raiz.dataset.theme = estado.efetivo;
      if (!api) return;
      api.tema.assinar((e) => aplicar({ preferencia: e.preferencia, efetivo: e.efetivo }));
      api.tema.ler().then((e) => aplicar({ preferencia: e.preferencia, efetivo: e.efetivo })).catch(() => {});
    },
    async definir(preferencia: TemaPreferencia) {
      if (api) {
        const r = await api.tema.definir(preferencia);
        aplicar({ preferencia: r.preferencia, efetivo: r.efetivo });
      } else {
        aplicar({ preferencia, efetivo: preferencia === "sistema" ? sistema() : preferencia });
      }
    },
    alternar() {
      return this.definir(estado.efetivo === "escuro" ? "claro" : "escuro");
    },
  };
}

export const storeTema = criarStoreTema({
  api: ponte(),
  prefereEscuro: () => (typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)").matches : true),
  raiz: document.documentElement,
});

export function useTema(): EstadoTema & { alternar: () => Promise<void> } {
  const estado = useSyncExternalStore(storeTema.assinar, storeTema.obter);
  return { ...estado, alternar: storeTema.alternar.bind(storeTema) };
}
