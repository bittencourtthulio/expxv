// Nome da entrada do cofre que guarda a credencial de Bitbucket/Azure DevOps de um host (função PURA: main e renderer usam).
// Convenção: `FORGE_<HOST em UPPER_SNAKE>` (ex.: `FORGE_BITBUCKET_ORG`, `FORGE_DEV_AZURE_COM`), `sensivel: true`. O valor nunca é exibido.
export function nomeCredencialForge(host: string): string {
  return `FORGE_${host.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`.slice(0, 64);
}
