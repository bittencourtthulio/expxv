// `PortaCofreRag` sobre o cofre do SO (`nucleo/cofre`): segredos do backend online com nomes `RAG_<PROVEDOR>_<CAMPO>`. O valor só sai por
// `obter` (código do main; nunca devolvido ao renderer). Recusa guardar quando o cofre não é seguro (ex.: `basic_text` no Linux).
import type { EntradaCofre, EstadoCofre, PedidoGravarCofre } from "../../../compartilhado/harness";
import { nomeSegredo, type PortaCofreRag } from "./config";

/** Subconjunto do `Cofre` do núcleo usado aqui (facilita o cofre falso nos testes). */
export interface CofreParaRag {
  estado(): Promise<EstadoCofre>;
  guardar(pedido: PedidoGravarCofre): Promise<EntradaCofre>;
  existe(nome: string): Promise<boolean>;
  obter(nome: string): Promise<string>;
  listar(): Promise<EntradaCofre[]>;
  apagar(id: string): Promise<boolean>;
}

export class CofreRagIndisponivelErro extends Error {
  override name = "CofreRagIndisponivelErro";
}

export interface OpcoesCofreRag {
  /** backend do `safeStorage` (`basic_text`, `gnome_libsecret`…); `null` fora do Linux. */
  backendSafeStorage?: () => string | null;
  plataforma?: NodeJS.Platform;
}

const NOME_RAG = /^RAG_[A-Z0-9_]{1,59}$/;

export function nomeSecretoValido(nome: string): boolean {
  return NOME_RAG.test(nome);
}

/** Nome do campo (minúsculo) a partir do nome no cofre: `RAG_QDRANT_API_KEY` → `api_key`. */
export function campoDoSegredo(provedor: string, nome: string): string | null {
  const prefixo = `${nomeSegredo(provedor, "x").slice(0, -1)}`;
  return nome.startsWith(prefixo) && nome.length > prefixo.length ? nome.slice(prefixo.length).toLowerCase() : null;
}

export function criarCofreRag(origem: CofreParaRag | (() => Promise<CofreParaRag>), op: OpcoesCofreRag = {}): PortaCofreRag {
  const cofre = async (): Promise<CofreParaRag> => (typeof origem === "function" ? origem() : origem);
  const exigirNome = (nome: string): void => {
    if (!nomeSecretoValido(nome)) throw new CofreRagIndisponivelErro("nome de segredo do RAG inválido");
  };
  return {
    async guardar(nome, valor) {
      exigirNome(nome);
      if ((op.plataforma ?? process.platform) === "linux" && op.backendSafeStorage?.() === "basic_text") {
        throw new CofreRagIndisponivelErro("O sistema não tem chaveiro seguro (backend basic_text): instale o libsecret/KWallet. As credenciais do RAG online não são guardadas assim.");
      }
      const c = await cofre();
      const e = await c.estado();
      if (!e.ok) throw new CofreRagIndisponivelErro(e.motivo ?? "O cofre do sistema não está disponível; as credenciais do RAG online não foram guardadas.");
      if (e.bloqueado) throw new CofreRagIndisponivelErro("O cofre está bloqueado: desbloqueie com a senha-mestra.");
      await c.guardar({ id: null, nome, escopo: "global", workspace_id: null, sensivel: true, valor });
    },
    async existe(nome) {
      exigirNome(nome);
      return (await cofre()).existe(nome);
    },
    async apagar(nome) {
      exigirNome(nome);
      const c = await cofre();
      const e = (await c.listar()).find((x) => x.nome === nome && x.escopo === "global");
      if (e !== undefined) await c.apagar(e.id);
    },
    async obter(nome) {
      exigirNome(nome);
      const c = await cofre();
      if (!(await c.existe(nome))) return null;
      return c.obter(nome);
    },
  };
}

/** SÓ MAIN: lê do cofre os segredos citados (`id_segredos` da config) e devolve `campo → valor` para a fábrica. */
export async function lerSegredosRag(porta: PortaCofreRag, provedor: string, ids: readonly string[]): Promise<Record<string, string>> {
  const saida: Record<string, string> = {};
  for (const id of ids) {
    const campo = campoDoSegredo(provedor, id);
    if (campo === null) continue;
    const v = await porta.obter(id);
    if (v !== null) saida[campo] = v;
  }
  return saida;
}
