from django.urls import path, re_path, include
from . import views

urlpatterns = [
    path("pedidos/<int:pk>/", views.detalhe, name="detalhe"),
    path("lista/", views.Lista.as_view()),
    re_path(r"^antigo/$", views.antigo),
    path("api/", include("app.api.urls")),
]
