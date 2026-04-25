import { z } from "zod";

export const notificationKindSchema = z.enum(["question", "permission", "task", "alert"]);
export const notificationChannelSchema = z.enum(["inApp", "browser", "telegram", "macos"]);
export const notificationRuleScopeSchema = z.enum(["global", "project", "session"]);

const channelsSchema = z
  .object({
    inApp: z.boolean(),
    browser: z.boolean(),
    telegram: z.boolean(),
    macos: z.boolean(),
  })
  .strict();

const thresholdsSchema = z
  .object({
    mainSessionInputTokens: z.number().finite().positive().optional(),
  })
  .strict();

const rateLimitSchema = z
  .object({
    max: z.number().finite().positive(),
    windowSeconds: z.number().finite().positive(),
  })
  .strict();

const quietHoursSchema = z
  .object({
    enabled: z.boolean(),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict();

const ruleShape = {
  id: z.string().min(1),
  enabled: z.boolean(),
  kinds: z.array(notificationKindSchema).min(1),
  thresholds: thresholdsSchema.optional(),
  channels: channelsSchema,
  quietHours: quietHoursSchema.optional(),
  rateLimit: rateLimitSchema.optional(),
};

export const notificationRuleSchema = z.discriminatedUnion("scope", [
  z
    .object({
      ...ruleShape,
      scope: z.literal("global"),
    })
    .strict(),
  z
    .object({
      ...ruleShape,
      scope: z.literal("project"),
      projectSlug: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...ruleShape,
      scope: z.literal("session"),
      sessionId: z.string().min(1),
    })
    .strict(),
]);

export const notificationSettingsSchema = z
  .object({
    enabled: z.boolean(),
    channels: channelsSchema,
    defaults: z
      .object({
        mainSessionInputTokens: z.number().finite().positive(),
        suppressBrowserWhenVisible: z.boolean(),
        rateLimit: rateLimitSchema,
      })
      .strict(),
    rules: z.array(notificationRuleSchema),
  })
  .strict();

export type NotificationKind = z.infer<typeof notificationKindSchema>;
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
export type NotificationRuleScope = z.infer<typeof notificationRuleScopeSchema>;
export type NotificationRule = z.infer<typeof notificationRuleSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
