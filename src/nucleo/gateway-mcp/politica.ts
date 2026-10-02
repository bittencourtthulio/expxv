// Filtro de ferramentas do gateway (puro). O TETO de servidores já veio da política de habilitação da Loja (deny-by-default em squad/agentico: workspace,
// Missão e agente só estreitam). Aqui entra o segundo filtro, por ferramenta e por papel: regra explícita (`gateway_filtro`) manda; sem regra, o padrão é
// "livre = tudo do servidor habilitado" e "squad/agentico = só leitura" (escrita e desconhecido exigem decisão explícita da pessoa). Só estreita: nunca
// inclui servidor fora do snapshot.
import type { ModoMissaoGw, PapelGateway, RegraFiltro } from "./tipos";

export interface EntradaFiltro {
  modo: ModoMissaoGw;
  papel: PapelGateway;
  servidor_id: string;
  ferramenta: string;
  risco: "leitura" | "escrita" | "desconhecido";
  regras: ReadonlyMap<string, boolean>;
}

/** Índice `servidor\0ferramenta\0papel → habilitada` para consulta O(1). */
export function indexarRegras(regras: readonly RegraFiltro[]): ReadonlyMap<string, boolean> {
  const m = new Map<string, boolean>();
  for (const r of regras) m.set(chaveRegra(r.servidor_id, r.ferramenta, r.papel), r.habilitada);
  return m;
}
export const chaveRegra = (servidor: string, ferramenta: string, papel: string): string => `${servidor}\u0000${ferramenta}\u0000${papel}`;

export function decidirFerramenta(e: EntradaFiltro): { permitida: boolean; explicita: boolean } {
  const explicita = e.regras.get(chaveRegra(e.servidor_id, e.ferramenta, e.papel));
  if (explicita !== undefined) return { permitida: explicita, explicita: true };
  if (e.modo === "livre") return { permitida: true, explicita: false };
  return { permitida: e.risco === "leitura", explicita: false };
}
