import { _electron as electron } from "playwright";
import type { ElectronApplication, Page } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { variavelDeAmbiente } from "../src/nucleo/produto";
import { matarArvoreDaPasta, registrarPasta } from "./limpeza";

export const RAIZ = resolve(__dirname, "..");

export interface AppAberto {
  app: ElectronApplication;
  pagina: Page;
  pastaDados: string;
  iniciadoEm: number;
  fechar(): Promise<void>;
}

export interface OpcoesApp {
  /** variáveis extras de ambiente. */
  env?: Record<string, string>;
  /** reaproveita uma pasta de dados existente (reiniciar o app). */
  pastaDados?: string;
}

/** Abre o app real (Electron) com `userData` isolado em tmpdir. Nunca toca nos dados do usuário. */
export async function abrirApp(opcoes: OpcoesApp = {}): Promise<AppAberto> {
  const pastaDados = opcoes.pastaDados ?? mkdtempSync(join(tmpdir(), "ade-e2e-"));
  // toda pasta usada por esta execução é registrada: o fim da suíte mata o que sobrar (limpeza.ts)
  registrarPasta(pastaDados);
  const iniciadoEm = Date.now();
  const app = await electron.launch({
    args: [RAIZ, `--user-data-dir=${pastaDados}`],
    env: {
      ...process.env,
      [variavelDeAmbiente("E2E")]: "1",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
      ...(opcoes.env ?? {}),
    } as Record<string, string>,
  });
  const pagina = await app.firstWindow();
  await pagina.waitForLoadState("domcontentloaded");
  return {
    app,
    pagina,
    pastaDados,
    iniciadoEm,
    async fechar() {
      // Quem passou `pastaDados` está reiniciando o app (sessões devem sobreviver): preserva; o fim da
      // suíte limpa. Sem pasta própria: descarta as sessões (o daemon as mantém vivas de propósito) e
      // mata a árvore que sobrar deste app de teste.
      const reiniciando = opcoes.pastaDados !== undefined;
      if (!reiniciando) await pagina
        .evaluate(async () => {
          const t = (window as unknown as { ade?: { terminais?: { listarSessoes(): Promise<Array<{ sessao_id: string }>>; descartar(id: string): Promise<boolean> } } }).ade?.terminais;
          if (t === undefined) return;
          for (const s of await t.listarSessoes()) await t.descartar(s.sessao_id);
        })
        .catch(() => undefined);
      await app.close().catch(() => undefined);
      if (!reiniciando) {
        matarArvoreDaPasta(pastaDados);
        rmSync(pastaDados, { recursive: true, force: true });
      }
    },
  };
}
