import * as Sentry from '@sentry/bun';

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? 'https://9002b4451ac997099647f7fb506382c8@o4511293505404928.ingest.de.sentry.io/4511293506912336',

  sendDefaultPii: true,
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  enableLogs: true,
});
