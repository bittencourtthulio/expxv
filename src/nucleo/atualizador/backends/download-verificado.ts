// Backend de download verificado (Fase 21, T-21.14): baixa pelo transporte consentido, com sha512 em streaming e teto de bytes (verificador.ts).
// A instalação é uma porta injetada (`instalador`), nunca um shell: ex.: abrir o instalador baixado. Base também usada pelos testes de abuso.
import type { BackendAtualizacao } from "../io/backend";
import type { Transporte } from "../io/transporte";
import { baixarEVerificar } from "../io/verificador";
import { AtualizacaoErro } from "../io/erros";

export function criarBackendDownloadVerificado(deps: { transporte: Transporte; caminhoBase: string; instalador?: (caminho: string) => Promise<void>; agoraMs?: () => number; ociosoMs?: number }): BackendAtualizacao {
  return {
    nome: "download-verificado",
    capacidades: { baixa: true, instala: deps.instalador !== undefined },
    async baixar(p) {
      const r = await baixarEVerificar({
        transporte: deps.transporte,
        caminhoBase: deps.caminhoBase,
        artefato: p.artefato,
        destinoDir: p.destinoDir,
        onProgresso: p.onProgresso,
        sinal: p.sinal,
        ...(deps.agoraMs !== undefined ? { agoraMs: deps.agoraMs } : {}),
        ...(deps.ociosoMs !== undefined ? { ociosoMs: deps.ociosoMs } : {}),
      });
      return { caminho: r.caminho };
    },
    async instalar(caminho) {
      if (deps.instalador === undefined) throw new AtualizacaoErro("backend_indisponivel");
      await deps.instalador(caminho);
    },
  };
}
