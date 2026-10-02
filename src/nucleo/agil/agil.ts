// Fábrica `criarAgil` (T-18.03): compõe os serviços do núcleo sobre PORTAS (D-187) e um banco (repositórios). Só com `Indisponivel*` + banco em memória já funciona.
// Relógio e gerador de ids são injetados em tudo (testes determinísticos). Nada roda no boot: tudo é sob demanda.
import type { ConfigAgil, FiltrosAgil, PainelAgil } from "../../compartilhado/agil";
import { adicionarItem, cancelarSprint, criarSprint, iniciarSprint, removerItem } from "./sprint/ciclo";
import { fecharSprint, sugerirFechar } from "./sprint/fechar";
import { atualizarItem, criarItem, descartarItem } from "./backlog/itens";
import { criarPublicador } from "./eventos";
import { estimarItens } from "./estimativa/estimar";
import { aceitarEmLote, gravarClassificacaoHumana, gravarEstimativaHumana } from "./estimativa/revisao";
import { sincronizar } from "./fatos/sincronizar";
import { criarBancoMemoria } from "./memoria";
import { criarPainelComCache } from "./metricas/painel";
import { portasIndisponiveis, type PortasAgil } from "./portas";
import type { BancoAgil } from "./repos";
import { marcarRetrabalho, type PedidoMarcar } from "./retrabalho/marcar";
import { processarRetrabalho } from "./retrabalho/processar";
import { lerConfig, mesclarConfig } from "./config/validar";
import { criarGeradorId, relogioSistema, type GeradorId, type Relogio } from "./util";
import { invalido } from "./erros";

export interface OpcoesAgil { portas?: Partial<PortasAgil>; banco?: BancoAgil; relogio?: Relogio; id?: GeradorId }

export function criarAgil(o: OpcoesAgil = {}) {
  const banco = o.banco ?? criarBancoMemoria();
  const relogio = o.relogio ?? relogioSistema;
  const id = o.id ?? criarGeradorId(relogio);
  const portas: PortasAgil = { ...portasIndisponiveis(), ...(o.portas ?? {}) };
  const pub = criarPublicador(banco, portas.alertas);
  const config = (ws: string): ConfigAgil => banco.configs.get(ws) ?? mesclarConfig({});
  const dep = (ws: string) => ({ banco, relogio, id, config: config(ws), pub });

  return {
    banco, portas, relogio, id,
    config: {
      ler: config,
      gravar(ws: string, parcial: unknown): ConfigAgil {
        const r = lerConfig({ ...config(ws), ...(typeof parcial === "object" && parcial ? parcial : {}) });
        if (!r.ok) throw invalido(`configuração inválida: ${r.erros.join("; ")}`);
        banco.configs.set(ws, r.config);
        return r.config;
      },
    },
    /** sincroniza os fatos do método e reavalia o retrabalho dos trabalhos lidos. */
    async sincronizar(ws: string, opcoes: { forcar?: boolean } = {}) {
      const fontes = await portas.metodo.fontes(ws);
      const r = await sincronizar({ banco, metodo: portas.metodo, relogio, id, config: config(ws) }, ws, { ...opcoes, fontes });
      const ocorrencias = await portas.metodo.ocorrencias(ws);
      processarRetrabalho({ banco, relogio, id, config: config(ws) }, ws, fontes, ocorrencias);
      return r;
    },
    estimar: (ws: string, itens: readonly string[] | "sem_estimativa") => estimarItens({ banco, portas, relogio, id, config: config(ws) }, ws, itens),
    revisao: (ws: string) => ({
      gravarEstimativa: (e: Parameters<typeof gravarEstimativaHumana>[1]) => gravarEstimativaHumana(dep(ws), e),
      gravarClassificacao: (e: Parameters<typeof gravarClassificacaoHumana>[1]) => gravarClassificacaoHumana(dep(ws), e),
      aceitarLote: (ids: readonly string[], min?: number) => aceitarEmLote(dep(ws), ids, min),
    }),
    backlog: (ws: string) => ({
      criar: (n: Omit<Parameters<typeof criarItem>[1], "workspace_id">) => criarItem(dep(ws), { ...n, workspace_id: ws }),
      atualizar: (itemId: string, e: Parameters<typeof atualizarItem>[2]) => atualizarItem(dep(ws), itemId, e),
      descartar: (itemId: string, motivo: string) => descartarItem(dep(ws), itemId, motivo),
    }),
    sprint: (ws: string) => ({
      criar: (n: Omit<Parameters<typeof criarSprint>[1], "workspace_id">) => criarSprint(dep(ws), { ...n, workspace_id: ws }),
      adicionar: (s: string, item: string, motivo?: string | null) => adicionarItem(dep(ws), s, item, motivo ?? null),
      remover: (s: string, item: string, motivo?: string | null) => removerItem(dep(ws), s, item, motivo ?? null),
      iniciar: (s: string, ator: "humano" | "agente" = "humano") => iniciarSprint(dep(ws), s, ator),
      cancelar: (s: string, ator: "humano" | "agente" = "humano") => cancelarSprint(dep(ws), s, ator),
      fechar: (p: Parameters<typeof fecharSprint>[1]) => fecharSprint({ banco, relogio, config: config(ws), pub }, p),
      sugerirFechar: (s: string) => sugerirFechar(banco, s),
    }),
    retrabalho: (ws: string) => ({ marcar: (p: Omit<PedidoMarcar, "workspace_id">) => marcarRetrabalho({ banco, relogio, id }, { ...p, workspace_id: ws }) }),
    painel(ws: string, filtros?: FiltrosAgil): PainelAgil { return criarPainelComCache({ banco, config: config(ws), relogio }).obter(ws, filtros).painel; },
  };
}
export type Agil = ReturnType<typeof criarAgil>;
