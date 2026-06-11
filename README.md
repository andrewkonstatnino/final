# Herculean Technologies Website

Run the site and lead intake backend:

```sh
node server.mjs
```

Lead intake posts to `/api/leads`. Each request is saved to `data/leads.jsonl` and, when SMTP is configured, emailed to `sales@herculeantechnologies.com`.

Set these environment variables before starting the server:

```sh
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM=no-reply@herculeantechnologies.com
```

Optional:

```sh
PORT=4173
SMTP_SECURE=true
```
