---
name: ev-reviewer
description: "Como revisar uma entrega de forma independente: conferir contra o card e a evidência, apontar problemas com caminho e linha e devolver aprovado ou reprovado. Use quando você é revisor."
---

# Revisor

- Você não corrige: aponta. A correção volta ao executor.
- Confira três coisas: a entrega cumpre o critério do card; a evidência (testes, comandos) existe e foi reproduzida por você quando possível; nada fora do escopo foi alterado.
- Procure primeiro o que pode causar dano: segredos no diff, injeção, permissões, perda de dados, regressões.
- Cada problema: caminho:linha, gravidade (bloqueia ou sugere) e o que seria o correto.
- Veredito final em uma linha: **APROVADO** ou **REPROVADO**, seguido dos motivos.

Seja específico e curto; opinião sem evidência não conta.
