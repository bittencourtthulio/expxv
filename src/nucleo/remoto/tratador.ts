// Tratador de protocolo INDEPENDENTE DE TRANSPORTE (T-22.04, D-359). Extraído do servidor LAN da Fase 13 sem mudar a semântica: as rotas (pareamento, sessão, canal) e a tradução da mensagem
// decifrada em chamadas ao Jarvis continuam as mesmas; só deixaram de depender do servidor HTTP. LAN, loopback e relay entregam a MESMA requisição; `origem: "relay"` NÃO afrouxa nenhuma
// checagem (taxa por dispositivo, permissão, conferência a cada requisição, revogação ficam nas rotas). Este módulo não importa nenhum módulo de rede do Node (só tipos).
import type { ServicoJarvis } from "../jarvis/servico";
import type { Dispositivo } from "./dispositivos";
import type { RespostaRota, RotasRemoto } from "./servidor";

export type OrigemTratador = "lan" | "loopback" | "relay";
export type RotaTratador = "pareamento_inicio" | "pareamento_fim" | "pareamento_status" | "sessao_inicio" | "canal";
export interface RequisicaoTratador {
  rota: RotaTratador;
  corpo: unknown;
  origem: OrigemTratador;
  /** IP de origem observado pelo servidor (LAN/loopback). Pelo relay o IP do celular é desconhecido: vale sempre "relay". */
  ip?: string;
  /** só informativo (o dispositivo de verdade é o da sessão cifrada). */
  dispositivo?: string;
}
export interface Tratador {
  tratar(req: RequisicaoTratador): Promise<RespostaRota>;
}

const ORIGENS: readonly string[] = ["lan", "loopback", "relay"];
const NAO_ENCONTRADO: RespostaRota = { status: 404, corpo: { e: "nao_encontrado" } };
const FALHOU: RespostaRota = { status: 500, corpo: { e: "falhou" } };

export function criarTratador(rotas: RotasRemoto): Tratador {
  return {
    async tratar(req) {
      if (!ORIGENS.includes(req.origem)) return NAO_ENCONTRADO;
      const ctx = { ip: req.origem === "relay" ? "relay" : (req.ip ?? "") };
      try {
        switch (req.rota) {
          case "pareamento_inicio":
            return rotas.pareamentoInicio(req.corpo, ctx);
          case "pareamento_fim":
            return rotas.pareamentoFim(req.corpo, ctx);
          case "pareamento_status":
            return rotas.pareamentoStatus(req.corpo, ctx);
          case "sessao_inicio":
            return rotas.sessaoInicio(req.corpo, ctx);
          case "canal":
            return await rotas.canal(req.corpo, ctx);
          default:
            return NAO_ENCONTRADO;
        }
      } catch {
        return FALHOU;
      }
    },
  };
}

export type PortaJarvis = Pick<ServicoJarvis, "executarAcao" | "processarTexto" | "confirmacao" | "resolucao">;

/** Mensagem JÁ decifrada do dispositivo -> resposta. Texto é sempre DADO (vai ao interpretador da Fase 13), nunca comando direto; lista fechada de tipos. */
export async function tratarMensagem(jarvis: PortaJarvis, disp: Pick<Dispositivo, "id" | "nome" | "permissao">, msg: unknown): Promise<unknown> {
  if (typeof msg !== "object" || msg === null) return { t: "erro", e: "quadro_invalido" };
  const m = msg as Record<string, unknown>;
  const ent = { ator: "remoto" as const, permissao: disp.permissao, dispositivo: { id: disp.id, nome: disp.nome } };
  const origem = disp.permissao === "mensagem_direta" ? ("remoto_direto" as const) : ("remoto_confirmado" as const);
  const rid = typeof m["client_request_id"] === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(m["client_request_id"]) ? m["client_request_id"] : null;
  switch (m["t"]) {
    case "ping":
      return { t: "pong" };
    case "estado": {
      const [status, paineis, missoes] = await Promise.all((["status", "listar_paineis", "listar_missoes"] as const).map((acao) => jarvis.executarAcao({ ...ent, origem, acao: { acao } })));
      return { t: "estado", status, paineis, missoes, permissao: disp.permissao };
    }
    case "comando": {
      if (typeof m["texto"] === "string") return { t: "resultado", resultado: await jarvis.processarTexto({ ...ent, origem, texto: m["texto"].slice(0, 4000), client_request_id: rid }) };
      if (typeof m["acao"] === "object" && m["acao"] !== null) return { t: "resultado", resultado: await jarvis.executarAcao({ ...ent, origem, acao: m["acao"], client_request_id: rid }) };
      return { t: "erro", e: "quadro_invalido" };
    }
    case "pedido_status": {
      const id = m["confirmacao_id"];
      if (typeof id !== "string") return { t: "erro", e: "quadro_invalido" };
      const c = jarvis.confirmacao(id);
      // só o DONO do pedido vê o estado dele
      if (c !== null && c.dispositivo_id === disp.id) return { t: "pedido_status", estado: "pendente", expira_em: c.expira_em };
      const r = jarvis.resolucao(id);
      return { t: "pedido_status", estado: r?.estado ?? "desconhecido", texto: r?.texto ?? "" };
    }
    default:
      return { t: "erro", e: "quadro_invalido" };
  }
}
