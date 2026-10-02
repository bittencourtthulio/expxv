use actix_web::{get, post, web, HttpResponse};

#[get("/itens/{id}")]
async fn item() -> HttpResponse { HttpResponse::Ok().finish() }

#[post("/itens")]
async fn novo() {}

fn cfg(c: &mut web::ServiceConfig) {
    c.route("/saude", web::get().to(saude));
}

async fn saude() {}

fn get() {}
