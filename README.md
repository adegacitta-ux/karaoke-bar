# 🎤 Karaokê Manager - Sistema de Fila Inteligente

Um sistema web completo para gerenciar filas de karaokê com priorização inteligente e interface intuitiva.

## 🎯 Características Principais

✅ **Duas Interfaces Integradas:**
- **Interface do Cliente**: Permite enviar pedidos de músicas
- **Interface do Admin/DJ**: Gerencia a fila e executa ações

✅ **Priorização Inteligente:**
- Quem cantou menos vezes tem prioridade
- Em caso de empate, vale a ordem de chegada
- Sistema de rodadas justo e transparente

✅ **Gerenciamento Automático:**
- Cálculo de tempo estimado de espera
- Bloqueio automático da fila por horário limite (23h)
- Fechamento manual da fila pelo DJ

✅ **Histórico Persistente:**
- Dados salvos no localStorage
- Histórico de músicas já cantadas
- Contagem de vezes por cantor

✅ **Design Responsivo:**
- Interface adaptável para mobile e desktop
- Tema moderno com gradientes
- Ícones intuitivos e feedback visual

## 🚀 Como Usar

### Acesso Online
Acesse diretamente: **[https://adegacitta-ux.github.io/karaoke-bar/](https://adegacitta-ux.github.io/karaoke-bar/)**

### Acesso Local
1. Clone o repositório:
```bash
git clone https://github.com/adegacitta-ux/karaoke-bar.git
cd karaoke-bar
```

2. Abra `index.html` no seu navegador:
```bash
# Linux/Mac
open index.html

# Windows
start index.html

# Ou use um servidor local
python -m http.server 8000
```

## 👥 Guia de Uso

### Para Clientes:
1. Clique na aba "Cliente"
2. Preencha seu nome/apelido, nome da música e artista
3. Clique em "ENVIAR PEDIDO"
4. Aguarde sua vez (a fila é mostrada na aba Admin/DJ)

### Para Admin/DJ:
1. Clique na aba "Admin/DJ"
2. Visualize a fila ordenada por prioridade
3. Use os botões de ação:
   - ▶️ **Play**: Chama o próximo (registra como cantada)
   - ⏭️ **Skip**: Move para o final da sua rodada
   - 🗑️ **Remover**: Remove da fila
4. Veja o histórico de quem já cantou
5. Use "Fechar Fila Manualmente" para encerrar adições
6. "Limpar Dados da Noite" para resetar tudo

## ⚙️ Configurações

No arquivo `index.html`, você pode ajustar:

```javascript
const TEMPO_MEDIO_MUSICA = 5;  // Duração média em minutos
const HORARIO_LIMITE = "23:00"; // Horário para fechar automaticamente
```

## 💾 Dados

Todos os dados são armazenados no **localStorage** do navegador:
- `karaoke_fila`: Pedidos atuais
- `karaoke_historico`: Músicas já cantadas
- `karaoke_contagem`: Vezes que cada cantor cantou
- `karaoke_manual_fechada`: Status da fila

**Nota**: Os dados são perdidos se você limpar o cache do navegador ou usar modo incógnito.

## 🛠️ Tecnologias

- **HTML5**: Estrutura semântica
- **Tailwind CSS**: Estilização responsiva
- **Font Awesome**: Ícones
- **JavaScript Vanilla**: Lógica sem dependências
- **LocalStorage API**: Persistência de dados

## 📱 Compatibilidade

- ✅ Chrome/Chromium (recomendado)
- ✅ Firefox
- ✅ Safari
- ✅ Edge
- ✅ Navegadores mobile

## 📝 Licença

Este projeto é de código aberto e pode ser usado livremente.

## 🤝 Contribuições

Sugestões e melhorias são bem-vindas! Crie uma issue ou pull request.

---

**Desenvolvido com ❤️ para facilitar as noites de karaokê!** 🎵
