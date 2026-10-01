// Disparo de comandos no Pane (T-04.06; D-20, D-21). Funções PURAS: montam o texto a digitar
// (`/expx:<skill> <argumento>` no Claude Code; `/<skill> <argumento>` no OpenCode), SEMPRE com
// argumento, e dizem quando o gesto exige Pane separado ou é uma ação sempre humana. O ADE dirige
// o método por prompts e confirma pelo disco; nunca supõe sucesso pelo texto do terminal.
import type { ComandoSugerido, GestoMetodo } from "../../compartilhado/dominio";
import type { EstadoPane, Papel } from "../dominio";
import type { TipoTrabalho } from "./tipos";

export type Harness = "claude" | "opencode";

/** Skills que são SEMPRE ações humanas (D-21): o ADE só leva a pessoa ao arquivo. */
export const SKILLS_SOMENTE_HUMANO: readonly string[] = ["mergex-revisar"];

const ARGUMENTO_MAX = 1_500;
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u001f\u007f]/g;
const NOME_SKILL = /^[a-z][a-z0-9-]{0,40}$/;

export function harnessDaCli(cli: string | null | undefined): Harness | null {
  return cli === "claude" || cli === "opencode" ? cli : null;
}

export const prefixoDoHarness = (h: Harness): string => (h === "claude" ? "/expx:" : "/");

/** Uma linha só, sem caracteres de controle, com tamanho limitado; vazio vira `null`. */
export function normalizarArgumento(arg: string | null | undefined): string | null {
  if (typeof arg !== "string") return null;
  const limpo = arg.replace(/[\r\n\t]+/g, " ").replace(CONTROLE, "").replace(/\s+/g, " ").trim();
  return limpo === "" ? null : limpo.slice(0, ARGUMENTO_MAX).trimEnd();
}

/** O que o comando precisa saber do trabalho (subconjunto do `Trabalho` do modelo). */
export interface TrabalhoParaComando {
  id: string;
  tipo: TipoTrabalho;
  raio?: { faixa: string | null; aprovado: boolean } | null;
  prodx?: { veredito: string | null; assinado: boolean } | null;
}

const GESTOS_AVALIADORES: readonly GestoMetodo[] = ["auditar", "qa", "entrega_atencao"];
export const gestoExigeAvaliador = (g: GestoMetodo): boolean => GESTOS_AVALIADORES.includes(g);

const bloqueado = (gesto: GestoMetodo, motivo: string, somenteHumano = false): ComandoSugerido => ({
  comando: "",
  pane_separado: gestoExigeAvaliador(gesto),
  somente_humano: somenteHumano,
  motivo_bloqueio: motivo,
});

const MSG_SEM_SUPORTE = "Os comandos do método só existem no Claude Code e OpenCode. Escolha um Pane dessas CLIs para disparar este gesto.";

/** Comando de uma skill pelo nome (sem prefixo), já validado. `argumento` obrigatório. */
export function comandoDeSkill(skill: string, argumento: string | null | undefined, cli: string | null | undefined): ComandoSugerido {
  const base = { pane_separado: false, somente_humano: false, motivo_bloqueio: null };
  if (!NOME_SKILL.test(skill)) return { ...base, comando: "", motivo_bloqueio: "Nome de skill inválido." };
  if (SKILLS_SOMENTE_HUMANO.includes(skill)) {
    return { ...base, comando: "", somente_humano: true, motivo_bloqueio: `${skill} é uma ação humana: o ADE leva você ao arquivo, mas nunca dispara.` };
  }
  const harness = harnessDaCli(cli);
  if (harness === null) return { ...base, comando: "", motivo_bloqueio: MSG_SEM_SUPORTE };
  const arg = normalizarArgumento(argumento);
  if (arg === null) return { ...base, comando: "", motivo_bloqueio: "Falta o argumento: sem ele a skill pergunta qual trabalho e trava o Pane." };
  return { ...base, comando: `${prefixoDoHarness(harness)}${skill} ${arg}` };
}

const IDENTIFICADOR_OC = /^(OC-[A-Za-z0-9]+-\d+)(?:-|$)/;
/** O runx recebe o OC-ID (`OC-2026-0142`), não a pasta inteira. */
const refDoTrabalho = (t: TrabalhoParaComando): string => (t.tipo === "ocorrencia" ? (IDENTIFICADOR_OC.exec(t.id)?.[1] ?? t.id) : t.id);

const SKILL_DE_ENTREGA: Partial<Record<GestoMetodo, string>> = {
  entrega_check: "mergex-check",
  entrega_atencao: "mergex-atencao",
  entrega_qa: "mergex-qa",
  entrega_pr: "mergex-pr",
};

const TEXTO_DO_GESTO: Partial<Record<GestoMetodo, [skill: string, rotulo: string]>> = {
  nova_feature: ["sprintx", "o pedido da feature"],
  nova_ocorrencia: ["runx", "o texto do chamado"],
  pedido_cru: ["prodx-triar", "o texto do pedido"],
  projeto: ["buildx", "a descrição do projeto"],
};

/**
 * Comando sugerido para um gesto. `cli` é a CLI do Pane de destino (`claude`, `opencode`…); `argumento`
 * só vale para os gestos que criam trabalho (o pedido/texto). Nunca lança: o bloqueio vem em
 * `motivo_bloqueio` (com `somente_humano` quando a ação é sempre da pessoa).
 */
export function comandoSugerido(gesto: GestoMetodo, trabalho: TrabalhoParaComando | null, cli: string | null | undefined, argumento: string | null = null): ComandoSugerido {
  const harness = harnessDaCli(cli);
  if (harness === null) return bloqueado(gesto, MSG_SEM_SUPORTE);

  const novo = TEXTO_DO_GESTO[gesto];
  if (novo !== undefined) {
    if (normalizarArgumento(argumento) === null) return bloqueado(gesto, `Falta o argumento: informe ${novo[1]}. Sem ele a skill pergunta e trava o Pane.`);
    return comandoDeSkill(novo[0], argumento, cli);
  }

  if (trabalho === null) return bloqueado(gesto, "Escolha o trabalho: sem o identificador dele a skill pergunta qual e trava o Pane.");

  // ações sempre humanas (D-21): a UI leva ao arquivo
  if (trabalho.tipo === "pedido" && trabalho.prodx?.veredito != null && !trabalho.prodx.assinado && gesto === "retomar") {
    return bloqueado(gesto, "A assinatura do prodx é humana: abra o VEREDITO.md e assine; o ADE não dispara nada aqui.", true);
  }
  const raioPendente = trabalho.raio?.faixa?.toLowerCase() === "alto" && !trabalho.raio.aprovado;
  if (raioPendente && (gesto === "retomar" || gesto in SKILL_DE_ENTREGA)) {
    return bloqueado(gesto, "A aprovação em raio ALTO é humana: abra o arquivo do raio em docs/legado/raio e aprove; o ADE não dispara nada aqui.", true);
  }

  const ref = refDoTrabalho(trabalho);
  switch (gesto) {
    case "retomar": {
      const skill = trabalho.tipo === "feature" ? "sprintx" : trabalho.tipo === "ocorrencia" ? "runx" : trabalho.tipo === "projeto" ? "buildx-retomar" : "prodx-avaliar";
      return comandoDeSkill(skill, ref, cli);
    }
    case "auditar":
      if (trabalho.tipo !== "feature") return bloqueado(gesto, "A auditoria do plano (F5) é do sprintx e só existe para feature; para ocorrência use o QA.");
      return { ...comandoDeSkill("sprintx-auditoria", ref, cli), pane_separado: true };
    case "qa":
      if (trabalho.tipo !== "ocorrencia") return bloqueado(gesto, "O QA do runx só existe para ocorrência; para feature use a auditoria ou o QA da entrega.");
      return { ...comandoDeSkill("runx-qa", ref, cli), pane_separado: true };
    case "entrega_check":
    case "entrega_atencao":
    case "entrega_qa":
    case "entrega_pr": {
      if (trabalho.tipo !== "feature" && trabalho.tipo !== "ocorrencia") return bloqueado(gesto, "A entrega (mergex) só se aplica a feature ou ocorrência.");
      const r = comandoDeSkill(SKILL_DE_ENTREGA[gesto] as string, trabalho.id, cli);
      return { ...r, pane_separado: gestoExigeAvaliador(gesto) };
    }
    default:
      return bloqueado(gesto, "Gesto desconhecido.");
  }
}

// ---------------------------------------------------------------- destino do comando

export type MotivoRecusaEntrada = "iniciando" | "trabalhando" | "aguardando" | "bloqueado" | "encerrado";

/**
 * Só um Pane `pronto` recebe entrada automática (D-20). `aguardando` é o Pane que espera resposta
 * humana (F2, prodx…): reenviar prompt ali atropela a pergunta.
 */
export function motivoRecusaDeEntrada(estado: EstadoPane): MotivoRecusaEntrada | null {
  return estado === "pronto" ? null : estado;
}

const EXPLICACAO: Record<MotivoRecusaEntrada, string> = {
  iniciando: "O Pane ainda está iniciando.",
  trabalhando: "O Pane está trabalhando: espere terminar antes de mandar outro comando.",
  aguardando: "O Pane está aguardando a sua resposta: responda nele em vez de reenviar um comando.",
  bloqueado: "O Pane está bloqueado.",
  encerrado: "O Pane está encerrado.",
};

export type AvaliacaoDestino = { ok: true } | { ok: false; motivo: string };

/** Pode este gesto ir para este Pane (`null` = abrir um novo)? Avaliadores ficam em Pane separado (D-21). */
export function avaliarPaneDestino(gesto: GestoMetodo, pane: { estado: EstadoPane; papel: Papel } | null): AvaliacaoDestino {
  if (pane === null) return { ok: true };
  const recusa = motivoRecusaDeEntrada(pane.estado);
  if (recusa !== null) return { ok: false, motivo: EXPLICACAO[recusa] };
  if (gestoExigeAvaliador(gesto) && pane.papel !== "revisor") {
    return { ok: false, motivo: "O avaliador precisa de um Pane separado do implementador: quem implementa não aprova. Abra um novo Pane (papel revisor)." };
  }
  if (!gestoExigeAvaliador(gesto) && pane.papel === "revisor") {
    return { ok: false, motivo: "Este Pane é de revisão e não implementa: use o Pane do implementador." };
  }
  return { ok: true };
}
