// Única fonte do nome do produto (D-01). Tudo que carrega o nome deriva de `ID`.
// Para renomear o produto: troque `NOME` e `ID` aqui (e o "name"/"appId" do package.json e do
// electron-builder, conferidos por teste). Nenhum outro arquivo de src/ contém o nome literal.

const NOME = "ExpxV";
const ID = "expxv";
/** Identidade ESTÁVEL dos dados (D-341): pasta de `userData` e item do cofre do SO. Renomear `ID` não a muda (o script `renomear` a fixa em literal). */
const ID_DADOS: string = ID;
/** Ids de dados de nomes anteriores (mais recente primeiro): o primeiro boot copia o `userData` de um deles para `ID_DADOS`. */
const IDS_ANTERIORES: readonly string[] = [];
const ID_ENV = ID.toUpperCase();

export const PRODUTO = {
  nome: NOME,
  id: ID,
  /** nome mostrado na interface e nos instaladores (separado de `nome` para permitir variações). */
  nomeDeExibicao: NOME,
  idDados: ID_DADOS,
  idsAnteriores: IDS_ANTERIORES,
  /** canal de atualização padrão (D-24: a atualização segue desligada por padrão). */
  canalPadrao: "stable",
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
  /** prefixo das skills embarcadas do produto (Fase 7, D-43): `ev-guide`, `ev-pilot`... */
  prefixoSkill: "ev-",
  /** prefixo de variáveis de ambiente do produto. */
  prefixoEnv: `${ID_ENV}_`,
  /** repositório de releases: placeholder enquanto nada é publicado (D-24). */
  repositorioReleases: { dono: "bittencourtthulio", repo: ID },
} as const;

export function variavelDeAmbiente(nome: string): string {
  return `${PRODUTO.prefixoEnv}${nome}`;
}
