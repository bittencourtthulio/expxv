// Detecção da suíte ExpxDev por workspace (D-471). Barata (um `stat` por skill + a leitura do lock), local e SOMENTE LEITURA:
// reaproveita `lerLockDoProjeto` do observador do método (Fase 4). Nenhuma rede, nenhum processo.
import { access, constants, stat } from "node:fs/promises";
import { join } from "node:path";
import { lerLockDoProjeto } from "../metodo/instalacao";
import { ARQUIVO_LOCK, LOCK_SUITE_SUPORTADO, SKILLS_DA_SUITE, VERSAO_MINIMA_SUITE, compararVersoes, type EstadoSuiteId } from "./modelo";

export interface ResultadoDeteccaoSuite {
  estado: EstadoSuiteId;
  motivo: string;
  versao_instalada: string | null;
  skills_presentes: string[];
  skills_faltando: string[];
}

export interface OpcoesDeteccaoSuite {
  /** a pasta aceita escrita? (padrão: `access(W_OK)`) */
  gravavel?: (raiz: string) => Promise<boolean>;
  /** `node` e `npm` existem no PATH do app? (padrão: assume que sim; o main injeta a checagem real) */
  nodeDisponivel?: () => boolean;
  versaoMinima?: string;
}

const gravavelPadrao = async (raiz: string): Promise<boolean> => {
  try { await access(raiz, constants.W_OK); return true; } catch { return false; }
};

async function temSkill(raiz: string, nome: string): Promise<boolean> {
  try { return (await stat(join(raiz, ".claude", "skills", nome, "SKILL.md"))).isFile(); } catch { return false; }
}

/** Ordem de decisão: lock + skills dizem o que está instalado; depois, se precisar instalar e não der, vira `indisponivel`. */
export async function detectarSuite(raiz: string, opcoes: OpcoesDeteccaoSuite = {}): Promise<ResultadoDeteccaoSuite> {
  const minima = opcoes.versaoMinima ?? VERSAO_MINIMA_SUITE;
  const [{ lock }, presencas] = await Promise.all([lerLockDoProjeto(raiz), Promise.all(SKILLS_DA_SUITE.map((n) => temSkill(raiz, n)))]);
  const skills_presentes = SKILLS_DA_SUITE.filter((_, i) => presencas[i]);
  const skills_faltando = SKILLS_DA_SUITE.filter((_, i) => !presencas[i]);
  const noLock = new Set(lock.skills.map((s) => s.nome));
  const base = { versao_instalada: lock.versao_cli, skills_presentes, skills_faltando };

  let estado: EstadoSuiteId;
  let motivo: string;
  if (!lock.presente && skills_presentes.length === 0) {
    estado = "ausente";
    motivo = "A suíte ExpxDev não está instalada neste projeto.";
  } else if (!lock.presente) {
    estado = "incompleta";
    motivo = `Faltam o arquivo de controle (${ARQUIVO_LOCK}) e ${skills_faltando.length} skill(s).`;
  } else if (!lock.legivel || lock.versao_lock === null || lock.versao_cli === null) {
    estado = "incompleta";
    motivo = "O arquivo de controle da suíte está ilegível ou corrompido.";
  } else if (skills_faltando.length > 0) {
    estado = "incompleta";
    motivo = `Faltam ${skills_faltando.length} skill(s): ${skills_faltando.join(", ")}.`;
  } else if (SKILLS_DA_SUITE.some((n) => !noLock.has(n))) {
    estado = "incompleta";
    motivo = "O arquivo de controle não lista todas as skills da suíte.";
  } else if (lock.versao_lock <= LOCK_SUITE_SUPORTADO && (compararVersoes(lock.versao_cli, minima) ?? 0) < 0) {
    estado = "desatualizada";
    motivo = `A suíte instalada (${lock.versao_cli}) é mais antiga que a ${minima}.`;
  } else {
    estado = "completa";
    motivo = "A suíte ExpxDev está instalada.";
  }

  if (estado !== "completa") {
    const gravavel = await (opcoes.gravavel ?? gravavelPadrao)(raiz);
    if (!gravavel) return { ...base, estado: "indisponivel", motivo: "Não há permissão de escrita nesta pasta: a suíte não pode ser instalada aqui." };
    if (opcoes.nodeDisponivel !== undefined && !opcoes.nodeDisponivel()) return { ...base, estado: "indisponivel", motivo: "O Node.js/npm não foi encontrado nesta máquina: instale o Node para instalar a suíte." };
  }
  return { ...base, estado, motivo };
}
