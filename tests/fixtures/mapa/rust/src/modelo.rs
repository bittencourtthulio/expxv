use sqlx::PgPool;
use crate::Base;

/// Um pedido da loja.
#[derive(Debug, Parser)]
pub struct Pedido {
    pub id: i64,
}

pub enum Estado { Aberto, Fechado }

pub trait Repositorio: Base + Send {
    fn buscar(&self, id: i64) -> Option<Pedido>;
}

pub const LIMITE: u32 = 10;
pub type Id = i64;

impl Pedido {
    /// Cria um pedido.
    pub fn novo(id: i64) -> Self {
        Pedido { id }
    }

    pub(crate) fn total(&self, extra: bool) -> i64 {
        if extra && self.id > 0 {
            match self.id {
                1 => 1,
                _ => 2,
            }
        } else {
            0
        }
    }

    fn interna(&self) {
        let r = outra().unwrap();
        let _ = std::fs::read("a")?;
    }
}

impl Repositorio for Pedido {
    fn buscar(&self, id: i64) -> Option<Pedido> {
        let q = sqlx::query!("SELECT id, total FROM pedidos WHERE id = 1");
        let q2 = format!("DELETE FROM {} WHERE 1=1", t);
        let ok = match x() { Ok(v) => v, Err(_) => {} };
        let d: Box<dyn Repositorio> = todo!();
        panic!("boom");
    }
}

#[macro_export]
macro_rules! mm {
    () => {};
}

fn texto() {
    let a = "Select all items from the cart please";
}
