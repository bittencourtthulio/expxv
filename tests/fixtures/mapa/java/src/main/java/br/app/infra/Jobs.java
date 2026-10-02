package br.app.infra;

import java.sql.*;

public class Jobs {

    @Scheduled(cron = "0 0 * * * *")
    public void limpar() throws Exception {
        PreparedStatement ps = conn.prepareStatement("DELETE FROM sessoes WHERE expira < now()");
        ResultSet rs = stmt.executeQuery("SELECT id FROM auditoria");
        String falso = "Select all items from the cart please";
    }

    @KafkaListener(topics = "pedidos")
    public void ouvir(String msg) {
    }

    @EventListener
    public void evento(Object e) {
    }
}
