// Gancho de TESTE ponta a ponta. Só existe quando o app é aberto com a variável de ambiente `E2E`
// do produto (a fixture dos testes a define). Sem ela `criarGanchoE2E` devolve `null` e nenhum
// caminho do código de produção enxerga o gancho: as variáveis auxiliares são IGNORADAS.
//
// O que o gancho permite (nada além):
//  - `executavel`: caminho absoluto de uma CLI falsa para "escolher executável" sem abrir o diálogo
//    nativo (o teste registra a CLI falsa como ferramenta `personalizado`);
//  - `raiz`: pasta (temporária) usada como raiz do workspace atual, para o teste não tocar na pasta
//    pessoal da pessoa;
//  - `pastaClis`: pasta com CLIs falsas (scripts executáveis chamados `claude`, `codex`…). Quando definida
//    elas são as ÚNICAS CLIs detectadas: a CLI real da pessoa nunca é lançada num teste de orquestração.

import { variavelDeAmbiente } from "../nucleo/produto";

export interface GanchoE2E {
  /** CLI falsa a usar no lugar do diálogo de escolha de executável; `null` se não foi informada. */
  executavel: string | null;
  /** raiz do workspace atual nos testes; `null` = a do app. */
  raiz: string | null;
  /** pasta com as CLIs falsas (ver acima); `null` = detecção normal. */
  pastaClis?: string | null;
}

export function criarGanchoE2E(env: NodeJS.ProcessEnv = process.env, empacotado = false): GanchoE2E | null {
  if (empacotado) return null; // AUD-29: o binário de produção nunca obedece ao gancho de teste
  if (env[variavelDeAmbiente("E2E")] !== "1") return null;
  const lido = (nome: string): string | null => {
    const v = env[variavelDeAmbiente(nome)];
    return typeof v === "string" && v !== "" ? v : null;
  };
  return { executavel: lido("E2E_EXECUTAVEL"), raiz: lido("E2E_RAIZ"), pastaClis: lido("E2E_CLIS") };
}

/** Script que o main injeta no renderer só com o gancho: marca a janela para o xterm expor o buffer (ver `componentes/Terminal/gancho-e2e.ts`). */
export const SCRIPT_GANCHO_RENDERER = "window.__ade_e2e = true;";

/** Liga o gancho do renderer (a cada carga da página, inclusive recarga). Sem gancho (`null`) não faz nada. */
export function ligarGanchoNoRenderer(
  gancho: GanchoE2E | null,
  wc: { on(evento: "dom-ready", cb: () => void): unknown; isLoading(): boolean; executeJavaScript(codigo: string): Promise<unknown> },
): void {
  if (gancho === null) return;
  const injetar = (): void => { void wc.executeJavaScript(SCRIPT_GANCHO_RENDERER).catch(() => undefined); };
  wc.on("dom-ready", injetar);
  if (!wc.isLoading()) injetar();
}
