// Arquivos que o mapa NUNCA abre (regra inviolável 2 do projeto): ambiente, chaves e credenciais.
// Vale na varredura e, por defesa em profundidade, no worker de extração.

const PADROES: readonly RegExp[] = [
  /^\.env(\..*)?$/i,
  /\.env$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.jks$/i,
  /\.keystore$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/i,
  /^\.netrc$/i,
];

export function ehArquivoSensivel(caminho: string): boolean {
  const base = caminho.slice(Math.max(caminho.lastIndexOf("/"), caminho.lastIndexOf("\\")) + 1);
  return PADROES.some((p) => p.test(base));
}
