import type { ConfigAgil } from "../../../compartilhado/agil";
import { ESCALAS } from "./escalas";

/** Padrões de fábrica (D-182..D-185, D-183: janela 14 dias). Sempre devolve cópia nova. */
export function configPadrao(): ConfigAgil {
  return structuredClone<ConfigAgil>({
    escala_id: "fibonacci",
    escalas: [...ESCALAS],
    categorias: ["feature", "bug", "refator", "infra", "doc", "spike", "teste", "divida"],
    pontos_base_tipo: { config: 2, client: 3, dominio: 3, persistencia: 3, api: 3, ui: 3, integracao_externa: 5, teste: 2, infra: 3, refatoracao: 3 },
    risco_pesos: {
      raio_alto: 3, zona_risco_historica: 2, sem_cobertura: 2, integracao_externa: 2, migracao_schema: 2, sensivel_dominio: 3,
      contrato_publico: 2, dependencias_muitas: 1, tamanho_grande: 1, historico_retrabalho_area: 2, lacuna_aberta: 1, sem_criterio_aceite: 1,
    },
    risco_faixas: { medio: 3, alto: 6, critico: 9 },
    termos_sensiveis: ["auth", "autenticacao", "login", "senha", "pagamento", "cobranca", "lgpd", "permissao", "fiscal", "nota fiscal", "criptografia", "token", "segredo"],
    categorias_criticas: ["bug"],
    dod: [
      { codigo: "suite_verde", descricao: "suíte da task verde", auto: true },
      { codigo: "testes_minimos", descricao: "ao menos 2 testes (integração e funcional) e regressão se bug", auto: true },
      { codigo: "qa_aprovado", descricao: "QA aprovado", auto: true },
      { codigo: "sem_segredo", descricao: "sem segredo no diff", auto: false },
      { codigo: "commit_por_task", descricao: "commit por task (mergex)", auto: true },
      { codigo: "sem_regra_violada", descricao: "sem regra violada aberta", auto: true },
    ],
    dor: [
      { codigo: "criterio_aceite", descricao: "critério de aceite presente", auto: true },
      { codigo: "estimado", descricao: "estimativa definida", auto: true },
      { codigo: "risco_classificado", descricao: "risco classificado", auto: true },
      { codigo: "dependencias_ok", descricao: "dependências satisfeitas", auto: true },
      { codigo: "tamanho_ok", descricao: "até 13 pontos", auto: true },
      { codigo: "sem_lacuna", descricao: "sem lacuna aberta", auto: true },
    ],
    wip: {},
    estimativa_modo: "ia_sugere",
    estimativa_max_chamadas_dia: 40,
    estimativa_lote: 20,
    perfil_estimador: "rapido",
    confianca_aceite_lote: 0.6,
    janela_retrabalho_dias: 14,
    dias_uteis: [1, 2, 3, 4, 5],
    feriados: [],
    limiares_saude: { progresso_amarelo: 0.2, progresso_vermelho: 0.35, escopo_adicionado: 0.2, ftr_queda_pontos: 0.1, compromisso_vs_capacidade: 1, risco_critico_max: 2 },
    padroes_teste: [".test.", ".spec.", "/tests/", "/test/", "__tests__", "_test.go", "test_"],
    natureza: {
      prefixos_defeito: ["fix", "hotfix", "bugfix", "revert"],
      prefixos_escopo: ["feat", "feature"],
      prefixos_ruido: ["docs", "doc", "chore", "style", "ci", "build", "test", "tests"],
      palavras_defeito: ["fix", "hotfix", "bugfix", "revert", "corrige", "corrigir", "corrigido", "bug", "erro", "falha", "quebrado"],
      palavras_escopo: ["novo requisito", "mudanca de requisito", "mudança de requisito", "adiciona", "novo campo", "nova opcao", "nova opção"],
      palavras_ruido: ["typo", "ortografia", "formatacao", "formatação", "comentario", "comentário", "lint"],
    },
    buffer_planejamento: 0.2,
    horas_dia_padrao: 6,
    fator_foco_padrao: 0.6,
    commit_grande_linhas: 400,
    fechar_automatico: false,
    amostra_minima: 5,
  });
}
