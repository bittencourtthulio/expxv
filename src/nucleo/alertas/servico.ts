// Fachada `ServicoAlertas` (T-20.05/T-20.11/T-20.14): liga emissor -> regras -> entregas persistidas -> entregador.
// Nada de rede/Electron: tudo por portas. Sem regra ativa nem canal consentido, NADA vai para fora (só fica no Centro).
import { randomBytes } from "node:crypto";
import type { AlertaVisao, EntradaAlerta, EntregaRegistro } from "../../compartilhado/alertas";
import { avaliar, type ContextoAvaliacao } from "./regras";
import { criarEmissor, type Emissor } from "./emissor";
import type { Entregador } from "./entregador";
import type { PortaBarramento, RepoAlertas, RepoCanais, RepoEntregas, RepoRegras, Relogio } from "./portas";
import { relogioReal } from "./portas";
import { criarServicoLeitura, type ServicoLeituraAlertas } from "./servico-leitura";

export interface DepsServicoAlertas {
  repo: RepoAlertas;
  entregas: RepoEntregas;
  regras: RepoRegras;
  canais: RepoCanais;
  barramento: PortaBarramento;
  entregador?: Entregador;
  relogio?: Relogio;
  scrub?: (t: string) => string;
  /** silêncio global/por canal e fuso, lidos a cada avaliação (config muda sem reiniciar). */
  contextoAvaliacao?(): Omit<ContextoAvaliacao, "agora">;
  aoErro?(codigo: string): void;
  novoId?(): string;
}

export interface ServicoAlertas extends ServicoLeituraAlertas {
  emitir(e: EntradaAlerta): AlertaVisao | null;
  emissor: Emissor;
}

export function criarServicoAlertas(deps: DepsServicoAlertas): ServicoAlertas {
  const relogio = deps.relogio ?? relogioReal;
  const novoId = deps.novoId ?? ((): string => `ent_${randomBytes(9).toString("base64url")}`);
  const emissor = criarEmissor({
    repo: deps.repo,
    barramento: deps.barramento,
    relogio,
    ...(deps.scrub === undefined ? {} : { scrub: deps.scrub }),
    ...(deps.aoErro === undefined ? {} : { aoErro: deps.aoErro }),
    aoCriar(a) {
      const agora = relogio.agora();
      const ctx = { ...(deps.contextoAvaliacao?.() ?? {}), agora };
      const planejadas = avaliar(a, deps.regras.listar(), deps.canais.listar(), ctx);
      let criou = false;
      for (const p of planejadas) {
        const e: EntregaRegistro = {
          id: novoId(),
          alerta_id: p.alerta_id,
          canal_id: p.canal_id,
          regra_id: p.regra_id,
          estado: p.estado,
          tentativas: 0,
          proxima_tentativa_em: p.liberar_em === null ? null : new Date(p.liberar_em).toISOString(),
          erro_codigo: null,
          lote_id: null,
          mensagem_externa_id: null,
          enviado_em: null,
          criado_em: new Date(agora).toISOString(),
          nivel: p.nivel,
          chat_ref: p.chat_ref,
        };
        if (deps.entregas.inserir(e)) criou = true;
      }
      if (criou) deps.entregador?.acordar();
    },
  });
  return { ...criarServicoLeitura({ repo: deps.repo, barramento: deps.barramento, relogio }), emitir: (e) => emissor.emitir(e), emissor };
}
