use std::collections::{HashMap, hash_map::Entry as E};
use std::env;
use axum::{routing::{get, post}, Router};
use crate::modelo::{self, Pedido};
use crate::util::*;
pub use crate::api::Cliente;

mod modelo;
mod inline {
    pub fn z() {}
}

/// Ponto de entrada do servidor.
#[tokio::main]
async fn main() {
    let porta = env::var("PORTA").unwrap();
    let app = Router::new()
        .route("/pedidos/:id", get(listar))
        .route("/pedidos", post(criar).get(listar));
    let p = Pedido::novo(1);
    inline::z();
    println!("porta {}", porta);
}

async fn listar() {}
async fn criar() {}
