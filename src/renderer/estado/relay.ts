// Estado do relay no renderer (Fase 22): leitura barata (o main responde «desligado» sem carregar o núcleo) + evento coalescido. Nada em localStorage.
import { useCallback, useEffect, useState } from "react";
import type { ApiRelay, EstadoRelay } from "../../compartilhado/relay";

export function useEstadoRelay(api: ApiRelay | undefined): { estado: EstadoRelay | null; erro: string | null; recarregar: () => Promise<void> } {
  const [estado, setEstado] = useState<EstadoRelay | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const recarregar = useCallback(async () => {
    if (api === undefined) return;
    try {
      setEstado(await api.estado());
      setErro(null);
    } catch {
      setErro("Não foi possível ler o estado do relay.");
    }
  }, [api]);
  useEffect(() => {
    void recarregar();
    if (api === undefined) return undefined;
    return api.assinar((e) => setEstado(e));
  }, [api, recarregar]);
  return { estado, erro, recarregar };
}
