# Checklist de renomeação do produto (T-21.06, D-01, D-341)

Guia para trocar o nome do produto. O script `npm run renomear` (`scripts/renomear.mjs`) cuida do que é texto em arquivo;
o resto é manual. O teste `tests/scripts/checklist-renomeacao.test.ts` impede este documento de divergir da lista fechada do script.

Regra de ouro: **renomear antes do primeiro release é barato; depois, é caro.** Sem release publicado, ninguém tem instalador, Keychain nem feed apontando para o nome antigo.

## Como usar o script

```bash
npm run renomear -- --nome "Aurora" --id aurora                      # --dry-run é o padrão: mostra e não grava
npm run renomear -- --nome "Aurora" --id aurora --aplicar            # grava e cria renomeacao-AAAA-MM-DD.json (antes/depois, sem segredo)
npm run renomear -- --reverter renomeacao-2026-10-01.json            # volta byte a byte (recusa se o arquivo mudou depois)
```

Opções: `--nome`, `--id` (`^[a-z][a-z0-9]{2,23}$`), `--dono`, `--repo`, `--host-feed` (só o host, sem esquema), `--dry-run`, `--aplicar`, `--reverter <relatório>`, `--migrar-dados`, `--raiz`.

**Dados do usuário (AU-18).** Por padrão renomear **não** muda `idDados`: o script fixa o id antigo em `ID_DADOS` e a pasta de dados e o cofre continuam onde estão.
Com `--migrar-dados`, `idDados` passa a ser o id novo e o antigo vai para `idsAnteriores`; o primeiro boot **copia** (nunca apaga) o `userData` antigo
(`src/main/dados-legados.ts`). Se o item do chaveiro do cofre não for alcançável pelo nome novo, o banco migra e o app pede para reconfigurar o cofre.

## Arquivos alterados pelo script

Lista **fechada**. Nenhum outro arquivo é tocado.

| Arquivo | O que muda |
|---|---|
| `src/nucleo/produto.ts` | `NOME`, `ID`, `ID_DADOS`, `IDS_ANTERIORES`, `repositorioReleases` (dono/repo) |
| `package.json` | `name`, `description` |
| `electron-builder.yml` | `appId`, `productName`, `artifactName` (mac e nsis), `publish.owner`, `publish.repo` |
| `.github/workflows/*.yml` | nomes de artefato que citam o nome ou o id antigo |
| `build/distribuicao.json` | host do feed, só com `--host-feed` (se o arquivo existir) |

## O que é manual

O script lista estes itens a cada execução e não os altera. Cada marcador abaixo repete o id usado pelo script.

- [ ] `manual:icones` — regenerar `build/icon.icns`, `build/icon.ico`, `build/icone-*.png` e `build/simbolo.svg` com a marca nova.
- [ ] `manual:assinatura` — identidade de assinatura (Developer ID/Team ID da Apple, certificado do Windows). O nome do publicador pode mudar.
- [ ] `manual:protocolo_url` — protocolo de URL registrado no sistema (derivado do id).
- [ ] `manual:repositorio_real` — criar ou transferir o repositório de releases real (dono/repo); o script só troca o texto.
- [ ] `manual:cofre_keychain` — cofre e Keychain/DPAPI: decidir entre manter `idDados` (padrão) e `--migrar-dados`.
- [ ] `manual:documentacao` — README, `docs/` e textos de interface escritos à mão que citam o nome antigo.

## Antes do 1º release (barato)

1. Decidir nome e id; confirmar que o id respeita `^[a-z][a-z0-9]{2,23}$` e que o `appId` derivado é um DNS reverso válido.
2. `npm run renomear -- --nome ... --id ...` (dry-run), conferir, depois `--aplicar`. Guardar o relatório.
3. Como ainda não há usuários, pode-se usar `--migrar-dados` só para a máquina do dono; sem ele, os dados seguem no `idDados` antigo (inofensivo).
4. Refazer ícones e o texto da interface (itens manuais). Rodar `npm run verificar`; a varredura de marca (`tests/varredura-marca.test.ts`) deve passar.
5. Criar o repositório de releases real e atualizar `--dono`/`--repo`.

## Depois do 1º release (caro)

Cada item abaixo muda algo que usuários e máquinas já têm instalado:

- **Continuidade do `appId`**: mudar o `appId` faz o sistema tratar o app como outro. Atualização automática, atalhos e associações do instalador antigo não se conectam ao novo.
- **Identidade de assinatura**: o nome do publicador/certificado muda; o Gatekeeper e o SmartScreen reavaliam a reputação. Notarização e certificado precisam ser refeitos.
- **Feed de atualização**: o feed (host e caminho) aponta para o repositório antigo; quem tem o app antigo precisa de uma última versão publicada no feed antigo que migre para o novo.
- **Protocolo de URL**: links existentes com o protocolo antigo deixam de abrir o app.
- **Keychain/DPAPI e cofre**: o item do chaveiro pertence ao nome do app; sem `idDados` estável o cofre fica ilegível. Use `--migrar-dados` somente com a migração testada e avise a pessoa para reconfigurar o cofre se o aviso aparecer.
- **Instaladores antigos**: continuam existindo com o nome antigo (releases, downloads, espelhos); mantenha-os disponíveis e documente a transição.
- Dados do usuário: a migração **copia e nunca apaga**; a pasta antiga fica como backup até a pessoa remover.
