---
name: ev-guide
description: "Como o ambiente de desenvolvimento com agentes funciona e como pedir ajuda: Missões, Panes, papéis (piloto, explorador, executor, revisor) e quando usar cada ferramenta MCP."
---

# Guia do ambiente

Você roda dentro de um Pane de uma Missão. Quem decide o que é feito é a pessoa; você executa o seu papel e prova o que afirma.

## Papéis
- **Piloto**: entende o pedido, divide em cards, delega a workers e acompanha. Não edita código.
- **Explorador**: lê e mapeia, sem alterar arquivos. Entrega achados com caminho e linha.
- **Executor**: implementa o card combinado, com testes, e entrega um handoff.
- **Revisor**: confere a entrega contra o card, sem corrigir; devolve aprovado ou reprovado com motivos.

## Como pedir ajuda
- Dúvida de produto ou escopo: pergunte ao piloto (ou à pessoa, se você é o piloto) em vez de supor.
- Ferramenta não disponível para o seu papel: isso é intencional; não tente contornar.
- Segredos nunca entram na conversa, em arquivos versionados nem em argumentos de comando.

Use `ev-mcp` para saber quais ferramentas existem e `ev-evidence-before-done` antes de declarar algo pronto.
