// Carga assíncrona com estados explícitos para as telas novas: carregando | ok | indisponivel (canal ausente) | erro.
import { useCallback, useEffect, useRef, useState } from "react";

export type EstadoCarga<T> =
  | { estado: "carregando"; dados: T | null }
  | { estado: "ok"; dados: T }
  | { estado: "indisponivel"; dados: null }
  | { estado: "erro"; dados: T | null; mensagem: string };

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** Erros "canal não registrado" do IPC viram "indisponível" (canal pedido ao dono do main), não erro. */
export const ehCanalAusente = (e: unknown): boolean => /no handler|não registrad|unknown channel|canal.*(inexistente|desconhecido)|not a function/i.test(msg(e));

/** `carregar` indefinido = canal ausente no preload (indisponível). Refaz quando `chave` muda; `recarregar()` força. */
export function useCarga<T>(carregar: (() => Promise<T>) | undefined, chave: string): EstadoCarga<T> & { recarregar: () => void } {
  const [s, setS] = useState<EstadoCarga<T>>(carregar === undefined ? { estado: "indisponivel", dados: null } : { estado: "carregando", dados: null });
  const [n, setN] = useState(0);
  const ref = useRef(carregar);
  ref.current = carregar;
  useEffect(() => {
    const fn = ref.current;
    if (fn === undefined) { setS({ estado: "indisponivel", dados: null }); return; }
    let vivo = true;
    setS((a) => ({ estado: "carregando", dados: a.dados as T | null }));
    Promise.resolve().then(fn).then(
      (d) => { if (vivo) setS({ estado: "ok", dados: d }); },
      (e) => { if (vivo) setS(ehCanalAusente(e) ? { estado: "indisponivel", dados: null } : { estado: "erro", dados: null, mensagem: msg(e) }); },
    );
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, n, carregar === undefined]);
  const recarregar = useCallback(() => setN((x) => x + 1), []);
  return { ...s, recarregar };
}
