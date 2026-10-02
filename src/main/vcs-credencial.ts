// Credencial de Bitbucket/Azure DevOps vinda do cofre do SO (Fase 6E). GitHub/GitLab usam as credenciais das próprias CLIs (`gh`/`glab`, D-34).
// Convenção: a entrada do cofre se chama `FORGE_<HOST em UPPER_SNAKE>` (ex.: `FORGE_BITBUCKET_ORG`, `FORGE_DEV_AZURE_COM`), `sensivel: true`.
// Valor com `:` (`usuario:senha` ou `:PAT`) = Basic; sem `:` = token Bearer. O valor passa do cofre ao cliente REST e nunca é exibido, logado ou auditado.
import { NOME_VALIDO, type Cofre } from "../nucleo/cofre";
import type { CredencialRest } from "../nucleo/forge";
import { nomeCredencialForge } from "../nucleo/forge/credencial";

export function credencialDoCofre(cofre: () => Promise<Cofre>): (host: string) => Promise<CredencialRest | undefined> {
  return async (host) => {
    if (typeof host !== "string" || host === "" || host.length > 200) return undefined;
    const nome = nomeCredencialForge(host);
    if (!NOME_VALIDO.test(nome)) return undefined;
    try {
      const c = await cofre();
      if (!(await c.existe(nome))) return undefined;
      const valor = await c.obter(nome);
      if (valor === "") return undefined;
      return { esquema: valor.includes(":") ? "Basic" : "Bearer", valor };
    } catch {
      return undefined; // bloqueado/indisponível: o forge responde "sem autenticação"; a causa e o valor nunca sobem
    }
  };
}
