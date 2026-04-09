'use strict';

require('dotenv').config();

const { z } = require('zod');

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  TRUST_PROXY: z
    .union([z.literal('0'), z.literal('1')])
    .default('0')
    .transform((v) => v === '1'),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  ADMIN_TOKEN: z
    .string()
    .min(32, 'ADMIN_TOKEN must be at least 32 characters'),
  ENCRYPTION_KEY: z
    .string()
    .min(1, 'ENCRYPTION_KEY is required')
    .refine((v) => {
      try {
        return Buffer.from(v, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    // eslint-disable-next-line no-console
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;

module.exports = {
  port: env.PORT,
  trustProxy: env.TRUST_PROXY,
  mongoUri: env.MONGO_URI,
  adminToken: env.ADMIN_TOKEN,
  encryptionKey: Buffer.from(env.ENCRYPTION_KEY, 'base64'),
  logLevel: env.LOG_LEVEL,
};
