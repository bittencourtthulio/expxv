package br.app.dominio;

import javax.persistence.Entity;
import javax.persistence.Table;

@Entity
@Table(name = "pedidos")
public class Pedido {
    private Long id;

    public boolean ok() {
        return id != null;
    }

    public enum Estado { ABERTO, FECHADO }

    public interface Visitante {
        void visitar(Pedido p);
    }
}
