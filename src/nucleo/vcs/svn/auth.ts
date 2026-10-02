import { AutenticacaoNecessariaErro, INSTRUCAO_AUTENTICAR, rodarSvnRede, SvnErro, validarUrl, type CodigoNominalSvn, type OpcoesBaseSvn } from "./comum";

// T-06.28: autenticação segura. O app NUNCA pede nem guarda senha: `--non-interactive` sempre, credenciais do
// cache do próprio svn; quando faltam, o erro nominal `autenticacao_necessaria` traz o comando para o usuário
// rodar num terminal (a UI abre um Pane). `--password-from-stdin` só por opção EXPLÍCITA do usuário
// (`autenticacao: { usuario, senhaStdin }` em `OpcoesSvnCmd`), nunca senha em argv.

export interface EstadoAutenticacaoSvn {
  estado: "ok" | CodigoNominalSvn;
  /** Comando para o usuário rodar num terminal (só quando falta credencial). */
  comandoTerminal: string | null;
  mensagem: string;
}

/** Comando de terminal que faz o svn guardar a credencial. A URL é validada (https/svn+ssh). */
export function comandoAutenticar(url: string, permitirFile = false): string {
  return `svn info '${validarUrl(url, permitirFile).replace(/'/g, "%27")}'`;
}

/** Sonda sem travar: `svn info --xml ^/` na cópia de trabalho. Nunca lança por falha de acesso. */
export async function verificarAutenticacaoSvn(raiz: string, op: OpcoesBaseSvn & { url?: string } = {}): Promise<EstadoAutenticacaoSvn> {
  try {
    await rodarSvnRede(raiz, "info", ["--xml"], ["^/"], { ...op, tipo: "leitura", timeoutMs: 30_000 });
    return { estado: "ok", comandoTerminal: null, mensagem: "Autenticado (ou repositório público)." };
  } catch (e) {
    if (e instanceof AutenticacaoNecessariaErro) {
      let cmd: string | null = null;
      try {
        cmd = op.url !== undefined ? comandoAutenticar(op.url, op.permitirFile) : "svn info ^/";
      } catch {
        cmd = null;
      }
      return { estado: "autenticacao_necessaria", comandoTerminal: cmd, mensagem: INSTRUCAO_AUTENTICAR };
    }
    if (e instanceof SvnErro) return { estado: e.nominal, comandoTerminal: null, mensagem: e.instrucao ?? e.message };
    throw e;
  }
}
