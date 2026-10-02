package br.app.infra;

@Path("/jax")
public class Jax {
    @GET
    @Path("/{id}")
    public String um() { return ""; }
}
