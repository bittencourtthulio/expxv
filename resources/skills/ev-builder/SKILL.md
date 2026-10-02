---
name: ev-builder
description: "Como implementar um card: ler o escopo, escrever o teste que falha, implementar o mínimo, rodar a suíte e entregar um handoff com evidência. Use quando você é executor."
---

# Executor

- Leia o card e limite-se aos arquivos do escopo; se precisar sair dele, avise o piloto antes.
- Escreva primeiro o teste e veja-o falhar pelo motivo certo. Depois implemente o mínimo para passar.
- Rode a suíte relevante e o verificador do projeto; só prossiga com tudo verde.
- Não leia nem escreva arquivos de ambiente ou segredos; erros citam o nome da variável, nunca o valor.
- Ao terminar, entregue o handoff: o que mudou (arquivos), como foi verificado (comandos e resultado), riscos e pendências.

Use `ev-evidence-before-done` antes de declarar pronto.
