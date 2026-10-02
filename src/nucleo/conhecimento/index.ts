// API pública do núcleo do conhecimento (Fase 15). Importar de forma PREGUIÇOSA na onda 2 (nada daqui roda no boot):
//   const { criarServicoConhecimento, abrirBancoConhecimento } = await import("../nucleo/conhecimento");
//   const { banco, fts5 } = abrirBancoConhecimento(`${userData}/conhecimento.db`);           // só o worker abre este arquivo
//   const rag = criarServicoConhecimento({ banco, workspace_id, nomeWorkspace, raiz, ativo, scrubber, fts5 });
//   porta.registrar = (e) => rag.registrar(e);                                                  // PortaConhecimento (Fase 8)
//   await rag.processarFila(20); rag.aquecer(20); rag.consolidar();                             // trabalho de fundo, em fatias
//   await rag.contexto({ tarefa, arquivos, origem: "injecao", mission_id, task_ref });          // consultar antes de implementar
export { abrirBancoConhecimento } from "./banco";
export { criarServicoConhecimento, ServicoConhecimento } from "./servico";
export type { DepsServico, PedidoBuscaServico, PedidoContextoServico } from "./servico";
export { criarRepos } from "./repos";
export type { Repos } from "./repos";
export { criarReposConhecimentoDominio, CONFIG_PADRAO } from "./repos-dominio";
export { avaliarConsultaObrigatoria, JANELA_CONSULTA_MS } from "./contexto/regra";
export { proximoTrabalho } from "./ingestao/agendador";
export { executarBackfill } from "./ingestao/backfill";
export { criarDiscoNode } from "./fontes/disco";
export { lerDocs } from "./fontes/docs";
export { lerCodigo } from "./fontes/codigo";
export { lerCommits } from "./fontes/git";
export { lerTranscricao } from "./fontes/transcricoes";
export { sincronizarMapa } from "./fontes/mapa";
export { RegistroEmbeddings } from "./embeddings/registro";
export { criarProvedorOllama } from "./embeddings/ollama";
export { criarProvedorOnnx } from "./embeddings/onnx";
export { OrquestradorChat } from "./chat/orquestrador";
export { montarComando, verificarFlags, extrairTexto } from "./chat/headless";
export { perguntar } from "./chat/perguntar";
export { melhorarPrompt } from "./chat/prompt";
export { ArmazenamentoLocal } from "./armazenamento/local";
export { ArmazenamentoMemoria } from "./armazenamento/memoria";
export { criarPrevia, consentir, migrar as migrarParaOnline, verificar as verificarMigracao } from "./backend/migracao";
export { empurrar, puxar, enfileirarEnvio, podeEnviar } from "./backend/replicacao";
export { consultarEquipe } from "./backend/cache";
export { validarUrlBackend } from "./backend/url";
export { guardarSegredos, projetoIdDoRemote, validarConfig } from "./backend/config";
