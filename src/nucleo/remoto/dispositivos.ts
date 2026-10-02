// Armazém de dispositivos (T-13.14): só a CHAVE PÚBLICA do dispositivo (nenhum segredo dele no servidor). Criado só com SAS confirmado no desktop, permissão `leitura` por
// padrão, permissão só sobe por ação do desktop (`mensagem_direta` exige digitar `PERMITIR`), validade deslizante, revogação imediata. Cache em memória: consulta quente < 1 ms.
import { randomBytes } from "node:crypto";
import { PERMISSOES_REMOTAS, type PermissaoRemota } from "../../compartilhado/jarvis";
import type { Banco } from "../banco/banco";
import type { RelogioRemoto } from "./protocolo";

export const CONFIRMACAO_DIRETA = "PERMITIR";

export interface Dispositivo {
  id: string;
  nome: string;
  chave_publica: Buffer;
  permissao: PermissaoRemota;
  criado_em: string;
  ultimo_uso_em: string | null;
  ultimo_ip: string | null;
  expira_em: string;
  revogado_em: string | null;
}
interface Linha {
  id: string;
  nome: string;
  chave_publica: string;
  permissao: PermissaoRemota;
  criado_em: string;
  ultimo_uso_em: string | null;
  ultimo_ip: string | null;
  expira_em: string;
  revogado_em: string | null;
}
const deLinha = (l: Linha): Dispositivo => ({ ...l, chave_publica: Buffer.from(l.chave_publica, "base64") });

export interface ArmazemDispositivos {
  criar(d: { nome: string; chave_publica: Buffer; ip: string | null }): Dispositivo;
  /** `null` se desconhecido, revogado ou expirado: NUNCA autentica. */
  ativo(id: string): Dispositivo | null;
  listar(): Dispositivo[];
  revogar(id: string): boolean;
  revogarTodos(): number;
  /** subir para `mensagem_direta` exige a palavra `PERMITIR`; baixar é sempre livre. Só o desktop chama (IPC). */
  definirPermissao(id: string, permissao: PermissaoRemota, confirmacao: string | null): Dispositivo | null;
  /** uso autêntico: atualiza último uso/IP e estende a validade (deslizante). */
  tocar(id: string, ip: string | null): void;
  /** registra quem precisa saber da revogação (derrubar canal, cancelar pendências). */
  aoRevogar(cb: (id: string) => void): void;
}

export function criarArmazemDispositivos(d: { banco: Banco; relogio: RelogioRemoto; validade_dias: () => number; bytes?: (n: number) => Buffer; aoRevogar?: (id: string) => void }): ArmazemDispositivos {
  const cache = new Map<string, Dispositivo>();
  let carregado = false;
  const ler = (): void => {
    if (carregado) return;
    for (const l of d.banco.consultar<Linha>("SELECT * FROM remoto_dispositivo")) cache.set(l.id, deLinha(l));
    carregado = true;
  };
  const iso = (t = d.relogio.agora()): string => new Date(t).toISOString();
  const salvar = (x: Dispositivo): void => {
    d.banco.executar("UPDATE remoto_dispositivo SET nome=?, permissao=?, ultimo_uso_em=?, ultimo_ip=?, expira_em=?, revogado_em=? WHERE id=?", [x.nome, x.permissao, x.ultimo_uso_em, x.ultimo_ip, x.expira_em, x.revogado_em, x.id]);
  };
  const ultimaEscrita = new Map<string, number>();
  const ouvintes: Array<(id: string) => void> = d.aoRevogar === undefined ? [] : [d.aoRevogar];
  const avisar = (id: string): void => ouvintes.forEach((f) => f(id));

  return {
    criar(n) {
      ler();
      const x: Dispositivo = {
        id: `dev_${(d.bytes ?? randomBytes)(12).toString("base64url")}`,
        nome: n.nome.slice(0, 40),
        chave_publica: n.chave_publica,
        permissao: "leitura",
        criado_em: iso(),
        ultimo_uso_em: null,
        ultimo_ip: n.ip,
        expira_em: iso(d.relogio.agora() + d.validade_dias() * 86_400_000),
        revogado_em: null,
      };
      d.banco.executar("INSERT INTO remoto_dispositivo (id,nome,chave_publica,permissao,criado_em,ultimo_uso_em,ultimo_ip,expira_em,revogado_em) VALUES (?,?,?,?,?,?,?,?,NULL)", [x.id, x.nome, x.chave_publica.toString("base64"), x.permissao, x.criado_em, null, x.ultimo_ip, x.expira_em]);
      cache.set(x.id, x);
      return x;
    },
    ativo(id) {
      ler();
      const x = cache.get(id);
      if (x === undefined || x.revogado_em !== null || Date.parse(x.expira_em) <= d.relogio.agora()) return null;
      return x;
    },
    listar() {
      ler();
      return [...cache.values()].sort((a, b) => b.criado_em.localeCompare(a.criado_em));
    },
    revogar(id) {
      ler();
      const x = cache.get(id);
      if (x === undefined || x.revogado_em !== null) return false;
      x.revogado_em = iso();
      salvar(x);
      avisar(id);
      return true;
    },
    revogarTodos() {
      ler();
      let n = 0;
      for (const x of cache.values()) {
        if (x.revogado_em === null) {
          x.revogado_em = iso();
          salvar(x);
          avisar(x.id);
          n++;
        }
      }
      return n;
    },
    definirPermissao(id, permissao, confirmacao) {
      ler();
      const x = cache.get(id);
      if (x === undefined || x.revogado_em !== null || !(PERMISSOES_REMOTAS as readonly string[]).includes(permissao)) return null;
      const sobe = PERMISSOES_REMOTAS.indexOf(permissao) > PERMISSOES_REMOTAS.indexOf(x.permissao);
      if (sobe && permissao === "mensagem_direta" && confirmacao !== CONFIRMACAO_DIRETA) return null;
      x.permissao = permissao;
      salvar(x);
      return x;
    },
    aoRevogar: (cb) => void ouvintes.push(cb),
    tocar(id, ip) {
      ler();
      const x = cache.get(id);
      if (x === undefined || x.revogado_em !== null) return;
      const t = d.relogio.agora();
      x.ultimo_uso_em = iso(t);
      x.ultimo_ip = ip;
      // validade deslizante, e no máximo uma escrita por 30 s por dispositivo (a consulta quente nunca toca o disco)
      x.expira_em = iso(t + d.validade_dias() * 86_400_000);
      if (t - (ultimaEscrita.get(id) ?? 0) >= 30_000) {
        ultimaEscrita.set(id, t);
        salvar(x);
      }
    },
  };
}
