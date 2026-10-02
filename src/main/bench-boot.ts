// Boot do Bench (Fase 12) no main: só registra os canais `bench:*` (validadores; nada de banco, arquivo nem processo). O `ServicoBench` nasce no PRIMEIRO canal chamado (sob demanda) e leva
// as portas do app por função preguiçosa. Fica fora do main.ts para o arquivo compartilhado crescer o mínimo.
import { writeFile } from "node:fs/promises";
import type { Preco } from "../compartilhado/custo";
import type { RespostaLimites } from "../compartilhado/limites";
import type { Banco } from "../nucleo/banco/banco";
import type { ServicoBench } from "../nucleo/bench/servico";
import type { EventoBenchIpc } from "../nucleo/bench/tipos";
import type { Conta } from "../nucleo/dominio";
import { criarBenchMain } from "./bench";
import { registrarIpcBench } from "./ipc/bench";
import type { RegistroIpc } from "./ipc/registro";

export interface CtxBenchBoot {
  registro: RegistroIpc;
  banco: Banco;
  userData: string;
  contas: { obter(id: string): Conta | undefined; configDirAbsoluto(c: Pick<Conta, "config_dir_ref">): string | null; listar(): Conta[] };
  limites: () => RespostaLimites | null;
  precos: () => readonly Preco[] | null;
  /** envia o evento ao renderer (janela principal). */
  enviar: (payload: EventoBenchIpc) => void;
  /** diálogo de salvar do sistema (nome sugerido → caminho ou `null`). */
  escolherArquivoParaSalvar: (nomeSugerido: string) => Promise<string | null>;
  scrub?: () => ((t: string) => string) | undefined;
  aviso: (mensagem: string) => void;
}

export interface BenchLigado {
  /** cancela as Runs, mata as árvores de processo e espera (nunca deixa processo órfão ao sair). */
  encerrar(): Promise<void>;
  /** só teste/diagnóstico. */
  servicoSeExistir(): ServicoBench | null;
}

export function prepararBench(c: CtxBenchBoot): BenchLigado {
  let svc: ServicoBench | null = null;
  const servico = (): ServicoBench => {
    svc ??= criarBenchMain({
      banco: c.banco,
      userData: c.userData,
      contas: c.contas,
      limites: c.limites,
      precosFase10: c.precos,
      provedoresHabilitados: () => new Set(c.contas.listar().filter((x) => x.habilitada).map((x) => x.provedor)),
      emitir: c.enviar,
      salvarComo: async (nome, conteudo) => {
        const destino = await c.escolherArquivoParaSalvar(nome);
        if (destino === null) return null;
        await writeFile(destino, conteudo, { encoding: "utf8", mode: 0o600 });
        return destino;
      },
      ...(c.scrub === undefined ? {} : { scrub: c.scrub }),
    });
    return svc;
  };
  registrarIpcBench({ registro: c.registro, servico, aviso: c.aviso });
  return {
    servicoSeExistir: () => svc,
    async encerrar() {
      const s = svc;
      svc = null;
      await s?.encerrar().catch(() => undefined);
    },
  };
}
