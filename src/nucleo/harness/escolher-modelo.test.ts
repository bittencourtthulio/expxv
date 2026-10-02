import { describe, expect, it } from "vitest";
import type { CandidataConta, EntradaEquivalencia, Faixa, ModeloOpenRouter, ResultadoModelo } from "../../compartilhado/harness";
import { AGORA, H, PADRAO, conta, embaralhar, emH, opcoesModelo, prng, type ExtraConta, type OpcoesModeloTeste } from "../../../tests/fixtures/harness/construtores";
import { montarEquivalencia } from "./equivalencia";
import { pickModel, type ResultadoModeloDetalhado } from "./escolher-modelo";

type Mundo = Record<string, CandidataConta[]>;
const cl = (id: string, x: ExtraConta = {}): CandidataConta => conta(id, "claude", x);
const cx = (id: string, x: ExtraConta = {}): CandidataConta => conta(id, "codex", x);
const gm = (id: string, x: ExtraConta = {}): CandidataConta => conta(id, "gemini", x);
const orc = (id: string, x: ExtraConta = {}): CandidataConta => conta(id, "openrouter", { fonte: "openrouter_api", ...x });
const u = (p: number, h = 3): ExtraConta => ({ w: [["five_hour", p, h]] });
const SEM: ExtraConta = { semUso: true };
const EST = (p: number): ExtraConta => ({ fonte: "estimado", confianca: "estimado", w: [["five_hour", p, 3]] });

const modeloOr = (id: string, faixa: Faixa, extra: Partial<ModeloOpenRouter> = {}): ModeloOpenRouter => ({ id, nome: id, contexto: null, suporta_tools: null, preco_entrada_por_mtok: null, preco_saida_por_mtok: null, habilitado: true, faixa, ordem: 100, tipos_permitidos: [], ...extra });
const comOr = (...modelos: ModeloOpenRouter[]): EntradaEquivalencia => montarEquivalencia(PADRAO, undefined, { habilitado: true, consentido: true, modelos }).efetiva;
/** Equivalência de teste: codex só tem a faixa média (as demais vazias). */
const EQ_CODEX_SO_MEDIO = montarEquivalencia(PADRAO, { codex: { topo: [], alto: [], medio: [{ modelo: "default", esforco: null }], rapido: [] } }).efetiva;
const EQ_CODEX_CONFIRMADO = montarEquivalencia(PADRAO, { codex: { topo: [{ modelo: "default", esforco: null, confirmado: true }] } }).efetiva;
const EQ_GEMINI_SEM_TOPO = montarEquivalencia(PADRAO, { gemini: { topo: [] } }).efetiva;

interface Caso {
  nome: string;
  mundo: Mundo;
  opc?: Partial<OpcoesModeloTeste>;
  eq?: EntradaEquivalencia;
  motivo: ResultadoModelo["motivo"];
  /** `provedor/conta` esperado ou null. */
  para: string | null;
  confianca?: "alta" | "media" | "baixa";
  aviso?: string;
  bloqueio?: ResultadoModeloDetalhado["bloqueio"];
  faixa?: Faixa;
}

// TABELA DE DECISÃO de pickModel (D-102). CT-9.18..9.22, 9.25, 9.33.
const TABELA: Caso[] = [
  // ---- (1) mesma conta ----
  { nome: "atual a 40%: mesma conta, nada muda", mundo: { claude: [cl("c1", u(40)), cl("c2", u(10))] }, motivo: "mesma_conta_ok", para: "claude/c1", confianca: "alta" },
  { nome: "atual sem dado (nível 4): permanece (sem prova de problema)", mundo: { claude: [cl("c1", SEM), cl("c2", u(10))] }, motivo: "mesma_conta_ok", para: "claude/c1" },
  { nome: "atual estimada a 60% (nível 2): permanece", mundo: { claude: [cl("c1", EST(60)), cl("c2", u(10))] }, motivo: "mesma_conta_ok", para: "claude/c1", confianca: "media" },
  // ---- (2) outra conta do mesmo provedor ----
  { nome: "CT-9.18 atual a 87%, outra a 20% ⇒ outra conta", mundo: { claude: [cl("c1", u(87)), cl("c2", u(20))] }, motivo: "outra_conta", para: "claude/c2", confianca: "alta" },
  { nome: "margem: destino a 80% (> 87 − 10) não vale ⇒ permanece (sem alternativa)", mundo: { claude: [cl("c1", u(87)), cl("c2", u(80))] }, motivo: "sem_alternativa", para: null },
  { nome: "margem: destino a 77% (= 87 − 10) vale", mundo: { claude: [cl("c1", u(87)), cl("c2", u(77))] }, motivo: "outra_conta", para: "claude/c2" },
  { nome: "destino sem dado (nível 4) não vale numa troca", mundo: { claude: [cl("c1", u(87)), cl("c2", SEM)] }, motivo: "sem_alternativa", para: null },
  { nome: "destino estimado a 10% (nível 2) vale, com confiança média", mundo: { claude: [cl("c1", u(87)), cl("c2", EST(10))] }, motivo: "outra_conta", para: "claude/c2", confianca: "media" },
  { nome: "destino quente (86%) não vale", mundo: { claude: [cl("c1", u(95)), cl("c2", u(86))] }, motivo: "sem_alternativa", para: null },
  { nome: "entre as outras, reseta primeiro (pickAccount) respeitando a margem", mundo: { claude: [cl("c1", u(87)), cl("c2", u(10, 100)), cl("c3", u(50, 2))] }, motivo: "outra_conta", para: "claude/c3" },
  { nome: "a melhor do ranking reprova na margem, a seguinte passa", mundo: { claude: [cl("c1", u(87)), cl("c2", u(80, 1)), cl("c3", u(30, 50))] }, motivo: "outra_conta", para: "claude/c3" },
  { nome: "atual esgotada, outra conta ok", mundo: { claude: [cl("c1", u(100)), cl("c2", u(40))] }, motivo: "outra_conta", para: "claude/c2" },
  { nome: "outra conta do mesmo provedor vence outro provedor", mundo: { claude: [cl("c1", u(90)), cl("c2", u(20))], codex: [cx("x1", u(0))] }, motivo: "outra_conta", para: "claude/c2" },
  { nome: "outra conta em cooldown é pulada", mundo: { claude: [cl("c1", u(90)), cl("c2", { ...u(10), cooldownH: 1 }), cl("c3", u(30))] }, motivo: "outra_conta", para: "claude/c3" },
  { nome: "excluir_contas é respeitado", mundo: { claude: [cl("c1", u(90)), cl("c2", u(10))] }, opc: { excluir_contas: ["c2"] }, motivo: "sem_alternativa", para: null },
  { nome: "balde do modelo esgotado na atual e na outra: a outra não serve", mundo: { claude: [cl("c1", { w: [["weekly", 10, 50]], baldes: { opus: [100, 50] } }), cl("c2", { w: [["weekly", 10, 50]], baldes: { opus: [100, 50] } })] }, motivo: "sem_alternativa", para: null },
  // ---- (3) mesma faixa em outro provedor ----
  { nome: "CT-9.19 só uma conta Claude estourando; Codex livre ⇒ mesma faixa no Codex", mundo: { claude: [cl("c1", u(87))], codex: [cx("x1", u(20))] }, motivo: "outro_provedor", para: "codex/x1", faixa: "topo", confianca: "baixa" },
  { nome: "mesma troca com o nome do modelo CONFIRMADO na tabela: confiança média", mundo: { claude: [cl("c1", u(87))], codex: [cx("x1", u(20))] }, eq: EQ_CODEX_CONFIRMADO, motivo: "outro_provedor", para: "codex/x1", confianca: "media" },
  { nome: "Codex a 86% (quente) com a atual ainda não esgotada ⇒ permanece (CT-9.21)", mundo: { claude: [cl("c1", u(95))], codex: [cx("x1", u(86))] }, motivo: "sem_alternativa", para: null },
  { nome: "atual esgotada: nível 3 em outro provedor passa (margem 100 − 10)", mundo: { claude: [cl("c1", u(100))], codex: [cx("x1", u(86))] }, motivo: "outro_provedor", para: "codex/x1", confianca: "baixa" },
  { nome: "atual esgotada e Codex esgotado ⇒ Gemini", mundo: { claude: [cl("c1", u(100))], codex: [cx("x1", u(100))], gemini: [gm("g1", u(30))] }, motivo: "outro_provedor", para: "gemini/g1" },
  { nome: "ordem de preferência: gemini antes de codex quando ambos nível 1", mundo: { claude: [cl("c1", u(90))], codex: [cx("x1", u(20))], gemini: [gm("g1", u(20))] }, opc: { provedores_viaveis: ["claude", "gemini", "codex"] }, motivo: "outro_provedor", para: "gemini/g1" },
  { nome: "nível vence a preferência: gemini estimado (2) perde para codex medido (1)", mundo: { claude: [cl("c1", u(90))], codex: [cx("x1", u(20))], gemini: [gm("g1", EST(10))] }, opc: { provedores_viaveis: ["claude", "gemini", "codex"] }, motivo: "outro_provedor", para: "codex/x1" },
  { nome: "conta logada (auth ok) vence a de auth desconhecida no mesmo nível", mundo: { claude: [cl("c1", u(90))], codex: [cx("x1", { ...u(20), auth: "desconhecida" })], gemini: [gm("g1", u(20))] }, opc: { provedores_viaveis: ["claude", "codex", "gemini"] }, motivo: "outro_provedor", para: "gemini/g1" },
  { nome: "provedor sem conta habilitada é pulado", mundo: { claude: [cl("c1", u(90))], codex: [cx("x1", { ...u(20), hab: false })], gemini: [gm("g1", u(40))] }, motivo: "outro_provedor", para: "gemini/g1" },
  { nome: "permitir_outro_provedor=false ⇒ sem alternativa mesmo com Codex livre", mundo: { claude: [cl("c1", u(90))], codex: [cx("x1", u(5))] }, opc: { permitir_outro_provedor: false }, motivo: "sem_alternativa", para: null },
  { nome: "provedor fora de provedores_viaveis (não instalado) nunca é escolhido", mundo: { claude: [cl("c1", u(90))], codex: [cx("x1", u(5))] }, opc: { provedores_viaveis: ["claude"] }, motivo: "sem_alternativa", para: null },
  { nome: "faixa vazia pula o provedor (gemini sem topo ⇒ codex)", mundo: { claude: [cl("c1", u(90))], gemini: [gm("g1", u(5))], codex: [cx("x1", u(30))] }, eq: EQ_GEMINI_SEM_TOPO, opc: { provedores_viaveis: ["claude", "gemini", "codex"] }, motivo: "outro_provedor", para: "codex/x1" },
  { nome: "sem outro provedor habilitado, atual ≥ 85% não esgotada ⇒ permanece (CT-9.21)", mundo: { claude: [cl("c1", u(88))] }, opc: { provedores_viaveis: ["claude"] }, motivo: "sem_alternativa", para: null },
  { nome: "sem outro provedor, atual esgotada ⇒ sem alternativa (o Router devolve no_capacity)", mundo: { claude: [cl("c1", u(100))] }, opc: { provedores_viaveis: ["claude"] }, motivo: "sem_alternativa", para: null },
  // ---- (4) faixa inferior ----
  { nome: "faixa_minima=mesma: nunca desce", mundo: { claude: [cl("c1", { w: [["weekly", 10, 50]], baldes: { opus: [100, 50] } })] }, motivo: "sem_alternativa", para: null },
  { nome: "descer_1 com balde do opus esgotado: sonnet (alto) na mesma conta", mundo: { claude: [cl("c1", { w: [["weekly", 10, 50]], baldes: { opus: [100, 50] } })] }, opc: { faixa_minima: "descer_1" }, motivo: "faixa_inferior", para: "claude/c1", faixa: "alto", confianca: "baixa", aviso: "desceu_de_faixa" },
  { nome: "Codex sem conta livre e Claude esgotado: descer_1 não alcança o médio do Codex", mundo: { claude: [cl("c1", u(100))], codex: [cx("x1", u(100))] }, eq: EQ_CODEX_SO_MEDIO, opc: { faixa_minima: "descer_1", provedores_viaveis: ["claude", "codex"] }, motivo: "sem_alternativa", para: null },
  { nome: "Codex só tem a faixa média livre: qualquer desce até lá", mundo: { claude: [cl("c1", u(100))], codex: [cx("x1", u(20))] }, eq: EQ_CODEX_SO_MEDIO, opc: { faixa_minima: "qualquer", provedores_viaveis: ["claude", "codex"] }, motivo: "faixa_inferior", para: "codex/x1", faixa: "medio" },
  { nome: "faixa_minima=mesma com Codex só no médio ⇒ sem alternativa", mundo: { claude: [cl("c1", u(100))], codex: [cx("x1", u(20))] }, eq: EQ_CODEX_SO_MEDIO, opc: { provedores_viaveis: ["claude", "codex"] }, motivo: "sem_alternativa", para: null },
  { nome: "descer_1 desce no máximo UMA faixa (alto→médio; rápido fica fora)", mundo: { claude: [cl("c1", { w: [["weekly", 10, 50]], baldes: { sonnet: [100, 50] } })] }, opc: { atual: { provedor: "claude", conta_id: "c1", modelo: "sonnet", faixa: "alto" }, faixa_minima: "descer_1", provedores_viaveis: ["claude"] }, motivo: "sem_alternativa", para: null },
  { nome: "qualquer desce até o rápido (haiku) com o balde do sonnet esgotado", mundo: { claude: [cl("c1", { w: [["weekly", 10, 50]], baldes: { sonnet: [100, 50] } })] }, opc: { atual: { provedor: "claude", conta_id: "c1", modelo: "sonnet", faixa: "alto" }, faixa_minima: "qualquer", provedores_viaveis: ["claude"] }, motivo: "faixa_inferior", para: "claude/c1", faixa: "rapido" },
  { nome: "perfil rápido nunca sobe de faixa", mundo: { claude: [cl("c1", u(100))], codex: [cx("x1", u(20))] }, opc: { atual: { provedor: "claude", conta_id: "c1", modelo: "haiku", faixa: "rapido" }, faixa_minima: "qualquer" }, motivo: "outro_provedor", para: "codex/x1", faixa: "rapido" },
  // ---- OpenRouter ----
  { nome: "CT-9.33 Claude esgotado; OpenRouter com modelo na faixa topo e CLI compatível ⇒ OpenRouter", mundo: { claude: [cl("c1", u(100))], openrouter: [orc("o1", { w: [["credit", 20, null]] })] }, eq: comOr(modeloOr("vendor/modelo-a", "topo")), opc: { clis_openrouter: ["opencode"] }, motivo: "outro_provedor", para: "openrouter/o1" },
  { nome: "OpenRouter sem CLI compatível é pulado (sem_cli_compativel)", mundo: { claude: [cl("c1", u(100))], openrouter: [orc("o1", { w: [["credit", 20, null]] })] }, eq: comOr(modeloOr("vendor/modelo-a", "topo")), motivo: "sem_alternativa", para: null, aviso: "sem_cli_compativel" },
  { nome: "OpenRouter vem por último mesmo com nível melhor", mundo: { claude: [cl("c1", u(95))], openrouter: [orc("o1", { w: [["credit", 5, null]] })], codex: [cx("x1", u(40))] }, eq: comOr(modeloOr("vendor/modelo-a", "topo")), opc: { clis_openrouter: ["opencode"], provedores_viaveis: ["claude", "openrouter", "codex"] }, motivo: "outro_provedor", para: "codex/x1" },
  { nome: "modelo OpenRouter restrito a outro tipo de tarefa é ignorado", mundo: { claude: [cl("c1", u(100))], openrouter: [orc("o1", { w: [["credit", 20, null]] })] }, eq: comOr(modeloOr("vendor/modelo-a", "topo", { tipos_permitidos: ["auditar"] })), opc: { clis_openrouter: ["opencode"], task_type: "implementar" }, motivo: "sem_alternativa", para: null },
  { nome: "modelo OpenRouter restrito ao tipo da tarefa é usado", mundo: { claude: [cl("c1", u(100))], openrouter: [orc("o1", { w: [["credit", 20, null]] })] }, eq: comOr(modeloOr("vendor/modelo-a", "topo", { tipos_permitidos: ["auditar"] })), opc: { clis_openrouter: ["opencode"], task_type: "auditar" }, motivo: "outro_provedor", para: "openrouter/o1" },
  { nome: "modelo OpenRouter restrito e tipo desconhecido (null) é ignorado", mundo: { claude: [cl("c1", u(100))], openrouter: [orc("o1", { w: [["credit", 20, null]] })] }, eq: comOr(modeloOr("vendor/modelo-a", "topo", { tipos_permitidos: ["auditar"] })), opc: { clis_openrouter: ["opencode"], task_type: null }, motivo: "sem_alternativa", para: null },
  { nome: "conta OpenRouter sem limite informado (used null) entra como nível 2", mundo: { claude: [cl("c1", u(100))], openrouter: [orc("o1", { w: [["credit", null, null]] })] }, eq: comOr(modeloOr("vendor/modelo-a", "topo")), opc: { clis_openrouter: ["opencode"] }, motivo: "outro_provedor", para: "openrouter/o1", confianca: "media" },
  { nome: "modelo OpenRouter desabilitado some da tabela (nada a escolher)", mundo: { claude: [cl("c1", u(100))], openrouter: [orc("o1", { w: [["credit", 20, null]] })] }, eq: comOr(modeloOr("vendor/modelo-a", "topo", { habilitado: false })), opc: { clis_openrouter: ["opencode"] }, motivo: "sem_alternativa", para: null },
  { nome: "OpenRouter com a atual esgotada aceita crédito a 90% (nível 3)", mundo: { claude: [cl("c1", u(100))], openrouter: [orc("o1", { w: [["credit", 90, null]] })] }, eq: comOr(modeloOr("vendor/modelo-a", "topo")), opc: { clis_openrouter: ["opencode"] }, motivo: "outro_provedor", para: "openrouter/o1", confianca: "baixa" },
  // ---- anti ping-pong e segurança ----
  { nome: "CT-9.22 depois da troca: antiga 90%, nova 86% ⇒ não volta", mundo: { claude: [cl("c1", u(90)), cl("c2", u(86))] }, opc: { atual: { provedor: "claude", conta_id: "c2", modelo: "opus", faixa: "topo" } }, motivo: "sem_alternativa", para: null },
  { nome: "limite de 3 saltos por task: não troca mesmo com conta livre", mundo: { claude: [cl("c1", u(90)), cl("c2", u(10))] }, opc: { saltos: 3 }, motivo: "sem_alternativa", para: null, bloqueio: "max_saltos" },
  { nome: "2 saltos ainda permite o terceiro", mundo: { claude: [cl("c1", u(90)), cl("c2", u(10))] }, opc: { saltos: 2 }, motivo: "outra_conta", para: "claude/c2" },
  { nome: "max_saltos configurado em 1 com 1 salto: bloqueia", mundo: { claude: [cl("c1", u(90)), cl("c2", u(10))] }, opc: { saltos: 1, max_saltos: 1 }, motivo: "sem_alternativa", para: null, bloqueio: "max_saltos" },
  { nome: "max_saltos configurado acima de 3 é limitado a 3", mundo: { claude: [cl("c1", u(90)), cl("c2", u(10))] }, opc: { saltos: 3, max_saltos: 10 }, motivo: "sem_alternativa", para: null, bloqueio: "max_saltos" },
  { nome: "troca recente (5 min) com a atual ainda utilizável: espera o intervalo", mundo: { claude: [cl("c1", u(90)), cl("c2", u(10))] }, opc: { ultima_troca_em: AGORA - 5 * 60_000 }, motivo: "sem_alternativa", para: null, bloqueio: "intervalo_entre_trocas" },
  { nome: "troca há mais de 10 min: liberada", mundo: { claude: [cl("c1", u(90)), cl("c2", u(10))] }, opc: { ultima_troca_em: AGORA - 11 * 60_000 }, motivo: "outra_conta", para: "claude/c2" },
  { nome: "atual esgotada ignora o intervalo (não dá para continuar nela)", mundo: { claude: [cl("c1", u(100)), cl("c2", u(10))] }, opc: { ultima_troca_em: AGORA - 60_000 }, motivo: "outra_conta", para: "claude/c2" },
  { nome: "operação não retomável: NUNCA troca sem confirmação, mesmo com conta livre", mundo: { claude: [cl("c1", u(90)), cl("c2", u(10))] }, opc: { operacaoNaoRetomavel: true }, motivo: "sem_alternativa", para: null, bloqueio: "operacao_nao_retomavel" },
  { nome: "operação não retomável e atual ESGOTADA: ainda assim espera confirmação", mundo: { claude: [cl("c1", u(100)), cl("c2", u(10))] }, opc: { operacaoNaoRetomavel: true }, motivo: "sem_alternativa", para: null, bloqueio: "operacao_nao_retomavel" },
  { nome: "operação não retomável com confirmação do risco: troca, com aviso", mundo: { claude: [cl("c1", u(90)), cl("c2", u(10))] }, opc: { operacaoNaoRetomavel: true, confirmouRisco: true }, motivo: "outra_conta", para: "claude/c2", aviso: "troca_interrompe_operacao_nao_retomavel" },
  { nome: "operação não retomável mas a atual está boa: nem precisa trocar", mundo: { claude: [cl("c1", u(30)), cl("c2", u(10))] }, opc: { operacaoNaoRetomavel: true }, motivo: "mesma_conta_ok", para: "claude/c1" },
  { nome: "pin da política na atual: nenhuma outra conta/provedor serve", mundo: { claude: [cl("c1", u(90)), cl("c2", u(10))], codex: [cx("x1", u(5))] }, opc: { conta_fixa_id: "c1" }, motivo: "sem_alternativa", para: null },
  // ---- abertura de Pane (trocando=false) ----
  { nome: "abertura: provedor pedido com conta boa ⇒ fica", mundo: { claude: [cl("c1", u(40))], codex: [cx("x1", u(5))] }, opc: { trocando: false, atual: { provedor: "claude", conta_id: null, modelo: "opus", faixa: "topo" } }, motivo: "mesma_conta_ok", para: "claude/c1" },
  { nome: "abertura: conta sem dado é usada (primeiro uso, sem statusline ainda)", mundo: { claude: [cl("c1", SEM)], codex: [cx("x1", u(5))] }, opc: { trocando: false, atual: { provedor: "claude", conta_id: null, modelo: "opus", faixa: "topo" } }, motivo: "mesma_conta_ok", para: "claude/c1" },
  { nome: "abertura: provedor pedido quente e Codex livre ⇒ Codex", mundo: { claude: [cl("c1", u(88))], codex: [cx("x1", u(5))] }, opc: { trocando: false, atual: { provedor: "claude", conta_id: null, modelo: "opus", faixa: "topo" } }, motivo: "outro_provedor", para: "codex/x1" },
  { nome: "abertura: provedor quente e nada melhor ⇒ usa a quente com aviso", mundo: { claude: [cl("c1", u(88))] }, opc: { trocando: false, atual: { provedor: "claude", conta_id: null, modelo: "opus", faixa: "topo" } }, motivo: "mesma_conta_ok", para: "claude/c1", confianca: "baixa", aviso: "conta_quente" },
  { nome: "abertura: provedor esgotado e Codex sem dado ⇒ Codex (última passada), confiança baixa", mundo: { claude: [cl("c1", u(100))], codex: [cx("x1", SEM)] }, opc: { trocando: false, atual: { provedor: "claude", conta_id: null, modelo: "opus", faixa: "topo" } }, motivo: "outro_provedor", para: "codex/x1", confianca: "baixa" },
  { nome: "abertura: provedor pedido não instalado ⇒ equivalente de outro", mundo: { claude: [cl("c1", u(10))], codex: [cx("x1", u(5))] }, opc: { trocando: false, provedores_viaveis: ["codex"], atual: { provedor: "claude", conta_id: null, modelo: "opus", faixa: "topo" } }, motivo: "outro_provedor", para: "codex/x1" },
  { nome: "abertura: tudo esgotado ⇒ sem alternativa", mundo: { claude: [cl("c1", u(100))], codex: [cx("x1", u(100))], gemini: [gm("g1", u(100))] }, opc: { trocando: false, atual: { provedor: "claude", conta_id: null, modelo: "opus", faixa: "topo" } }, motivo: "sem_alternativa", para: null },
  { nome: "abertura não conta salto nem exige margem", mundo: { claude: [cl("c1", u(88))], codex: [cx("x1", u(84))] }, opc: { trocando: false, saltos: 3, atual: { provedor: "claude", conta_id: null, modelo: "opus", faixa: "topo" } }, motivo: "outro_provedor", para: "codex/x1" },
  { nome: "conta atual inexistente no banco com trocando=true: procura como abertura da troca", mundo: { claude: [cl("c2", u(10))] }, opc: { atual: { provedor: "claude", conta_id: "fantasma", modelo: "opus", faixa: "topo" } }, motivo: "outra_conta", para: "claude/c2" },
];

describe("pickModel: tabela de decisão", () => {
  expect(TABELA.length).toBeGreaterThanOrEqual(45);
  it.each(TABELA.map((t) => [t.nome, t] as const))("%s", (_n, t) => {
    const r = pickModel(t.mundo, t.eq ?? PADRAO, opcoesModelo(t.opc));
    expect(r.motivo).toBe(t.motivo);
    expect(r.escolhida === null ? null : `${r.escolhida.provedor}/${r.escolhida.conta_id}`).toBe(t.para);
    if (t.confianca) expect(r.confianca).toBe(t.confianca);
    if (t.aviso) expect(r.avisos).toContain(t.aviso);
    if (t.bloqueio !== undefined) expect(r.bloqueio).toBe(t.bloqueio);
    if (t.faixa && r.escolhida) expect(r.escolhida.faixa).toBe(t.faixa);
    // sempre devolve o motivo em texto (o recibo), curto e sem segredo
    expect(r.recibo.length).toBeGreaterThan(10);
    expect(r.recibo.length).toBeLessThanOrEqual(240);
    if (r.escolhida === null) expect(r.recibo).toMatch(/Sem alternativa/);
  });
});

describe("pickModel: detalhes", () => {
  it("OpenRouter devolve a CLI compatível (a primeira da ordem de preferência) e o id do modelo", () => {
    const r = pickModel({ claude: [cl("c1", u(100))], openrouter: [orc("o1", { w: [["credit", 20, null]] })] }, comOr(modeloOr("vendor/m1", "topo", { ordem: 2 }), modeloOr("vendor/m0", "topo", { ordem: 1 })), opcoesModelo({ clis_openrouter: ["aider", "opencode"] }));
    expect(r.escolhida).toMatchObject({ provedor: "openrouter", cli: "aider", modelo: "vendor/m0", conta_id: "o1" });
  });
  it("CLIs normais: cli = id do provedor; `default` vira modelo null", () => {
    const r = pickModel({ claude: [cl("c1", u(90))], codex: [cx("x1", u(5))] }, PADRAO, opcoesModelo());
    expect(r.escolhida).toMatchObject({ provedor: "codex", cli: "codex", modelo: null, esforco: null });
  });
  it("consumo de origem e destino saem estruturados (para o troca_log); desconhecido é null, nunca 0", () => {
    const r = pickModel({ claude: [cl("c1", u(90))], codex: [cx("x1", EST(20))] }, PADRAO, opcoesModelo());
    expect(r.consumo_origem_pct).toBe(90);
    expect(r.consumo_destino_pct).toBe(20);
    const s = pickModel({ claude: [cl("c1", u(100))], codex: [cx("x1", SEM)] }, PADRAO, opcoesModelo({ trocando: false, atual: { provedor: "claude", conta_id: null, modelo: "opus", faixa: "topo" } }));
    expect(s.consumo_destino_pct).toBeNull();
    expect(s.recibo).toMatch(/sem dado de limite/);
  });
  it("tipo_troca acompanha o motivo e o recibo cita a faixa inferior", () => {
    const r = pickModel({ claude: [cl("c1", { w: [["weekly", 10, 50]], baldes: { opus: [100, 50] } })] }, PADRAO, opcoesModelo({ faixa_minima: "descer_1" }));
    expect(r.tipo_troca).toBe("faixa_inferior");
    expect(r.recibo).toMatch(/Faixa inferior/);
  });
  it("picks traz a consulta de conta por (provedor, modelo) para a Decision", () => {
    const r = pickModel({ claude: [cl("c1", u(90)), cl("c2", u(10))] }, PADRAO, opcoesModelo());
    expect(Object.keys(r.picks)).toContain("claude:opus");
    expect(r.ranking[0]).toMatchObject({ provedor: "claude", conta_id: "c2", tier: 1 });
  });
  it("recibo não vaza nada além de ids/provedor/modelo (sentinela no id da conta é só o id)", () => {
    const r = pickModel({ claude: [cl("c1", u(90)), cl("c2", u(10))] }, PADRAO, opcoesModelo());
    expect(r.recibo).not.toMatch(/sk-|Bearer|\/Users\//);
  });
});

describe("pickModel: propriedades", () => {
  const gerar = (r: () => number): { mundo: Mundo; opc: Partial<OpcoesModeloTeste> } => {
    const mundo: Mundo = {};
    const uso = (): ExtraConta => (r() < 0.12 ? SEM : r() < 0.2 ? EST(Math.round(r() * 100)) : { ...u(Math.round(r() * 100), Math.round(r() * 50)), baldes: r() < 0.3 ? { opus: [Math.round(r() * 100), 20] } : {}, cooldownH: r() < 0.08 ? 1 : null, hab: r() > 0.08 });
    for (const [prov, fab] of [["claude", cl], ["codex", cx], ["gemini", gm]] as const) {
      const n = Math.floor(r() * 4);
      mundo[prov] = Array.from({ length: n }, (_, i) => fab(`${prov[0]}${i}`, uso()));
    }
    const todas = Object.values(mundo).flat();
    const atual = mundo["claude"]?.[0];
    return {
      mundo,
      opc: {
        trocando: r() < 0.7,
        atual: { provedor: "claude", conta_id: atual?.conta_id ?? null, modelo: "opus", faixa: "topo" },
        faixa_minima: (["mesma", "descer_1", "qualquer"] as const)[Math.floor(r() * 3)] as OpcoesModeloTeste["faixa_minima"],
        saltos: Math.floor(r() * 5),
        permitir_outro_provedor: r() < 0.8,
        estrategia: r() < 0.5 ? "expires_first" : "max_slack",
        operacaoNaoRetomavel: r() < 0.2,
        excluir_contas: todas.length > 0 && r() < 0.2 ? [(todas[0] as CandidataConta).conta_id] : [],
      },
    };
  };
  it("permutar a ordem das contas (e dos provedores no mapa) não altera o resultado (500 cenários)", () => {
    const r = prng(1234);
    for (let k = 0; k < 500; k++) {
      const { mundo, opc } = gerar(r);
      const base = pickModel(mundo, PADRAO, opcoesModelo(opc));
      const perm: Mundo = {};
      for (const p of embaralhar(Object.keys(mundo), r)) perm[p] = embaralhar(mundo[p] as CandidataConta[], r);
      const b = pickModel(perm, PADRAO, opcoesModelo(opc));
      expect(b.escolhida).toEqual(base.escolhida);
      expect(b.motivo).toBe(base.motivo);
      expect(b.recibo).toBe(base.recibo);
    }
  });
  it("idempotente, sempre devolve motivo/recibo e nunca estoura max_saltos nem escolhe conta esgotada", () => {
    const r = prng(77);
    for (let k = 0; k < 500; k++) {
      const { mundo, opc } = gerar(r);
      const o = opcoesModelo(opc);
      const a = pickModel(mundo, PADRAO, o);
      expect(pickModel(mundo, PADRAO, o)).toEqual(a);
      expect(a.motivo).toBeTruthy();
      expect(a.recibo.length).toBeGreaterThan(0);
      expect(["alta", "media", "baixa"]).toContain(a.confianca);
      if (a.escolhida) {
        const c = (mundo[a.escolhida.provedor] ?? []).find((x) => x.conta_id === a.escolhida?.conta_id) as CandidataConta;
        expect(c.habilitada).toBe(true);
        for (const w of c.uso?.windows ?? []) if (w.used_pct !== null && Date.parse(w.resets_at ?? emH(1)) > AGORA) expect(w.used_pct).toBeLessThan(100);
        expect(o.excluir_contas).not.toContain(c.conta_id);
        if (o.trocando && a.motivo !== "mesma_conta_ok") {
          expect(o.saltos ?? 0).toBeLessThan(3);
          expect(o.operacaoNaoRetomavel).not.toBe(true);
        }
        if (!o.permitir_outro_provedor) expect(a.escolhida.provedor).toBe("claude");
        if (o.faixa_minima === "mesma") expect(a.escolhida.faixa).toBe("topo");
      }
    }
  });
  it("nunca sobe de faixa", () => {
    const ordem: Faixa[] = ["topo", "alto", "medio", "rapido"];
    const r = prng(5);
    for (let k = 0; k < 200; k++) {
      const { mundo, opc } = gerar(r);
      const faixa = ordem[Math.floor(r() * 4)] as Faixa;
      const modelo = faixa === "topo" ? "opus" : faixa === "rapido" ? "haiku" : "sonnet";
      const res = pickModel(mundo, PADRAO, opcoesModelo({ ...opc, atual: { provedor: "claude", conta_id: null, modelo, faixa }, trocando: false, faixa_minima: "qualquer" }));
      if (res.escolhida) expect(ordem.indexOf(res.escolhida.faixa)).toBeGreaterThanOrEqual(ordem.indexOf(faixa));
    }
  });
  it("2 e 3 contas a 86–90% não geram laço (CT-9.21/9.22): a troca só acontece com margem", () => {
    const mundo: Mundo = { claude: [cl("c1", u(86)), cl("c2", u(88)), cl("c3", u(90))] };
    for (const id of ["c1", "c2", "c3"]) {
      const r = pickModel(mundo, PADRAO, opcoesModelo({ atual: { provedor: "claude", conta_id: id, modelo: "opus", faixa: "topo" }, provedores_viaveis: ["claude"] }));
      expect(r.escolhida).toBeNull();
    }
  });
});

describe("pickModel: fronteira", () => {
  it("só importa tipos, escolher-conta, a consulta pura de equivalencia e o formatador de recibo", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync(new URL("./escolher-modelo.ts", import.meta.url), "utf8");
    const runtime = [...fonte.matchAll(/^import\s+(?!type\s)[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(runtime.sort()).toEqual(["./equivalencia", "./escolher-conta", "./recibo"]);
    const codigo = fonte.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(codigo).not.toMatch(/Date\.now|Math\.random|new Date\(\)/);
    expect(codigo).not.toMatch(/node:fs|fetch\(/);
    expect(H).toBe(3_600_000);
  });
  it("não existe segunda implementação de escolha de conta: só escolher-conta.ts ordena por reset/uso", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync(new URL("./escolher-modelo.ts", import.meta.url), "utf8");
    expect(fonte).not.toMatch(/resets_at|expires_first.*sort|slack_pct/);
  });
});
