// Pacotes nativos da voz local (Fase 11, D-544): o `sherpa-onnx-node` escolhe `sherpa-onnx-<so>-<arq>` em tempo de execução, e o npm só instala o da máquina de build. Para empacotar para
// OUTRA plataforma/arquitetura (dmg universal no Mac de um arquiteto só, instalador do Windows) o pacote do alvo precisa estar em node_modules: este módulo diz quais faltam e monta o comando.
// Versão EXATA, a mesma do package.json (conferida por teste). Sem rede aqui: quem instala é o script `preparar-voz-nativos.mjs`, só ao empacotar.
import { existsSync } from "node:fs";
import { join } from "node:path";

export const VERSAO_SHERPA = "1.13.8";
export const PACOTES_POR_ALVO = Object.freeze({
  mac: ["sherpa-onnx-darwin-arm64", "sherpa-onnx-darwin-x64"],
  win: ["sherpa-onnx-win-x64"],
  local: [],
});

export function pacotesFaltando(alvo, raiz, existe = existsSync) {
  const lista = PACOTES_POR_ALVO[alvo];
  if (lista === undefined) throw new Error(`alvo desconhecido: ${alvo}`);
  return lista.filter((p) => !existe(join(raiz, "node_modules", p, "package.json")));
}

/** `--force` só para ignorar os campos os/cpu do pacote (é exatamente o objetivo); `--no-save` não mexe no package.json; `--ignore-scripts` nunca roda código do pacote. */
export function comandoInstalar(faltando) {
  if (faltando.length === 0) return null;
  return { cmd: "npm", args: ["install", "--no-save", "--force", "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund", ...faltando.map((p) => `${p}@${VERSAO_SHERPA}`)] };
}
