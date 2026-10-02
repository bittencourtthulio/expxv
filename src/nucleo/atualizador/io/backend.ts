// Interface de backend do atualizador (Fase 21, T-21.15/T-21.16, D-340/D-343) e backend falso de teste.
// A camada de verificação NOSSA (assinatura do manifesto, sha512, tamanho, anti-downgrade) vale para TODOS os backends: o serviço reconfere o arquivo
// baixado antes de instalar. O backend só entrega o arquivo e/ou instala.
import type { ArtefatoAtualizacao, ManifestoAtualizacao } from "../../../compartilhado/atualizacao";
import { AtualizacaoErro } from "./erros";

export interface PedidoBackendBaixar {
  manifesto: ManifestoAtualizacao;
  artefato: ArtefatoAtualizacao;
  destinoDir: string;
  onProgresso: (fracao: number) => void;
  sinal: AbortSignal;
}

export interface BackendAtualizacao {
  readonly nome: "manual" | "electron-updater" | "falso" | "download-verificado";
  readonly capacidades: { baixa: boolean; instala: boolean };
  /** baixa o artefato aprovado e devolve o caminho local. Sem a capacidade: lança `backend_indisponivel`. */
  baixar(p: PedidoBackendBaixar): Promise<{ caminho: string }>;
  /** instala o arquivo (já reverificado) e reinicia o app. Sem a capacidade: lança `backend_indisponivel`. */
  instalar(caminho: string): Promise<void>;
  /** só o backend manual: abre a página de download (https, host do build). */
  abrirDownload?(p: { manifesto: ManifestoAtualizacao; artefato: ArtefatoAtualizacao }): Promise<void>;
}

export interface BackendFalso extends BackendAtualizacao {
  chamadas: Array<{ tipo: "baixar" | "instalar"; arg: string }>;
}

/** Backend de teste: `baixar` grava `conteudo` (ou usa `produzir`); `instalar` só registra a chamada. */
export function criarBackendFalso(op: { produzir?: (p: PedidoBackendBaixar) => Promise<string>; falharAoInstalar?: boolean } = {}): BackendFalso {
  const chamadas: BackendFalso["chamadas"] = [];
  return {
    nome: "falso",
    capacidades: { baixa: true, instala: true },
    chamadas,
    async baixar(p) {
      chamadas.push({ tipo: "baixar", arg: p.artefato.url_relativa });
      if (op.produzir === undefined) throw new AtualizacaoErro("backend_indisponivel");
      return { caminho: await op.produzir(p) };
    },
    async instalar(caminho) {
      chamadas.push({ tipo: "instalar", arg: caminho });
      if (op.falharAoInstalar === true) throw new AtualizacaoErro("backend_indisponivel");
    },
  };
}
