# Estudo de ameaças — Fase 21 (cadeia de distribuição e atualizador)

T-21.01 (gate parcial de T-21.13..T-21.20). Escrito **antes** do código do atualizador e **ajustado depois da onda 2**: cada caso `AU-NN` cita a task que o resolve e o teste nomeado que o prova.
Mesmo formato de `docs/ade/AMEACAS-REMOTO.md`; reusa o vocabulário das Fases 13 e 20. Validado por `tests/scripts/ameacas-fase21.test.ts` (toda ameaça **Alta** aponta para uma
task que existe em `fase-21-distribuicao.md` e para um teste que existe, ou está marcada `planejado` com a onda que a entrega).

**Veredito: APROVADO** para iniciar T-21.13..T-21.16 e T-21.19 (núcleo puro, feed, verificador, backends). T-21.17 (migration/backup), T-21.18 (UI), T-21.20 (fronteira completa)
e as tasks de CI (T-21.21..T-21.23) seguem na onda W3, com os casos `planejado` abaixo como critério de aceite.

## 1. Fronteiras de confiança

| | Fronteira | O que cruza | Controle |
|---|---|---|---|
| F1 | desenvolvedor ↔ repositório | código, workflows, `build/distribuicao.json` | revisão humana; teste estático dos workflows (T-21.23); nenhuma chave nem certificado versionado |
| F2 | CI ↔ segredos | certificados, chave Ed25519 do manifesto, tokens | só variáveis de ambiente do CI do dono por **nome**; `preparar --verificar` nunca imprime valor; ambiente protegido com aprovação |
| F3 | CI ↔ GitHub Releases | artefatos, manifesto, `.sig`, `SHA256SUMS` | release **sempre rascunho**; promoção humana (G4); proveniência |
| F4 | app ↔ feed de atualização | `GET` do manifesto e da `.sig`, `GET` do artefato | host fixo do build, https, sem redirecionamento a outro host, cabeçalhos mínimos, tempo-limite, teto de bytes; **único** cliente de rede é `src/nucleo/rede` |
| F5 | feed ↔ arquivo baixado | bytes do instalador | `sha512` + tamanho do manifesto **assinado**, em streaming, antes de entregar ao instalador; reconferido antes de instalar |
| F6 | instalador ↔ SO | Gatekeeper, SmartScreen, assinatura de código | verificadores de assinatura e de nativos; sem assinatura real vale o residual R1 |
| F7 | app novo ↔ dados do usuário | `userData`, banco, cofre, preferências | backup antes de instalar; migrations transacionais; atualizar nunca apaga dados |
| F8 | renomeação ↔ identidade | `appId`, Keychain/DPAPI, protocolo de URL, `userData` | `idDados` separado de `id`; migração por cópia |

## 2. Ativos

1. Chave privada de assinatura de código (Apple/Windows). 2. **Chave privada do manifesto (Ed25519)**. 3. Tokens e segredos do CI. 4. Artefatos publicados. 5. Canal `stable`.
6. `userData`, banco e cofre do usuário. 7. A integridade do boot do app (nenhum módulo de rede de versão carregado sem consentimento).

## 3. Atores

| Ator | Pode | Não pode (garantia) |
|---|---|---|
| Dono | decidir ligar a atualização, trocar chaves, promover release | — |
| Usuário | ligar a verificação, escolher canal, baixar, instalar | instalar com terminal em trabalho sem confirmação; baixar sozinho (padrão) |
| Atacante de rede (MITM, DNS) | alterar respostas | fazer o app aceitar manifesto sem assinatura válida, artefato com hash diferente ou outro host |
| Espelho/CDN comprometido | servir bytes diferentes | passar pela verificação de `sha512` do manifesto assinado |
| Repositório de releases comprometido (com acesso ao CI) | publicar versão maliciosa **assinada** | — (residual **R2**) |
| Colaborador/fork malicioso | abrir PR | ler segredos (workflows de PR sem segredo; `pull_request` apenas) |
| Outro processo local | trocar o arquivo baixado | instalar arquivo cujo hash não bate (reconferência antes de instalar) |

## 4. STRIDE por componente

| Componente | S | T | R | I | D | E |
|---|---|---|---|---|---|---|
| Manifesto + assinatura | chave pinada no build; canal dentro do assinado | Ed25519 destacada sobre os bytes originais | histórico local de eventos | manifesto público, sem dado pessoal | tamanho ≤ 256 KiB | rotação com chave dupla; revogação |
| Cliente de feed | host fixo do build | `sha512`/tamanho assinados | log sem URL | cabeçalhos mínimos; `idInstalacao` nunca sai | tempo-limite, teto de bytes, cancelável | recusa redirecionamento a outro host |
| Verificador de artefato | — | streaming + `rename` atômico | — | erros só por código nominal | aborta ao exceder `tamanho` | reconferência antes de instalar |
| Serviço/guarda | — | estado monotônico (anti-replay) | `atualizacao_evento` | — | ≤ 1 verificação/24 h | duas chaves + consentimento; Pane trabalhando exige confirmação |
| Backend `electron-updater` | feed só do build | camada (ii) reconfere o que ele baixou | — | texto do updater nunca vai ao erro | `autoDownload=false` | só carregado por `import()` dinâmico depois do consentimento |
| Renomeação | `idDados` estável | relatório reversível | relatório sem segredo | — | — | lista fechada de arquivos |
| Workflows | só `release.yml` tem segredos | ações por SHA | — | `::add-mask::` | `timeout-minutes` | `permissions` mínimas |

## 5. Casos de abuso

Colunas: caso · severidade · mitigação · task do plano · teste nomeado (arquivo) · estado (`pronto` = teste existe e passa; `planejado:W3` = a task é da onda 3).

| AU | Caso | Sev. | Mitigação | Task | Teste | Estado |
|---|---|---|---|---|---|---|
| AU-01 | Manifesto adulterado (versão, URL, hash) | Alta | assinatura Ed25519 destacada sobre os bytes originais, chave pinada no build; propriedade: nenhuma mutação chega a `disponivel` | T-21.13 | `au01_manifesto_adulterado` (politica.test.ts) | pronto |
| AU-02 | Downgrade para versão vulnerável | Alta | `versao` e `publicado_em` monotônicos; reversão só para versão já instalada e instalador guardado | T-21.13, T-21.16 | `au02_downgrade_recusado` (politica.test.ts) | pronto |
| AU-03 | Artefato com hash diferente (CDN/espelho comprometido) | Alta | `sha512` do manifesto assinado conferido em streaming; parcial apagado | T-21.14 | `au03_hash_errado_apaga` (io.test.ts) | pronto |
| AU-04 | Redirecionamento do feed a outro host | Alta | host fixo; cliente de rede recusa outro host e laço de 3xx | T-21.14, T-21.15 | `au04_redirecionamento_recusado` (io.test.ts) | pronto |
| AU-05 | Replay de manifesto antigo (congela o usuário) | Média | `valido_ate` curto; `publicado_em` monotônico persistido; relógio injetado | T-21.13 | `au05_manifesto_expirado` (politica.test.ts) | pronto |
| AU-06 | Canal trocado (beta vira stable e vice-versa) | Alta | canal dentro do manifesto assinado; recusa canal diferente do escolhido; beta exige consentimento | T-21.13 | `au06_canal_cruzado` (politica.test.ts) | pronto |
| AU-07 | Chave privada do manifesto vaza | Alta | chave só no CI/arquivo fora do repo; rotação por chave dupla; revogação por manifesto assinado pela outra chave; script nunca imprime a chave | T-21.13, T-21.28 | `au07_rotacao_de_chave` (politica.test.ts), `au07` (manifesto-scripts.test.ts) | pronto |
| AU-08 | Segredo de assinatura no repositório/log do CI | Alta | varredura de sentinelas e de arquivos versionados; só nomes de variável | T-21.10, T-21.23 | segredos-versionados.test.ts | pronto |
| AU-09 | Workflow malicioso (`pull_request_target`, injeção em `run:`) | Alta | `pull_request` apenas; segredos só em `release.yml`; nenhuma expressão `github.event` em `run:` | T-21.22, T-21.23 | `au09_workflow_sem_pr_target` (workflows.test.ts) | planejado:W3 |
| AU-10 | Ação de terceiro comprometida (tag móvel) | Média | ações fixadas por SHA; teste estrito no perfil `release` | T-21.22, T-21.23 | `au10_acoes_fixadas` (workflows.test.ts) | planejado:W3 |
| AU-11 | Instalar com terminal em trabalho | Alta | só instala com 0 Panes trabalhando ou confirmação; salva estado; protocolo do daemon incompatível pede confirmação | T-21.16 | `au11_nao_instala_com_pane_trabalhando` (servico.test.ts) | pronto |
| AU-12 | Atualização liga sozinha | Alta | duas chaves; `import()` do módulo nunca chamado sem elas; 0 sockets | T-21.16, T-21.20 | `au12_desligado_zero_rede` (servico.test.ts) | pronto |
| AU-13 | Download automático sem consentimento | Média | verificar nunca baixa; opção marcada e registrada | T-21.16 | `au13_sem_download_automatico` (servico.test.ts) | pronto |
| AU-14 | Servidor lento, infinito ou gigante | Média | tempo-limite, teto = `tamanho` assinado, cancelável, event loop livre | T-21.14 | `au14_servidor_hostil` (io.test.ts) | pronto |
| AU-15 | Notas de versão com HTML/script/links | Média | notas como texto; caracteres de controle removidos na origem; UI por `textContent` | T-21.18 | `au15_notas_so_texto` (Atualizacoes.test.tsx) | planejado:W3 |
| AU-16 | Rollout enviesado | Baixa | bucket por HMAC do `idInstalacao` (local) e da versão | T-21.13 | `au16_rollout_estavel` (politica.test.ts) | pronto |
| AU-17 | Perda de dados na migração entre versões | Alta | backup do `.db` antes de instalar; migrations transacionais; restaura se falhar | T-21.17 | `au17_migracao_com_backup` (backup.test.ts) | planejado:W3 |
| AU-18 | Renomeação quebra o cofre/dados | Alta | `idDados` estável; migração copia, nunca apaga; teste com `safeStorage` falso | T-21.04, T-21.05 | dados-legados.test.ts | pronto |
| AU-19 | Renomeação deixa o nome antigo | Média | lista fechada + varredura de marca na cópia | T-21.05 | renomear.test.ts | pronto |
| AU-20 | Instalador adulterado após o build | Alta | `SHA256SUMS` + manifesto assinado; verificador local confere hashes | T-21.08, T-21.09 | instaladores.test.ts | pronto |
| AU-21 | Nativo sem assinatura | Alta | verificador percorre todo Mach-O/PE e confere assinatura | T-21.11 | nativos.test.ts | pronto |
| AU-22 | Fuses/ASAR enfraquecidos | Média | fuses configurados por perfil e **conferidos no binário**; `RunAsNode` permanece ligado | T-21.07 | `au22_fuses_conferidos` (fuses.test.ts) | pronto |
| AU-23 | Feed lido com credencial | Alta | o app nunca carrega token; cabeçalho de credencial descartado pelo transporte; varredura do código | T-21.14 | `au23_sem_token_no_pacote` (io.test.ts) | pronto |
| AU-24 | Telemetria de versão | Média | só `Accept` e `If-None-Match`; `idInstalacao` nunca sai; sem cookie | T-21.14 | `au24_sem_identificador_na_rede` (io.test.ts) | pronto |
| AU-25 | Página de download maliciosa (backend manual) | Média | `shell.openExternal` só com https, host do build, sem porta nem credencial | T-21.15 | `au25_abre_so_https_do_host_do_build` (servico.test.ts) | pronto |
| AU-26 | Arquivo trocado entre o download e a instalação (TOCTOU) | Alta | reconferência de `sha512` e tamanho imediatamente antes de instalar; adulterado é apagado | T-21.16 | `au26_arquivo_trocado_depois_do_download` (servico.test.ts) | pronto |

## 6. Portões

- **G1** — auto-update só com **chave de build** (`atualizacao.habilitada`) **e** chave de execução (preferência + consentimento versionado): `decidirCarregamento` e `carregarSePermitido`.
- **G2** — nenhum download automático por padrão; a opção existe, nasce desligada e fica registrada.
- **G3** — nenhuma credencial real em teste: chaves de teste de semente fixa, recusadas pelo build `release`; dublês de `codesign`/`notarytool`/`signtool`.
- **G4** — publicar ou promover release é **sempre** ato humano: `release.yml` só cria rascunho.

## 7. Riscos residuais (texto exato, para o dono — P-330)

- **R1** — Sem assinatura de código real (Apple Developer, certificado do Windows) o sistema operacional avisa ou bloqueia a instalação, e a integridade do que é baixado depende **só da nossa camada** (manifesto Ed25519 + `sha512`). Por isso, sem assinatura real, o backend padrão é o **manual** (abre a página de download) e a instalação automática só vale depois de `verificar-assinatura --esperado=assinado` passar no CI.
- **R2** — Se o repositório de releases (ou o CI do dono) for comprometido, um atacante publica uma versão maliciosa **assinada com a chave que o CI guarda**. A rotação por chave dupla e a revogação por versão mínima limitam o estrago, mas não o impedem; é o risco inerente de qualquer atualizador com chave no CI.
- **R3** — A **primeira instalação**, baixada de uma fonte adulterada, não é protegida pelo atualizador: só a assinatura do SO e o `SHA256SUMS` conferido pela própria pessoa a protegem.

## 8. Recomendação sobre o `electron-updater` e decisões D-340..D-349

- **Recomendação:** implementar o `electron-updater` **somente** como um dos backends atrás da interface `BackendAtualizacao`, em **um único arquivo** (`backends/electron-updater.ts`), por `import()` dinâmico, configurado com `autoDownload=false`, `autoInstallOnAppQuit=false`, `allowDowngrade=false` e feed fixo do build, **com a camada nossa (manifesto assinado, `sha512` do que ele baixou, anti-downgrade) valendo para ele também**. No macOS o auto-instalador exige app assinado; sem assinatura real o backend manual é o padrão (R1). A dependência **não** é adicionada ao `package.json` nesta onda (sem rede e sem `D-NN` de custo medido): o perfil `com-atualizacao` falha fechado enquanto ela não existir, e o pacote padrão permanece sem ela. Ligar é decisão do dono (P-331).
- **D-340..D-349 confirmadas** sem alteração de mérito (texto em `01-DECISOES.md`): atualizador volta isolado e lazy; `idDados` separado; duas chaves; verificação de duas camadas; fuses só depois de medir; credencial só por ambiente do CI; CI sem segredo em PR; notas reusam a Fase 19; release sempre rascunho; `better-sqlite3` opcional por build.
