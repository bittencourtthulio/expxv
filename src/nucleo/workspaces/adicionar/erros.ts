// Erros do fluxo "Adicionar workspace" (D-605): em linguagem simples, acionáveis e SEM credencial. O stderr do git/gh passa por `semSegredos` antes de qualquer texto.
import type { AcaoErroAdicionar, CodigoErroAdicionar, ErroAdicionar } from "../../../compartilhado/workspaces-adicionar";
import { semSegredos } from "../../forge/comum";

export class ErroAdicionarNucleo extends Error {
  override name = "ErroAdicionarNucleo";
  constructor(
    readonly codigo: CodigoErroAdicionar,
    mensagem: string,
    readonly sugestao: string | null = null,
    readonly acao: AcaoErroAdicionar = null,
  ) {
    super(mensagem);
  }
  paraFio(): ErroAdicionar {
    return { codigo: this.codigo, mensagem: this.message, acao: this.acao, sugestao: this.sugestao };
  }
}

export const MSG_LOGIN_GH = "Repositório não encontrado, ou é privado e você ainda não tem acesso. Confira a URL; se for privado, rode `gh auth login` no terminal e tente de novo.";

interface Classe {
  codigo: CodigoErroAdicionar;
  mensagem: string;
  acao: AcaoErroAdicionar;
}

const primeiraLinhaUtil = (stderr: string): string => {
  const linhas = stderr.split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l !== "" && !/^(remote:\s*)?(Enumerating|Counting|Compressing|Receiving|Resolving|Updating) /i.test(l) && !/^Cloning into/i.test(l));
  return semSegredos(linhas[linhas.length - 1] ?? "").slice(0, 200);
};

/** stderr do `git clone`/`gh repo clone` → categoria + texto para o dono. A ordem importa (mais específico primeiro). */
export function classificarErroClone(stderr: string): Classe {
  const s = stderr;
  if (/No space left on device|Disk quota exceeded|ENOSPC|not enough space/i.test(s)) return { codigo: "disco_cheio", mensagem: "O disco está cheio. Libere espaço (ou escolha outra pasta de destino) e tente de novo.", acao: null };
  if (/Remote branch .* not found|Remote branch .* not found in upstream/i.test(s)) return { codigo: "branch_inexistente", mensagem: "Essa branch não existe no repositório. Deixe o campo vazio para usar a padrão.", acao: null };
  if (/Host key verification failed/i.test(s)) return { codigo: "host_ssh", mensagem: "O host SSH ainda não é conhecido por este computador. Conecte uma vez pelo terminal (`ssh -T git@host`) para confirmar a chave e tente de novo.", acao: null };
  if (/Could not resolve host|Could not resolve hostname|Network is unreachable|Connection timed out|Operation timed out|Connection refused|Failed to connect|Temporary failure in name resolution|No route to host|Connection reset|error connecting to|dial tcp|SSL_ERROR|TLS connection|early EOF|RPC failed/i.test(s)) {
    return { codigo: "sem_internet", mensagem: "Não foi possível chegar ao servidor. Verifique a conexão com a internet (ou a VPN) e tente de novo.", acao: null };
  }
  if (/could not create (work tree )?dir|cannot mkdir|unable to create (leading )?directories|Operation not permitted|Read-only file system|Permission denied(?! \(publickey)/i.test(s) && !/publickey/i.test(s)) {
    return { codigo: "sem_permissao", mensagem: "Sem permissão para gravar na pasta de destino. Escolha outra pasta (uma que você possa editar).", acao: null };
  }
  if (/Permission denied \(publickey|Could not read from remote repository|Authentication failed|could not read (Username|Password)|terminal prompts disabled|returned error: (401|403)|HTTP (401|403)|Invalid username or token|Support for password authentication was removed|requires authentication|gh auth login/i.test(s)) {
    return { codigo: "sem_acesso", mensagem: "Sem acesso ao repositório. Se ele for privado, rode `gh auth login` no terminal (ou configure uma chave SSH) e tente de novo.", acao: "login_gh" };
  }
  if (/Repository not found|repository .* not found|repository .* does not exist|returned error: 404|HTTP 404|Could not resolve to a Repository|does not appear to be a git repository|not found/i.test(s)) {
    return { codigo: "nao_encontrado", mensagem: MSG_LOGIN_GH, acao: "login_gh" };
  }
  const linha = primeiraLinhaUtil(s);
  return { codigo: "interno", mensagem: linha === "" ? "Não foi possível clonar o repositório." : `Não foi possível clonar: ${linha}`, acao: null };
}
