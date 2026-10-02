// Consentimento por (serviço, host) (Fase 11, T-11.02/D-64). Todo serviço remoto nasce DESLIGADO; só um registro vigente com a versão atual do texto autoriza abrir socket.
// Mudar a URL para outro host invalida o consentimento anterior; revogar derruba o uso na hora. Puro: a persistência é uma porta.
export interface RegistroConsentimento {
  servico: string;
  host: string;
  concedido_em: string;
  versao_texto: string;
  revogado_em: string | null;
}

export interface ArmazenamentoConsentimento {
  ler(): readonly RegistroConsentimento[];
  gravar(registros: readonly RegistroConsentimento[]): Promise<void>;
}

export interface Consentimentos {
  /** há consentimento vigente (não revogado, na versão atual do texto) para este serviço neste host? */
  vigente(servico: string, host: string): boolean;
  conceder(servico: string, host: string): Promise<void>;
  revogar(servico: string, host: string): Promise<void>;
  listar(): readonly RegistroConsentimento[];
}

export function criarConsentimentos(op: { armazenamento: ArmazenamentoConsentimento; versao_texto: string; agora?: () => Date }): Consentimentos {
  const agora = op.agora ?? ((): Date => new Date());
  const chave = (s: string, h: string): string => `${s}\u0000${h.toLowerCase()}`;
  const todos = (): RegistroConsentimento[] => [...op.armazenamento.ler()];
  return {
    vigente(servico, host) {
      const r = todos().find((x) => chave(x.servico, x.host) === chave(servico, host));
      return r !== undefined && r.revogado_em === null && r.versao_texto === op.versao_texto;
    },
    async conceder(servico, host) {
      const h = host.toLowerCase();
      const resto = todos().filter((x) => chave(x.servico, x.host) !== chave(servico, h));
      resto.push({ servico, host: h, concedido_em: agora().toISOString(), versao_texto: op.versao_texto, revogado_em: null });
      await op.armazenamento.gravar(resto);
    },
    async revogar(servico, host) {
      const lista = todos().map((x) => (chave(x.servico, x.host) === chave(servico, host) && x.revogado_em === null ? { ...x, revogado_em: agora().toISOString() } : x));
      await op.armazenamento.gravar(lista);
    },
    listar: () => todos(),
  };
}

export type ResultadoUrl = { ok: true; host: string; hostname: string; porta: number | null; caminho: string; loopback: boolean; url: string } | { ok: false; motivo: string };

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * `https:` sempre (a camada de rede do app, `nucleo/rede`, também recusa IP literal, localhost e rede privada: servidor local do usuário entra como motor de COMANDO local).
 * `permitirLoopbackHttp` existe só para servidores falsos de teste. Sem credenciais embutidas, sem query nem fragmento.
 */
export function validarUrlDeServico(bruta: string, op: { permitirLoopbackHttp?: boolean } = {}): ResultadoUrl {
  let u: URL;
  try { u = new URL(bruta); } catch { return { ok: false, motivo: "URL inválida." }; }
  if (u.username !== "" || u.password !== "") return { ok: false, motivo: "A URL não pode conter usuário nem senha." };
  if (u.search !== "" || u.hash !== "") return { ok: false, motivo: "A URL não pode ter query nem fragmento." };
  const loopback = LOOPBACK.has(u.hostname);
  const caminho = u.pathname.replace(/\/+$/, "");
  const porta = u.port === "" ? null : Number(u.port);
  const pronto = (): ResultadoUrl => ({ ok: true, host: u.host.toLowerCase(), hostname: u.hostname.toLowerCase(), porta, caminho, loopback, url: `${u.protocol}//${u.host.toLowerCase()}${caminho}` });
  if (u.protocol === "https:" && !loopback) return pronto();
  if (op.permitirLoopbackHttp === true && loopback && (u.protocol === "http:" || u.protocol === "https:")) return pronto();
  return { ok: false, motivo: loopback ? "Servidor local não é aceito aqui: use o motor de comando local." : "Use uma URL https:// com nome de host (IP e rede privada não são aceitos)." };
}
