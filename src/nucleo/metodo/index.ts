// Núcleo do Método Expx (leitura): parser tolerante, descoberta, indexação em worker, observador,
// modelo derivado, violações, sinaleira e grafo. Somente leitura: nunca escreve em docs/ (D-04).
export * from "./tipos";
export { extrairFrontmatter, removerBom } from "./parser/frontmatter";
export { KINDS_CONHECIDOS, KIND_DESCONHECIDO, normalizarKind } from "./parser/kinds";
export { extrairVeredito } from "./parser/veredito";
export { criarTailJsonl, lerJsonlDesde, lerRastroDoTrabalho } from "./parser/jsonl";
export { LIMITE_BYTES, lerArtefato } from "./parser/leitores";
export { descobrir, type Descoberta, type TrabalhoDescoberto } from "./descoberta";
export { criarConjunto, criarIndexador, indexarProjeto, type Conjunto, type Indexador, type OpcoesIndexador } from "./indexador";
export { criarClienteWorker, executarTarefa, type ClienteWorker, type MensagemWorker, type RespostaWorker } from "./worker";
export { criarObservador, type Agendador, type LoteMudanca, type Observador, type OpcoesObservador } from "./observador";
export { lerFeaturesDoMapa, montarTrabalhos, type EntradaModelo } from "./modelo";
export { verificarViolacoes, type OpcoesRegras } from "./regras";
export { calcularSinaleira, type OpcoesSinaleira } from "./sinaleira";
export { montarGrafo, type NoGrafo } from "./grafo";
