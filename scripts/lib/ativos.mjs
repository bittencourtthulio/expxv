// Ativos que o `tsc` não emite e que o app lê em tempo de execução: prompts editáveis (.md) e o script
// de hook por Pane (`gancho.mjs`, roda como processo separado). Cópia idempotente de `src/` para `dist/`.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

export const ATIVOS = [
  // Fase 14 (T-14.08): squads de fábrica (aninhadas: <id>/squad.json + <id>/membros/*.md, manifesto, rigor, esforço). `arquetipos/` é só
  // insumo do gerador. O pacote final leva a pasta por `extraResources` (electron-builder.yml); a cópia em dist/ serve ao app não empacotado
  // e fica FORA do asar (`!dist/squads/**`). Arquivos 0644 e pastas 0755 (nunca herdam modo restrito do checkout).
  { de: "resources/squads", para: "dist/squads", extensoes: [".json", ".md"], recursivo: true, ignorar: ["arquetipos"] },
  { de: "src/nucleo/orquestracao/prompts", para: "dist/nucleo/orquestracao/prompts", extensoes: [".md"] },
  // D-634: modelos (commit-push.md e pr.md) das instruções de "Commit e push" / "Enviar PR"; editáveis pelo dono.
  { de: "src/nucleo/vcs/prompts", para: "dist/nucleo/vcs/prompts", extensoes: [".md"] },
  { de: "src/nucleo/orquestracao/hooks/scripts", para: "dist/nucleo/orquestracao/hooks/scripts", extensoes: [".mjs"] },
  // Fase 9 (T-09.06): statusline do Claude por Pane; o main a copia para userData no boot (fora do asar).
  { de: "src/nucleo/limites/scripts", para: "dist/nucleo/limites/scripts", extensoes: [".mjs"] },
  // Fase 17 (T-17.02): gramáticas Tree-sitter em WASM do mapa. `nomes` é a lista fechada (Onda 1+2); as demais gramáticas do
  // pacote (bash, css, ini, powershell, regex) ficam de fora. Mantida em sincronia com GRAMATICAS_EMBARCADAS por teste.
  {
    de: "node_modules/@vscode/tree-sitter-wasm/wasm",
    para: "dist/nucleo/mapa/gramaticas",
    extensoes: [".wasm"],
    nomes: [
      "tree-sitter-c-sharp.wasm",
      "tree-sitter-cpp.wasm",
      "tree-sitter-go.wasm",
      "tree-sitter-java.wasm",
      "tree-sitter-javascript.wasm",
      "tree-sitter-php.wasm",
      "tree-sitter-python.wasm",
      "tree-sitter-ruby.wasm",
      "tree-sitter-rust.wasm",
      "tree-sitter-tsx.wasm",
      "tree-sitter-typescript.wasm",
    ],
  },
];

const copiarRecursivo = (origem, destino, { extensoes, nomes, ignorar = [] }, relativo = "") => {
  const copiados = [];
  mkdirSync(destino, { recursive: true, mode: 0o755 });
  chmodSync(destino, 0o755);
  for (const nome of readdirSync(origem).sort()) {
    const de = join(origem, nome);
    if (statSync(de).isDirectory()) {
      if (ignorar.includes(nome)) continue;
      copiados.push(...copiarRecursivo(de, join(destino, nome), { extensoes, nomes, ignorar }, join(relativo, nome)));
    } else if (extensoes.includes(extname(nome)) && (nomes === undefined || nomes.includes(nome))) {
      copyFileSync(de, join(destino, nome));
      chmodSync(join(destino, nome), 0o644);
      copiados.push(join(relativo, nome));
    }
  }
  return copiados;
};

/** Copia cada ativo para o destino. Devolve os caminhos de destino (relativos à raiz). Origem ausente é erro. */
export function copiarAtivos(raiz, ativos = ATIVOS) {
  const copiados = [];
  for (const { de, para, extensoes, nomes: permitidos, recursivo, ignorar } of ativos) {
    const origem = join(raiz, de);
    if (!existsSync(origem)) throw new Error(`ativo ausente: ${de}`);
    if (recursivo === true) {
      const feitos = copiarRecursivo(origem, join(raiz, para), { extensoes, nomes: permitidos, ignorar });
      if (feitos.length === 0) throw new Error(`nenhum ativo ${extensoes.join("/")} em ${de}`);
      copiados.push(...feitos.map((f) => join(para, f)));
      continue;
    }
    const nomes = readdirSync(origem).filter((n) => extensoes.includes(extname(n)) && (permitidos === undefined || permitidos.includes(n)));
    if (nomes.length === 0) throw new Error(`nenhum ativo ${extensoes.join("/")} em ${de}`);
    mkdirSync(join(raiz, para), { recursive: true });
    for (const nome of nomes) {
      copyFileSync(join(origem, nome), join(raiz, para, nome));
      copiados.push(join(para, nome));
    }
  }
  return copiados;
}
