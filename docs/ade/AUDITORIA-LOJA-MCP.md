# Auditoria de segurança — Loja de MCPs (Fase 7B, T-07B.35)

Escopo: execução de comando de terceiros, hash/consentimento, allowlist de ambiente, segredos fora de argv/log, gate `pre-mcp` e rota
`/loja/segredos` (401 após restart), descoberta no Registro Oficial, arquivos temporários por Pane. Método: leitura do código de
`src/nucleo/loja-mcp/**`, `src/main/loja-mcp.ts`, `src/nucleo/mcp/{servidor,tools/mcp-store}.ts`, `resources/mcp/mcp-run.mjs` e dos hooks, mais
os testes existentes (guardas estáticas em `seguranca.test.ts`). Nenhum pacote real foi instalado; nenhuma rede.

## Achados e correções (todos com teste)

| # | Gravidade | Achado | Correção | Teste |
|---|---|---|---|---|
| A-1 | Alta | O consentimento era por versão só na tela: a política (`resolverServidoresLoja`) NÃO conferia o `comando_hash` consentido. Servidor instalado cujo comando mudou no catálogo atual (args, URL, versão, variáveis) continuava indo para o Pane e rodava o comando NOVO sem reconsentimento (`atualizacao_disponivel` era só selo). | `politica.ts`: `inst.comando_hash !== hashDoComando(entrada)` ⇒ excluído com motivo `reconsentimento_pendente` até a pessoa atualizar e consentir. | `politica.test.ts` (consentimento por versão) |
| A-2 | Média | `hashDoComando` não incluía `riscos` nem `autenticacao`: mudar o risco declarado (o que o consentimento mostra) não invalidava o consentimento nem aparecia como atualização. | `plano.ts`: `riscos` (ordenados, como conjunto) e `autenticacao` entram no hash. Instalações antigas do desenvolvimento passam a mostrar "atualização disponível" (sem versão publicada, sem impacto). | `politica.test.ts` (hash muda por versão/args/url/riscos/autenticação) |
| A-3 | Média | "Instalar na minha CLI" escreve na configuração GLOBAL da CLI da pessoa e só conferia "instalado": servidor que entrou na lista de bloqueio depois de instalado ainda podia ser gravado lá. | `main/loja-mcp.ts#instalarNaCli`: bloqueado ⇒ `bloqueado`, a CLI não é executada. | `main/loja-mcp.test.ts` |
| A-4 | Baixa | Arquivos temporários por Pane (`mcp.json`, `claude-settings.json`, podem ter cabeçalho de chave de servidor remoto, D-133) ficavam se o app fechasse à força: o "varrido no boot" do plano não existia. | `varrerArquivosOrfaosDaLoja` no `ocioso()` (boot, +5 s): só esses dois nomes, só em pastas com id válido e Pane não ativo; não abre catálogo nem cofre. | `main/loja-mcp.test.ts` |
| A-5 | Info | A guarda estática "só `saude-servidor.ts` usa rede" passou a admitir também `descoberta.ts` (`loja_mcp:descobrir`, T-07B.32): GET único por clique, timeout 8 s, resposta ≤ 1 MB, `redirect:"error"`, sem credenciais, resultado `curado:false`/`instalavel:false`, sem comando, descrição saneada (controle/bidi/markup), spam filtrado. | guarda atualizada; módulo novo coberto por 19 testes (fuzz de 500 JSONs). | `seguranca.test.ts`, `descoberta.test.ts`, `main/loja-mcp.test.ts` |

## Verificações sem achado

- **Execução de comando de terceiros:** `spawn` sempre com `shell:false`, executável separado dos argumentos (guarda estática: nenhum `shell:true`, `exec*`, `npx`, `@latest`, `curl|sh`, `--force`, `sudo`, `-g`, `homedir()`, `eval`); instalação em `<userData>/mcp/.tmp/<id>-<rand>` com `--ignore-scripts`, `npm_config_*` apontando para dentro do `.tmp`, HOME/TMPDIR/cache isolados, sem `NPM_TOKEN`; promoção atômica; integridade do pacote raiz e `lock_sha256` conferidos antes de promover; `pastaIsolada` recusa id fora de `^[a-z0-9-]+$` e fuga por `realpath`; binário só de `github.com/<dono>/<repo>/releases/download/` com sha256; Docker sem `--privileged`, `docker.sock`, `--network host` nem montagem fora do workspace.
- **Hash:** o servidor recomputa `hashDoComando` e compara com o enviado (`consentimento_invalido`); o cliente não escolhe o que será executado (só ids e o hash que viu).
- **Allowlist de ambiente:** `montarAmbienteServidor` só repassa básicas do SO + variáveis declaradas; reservadas (`PATH`, `HOME`, `NODE_*`, `LD_*`, `DYLD_*`, `ANTHROPIC_*`, `OPENAI_*`, `CODEX_*`, `CLAUDE*`, `ELECTRON_*`, `NPM_*`, prefixo do produto, tokens de provedor) são recusadas mesmo declaradas.
- **Segredos fora de argv/log:** segredo só no cofre do SO; `variavel_gravar` é canal sensível (payload fora do log); `definida: boolean` é tudo que volta; log do ciclo passa por `redigir`; stderr de servidor ≤ 2 KB redigido; o lançador não repassa `*_LOJA_URL`/`*_LOJA_TOKEN` ao filho (recebe só o ambiente devolvido pelo app); `/loja/segredos` responde `no-store`, nada é logado, 5 chamadas/min/Pane; "instalar na minha CLI" nunca copia segredo e recusa `{{SEGREDO}}` em argumento.
- **Gate `pre-mcp`:** matcher `mcp__ev_.*`, falha FECHADA no `gancho.mjs`; nega fora do snapshot do Pane; permitir não força `allow`.
- **Tool `mcp_store_list`:** só leitura, só o snapshot do próprio Pane (identidade do token), campos fixos, nomes de ferramenta pelo alfabeto do protocolo, ≤ 4 KB; nenhuma tool instala/configura/habilita (D-138, teste de catálogo).
- **Seed:** manifesto sha256 gerado em `build:main` (D-141); divergência ⇒ Loja só leitura, nada instalável.

## Riscos residuais (aceitos e registrados; nenhum item aberto de correção segura nesta onda)

- **[RESOLVIDO na Fase 7C, ver AUDITORIA-CATALOGO C-6/D-373] R-1 (média, inerente ao desenho do D-132):** o token do Pane (`<PREFIXO>_LOJA_TOKEN`) fica no ambiente do Pane; um agente com Bash do próprio Pane poderia chamar `/loja/segredos` e ler a chave de um servidor que JÁ está no snapshot dele (5/min). Ele já pode usar o servidor; o ganho é ler a chave. Endurecimento futuro (pedido): entregar URL+token ao lançador pelo `env` do servidor MCP no `mcp.json` (fora do ambiente do Bash) e restringir a leitura do arquivo; não feito aqui por tocar a injeção de todas as CLIs.
- **R-2 (baixa):** servidor com `{{SEGREDO}}` em argumento (stripe, sentry-stdio, redis) expõe a chave no argv do servidor real a processos do mesmo usuário; o consentimento mostra o aviso `segredo_em_argumento`.
- **[RESOLVIDO na Fase 7C, C-7/D-373] R-3 (baixa, comportamento):** após reiniciar o app, um Pane que sobreviveu (daemon vivo) perde o snapshot: `/loja/segredos` responde 401 e o gate nega `mcp__ev_*` (falha fechada). Servidores da Loja só voltam num Pane novo. Reconstruir o snapshot no reattach é melhoria (pedido).
- **R-4 (baixa):** nível `padrao` não trava dependências transitivas (aviso no consentimento); só o `forte` (lock curado) trava tudo. Depende de rodar `scripts/gerar-lock-mcp.mjs` com consentimento do dono (P-131).
- **R-5 (baixa, Windows, D-26):** `npm.cmd`/`.cmd` com `shell:false` falha no Node ≥ 18.20 (`EINVAL`); no Windows a instalação npm precisa chamar `node npm-cli.js` direto. Sem validação real (D-26).
- **R-6 (info):** `testarRemoto` aceita `http://` no teste de saúde; o esquema do catálogo só admite `https://` em entrada real (o `http` existe só para os servidores falsos de teste).
