# Auditoria de segurança — Catálogo (Fase 7) e Gateway MCP (Fase 7C)

Método: leitura do código e testes dos forks (núcleo, política, gateway, UI). Sem rede, sem CLI real, e2e escritos e NÃO rodados (exigem build).

| # | Tema | Achado | Correção | Teste |
|---|---|---|---|---|
| C-1 | Execução de comando de terceiro | Scanner poderia executar hook/MCP/skill do usuário | Scanner só lê; hook/MCP guardam só nome/executável-base; `verificar_mcp` só sob confirmação, só loopback http, sem shell, ambiente mínimo, timeout | `scanners/*.test`, `mcp-verificar.test` |
| C-2 | Segredo em config | `env`/headers/args de `.mcp.json`, `config.toml` | Redação na origem (valor nunca copiado); varredura de strings em todas as tabelas e eventos | `redacao-mcp.test` |
| C-3 | Symlink/traversal | Skill apontando para fora da casa; nome com `../` | `quebrado` com `fora_das_raizes`, não lido; `realpath` dentro das raízes; `nomeValido`; cópia sem seguir symlink, teto 20 MB | `raizes.test`, `instalacao.test` |
| C-4 | Injeção de prompt por skill | Descrição/corpo de terceiro virar instrução | Descrição saneada (ANSI, bidi, zero-width) e truncada, tratada como dado; corpo de SKILL.md nunca em prompt, só nome; UI renderiza como texto (sem HTML) | `sanear.test`, `catalogo-ui.test` |
| C-5 | Escalonamento por gateway | Tool de terceiro fora da política/papel; servidor removido continua no cache | Filtro refeito a cada chamada (Loja + política do Pane + papel); deny-by-default em squad/agentico (escrita só por regra explícita); servidor desinstalado/bloqueado/comando mudado sai na hora; nomes no alfabeto do protocolo; chamada que falha nunca repetida | `gateway-mcp/*.test` |
| C-6 | Token no ambiente (R-1) | Token do Pane no Bash lia `/loja/segredos` | `aud` por rota; `/loja/segredos` só com token `loja-launcher` escopado (Pane+servidor, ≤ 30); gateway ativo = Pane sem credencial do lançador | `tokens.test`, `lancador.test` |
| C-7 | Restart (R-3) | Pane sobrevivente perdia gate/segredos | Snapshot persistido e reidratado (24 h, podado, apagado ao fechar o Pane); linha adulterada nunca vira acesso | `persistencia.test`, `orquestracao-gateway.test` |
| C-8 | Gate | Falha aberta com app parado | `gancho.mjs` falha fechada em `pre-tool-use/pre-skill/pre-mcp`; nome com controle/bidi/`../` negado; erro ao resolver política não abre Pane | `gate.test`, contrato com CLI falsa |
| C-9 | Escrita na casa | Instalar sem ação do usuário | Só escopo global, só por ação explícita; embarcadas não copiadas sem clique; editadas nunca sobrescritas; hash do manifesto conferido | `manifesto.test`, `instalacao.test` |

## Riscos residuais aceitos
- R-1 sem gateway: o token escopado do lançador ainda é alcançável por Bash em Codex/OpenCode (ambiente) e Claude (arquivo 0600); preso à lista do Pane e ao teto de leituras. Use o gateway para eliminar.
- R-2 (segredo em argumento de servidor da Loja) inalterado.
- Subagentes das CLIs não são bloqueados (o método depende deles); isolamento fora do Claude Code é parcial, com selo.
- `opencodeSuportaPermissaoSkill=false` até contrato com CLI real; `mcp_store_list` vazio em Pane com gateway.
- E2E (casa de teste, 4ª skill bloqueada por CLI falsa) escritos parcialmente e não rodados.
