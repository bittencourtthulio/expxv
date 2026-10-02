require "sinatra"
task :limpar do
  puts "limpando"
end
get '/ola' do
  "olá"
end
if __FILE__ == $0
  limpar
end
