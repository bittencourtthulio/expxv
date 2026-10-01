// Única fonte do nome do produto (D-01). Tudo que carrega o nome deriva de `ID`.
// Para renomear o produto: troque `NOME` e `ID` aqui (e o "name"/"appId" do package.json e do
// electron-builder, conferidos por teste). Nenhum outro arquivo de src/ contém o nome literal.

const NOME = "ExpxV";
const ID = "expxv";
const ID_ENV = ID.toUpperCase();

export const PRODUTO = {
  nome: NOME,
  id: ID,
  /** scheme privilegiado que serve o renderer (D-09). */
  scheme: `${ID}-app`,
  /** protocolo de URL do sistema operacional (abrir projeto pelo navegador/CLI). */
  protocoloUrl: ID,
  appId: `com.expx.${ID}`,
  /** pasta criada dentro do repositório do usuário (briefings, relatórios, anexos). */
  pastaNoProjeto: `.${ID}`,
  /** prefixo de sockets e named pipes do daemon de PTY (dois apps lado a lado não colidem). */
  prefixoSocket: `${ID}-pty`,
  prefixoSubagentes: `${ID}-subagentes`,
  prefixoPaineis: `${ID}-paineis`,
  /** prefixo de variáveis de ambiente do produto. */
  prefixoEnv: `${ID_ENV}_`,
  /** repositório de releases: placeholder enquanto nada é publicado (D-24). */
  repositorioReleases: { dono: "bittencourtthulio", repo: ID },
} as const;

export function variavelDeAmbiente(nome: string): string {
  return `${PRODUTO.prefixoEnv}${nome}`;
}
