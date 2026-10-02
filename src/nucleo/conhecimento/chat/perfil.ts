// Perfil do chat (T-15.31): `PerfilChat` padrão derivado das CLIs detectadas e roteamento por consumo via PORTA (o main liga o
// `resolverPerfil` da Fase 9). Sem rota (cota esgotada, sem CLI): `null` → modo busca. Nunca chave de API própria.
import type { CliChat, FaixaChat, PerfilChat } from "./tipos";

export interface EstadoCli {
  cli: CliChat;
  disponivel: boolean;
  motivo?: string;
}

const PREFERENCIA: readonly CliChat[] = ["claude", "codex", "opencode", "gemini"];

export function perfilPadrao(clis: readonly EstadoCli[], faixa: FaixaChat = "medio"): PerfilChat | null {
  for (const c of PREFERENCIA) {
    const e = clis.find((x) => x.cli === c && x.disponivel);
    if (e) return { cli: c, modelo: null, esforco: null, faixa };
  }
  return null;
}

/** Porta do roteamento por consumo: devolve o perfil efetivo (outra conta/modelo) ou `null` quando não há rota. */
export type PortaRoteamento = (perfil: PerfilChat) => Promise<PerfilChat | null>;

export async function resolverPerfilChat(perfil: PerfilChat | null, rota: PortaRoteamento | null): Promise<PerfilChat | null> {
  if (perfil === null) return null;
  if (rota === null) return perfil;
  try {
    return await rota(perfil);
  } catch {
    return null;
  }
}
