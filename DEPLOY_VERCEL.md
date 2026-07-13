# Deploy the Brew website

The public Vercel project serves only `docs/`. It does not deploy the local Fastify/SQLite application. The interactive `/demo/` uses a fixed browser-only dataset and makes no feed requests.

```powershell
npm run website:verify
vercel --prod --yes
```

The real application remains a local process started with `npm start`; its database stays at `data/brew.db`.
