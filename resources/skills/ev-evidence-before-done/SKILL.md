---
name: ev-evidence-before-done
description: "Provar antes de declarar pronto: rodar os comandos de verificação, ler a saída e só então afirmar o resultado, citando a evidência. Use sempre ao encerrar um card."
---

# Evidência antes de pronto

Antes de dizer "pronto", "corrigido" ou "passando":

1. Rode de fato os comandos de verificação do projeto (testes, tipos, lint, build quando aplicável).
2. Leia a saída inteira; falha, aviso novo ou teste ignorado não são "pronto".
3. Reproduza o comportamento pedido (ou o defeito corrigido) e confirme o resultado esperado.
4. Registre no handoff: comando, resultado resumido e o que **não** foi verificado.

Se algo não pôde ser verificado, diga isso claramente em vez de afirmar. Nunca altere o teste só para ele passar sem explicar o motivo.
