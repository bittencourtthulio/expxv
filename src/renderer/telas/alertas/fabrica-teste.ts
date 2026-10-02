// Fábrica de `window.ade.alertas` falso para os testes jsdom (só em testes).
import { vi } from "vitest";
import type { AlertaVisao, ApiAlertas, CanalVisao, EstadoTelegram, MetaTipoVisao, Regra } from "../../../compartilhado/alertas";

export const alertaFalso = (id: string, extra: Partial<AlertaVisao> = {}): AlertaVisao => ({
  id, tipo: "tarefa_concluida", severidade: "sucesso", fonte: "metodo", workspace_id: "w1", mission_id: null, entidade_tipo: "task", entidade_id: "T-1", titulo: `Alerta ${id}`, dados: {}, dedupe_chave: id,
  contagem: 1, criado_em: "2026-10-01T10:00:00.000Z", atualizado_em: "2026-10-01T10:00:00.000Z", lido_em: null, silenciado_ate: null, arquivado_em: null, ...extra,
});
export const canalFalso = (extra: Partial<CanalVisao> = {}): CanalVisao => ({
  id: "c-tg", tipo: "telegram", nome: "Telegram", estado: "desligado", resumo: "", saida_ligada: false, entrada_ligada: false, consentimento: null, silenciado_ate: null, erro_codigo: null,
  capacidades: { entrada: true, botoes: true, formato: "html", precisa_consentimento: true }, ...extra,
});
export const CATALOGO_FALSO: MetaTipoVisao[] = [
  { tipo: "tarefa_concluida", rotulo: "Tarefa concluída", severidade: "sucesso", fonte: "metodo", agrupavel: true, externo_por_padrao: true, fonte_indisponivel: false },
  { tipo: "tarefa_atrasada", rotulo: "Tarefa atrasada", severidade: "aviso", fonte: "metodo", agrupavel: false, externo_por_padrao: true, fonte_indisponivel: false },
  { tipo: "pr_aberto", rotulo: "PR aberto", severidade: "info", fonte: "vcs", agrupavel: true, externo_por_padrao: true, fonte_indisponivel: true },
  { tipo: "agente_mensagem", rotulo: "Mensagem de agente", severidade: "info", fonte: "agente", agrupavel: true, externo_por_padrao: false, fonte_indisponivel: false },
];
export const estadoTelegramFalso = (extra: Partial<EstadoTelegram> = {}): EstadoTelegram => ({
  canal: canalFalso(), bot: null, token_mascarado: null, cofre_disponivel: true,
  texto_consentimento: { versao_texto: "tg-1", hash_texto: "h", host: "api.telegram.org", texto: "Os alertas serão enviados para api.telegram.org. O Telegram consegue ler as mensagens.", itens: ["Tarefa concluída"] },
  passos_botfather: ["Procure @BotFather.", "Envie /newbot."], poller: { estado: "parado", ultimo_poll_em: null, conflito: false },
  pareamento: { estado: "inativo", expira_em: null, pedido: null }, autorizados: [], contadores: { nao_autorizados: 0, planos_pendentes: 0 }, ...extra,
});

export type ApiEspia = ApiAlertas & { emitir: Record<string, (x: never) => void> };

export function apiAlertasFalsa(o: { alertas?: AlertaVisao[]; telegram?: EstadoTelegram; canais?: CanalVisao[]; regras?: Regra[]; listarErro?: boolean } = {}): ApiEspia {
  const cbs: Record<string, (x: never) => void> = {};
  const assinar = (nome: string) => vi.fn((cb: (x: never) => void) => { cbs[nome] = cb; return () => { delete cbs[nome]; }; });
  const alertas = o.alertas ?? [];
  let tg = o.telegram ?? estadoTelegramFalso();
  const canais = o.canais ?? [canalFalso({ id: "c-so", tipo: "so", nome: "Sistema", estado: "ativo", saida_ligada: true, capacidades: { entrada: false, botoes: false, formato: "texto", precisa_consentimento: false } }), tg.canal];
  const api = {
    catalogo: vi.fn(async () => CATALOGO_FALSO),
    listar: vi.fn(async (f: { depois_id: string | null; limite?: number }) => {
      if (o.listarErro === true) throw new Error("falha de leitura");
      const ini = f.depois_id === null ? 0 : alertas.findIndex((a) => a.id === f.depois_id) + 1;
      const itens = alertas.slice(ini, ini + (f.limite ?? 100));
      return { itens, proximo: ini + itens.length < alertas.length ? (itens[itens.length - 1]?.id ?? null) : null };
    }),
    contar: vi.fn(async () => ({ nao_lidos: alertas.length, criticos: 0 })),
    marcarLido: vi.fn(async (ids: string[]) => ({ n: ids.length })),
    marcarTodosLidos: vi.fn(async () => ({ n: alertas.length })),
    silenciar: vi.fn(async () => ({ ok: true })),
    regrasListar: vi.fn(async () => o.regras ?? []),
    regraGravar: vi.fn(async (r: Regra) => ({ ...r, id: r.id ?? "r1" })),
    regraApagar: vi.fn(async () => ({ ok: true })),
    regraPreset: vi.fn(async (preset: string, canalId: string) => ({ id: "rp", nome: preset, ativa: true, tipos: ["*"], canal_id: canalId, filtros: {}, silencio: {}, agrupamento: { modo: "imediato" }, nivel: "minimo", efemera_ate: null, origem: "padrao" })),
    silencioLer: vi.fn(async () => ({ janela: {}, temporario_ate: null, temporario_incluir_criticos: false })),
    silencioGravar: vi.fn(async (s: unknown) => s),
    modelosListar: vi.fn(async () => [{ tipo: "tarefa_concluida", canal_tipo: "telegram", nivel: "minimo", corpo: "<b>{{titulo}}</b>", editado: false, atualizado_em: null }]),
    modeloGravar: vi.fn(async (m: { tipo: string; canal_tipo: string; nivel: string; corpo: string }) => (m.corpo.includes("{{xx}}") ? { erros: ["Campo desconhecido: xx"] } : { ...m, editado: true, atualizado_em: "2026-10-01T10:00:00Z" })),
    modeloRestaurar: vi.fn(async (m: { tipo: string; canal_tipo: string; nivel: string }) => ({ ...m, corpo: "<b>{{titulo}}</b>", editado: false, atualizado_em: null })),
    modeloPrever: vi.fn(async (m: { corpo: string }) => (m.corpo.includes("{{xx}}") ? { texto: "", tamanho_visivel: 0, erros: ["Campo desconhecido: xx"] } : { texto: m.corpo.replace("{{titulo}}", "Corrigir login"), tamanho_visivel: m.corpo.length, erros: [] })),
    configLer: vi.fn(async () => ({})),
    configGravar: vi.fn(async () => ({})),
    abrirEntidade: vi.fn(async () => ({ ok: true, destino: { tipo: "task", workspace_id: "w1", entidade_id: "T-1" } })),
    canais: {
      listar: vi.fn(async () => canais),
      consentir: vi.fn(async (id: string, v: string) => { tg = { ...tg, canal: { ...tg.canal, consentimento: { versao_texto: v, aceito_em: "2026-10-01T10:00:00Z", host: "api.telegram.org" } } }; return tg.canal; }),
      ligarSaida: vi.fn(async (id: string) => ({ ...(canais.find((c) => c.id === id) as CanalVisao), saida_ligada: true })),
      desligarSaida: vi.fn(async (id: string) => ({ ...(canais.find((c) => c.id === id) as CanalVisao), saida_ligada: false })),
      testeEnvio: vi.fn(async () => ({ ok: true, detalhe: "ok" })),
    },
    telegram: {
      estado: vi.fn(async () => tg),
      tokenTestar: vi.fn(async () => ({ ok: true, bot: { id: 1, username: "meu_bot", nome: "Meu Bot" } })),
      tokenSalvar: vi.fn(async () => { tg = { ...tg, token_mascarado: "1234…:AA…xyz", bot: { id: 1, username: "meu_bot", nome: "Meu Bot" } }; return { ok: true, token_mascarado: "1234…:AA…xyz", bot: { id: 1, username: "meu_bot", nome: "Meu Bot" } }; }),
      tokenRemover: vi.fn(async () => ({ ok: true })),
      webhookLimpar: vi.fn(async () => ({ ok: true })),
      comandosConfigurar: vi.fn(async () => ({ ok: true })),
      parearIniciar: vi.fn(async () => ({ codigo: "ABCDE23456", link: "https://t.me/meu_bot?start=ABCDE23456", expira_em: new Date(Date.now() + 300_000).toISOString() })),
      parearCancelar: vi.fn(async () => ({ ok: true })),
      parearDecidir: vi.fn(async () => null),
      autorizadoConfig: vi.fn(async () => ({ ok: true })),
      autorizadoRevogar: vi.fn(async () => ({ ok: true })),
      naoAutorizadoListar: vi.fn(async () => []),
      naoAutorizadoBloquear: vi.fn(async () => ({ ok: true })),
      entradaLigar: vi.fn(async () => ({ ok: true, estado: tg })),
      retomar: vi.fn(async () => tg),
      panico: vi.fn(async () => ({ ok: true, revogados: 1 })),
      planoDecidirDesktop: vi.fn(async () => ({ ok: true })),
      auditoriaListar: vi.fn(async () => ({ itens: [], proximo: null })),
      auditoriaExportar: vi.fn(async () => ({ ok: true })),
    },
    assinarNovo: assinar("novo"), assinarContagem: assinar("contagem"), assinarMudou: assinar("mudou"), assinarCanal: assinar("canal"), assinarPareamento: assinar("par"), assinarTelegram: assinar("tg"), assinarPlanoPendente: assinar("plano"),
    emitir: cbs,
  };
  return api as unknown as ApiEspia;
}
