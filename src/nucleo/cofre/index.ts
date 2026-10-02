// API pública do cofre (ESTÁVEL; consumidores do main: Loja de MCPs, OpenRouter, decisor, broker de Pane).
//
//   import { criarCofre, criarMotorSafeStorage, criarMotorSenhaMestra, CofreErro } from "../cofre";
//
//   const cofre = criarCofre({ arquivo: "<userData>/cofre.json", motor });        // abre sob demanda (nada de I/O até o 1º uso)
//   await cofre.guardar({ id: null, nome: "GITHUB_TOKEN", escopo: "global", workspace_id: null, sensivel: true, valor });
//   await cofre.existe("GITHUB_TOKEN");                                           // sem decifrar; funciona bloqueado
//   await cofre.usar("GITHUB_TOKEN", (valor) => chamar(valor));                   // modo broker: valor só dentro do callback
//   const v = await cofre.obter("GITHUB_TOKEN", { workspace_id });                // SÓ main, uso imediato; workspace vence global
//   await cofre.resolver("Bearer {{vault:GITHUB_TOKEN}}");                        // placeholders para consumidores internos
//   await cofre.ambienteDoPane(ws, injetar);                                      // só NÃO sensíveis e só com `injetar`
//   await cofre.scrub(textoDeSaidaOuLog);                                         // remove valores (+ base64/url/json/hex) → «cofre:NOME»
//   await cofre.usarSemSalvar(chaveDigitada, (v) => testar(v));                   // "testar sem salvar": nada vai a disco
//
// Erros: `CofreErro` com `codigo` nominal; a mensagem cita só o NOME da entrada. Nenhum canal IPC devolve valor.
// Convenção p/ chaves de terceiros: nome UPPER_SNAKE (ex.: `OPENROUTER_KEY_<ID>`, `MCP_<SERVIDOR>_<VAR>`), `sensivel: true`.
export { criarCofre, lerMotorDoArquivo, NOME_VALIDO, VALOR_MAX, INATIVIDADE_PADRAO_MS } from "./cofre";
export type { ChaveEntrada, Cofre, OpcoesCofre, Agendamento } from "./cofre";
export { criarMotorSafeStorage, criarMotorSenhaMestra, SCRYPT_PADRAO, SENHA_MIN } from "./cifrador";
export type { MotorCofre, MotorSenhaMestra, PortaSafeStorage, ParametrosScrypt, TipoMotor } from "./cifrador";
export { CofreErro } from "./erros";
export type { CodigoCofre } from "./erros";
export { criarScrubber, mascarar } from "./scrubber";
export type { Scrubber } from "./scrubber";
export { nomesCitados, resolverPlaceholders } from "./placeholders";
