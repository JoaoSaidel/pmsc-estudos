# PMSC Estudos

Cronograma, cronômetro Pomodoro, simulados, modo prova, flashcards de leis e redação para o concurso de Soldado PMSC 2026 (Edital 002/CCP/2026 — AOCP).

Site estático (HTML + CSS + JS puro, sem build). Dados salvos no navegador e, com login, sincronizados no Supabase.

## Estrutura
- `index.html` — página
- `styles.css` — visual (tema claro/escuro)
- `js/data.js` — cronograma, assuntos, questões, flashcards e temas de redação
- `js/app.js` — lógica do app
- `js/sync.js` — login por e-mail e sincronização (Supabase)
- `js/config.js` — URL e chave **publishable** do Supabase (pública)
- `js/vendor/` — supabase-js 2.49.4 (MIT), incluído para não depender de CDN
- `supabase/schema.sql` — tabela e políticas RLS

## Configuração (uma vez)
1. **Supabase → SQL Editor:** rode `supabase/schema.sql`.
2. **Vercel:** Add New → Project → importe este repositório → Framework "Other", sem build → Deploy.
3. **Supabase → Authentication → URL Configuration:** em *Site URL* e *Redirect URLs*, coloque o endereço da Vercel (ex.: `https://pmsc-estudos.vercel.app`).
4. Entre no site, aba **Dados**, com seu e-mail. Depois, em **Authentication → Sign In / Providers**, desative *Allow new users to sign up* para ninguém mais criar conta.

## Segurança
- Só a chave `sb_publishable_...` fica no código. A chave secreta nunca entra no repositório.
- Cada usuário só lê e grava a própria linha (RLS).
