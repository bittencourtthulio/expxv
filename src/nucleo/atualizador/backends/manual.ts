// Backend MANUAL (Fase 21, T-21.15): existe para quando não há assinatura de código real (residual R1). Nunca baixa nem executa nada:
// com a pessoa, abre a página de download no navegador (https, host do build). A pessoa baixa e confere o SHA256SUMS por conta própria.
import type { ArtefatoAtualizacao, ManifestoAtualizacao } from "../../../compartilhado/atualizacao";
import type { BackendAtualizacao } from "../io/backend";
import { AtualizacaoErro } from "../io/erros";

export interface DepsBackendManual {
  /** host do build (sem esquema/porta). */
  hostDoBuild: string;
  /** caminho-base do feed, ex.: "/". */
  caminhoBase: string;
  /** `shell.openExternal` (injetado). */
  abrirExterno(url: string): Promise<void>;
}

/** Monta a URL de download SÓ a partir do host do build e do caminho relativo já validado pelo manifesto assinado. */
export function urlDeDownload(host: string, caminhoBase: string, a: Pick<ArtefatoAtualizacao, "url_relativa">): string | null {
  if (!/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i.test(host)) return null;
  const base = caminhoBase.endsWith("/") ? caminhoBase : `${caminhoBase}/`;
  if (!/^\/[A-Za-z0-9._~\/-]*$/.test(base) || base.includes("..")) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._~-]*(\/[A-Za-z0-9][A-Za-z0-9._~-]*)*$/.test(a.url_relativa)) return null;
  const url = `https://${host.toLowerCase()}${base}${a.url_relativa}`;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username !== "" || u.password !== "" || u.hostname !== host.toLowerCase() || u.port !== "") return null;
  } catch {
    return null;
  }
  return url;
}

export function criarBackendManual(deps: DepsBackendManual): BackendAtualizacao {
  return {
    nome: "manual",
    capacidades: { baixa: false, instala: false },
    async baixar() {
      throw new AtualizacaoErro("backend_indisponivel");
    },
    async instalar() {
      throw new AtualizacaoErro("backend_indisponivel");
    },
    async abrirDownload(p: { manifesto: ManifestoAtualizacao; artefato: ArtefatoAtualizacao }) {
      const url = urlDeDownload(deps.hostDoBuild, deps.caminhoBase, p.artefato);
      if (url === null) throw new AtualizacaoErro("host_nao_permitido");
      await deps.abrirExterno(url);
    },
  };
}
