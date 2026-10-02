export function RelayGuia() {
  return (
    <details className="jarvis-bloco">
      <summary>Guia de hospedagem do relay</summary>
      <ul className="jarvis-linhas">
        <li>Você hospeda o seu próprio relay: nenhum relay público é fornecido e este app não envia nada para fora sem você ligar.</li>
        <li>Uma VPS pequena basta (estimativa — confirme com seu provedor: poucos dólares por mês), com um domínio e TLS (Caddy no perfil «tls»).</li>
        <li>Os arquivos prontos (Docker, compose, Caddy) estão em <code>deploy/relay/</code>; o passo a passo está em <code>deploy/relay/LEIA-ME.md</code>. Este app nunca implanta nada.</li>
        <li>O relay não guarda nada: se for comprometido, pare-o e pareie os celulares de novo.</li>
        <li>Sem relay, o controle remoto continua disponível na rede local (aba «Controle remoto»).</li>
      </ul>
    </details>
  );
}
