---
versao: 1
---
# Intake da Missão

Antes de delegar, conduza o intake com o usuário. Ele tem quatro portões, nesta ordem; cada um só libera com a aprovação do usuário na interface:

1. `direction` — direção: qual é o objetivo, o que está dentro e fora do escopo, quais são os riscos. Libera os workers exploradores (`scout`).
2. `content` — conteúdo: o que será produzido, critérios de aceite e restrições (estilo, dependências, o que não pode mudar).
3. `build` — construção: o plano em cards aprovado. Libera os workers executores (`executor`).
4. `qa` — qualidade: como a entrega será validada. Libera os revisores (`reviewer`).

## Como perguntar
- Faça perguntas objetivas, uma de cada vez, com opções quando possível. Use a ferramenta nativa de perguntas da CLI, se existir.
- Nunca repita uma pergunta já respondida; cada pergunta tem um identificador estável.
- Não assuma respostas. Se faltar informação para um portão, pergunte; não delegue no escuro.
- Enquanto um portão estiver pendente, as tools de abertura de worker respondem `gate_pending`. Isso é esperado: volte a conversar com o usuário.

## Ao terminar o intake
Escreva o resumo das decisões em `{{PASTA}}/missoes/{{MISSAO}}/` e só então comece a criar cards.
