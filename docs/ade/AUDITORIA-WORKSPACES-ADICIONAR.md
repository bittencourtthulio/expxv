# Auditoria: Adicionar workspace (D-600 a D-609, D-613 a D-615)

Escopo: o modal "Adicionar workspace" (abrir pasta, clonar repositório, novo projeto), o serviço do main (`src/main/workspaces-adicionar.ts`), os canais `workspaces:adicionar_*` e o núcleo `src/nucleo/workspaces/adicionar/**`. Postura: o que vem do renderer, da rede, do repositório clonado e do disco é hostil até prova em contrário; segurança é o padrão, leveza é requisito (nada no boot, varredura leve, eventos coalescidos).

Legenda: **Defesa** = o que o código faz; **Prova** = o teste que quebra se a defesa sumir; **Residual** = o que ficou e por quê.

## R-01 · Injeção via URL (opção, programa, transporte)

- **Ameaça.** `-oProxyCommand=…`, `--upload-pack=…`, `ext::sh -c …`, `fd::`, `file://`, URL com `--upload-pack` embutido, `git@-oProxyCommand=x:dono/repo`, `javascript://`, quebra de linha para empilhar argumentos, homóglifos, `../../` em scp.
- **Defesa.** `analisarOrigemGit` (main, revalidada a cada `iniciarClone`): aceita só https, ssh e `dono/repo`; recusa começo com `-`, `transporte::`, esquemas diferentes de https/ssh, controle/bidi/invisíveis, espaços, não-ASCII, host fora de LDH ou começando com `-`, `.`/`..`/`%2e%2e`, `?`/`#`; reconstrói o argumento (`url_git`) só com o que foi validado. O executor nunca usa shell; a URL e o destino vão SEMPRE depois de `--`. `GIT_ALLOW_PROTOCOL` limita https | ssh:https (| file só com origem local autorizada) para o clone e os submódulos; `protocol.ext.allow=never`. Branch passa por `validarBranch` (sem `-`, `..`, `@{`, espaço, `.lock`).
- **Prova.** `url.test.ts` (113 casos: 15 aceitos, 44 recusados por tabela com todas as injeções acima, local, nome de pasta, branch), `clonar.test.ts` (opções antes de `--`, ambiente), `ipc/workspaces-adicionar.test.ts`, `workspaces-adicionar.test.ts` ("valida no main").
- **Residual.** Um host ssh/https legítimo e malicioso continua sendo o que o dono escolheu clonar (ver R-02). IP literal IPv4 é aceito (servidor interno do dono); IPv6 literal e IDN não.

## R-02 · Repositório hostil clonado

- **Ameaça.** Hooks, `core.fsmonitor`/`core.sshCommand`/filtros no `.git/config` do clone, `.gitmodules` com `ext::` ou `file://`, LFS com smudge, symlinks para fora, `.gitattributes`, repositório enorme (disco/tempo).
- **Defesa.** O clone não executa nada: `core.hooksPath` neutro e `core.fsmonitor=false` por `-c` (executor, `nao_confiavel`) e por `GIT_CONFIG_COUNT` (vale também para o git que o `gh` chama); `GIT_LFS_SKIP_SMUDGE=1`; submódulos desligados por padrão e restritos aos protocolos da URL (recusados com origem local); o git já impede checkout de symlink que escape da árvore. O workspace entra com permissão `seguro` e sem confiança (D-615): "Executar", hooks do app e o executor de versionamento seguem as regras de projeto não confiável. Timeout por silêncio (120 s) e geral (30 min) e cancelar mata a árvore e apaga a pasta parcial (um clone por destino, até 3).
- **Prova.** `clonar.test.ts` ("não executa hooks": hook do `init.templateDir` do usuário NÃO roda; config injetada), cancelar/silêncio/total, `workspaces-adicionar.integracao.test.ts`.
- **Residual.** (a) Texto do repositório (`CLAUDE.md`, `AGENTS.md`, README) pode conter injeção de prompt para as CLIs de IA que o dono abrir nele: o app não lê nem executa esses arquivos, mas a CLI do dono pode; a permissão `seguro` (aprovações normais) é a mitigação. (b) Disco: um repositório muito grande ocupa espaço até o timeout/cancelar; o clone raso é a opção do dono. (c) Hooks de um `~/.gitconfig` com `core.hooksPath` próprio ficam neutralizados durante o clone (intencional).

## R-03 · Path traversal e destino

- **Ameaça.** Nome com `../`, `a/b`, `..`, nome reservado do Windows, link simbólico como destino, destino fora do que o dono escolheu, renderer enviando um caminho qualquer.
- **Defesa.** O renderer nunca envia caminho: só token opaco (`d_…`, validado por regex) emitido pelo main (pasta de projetos ou diálogo nativo) + nome. O nome é UM segmento (`validarNomePasta`: sem separadores, controle, `.`/`..`, começo `.`/`-`, final `.`/espaço, reservados); o destino é `join(pai, nome)` com checagem de `dirname`; `avaliarDestino` recusa link simbólico e arquivo; o pai precisa ser absoluto, normalizado, existir e ser gravável. `dentroDe` compara segmentos (nunca prefixo de texto). Achados da varredura e "abrir a existente" também só por id/token.
- **Prova.** `destino.test.ts`, `ipc/workspaces-adicionar.test.ts` ("NENHUM caminho de destino é aceito do renderer"), `workspaces-adicionar.test.ts` (token inválido/expirado), `novo-projeto.test.ts` (travessia).
- **Residual.** TOCTOU entre avaliar e clonar: o git/`mkdir` revalidam na hora (o executor falha se a pasta passou a existir não vazia; `writeFile` usa `wx`); o dono é a única parte que escreve na própria pasta de projetos.

## R-04 · Credenciais em URL e segredo no caminho

- **Ameaça.** `https://usuario:senha@host`, token como usuário, senha em `ssh://`, token em saída de erro, log ou evento.
- **Defesa.** Qualquer userinfo em https e senha em ssh é recusado com orientação (`gh auth login`/credential helper); o texto recusado nunca é ecoado. Toda mensagem de erro passa por `semSegredos`; `evento_dominio` leva só host, repositório sem userinfo, flags e códigos (nunca URL completa nem caminho absoluto). `GIT_ASKPASS` vazio e `GIT_TERMINAL_PROMPT=0`: nenhum prompt; o app não lê `.env`, não guarda token e não usa `hosts.yml` (D-34). A estimativa de login só lê `gh auth status` (linhas de token são descartadas).
- **Prova.** `url.test.ts` (credenciais), `clonar.test.ts` ("nunca vaza credencial"), `gh.test.ts` (descrição com token), `workspaces-adicionar.test.ts` (auditoria sem URL/caminho).
- **Residual.** O credential helper do usuário continua funcionando (é o desejado) e o `GIT_CONFIG_NOSYSTEM` (D-606) ignora o gitconfig do sistema (ex.: `osxkeychain` do git da Apple); quem usa `gh auth setup-git` ou `~/.gitconfig` não é afetado.

## R-05 · Sobrescrita de pasta

- **Defesa.** Pasta existente e não vazia nunca é usada para clonar nem criar projeto: colisão devolve sugestão (`nome-2`) e "Abrir a existente"; pasta vazia é aceita; arquivos do template usam `wx`; falha desfaz só o que o app criou (`limparParcial` não segue link simbólico e fica dentro do destino). Reabrir a pasta de um workspace removido restaura o histórico (AUD-11) em vez de duplicar.
- **Prova.** `clonar.test.ts` (colisão, parcial, vizinha intacta), `novo-projeto.test.ts`, `workspaces-adicionar.integracao.test.ts`.

## R-06 · Varredura invasiva

- **Defesa.** Opt-in por clique; só lê nomes de diretório e `.git/HEAD` (nenhum processo, nenhum arquivo de código ou ambiente); locais fixos; ≤ 2 000 diretórios, profundidade ≤ 3 (`~` só 1, sem as pastas protegidas do macOS para não disparar o pedido de permissão), ignora `node_modules`, `.git`, `Library`, `dist`, `.venv`, ocultas e links simbólicos; não desce em projeto achado; cede o event loop a cada ~12 ms (o main nunca trava > 50 ms); cancelável; resultados em lotes coalescidos e só mascarados (`~/…`); adicionar é por id.
- **Prova.** `varredura.test.ts`, `workspaces-adicionar.test.ts` (busca, cancelar, id desconhecido).
- **Residual.** Ler `~/Documents/Projetos` (raiz explícita) pode disparar o pedido de permissão do macOS na primeira busca; é consequência de o dono ter pedido a busca.

## R-07 · Rede só com consentimento por ação

- **Defesa.** Nenhum módulo novo usa `fetch`/`http` (regra de `nucleo/rede`). Clonar e listar repositórios exigem `consentimento: true` no payload (a UI só envia depois de "Revisar e clonar…" → painel de consentimento → "Clonar", ou do clique em "Carregar meus repositórios"); o consentimento vale para uma tentativa. `gh auth status` e `gh --version` são locais e baratos (cache de 60 s).
- **Prova.** `workspaces-adicionar.test.ts` ("exige o consentimento"), `adicionar-workspace.test.ts` (sem consentimento não clona; mudar campo desfaz), `Modal.test.tsx`.

## R-08 · Login e terminal

- **Defesa.** "Abrir terminal para `gh auth login`" abre um terminal novo e só digita o comando, sem Enter (D-614); o app não executa login nem pede senha.
- **Prova.** `adicionar-login.test.ts`, `Modal.test.tsx`.

## R-09 · Saída externa maliciosa (`gh`, git)

- **Defesa.** O JSON do `gh repo list` é saneado campo a campo (URL https, dono sem `-`, controle removido, tamanhos limitados, segredo redigido) e itens estranhos são descartados; o stderr do git é limitado (16 MiB), guardado só na cauda (16 KiB) e classificado; progresso malformado é ignorado; buffer de linha sem fim é descartado.
- **Prova.** `gh.test.ts`, `progresso.test.ts`.

## R-10 · Superfície nova de IPC

- **Defesa.** 12 canais aditivos com validador estrito por canal (campo a campo, nada extra), remetente autorizado antes do validador, erro nominal vira texto e o resto vira mensagem genérica; preload com nomes inline (teste de paridade).
- **Prova.** `ipc/workspaces-adicionar.test.ts`, `preload.test.ts`.

## Não feito (de propósito)

- Recomendação de clone raso por tamanho (a listagem do `gh` não traz tamanho; sem dado, sem sugestão).
- Listar branches remotas antes do clone (exigiria rede extra); fica o campo opcional "Branch".
- Persistir "pasta de projetos" além de uma preferência simples; consentimento persistente por host.
- Windows: só validado por teste de unidade/configuração (D-26); `taskkill /t` é o caminho de cancelar.
