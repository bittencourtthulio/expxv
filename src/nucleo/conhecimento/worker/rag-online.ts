// Backend online do RAG DENTRO do worker (Fase 15, D-90..D-92): prévia, consentimento, migração retomável, verificação, push/pull e apagar
// remoto. O worker não abre socket: toda chamada de rede vai ao MAIN (`rede.rag`), que reconfere o consentimento GRAVADO antes de falar com o
// provedor. Segredos chegam por argumento só enquanto a operação roda (memória; nunca banco, log nem evento) e erros saem sanitizados.
// O consentimento vale só para (provedor, coleção, host, versão da política): mudou o destino, pede de novo (`consentimentoVale`).
import type { ConsentimentoBackend, TipoDocumento } from "../../../compartilhado/conhecimento";
import type { ClienteRede, PedidoRede, RespostaRede } from "../../rede/cliente-http";
import { criarRegistroConsentimento } from "../../rede/consentimento";
import type { ArmazenamentoConhecimento } from "../armazenamento/interface";
import { consentimentoVale, sanitizarErro } from "../backend/config";
import { criarArmazenamentoRag } from "../backend/fabrica";
import { cancelar, consentir, criarPrevia, migrar, pausar, verificar } from "../backend/migracao";
import { empurrar, enfileirarEnvio, podeEnviar, puxar, type EstadoReplicacao } from "../backend/replicacao";
import { criarTransporteRag } from "../backend/transporte";
import { validarUrlBackend } from "../backend/url";
import type { ServicoConhecimento } from "../servico";
import type { ChamarMain } from "./anfitriao";
import type { MetodoRpc } from "./rpc";

export interface ConfigOnline {
  provedor: string;
  url: string;
  colecao_remota: string;
  projeto_id: string;
  equipe_id?: string | undefined;
  tipos: TipoDocumento[];
}
export interface PedidoOnline {
  config: ConfigOnline;
  /** credenciais lidas do cofre pelo main; só em memória, só durante a chamada. */
  segredos: Record<string, string>;
}

export interface RagOnline {
  metodos: Readonly<Record<string, MetodoRpc>>;
  /** gancho do pipeline: chunk novo → fila `rag_saida` quando o modo exige. */
  aoGravar(workspaceId: string, svc: ServicoConhecimento): (colecao_id: string, ids: readonly string[]) => void;
}

const hostDe = (url: string): string => {
  const v = validarUrlBackend(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
  if (!v.ok || v.host === null) throw new Error("URL do backend inválida");
  return v.host;
};

export function criarRagOnline(o: { exigir: (ws: unknown) => ServicoConhecimento; chamarMain: ChamarMain | undefined }): RagOnline {
  const replicacao = new Map<string, EstadoReplicacao>();
  const migracoes = new Map<string, AbortController>();

  /** ClienteRede que delega ao main (único que abre socket). O token local é descartado: o main usa o consentimento gravado. */
  function redeViaMain(ws: string, sinalGeral?: AbortSignal): ClienteRede {
    return {
      async requisitar(p: PedidoRede): Promise<RespostaRede> {
        if (o.chamarMain === undefined) throw new Error("rede indisponível");
        const r = (await o.chamarMain(
          "rede.rag",
          [{ ws, host: p.host, caminho: p.caminho, metodo: p.metodo ?? "GET", ...(p.cabecalhos === undefined ? {} : { cabecalhos: p.cabecalhos }), ...(p.corpo === undefined ? {} : { corpo: typeof p.corpo === "string" ? p.corpo : Buffer.from(p.corpo).toString("utf8") }), ...(p.porta === undefined ? {} : { porta: p.porta }), ...(p.timeout_ms === undefined ? {} : { timeout_ms: p.timeout_ms }), ...(p.max_bytes === undefined ? {} : { max_bytes: p.max_bytes }) }],
          sinalGeral,
        )) as { status: number; cabecalhos: Record<string, string>; corpoB64: string };
        const corpo = Buffer.from(r.corpoB64, "base64");
        return { status: r.status, cabecalhos: r.cabecalhos, corpo, texto: () => corpo.toString("utf8"), json: <T,>() => JSON.parse(corpo.toString("utf8")) as T };
      },
      stream: () => Promise.reject(new Error("stream não suportado no backend online")),
    };
  }

  function armazenamentoDe(ws: string, p: PedidoOnline, sinal?: AbortSignal): ArmazenamentoConhecimento {
    const host = hostDe(p.config.url);
    const transporte = criarTransporteRag({ rede: redeViaMain(ws, sinal), consentimento: criarRegistroConsentimento(), hostsConsentidos: () => [host] });
    return criarArmazenamentoRag({ provedor: p.config.provedor, url: p.config.url, colecao_remota: p.config.colecao_remota, segredos: p.segredos, transporte, projeto_id: p.config.projeto_id, ...(p.config.equipe_id === undefined ? {} : { equipe_id: p.config.equipe_id }), ...(sinal === undefined ? {} : { sinal }) });
  }
  const segredosDe = (p: PedidoOnline): string[] => Object.values(p.segredos);
  const pedidoDe = (svc: ServicoConhecimento, c: ConfigOnline) => ({ colecao_id: svc.colecaoId, projeto_id: c.projeto_id, equipe_id: c.equipe_id, tipos: c.tipos });
  const seguro = <T,>(p: PedidoOnline, f: () => Promise<T>): Promise<T> =>
    f().catch((e: unknown) => {
      throw new Error(sanitizarErro(e instanceof Error ? e.message : "falha", segredosDe(p)));
    });

  const metodos: Record<string, MetodoRpc> = {
    /** (re)define o estado de replicação do workspace; `null` = local (nada sai). */
    ragReplicacao: ([ws, estado]) => {
      if (estado === null) replicacao.delete(String(ws));
      else replicacao.set(String(ws), estado as EstadoReplicacao);
      return null;
    },
    ragPrevia: ([ws, pedido]) => {
      const svc = o.exigir(ws);
      const p = pedido as { config: ConfigOnline; destino: { provedor: string; host: string; colecao: string } };
      return criarPrevia({ repos: svc.repos, pedido: pedidoDe(svc, p.config), destino: p.destino });
    },
    ragConsentir: ([ws, migracaoId, consentimento]) => {
      consentir(o.exigir(ws).repos, String(migracaoId), consentimento as ConsentimentoBackend);
      return null;
    },
    ragMigrar: ([ws, migracaoId, pedido]) => {
      const svc = o.exigir(ws);
      const p = pedido as PedidoOnline;
      const id = String(migracaoId);
      if (migracoes.has(id)) return { iniciada: false };
      const ctl = new AbortController();
      migracoes.set(id, ctl);
      void (async () => {
        try {
          const arm = armazenamentoDe(String(ws), p, ctl.signal);
          const r = await migrar({ repos: svc.repos, armazenamento: arm, migracao_id: id, projeto_id: p.config.projeto_id, equipe_id: p.config.equipe_id, sinal: ctl.signal });
          if (r.estado === "falhou" && r.erro !== undefined) svc.repos.migracao.atualizar(id, { estado: "falhou", erro: sanitizarErro(r.erro, segredosDe(p)).slice(0, 300) });
        } catch (e) {
          svc.repos.migracao.atualizar(id, { estado: "falhou", erro: sanitizarErro(e instanceof Error ? e.message : "falha", segredosDe(p)).slice(0, 300) });
        } finally {
          migracoes.delete(id);
        }
      })();
      return { iniciada: true };
    },
    ragMigracao: ([ws, migracaoId]) => {
      const m = o.exigir(ws).repos.migracao.obter(String(migracaoId));
      return m === undefined ? null : { migracao_id: m.id, estado: m.estado, enviados: m.enviados, total: m.total, erro: m.erro ?? null, provedor: m.provedor, host: m.host, colecao_remota: m.colecao_remota };
    },
    ragMigracaoAtiva: ([ws]) => {
      const svc = o.exigir(ws);
      const m = svc.repos.banco.consultarUm<{ id: string; estado: string; enviados: number; total: number }>("SELECT id, estado, enviados, total FROM rag_migracao WHERE colecao_id = ? AND estado IN ('enviando','pausada','verificando','falhou','consentida') ORDER BY atualizado_em DESC LIMIT 1", [svc.colecaoId]);
      return m === undefined ? null : { migracao_id: m.id, estado: m.estado, enviados: m.enviados, total: m.total };
    },
    ragPausar: ([ws, migracaoId]) => {
      const id = String(migracaoId);
      migracoes.get(id)?.abort();
      pausar(o.exigir(ws).repos, id);
      return null;
    },
    ragCancelar: ([ws, migracaoId]) => {
      const id = String(migracaoId);
      migracoes.get(id)?.abort();
      cancelar(o.exigir(ws).repos, id);
      return null;
    },
    ragVerificar: ([ws, migracaoId, pedido]) => {
      const svc = o.exigir(ws);
      const p = pedido as PedidoOnline;
      return seguro(p, () => verificar({ repos: svc.repos, armazenamento: armazenamentoDe(String(ws), p), migracao_id: String(migracaoId), projeto_id: p.config.projeto_id, equipe_id: p.config.equipe_id }));
    },
    ragEmpurrar: ([ws, pedido, estado]) => {
      const svc = o.exigir(ws);
      const p = pedido as PedidoOnline;
      const est = estado as EstadoReplicacao;
      return seguro(p, () => empurrar({ repos: svc.repos, armazenamento: armazenamentoDe(String(ws), p), estado: est, pedido: pedidoDe(svc, p.config) }));
    },
    ragPuxar: ([ws, pedido, estado, desdeMs]) => {
      const svc = o.exigir(ws);
      const p = pedido as PedidoOnline;
      return seguro(p, () => puxar({ repos: svc.repos, armazenamento: armazenamentoDe(String(ws), p), estado: estado as EstadoReplicacao, colecao_id: svc.colecaoId, projeto_id: p.config.projeto_id, equipe_id: p.config.equipe_id, desde_ms: Number(desdeMs) || 0 }));
    },
    /** apaga SÓ os registros do projeto no remoto (confirmação digitada é do main). */
    ragApagarRemoto: ([ws, pedido]) => {
      const p = pedido as PedidoOnline;
      return seguro(p, () => armazenamentoDe(String(ws), p).apagar({ campo: "projeto_id", igual: p.config.projeto_id }));
    },
    ragPendentes: ([ws]) => {
      const svc = o.exigir(ws);
      return svc.repos.saida.pendentes(svc.colecaoId);
    },
    ragLimparFila: ([ws]) => {
      const svc = o.exigir(ws);
      svc.repos.banco.executar("DELETE FROM rag_saida WHERE colecao_id = ?", [svc.colecaoId]);
      return null;
    },
  };

  return {
    metodos,
    aoGravar(ws, svc) {
      return (colecao_id, ids) => {
        const e = replicacao.get(ws);
        if (e !== undefined && podeEnviar(e) && consentimentoVale(e.consentimento, e.destino)) enfileirarEnvio(svc.repos, e, colecao_id, ids);
      };
    },
  };
}
