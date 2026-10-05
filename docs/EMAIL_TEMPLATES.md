# Modelos de e-mail do Supabase Auth

Aplicar em Supabase > Authentication > Email Templates. Os links usam `token_hash` e apontam para `/auth/confirmar`, que valida o link no servidor. O site também aceita os modelos padrão do Supabase (sessão no fragmento `#access_token`, tratada em `/entrar`), mas os modelos abaixo evitam a passagem pela página de login e trazem a identidade do iGrow.

`{{ .SiteURL }}` deve ser a origem publicada (`https://i-grow-reports.vercel.app`), configurada em Authentication > URL Configuration.

O SMTP padrão do Supabase tem limite baixo de envios por hora e remetente `noreply@mail.app.supabase.io`. Para uso com clientes, configurar SMTP próprio (Authentication > SMTP Settings) com remetente do domínio da agência.

## Invite user

Assunto: `Seu acesso ao iGrow Reports`

```html
<div style="margin:0;padding:32px 16px;background:#0b111b;font-family:Arial,Helvetica,sans-serif;color:#e7eef9">
  <div style="max-width:520px;margin:0 auto;background:#111a28;border:1px solid #243449;border-radius:16px;padding:32px">
    <p style="margin:0 0 24px;font-size:15px;font-weight:bold;color:#ffffff">iGrow <span style="font-weight:normal;color:#8ea3bd">Reports</span></p>
    <h1 style="margin:0 0 12px;font-size:22px;color:#ffffff">Você recebeu acesso aos seus resultados</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#b3c4d8">A equipe da agência liberou para você a Área do Cliente do iGrow Reports, onde você acompanha os resultados das suas campanhas. Para começar, crie sua senha.</p>
    <a href="{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&amp;type=invite" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:14px 24px;border-radius:10px">Criar minha senha</a>
    <p style="margin:24px 0 0;font-size:12px;line-height:18px;color:#7f93ab">O link é pessoal e funciona uma única vez. Se ele expirar, peça um novo convite à agência. Se você não esperava este e-mail, ignore-o.</p>
  </div>
  <p style="max-width:520px;margin:16px auto 0;font-size:11px;color:#5d7088;text-align:center">iGrow Digital · Inteligência para crescer</p>
</div>
```

## Magic Link

Usado quando a pessoa convidada já tem conta: abrir o link entra no site e ativa o acesso.

Assunto: `Seu link de acesso ao iGrow Reports`

```html
<div style="margin:0;padding:32px 16px;background:#0b111b;font-family:Arial,Helvetica,sans-serif;color:#e7eef9">
  <div style="max-width:520px;margin:0 auto;background:#111a28;border:1px solid #243449;border-radius:16px;padding:32px">
    <p style="margin:0 0 24px;font-size:15px;font-weight:bold;color:#ffffff">iGrow <span style="font-weight:normal;color:#8ea3bd">Reports</span></p>
    <h1 style="margin:0 0 12px;font-size:22px;color:#ffffff">Seu link de acesso</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#b3c4d8">Use o botão abaixo para entrar no iGrow Reports. Se a agência liberou um novo acesso para você, ele fica ativo ao entrar por este link.</p>
    <a href="{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&amp;type=email" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:14px 24px;border-radius:10px">Entrar no iGrow Reports</a>
    <p style="margin:24px 0 0;font-size:12px;line-height:18px;color:#7f93ab">O link é pessoal, funciona uma única vez e expira em pouco tempo. Se você não pediu este acesso, ignore este e-mail.</p>
  </div>
  <p style="max-width:520px;margin:16px auto 0;font-size:11px;color:#5d7088;text-align:center">iGrow Digital · Inteligência para crescer</p>
</div>
```

## Reset password

Assunto: `Redefinir sua senha do iGrow Reports`

```html
<div style="margin:0;padding:32px 16px;background:#0b111b;font-family:Arial,Helvetica,sans-serif;color:#e7eef9">
  <div style="max-width:520px;margin:0 auto;background:#111a28;border:1px solid #243449;border-radius:16px;padding:32px">
    <p style="margin:0 0 24px;font-size:15px;font-weight:bold;color:#ffffff">iGrow <span style="font-weight:normal;color:#8ea3bd">Reports</span></p>
    <h1 style="margin:0 0 12px;font-size:22px;color:#ffffff">Redefinir senha</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#b3c4d8">Recebemos um pedido para redefinir a senha da sua conta. Use o botão abaixo para criar uma nova.</p>
    <a href="{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&amp;type=recovery" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:14px 24px;border-radius:10px">Criar nova senha</a>
    <p style="margin:24px 0 0;font-size:12px;line-height:18px;color:#7f93ab">Se você não pediu a redefinição, ignore este e-mail; sua senha atual continua valendo.</p>
  </div>
  <p style="max-width:520px;margin:16px auto 0;font-size:11px;color:#5d7088;text-align:center">iGrow Digital · Inteligência para crescer</p>
</div>
```
