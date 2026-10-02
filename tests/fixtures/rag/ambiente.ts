// Ambiente de teste do RAG online: ClienteRede REAL (loopback http liberado só aqui) + consentimento + transporte + armazenamento sobre o stub.
import { criarArmazenamentoRag } from "../../../src/nucleo/conhecimento/backend/fabrica";
import { criarTransporteRag, type OpcoesTransporteRag, type TransporteHttpRag } from "../../../src/nucleo/conhecimento/backend/transporte";
import { criarClienteRede } from "../../../src/nucleo/rede/cliente-http";
import { criarRegistroConsentimento, type RegistroConsentimento } from "../../../src/nucleo/rede/consentimento";
import type { ArmazenamentoConhecimento } from "../../../src/nucleo/conhecimento/armazenamento/interface";
import type { Fabrica } from "../conhecimento/suite-contrato";
import { subirStubRag, type OpcoesStubRag, type StubRag } from "./servidor-stub";

export const CHAVE_SEMENTE = "SENTINELA-rag-7f3a91c2-chave-secreta-xyz";

export interface AmbienteRag {
  consentimento: RegistroConsentimento;
  hosts: Set<string>;
  transporte: TransporteHttpRag;
  logs: string[];
  consentir(host?: string): void;
  revogar(host?: string): void;
}

export function criarAmbienteRag(extra: Partial<OpcoesTransporteRag> = {}): AmbienteRag {
  const consentimento = criarRegistroConsentimento();
  const hosts = new Set<string>();
  const logs: string[] = [];
  const rede = criarClienteRede({ consentimento, permitirLoopbackHttp: true, log: (l) => logs.push(l) });
  const transporte = criarTransporteRag({ rede, consentimento, hostsConsentidos: () => hosts, dormir: async () => undefined, ...extra });
  return {
    consentimento,
    hosts,
    transporte,
    logs,
    consentir: (h = "127.0.0.1") => void hosts.add(h),
    revogar: (h = "127.0.0.1") => void hosts.delete(h),
  };
}

export interface ArmazenamentoStub {
  stub: StubRag;
  amb: AmbienteRag;
  armazenamento: ArmazenamentoConhecimento;
  /** simula o fim da janela de consistência eventual. */
  assentar(): void;
  /** outro cliente (outra pessoa da equipe: outro ambiente de rede) sobre o MESMO servidor e a mesma coleção. */
  novoCliente(): { armazenamento: ArmazenamentoConhecimento; amb: AmbienteRag };
  limpar(): Promise<void>;
}

export const SEGREDOS: Record<string, Record<string, string>> = {
  qdrant: { api_key: CHAVE_SEMENTE },
  supabase: { service_key: CHAVE_SEMENTE },
  upstash: { token: CHAVE_SEMENTE },
  pinecone: { api_key: CHAVE_SEMENTE },
};

export async function criarArmazenamentoStub(provedor: OpcoesStubRag["provedor"], o: { stub?: Partial<OpcoesStubRag>; loteMaximo?: number; colecao?: string; amb?: AmbienteRag; semConsentimento?: boolean; segredos?: Record<string, string> } = {}): Promise<ArmazenamentoStub> {
  const stub = await subirStubRag({ provedor, chave: CHAVE_SEMENTE, ...(o.stub ?? {}) });
  const amb = o.amb ?? criarAmbienteRag();
  if (o.semConsentimento !== true) amb.consentir(stub.host);
  const colecao = o.colecao ?? (provedor === "supabase" ? "rag_conhecimento" : "col_teste");
  const criar = (a: AmbienteRag): ArmazenamentoConhecimento =>
    criarArmazenamentoRag({
      provedor,
      url: stub.url,
      colecao_remota: colecao,
      segredos: o.segredos ?? SEGREDOS[provedor] ?? {},
      transporte: a.transporte,
      projeto_id: "0123456789abcdef",
      ...(o.loteMaximo === undefined ? {} : { loteMaximo: o.loteMaximo }),
      timeoutMs: 5000,
    });
  const armazenamento = criar(amb);
  return {
    stub,
    amb,
    armazenamento,
    assentar: () => stub.assentar(),
    novoCliente: () => {
      const a2 = criarAmbienteRag();
      a2.consentir(stub.host);
      return { armazenamento: criar(a2), amb: a2 };
    },
    limpar: () => stub.fechar(),
  };
}

/** Fábrica para a suíte de contrato: cada `criar` sobe um stub novo; `fecharTodos` fecha os que sobraram (falha no meio do teste). */
export function fabricaStub(provedor: OpcoesStubRag["provedor"], extra: { stub?: Partial<OpcoesStubRag> } = {}): { fab: Fabrica; fecharTodos(): Promise<void>; abertos: ArmazenamentoStub[] } {
  const abertos: ArmazenamentoStub[] = [];
  const fab: Fabrica = {
    criar: async (o) => {
      const a = await criarArmazenamentoStub(provedor, { stub: { ...(o?.metrica === undefined ? {} : { metrica: o.metrica }), ...(extra.stub ?? {}) }, ...(o?.loteMaximo === undefined ? {} : { loteMaximo: o.loteMaximo }) });
      abertos.push(a);
      return { armazenamento: a.armazenamento, limpar: () => void a.limpar(), assentar: () => a.assentar() };
    },
  };
  return { fab, abertos, fecharTodos: async () => void (await Promise.all(abertos.map((a) => a.limpar()))) };
}
