# Pedidos da Onda B (Loja de MCPs, núcleo) ao coordenador

Entregue em `src/nucleo/loja-mcp/**` (exportado por `index.ts`). Nada fora de `loja-mcp/**`, `tests/fixtures/mcp-loja/**` e este arquivo foi editado.

## 1. Migration (próximo número livre; hoje o último é `0006-squads`)
Tabelas do plano (`catalogo_mcp_instalado`, `_consentimento`, `_variavel`, `_habilitacao`, `_saude`, `_ferramenta`, `_cli_instalacao`, `_log`, `_kit`) + `repos/catalogo-mcp.ts` implementando a porta **síncrona** `RepoLojaMcp` (`src/nucleo/loja-mcp/repositorio.ts`; a implementação em memória `criarRepoMemoria` é o contrato executável: copiar os testes de `repositorio.test.ts` para o repo SQLite).
Pontos que o SQL precisa respeitar: `removerServidor` apaga variáveis/habilitações/saúde/ferramentas/CLI do servidor mas **mantém** `catalogo_mcp_consentimento` (auditoria); `habilitar` é upsert por (servidor, alvo) preservando o `id`; `registrarLog` poda para 200 por servidor e trunca `detalhe_json` em 1 KB; `podarLogs(antesDe)` para os 30 dias; `kitOptOut/definirKitOptOut` (1 linha).

## 2. Composição no main (boot onda 2, ocioso, lazy na 1ª abertura da Loja)
```ts
const cofre = <o Cofre já criado>;                       // nunca reimplementar
const segredos = criarSegredosMcp(cofre);
const ciclo = criarCicloLoja({ repo, catalogo: carregarCatalogo(<resources/mcp/catalogo-mcps.json>, { sha256Esperado }), segredos,
  executor: criarExecutorProcesso(), userData, bloqueio: carregarBloqueio(<resources/mcp/bloqueio.json>) /* falha fechada: bloqueioFechado() */,
  diagnostico /* npm/node/uv/docker/cofre.disponivel */, instalacao: { registroNpm?, locksDir: <resources/mcp/locks>, binarios, baixar }, node: process.execPath,
  nodeEhElectron: true, emUso: (id) => <algum Pane ativo tem o id>, evento: <emitir `mcp_store.*` no evento_dominio>, progresso: <loja_mcp:progresso ≤ 10/s>, cliUsuario });
const kit = criarKit({ ciclo, repo, catalogo });
ciclo.limparTmpOrfaos();  // no boot ocioso
ciclo.aplicarBloqueio();  // idem
```
`diagnostico`: use `localizarExecutavel("npm"|"uv"|"docker")` (exportado) e `cofre.estado()`.

## 3. IPC `loja_mcp:*` (já mapeados 1:1 para métodos; validar payload na borda)
| Canal | Método |
|---|---|
| `listar` / `detalhe` | `catalogo` + `repo.listarInstalados/obterSaude/ferramentasDe` + `ciclo.variaveisEstado` (detalhe usa `montarPermissoes`) |
| `plano_instalacao` | `ciclo.planoInstalacao(id, workspace)` (devolve `comando_hash` que a UI reenvia) |
| `instalar` | `ciclo.instalar(id, {aceito:true, comando_hash}, {origem:"loja"})`; cancelar = `AbortController` por `instalacao_id` |
| `plano_atualizacao` / `atualizar` | `ciclo.planoAtualizacao` / `ciclo.atualizar` |
| `desinstalar` | `ciclo.desinstalar(id, {apagar_segredos})` |
| `variavel_gravar` / `variavel_apagar` / `variaveis_estado` | `ciclo.gravarVariavel/apagarVariavel/variaveisEstado` (valor nunca volta) |
| `testar` | `ciclo.testar(id, {workspace})` |
| `habilitar` / `habilitacoes` | `ciclo.habilitar(id, tipo, valor, bool)` / `ciclo.habilitacoes(workspace)` |
| `previa_cli_usuario` / `instalar_na_cli` / `remover_da_cli` | `previaCliUsuario` + `criarServicoCliUsuario(...).instalar(e, previa, confirmacaoDigitada)` / `.remover` |
| `kit` | `kit.estado/plano/instalar/definirOptOut` (consentimento do CONJUNTO: `comando_hash` de `kit.plano()`) |
| `logs` | `repo.logsDe(id, limite)` |
Códigos de erro nominais estão em `CodigoCiclo`/`CodigoInstalacao`/`CodigoVariavel`. Nenhuma tool MCP instala/configura (D-138): só UI.

## 4. Injeção por Pane (T-07B.20) — ligar em `orquestracao/piloto.ts`/`terminais`
1. `const { servidores } = await ciclo.servidoresDoPane({ workspace, missao?, agente?, modo? })`.
2. `const loja = configuracaoDeMcpLoja(cli, servidores, { userData, node: process.execPath, nodeEhElectron: true, lancador: { script: <mcp-run.mjs>, variavelUrl: variavelDeAmbiente("LOJA_URL"), variavelToken: variavelDeAmbiente("LOJA_TOKEN") }, estrito: <Missão squad/agentico> }, <arquivo 0600 do Pane>)`.
3. `const final = combinarConfiguracoesMcp(configuracaoDeMcp(cli, servidorDoApp, arquivo), loja)` (um só `--mcp-config`; OpenCode funde `OPENCODE_CONFIG_CONTENT`).
4. O main grava `final.arquivo` (0600) e apaga ao fechar o Pane; **precisa colocar no ambiente do Pane** os valores de `loja.ambiente_requerido` (URL e token de loopback; só os NOMES saem daqui). Servidor sem segredo roda direto (sem lançador).
5. Gate `pre-mcp`: permitir `padraoToolDoServidor(id)` (`mcp__ev_<id>__*`) só para ids de `loja.servidores`; falha fechada.
6. `selo de isolamento`: `isolamentoPorCli()`.

## 5. Lançador `resources/mcp/mcp-run.mjs` + rota `POST /loja/segredos` (T-07B.21)
- Rota em `nucleo/mcp/servidor.ts`: usar `criarServicoSegredos({ segredos, catalogo, permitidosDoToken })` (já cobre 401/403/400/404/429 5 por minuto por Pane); `permitidosDoToken(token)` = ids de `servidoresDoPane` do Pane dono do token (ou `null` se token inválido); responder `Cache-Control: no-store`, não logar corpo.
- `mcp-run.mjs` (sem dependências): lê `--servidor <id>`, URL/token das variáveis de loopback do Pane (retirar do ambiente do filho), `POST`, e `spawn` do servidor real com **o mesmo comando** de `montarComando(entrada, { modo:"execucao", segredos, variaveis })` + ambiente por `montarAmbienteServidor` (allowlist). Como o script roda fora do bundle, o caminho mais simples é o main expor `GET`-less rota que devolva também `{executavel, args, env_fixas}` resolvidos (o lançador não reimplementa `montarComando`); sugestão: estender a resposta de `/loja/segredos` com `comando` (só para servidores permitidos). Falha → stderr claro e `exit 70`.

## 6. Contrato / catálogo (campos que faltam para fechar casos reais)
- `variaveis[].cabecalho` (ex.: `"Authorization: Bearer {{valor}}"`) no esquema para servidores **remotos com chave de API**: hoje a chave remota não é injetada (aviso `chave remota não é injetada`), a CLI usa OAuth (D-133). Sem o campo, nenhum cabeçalho é montado por adivinhação.
- Entrada que cita `{{SEGREDO:X}}` em `args` (stripe-npm, sentry-stdio, redis-mcp) passa a ser tratada como variável **exigida** (`variaveisExigidas`) e sempre sobe pelo lançador; o segredo chega ao argv do servidor real, não ao Pane: manter o risco no `riscos_texto` das três.
- P-136 (git/filesystem/fetch no Kit): implementado em `kit.ts` (`EXTRAS_DO_KIT`) **sem** mudar a `classificacao` do seed; se preferir, reclassifique no seed e zere `extras`.
- Lock curado: `instalarServidor` já exige `locksDir/<id>.package-lock.json` (npm) ou `<id>.requirements.txt` (uv) quando a entrada tem `lock_sha256`, e confere o hash; falta só `scripts/gerar-lock-mcp.mjs` (T-07B.33) e `docker`/`uv` reais (executor injetável; nenhum comando real rodou).
- Assinatura ECDSA do registro npm: `verificarAssinaturaNpm` (puro) pronta; falta ligar com `resources/mcp/chaves-npm.json` no ponto em que o main já tiver os metadados do tarball (a instalação atual confere `integrity` do pacote raiz contra o catálogo, que é o requisito do nível `padrao`).

## 7. Eventos (`evento_dominio`, só nomes, nunca valor)
`mcp_store.install_started|install_finished|install_failed|consent_recorded|enabled|disabled|health|removed` já saem de `DepsCiclo.evento`. `mcp_store.injected {pane_id, cli, ids[]}` é do main (no ponto da injeção).

## 8. UI (T-07B.26..31) — consumir
`CartaoMcp` = entrada do catálogo + `repo.obterInstalado` + `obterSaude`; estados do botão: sem registro → `Instalar`; `instalando`; `falhou` → `Tentar de novo`; `instalado` com `variaveisEstado` faltando → `Configurar`; sem habilitação → `Habilitar`; `planoAtualizacao.disponivel` → `Atualizar`. Painel: `PlanoInstalacao.comando_exato` é o texto exato do comando (byte a byte o executado: o argv do instalador vem de `acoesDeInstalacao`, testado em `instalar.test.ts`). `saudePassiva()` alimenta o ícone da aba Instalados sem iniciar processo.
