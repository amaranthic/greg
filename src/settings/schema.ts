/**
 * @fileoverview Zod v4 schema definition for persistent user and project configuration.
 * @packageDocumentation
 */

import { z } from "zod";
import { defaultMaxTurns, defaultModelString, defaultTimeoutDuration } from "../constants/index.js";

/**
 * Valid reasoning effort options supported across frontier reasoning models.
 */
export const reasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/**
 * Type representing one of the allowed reasoning effort values.
 */
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

/**
 * Supported declarative tool permission modes.
 */
export const permissionModeSchema = z.enum(["default", "acceptEdits", "plan", "bypassPermissions"]);

/**
 * Type representing one of the valid declarative permission mode strings.
 */
export type PermissionMode = z.infer<typeof permissionModeSchema>;

/**
 * Authoritative Zod schema for persisted configuration with a deterministic version 1 marker.
 */
export const settingsSchema = z.object({
  /** Schema layout format version, fixed to literal 1. */
  version: z.literal(1).default(1),
  /** Default model string formatted as provider/modelId or bare string. */
  model: z.string().default(defaultModelString),
  /** Default reasoning effort level for supported models. */
  effort: reasoningEffortSchema.optional(),
  /** Default tool execution permission mode. */
  permissionMode: permissionModeSchema.default("default"),
  /** List of pattern strings matching tools allowed to run without prompts. */
  allowedTools: z.array(z.string()).default([]),
  /** List of pattern strings matching tools explicitly denied from execution. */
  disallowedTools: z.array(z.string()).default([]),
  /** Default ceiling for agent turn iterations before terminating. */
  maxTurns: z.number().int().positive().default(defaultMaxTurns),
  /** Default wall-clock execution timeout in human-readable syntax. */
  timeout: z.string().default(defaultTimeoutDuration),
});

/**
 * Fully parsed and validated settings object representation.
 */
export type Settings = z.infer<typeof settingsSchema>;

/**
 * Partial settings object representing overrides or partial persisted states.
 */
export type PartialSettings = Partial<Settings>;
