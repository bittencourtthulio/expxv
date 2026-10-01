// Registro npm/PyPI FALSO e local (Fase 7B, T-07B.06/.33): HTTP em 127.0.0.1 com porta efêmera. Serve só os
// metadados mínimos (`dist.integrity`, `urls[].digests.sha256`) e registra cada requisição para os testes
// provarem que só houve GET e só contra ele. Nunca acessa a rede externa.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface PacoteFalso { pacote: string; versao: string; integridade: string }
export interface PacotePypiFalso { pacote: string; versao: string; sha256: string }

export interface RegistroFalso {
  url: string;
  requisicoes: Array<{ metodo: string; caminho: string }>;
  fechar: () => Promise<void>;
}

export async function iniciarRegistroFalso(npm: PacoteFalso[] = [], pypi: PacotePypiFalso[] = []): Promise<RegistroFalso> {
  const requisicoes: RegistroFalso["requisicoes"] = [];
  const servidor: Server = createServer((req, res) => {
    const caminho = decodeURIComponent(req.url ?? "/");
    requisicoes.push({ metodo: req.method ?? "?", caminho });
    const json = (corpo: unknown, status = 200): void => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(corpo)); };
    if (req.method !== "GET") return json({ erro: "somente leitura" }, 405);
    const p = /^\/pypi\/([^/]+)\/([^/]+)\/json$/.exec(caminho);
    if (p) {
      const achado = pypi.find((x) => x.pacote === p[1] && x.versao === p[2]);
      return achado ? json({ info: { name: achado.pacote, version: achado.versao }, urls: [{ filename: `${achado.pacote}-${achado.versao}.tar.gz`, digests: { sha256: achado.sha256 } }] }) : json({ erro: "não encontrado" }, 404);
    }
    const n = /^\/((?:@[^/]+\/)?[^/]+)\/([^/]+)$/.exec(caminho);
    if (n) {
      const achado = npm.find((x) => x.pacote === n[1] && x.versao === n[2]);
      return achado ? json({ name: achado.pacote, version: achado.versao, dist: { integrity: achado.integridade, tarball: `${"http://127.0.0.1"}/falso.tgz` } }) : json({ erro: "não encontrado" }, 404);
    }
    return json({ erro: "não encontrado" }, 404);
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requisicoes,
    fechar: () => new Promise<void>((ok) => { servidor.closeAllConnections?.(); servidor.close(() => ok()); }),
  };
}
