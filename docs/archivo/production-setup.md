# Puesta en producción: Vercel, Convex e Inngest

Guía para desplegar el proyecto en **producción** con Vercel (frontend/API), Convex (backend) e Inngest (jobs).

## Resumen del problema

- **Vercel**: el deployment ya funciona, pero la app puede estar usando el deployment **dev** de Convex si no se configuró la Production Deploy Key.
- **Convex**: en producción debe usarse el deployment **prod**, no `dev:mellow-donkey-736`.
- **Inngest**: en producción requiere la integración con Vercel y las signing keys para que el cloud de Inngest pueda invocar tus funciones.

---

## 1. Convex en producción (Vercel)

### Por qué estaba apuntando a Dev

Si en Vercel no tienes **CONVEX_DEPLOY_KEY** (Production Deploy Key), el build puede estar usando variables de otro origen o un deployment equivocado. La forma correcta en Convex + Vercel es usar **solo** la Production Deploy Key en el entorno **Production** de Vercel.

### Pasos

1. **Generar Production Deploy Key en Convex**
   - Entra al [Convex Dashboard](https://dashboard.convex.dev/) → tu proyecto **reconciliation-fab0f**.
   - Ve a **Settings** → **Deploy Keys** (o "Production Deploy Key").
   - Pulsa **Generate Production Deploy Key** y copia la key.

2. **Configurar solo en Vercel (Production)**
   - Vercel → tu proyecto → **Settings** → **Environment Variables**.
   - Crea la variable:
     - **Name**: `CONVEX_DEPLOY_KEY`
     - **Value**: la Production Deploy Key que copiaste.
     - **Environment**: marca **solo Production** (desmarca Preview y Development).
   - Guarda.

3. **Quitar CONVEX_DEPLOYMENT de Vercel (si existe)**
   - En las mismas Environment Variables, si tienes `CONVEX_DEPLOYMENT` o `NEXT_PUBLIC_CONVEX_URL` configuradas para **Production**, puedes eliminarlas para el entorno Production.
   - Con `CONVEX_DEPLOY_KEY`, el comando `npx convex deploy` inyecta automáticamente la URL del deployment **prod** durante el build (como `NEXT_PUBLIC_CONVEX_URL`).

4. **Build en Vercel**
   - El `vercel.json` ya tiene:
     ```json
     "buildCommand": "npx convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd 'pnpm run build'"
     ```
   - En cada deploy a **Production**, `convex deploy`:
     - Usa `CONVEX_DEPLOY_KEY` y despliega las funciones al deployment **prod**.
     - Pasa `NEXT_PUBLIC_CONVEX_URL` al `pnpm run build`, así la app queda apuntando a Convex prod.

5. **Variables de Convex (Dashboard)**
   - En **Convex Dashboard** → **Settings** → **Environment Variables**, configura las variables que necesitan tus **actions** (AWS, CloudWatch, DynamoDB, etc.) para el deployment **prod**. Pueden ser distintas a las de dev.

### Preview deployments (opcional)

Para que cada PR use su propio Convex (preview), en Vercel añade otra variable:

- **Name**: `CONVEX_DEPLOY_KEY`
- **Value**: una **Preview Deploy Key** (generada en Convex Dashboard).
- **Environment**: solo **Preview**.

Así, Production sigue usando prod y los previews usan deployments temporales.

---

## 2. Inngest en producción (Vercel)

### Qué hace falta

En producción, Inngest Cloud llama a tu app en `https://tu-dominio.vercel.app/api/inngest`. Para eso necesita:

- **INNGEST_SIGNING_KEY**: que Inngest use para firmar las peticiones y tu app las verifique.
- **INNGEST_EVENT_KEY** (opcional): para enviar eventos desde tu app al cloud de Inngest.

### Pasos

1. **Instalar la integración Inngest ↔ Vercel**
   - [Conectar Inngest con Vercel](https://app.inngest.com/settings/integrations/vercel/connect).
   - Autoriza el acceso a tu cuenta de Vercel y selecciona el proyecto (reconciliation).
   - La integración:
     - Sincroniza tu app con Inngest en cada deploy (registra las funciones en `/api/inngest`).
     - Añade en tu proyecto de Vercel las variables `INNGEST_SIGNING_KEY` e `INNGEST_EVENT_KEY` (en el entorno que elijas, típicamente Production).

2. **Proteger el endpoint**
   - Si en Vercel tienes **Deployment Protection** (Standard o All deployments), Inngest no podrá llamar a `/api/inngest` a menos que:
     - Desactives la protección para ese proyecto, o
     - Configures **Protection Bypass for Automation** y uses el mismo secret en la [configuración de la integración Inngest ↔ Vercel](https://app.inngest.com/settings/integrations/vercel).

3. **Comprobar**
   - Tras un deploy, en [Inngest Cloud](https://app.inngest.com) → tu app → **Functions**, deberías ver las funciones (test-ping, datamapping-full-history, etc.).
   - Puedes disparar un evento de prueba desde la UI de Inngest o con `GET https://tu-dominio.vercel.app/api/test-inngest` (si lo tienes habilitado en prod).

---

## 3. Checklist rápido

| Dónde | Qué |
|-------|-----|
| **Convex Dashboard** | Production Deploy Key generada; env vars de prod para actions (AWS, DynamoDB, etc.). |
| **Vercel → Env (Production)** | `CONVEX_DEPLOY_KEY` = Production Deploy Key. Sin `CONVEX_DEPLOYMENT` para prod. |
| **Vercel → Build** | `npx convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd 'pnpm run build'` (ya en `vercel.json`). |
| **Inngest** | Integración Vercel instalada; variables `INNGEST_SIGNING_KEY` e `INNGEST_EVENT_KEY` en Vercel (suelen añadirse solas). |
| **Vercel Deployment Protection** | Desactivada o bypass configurado para que Inngest pueda llamar a `/api/inngest`. |

---

## 4. Variables de entorno de ejemplo (solo nombres)

Para **Vercel Production** (valores en la UI de Vercel o Convex/Inngest):

- `CONVEX_DEPLOY_KEY` — Production Deploy Key de Convex (solo Production).
- `INNGEST_SIGNING_KEY` — la pone la integración Inngest.
- `INNGEST_EVENT_KEY` — la pone la integración Inngest.

No hace falta definir `NEXT_PUBLIC_CONVEX_URL` en Vercel si usas `CONVEX_DEPLOY_KEY`; el comando de build la inyecta.

Para **Convex Dashboard** (deployment prod), las que necesiten tus actions: AWS, CloudWatch, DynamoDB, etc., según tu código.
