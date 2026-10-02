// T-16.05 · Léxico PT-BR/EN do classificador de intenção (DADO versionado; o corpus de aceite manda nos pesos).
// Termos já normalizados (sem acento, minúsculas). Tipos: `p` prefixo (começa a palavra), `w` palavra/frase inteira, `r` regex
// (sobre o texto normalizado; sem quantificador aninhado). `d` = sinal de DEFEITO (usado em B3/B5). Cada entrada conta uma vez.
// Decisão: dado em .ts (e não .json) para ter tipo e para não depender de `resolveJsonModule` no bundle do main.
import type { Intencao } from "../../../compartilhado/maestro";

export type TipoTermo = "prefixo" | "palavra" | "regex";
export interface EntradaLexico {
  id: string;
  intencao: Exclude<Intencao, "desconhecida">;
  termo: string;
  tipo: TipoTermo;
  peso: number;
  /** é sinal de defeito (bug). */
  defeito: boolean;
}

type T = [termo: string, peso: number, defeito?: true];
interface Grupo {
  p?: T[];
  w?: T[];
  r?: T[];
}

const BUG: Grupo = {
  p: [["bug", 4, true], ["correc", 2.5], ["consert", 3], ["arrum", 3], ["quebr", 3, true], ["trav", 2.5, true], ["crash", 3, true], ["erro", 2, true], ["falh", 2, true], ["exception", 2.5, true], ["regress", 2.5, true], ["defeito", 3, true], ["problema", 1.5], ["desaparec", 2.5, true], ["bugad", 3, true], ["inconsistenc", 1.5, true], ["fail", 2, true]],
  w: [
    ["corrige", 3], ["corrigir", 3], ["corrija", 3], ["corrigindo", 3], ["corrigi", 3], ["bugs", 4, true], ["resolve o problema", 3], ["resolver o problema", 3], ["problema em", 3], ["problema no", 3], ["problema na", 3], ["estou com um problema", 3], ["estou com problema", 3], ["estamos com um problema", 3], ["tenho um problema", 3], ["esta com problema", 2.5],
    ["nao funciona", 3, true], ["nao esta funcionando", 3, true], ["nao funcionou", 3, true], ["nao funcionando", 3, true], ["parou de funcionar", 3, true], ["parou de", 2, true], ["nao salva", 3, true], ["nao abre", 2.5, true], ["nao carrega", 2.5, true], ["nao aparece", 2, true], ["nao consigo", 2], ["nao roda", 3, true], ["nao compila", 3, true], ["nao grava", 3, true], ["nao envia", 2.5, true], ["nao exporta", 2.5, true],
    ["dando erro", 3, true], ["deu erro", 3, true], ["da erro", 3, true], ["error", 2, true], ["errors", 2, true], ["stack trace", 2.5, true], ["stacktrace", 2.5, true], ["valor errado", 3, true], ["errado", 2, true], ["resultado errado", 3, true], ["calcula errado", 3, true], ["calculo errado", 3, true],
    ["sumiu", 2.5, true], ["some da tela", 3, true], ["tela branca", 3, true], ["tela em branco", 3, true], ["regression", 3, true], ["fix", 3], ["fixes", 3], ["broken", 3, true], ["doesnt work", 3, true], ["not working", 4, true], ["does not work", 3, true], ["isnt working", 3, true], ["stopped working", 3, true], ["wont work", 3, true], ["wont compile", 3, true], ["failing", 2, true], ["hotfix", 3],
    ["ocorrencia", 2], ["undefined", 1.5, true], ["null pointer", 3, true], ["nullpointer", 3, true], ["segfault", 3, true], ["timeout", 1.5, true], ["vazamento de memoria", 3, true], ["memory leak", 3, true], ["loop infinito", 3, true], ["infinite loop", 3, true], ["com defeito", 3, true], ["build quebrou", 3, true], ["teste falhando", 3, true], ["nao termina", 2.5, true], ["fica carregando", 2.5, true], ["duplica", 1.5], ["duplicando", 2, true],
  ],
  r: [["erro (4|5)[0-9][0-9]", 3, true], ["status (4|5)[0-9][0-9]", 2.5, true]],
};

const FEATURE: Grupo = {
  p: [["implement", 3], ["adicion", 2.5], ["acrescent", 3.5], ["funcionalidade", 2.5], ["integra", 2.5], ["permit", 2], ["possibilit", 2], ["export", 2], ["import", 2], ["habilit", 2], ["criar", 1.5], ["incluir", 1.5], ["inclua", 1.5]],
  w: [
    ["add", 2], ["feature", 3], ["nova tela", 3], ["novo recurso", 3], ["novo campo", 3], ["novo botao", 3], ["nova opcao", 2.5], ["nova rota", 3], ["novo endpoint", 3], ["novo relatorio", 3], ["nova pagina", 3], ["novo filtro", 3], ["nova coluna", 3], ["nova funcionalidade", 3.5], ["novas funcionalidades", 3.5],
    ["integracao com", 3], ["integra com", 3.5], ["suporte a", 2.5], ["suporte para", 2.5], ["support for", 2.5], ["add support", 3], ["add a", 2.5], ["add an", 2.5], ["quero que o sistema", 3], ["quero que", 1.5], ["gostaria que", 3.5], ["preciso que", 1.5], ["new feature", 3.5], ["i want", 1.5], ["we need", 1.5], ["ability to", 2.5], ["let users", 2.5], ["allow users", 2.5], ["permita", 2], ["permitir", 2],
    ["criar um botao", 3], ["criar uma tela", 3], ["criar um campo", 3], ["criar um endpoint", 3], ["criar uma api", 3], ["criar um relatorio", 3], ["criar uma pagina", 3], ["criar um filtro", 3], ["cria um botao", 3], ["cria uma tela", 3], ["cria um campo", 3], ["cria um endpoint", 3], ["cria uma api", 3], ["cria um relatorio", 3], ["cria uma pagina", 3], ["cria um filtro", 3],
    ["csv", 1.5], ["dark mode", 3], ["modo escuro", 3], ["login com", 2.5], ["cadastro de", 1.5], ["adicionar", 2.5], ["implementar", 3], ["implementa", 3], ["create a", 1.5], ["suporte", 1],
  ],
};

const REFATORACAO: Grupo = {
  p: [["refator", 4], ["refactor", 4], ["legado", 3], ["reorganiz", 2.5], ["reestrutur", 3], ["restructur", 3], ["desacopl", 3], ["modulariz", 3], ["modernizar", 3], ["modernize", 3], ["extrair", 2.5], ["extract", 2.5], ["renomear", 2], ["simplific", 2]],
  w: [
    ["legacy", 3], ["limpar codigo", 3], ["limpar o codigo", 3], ["limpa esse codigo", 3], ["limpa o codigo", 3], ["clean up", 3], ["cleanup", 3], ["sem testes", 2.5], ["ninguem mexe", 3], ["ninguem quer mexer", 3], ["divida tecnica", 3.5], ["tech debt", 3.5], ["technical debt", 3.5],
    ["migrar de", 3], ["migracao de framework", 3.5], ["migrar para", 2.5], ["reduzir acoplamento", 3.5], ["reduzir o acoplamento", 3.5], ["acoplamento", 2], ["duplicacao", 2.5], ["codigo duplicado", 3], ["codigo spaghetti", 3], ["espaguete", 3], ["legibilidade", 3], ["melhorar o codigo", 3], ["sem mudar o comportamento", 4], ["sem alterar o comportamento", 4],
    ["rename", 2], ["simplify", 2], ["god class", 3], ["classe gigante", 3], ["arquivo gigante", 3], ["funcao gigante", 3], ["caracterizacao", 2.5], ["organizar o codigo", 3], ["organizar o modulo", 3],
  ],
};

const PEDIDO: Grupo = {
  p: [["chamado", 3], ["solicitac", 3], ["ideia", 3], ["sugest", 2.5], ["reclamac", 3], ["reclamou", 3]],
  w: [
    ["vale a pena", 4], ["seria bom", 3.5], ["seria legal", 3], ["seria interessante", 3], ["o cliente pediu", 4], ["cliente pediu", 4], ["cliente quer", 3], ["o cliente", 1.5], ["ja existe", 3.5], ["faz sentido", 3], ["devemos", 2], ["deveriamos", 2.5],
    ["would be nice", 3.5], ["worth it", 3.5], ["worth", 2], ["it would be great", 3], ["o suporte pediu", 3.5], ["suporte pediu", 3.5], ["um usuario pediu", 3.5], ["usuario pediu", 3.5], ["usuarios pedem", 3], ["sera que", 2], ["ticket", 2.5], ["customer asked", 3.5], ["customer wants", 3], ["users want", 3], ["feature request", 5],
    ["pedido de", 2], ["nao sei se", 2], ["avaliar se", 3], ["vale o esforco", 3.5], ["ja temos", 2.5], ["existe alguma", 2.5], ["gostaria de saber se", 3], ["o cliente reclamou", 3.5], ["ja tem", 2],
  ],
};

const PROJETO: Grupo = {
  p: [["plataforma", 2.5]],
  w: [
    ["do zero", 4], ["sistema inteiro", 4], ["sistema completo", 4], ["projeto inteiro", 4], ["projeto novo", 3.5], ["novo projeto", 3.5], ["quero um sistema", 4], ["preciso de um sistema", 4], ["monta um app", 4], ["monte um app", 4], ["monta um sistema", 4], ["monte um sistema", 4], ["construa um", 3], ["construir um sistema", 4], ["criar um sistema", 4], ["cria um sistema", 4], ["desenvolver um sistema", 4],
    ["um sistema de", 3], ["um sistema para", 3], ["app de", 2.5], ["aplicativo de", 2.5], ["aplicativo", 1.5], ["build me a", 4], ["from scratch", 4], ["whole system", 4], ["full app", 3], ["saas", 2.5], ["mvp", 2.5], ["marketplace", 2], ["ecommerce", 2.5], ["e commerce", 2.5], ["um crm", 3], ["um erp", 3], ["novo sistema", 3.5], ["sistema novo", 3.5], ["criar uma plataforma", 4], ["create an app", 3], ["build an app", 3], ["build a platform", 3.5], ["build a system", 3.5], ["do inicio ao fim", 3], ["ponta a ponta", 2.5], ["um app", 2], ["um sistema", 2],
  ],
};

const ENTREGA: Grupo = {
  p: [["entreg", 3], ["commit", 2.5], ["versionar", 3], ["merg", 2]],
  w: [
    ["abre o pr", 4], ["abrir pr", 4], ["abrir o pr", 4], ["abra o pr", 4], ["pull request", 4], ["pr", 2], ["subir a branch", 4], ["sobe a branch", 4], ["suba a branch", 4], ["push", 2.5], ["merge", 2.5], ["mergex", 5], ["prepara a entrega", 5], ["preparar a entrega", 5], ["passar para o qa", 4], ["manda para o qa", 4], ["mandar pro qa", 4], ["manda pro qa", 4],
    ["revisar o pr", 4], ["revisa o pr", 4], ["review the pr", 4], ["open a pr", 4], ["open pr", 4], ["create a pr", 4], ["ship it", 3], ["ship", 2], ["release", 2.5], ["deploy", 2.5], ["publicar", 2], ["branch", 1.5], ["abre uma pr", 4], ["abrir uma pr", 4], ["cria o pr", 4], ["criar o pr", 4], ["criar pr", 4], ["gerar o pr", 4], ["descricao do pr", 4], ["pacote do qa", 4], ["pacote de qa", 4], ["commitar as tasks", 4], ["commit das tasks", 4],
  ],
};

const DUVIDA: Grupo = {
  p: [["explic", 3.5], ["duvida", 3], ["entender", 2]],
  w: [
    ["como funciona", 3.5], ["como funcionam", 3.5], ["onde fica", 3], ["onde esta", 3], ["onde esta definido", 3.5], ["o que faz", 3], ["o que e", 2.5], ["o que sao", 2.5], ["qual e", 2], ["quais sao", 2], ["por que", 2], ["pq", 1], ["how does", 3.5], ["how do", 2.5], ["where is", 3.5], ["what does", 3.5], ["what is", 2.5], ["why does", 3], ["why is", 3],
    ["can you explain", 3.5], ["me explica", 3.5], ["pode me explicar", 3.5], ["me ajuda a entender", 3.5], ["quero entender", 3.5], ["como e que", 2.5], ["qual a diferenca", 3.5], ["diferenca entre", 3], ["onde e usado", 3], ["onde e chamado", 3.5], ["quem chama", 3], ["quem usa", 2.5], ["who calls", 3], ["me mostra onde", 3], ["mostre onde", 3], ["em que arquivo", 3.5], ["which file", 3], ["walk me through", 3.5], ["o que significa", 3.5], ["what does this mean", 3.5],
  ],
};

const HISTORICO: Grupo = {
  p: [["historico", 3], ["lembra", 2]],
  w: [
    ["o que ja fizemos", 6], ["o que fizemos", 5], ["ja fizemos", 4.5], ["ja foi implementado", 5], ["ja foi feito", 4.5], ["ja corrigimos", 5], ["ja corrigiram", 4], ["houve regressao", 5], ["teve regressao", 5], ["quando mudou", 5], ["quando foi", 3], ["quem mudou", 5], ["ja tentamos", 4], ["o que mudou", 4.5], ["ultimas mudancas", 3.5],
    ["last time", 3], ["history", 2.5], ["what changed", 4.5], ["did we", 4.5], ["have we", 4.5], ["ultima vez", 3], ["ontem", 1.5], ["semana passada", 2.5], ["decidimos", 3], ["git log", 3.5], ["changelog", 2.5], ["sessao anterior", 3.5], ["previous session", 3.5], ["memoria", 1.5], ["ja existiu", 3], ["ja houve", 3.5], ["o que foi decidido", 5], ["por que decidimos", 4.5], ["who changed", 4], ["when did", 3.5], ["was this fixed before", 4.5], ["ja resolvemos", 4.5], ["ja resolveram", 4],
  ],
};

const CONVENCOES: Grupo = {
  p: [["convenc", 4.5], ["conventions", 4.5]],
  w: [
    ["padroes do projeto", 5.5], ["padroes do repositorio", 5.5], ["como escrevo teste", 6], ["como escrevo um teste", 6], ["stackx", 6], ["onde coloco o arquivo", 4], ["onde coloco", 2.5], ["qual o padrao", 3], ["qual o comando de teste", 5.5], ["como rodar os testes", 5.5], ["como rodo os testes", 5.5], ["padrao de nomenclatura", 5], ["nomenclatura de testes", 5], ["estilo do projeto", 3], ["code style", 3], ["camadas do projeto", 3.5], ["quem pode chamar quem", 4],
    ["how do i write a test", 6.5], ["where do tests go", 6.5], ["project conventions", 5], ["naming convention", 4], ["comandos de teste", 3],
  ],
};

const DESIGN: Grupo = {
  w: [
    ["design system", 4], ["designx", 6], ["tokens de cor", 4], ["tokens de design", 4], ["audita o design", 5], ["auditar o design", 5], ["consistencia visual", 3.5], ["mapear tokens", 4], ["mapeia os tokens", 4], ["tokens", 1.5], ["paleta de cores", 3], ["componentes visuais", 3], ["ui kit", 3], ["inventario de componentes", 4], ["cartografia do design", 5], ["design tokens", 4], ["visual consistency", 4], ["storybook", 2], ["tipografia", 2], ["espacamento", 1.5],
  ],
};

const ONBOARDING: Grupo = {
  w: [
    ["prepara este repositorio", 6], ["preparar este repositorio", 6], ["preparar o repositorio", 5], ["prepara o repositorio", 5], ["onboarding", 5], ["configurar o metodo", 5], ["configura o metodo", 5], ["adotar o metodo", 5], ["instalar o metodo", 5], ["instala o metodo", 5], ["setup do metodo", 5], ["set up the method", 5], ["prepare this repo", 6], ["prepare the repo", 5], ["habilitar o metodo", 5], ["usar o metodo neste", 5],
  ],
};

const CONTROLE: Grupo = {
  w: [
    ["como esta o pipeline", 6], ["status do maestro", 6], ["status do pipeline", 6], ["em que etapa", 5.5], ["em qual etapa", 5.5], ["como esta o maestro", 6], ["maestro", 2], ["pipeline", 2], ["progresso do pipeline", 5], ["pipelines ativos", 5], ["lista os pipelines", 5], ["qual o status", 2],
  ],
  r: [["(pausa|pausar|cancela|cancelar|retoma|retomar|para|parar) (o |a |os |as )?(maestro|pipeline|etapa)", 5]],
};

const GRUPOS: Record<Exclude<Intencao, "desconhecida">, Grupo> = {
  bug: BUG, feature: FEATURE, refatoracao: REFATORACAO, pedido: PEDIDO, projeto: PROJETO, entrega: ENTREGA, duvida: DUVIDA, historico: HISTORICO, convencoes: CONVENCOES, design: DESIGN, onboarding: ONBOARDING, controle: CONTROLE,
};

const slug = (t: string): string => t.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function montar(): EntradaLexico[] {
  const saida: EntradaLexico[] = [];
  for (const [intencao, g] of Object.entries(GRUPOS) as Array<[Exclude<Intencao, "desconhecida">, Grupo]>) {
    const add = (lista: T[] | undefined, tipo: TipoTermo, marca: string): void => {
      for (const [termo, peso, d] of lista ?? []) saida.push({ id: `${intencao}.${marca}.${slug(termo)}`, intencao, termo, tipo, peso, defeito: d === true });
    };
    add(g.p, "prefixo", "p");
    add(g.w, "palavra", "w");
    add(g.r, "regex", "r");
  }
  return saida;
}

/** O léxico (carregado uma única vez; sem I/O). */
export const LEXICO: readonly EntradaLexico[] = montar();
