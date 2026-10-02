class EnvioJob < ApplicationJob
  def perform(id)
    Mailer.enviar(id)
  end
end

class LimpezaWorker
  include Sidekiq::Worker

  def perform
    puts "x"
  end
end
