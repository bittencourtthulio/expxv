// API pública do núcleo da memória (Fase 8). Uso típico (main, depois do boot):
//   const memoria = criarServicoMemoria({ banco, porta: conhecimentoNulo, scrubber: cofre.scrubSincrono, raizDoWorkspace });
//   garantirFts(banco);                                        // idempotente; FTS5 detectado por tentativa
//   const coletor = memoria.coletor(barramento);               // assina handoff/pane/task/method/mission.closed (coalescido)
//   memoria.memory_write(paneIdDoToken, args)                  // tools MCP: identidade só do token
//   memoria.ciclo.executarEmOcioso({ ocioso })                 // compactação/retenção/purga em fatias
export { criarServicoMemoria } from "./servico";
export type { DepsServico, ServicoMemoria } from "./servico";
export { garantirFts, ftsDisponivel } from "./fts";
export { redigirTexto, redigir, MARCA_REDIGIDO } from "./redacao";
export { prepararDocumento, dividirEmChunks, normalizarParaIndice } from "./ingestao";
export { conhecimentoNulo, criarPortaEnfileirada, montarEvento, idDeEvento, TABELA_EVENTOS, TIPOS_EVENTO_CONHECIMENTO } from "./eventos-conhecimento";
export type { EventoConhecimento, PortaConhecimento, TipoEventoConhecimento } from "./eventos-conhecimento";
export { buildBrief } from "./brief";
export { montarPacote, pacoteDoBanco } from "./pacote";
export { resolverModo } from "./modo";
export { resolverContextoDoPane, resolverContextoDaMissao } from "./contexto";
export { raizDaLinhagem, linhagemDe } from "./linhagem";
export { criarRestaurador, montarBriefDoPane, substituirBrief } from "./restaurar";
export { consultarAntesDeImplementar, derivarConsulta } from "./consulta-previa";
export { criarProvedorHash, exigirConsentimento, MODELO_HASH } from "./vetorial/embedding";
export type { ProvedorEmbedding } from "./vetorial/embedding";
export { MemoriaErro } from "./tipos";
export type { ContextoMemoria } from "./tipos";
