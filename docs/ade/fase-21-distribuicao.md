# Fase 21 — Distribuição e atualização: instaladores, assinatura, auto-update com canais, CI completo e renomeação

Pedido do dono (via `DECISOES-DAS-PENDENCIAS.md`, P-01/P-03/P-06/P-08): *"pipeline de distribuição completa: auto-update (reintroduz
`electron-updater` com canais `stable`/`beta`), assinatura e notarização macOS, assinatura Windows, instaladores DMG/ZIP/NSIS, GitHub Releases, CI
matrix; tudo parametrizado e **desligado até haver repositório/certificados [depende do dono]**"*, Windows de primeira classe, nome do produto
configurável em build (`produto.ts` + `npm run renomear`) e `better-sqlite3` opcional.

## Objetivo e valor

1. **Entregar o app a quem não é o dono** sem perder a leveza: instalador macOS (DMG + ZIP universais) e Windows (NSIS x64) que **abrem** e passam no
   `test:pacote`, com verificação local de cada artefato (hash, arquitetura, `Info.plist`, assinatura **quando existir**, nativos, manifesto de update).
2. **Atualizar com segurança**: um atualizador por interface (Configurações › Atualizações + faixa discreta) com canais `stable` e `beta`, notas de versão
   (Fase 19) antes de instalar, verificação de integridade e de assinatura, bloqueio de downgrade, rollout gradual e **instalação que nunca derruba
   terminais em trabalho sem aviso**.
3. **Assinar e notarizar sem expor credencial**: scripts e verificações prontos e testados com *dublês*; as credenciais só existem como variáveis de ambiente
   do CI do dono (nomes versionados, **valores nunca**).
4. **CI completo versionado e não disparado**: validação em matriz (macOS arm64/x64, Windows), release por tag/`workflow_dispatch` com rascunho (draft) e
   proveniência; testes estáticos que impedem segredo no YAML, ação sem versão fixa e publicação automática.
5. **Renomear o produto com um comando** (D-01 estendido): constante única, script reversível, checklist e teste que prova que **nada** do nome antigo sobra
   e que **os dados do usuário (userData, cofre, sockets) não se perdem**.
6. **Prova de leveza no pacote**: P-01, P-03, P-06 e P-08 medidos **dentro do app empacotado**, não só em `dist/`.

## Portão da fase

1. **T-21.01 (estudo de ameaças da cadeia de distribuição) aprovada antes de T-21.13..T-21.20** (tudo que baixa ou executa código de rede). As tasks de
   renomeação, empacotamento, assinatura (scripts), CI e medição **não dependem** do estudo e podem começar já. Estudo reprovado = tasks do atualizador
   paradas e registradas em `STATUS.md` → Bloqueios; o resto da fase segue.
2. `npm run verificar` verde (typecheck + unidade + marca + orçamentos estáticos incluindo P-153 e P-154) e `npx vitest run tests/scripts` verde (empacotamento,
   workflows, renomeação, atualização desligada por padrão).
3. **Pacote local** (`npm run dist:dir`) e `npm run test:pacote` verdes, **mais** `npm run perf:pacote` (T-21.26): P-150..P-159 verdes.
4. **Atualizador contra servidor FALSO** (`tests/fixtures/atualizacao/`), sem rede externa: verificar → baixar → verificar hash/assinatura → instalar (backend
   falso) com sucesso; e todos os abusos AU-01..AU-24 (manifesto adulterado, downgrade, hash errado, assinatura inválida, redirecionamento a outro host, canal
   trocado, replay de manifesto antigo, rollout fora do grupo, instalação com Pane trabalhando, servidor lento/infinito/gigante).
5. **Com a atualização desligada (padrão do pacote): 0 sockets de versão, 0 timers, `electron-updater` ausente do `app.asar` e do `import()` de qualquer
   módulo**; com o perfil `com-atualizacao` do build, a dependência entra **só** nesse pacote e **só** por `import()` dinâmico depois do consentimento.
6. Renomeação: `npm run renomear -- --nome Teste --id teste --dry-run` lista todas as mudanças; aplicada numa **cópia** da árvore, o teste de varredura passa com
   o nome novo e o `userData`/cofre/sockets antigos continuam alcançáveis (migração de dados).
7. Nenhum segredo, certificado, `.p12`, `.p8`, chave privada de release ou token em qualquer arquivo versionado (varredura de sentinelas + `git ls-files`).
8. Registro em `STATUS.md` do que só o dono valida (certificados, notarização real, instalação em Windows real, repositório de releases, canal beta) — seção
   "Validação real (manual, do dono)".

## Princípios

1. **Leveza e velocidade (prioridade nº 1).** O atualizador não existe no boot (import dinâmico, depois da onda 2 e do consentimento); desligado custa
   **0 KB** no JS inicial e **0 MB** no pacote padrão; ligado, a checagem é **≤ 1 requisição por 24 h** e nunca bloqueia a UI (P-12).
2. **Nada sai da máquina por esta fase (D-23).** Nenhum `git push`, nenhuma publicação, nenhuma assinatura/notarização com credencial real, nenhum upload.
   Workflows são arquivos; **não são disparados**. Testes usam servidor falso em loopback e dublês de `codesign`/`notarytool`/`signtool`.
3. **Auto-update é decisão do dono (D-24).** Existem **duas chaves**: (a) *chave de build* — `build/distribuicao.json` → `atualizacao.habilitada` (padrão
   `false`); (b) *chave de execução* — preferência do usuário + consentimento versionado. Sem as duas, **nenhum módulo de rede de versão é carregado**.
4. **Segurança como padrão inicial, nunca teto (D-140).** Padrão: verificar manualmente, nunca baixar sozinho, nunca instalar sozinho, só `stable`, nunca
   downgrade. Tudo isso é **configurável** (baixar automaticamente, instalar ao sair, canal `beta`, rollback manual para a versão anterior) por quem quiser
   mais conforto, cada opção com aviso e registro.
5. **Duas camadas de verificação.** (i) a do SO/`electron-updater` (assinatura de código macOS/Windows, `sha512` + blockmap do `latest*.yml`); (ii) **a nossa**,
   independente: `sha512` do artefato, assinatura **Ed25519 destacada do manifesto** com chave pública embutida no build (*pinning*), anti-downgrade e
   anti-replay por `versao` + `publicado_em` monotônicos. Se (ii) falha, **nada é instalado**, mesmo que (i) passe.
6. **Credencial nunca no repositório.** Scripts conferem a **presença** de variáveis por nome (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`…), nunca leem
   o valor para log, e falham fechado com mensagem que cita só o nome. Chave privada de assinatura do manifesto: arquivo fora do repo ou segredo do CI.
7. **Windows é alvo de primeira classe (P-06)**, mas D-26 vale: sem máquina Windows aqui, a prova é por teste de unidade, de configuração e **CI Windows
   versionado**; a instalação real em Windows é checklist do dono.
8. **O que o usuário tem não se perde.** Atualizar ou renomear nunca apaga `userData`, banco, cofre, preferências, worktrees; o daemon de PTY (D-12)
   sobrevive ao app e tem **protocolo versionado**: se a versão nova muda o protocolo, o app **avisa antes** e só reinicia o daemon com confirmação.
9. **Uma só fonte do nome (D-01).** Tudo que carrega o nome deriva de `src/nucleo/produto.ts`; `package.json` e `electron-builder.yml` são conferidos por teste.
10. **Reprodutível e auditável.** Cada build gera `SHA256SUMS`, SBOM (CycloneDX) e relatório de verificação; cada atualização aplicada vira linha no histórico
    local (`atualizacao_evento`) — sem telemetria (D-25).

## Estado atual (lido em 2026-10-01; ponto de partida, não resultado)

| Item | Hoje |
|---|---|
| `electron-builder.yml` | `mac`: dmg + zip **universais** (`mergeASARs: false`, `x64ArchFiles` do node-pty), `entitlements.mac.plist`; `win`: `nsis` x64 (`oneClick: false`, `perMachine: false`); `publish: github` com `owner/repo` placeholders; **exclui** `electron-updater` e suas dependências do pacote; `afterPack`/`beforePack` |
| Scripts | `dist:dir` (sem assinatura, `CSC_IDENTITY_AUTO_DISCOVERY=false`), `dist:mac`, `dist:win`, `dist:mac:arm64`, `test:pacote` (`scripts/verificar-pacote.mjs`: node-pty, MCP, worker, smoke, teto de 400 MB, fontes locais), `perf`, `tamanho-bundle` |
| CI versionado, não disparado | `validacao.yml` (matriz mac-arm64/mac-x64/windows: `npm ci`, typecheck, test, build, `dist:dir`, `test:pacote`); `release.yml` (tag `v*`: empacota mac/win, `CSC_*`/`APPLE_*` por secrets, `softprops/action-gh-release` em rascunho) — **sem** e2e, perf, auditoria, SBOM, verificação de assinatura, manifesto assinado, `workflow_dispatch`, `permissions` mínimas, ações fixadas por SHA |
| Atualização | **nenhum módulo** importa `electron-updater`; `tests/scripts/empacotamento.test.ts` barra o import e confere a exclusão no `files:` (D-24, ajuste) |
| `produto.ts` | `NOME`/`ID` → `scheme`, `appId`, `pastaNoProjeto`, prefixos de socket/env/skill, `repositorioReleases` placeholder; `varredura-marca.test.ts` proíbe o nome literal no resto de `src/` |
| Nativos no pacote | `node-pty` (prebuilds, `asarUnpack`), possível `sqlite-vec` (P-57, depende de assinatura de dylib), `web-tree-sitter` (WASM) |
| Banco | `node:sqlite` atrás de `src/nucleo/banco/` (D-08); `better-sqlite3` opcional por P-08 **ainda não existe** |

## Decisões que esta fase toma e o que ela ajusta (resumo; texto completo em `01-DECISOES.md`, D-340..D-349)

- **Ajusta D-24 (e o ajuste do MVP):** a atualização **volta**, mas por **módulo isolado e lazy** (`src/main/atualizacao/`), com perfil de build próprio, duas
  chaves de ligação e teste que passa de "ninguém importa" para "só o backend lazy importa, e só no perfil `com-atualizacao`" (D-340).
- **Estende D-01:** `produto.ts` ganha `idDados`, `idsAnteriores` e `canalPadrao`; renomear **não** muda `idDados` por padrão (senão o `userData` e o item do
  Keychain do `safeStorage` mudam e o cofre fica ilegível) (D-341).
- **Respeita D-23/D-25/D-140/D-26:** nada é publicado; sem telemetria; opção mais completa construída e **desligada**; Windows só em unidade + CI versionado.
- **Numeração:** D-340..D-349, P-150..P-159 (orçamentos), P-330..P-339 (pendências), sem colisão (conferido por `grep`).

## T-21.01 · Estudo de ameaças da cadeia de distribuição e do atualizador — GATE PARCIAL

**Entrega:** `docs/ade/seguranca/AMEACAS-FASE-21.md` + `tests/scripts/ameacas-fase21.test.ts` (que o valida), escritos **antes** de T-21.13. Mesmo formato do
`AMEACAS-REMOTO.md` (fronteiras, ativos, atores, STRIDE por componente, casos `AU-NN`, residuais, portões); reusa o vocabulário da Fase 13/20.

### Critérios de saída (binários)

1. Fronteiras: **F1** desenvolvedor↔repositório (código, workflows), **F2** CI↔segredos (certificados, chaves), **F3** CI↔GitHub Releases (artefatos),
   **F4** app↔feed de atualização (TLS, host), **F5** feed↔arquivo baixado (integridade), **F6** instalador↔SO (assinatura/Gatekeeper/SmartScreen),
   **F7** app novo↔dados do usuário (migração), **F8** renomeação↔identidade (appId, Keychain, protocolo de URL).
2. Ativos: chave privada de assinatura de código; chave privada do manifesto (Ed25519); tokens do CI; artefatos publicados; canal `stable`; `userData`/cofre.
3. ≥ **24 casos de abuso** `AU-NN` (os abaixo entram no mínimo), cada um com severidade, mitigação, **task existente** e **teste nomeado**; o teste de
   consistência **falha** se houver Alta sem task/teste válidos.
4. Residuais enumerados em texto exato e enviados ao dono (P-330): **R1** sem assinatura real o SO avisa/bloqueia e a integridade depende só da nossa
   camada (ii); **R2** repositório de releases comprometido publica versão maliciosa assinada com a chave que o CI guarda; **R3** primeira instalação baixada
   de fonte adulterada não é protegida pelo atualizador (só pela assinatura do SO e pelo `SHA256SUMS` conferido pela pessoa).
5. Portões registrados: **G1** auto-update ligado só com chave de build + consentimento; **G2** nenhum download automático por padrão; **G3** nenhum
   credencial real em teste; **G4** publicar/promover release = sempre humano.
6. Confirma ou corrige D-340..D-349 (pré-registradas).

### Pré-análise (insumo): casos de abuso mínimos

| AU | Caso de abuso | Sev. | Mitigação (resumo) | Task | Teste (nome) |
|---|---|---|---|---|---|
| AU-01 | **Manifesto adulterado** (versão, URL, hash) | Alta | assinatura Ed25519 destacada do manifesto, chave pinada no build; recusa sem assinatura válida | T-21.13 | `au01_manifesto_adulterado` |
| AU-02 | **Downgrade** para versão vulnerável | Alta | `versao` e `publicado_em` monotônicos; `allowDowngrade=false`; rollback só manual, assinado e para versão **já instalada antes** | T-21.13 | `au02_downgrade_recusado` |
| AU-03 | **Artefato com hash diferente** (CDN/espelho comprometido) | Alta | `sha512` do manifesto assinado conferido por streaming antes de entregar ao instalador; arquivo parcial removido | T-21.14 | `au03_hash_errado_apaga` |
| AU-04 | **Redirecionamento** do feed a outro host | Alta | host fixo do build; redirecionamento só para o mesmo host/CDN declarado; TLS padrão sem `rejectUnauthorized:false` | T-21.14, T-21.15 | `au04_redirecionamento_recusado` |
| AU-05 | **Replay de manifesto antigo** (congela o usuário numa versão) | Média | `valido_ate` curto no manifesto; relógio injetado; aviso "sem atualização há N dias" | T-21.13 | `au05_manifesto_expirado` |
| AU-06 | **Canal trocado** (beta vira stable; stable recebe beta) | Alta | canal dentro do manifesto assinado; app recusa canal diferente do escolhido; beta exige consentimento | T-21.13 | `au06_canal_cruzado` |
| AU-07 | **Chave privada do manifesto vaza** | Alta | chave fora do repo, só secret do CI; rotação por **chave dupla** (`chaves_aceitas` no build: atual + próxima); revogação por versão mínima assinada | T-21.13, T-21.10 | `au07_rotacao_de_chave` |
| AU-08 | **Segredo de assinatura no repositório/log do CI** | Alta | varredura de sentinelas em arquivos versionados e na saída dos scripts; `::add-mask::`; só nomes de variável | T-21.10, T-21.23 | `au08_sem_segredo_versionado` |
| AU-09 | **Workflow malicioso** (PR de fork lê secrets; `pull_request_target`; injeção em `run:`) | Alta | `pull_request` apenas; segredos só em `release.yml` por tag/dispatch e ambiente protegido; nenhuma expressão `${{ github.event.* }}` em `run:`; `permissions` mínimas | T-21.22, T-21.23 | `au09_workflow_sem_pr_target` |
| AU-10 | **Ação de terceiro comprometida** (tag móvel) | Média | ações fixadas por SHA com comentário da versão; teste falha se `@v` móvel em `release.yml` | T-21.22, T-21.23 | `au10_acoes_fixadas` |
| AU-11 | **Instalar com terminal em trabalho** (perda de saída/estado) | Alta | só instala com 0 Panes `trabalhando` **ou** confirmação; salva estado; daemon sobrevive; protocolo incompatível pede confirmação | T-21.16 | `au11_nao_instala_com_pane_trabalhando` |
| AU-12 | **Atualização liga sozinha** (padrão, reinício, perfil errado) | Alta | duas chaves; padrão desligado; `habilitada:false` ⇒ `import()` nunca chamado; teste de handles/timers | T-21.16, T-21.20 | `au12_desligado_zero_rede` |
| AU-13 | **Download automático sem consentimento** | Média | `autoDownload=false` por padrão; opção marcada e registrada | T-21.16 | `au13_sem_download_automatico` |
| AU-14 | **Servidor lento/infinito/gigante** (DoS ao app) | Média | timeouts, teto de bytes = `tamanho` do manifesto assinado, cancelável, nunca bloqueia o event loop | T-21.14 | `au14_servidor_hostil` |
| AU-15 | **Notas de versão com HTML/script/links** | Média | notas como **texto**; renderização por `textContent`; links só `http/https` sem credenciais | T-21.18 | `au15_notas_so_texto` |
| AU-16 | **Rollout enviesado** (usuário fora do grupo recebe cedo; grupo previsível) | Baixa | bucket determinístico por `idInstalacao` (UUID local, nunca enviado); `staging` no manifesto assinado | T-21.13 | `au16_rollout_estavel` |
| AU-17 | **Perda de dados na migração entre versões** | Alta | backup `userData` antes da migration (cópia do `.db`); migrations transacionais; se falhar, restaura | T-21.17 | `au17_migracao_com_backup` |
| AU-18 | **Renomeação quebra o cofre/dados** | Alta | `idDados` estável; `idsAnteriores`; migração copia (nunca apaga); teste com `safeStorage` falso | T-21.04, T-21.05 | `au18_renomear_preserva_dados` |
| AU-19 | **Renomeação deixa o nome antigo** (appId, protocolo, workflows) | Média | script e varredura sobre lista fechada de arquivos + varredura geral | T-21.05 | `au19_nome_antigo_nao_sobra` |
| AU-20 | **Instalador adulterado após o build** | Alta | `SHA256SUMS` + manifesto assinado + proveniência; verificador local confere hashes e `codesign`/Authenticode quando assinado | T-21.08..T-21.11 | `au20_artefato_adulterado` |
| AU-21 | **Nativo sem assinatura** (Gatekeeper recusa; dylib carregado sem validação) | Alta | verificador percorre todo Mach-O/PE do pacote e confere assinatura (quando assinado) e entitlements | T-21.11 | `au21_nativo_nao_assinado` |
| AU-22 | **Fuses/ASAR enfraquecidos** (injeção em `app.asar`, `--inspect`) | Média | fuses configurados e **conferidos no binário** (RunAsNode permanece ligado: o daemon depende); integridade do ASAR | T-21.07 | `au22_fuses_conferidos` |
| AU-23 | **Feed lido com credencial** (token de repositório privado no app) | Alta | o app **nunca** carrega token; feed público ou URL assinada de curta duração fornecida pelo dono; teste de sentinela no pacote | T-21.14 | `au23_sem_token_no_pacote` |
| AU-24 | **Telemetria de versão** (identifica instalação) | Média | requisição só leva `If-None-Match`/versão no cabeçalho padrão; `idInstalacao` nunca sai; sem cookie; teste de cabeçalhos | T-21.14 | `au24_sem_identificador_na_rede` |

## Orçamentos novos (somam-se aos de `03-ORCAMENTOS-DESEMPENHO.md`; numeração P-150..P-159)

Método comum: `npm run perf:pacote` (T-21.26) abre o **app empacotado** em `dist-app/` com Playwright (`_electron.launch({ executablePath })`), CLI falsa, servidor de
atualização falso e relógio injetado; `process.getProcessMemoryInfo`, `PerformanceObserver`, contagem de handles, script de tamanho. Fator `EXPXV_PERF_FATOR`.
Estourou, a task **não fecha**; corrige-se a causa.

| # | O que | Orçamento | Como se mede |
|---|---|---|---|
| P-150 | **P-01 no pacote**: processo → janela visível e casca interativa | ≤ 800 ms (3ª abertura, SO "quente"); 1ª abertura a frio **registrada** em `ultimo.json` (Gatekeeper/AV não entram no limite, entram no relatório) | marca no main + renderer, 5 aberturas, mediana |
| P-151 | **P-03 no pacote**: clique → xterm visível | ≤ 300 ms, sem contar a CLI | marcas como P-03 |
| P-152 | **P-06 no pacote**: memória do renderer, 4 painéis ociosos | ≤ 250 MB | `getProcessMemoryInfo` |
| P-153 | **P-08 no pacote**: JS inicial do renderer lido do `app.asar` | ≤ 350 KB gzip (idêntico a P-08), **+0 KB** por causa desta fase; teto do app ≤ 400 MB e **crescimento ≤ 3 %** entre fases sem decisão registrada | `scripts/tamanho-bundle.mjs` sobre o asar + `tamanhoDaPasta` |
| P-154 | Atualização **desligada**: não existe | 0 sockets, 0 timers, `electron-updater` ausente do asar, `src/main/atualizacao/**` não importado; P-01 não piora; **+0 KB** no JS inicial | contagem de handles + varredura do asar |
| P-155 | Verificação de versão (ligada) | pedido → estado `disponivel`/`atual` p95 ≤ 300 ms com servidor falso; **≤ 1 requisição por 24 h**; nenhuma tarefa > 50 ms (P-12); import dinâmico ≤ 40 ms | marcas + monitor de event loop + contador do falso |
| P-156 | Download e instalação (ligada) | UI sem quadro > 50 ms durante download de 100 MB falso; progresso coalescido ≤ 4 eventos/s; verificação de `sha512` em streaming ≤ 1,2× o tempo de leitura; memória ≤ +30 MB | `longtask` + `getProcessMemoryInfo` |
| P-157 | Verificação local dos instaladores | `npm run verificar:instaladores` ≤ 60 s para DMG + ZIP + NSIS (estático) sem rede | cronômetro no script |
| P-158 | Renomeação | `--dry-run` ≤ 2 s; aplicação em cópia ≤ 5 s; varredura de marca ≤ 3 s | cronômetro nos testes |
| P-159 | Banco opcional (`better-sqlite3`, se T-21.12 existir) | **opt-in de build**; mesmos testes de contrato; custo registrado (tamanho do pacote, startup, nativo universal) e **não pior** que `node:sqlite` em P-14 | benchmark lado a lado em `tests/perf` |

## Arquitetura e pastas

```
build/distribuicao.json                       manifesto de build (SEM segredo): canais, host do feed, chaves PÚBLICAS aceitas, atualizacao.habilitada=false,
                                              politica de rollout, assinatura.exigir (false por padrão)
src/compartilhado/atualizacao.ts              tipos de IPC/eventos (EstadoAtualizacao, ManifestoAtualizacao, ConfigAtualizacao…) — só o coordenador edita
src/nucleo/atualizacao/                       NÚCLEO PURO (sem Electron, sem rede)
  versao.ts · canais.ts                       semver estrito, ordem total, canais stable|beta, regras de promoção
  manifesto.ts                                parse/validação estrita do manifesto; campos: versao, canal, publicado_em, valido_ate, artefatos[{plataforma, arquitetura,
                                              url_relativa, sha512, tamanho}], notas, staging, versao_minima, chaves_revogadas
  assinatura.ts                               verificação Ed25519 destacada (node:crypto), chaves aceitas (atual + próxima), rotação
  politica.ts                                 decidir(estado, config, manifesto, agora): disponível? permitido? anti-downgrade, anti-replay, rollout, janelas
  rollout.ts                                  bucket determinístico por idInstalacao (HMAC), staging
  maquina.ts                                  máquina de estados: desligado → ocioso → verificando → disponivel → baixando → verificado → pronto → instalando | erro
  historico.ts                                eventos do histórico (sem dados pessoais)
src/main/atualizacao/                         SÓ aqui existe código que toca rede de versão e o updater (carregado por import() depois do consentimento)
  servico.ts                                  fachada: verificar/baixar/instalar/cancelar/reverter; guarda de Pane trabalhando; backup antes de instalar
  backend.ts                                  interface BackendAtualizacao {verificar, baixar(cb), instalar} (+ falso de teste)
  backend-electron-updater.ts                 ÚNICO arquivo que importa `electron-updater` (import dinâmico; perfil com-atualizacao)
  backend-manual.ts                           consulta o manifesto por `src/nucleo/rede/` e abre a página de download no navegador (sem instalar); sem assinatura real
  verificador.ts                              sha512 em streaming + assinatura do manifesto + tamanho; remove parcial
  guarda-instalacao.ts                        Panes trabalhando, daemon/protocolo, estado salvo, confirmação
src/main/ipc/atualizacao.ts                   canais IPC e validadores estritos
src/renderer/telas/configuracoes/Atualizacoes.tsx · src/renderer/casca/FaixaAtualizacao.tsx · estado/atualizacao.ts
scripts/
  renomear.mjs · lib/renomear.mjs             renomeação (dry-run padrão, reversível, relatório)
  lib/distribuicao.mjs (+ .d.mts)             lê/valida build/distribuicao.json, monta config derivada do electron-builder por perfil
  lib/config-builder.mjs                      perfis: local | ci | release | com-atualizacao (aplica fuses, exclusões, publish, notarize)
  assinatura/preparar.mjs · verificar-assinatura.mjs · verificar-nativos.mjs   presença de variáveis por nome; codesign/spctl/stapler/Authenticode; Mach-O/PE
  verificar-instaladores.mjs                  DMG/ZIP/NSIS/latest*.yml/blockmap/hashes/arquiteturas (estático, sem instalar no sistema)
  gerar-manifesto.mjs · assinar-manifesto.mjs  manifesto de atualização + assinatura Ed25519 (chave por env/arquivo fora do repo)
  notas-versao.mjs                            extrai a seção da versão do CHANGELOG (Fase 19) → NOTAS.md + releaseNotes do yml
  auditar-dependencias.mjs                    licenças, `npm audit` (informativo offline), SBOM CycloneDX
  perf-pacote.mjs                             P-150..P-153 no app empacotado
.github/workflows/{validacao,release,seguranca}.yml    versionados, NÃO disparados
tests/fixtures/atualizacao/{servidor-falso,cenarios,chaves-de-teste}.ts   feed falso em loopback (NUNCA rede real, chaves só de teste)
tests/scripts/{renomear,workflows,ameacas-fase21,atualizacao-desligada,instaladores,assinatura,mutacao-fase21}.test.ts
docs/ade/seguranca/AMEACAS-FASE-21.md · docs/ade/AUDITORIA-DISTRIBUICAO.md · docs/ade/CHECKLIST-RENOMEACAO.md
```

Fluxo de atualização (ligada):

```
agendador (1×/24 h, só com janela aberta ou ociosa) | clique "Verificar agora"
  └─► servico.verificar ─► backend.verificar (rede/: GET manifesto + .sig; host fixo; TLS padrão; If-None-Match)
        └─► manifesto.ts (validação estrita) ─► assinatura.ts (Ed25519, chaves pinadas) ─► politica.decidir (canal, downgrade, replay, rollout)
              └─► estado `disponivel` ─► UI: faixa + notas (texto) ─► [Baixar] (ou auto, se a pessoa optou)
                    └─► backend.baixar ─► verificador (sha512 streaming, tamanho) ─► estado `verificado`
                          └─► [Instalar e reiniciar] ─► guarda-instalacao (Panes trabalhando? protocolo do daemon?) ─► backup do banco ─► backend.instalar
                                └─► novo processo ─► migrations (transacionais) ─► evento `atualizacao_aplicada` ─► histórico (+ alerta, se Fase 20 ligada)
```

## Modelo de dados e migration

Uma migration `NNNN-distribuicao.ts` (**próximo número livre** na hora da execução; só o coordenador a cria — T-21.17), tabela global (sem workspace):

```sql
CREATE TABLE atualizacao_evento (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('verificada','disponivel','baixada','verificacao_falhou','instalada','revertida','recusada','config_alterada')),
  canal TEXT NOT NULL CHECK (canal IN ('stable','beta')),
  versao_de TEXT NOT NULL, versao_para TEXT,
  motivo TEXT,                         -- código nominal (ex.: 'assinatura_invalida', 'downgrade'), nunca texto de servidor
  criado_em TEXT NOT NULL);
CREATE INDEX ix_atualizacao_evento_criado ON atualizacao_evento (criado_em DESC);
```

Retenção: 180 dias (job idle 1×/dia). `idInstalacao` (UUID v4), canal, opções e consentimento ficam em `preferencias.json` (D-29), **não** no banco. Nenhuma coluna aceita
URL com credencial, token ou texto de servidor (varredura do schema por nomes `token|senha|segredo`).

## Contratos novos (o coordenador os mescla em `05-CONTRATOS.md` na T-21.30 e antecipa os tipos na T-21.02)

Canais IPC (lista fechada, validador estrito por canal, autorização por remetente; **nenhum** carrega URL do renderer):

| Canal | Entrada | Saída |
|---|---|---|
| `atualizacao:estado` | `{}` | `EstadoAtualizacao` (`fase`, `versao_atual`, `canal`, `disponivel?`, `progresso?`, `habilitada_no_build`, `consentimento`, `ultima_verificacao`) |
| `atualizacao:config_obter` / `atualizacao:config_definir` | `{}` / `ConfigAtualizacao` parcial (`ligada`, `canal`, `baixar_automatico`, `instalar_ao_sair`, `verificar_ao_abrir`, `consentimento_versao`) | `ConfigAtualizacao` |
| `atualizacao:verificar` · `atualizacao:baixar` · `atualizacao:cancelar` | `{}` | `{ok}` (resultado também por evento) |
| `atualizacao:instalar` | `{ confirmar_panes: boolean }` | `{ok, motivo?}` (`panes_trabalhando` se faltar confirmação) |
| `atualizacao:reverter` | `{ versao }` (só versão já instalada antes e guardada) | `{ok, motivo?}` |
| `atualizacao:historico` | `{ limite ≤ 100 }` | `AtualizacaoEvento[]` |
| evento `atualizacao:evento` | — | `EstadoAtualizacao` coalescido (≤ 4/s no download) |

Eventos de domínio (inglês `snake_case`): `update.checked`, `update.available`, `update.downloaded`, `update.failed`, `update.applied`. Alerta da Fase 20: `atualizacao_disponivel`
(fonte `sistema`, severidade `info`), `atualizacao_falhou` (`aviso`). **Arquivos gravados no repositório do usuário: nenhum.**

## UI (compacta, D-32)

- **Configurações › Atualizações**: estado (versão atual, canal, última verificação, "atualização desligada neste build" quando `habilitada_no_build=false`, com explicação), chave
  "Verificar atualizações" (consentimento versionado listando **exatamente** o que sai: o host do feed e a versão atual; nenhum identificador), canal `stable`/`beta` (beta com aviso),
  opções "baixar automaticamente" e "instalar ao sair" (desligadas), botões **Verificar agora / Baixar / Instalar e reiniciar / Cancelar / Reverter**, histórico (virtualizado), notas da
  versão (texto, Keep a Changelog).
- **Faixa discreta** no topo/rodapé ("Versão X disponível · Ver notas") só com atualização disponível e janela sem terminal em primeiro plano; nunca modal.
- **Instalar com Pane trabalhando**: diálogo listando quantos terminais estão em trabalho, o que o app fará (salvar estado; o daemon mantém as CLIs), e exigindo confirmação.
- Estados por forma **e** texto; teclado completo; leitor de tela (a11y herda a suíte existente); sem `backdrop-filter`; chunk lazy ≤ 20 KB gz.

## Tarefas

Formato: `T-21.NN · título` — arquivos · entrega · **aceite binário** · testes · depende. TDD (teste antes, falhando pelo motivo certo), `npm run verificar` verde; UI herda P-01..P-14 e D-32.
Só o **coordenador** edita: `src/compartilhado/{ipc,atualizacao}.ts`, `src/preload/preload.ts`, `src/nucleo/produto.ts`, `src/nucleo/banco/migracoes/**`, `src/nucleo/rede/**`, `electron-builder.yml`, `package.json`,
`05-CONTRATOS.md`, `04-UI-UX.md`, `STATUS.md`.

### 21A — Estudo e fundação

- **T-21.01 · Estudo de ameaças** — `docs/ade/seguranca/AMEACAS-FASE-21.md`, `tests/scripts/ameacas-fase21.test.ts`. Entrega: os 6 critérios acima. **Aceite:** o teste lê o documento e falha se houver AU Alta sem task `T-21.NN`
  **existente neste arquivo** e teste nomeado; residuais R1–R3 em P-330. Depende: nada (gate parcial de T-21.13..T-21.20).
- **T-21.02 · Contratos, tipos e manifesto de build** — `src/compartilhado/atualizacao.ts`, `src/compartilhado/ipc.ts` (canais `atualizacao:*`), `src/preload/preload.ts` (espelho inline, D-30), `src/main/ipc/atualizacao.ts` (**só validadores**),
  `build/distribuicao.json`, `scripts/lib/distribuicao.mjs`. **Aceite:** todo canal tem validador campo a campo; campo extra/tamanho excedido recusado; `distribuicao.json` inválido (canal desconhecido, chave pública malformada,
  `habilitada` não booleano, URL com credencial) falha o `verificar`; `habilitada` nasce `false`; teste de contrato do preload. Testes: `validadores.test.ts`, `distribuicao.test.ts`, `preload.contrato.test.ts`. Depende: nada.
- **T-21.03 · Perfis de build e configuração derivada** — `scripts/lib/config-builder.mjs`, `scripts/dist-dir.mjs`, `package.json` (scripts `dist:*` passam pelo perfil), `electron-builder.yml` (base comum). Perfis `local` (sem assinatura), `ci`, `release`,
  `com-atualizacao` (remove da lista de exclusões o `electron-updater` **e só ele e suas dependências exclusivas**, mantém `publish`). **Aceite:** o perfil padrão **produz o mesmo `files:`** de hoje (diff zero, teste de snapshot);
  `com-atualizacao` inclui `electron-updater` e **nada mais novo**; nenhuma variável de credencial é lida pelo script de perfil; `dist:dir` continua funcionando. Testes: `config-builder.test.ts`, `empacotamento.test.ts` (existente, ajustado em T-21.20). Depende: T-21.02.

### 21B — Renomeação do produto (D-01)

- **T-21.04 · Identidade estável de dados** — `src/nucleo/produto.ts` (`idDados`, `idsAnteriores`, `canalPadrao`, `nomeDeExibicao`), `src/main/dados-legados.ts` (migração de `userData` de um `idsAnteriores`), `app.setName`/`userData` derivados de `idDados`, conferência com o `safeStorage`.
  Migração **copia** (nunca apaga), atômica (pasta temporária + rename), com backup e aviso na UI; falha ⇒ mantém o antigo. **Aceite:** com `idDados` igual ao antigo, `userData` não muda após renomear `nome`/`id`; com `idsAnteriores=["expxv"]`
  e `idDados="novo"`, o primeiro boot copia banco, preferências e cofre (cofre: só se o item do Keychain/DPAPI for alcançável; senão pede reconfigurar e **não** perde o banco); duas execuções não duplicam. Testes: `produto.test.ts`, `dados-legados.test.ts`
  (fs temporário, `safeStorage` falso), `varredura-marca.test.ts` estendido. Depende: T-21.02.
- **T-21.05 · Script `npm run renomear`** — `scripts/renomear.mjs`, `scripts/lib/renomear.mjs`, `package.json`. Opções `--nome`, `--id`, `--dono`, `--repo`, `--dry-run` (padrão), `--aplicar`, `--reverter <relatorio>`, `--migrar-dados`. Altera por lista **fechada**:
  `src/nucleo/produto.ts` (`NOME`, `ID`, `repositorioReleases`), `package.json` (`name`, `description`), `electron-builder.yml` (`appId`, `productName`, `artifactName`, `publish.owner/repo`, `copyright` opcional), `.github/workflows/*.yml` (nomes de artefato), `build/distribuicao.json`
  (host do feed, se informado), e **lista** (não altera) o que é manual: ícones em `build/`, assinatura/identidade do desenvolvedor, protocolo de URL registrado, repositório de releases real. Gera `renomeacao-AAAA-MM-DD.json` (antes/depois por arquivo, sem segredo).
  **Aceite:** `--dry-run` não grava nada (hash da árvore igual); `--aplicar` numa **cópia** temporária (fixture com os 6 arquivos reais) → `varredura-marca` passa com o nome novo, `package.json`/`electron-builder.yml` conferem com `produto.ts`; `--reverter` restaura byte a byte;
  recusa nome/id inválido (`^[a-z][a-z0-9]{2,23}$` para `id`; nome sem caracteres de controle/`/`), `appId` derivado válido (DNS reverso); P-158. Testes: `renomear.test.ts` (árvore temporária, propriedades: aplicar+reverter = identidade). Depende: T-21.04.
- **T-21.06 · Checklist e guia de renomeação** — `docs/ade/CHECKLIST-RENOMEACAO.md` (gerado a partir do relatório do script, testado contra a lista fechada): antes do 1º release (barato) × depois (custo: continuidade do `appId`, identidade de assinatura, feed, protocolo de URL, Keychain, instaladores antigos).
  **Aceite:** teste confere que todo arquivo da lista fechada do script aparece no checklist e vice-versa. Testes: `checklist-renomeacao.test.ts`. Depende: T-21.05.

### 21C — Empacotamento, instaladores e assinatura (scripts e verificações; credenciais só por ambiente do CI do dono)

- **T-21.07 · Endurecimento do pacote (fuses, integridade, exclusões)** — `scripts/lib/config-builder.mjs`, `electron-builder.yml` (`electronFuses`), `scripts/depois-empacotar.cjs`. Fuses: `EnableCookieEncryption`, `EnableEmbeddedAsarIntegrityValidation` e `OnlyLoadAppFromAsar` **somente se** a medição (T-21.26) mostrar que
  os `asarUnpack` e o daemon continuam funcionando; `RunAsNode` **permanece ligado** (o daemon de PTY, hooks e o MCP usam `ELECTRON_RUN_AS_NODE`); `EnableNodeCliInspectArguments=false` no perfil `release` (o perfil `perf` mantém para o Playwright). Custo medido e registrado em D-NN.
  **Aceite:** script `verificar-fuses.mjs` lê o binário (`@electron/fuses` já vem com o electron-builder; sem dependência nova) e confere cada fuse esperada por perfil; `test:pacote` verde com as fuses; P-150 não piora. Testes: `fuses.test.ts` + `test:pacote`. Depende: T-21.03.
- **T-21.08 · macOS: DMG/ZIP universais verificados** — `scripts/verificar-instaladores.mjs` (parte macOS), `scripts/lib/instaladores.mjs`. Estático e **sem instalar no sistema**: `hdiutil attach -readonly -nobrowse -mountrandom` num ponto temporário (desmonta no `finally`), confere o `.app` (`Info.plist`: `CFBundleIdentifier == PRODUTO.appId`, versão == `package.json`,
  `LSMinimumSystemVersion`, `NSMicrophoneUsageDescription`), `lipo -archs` do executável **e** do `node-pty` contém `arm64` e `x86_64`, ZIP por `unzip -t`, `sha512` dos artefatos contra `latest-mac.yml`, tamanho dentro do teto. **Aceite:** passa no pacote real quando existir `dist-app/*.dmg`; com artefato corrompido/arquitetura faltando
  falha com mensagem citando o item; sem `hdiutil` (CI Linux) pula só a parte de montagem, **nunca** a de hash; nada fica montado após o teste (`mount`). Testes: `instaladores.test.ts` (fixtures sintéticas: DMG falso pequeno, `plist` válido/inválido, yml). Depende: T-21.03.
- **T-21.09 · Windows: NSIS verificado e configurado** — `electron-builder.yml` (`nsis`: atalhos, `deleteAppDataOnUninstall: false` **sempre**, `include` de verificação de processo em execução, `runAfterFinish`, `installerIcon`, `perMachine: false` e opção `perMachine` por perfil), `scripts/verificar-instaladores.mjs` (parte Windows). Estático em qualquer SO: cabeçalho PE (`MZ`/`PE`), tamanho, `sha512`
  contra `latest.yml`, `.blockmap` coerente, `ExpxV-Setup.exe` com nome derivado de `produto.ts`; no CI Windows (T-21.22): instalação **silenciosa em diretório temporário** (`/S /D=`), `test:pacote` sobre a pasta instalada, desinstalação silenciosa e conferência de que **`%APPDATA%` do produto permaneceu**. D-26: o que roda só no CI fica marcado `[CI-Windows]` e entra no checklist do dono.
  **Aceite:** testes estáticos verdes no macOS; fixture com `latest.yml` adulterado falha; configuração do NSIS conferida por teste (nunca apaga dados do usuário; assinatura opcional por variável). Testes: `instaladores-win.test.ts`, `nsis-config.test.ts`. Depende: T-21.03.
- **T-21.10 · Assinatura e notarização preparadas** — `scripts/assinatura/preparar.mjs`, `scripts/notarizar.cjs` (`afterSign`, só age com variáveis presentes), `electron-builder.yml` (`mac.hardenedRuntime`, `mac.notarize` por perfil, `win.signtoolOptions`/Azure Trusted Signing por variáveis), `build/entitlements.mac.plist` + herdado revisados (microfone, JIT/`allow-unsigned-executable-memory`
  só se necessário, `disable-library-validation` **apenas** se P-57/`sqlite-vec` exigir, com D-NN). `preparar.mjs --verificar` imprime a tabela "capacidade × variável (nome) × presente? (sim/não)" **sem valores**; falha fechado se o perfil `release` pedir assinatura e faltar variável **por nome**; modo `--simulado` usa dublês de `codesign`/`notarytool`/`signtool` (executáveis falsos em `tests/fixtures/assinatura/`).
  Variáveis documentadas (só nomes): `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (ou `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`), `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, `AZURE_*`, `EXPXV_MANIFESTO_CHAVE_PRIVADA`. **Aceite:** sem variáveis, o build local sai **sem assinar** e
  o `preparar` diz isso claramente (exit 0 no perfil `local`, exit ≠ 0 no `release`); sentinelas plantadas nas variáveis **nunca** aparecem em stdout/stderr/arquivo; nenhum `.p12`/`.p8`/`.pem`/chave privada versionado (`git ls-files` + varredura); `notarizar.cjs` sem credencial não faz rede. Testes: `assinatura.test.ts`, `segredos-versionados.test.ts` (AU-08). Depende: T-21.03.
- **T-21.11 · Verificação de assinatura e de nativos** — `scripts/assinatura/verificar-assinatura.mjs`, `scripts/assinatura/verificar-nativos.mjs`. macOS: `codesign --verify --deep --strict --verbose=2`, `spctl --assess --type execute`, `xcrun stapler validate`, entitlements por `codesign -d --entitlements :-`; Windows: `Get-AuthenticodeSignature`/`signtool verify /pa` (no CI Windows).
  `verificar-nativos` percorre **todo** Mach-O (`file`/magic) e PE do pacote (inclui `app.asar.unpacked`: `node-pty`, `sqlite-vec` se houver) e confere assinatura, arquitetura e `@rpath` íntegro. Modos: `--esperado=assinado|nao_assinado` (o pacote local **deve ser detectado como não assinado** e o relatório diz "sem assinatura real: R1").
  **Aceite:** no pacote local `--esperado=nao_assinado` passa e `--esperado=assinado` falha com a lista dos binários; com dublês, `assinado` passa e um binário não assinado plantado é apontado pelo caminho (AU-21); relatório JSON `dist-app/relatorio-verificacao.json` sem segredo. Testes: `verificacao-assinatura.test.ts` (dublês), `nativos.test.ts`. Depende: T-21.08, T-21.10.
- **T-21.12 · [P2] Adaptador `better-sqlite3` opcional (P-08)** — `src/nucleo/banco/adaptador-better-sqlite3.ts`, `scripts/lib/config-builder.mjs` (perfil `com-better-sqlite3`), `package.json` (`optionalDependencies`), `tests/perf/banco-adaptadores.perf.ts`. Mesma interface do banco; escolha **por build** (`build/distribuicao.json` → `banco.adaptador`), nunca por usuário; `node:sqlite` segue o padrão.
  **Aceite:** a suíte de contrato do banco roda **idêntica** nos dois adaptadores; custo medido (tamanho, startup, rebuild universal/prebuilds, assinatura do `.node`) registrado em `01-DECISOES.md` **antes** de entrar; ausente por padrão no pacote (varredura do asar). Se o custo violar P-01/P-08/P-159, a task fecha como "não adotado" com os números. Testes: `banco-contrato.test.ts` parametrizado, `adaptador-ausente.test.ts`. Depende: T-21.03, T-21.07.

### 21D — Atualizador (todas dependem do estudo T-21.01 aprovado)

- **T-21.13 · Núcleo puro: versão, canais, manifesto, assinatura, política, rollout** — `src/nucleo/atualizacao/{versao,canais,manifesto,assinatura,politica,rollout,maquina,historico}.ts`. Funções puras com relógio e RNG injetados, **sem Electron e sem rede**.
  **Aceite:** tabela de ≥ 60 casos (semver com pré-release `beta.N`, ordem total, downgrade, manifesto expirado, canal cruzado, `versao_minima`, chave revogada/rotacionada, staging 0/10/50/100 %, bucket estável para o mesmo `idInstalacao`, assinatura válida/ inválida/ truncada/ de outra chave); **propriedade:** nenhum manifesto sem assinatura válida
  chega a `disponivel`; `politica.decidir` ≤ 1 ms; nenhum import de `electron`/`fs`/`net`. Testes: `versao.test.ts`, `manifesto.test.ts`, `assinatura.test.ts`, `politica.test.ts`, `rollout.test.ts`, `maquina.test.ts` (inclui AU-01/02/05/06/07/16). Depende: T-21.01, T-21.02.
- **T-21.14 · Verificador de artefato e cliente de feed** — `src/main/atualizacao/verificador.ts`, extensão **mínima** em `src/nucleo/rede/` (coordenador): host fixo vindo do build, redirecionamento só para o mesmo host/CDN declarado, `If-None-Match`, cabeçalhos mínimos (sem identificador), `sinal` de cancelamento, teto de bytes, tempo-limite; erros só com código nominal, **caminho/URL nunca logados**.
  `sha512` em streaming + tamanho; arquivo parcial apagado em falha/cancelamento. **Aceite:** servidor falso hostil (lento, infinito, maior que `tamanho`, redireciona a outro host, 3xx em laço, TLS inválido, resposta com cabeçalho enorme) ⇒ falha limpa e **UI/event loop sem tarefa > 50 ms**; nenhuma requisição leva cookie, token ou `idInstalacao` (AU-24); P-156.
  Testes: `verificador.test.ts`, `cliente-feed.test.ts`, `servidor-hostil.test.ts` (AU-03/04/14/23/24). Depende: T-21.13, T-21.19.
- **T-21.15 · Backend manual (sem instalador)** — `src/main/atualizacao/backend-manual.ts`. Consulta o manifesto assinado pelo cliente de feed e, com a pessoa, **abre a página de download** (`shell.openExternal`, só `https`, host do build). Existe para quando não há assinatura de código real (R1): a pessoa baixa e confere o `SHA256SUMS` por conta própria. **Aceite:** nunca baixa nem executa nada; URL fora do host do build é recusada; funciona com `habilitada_no_build=true` sem `electron-updater` no pacote. Testes: `backend-manual.test.ts`. Depende: T-21.13, T-21.14.
- **T-21.16 · Serviço de atualização, guarda de instalação e backend `electron-updater`** — `src/main/atualizacao/{servico,backend,backend-electron-updater,guarda-instalacao}.ts`, `src/main/atualizacao.ts` (fio fino carregado por `import()` só depois da onda 2 e do consentimento), `package.json` (`electron-updater` em `optionalDependencies` com **versão exata**, custo registrado em D-NN), `src/main/ipc/atualizacao.ts` (handlers).
  `backend-electron-updater.ts` configura `autoDownload=false`, `autoInstallOnAppQuit=false`, `allowDowngrade=false`, `channel`/`allowPrerelease` do canal, `publisherName` (Windows) e feed **somente** do build; ignora qualquer URL vinda do renderer. `guarda-instalacao`: recusa com Pane `trabalhando` sem `confirmar_panes`, salva o estado (Missões, layout), compara a versão do protocolo do daemon e pede confirmação se mudar.
  **Aceite:** com `habilitada:false` **ou** sem consentimento, `import("./atualizacao")` nunca é chamado (espião), 0 sockets, 0 timers; ligada, ≤ 1 verificação/24 h (relógio injetado); instalar com Pane trabalhando sem confirmação ⇒ recusado (AU-11); download automático só com a opção marcada (AU-13); falha do backend nunca derruba o main (erro isolado + evento); P-154/P-155/P-156.
  Testes: `servico.test.ts` (backend falso), `guarda-instalacao.test.ts`, `desligado-zero-rede.test.ts` (AU-12), `consentimento.test.ts`. Depende: T-21.13, T-21.14, T-21.03.
- **T-21.17 · Migration, histórico, backup e reversão** — `src/nucleo/banco/migracoes/NNNN-distribuicao.ts` (+ `index.ts`), `src/nucleo/atualizacao/repo.ts`, `src/main/atualizacao/backup.ts`. Antes de instalar, copia o `.db` (+ WAL checkpoint) para `<userData>/backups/` (últimos 3, 14 dias); migrations já são transacionais; falha de migration restaura o backup e **mantém** a versão anterior utilizável quando o backend permitir reverter.
  **Aceite:** migration idempotente; histórico sem campo de segredo (varredura do schema); consulta quente ≤ 5 ms (P-14); backup restaura byte a byte em teste; reversão só para versão **já instalada antes** e cujo instalador está guardado/assinado (AU-02); retenção 180 d. Testes: `migracao.test.ts`, `repo.test.ts`, `backup.test.ts` (AU-17). Depende: T-21.13.
- **T-21.18 · UI do atualizador** — `src/renderer/telas/configuracoes/Atualizacoes.tsx`, `src/renderer/casca/FaixaAtualizacao.tsx`, `src/renderer/estado/atualizacao.ts` (`useSyncExternalStore`), via coordenador a entrada em `casca/telas.ts`. Notas de versão em **texto** (`textContent`, links só `http/https` sem credenciais). Estados por forma e texto; teclado; leitor de tela.
  **Aceite:** abre ≤ 50 ms (P-02), chunk ≤ 20 KB gz (P-08 não piora); com `habilitada_no_build=false` a tela explica e **não oferece** ligar; sem consentimento nada é carregado; notas com `<script>`/HTML/`javascript:` viram texto (AU-15); `a11y.e2e` sem violação nova. Testes: `Atualizacoes.test.tsx`, `FaixaAtualizacao.test.tsx` (jsdom), `a11y`. Depende: T-21.16.
- **T-21.19 · Servidor de atualização FALSO** — `tests/fixtures/atualizacao/{servidor-falso,cenarios,chaves-de-teste}.ts`. Loopback; serve manifestos assinados com **chaves de teste** (nunca as reais), artefatos sintéticos, `latest*.yml`; cenários: normal, atualização disponível, atual, downgrade, hash errado, assinatura inválida, canal cruzado, expirado, redirecionamento, lento, infinito, gigante, 304.
  **Aceite:** nenhum cenário abre porta fora de `127.0.0.1`; encerra no `finally`; `ps` limpo ao fim da suíte; as chaves de teste são rejeitadas pelo build `release` (teste do `distribuicao.mjs`). Testes: `servidor-falso.test.ts`. Depende: T-21.13.
- **T-21.20 · Teste da fronteira de atualização (ajuste do teste de D-24)** — `tests/scripts/empacotamento.test.ts`, `tests/scripts/atualizacao-desligada.test.ts`. O teste que hoje barra **qualquer** import de `electron-updater`/`autoUpdater` em `src/` passa a: (a) permitir o import **apenas** em `src/main/atualizacao/backend-electron-updater.ts` e **apenas** por `import()` dinâmico; (b) exigir que o perfil padrão **exclua** `electron-updater` do `files:` e que o `app.asar` do pacote padrão **não o contenha**;
  (c) exigir que nenhum arquivo fora de `src/main/atualizacao/**` e `src/nucleo/atualizacao/**` e `src/nucleo/rede/**` tenha `fetch`/`https` de versão; (d) conferir que `repositorioReleases` é placeholder enquanto o dono não decidir (P-331). **Aceite:** o teste falha se alguém importar o updater fora do lugar, mesmo em `import` estático; falha se o pacote padrão o incluir. Depende: T-21.16.

### 21E — CI completo, versionado e não disparado

- **T-21.21 · `validacao.yml` completo** — `.github/workflows/validacao.yml`. Gatilhos `pull_request`, `push` em `main`, `workflow_dispatch` (**nunca** `pull_request_target`). `permissions: contents: read`; `concurrency` com cancelamento; Node 22 (D-27); `npm ci --legacy-peer-deps`. Jobs: `estatica` (typecheck, `verificar`, varredura de marca/segredos, `auditar-dependencias`), `unidade` (matriz macOS arm64, macOS x64, Windows, Ubuntu para o núcleo puro), `build-e-pacote` (build, `dist:dir`, `test:pacote`, `verificar:instaladores` estático, `verificar-fuses`, `perf:pacote` informativo com `EXPXV_PERF_FATOR`),
  `e2e` (Playwright sobre o Electron real em macOS e Windows; Ubuntu só com `xvfb` se o custo permitir), `instalador-windows` (NSIS silencioso em temporário `[CI-Windows]`). Caches de `npm` e do Electron. **Aceite:** YAML válido, todos os `run:` referenciam scripts existentes em `package.json`, nenhum `secrets.` neste arquivo, `timeout-minutes` em todo job. Testes: `workflows.test.ts` (T-21.23). Depende: T-21.03, T-21.08, T-21.09.
- **T-21.22 · `release.yml` completo e `seguranca.yml`** — `.github/workflows/release.yml` (gatilhos: tag `v*` **e** `workflow_dispatch` com entradas `canal` e `versao`; ambiente protegido `release` com aprovação humana), `.github/workflows/seguranca.yml` (agendado semanalmente + dispatch: `npm audit` informativo, licenças, SBOM). `release.yml`: `validar` → `empacotar` (mac universal, win x64) com `preparar --verificar` → **assinar/notarizar condicionado à presença dos segredos** (passo por `env`, nunca `if: secrets…`) → `verificar-assinatura` (esperado `assinado` só se houve credencial) → `verificar-instaladores` → `SHA256SUMS` + SBOM CycloneDX →
  `gerar-manifesto` + `assinar-manifesto` (Ed25519; sem chave ⇒ manifesto **não assinado e o release marca `nao_assinado: true`**, o app o recusa) → proveniência (`actions/attest-build-provenance`) → **release em rascunho** (`draft: true`, `prerelease` conforme canal). **Nada promove de rascunho a publicado**: é ato humano (G4). Ações fixadas por **SHA** com comentário da versão (a resolução dos SHAs exige rede: task do dono/CI `[depende do dono]`; até lá o teste aceita `@vN` **apenas** com marcador `# TODO-SHA` e **falha** no perfil `release` do teste).
  **Aceite:** YAML válido; sem `pull_request_target`; `permissions` mínimas por job (`contents: write` só no job do rascunho; `id-token`/`attestations` só no de proveniência); nenhuma expressão `${{ github.event.* }}` dentro de `run:` (injeção); nenhum job publica; todo script citado existe. Testes: `workflows.test.ts` (AU-09/AU-10). Depende: T-21.10, T-21.11, T-21.24, T-21.25, T-21.28.
- **T-21.23 · Testes estáticos dos workflows** — `tests/scripts/workflows.test.ts`. Usa a dependência `yaml` já existente. Regras: lista de `secrets.*` permitidos (nomes de T-21.10); proibido `pull_request_target`, `workflow_run` com artefato de PR, `curl | sh`, `npm publish`, `git push`, `gh release create` **sem** `--draft`, `softprops` sem `draft: true`; `permissions` declaradas em todo job; `timeout-minutes`; ações por SHA (modo estrito no perfil `release`); matriz de SO cobre macOS arm64/x64 e Windows; scripts citados existem.
  **Aceite:** cada regra tem um caso negativo (YAML mutado) que o teste pega. Testes: o próprio arquivo + `mutacao-fase21.mjs`. Depende: T-21.21, T-21.22.
- **T-21.24 · Auditoria de dependências, licenças e SBOM** — `scripts/auditar-dependencias.mjs`, `package.json` (`auditar`). Lê `package-lock.json`: licenças permitidas (MIT/ISC/BSD/Apache-2.0/0BSD/MPL com ressalva), SBOM CycloneDX 1.5 (`npm sbom --sbom-format cyclonedx` se existir, senão gerador próprio do lock), `npm audit --omit=dev` **informativo** (sem rede ⇒ "não executado", nunca "ok"). **Aceite:** licença fora da lista falha; dependência nova sem registro em `01-DECISOES.md` falha (compara com `package.json`); SBOM válido (JSON, componentes == lock). Testes: `auditar-dependencias.test.ts`. Depende: nada.
- **T-21.25 · Notas de versão (reusa a Fase 19)** — `scripts/notas-versao.mjs`. Extrai a seção `## [versão]` do **CHANGELOG** gerado pela Fase 19 (`formatos/changelog.ts`, Keep a Changelog 1.1.0; caminho informado por `--changelog`, pois o ADE não escreve em `docs/**` — P-65) e produz `NOTAS.md` e o campo de notas do manifesto/`latest*.yml`. Sem CHANGELOG: gera nota mínima a partir de `git log <tag anterior>..HEAD --pretty=%s` (leitura local), marcada "gerada do histórico".
  **Aceite:** seção inexistente ⇒ erro claro; HTML/script nas notas é **escapado** na origem (e a UI mostra texto, AU-15); idempotente; ≤ 200 ms. Testes: `notas-versao.test.ts` (fixture de CHANGELOG). Depende: Fase 19 (contrato do `changelog.ts`; fixture se faltar).
- **T-21.28 · Manifesto de atualização e assinatura do manifesto** — `scripts/gerar-manifesto.mjs`, `scripts/assinar-manifesto.mjs`, `scripts/lib/manifesto.mjs`. Gera o manifesto (esquema de T-21.13) a partir dos artefatos reais (`sha512`, tamanho), `publicado_em`, `valido_ate` (padrão 30 dias), `staging`, notas; assina com a chave Ed25519 **de `EXPXV_MANIFESTO_CHAVE_PRIVADA` ou arquivo apontado por `--chave`** (fora do repo); verifica a própria assinatura com a pública do build.
  **Aceite:** com chaves de teste, o manifesto gerado é aceito por `src/nucleo/atualizacao`; chave ausente ⇒ manifesto marcado `nao_assinado` e **recusado** pelo app; a chave privada nunca é impressa nem gravada em `dist-app/`; rotação (duas chaves aceitas) funciona. Testes: `manifesto-scripts.test.ts` (AU-01/07). Depende: T-21.13.

### 21F — Medição, adversarial e fecho

- **T-21.26 · `perf:pacote`: P-150..P-153 no app empacotado** — `scripts/perf-pacote.mjs`, `tests/perf/pacote.perf.ts`, `package.json` (`perf:pacote`). Abre `dist-app/` com `_electron.launch({ executablePath })` (perfil `perf` mantém `--inspect` liberado), 5 aberturas para P-150 (3ª+ para o limite), P-151 com CLI falsa, P-152 com 4 painéis ociosos, P-153 lendo o JS inicial do **asar**; grava `docs/ade/perf/ultimo.json` (chave `pacote`). **Aceite:** reprova com orçamento estourado simulado; 1ª abertura a frio registrada sem entrar no limite; sem processo vivo ao fim (`ps`). Testes: o próprio perf + `perf-pacote.test.ts` (unidade do cálculo). Depende: T-21.03, T-21.07.
- **T-21.27 · E2E do atualizador** — `tests/atualizacao.e2e.test.ts`. Electron real (não empacotado), `NODE_ENV=test`, backend falso e servidor falso: ligar com consentimento, verificar, notas, baixar, `sha512` ok, instalar com confirmação (backend falso registra a chamada), instalar bloqueado com Pane trabalhando, canal beta com aviso, downgrade recusado, assinatura inválida recusada, reverter. **Aceite:** 0 sockets com a opção desligada; `ps` limpo; sem segredo/URL nos logs. Depende: T-21.16, T-21.18, T-21.19.
- **T-21.29 · Suíte adversarial e mutação** — `src/main/atualizacao/adversarial.test.ts`, `tests/scripts/mutacao-fase21.mjs`, `tests/scripts/mutacao-fase21.test.ts`. Cada AU-01..AU-24 tem teste nomeado que **falha se a mitigação for removida** (harness de mutação sem dependência nova, como `mutacao-fase13/20`). **Aceite:** mutantes mortos (meta 100 %); o que sobrar vivo vira achado na auditoria. Depende: T-21.13..T-21.23.
- **T-21.30 · Auditoria, contratos e fechamento** — `docs/ade/AUDITORIA-DISTRIBUICAO.md` (auditoria **independente**, só leitura, por agente sem o contexto de quem escreveu: fronteira de rede de versão, segredos, workflows, renomeação, migração de dados, nativos), `05-CONTRATOS.md`, `04-UI-UX.md`, `STATUS.md`, `AGENTS.md` (ajuste do mapa e da regra 6 sobre auto-update), `01-DECISOES.md` e `PENDENCIAS-DO-DONO.md` revisados. **Aceite:** todos os achados corrigidos com teste que falha sem a correção; portão da fase verde; checklist "Validação real (manual, do dono)" gravado. Depende: todas.

## Validação real (manual, do dono) — não faz parte dos testes automáticos (D-23)

1. Criar o repositório de releases e informar `owner/repo`; habilitar `atualizacao.habilitada` no build **só se** decidir (P-331). 2. Contratar Apple Developer e fornecer as variáveis do CI; rodar a notarização real e `verificar-assinatura --esperado=assinado`.
3. Certificado de assinatura Windows (OV/EV ou Azure Trusted Signing); validar SmartScreen. 4. Instalar o NSIS em uma máquina Windows real (instalar, abrir, atualizar, desinstalar, conferir `%APPDATA%`). 5. Gerar o par Ed25519 do manifesto
(**chave privada só no cofre do CI**), colocar a **pública** em `build/distribuicao.json`. 6. Fixar as ações do CI por SHA. 7. Ensaiar uma atualização `beta` → `stable` entre duas máquinas suas. 8. Renomear **antes** do primeiro release, se for renomear.

## Casos de teste de aceitação (cada item vira teste nomeado; os de abuso estão também na suíte T-21.29)

| Área | Casos |
|---|---|
| Renomeação | `--dry-run` não grava; aplicar+reverter = identidade; nome/id inválidos recusados; `varredura-marca` passa na cópia; `idDados` estável preserva `userData`; migração de `idsAnteriores` copia sem apagar; checklist ⇄ lista fechada |
| Empacotamento | `files:` do perfil padrão idêntico ao atual; `com-atualizacao` só acrescenta o updater; fuses conferidas; `RunAsNode` ligado; DMG/ZIP: `plist`, `lipo`, hashes, teto; NSIS: PE, hash, nome, nunca apaga dados |
| Assinatura | sem variáveis ⇒ build local não assinado e relatório claro; sentinelas ausentes das saídas; nenhum `.p12`/`.p8`/chave versionado; dublês: assinado passa, binário solto é apontado; `notarizar.cjs` sem credencial não faz rede |
| Atualizador | desligado: 0 rede/0 timers/0 import; consentimento antes de qualquer socket; verificar → disponível; canal beta; downgrade/expirado/canal cruzado/assinatura/hash/host recusados; Pane trabalhando bloqueia; backup restaura; notas só texto; histórico sem segredo |
| CI | YAML válido; scripts existem; sem `pull_request_target`; `permissions` e `timeout` em todo job; nada publica; `release.yml` só gera rascunho; mutações dos workflows pegas |
| Orçamentos | P-150..P-159 em `ultimo.json` verdes; P-01/P-08/P-12 não pioram |

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| **Reintroduzir o updater viola D-24 por engano** (liga sem decisão) | duas chaves; perfil de build próprio; teste de fronteira (T-21.20); padrão do pacote **sem** a dependência |
| **Integridade depende só da nossa camada sem assinatura real (R1)** | manifesto Ed25519 pinado + `sha512` + anti-downgrade; backend manual como alternativa; aviso na tela; assinatura real é P-332 |
| **Renomear quebra cofre e dados** (Keychain/DPAPI e `userData` derivam do nome) | `idDados` estável, migração por cópia, teste com `safeStorage` falso, checklist "antes do 1º release" |
| **Instalar derruba terminais** | guarda de Pane trabalhando, estado salvo, daemon que sobrevive, protocolo versionado com confirmação |
| **Fuses quebram o daemon/Playwright** (`RunAsNode`, `--inspect`) | `RunAsNode` fica ligado; perfil `perf` separado; medição antes de endurecer; `test:pacote` no portão |
| **Universal exige `.node` por arquitetura e assinatura dos dois** | `x64ArchFiles` mantido; verificador de nativos; `better-sqlite3` só opcional e medido |
| **Sem Windows para validar (D-26)** | testes de unidade/configuração + CI `[CI-Windows]` versionado + checklist do dono |
| **Workflow injetável/segredo vazado** | `pull_request` apenas, `permissions` mínimas, sem `github.event` em `run:`, sentinelas, ambiente protegido com aprovação |
| **Ações do CI com tag móvel** | fixação por SHA (task do dono) e teste estrito no perfil `release` |
| **Feed comprometido** | assinatura do manifesto independente do host; chave dupla; `versao_minima`; rollout |
| **Custo do updater no startup** | `import()` pós-consentimento, 0 KB no JS inicial, P-154/P-155 |
| **`electron-updater` dispara rede por conta própria** | `autoDownload=false`, `autoInstallOnAppQuit=false`, feed do build, espião de rede nos testes |
| **Vazamento de processos/portas em teste** | `finally` em tudo, `tests/limpeza.ts`, `ps` ao fim da suíte |

## Ordem de execução e paralelismo

```
T-21.01 (estudo — GATE PARCIAL: só T-21.13..T-21.20) ─┐
T-21.02 ─► T-21.03 ─┬─► T-21.07 ─► T-21.26 ───────────────────────────────┐
                    ├─► T-21.08 ─┐                                         │
                    ├─► T-21.09 ─┼─► T-21.11 ─► T-21.21 ─► T-21.22 ─► T-21.23
                    └─► T-21.10 ─┘                                         │
T-21.02 ─► T-21.04 ─► T-21.05 ─► T-21.06                                   │
T-21.01 ─► T-21.13 ─┬─► T-21.19 ─► T-21.14 ─► T-21.15 · T-21.16 ─► T-21.17 · T-21.18 ─► T-21.20 ─► T-21.27
                    └─► T-21.28                                            │
T-21.24 · T-21.25 (independentes) · T-21.12 [P2] ──────────────────────────┴─► T-21.29 ─► T-21.30
```

**Ondas e agentes (≤ 5 simultâneos; ninguém no mesmo arquivo):**

| Onda | Quem | Tasks | Áreas de arquivo (disjuntas) |
|---|---|---|---|
| W0 (serial) | Coordenador | T-21.02, T-21.03 (+ T-21.01 com agente de segurança) | `src/compartilhado/**`, `preload`, `electron-builder.yml`, `package.json`, `build/distribuicao.json`, `scripts/lib/{distribuicao,config-builder}.mjs`, `src/main/ipc/atualizacao.ts` (validadores), `docs/ade/seguranca/**` |
| W1 | A = renomeação | T-21.04, T-21.05, T-21.06 | `src/nucleo/produto.ts` (coordenador aprova), `src/main/dados-legados.ts`, `scripts/renomear.mjs`, `scripts/lib/renomear.mjs`, `docs/ade/CHECKLIST-RENOMEACAO.md`, `tests/scripts/renomear*` |
| W1 | B = instaladores | T-21.08, T-21.09 | `scripts/verificar-instaladores.mjs`, `scripts/lib/instaladores.mjs`, `tests/scripts/instaladores*` |
| W1 | C = assinatura | T-21.10 → T-21.11 | `scripts/assinatura/**`, `scripts/notarizar.cjs`, `build/entitlements*.plist`, `tests/fixtures/assinatura/**` |
| W1 | D = núcleo do atualizador (após o estudo) | T-21.13, T-21.19 | `src/nucleo/atualizacao/**`, `tests/fixtures/atualizacao/**` |
| W1 | E = auditoria/notas | T-21.24, T-21.25 | `scripts/{auditar-dependencias,notas-versao}.mjs`, testes próprios |
| W2 | D | T-21.14, T-21.15, T-21.16, T-21.28 | `src/main/atualizacao/**`, `src/main/atualizacao.ts`, `scripts/{gerar,assinar}-manifesto.mjs`, extensão de `src/nucleo/rede/**` (coordenador) |
| W2 | B | T-21.07, T-21.12 [P2] | `scripts/lib/config-builder.mjs` (fuses), `src/nucleo/banco/adaptador-better-sqlite3.ts` |
| W3 | D | T-21.17 (migration pelo coordenador) | `src/nucleo/atualizacao/repo.ts`, `src/main/atualizacao/backup.ts` |
| W3 | F = UI | T-21.18 | `src/renderer/telas/configuracoes/Atualizacoes.tsx`, `src/renderer/casca/FaixaAtualizacao.tsx`, `src/renderer/estado/atualizacao.ts` |
| W3 | G = CI | T-21.21, T-21.22, T-21.23 | `.github/workflows/**`, `tests/scripts/workflows.test.ts` |
| W4 (serial) | Coordenador + segurança | T-21.20, T-21.26, T-21.27, T-21.29, T-21.30 | `tests/**`, `scripts/perf-pacote.mjs`, contratos, `STATUS.md`, `AUDITORIA-DISTRIBUICAO.md` |

**Antes de começar:** Fase 19 (contrato do `changelog.ts`; fixture se faltar), Fase 20 (alertas `sistema`; opcional), `tests/scripts/empacotamento.test.ts` e `scripts/verificar-pacote.mjs` atuais (referência). **Caminho crítico:** T-21.01 → 13 → 14 → 16 → 18 → 20 → 27 → 29 → 30 (atualizador) e T-21.02 → 03 → 08/09/10/11 → 21 → 22 → 23 (CI). **Se faltar tempo:** entregam-se W0, W1-A/B/C, T-21.24/25, T-21.21–T-21.23 e T-21.26 (distribuição **sem** atualizador); o atualizador (W1-D, W2-D, T-21.17/18/20/27) entra depois sem retrabalho, **nunca** sem T-21.01 e T-21.29.

## Decisões `[LAC]` resolvidas

| Lacuna | Decisão |
|---|---|
| `electron-updater` ou atualizador próprio | [DEC] **ambos atrás de uma interface**: `electron-updater` (instala, quando há assinatura real) e backend manual (só abre a página); a camada de verificação **nossa** vale para os dois (D-340, D-343) |
| Onde vive o código de atualização | [DEC] `src/main/atualizacao/**` + `src/nucleo/atualizacao/**`; `import()` dinâmico; o teste de D-24 vira teste de fronteira (D-340) |
| Padrão do pacote | [DEC] **sem** `electron-updater` no pacote; perfil `com-atualizacao` o inclui; chave de build `habilitada:false` (D-342) |
| Canais | [DEC] `stable` (padrão) e `beta` (consentimento); canal dentro do manifesto assinado; sem canal `alpha` |
| Download/instalação | [DEC] manuais por padrão; opções "baixar automaticamente" e "instalar ao sair" existem e nascem desligadas (D-140) |
| Rollout | [DEC] `staging` no manifesto assinado, bucket determinístico por `idInstalacao` local (nunca enviado) |
| Rollback | [DEC] só para versão já instalada antes, com instalador guardado e assinado; nunca "baixar qualquer versão antiga" (AU-02) |
| Chave do manifesto | [DEC] Ed25519; chave **pública** no build (duas aceitas: atual e próxima); privada só no CI do dono ou arquivo fora do repo (D-343) |
| Sem assinatura de código real | [DEC] aviso fixo (R1), backend manual, `SHA256SUMS`; instalação automática só quando `verificar-assinatura --esperado=assinado` passa no CI |
| Fuses | [DEC] `RunAsNode` ligado (daemon/hooks/MCP); endurecer o resto **só após medição** (D-344) |
| `idDados` | [DEC] separado de `id`; renomear não o muda por padrão; migração por cópia (D-341) |
| Windows | [DEC] NSIS x64 por usuário; arm64 do Windows fora até haver `node-pty` prebuild e máquina (P-06/D-26) |
| Linux | [DEC] fora do alvo (D-26); só o núcleo puro roda em Ubuntu no CI |
| CI de PR de fork | [DEC] sem segredos, sem `pull_request_target` (D-346) |
| Publicar release | [DEC] sempre rascunho; promoção humana (G4, D-23) |
| `better-sqlite3` | [DEC] P2, opt-in de build, só se o custo medido não violar orçamento (P-159) |
| Notas de versão | [DEC] reusa o CHANGELOG da Fase 19; texto puro na UI (D-347) |

## Fronteiras com outras fases

- **Fase 0 (empacotamento/CI do MVP) e MVP:** esta fase **estende** `electron-builder.yml`, `scripts/*` e os dois workflows; não os reescreve. O que já passa em `test:pacote` continua passando.
- **Fase 19 (relatórios):** fonte das notas de versão (CHANGELOG, Keep a Changelog); esta fase não gera relatório nem escreve em `docs/**` (D-04).
- **Fase 20 (alertas):** `atualizacao_disponivel`/`atualizacao_falhou` entram como alertas de fonte `sistema`; sem a Fase 20 a faixa de atualização é o único aviso.
- **Fase 15/57 (`sqlite-vec`):** assinatura do dylib e entitlement `disable-library-validation` seguem P-57; o verificador de nativos (T-21.11) o cobre.
- **Fase 22 (acesso remoto estendido):** o PWA e o relay têm **distribuição própria** (não passam por este atualizador); esta fase fornece as chaves/assinatura Ed25519 e o padrão de manifesto assinado que a T-22.16 reaproveita.
- **Fase 23 (Overdrive):** nenhuma dependência; o perfil `perf` do pacote (T-21.26) é reusado para medir o Overdrive **dentro** do app empacotado.
- **D-23/D-24/D-25/D-26:** nada publicado, auto-update só por decisão do dono, sem telemetria, Windows só em unidade + CI versionado.
