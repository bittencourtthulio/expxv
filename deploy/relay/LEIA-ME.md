# Relay cego: guia de hospedagem

Este repositório **não implanta nada**. Os arquivos desta pasta são versionados e testados de forma estática; quem constrói e liga o relay é você, na sua própria máquina ou VPS. O relay é opcional, nasce desligado no app e só repassa bytes cifrados.

## O que o relay vê (e o que não vê)

- **Vê (metadados):** o IP de quem conecta, os horários, o tamanho aproximado dos quadros (em blocos de 256 B, 1 KiB e 4 KiB) e o identificador de canal do dia (muda todo dia).
- **Não vê:** conteúdo de mensagens, comandos, títulos de Missões nem saída de painéis. Tudo vai cifrado de ponta a ponta entre o celular e o desktop.
- Ele não guarda nada em disco: reiniciar apaga todo o estado.

## Passo a passo

1. **VPS:** contrate uma máquina pequena (1 vCPU, 512 MB a 1 GB de RAM bastam) com Docker e o plugin compose.
2. **Domínio e DNS:** crie um registro A (e AAAA, se tiver IPv6) apontando um nome, por exemplo `relay.seudominio.exemplo`, para o IP da VPS.
3. **Variáveis:** copie `deploy/relay/.env.example` para um arquivo de ambiente na VPS (fora do repositório) e preencha `RELAY_DOMINIO`. Os limites `RELAY_MAX_CANAIS`, `RELAY_MAX_CONEXOES` e `RELAY_MAX_POR_IP` são opcionais.
4. **Subir com TLS:** na raiz do projeto, na VPS:

```
docker compose -f deploy/relay/compose.yaml --profile tls up -d --build
```

5. **Conferir o `/healthz`:** ele só responde de dentro da rede interna do contêiner (a imagem já traz o HEALTHCHECK do `Dockerfile`):

```
docker compose -f deploy/relay/compose.yaml ps
```

6. **No app:** em Controle remoto, aba Relay, informe `wss://relay.seudominio.exemplo`, leia o aviso, marque o reconhecimento de que é experimental e ligue.
7. **Atualizar:** baixe a versão nova do código e repita o comando do passo 4. Não há dados a migrar.
8. **Backup:** nada a salvar. O relay não tem estado. Guarde apenas o seu arquivo de ambiente.
9. **Monitorar:** consulte o estado do serviço `relay` com o comando do passo 5 e os logs (sem conteúdo, com IP truncado) com:

```
docker compose -f deploy/relay/compose.yaml logs relay
```

10. **Verificação estática local (opcional):** `node deploy/relay/verificar.mjs` confere as regras de endurecimento sem executar nada.

## Antes do primeiro build: o digest da imagem base

O `Dockerfile` fixa a imagem de execução por digest. O valor que vem no repositório é um **marcador** (só zeros) e precisa ser trocado pelo digest real da sua imagem `gcr.io/distroless/nodejs22`, consultado por você. Enquanto for o marcador, o build falha de propósito.

## Se o relay for comprometido

O pior caso é negação de serviço (o relay descarta, atrasa ou derruba conexões); ele não lê nem forja conteúdo. Mesmo assim, para rotacionar tudo: desligue o relay no app, use o botão de pânico, destrua a VPS e **repareie** os celulares (o segredo de cada canal é trocado no novo pareamento).

## Custo

Valores de ordem de grandeza, **estimativa — confirme com seu provedor**: uma VPS de entrada custa algo entre US$ 4 e US$ 6 por mês; o domínio, cerca de US$ 10 a US$ 15 por ano; o tráfego do relay é muito baixo (ocioso, na casa de 100 KB por hora por dispositivo), então a franquia de banda do plano costuma sobrar. O TLS automático (Caddy com ACME) não tem custo.

## Alternativas gratuitas, sem relay

- **Modo rede local:** o celular na mesma Wi-Fi do desktop, com o servidor HTTPS local da Fase 13.
- **Modo loopback com túnel próprio:** o servidor escuta só neste computador e você mesmo expõe por um túnel que já use.

Ambas dispensam VPS, domínio e este diretório.
