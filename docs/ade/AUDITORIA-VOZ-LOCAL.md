# Auditoria da voz local embutida (D-540 a D-549)

Escopo: download consentido de modelo, instalação, integridade, runtime em processo próprio e motor local no ditado. Método: ameaça → controle → teste que falha sem o controle. Todos os testes citados rodam sem rede real
(servidor falso em loopback) e sem baixar modelo.

## Achados corrigidos e testados

| # | Ameaça / achado | Controle | Teste |
|---|---|---|---|
| A1 | **URL ou host de origem controlado pelo renderer** (SSRF, exfiltração por "baixar de…") | O renderer só envia `modelo_id` (regex fechada); URL, host, caminho e checksum vêm do catálogo versionado e validado; validador estrito recusa campo extra (`url`, `caminho`); nenhum host/URL de modelo existe no código | `voz-modelos-boot.test.ts` (payloads recusados antes do serviço), `catalogo.test.ts`, `voz-local-empacotamento.test.ts` (varredura de `huggingface`/`hf.co` no código de voz) |
| A2 | **Redirecionamento para outro host** (CDN comprometida, open redirect) | `cliente-http` recusa salto de host, exceto para os padrões do catálogo (`redirecionar_para`: https, porta padrão, sem credencial, sem IP literal, curinga só de sufixo com ≥ 2 rótulos); o hash final é a âncora | `cliente-http.test.ts` (salto só para host listado; padrões inválidos recusados antes do socket; `casaRedirect` não casa domínio nu nem sufixo parcial), `download.test.ts` (outro host recusado sem tocar o destino; `localhost` recusado mesmo consentido) |
| A3 | **Path traversal / zip-slip** | Sem arquivo compactado: arquivos soltos com nome simples validado (sem `/`, `\`, `..`, `:`, reservados do Windows, ponto inicial); defesa em profundidade no downloader; id da pasta com regex fechada; `.integridade.json` e `.part` não podem ser nome de arquivo do catálogo | `catalogo.test.ts` (17 nomes ruins), `download.test.ts` ("nome de arquivo com traversal": nada fora da pasta, zero conexões) |
| A4 | **Checksum adulterado** (mesmo tamanho) | sha256 em streaming por arquivo; divergência apaga o parcial, não repete e não instala | `download.test.ts`, `voz-modelos.test.ts` (erro `checksum_invalido` com instrução) |
| A5 | **Tamanho diferente do declarado** (mais, menos, Content-Range incoerente, corpo curto) | `Content-Length`/`Content-Range` e bytes recebidos têm de bater com o catálogo; teto de bytes por requisição | `download.test.ts` (acima do declarado, CL a mais/a menos, Content-Range, corpo curto retoma) |
| A6 | **Disco cheio** | Espaço conferido antes (parciais contam a favor) e `ENOSPC`/`EDQUOT` tratados; o parcial fica para retomar | `download.test.ts`, `voz-modelos.test.ts` |
| A7 | **Modelo trocado depois de verificado** | Marca `.integridade.json`; verificação RÁPIDA antes de TODA carga (tamanho, mtime, symlink, sha256 dos pequenos), COMPLETA no teste e na instalação; divergência = `modelo_corrompido` (não carrega) | `download.test.ts` ("integridade depois de instalado"), `voz-modelos.test.ts` (ativar/autoteste/motor recusam) |
| A8 | **Execução de binário baixado** | Não existe: o modelo é DADO; o runtime (addon) viaja no pacote, junto do app assinado. Processo por `ELECTRON_RUN_AS_NODE`, executável e argumentos separados, sem shell, ambiente mínimo (sem chaves), stdio descartado | `voz-modelos-boot.test.ts`, `voz-local-empacotamento.test.ts` (worker autocontido: sem rede, disco nem processo) |
| A9 | **Áudio ou transcrição em log, evento ou erro** | Só códigos e contagens; erros do runtime carregam código fixo; o IPC loga só o nome da classe; histórico em memória | `voz-modelos.test.ts` (eventos sem texto nem caminho), `voz-local-empacotamento.test.ts` (sem `console.*` nos módulos), `runtime.test.ts` |
| A10 | **Consentimento** (rede sem aceite, aceite antigo, aceite eterno) | `aceite_versao` = versão vigente do texto; aceite gravado antes de abrir conexão; host liberado só durante o download; token de uso único por requisição; retomar exige aceite vigente; nada gravado se o pedido foi recusado | `voz-modelos.test.ts`, `download.test.ts` (token inválido ⇒ zero conexões) |
| A11 | **Symlink plantado** no lugar do `.part` ou da pasta | `lstat` + `O_NOFOLLOW`; symlink é removido, nunca seguido; marca e arquivos instalados não podem ser symlink | `download.test.ts` |
| A12 | **Histórico guardava o texto falado sem redação** (achado: contrariava T-11.03) | `redigirSegredos` no histórico em memória; o texto injetado no terminal segue como a pessoa falou (D-548) | `voz-local-motor.test.ts` |
| A13 | **Apagar com download ativo / modelo carregado** | `apagar` cancela o download, descarrega o runtime (solta arquivos e RAM) e só então remove; desativa o motor se era o ativo | `voz-modelos.test.ts` |
| A14 | **Processo órfão ou vazando RAM** | Descarregar = encerrar o processo; o pai morrer encerra o filho; `encerrar` do serviço mata o processo; sem timer com o modelo descarregado | `runtime.test.ts` (inclui worker real), `voz-modelos-boot.test.ts`, P-543 |
| A15 | **Runtime que não carrega** (pacote sem o addon, plataforma sem suporte) | Disponibilidade checada antes do download (não baixa 670 MB para nada) e erro nominal `runtime_indisponivel` com caminho alternativo | `voz-modelos-boot.test.ts`, `VozLocal.test.tsx` |

## Riscos residuais aceitos (declarados)

- **Curinga `*.hf.co` / `*.huggingface.co`:** qualquer subdomínio dessas organizações pode servir o arquivo; a integridade não depende do host, e sim do sha256 fixado no catálogo (pacote assinado).
- **Verificação rápida por tamanho + mtime:** um processo do MESMO usuário que forje mtime e tamanho passa na rápida; a completa (botão "Testar") pega. Quem já escreve nos dados do usuário tem acesso muito maior que isso.
- **Catálogo viaja no pacote:** atualizar modelos = nova versão do app (por desenho: nenhuma lista remota decide o que baixar).
- **Windows** validado só em unidade (D-26): permissões 0700/0600 não se aplicam; `O_NOFOLLOW` é ignorado no Windows (o `lstat` continua valendo).
- **Parakeet não foi baixado** no desenvolvimento: carga, RAM e velocidade dele são estimativas até o primeiro uso real.
