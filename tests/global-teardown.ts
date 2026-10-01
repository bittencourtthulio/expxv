import { randomUUID } from "node:crypto";
import { limparPastasRegistradas, matarOrfaos } from "./limpeza";

// Início: remove órfãos antigos (> 10 min; nunca atinge um teste em andamento) e abre o registro
// desta execução. Fim: mata as árvores de TODAS as pastas de dados usadas por esta execução.
export default function setup(): () => void {
  const id = randomUUID().slice(0, 8);
  process.env["ADE_RUN_ID"] = id; // herdado pelos workers
  matarOrfaos();
  return () => {
    limparPastasRegistradas(id);
    matarOrfaos();
  };
}
