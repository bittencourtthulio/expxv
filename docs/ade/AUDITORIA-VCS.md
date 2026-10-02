# Auditoria de segurança do versionamento (Fase 6, T-06.40)

Auditoria própria dos módulos de execução, de conflito, de remoto, de SVN e do forge, feita lendo o código e provando cada item com
teste. Escopo: `src/nucleo/vcs/**`, `src/nucleo/forge/**`, `src/main/vcs*.ts`, `src/main/ipc/vcs*.ts`, telas de Versionamento e o card de PR
do Início. Decisões de base: D-33 a D-36, D-241 a D-247. Data: 2026-10-01.

**Veredito: nenhum achado ALTA aberto.** Dois achados MÉDIA e três BAIXA, todos corrigidos nesta passada com teste; três riscos residuais
aceitos e registrados no fim.

## Checklist

| Item | Resultado | Prova |
|---|---|---|
| Nada de token, senha ou credencial em argv | OK | `svn`: senha só por stdin (`--password-from-stdin`), `--password`, `--username`, `--trust-server-cert` e afins recusados (`svn/comum.test.ts`). Forge Bitbucket/Azure: credencial em cabeçalho HTTP dentro do processo, nunca argv (`forge/rest.ts`); vem do cofre (D-247). GitHub/GitLab: login da própria CLI. Git: URLs saem sem credencial (`semCredenciais`). |
| Nada de token, senha ou credencial em log, erro ou evento | OK | `sanearErro` (main) passa por `semSegredos` + `semCredenciais` e troca caminhos absolutos; `rest.ts` redige o valor e suas partes; auditoria grava só nomes, contagens e hashes; assunto de commit/PR passa por `semSegredos` (A-04). Testes: `vcs.test.ts` (segredo no corpo e no assunto), `vcs-credencial.test.ts`. |
| Nenhum comando destrutivo sem confirmação | OK | Tabela de risco completa e testada em `src/main/vcs-risco.test.ts` (T-06.37): cada operação dos canais `vcs:*` tem risco declarado (operação nova sem classificação reprova); descartar, apagar branch à força, lease, `svn revert` e criar ramo no servidor recusam sem confirmação e não mudam nada. |
| Confirmação digitada nas ações de remoto destrutivas | OK | Lease: nome exato da branch, nunca na branch padrão, sempre com simulação antes (`remotos.ts`, `vcs-risco.test.ts`). Apagar branch à força: nome digitado. |
| Allowlist de subcomandos do git | CORRIGIDO | A-01 e A-02 abaixo. `allowlist.test.ts`. |
| Nenhum `push`, `fetch` ou chamada de rede automática | OK | Único caminho de `push` é `pushRemoto`/`forceWithLease` (via `rodarRemoto`), só por IPC do renderer com `origem: "usuario"`; nenhuma tool MCP expõe versionamento. Exceção opt-in e desligada por padrão: fetch em segundo plano (D-243), testado em `vcs.test.ts` (desligado = zero buscas; sem foco = zero; liberado = para; push nunca) e medido em P-22. PR no Início: só no clique. |
| Caminhos não confiáveis | OK | Caminhos do IPC passam por `caminhoSeguro` (sem `..`, absoluto, NUL) e vão depois de `--`; nomes de ref/rev por `validarNomeRef`/`resolverRev`; árvore da Missão resolvida por `realpath` e recusada fora do workspace ou fora do padrão `<repo>--*` (`vcs.test.ts`); `core.fsmonitor=false` sempre e `hooksPath`/protocolos em pasta não confiável (`seguranca-confianca.test.ts`); ambiente limpo (`GIT_*` removido, `GIT_TERMINAL_PROMPT=0`). Mensagens e arquivos de mensagem: stdin/arquivo temporário, nunca argv. |
| SVN | OK | Todas as chamadas por `rodarSvn`: `--non-interactive`, entrada do usuário depois de `--`, flags perigosas recusadas, URL só `https`/`svn+ssh` sem credencial, gravar no servidor exige `confirmado_servidor` e origem `usuario`, senha nunca em argv, `diff-cmd`/`editor-cmd`/`config-dir` proibidos. Sem achados. |
| Nenhuma leitura com lock | OK | Leituras rodam com `GIT_OPTIONAL_LOCKS=0` e `GIT_NO_LAZY_FETCH=1` (leitura nunca busca objeto na rede); fila separada para escrita e para rede (um fetch lento não segura commit). `svn status` não tem equivalente ao opcional lock e só lê o `wc.db`. |
| Revisão independente dos módulos de execução e de conflito | OK | `executor.ts`, `comum.ts`, `remotos.ts`, `conflitos.ts`, `merge.ts`, `estagiar.ts`: ver achados. Conflito: `resolverHunks` só aceita ids existentes, grava só dentro da árvore e valida a escolha por tipo de conflito. |
| Missão ↔ VCS só lê o método | OK | `ENTREGA.md` é lido (commits e PR), nunca escrito; divergência com o forge só sinaliza "disco desatualizado" (`pr-sinaleira.ts`, `vcs.test.ts` confere que o arquivo não muda). |

## Achados

| # | Sev. | Achado | Correção | Teste |
|---|---|---|---|---|
| A-01 | MÉDIA | `rodarGit` decidia por **denylist** (`push` e flags de força) e achava o subcomando como "primeiro argumento que não começa com `-`". `["-C","/x","push"]` e `["-c","alias.x=!cmd","status"]` passariam. Nenhum chamador real montava isso, mas era uma defesa furada. | Allowlist `SUBCOMANDOS_GIT`; o subcomando é sempre o primeiro argumento; rede só por `rodarRemoto` (D-246). | `git/allowlist.test.ts` |
| A-02 | MÉDIA | `rodarRemoto` (a porta de rede e de `push`) aceitava qualquer argumento: `push --force`, `--mirror`, `--delete`, refspec `+x`/`:x`, `--upload-pack=cmd` (execução de programa). | Só `fetch`/`pull`/`push`/`submodule`; `-c protocol.*` como única opção global; recusa força (exceto `--force-with-lease=refs/heads/x:<hash>` só em `push`), espelho, apagar ref e programas externos. | `git/allowlist.test.ts` |
| A-03 | BAIXA | `git diff` e `stash show -p` honravam `diff.<driver>.textconv` do `.git/config` (programa arbitrário), mesmo com `--no-ext-diff`. | `--no-textconv` em `diff.ts` e `stash.ts` (o diff do app nunca executa conversor do repositório). | `seguranca-confianca.test.ts` |
| A-04 | BAIXA | O assunto do commit/PR (120 caracteres, digitado pelo usuário) ia à auditoria sem remover token ou credencial em URL. | `assunto()` passa por `semSegredos(semCredenciais(...))`. | `vcs.test.ts` |
| A-05 | BAIXA | `ENTREGA.md` era lido seguindo symlink (leitura de arquivo fora do workspace) e sem teto de tamanho. | `lerArquivoSeguro`: `lstat` + `O_NOFOLLOW`, só arquivo comum, teto de 1 MiB; usado por `missao-entrega.ts` e `pr-estado.ts`. | `missao-entrega.test.ts` |

## Riscos residuais aceitos (registrados, não corrigidos)

1. **Workspace aberto pelo usuário = pasta confiável** (decisão da 6E). Num repositório hostil aberto de propósito, config local que o próprio git executa
   (`filter.<x>.clean/smudge`, `commit.gpgsign` com `gpg.program`, `core.sshCommand`, `credential.helper`) e os hooks rodam como num terminal do usuário. O app já
   neutraliza `core.fsmonitor`, `--no-ext-diff` e `--no-textconv`, remove `GIT_*` do ambiente e tem o modo `nao_confiavel` (sem hooks, sem `ext`) para pastas
   que o usuário não abriu. Melhoria futura: perguntar na primeira abertura se a pasta é confiável (a Fase 21 trata de distribuição e confiança).
2. **`rebase_interativo` com `forcar`** reescreve localmente commits já publicados sem confirmação digitada. É local e reversível pelo reflog, e o push continua
   exigindo lease com nome digitado e nunca na branch padrão. Aceito como baixa; a tela avisa e oferece simulação.
3. **`svn status` e leituras do SVN** tocam o `wc.db`; o SVN não oferece opção equivalente a `GIT_OPTIONAL_LOCKS`. Aceito.

## Pendente de validação em máquina com binário externo

- E2E no Electron real (`tests/vcs.e2e.test.ts`): escrito e tipado, **ainda não executado** porque exige `npm run build` e o `dist/` está em uso pelo `npm run dev` do dono.
  Rodar: `npm run build && npx vitest run --config vitest.e2e.config.mts tests/vcs.e2e.test.ts`.
- `gh` real e SVN real contra servidor: cobertos por stubs/fakes nos testes de unidade (`forge/*.test.ts`, `svn/*.test.ts`); `svnadmin` local mede P-16 SVN quando existe.
