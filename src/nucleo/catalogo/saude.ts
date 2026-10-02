// Saúde do catálogo (T-07.24). Puro: recebe os itens e as políticas já lidos e devolve achados. `erro` não bloqueia nada (a Missão segue e o Pane ignora a skill
// ausente); serve para a pessoa corrigir ANTES do primeiro `pane_spawn`.
import type { AchadoSaude, CliCatalogo, ItemCatalogo, NivelIsolamento, PoliticaSkills } from "../../compartilhado/catalogo";
import { normalizarNome } from "./normalizar";

export interface EntradaSaude {
  politicas: readonly PoliticaSkills[];
  /** itens dos tipos skill e mcp_server (basta o que a tela já listou) */
  itens: readonly ItemCatalogo[];
  /** nomes normalizados de skills com ao menos uma instalação presente */
  skillsPresentes: ReadonlySet<string>;
  /** ids de itens `mcp_server` cujas ferramentas já foram verificadas */
  mcpVerificados: ReadonlySet<string>;
  /** nome (normalizado) de servidores da Loja habilitados, para validar `servidores_mcp` */
  servidoresConhecidos?: ReadonlySet<string>;
  /** CLIs em uso e o nível de isolamento de cada uma (do módulo de política) */
  niveis: Readonly<Record<CliCatalogo, NivelIsolamento>>;
  clisEmUso: readonly CliCatalogo[];
}

const LIMITE_ACHADOS = 200;

export function avaliarSaude(e: EntradaSaude): AchadoSaude[] {
  const a: AchadoSaude[] = [];
  const add = (x: AchadoSaude): void => {
    if (a.length < LIMITE_ACHADOS) a.push(x);
  };
  for (const p of e.politicas) {
    for (const s of p.skills) {
      if (s.startsWith("grupo:")) continue;
      if (!e.skillsPresentes.has(normalizarNome(s))) add({ nivel: "erro", codigo: "skill_inexistente", item: s.slice(0, 80), detalhe: `A política de ${p.alvo_tipo} "${p.alvo_valor.slice(0, 40)}" cita uma skill que não existe nesta máquina.` });
    }
    if (e.servidoresConhecidos !== undefined) {
      for (const m of p.servidores_mcp) {
        if (!e.servidoresConhecidos.has(normalizarNome(m))) add({ nivel: "erro", codigo: "politica_referencia_ausente", item: m.slice(0, 80), detalhe: `A política de ${p.alvo_tipo} "${p.alvo_valor.slice(0, 40)}" cita um servidor MCP que não está disponível.` });
      }
    }
  }
  for (const it of e.itens) {
    if (it.tipo === "skill" && (it.descricao === null || it.descricao === "") && it.instalacoes.some((i) => i.estado === "presente")) add({ nivel: "aviso", codigo: "descricao_vazia", item: it.nome, detalhe: "Sem descrição: o agente tem menos como escolher esta skill." });
    if (it.instalacoes.some((i) => i.estado === "quebrado")) add({ nivel: "erro", codigo: "symlink_quebrado", item: it.nome, detalhe: "A instalação aponta para algo que não existe ou está fora das pastas permitidas." });
    if (it.variantes > 1) add({ nivel: "aviso", codigo: "variantes_divergentes", item: it.nome, detalhe: `Há ${it.variantes} versões diferentes desta skill entre as CLIs.` });
    if (it.tipo === "mcp_server" && !e.mcpVerificados.has(it.id)) add({ nivel: "aviso", codigo: "mcp_nao_verificado", item: it.nome, detalhe: "As ferramentas deste servidor ainda não foram verificadas." });
  }
  for (const cli of e.clisEmUso) {
    if (e.niveis[cli] !== "duro") add({ nivel: "aviso", codigo: "isolamento_parcial", item: cli, detalhe: `O isolamento de skills no ${cli} é parcial: a restrição vale como instrução e no gate de MCP, não por bloqueio da CLI.` });
  }
  return a;
}
