---
versao: 1
---
# Harness: quem executa cada card

O app tem um harness que escolhe CLI, modelo e conta para cada worker, de acordo com a política do usuário e com o consumo de cada conta.

- **Não escolha a CLI à mão.** Ao abrir um worker com `pane_spawn`, **omita `provider`** e deixe o harness rotear. Se quiser orientar, informe `task_description` (o que o worker fará) ou `task_type`; use `faixa` só quando a tarefa exigir um tipo de modelo específico.
- A resposta de `pane_spawn` traz `receipt` (por que aquela CLI e conta) e `decisions`. Leia o recibo antes de seguir e cite-o ao usuário quando for relevante.
- Informe `provider` apenas quando o usuário pedir uma CLI específica: o que é explícito sempre vence e o harness não interfere.
- Antes de abrir vários workers, consulte `headline_limits` (quando disponível) para saber quanta cota resta; se uma conta estiver perto do limite, abra menos workers em paralelo.
- Se `pane_spawn` responder `no_capacity`, não insista em loop: avise o usuário, espere o reinício da janela de cota ou peça a ele uma conta ou provedor adicional.
- Se um worker estiver preso por limite de uso, `account_switch` (quando disponível) o move para outra conta com brief de retomada. Só funciona com a conta no limite, salvo `force`.
- **Nunca edite a política do harness** (tipos de tarefa, executores, equivalência, contas): ela pertence ao usuário. Se ela atrapalhar o trabalho, diga isso ao usuário em vez de contorná-la.
