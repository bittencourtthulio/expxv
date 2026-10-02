import type { AcaoDisparoMapa, PedidoDisparoMapa, ResultadoDisparoMapa } from "../../compartilhado/mapa";
import { ACOES_DISPARO_MAPA } from "../../compartilhado/mapa";
import { comandoDeSkill, normalizarArgumento } from "../metodo/comandos";
import { ehArquivoSensivel } from "./sensiveis";
import { escaparRegex, PASTA_PACOTES } from "./pasta";

// Disparo de skills com o caminho do mapa (T-17.34, parte pura). O ADE só DIGITA o comando no Pane; quem grava `docs/stack/**` e
// `docs/legado/**` é a skill (D-04). Nunca dispara ação humana (D-21): assinatura do prodx, aprovação de raio ALTO, mergex-revisar e merge.

export const SKILL_DA_ACAO: Readonly<Record<AcaoDisparoMapa, string>> = {
  stackx_detectar: "stackx-detectar",
  stackx_atualizar: "stackx-atualizar",
  legadox_perfil: "legadox-perfil",
  legadox_raio: "legadox-raio",
  legadox_divida: "legadox-divida",
};

const RE_PACOTE = new RegExp(`^${escaparRegex(PASTA_PACOTES)}/\\d{8}T\\d{6}Z/?$`);
const RE_TRABALHO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const MAX_ARQUIVOS = 50;
const MAX_ARG = 1_500;

export type ArgumentoDisparo = { ok: true; skill: string; argumento: string } | { ok: false; motivo: string };

function arquivoValido(c: unknown): c is string {
  // eslint-disable-next-line no-control-regex
  return typeof c === "string" && c.length > 0 && c.length <= 300 && !c.startsWith("/") && !/^[A-Za-z]:/.test(c) && !c.includes("\\") && !c.split("/").includes("..") && !/[\u0000-\u001f\u007f]/.test(c) && !ehArquivoSensivel(c);
}

export function montarArgumentoDisparo(p: { acao: AcaoDisparoMapa; pacoteRel: string; trabalho_id?: string | undefined; arquivos?: readonly string[] | undefined }): ArgumentoDisparo {
  if (!(ACOES_DISPARO_MAPA as readonly string[]).includes(p.acao)) return { ok: false, motivo: "Ação desconhecida: o ADE nunca dispara ação humana." };
  if (!RE_PACOTE.test(p.pacoteRel)) return { ok: false, motivo: "Caminho do pacote inválido." };
  const pacote = p.pacoteRel.endsWith("/") ? p.pacoteRel : `${p.pacoteRel}/`;
  const skill = SKILL_DA_ACAO[p.acao];
  switch (p.acao) {
    case "stackx_detectar":
      return { ok: true, skill, argumento: `mapa em ${pacote} — leia RESUMO.md e inventario-stackx.json antes; as contagens e evidências arquivo:linha já são determinísticas: confirme por amostragem em vez de varrer tudo; use a tool MCP map_evidence para o resto` };
    case "stackx_atualizar":
      return { ok: true, skill, argumento: `mapa em ${pacote} — leia mudancas-desde-ultimo.json e inventario-stackx.json; as contagens já são determinísticas: confirme por amostragem o que mudou; use a tool MCP map_evidence para o resto` };
    case "legadox_perfil":
      return { ok: true, skill, argumento: `mapa em ${pacote} — use perfil-provisorio.json como ponto de partida; o que o mapa marca como estimado ou candidato continua exigindo sua verificação` };
    case "legadox_divida":
      return { ok: true, skill, argumento: `mapa em ${pacote} — candidatos de código morto, hotspots e ciclos estão em RESUMO.md e arquivos.jsonl; todo candidato continua exigindo prova de vida antes de qualquer remoção` };
    case "legadox_raio": {
      if (p.trabalho_id === undefined || !RE_TRABALHO.test(p.trabalho_id)) return { ok: false, motivo: "legadox_raio exige um trabalho_id válido." };
      const arquivos = p.arquivos ?? [];
      if (arquivos.length === 0) return { ok: false, motivo: "legadox_raio exige ao menos um arquivo alvo." };
      if (arquivos.length > MAX_ARQUIVOS || !arquivos.every(arquivoValido)) return { ok: false, motivo: "Arquivos alvo inválidos (relativos à raiz, sem .., até 50)." };
      const topo = `${p.trabalho_id} mapa em ${pacote} — arquivos alvo: `;
      const fim = ` — raio-${p.trabalho_id}.json traz os 8 sinais com método declarado e a faixa provisória; a classificação final e a aprovação ALTO são suas e humanas`;
      let lista = arquivos.join(", ");
      if (topo.length + lista.length + fim.length > MAX_ARG) {
        let k = arquivos.length;
        while (k > 1 && topo.length + arquivos.slice(0, k).join(", ").length + ` (+${arquivos.length - k})`.length + fim.length > MAX_ARG) k--;
        lista = `${arquivos.slice(0, k).join(", ")} (+${arquivos.length - k})`;
      }
      return { ok: true, skill, argumento: `${topo}${lista}${fim}` };
    }
  }
}

export type ResultadoDispararNoPane = ({ ok: true } & ResultadoDisparoMapa) | { ok: false; motivo: string };

export interface PedidoDispararNoPane extends PedidoDisparoMapa {
  pacoteRel: string;
  carimbo: string;
  /** CLI do Pane (`claude`, `opencode`, …) ou `null` se o Pane não existe. */
  obterCliDoPane: (paneId: string) => string | null | Promise<string | null>;
  /** Digita o texto no Pane (o chamador trata o Enter e a regra de estado do Pane). */
  digitar: (paneId: string, texto: string) => void | Promise<void>;
}

export async function dispararNoPane(p: PedidoDispararNoPane): Promise<ResultadoDispararNoPane> {
  const arg = montarArgumentoDisparo({ acao: p.acao, pacoteRel: p.pacoteRel, trabalho_id: p.trabalho_id, arquivos: p.arquivos });
  if (!arg.ok) return arg;
  const argumento = normalizarArgumento(arg.argumento);
  if (argumento === null) return { ok: false, motivo: "Argumento vazio." };
  const cli = await p.obterCliDoPane(p.pane_id);
  const c = comandoDeSkill(arg.skill, argumento, cli);
  if (c.motivo_bloqueio !== null || c.comando === "") return { ok: false, motivo: c.motivo_bloqueio ?? "Comando bloqueado." };
  await p.digitar(p.pane_id, c.comando);
  return { ok: true, comando: c.comando, carimbo: p.carimbo, pacote: p.pacoteRel.endsWith("/") ? p.pacoteRel : `${p.pacoteRel}/` };
}
