// Localiza o executável do app empacotado (dist-app/mac-*/*.app ou dist-app/win-unpacked).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function localizarPacote(raiz, plataforma = process.platform) {
  const saida = join(raiz, "dist-app");
  if (plataforma === "darwin") {
    const pastas = existsSync(saida) ? readdirSync(saida).filter((n) => n.startsWith("mac")).sort() : [];
    for (const pasta of pastas) {
      const apps = readdirSync(join(saida, pasta)).filter((n) => n.endsWith(".app"));
      for (const app of apps) {
        const macos = join(saida, pasta, app, "Contents", "MacOS");
        const bins = existsSync(macos) ? readdirSync(macos) : [];
        if (bins.length > 0) {
          const recursos = join(saida, pasta, app, "Contents", "Resources");
          return { executavel: join(macos, bins[0]), recursos };
        }
      }
    }
    return null;
  }
  if (plataforma === "win32") {
    const pasta = join(saida, "win-unpacked");
    if (!existsSync(pasta)) return null;
    const exe = readdirSync(pasta).find((n) => n.endsWith(".exe") && !/^(uninstall|elevate)/i.test(n));
    return exe ? { executavel: join(pasta, exe), recursos: join(pasta, "resources") } : null;
  }
  return null;
}

/** Interpreta o resultado do smoke: sucesso só com código 0. */
export function smokeOk(codigo, sinal) {
  return codigo === 0 && !sinal;
}

// ---- inspeção do app.asar (peso, ícone da bandeja, fonte local) -----------------------------------------
import { createRequire } from "node:module";
import { lstatSync } from "node:fs";
import { posix } from "node:path";

const requerer = createRequire(import.meta.url);

/** Lista os arquivos do asar: caminho com `/` inicial, tamanho e se ficou fora do asar (`unpacked`). */
export function listarAsar(arquivoAsar) {
  const asar = requerer("@electron/asar");
  const saida = [];
  const andar = (no, prefixo) => {
    for (const [nome, v] of Object.entries(no.files ?? {})) {
      const caminho = `${prefixo}/${nome}`;
      if (v.files) andar(v, caminho);
      else saida.push({ caminho, tamanho: v.size ?? 0, unpacked: v.unpacked === true });
    }
  };
  andar(asar.getRawHeader(arquivoAsar).header, "");
  return saida;
}

/** Os `n` maiores arquivos que estão DENTRO do asar (os desempacotados são medidos em separado). */
export function maioresDoAsar(arquivos, n = 10) {
  return arquivos.filter((a) => !a.unpacked).sort((a, b) => b.tamanho - a.tamanho).slice(0, n);
}

/** Peso morto que nunca deveria entrar no pacote: mapas, testes, typings, fixtures, docs. */
export function pesoMorto(arquivos) {
  const padrao = /(\.map$|\.test\.[cm]?[jt]sx?$|\.d\.[cm]?ts$|(^|\/)(__tests__|fixtures?|test|tests|docs|examples?)\/|(^|\/)(README|CHANGELOG)[^/]*$)/i;
  // os prompts do produto são .md de verdade e ficam; testing/index.js do hono é código de runtime
  return arquivos.filter((a) => padrao.test(a.caminho) && !a.caminho.includes("/nucleo/orquestracao/prompts/")).map((a) => a.caminho);
}

/** Tamanho (bytes) de uma pasta, sem seguir symlinks. */
export function tamanhoDaPasta(pasta) {
  let total = 0;
  for (const nome of readdirSync(pasta)) {
    const c = join(pasta, nome);
    const s = lstatSync(c);
    total += s.isDirectory() ? tamanhoDaPasta(c) : s.size;
  }
  return total;
}

/**
 * Prova a fonte local: o index.html do renderer empacotado carrega CSS cujos `@font-face` apontam para .ttf
 * que existem dentro do asar, e nenhum CSS busca nada em http(s). Devolve { fontes, erros }.
 */
export function conferirFontesLocais(arquivoAsar, arquivos) {
  const asar = requerer("@electron/asar");
  const existe = new Set(arquivos.map((a) => a.caminho));
  const erros = [];
  const fontes = new Set();
  if (!existe.has("/dist/renderer/index.html")) return { fontes: [], erros: ["dist/renderer/index.html ausente no asar"] };
  for (const a of arquivos.filter((x) => x.caminho.startsWith("/dist/renderer/") && x.caminho.endsWith(".css"))) {
    const css = asar.extractFile(arquivoAsar, a.caminho.slice(1)).toString("utf8");
    if (/url\(\s*["']?https?:/i.test(css) || /@import\s+(url\()?["']?https?:/i.test(css)) erros.push(`${a.caminho} busca recurso remoto`);
    for (const m of css.matchAll(/url\(\s*["']?([^)"']+\.(?:ttf|woff2?|otf))["']?\s*\)/gi)) {
      const alvo = posix.normalize(posix.join(posix.dirname(a.caminho), m[1]));
      fontes.add(alvo);
      if (!existe.has(alvo)) erros.push(`fonte ausente no asar: ${alvo}`);
    }
  }
  if (fontes.size === 0) erros.push("nenhuma fonte local encontrada nos CSS do renderer");
  return { fontes: [...fontes], erros };
}
