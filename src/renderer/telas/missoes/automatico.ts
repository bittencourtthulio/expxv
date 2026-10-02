// Lógica pura do "Automático (harness)" no wizard de Missão (T-09.36): a CLI "auto" é resolvida pelo harness na criação;
// aqui só se monta a prévia da rota (sem texto do pedido) e se traduzem os erros em texto.
import type { PerfilAgente, ResultadoDeRota } from "../../../compartilhado/harness";
import { ehCanalAusente } from "../../estado/carga";

/** Mesmo id de `CLI_AUTOMATICA` do núcleo de Missões (o renderer não importa o núcleo). */
export const CLI_AUTOMATICA = "auto";
export const ROTULO_AUTOMATICO = "Automático (harness)";

/** Perfil NÃO concreto: o roteador escolhe CLI, modelo e conta pela política (faixa média como ponto de partida). */
export function perfilAutomatico(): PerfilAgente {
  return { agente_id: null, provider: CLI_AUTOMATICA, cli: CLI_AUTOMATICA, modelo: null, esforco: null, faixa: "medio" };
}

export function resumirRota(r: ResultadoDeRota): string {
  const e = r.executor;
  const partes = [e.provider];
  if (e.model !== null) partes.push(e.model);
  if (e.effort !== null) partes.push(`esforço ${e.effort}`);
  partes.push(`faixa ${e.faixa}`);
  if (r.conta_id !== null) partes.push(`conta ${r.conta_id}`);
  return partes.join(" · ");
}

export function textoErroRota(e: unknown): string {
  if (ehCanalAusente(e)) return "Rota prevista indisponível: o harness ainda não está ligado nesta janela. A Missão poderá ser criada e a rota aparece no Pane.";
  const t = e instanceof Error ? e.message : String(e);
  if (/no_capacity/.test(t)) return "Sem capacidade agora: nenhuma conta com folga. Veja Consumo ou escolha uma CLI fixa.";
  if (/provider_unavailable|no_compatible_cli/.test(t)) return "Nenhuma CLI compatível disponível. Instale uma CLI em Provedores ou escolha uma fixa.";
  return `Prévia indisponível: ${t}`;
}
