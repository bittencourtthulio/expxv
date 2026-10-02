// Validação ESTRITA da origem de um clone (D-601). Pura: o main revalida tudo (nunca confia no renderer) e a UI usa a mesma função só para pré-visualizar.
// Aceita `https://host/dono/repo(.git)`, `ssh://[usuario@]host[:porta]/dono/repo`, `usuario@host:dono/repo(.git)` (scp), o atalho GitHub `dono/repo` e,
// SÓ com `permitirLocal`, caminho absoluto ou `file:///…`. Recusa tudo o que possa virar opção, programa ou credencial: começo com `-`, `ext::`/`transporte::`,
// esquemas diferentes de https/ssh, caracteres de controle/bidi/Unicode, espaços, usuário/senha/token na URL, host fora do padrão LDH, `..` no caminho.

export type CodigoOrigem =
  | "vazia"
  | "muito_longa"
  | "controle"
  | "espaco"
  | "nao_ascii"
  | "opcao"
  | "esquema_proibido"
  | "credenciais"
  | "local_bloqueado"
  | "local_invalido"
  | "host_invalido"
  | "caminho_invalido"
  | "formato";

export type TipoOrigem = "https" | "ssh" | "github_curto" | "local";
export type ProvedorOrigem = "github" | "gitlab" | "bitbucket" | "azure" | "outro" | "local";

export interface OrigemGit {
  tipo: TipoOrigem;
  provedor: ProvedorOrigem;
  /** host em minúsculas (`github.com`); `local` para caminho. */
  host: string;
  dono: string | null;
  /** nome do repositório sem `.git`. */
  repo: string;
  /** `dono/repo` quando o host é github.com (habilita `gh repo clone`). */
  github_slug: string | null;
  /** nome de pasta sugerido (já passa em `validarNomePasta`). */
  nome_sugerido: string;
  /** texto de tela, sem credenciais e sem caminho local completo. */
  exibicao: string;
  /** argumento reconstruído e seguro para `git clone -- <url_git> <destino>`. */
  url_git: string;
}

export type ResultadoOrigem = { ok: true; origem: OrigemGit } | { ok: false; codigo: CodigoOrigem; motivo: string };

const falha = (codigo: CodigoOrigem, motivo: string): ResultadoOrigem => ({ ok: false, codigo, motivo });

const TAMANHO_MAX = 2048;
// eslint-disable-next-line no-control-regex
const RE_CONTROLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;
// eslint-disable-next-line no-control-regex
const RE_NAO_ASCII = /[^ -~]/;
const RE_LOCAL = /^(?:file:\/\/|\/|[A-Za-z]:[\\/]|\\\\)/i;
const RE_ESQUEMA = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;
const RE_TRANSPORTE = /^[A-Za-z][A-Za-z0-9+.-]*::/;
const RE_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const RE_HOST = new RegExp(`^(?=.{1,253}$)${RE_LABEL}(?:\\.${RE_LABEL})*$`);
const RE_USUARIO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RE_SEGMENTO = /^[A-Za-z0-9._~%+-]+$/;
const RE_ATALHO = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;
const RE_PONTOS = /(^|[/:@\\])\.\.?(?=$|[/?#\\])/;

export const DICA_CREDENCIAL = "Não coloque usuário, senha ou token na URL. Para repositório privado, rode `gh auth login` no terminal (ou use um credential helper do git): o app nunca guarda nem pede credencial.";

function provedorDoHost(host: string): ProvedorOrigem {
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  if (host === "gitlab.com" || host.startsWith("gitlab.")) return "gitlab";
  if (host === "bitbucket.org") return "bitbucket";
  if (host === "dev.azure.com" || host === "ssh.dev.azure.com" || host.endsWith(".visualstudio.com")) return "azure";
  return "outro";
}

function sugerirNome(repo: string): string {
  const limpo = repo.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").replace(/[.-]+$/, "").slice(0, 100);
  return limpo === "" || !validarNomePastaSimples(limpo) ? "projeto" : limpo;
}

/** Nome de pasta aceitável (um único segmento): sem separadores, controle, nome reservado do Windows, `.`/`..`, começo `.`/`-` nem final `.`/espaço. */
const RESERVADOS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// eslint-disable-next-line no-control-regex
const RE_NOME_PROIBIDO = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;
export function validarNomePasta(bruto: unknown): { ok: true; nome: string } | { ok: false; motivo: string } {
  if (typeof bruto !== "string") return { ok: false, motivo: "Informe o nome da pasta." };
  const nome = bruto.trim();
  if (nome === "") return { ok: false, motivo: "Informe o nome da pasta." };
  if (nome.length > 100) return { ok: false, motivo: "O nome da pasta pode ter no máximo 100 caracteres." };
  if (nome === "." || nome === ".." || nome.startsWith(".")) return { ok: false, motivo: "O nome da pasta não pode começar com ponto." };
  if (nome.startsWith("-")) return { ok: false, motivo: "O nome da pasta não pode começar com hífen." };
  if (RE_NOME_PROIBIDO.test(nome)) return { ok: false, motivo: "O nome da pasta não pode ter / \\ : * ? \" < > | nem caracteres de controle." };
  if (/[. ]$/.test(nome)) return { ok: false, motivo: "O nome da pasta não pode terminar com ponto ou espaço." };
  if (RESERVADOS.test(nome)) return { ok: false, motivo: "Este nome é reservado pelo sistema (Windows). Escolha outro." };
  return { ok: true, nome };
}
function validarNomePastaSimples(n: string): boolean {
  return validarNomePasta(n).ok;
}

function segmentosValidos(caminho: string): string[] | null {
  const segs = caminho.split("/").filter((s) => s !== "");
  if (segs.length < 2) return null;
  for (const s of segs) {
    if (!RE_SEGMENTO.test(s)) return null;
    let dec: string;
    try {
      dec = decodeURIComponent(s);
    } catch {
      return null;
    }
    // eslint-disable-next-line no-control-regex
    if (dec === "." || dec === ".." || /[/\\\u0000-\u001f\u007f]/.test(dec)) return null;
  }
  return segs;
}

function montar(base: { tipo: TipoOrigem; host: string; segs: string[]; urlGit: (segs: string[]) => string }): ResultadoOrigem {
  const segs = [...base.segs];
  const ultimo = segs[segs.length - 1] as string;
  const repo = ultimo.replace(/\.git$/i, "");
  if (repo === "" || repo === "." || repo === "..") return falha("caminho_invalido", "O caminho do repositório está incompleto.");
  segs[segs.length - 1] = ultimo;
  const dono = segs.length >= 2 ? (segs[segs.length - 2] as string) : null;
  const provedor = provedorDoHost(base.host);
  const slug = base.host === "github.com" && segs.length === 2 ? `${segs[0] as string}/${repo}` : null;
  return {
    ok: true,
    origem: {
      tipo: base.tipo,
      provedor,
      host: base.host,
      dono,
      repo,
      github_slug: slug,
      nome_sugerido: sugerirNome(repo),
      exibicao: `${base.host}/${segs.slice(0, -1).join("/")}/${repo}`,
      url_git: base.urlGit(segs),
    },
  };
}

function validarHost(host: string): boolean {
  return RE_HOST.test(host) && !host.startsWith("-");
}

function analisarHttps(t: string): ResultadoOrigem {
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return falha("formato", "URL inválida. Exemplo: https://github.com/dono/repositorio");
  }
  if (u.username !== "" || u.password !== "" || /^https:\/\/[^/?#]*@/i.test(t)) return falha("credenciais", DICA_CREDENCIAL);
  if (u.search !== "" || u.hash !== "" || /[?#]/.test(t)) return falha("caminho_invalido", "A URL não pode ter ? nem #.");
  const host = u.hostname.toLowerCase();
  if (!validarHost(host)) return falha("host_invalido", "Nome de host inválido (use um domínio comum, sem IPv6 nem caracteres especiais).");
  const segs = segmentosValidos(u.pathname);
  if (segs === null) return falha("caminho_invalido", "O caminho precisa ser dono/repositório, só com letras, números, ponto, hífen e sublinhado.");
  if (u.port !== "" && !/^\d{1,5}$/.test(u.port)) return falha("host_invalido", "Porta inválida.");
  const porta = u.port === "" ? "" : `:${u.port}`;
  return montar({ tipo: "https", host, segs, urlGit: (s) => `https://${host}${porta}/${s.join("/")}` });
}

function analisarSshUrl(t: string): ResultadoOrigem {
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return falha("formato", "URL ssh inválida. Exemplo: ssh://git@github.com/dono/repositorio.git");
  }
  if (u.password !== "") return falha("credenciais", DICA_CREDENCIAL);
  if (u.username !== "" && !RE_USUARIO.test(u.username)) return falha("host_invalido", "Usuário ssh inválido.");
  if (u.search !== "" || u.hash !== "" || /[?#]/.test(t)) return falha("caminho_invalido", "A URL não pode ter ? nem #.");
  const host = u.hostname.toLowerCase();
  if (!validarHost(host)) return falha("host_invalido", "Nome de host inválido (use um domínio comum, sem IPv6 nem caracteres especiais).");
  if (u.port !== "" && !/^\d{1,5}$/.test(u.port)) return falha("host_invalido", "Porta inválida.");
  const segs = segmentosValidos(u.pathname);
  if (segs === null) return falha("caminho_invalido", "O caminho precisa ser dono/repositório, só com letras, números, ponto, hífen e sublinhado.");
  const porta = u.port === "" ? "" : `:${u.port}`;
  const usuario = u.username === "" ? "" : `${u.username}@`;
  return montar({ tipo: "ssh", host, segs, urlGit: (s) => `ssh://${usuario}${host}${porta}/${s.join("/")}` });
}

function analisarScp(usuario: string, host: string, caminho: string): ResultadoOrigem {
  if (!RE_USUARIO.test(usuario)) return falha("host_invalido", "Usuário ssh inválido.");
  const h = host.toLowerCase();
  if (!validarHost(h)) return falha("host_invalido", "Nome de host inválido (use um domínio comum, sem IPv6 nem caracteres especiais).");
  const segs = segmentosValidos(caminho);
  if (segs === null) return falha("caminho_invalido", "O caminho precisa ser dono/repositório, só com letras, números, ponto, hífen e sublinhado.");
  const absoluto = caminho.startsWith("/") ? "/" : "";
  return montar({ tipo: "ssh", host: h, segs, urlGit: (s) => `${usuario}@${h}:${absoluto}${s.join("/")}` });
}

function analisarLocal(t: string): ResultadoOrigem {
  let caminho = t;
  if (/^file:\/\//i.test(t)) {
    if (!/^file:\/\/\//i.test(t)) return falha("local_invalido", "Use file:/// seguido do caminho absoluto.");
    try {
      caminho = decodeURIComponent(new URL(t).pathname);
    } catch {
      return falha("local_invalido", "Caminho file:// inválido.");
    }
  }
  if (caminho.includes("\0") || caminho.split(/[\\/]/).some((s) => s === "..")) return falha("local_invalido", "O caminho local não pode ter `..`.");
  const base = caminho.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  const repo = base.replace(/\.git$/i, "");
  if (repo === "") return falha("local_invalido", "Caminho local incompleto.");
  return { ok: true, origem: { tipo: "local", provedor: "local", host: "local", dono: null, repo, github_slug: null, nome_sugerido: sugerirNome(repo), exibicao: `(pasta local) …/${repo}`, url_git: caminho } };
}

export function analisarOrigemGit(bruta: unknown, op: { permitirLocal?: boolean } = {}): ResultadoOrigem {
  if (typeof bruta !== "string") return falha("formato", "Informe a URL do repositório.");
  const t = bruta.trim();
  if (t === "") return falha("vazia", "Informe a URL ou o identificador do repositório.");
  if (t.length > TAMANHO_MAX) return falha("muito_longa", "A URL é longa demais.");
  if (RE_CONTROLE.test(t)) return falha("controle", "A URL tem caracteres de controle ou invisíveis.");
  if (t.startsWith("-")) return falha("opcao", "A URL não pode começar com `-` (seria lida como opção do git).");
  if (RE_LOCAL.test(t)) {
    if (op.permitirLocal !== true) return falha("local_bloqueado", "Caminho local não é aceito por padrão. Marque “permitir caminho local” se for isso mesmo.");
    return analisarLocal(t);
  }
  if (RE_TRANSPORTE.test(t)) return falha("esquema_proibido", "Transportes como `ext::` executam programas e são recusados. Use https:// ou ssh.");
  if (/\s/.test(t)) return falha("espaco", "A URL não pode ter espaços (nem opções como --upload-pack).");
  if (RE_NAO_ASCII.test(t)) return falha("nao_ascii", "Use só caracteres ASCII na URL (letras parecidas de outros alfabetos são recusadas).");
  if (RE_PONTOS.test(t)) return falha("caminho_invalido", "O caminho não pode ter `.` nem `..`.");
  const esquema = RE_ESQUEMA.exec(t);
  if (esquema !== null) {
    const e = (esquema[1] as string).toLowerCase();
    if (e === "https") return analisarHttps(t);
    if (e === "ssh") return analisarSshUrl(t);
    return falha("esquema_proibido", `O esquema ${e}:// não é aceito. Use https:// ou ssh.`);
  }
  const scp = /^([^@:/\s]+)@([^:/\s]+):(.+)$/.exec(t);
  if (scp !== null) return analisarScp(scp[1] as string, scp[2] as string, scp[3] as string);
  const atalho = RE_ATALHO.exec(t);
  if (atalho !== null) {
    const dono = atalho[1] as string;
    const repoBruto = atalho[2] as string;
    const repo = repoBruto.replace(/\.git$/i, "");
    if (repo === "" || repo === "." || repo === "..") return falha("caminho_invalido", "O nome do repositório está incompleto.");
    return { ok: true, origem: { tipo: "github_curto", provedor: "github", host: "github.com", dono, repo, github_slug: `${dono}/${repo}`, nome_sugerido: sugerirNome(repo), exibicao: `github.com/${dono}/${repo}`, url_git: `https://github.com/${dono}/${repo}.git` } };
  }
  return falha("formato", "Formato não reconhecido. Use https://github.com/dono/repo, git@github.com:dono/repo.git ou dono/repo.");
}

/** Nome de branch seguro para `git clone --branch`. Vazio/null = a padrão do repositório. */
export function validarBranch(bruto: unknown): { ok: true; branch: string | null } | { ok: false; motivo: string } {
  if (bruto === null || bruto === undefined) return { ok: true, branch: null };
  if (typeof bruto !== "string") return { ok: false, motivo: "Branch inválida." };
  const b = bruto.trim();
  if (b === "") return { ok: true, branch: null };
  if (b.length > 200 || b.startsWith("-") || b.startsWith("/") || b.endsWith("/") || b.endsWith(".") || b.endsWith(".lock") || b.includes("..") || b.includes("//") || b.includes("@{") || !/^[A-Za-z0-9._/+-]+$/.test(b)) {
    return { ok: false, motivo: "Nome de branch inválido (use letras, números, ponto, hífen, sublinhado e barra)." };
  }
  return { ok: true, branch: b };
}
