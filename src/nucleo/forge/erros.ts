import type { ProvedorForge } from "./forge";

// Erros nominais do Forge. Toda mensagem é escrita em português, explica a causa e já sai sem token/credencial.

export class ForgeErro extends Error {
  override name = "ForgeErro";
  constructor(mensagem: string, readonly codigo: string = "forge", readonly detalhe: string = "") {
    super(mensagem);
  }
}
export const INSTALACAO: Record<ProvedorForge, string> = {
  github: "Instale o GitHub CLI (macOS: `brew install gh`; Windows: `winget install GitHub.cli`; Linux: https://cli.github.com) e rode `gh auth login`. Sem ele o app segue só com git.",
  gitlab: "Instale o GitLab CLI (macOS: `brew install glab`; Windows: `winget install GLab.GLab`; Linux: https://gitlab.com/gitlab-org/cli) e rode `glab auth login`. Sem ele o app segue só com git.",
  bitbucket: "Bitbucket usa a API REST: salve um app password/token no cofre do app (Configurações > Contas). Sem ele o app segue só com git.",
  azure: "Azure DevOps usa a API REST: salve um Personal Access Token no cofre do app (Configurações > Contas). Sem ele o app segue só com git.",
};
export class ForgeCliAusenteErro extends ForgeErro {
  override name = "ForgeCliAusenteErro";
  constructor(readonly provedor: ProvedorForge, readonly instrucao: string = INSTALACAO[provedor]) {
    super(`A ferramenta de ${provedor} não está instalada. ${instrucao}`, "cli-ausente");
  }
}
export class ForgeAutenticacaoErro extends ForgeErro {
  override name = "ForgeAutenticacaoErro";
  constructor(readonly provedor: ProvedorForge, detalhe = "") {
    super(`Sem autenticação em ${provedor}. ${provedor === "github" ? "Rode `gh auth login`" : provedor === "gitlab" ? "Rode `glab auth login`" : "Salve a credencial no cofre do app"}; o app nunca guarda nem pede senha ou token.`, "autenticacao", detalhe);
  }
}
export class ForgePermissaoErro extends ForgeErro {
  override name = "ForgePermissaoErro";
  constructor(acao: string, detalhe = "", provedor?: ProvedorForge) {
    const troca = provedor === "github" ? "Troque de conta (`gh auth switch`)" : provedor === "gitlab" ? "Entre com outra conta (`glab auth login`)" : "Troque a credencial salva no cofre do app";
    super(`Sem permissão para ${acao}. A conta ativa não tem acesso de escrita a este repositório (ou o token não tem o escopo necessário). ${troca} ou peça acesso ao dono do repositório.`, "permissao", detalhe);
  }
}
export class ForgeBranchProtegidaErro extends ForgeErro {
  override name = "ForgeBranchProtegidaErro";
  constructor(detalhe = "") {
    super("A branch de destino é protegida e a operação não atende às regras dela (revisão obrigatória, checks exigidos ou histórico linear). Satisfaça as regras no PR; o app nunca usa privilégio de administrador para contorná-las.", "branch-protegida", detalhe);
  }
}
export class ForgeNaoEncontradoErro extends ForgeErro {
  override name = "ForgeNaoEncontradoErro";
  constructor(oque: string, detalhe = "") {
    super(`${oque} não encontrado, ou a conta ativa não enxerga este repositório (repositório privado?).`, "nao-encontrado", detalhe);
  }
}
export class ForgeRateLimitErro extends ForgeErro {
  override name = "ForgeRateLimitErro";
  constructor(readonly reiniciaEm: number | null, detalhe = "") {
    super(`Limite de requisições da API atingido${reiniciaEm ? `; volta a liberar em ${new Date(reiniciaEm * 1000).toISOString()}` : ""}. A atualização automática foi pausada.`, "rate-limit", detalhe);
  }
}
export class ForgeMetodoMergeErro extends ForgeErro {
  override name = "ForgeMetodoMergeErro";
  constructor(readonly pedido: string, readonly permitidos: string[]) {
    super(`Este repositório não permite o método de merge "${pedido}". Métodos permitidos: ${permitidos.join(", ") || "nenhum"}.`, "metodo-merge");
  }
}
export class ForgeRecusadoErro extends ForgeErro {
  override name = "ForgeRecusadoErro";
  constructor(mensagem: string, readonly motivo: "origem-invalida" | "sem-aprovacao" | "automacao-nao-mescla") {
    super(mensagem, motivo);
  }
}
export class ForgeEntradaInvalidaErro extends ForgeErro {
  override name = "ForgeEntradaInvalidaErro";
  constructor(campo: string, motivo: string) {
    super(`Valor inválido para ${campo}: ${motivo}.`, "entrada-invalida");
  }
}
export class ForgeNaoSuportadoErro extends ForgeErro {
  override name = "ForgeNaoSuportadoErro";
  constructor(readonly provedor: ProvedorForge, recurso: string) {
    super(`${recurso} não é suportado em ${provedor}.`, "nao-suportado");
  }
}
export class ForgeRedeErro extends ForgeErro {
  override name = "ForgeRedeErro";
  constructor(detalhe: string) {
    super(`Sem conexão com o servidor do repositório (${detalhe}). Verifique a rede e tente de novo.`, "rede", detalhe);
  }
}
export class ForgeComandoErro extends ForgeErro {
  override name = "ForgeComandoErro";
  constructor(mensagem: string, readonly saida: number | null, detalhe = "") {
    super(mensagem, "comando", detalhe);
  }
}
