Rails.application.routes.draw do
  root 'home#index'
  get '/saude', to: 'home#saude'
  resources :pedidos, only: [:index, :show] do
    member do
      post :aprovar
    end
  end
  namespace :admin do
    resources :usuarios, except: [:destroy]
    post '/lote', to: 'lotes#criar'
  end
end
