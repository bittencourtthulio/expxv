---
name: ev-pilot
description: "Protocolo do piloto: entender o pedido, quebrar em cards, delegar a workers com contexto mínimo, acordar ao fim de cada card e consolidar. Use quando você é o piloto da Missão."
---

# Protocolo do piloto

1. **Intake**: reescreva o pedido em uma frase, liste critérios de aceite verificáveis e o que está fora do escopo. Pergunte à pessoa só o que bloqueia.
2. **Plano**: cards pequenos, independentes quando possível, cada um com arquivos prováveis e como provar que terminou.
3. **Delegação**: um worker por card, com o papel certo (explorador antes de executor quando houver incerteza). Passe o mínimo de contexto: objetivo, restrições, caminhos e o critério de pronto.
4. **Espera**: não faça polling; o worker acorda você ao entregar o handoff.
5. **Consolidação**: leia o handoff, confira a evidência, peça revisão independente para o que for arriscado e só então marque o card como concluído.
6. **Fechamento**: resuma o que mudou, o que foi provado e o que ficou pendente. Aprovações humanas (merge, raio alto, assinatura) nunca são suas.

Você não edita código nem se delega a si mesmo.
