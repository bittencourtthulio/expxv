// Catálogo das nove skills da suíte ExpxDev (puro: o renderer importa daqui sem puxar módulos do Node).

/**
 * As nove skills do catálogo do `expxdev` 0.9.0 (mesma ordem da seleção do `init`), com o papel de cada uma. Cada uma grava `.claude/skills/<nome>/SKILL.md`.
 * É a lista CONHECIDA do app: a lista passada ao instalador é a interseção desta com o catálogo REAL da versão baixada (`lerCatalogoDoPacote`).
 */
export const CATALOGO_SUITE: ReadonlyArray<{ nome: string; papel: string }> = [
  { nome: "sprintx", papel: "planeja e executa features novas" },
  { nome: "runx", papel: "ocorrências de manutenção do dia a dia" },
  { nome: "legadox", papel: "camada para projetos legados" },
  { nome: "stackx", papel: "descobre o dialeto técnico do repositório" },
  { nome: "mergex", papel: "versionamento, entrega e revisão de pull requests" },
  { nome: "memox", papel: "memória do projeto: indexa os artefatos já fechados" },
  { nome: "prodx", papel: "camada de produto: decide se o pedido vira trabalho" },
  { nome: "buildx", papel: "orquestra um projeto inteiro, da descrição ao sistema pronto" },
  { nome: "designx", papel: "camada de design: cartografa e audita o design system" },
];
export const SKILLS_DA_SUITE: readonly string[] = CATALOGO_SUITE.map((s) => s.nome);
