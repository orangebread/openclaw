import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const TalkModeParamsSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    phase: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const TalkConfigParamsSchema = Type.Object(
  {
    includeSecrets: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const TalkConfigResultSchema = Type.Object(
  {
    config: Type.Object(
      {
        talk: Type.Optional(
          Type.Object(
            {
              voiceId: Type.Optional(Type.String()),
              voiceAliases: Type.Optional(Type.Record(Type.String(), Type.String())),
              modelId: Type.Optional(Type.String()),
              outputFormat: Type.Optional(Type.String()),
              apiKey: Type.Optional(Type.String()),
              interruptOnSpeech: Type.Optional(Type.Boolean()),
            },
            { additionalProperties: false },
          ),
        ),
        session: Type.Optional(
          Type.Object(
            {
              mainKey: Type.Optional(Type.String()),
            },
            { additionalProperties: false },
          ),
        ),
        ui: Type.Optional(
          Type.Object(
            {
              seamColor: Type.Optional(Type.String()),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const ChannelsStatusParamsSchema = Type.Object(
  {
    probe: Type.Optional(Type.Boolean()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

// Channel docking: channels.status is intentionally schema-light so new
// channels can ship without protocol updates.
export const ChannelAccountSnapshotSchema = Type.Object(
  {
    accountId: NonEmptyString,
    name: Type.Optional(Type.String()),
    enabled: Type.Optional(Type.Boolean()),
    configured: Type.Optional(Type.Boolean()),
    linked: Type.Optional(Type.Boolean()),
    running: Type.Optional(Type.Boolean()),
    connected: Type.Optional(Type.Boolean()),
    reconnectAttempts: Type.Optional(Type.Integer({ minimum: 0 })),
    lastConnectedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    lastError: Type.Optional(Type.String()),
    lastStartAt: Type.Optional(Type.Integer({ minimum: 0 })),
    lastStopAt: Type.Optional(Type.Integer({ minimum: 0 })),
    lastInboundAt: Type.Optional(Type.Integer({ minimum: 0 })),
    lastOutboundAt: Type.Optional(Type.Integer({ minimum: 0 })),
    lastProbeAt: Type.Optional(Type.Integer({ minimum: 0 })),
    mode: Type.Optional(Type.String()),
    dmPolicy: Type.Optional(Type.String()),
    allowFrom: Type.Optional(Type.Array(Type.String())),
    tokenSource: Type.Optional(Type.String()),
    botTokenSource: Type.Optional(Type.String()),
    appTokenSource: Type.Optional(Type.String()),
    baseUrl: Type.Optional(Type.String()),
    allowUnmentionedGroups: Type.Optional(Type.Boolean()),
    cliPath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    dbPath: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    port: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
    probe: Type.Optional(Type.Unknown()),
    audit: Type.Optional(Type.Unknown()),
    application: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: true },
);

export const ChannelUiMetaSchema = Type.Object(
  {
    id: NonEmptyString,
    label: NonEmptyString,
    detailLabel: NonEmptyString,
    systemImage: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ChannelsStatusResultSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    channelOrder: Type.Array(NonEmptyString),
    channelLabels: Type.Record(NonEmptyString, NonEmptyString),
    channelDetailLabels: Type.Optional(Type.Record(NonEmptyString, NonEmptyString)),
    channelSystemImages: Type.Optional(Type.Record(NonEmptyString, NonEmptyString)),
    channelMeta: Type.Optional(Type.Array(ChannelUiMetaSchema)),
    channels: Type.Record(NonEmptyString, Type.Unknown()),
    channelAccounts: Type.Record(NonEmptyString, Type.Array(ChannelAccountSnapshotSchema)),
    channelDefaultAccountId: Type.Record(NonEmptyString, NonEmptyString),
  },
  { additionalProperties: false },
);

export const ChannelsLogoutParamsSchema = Type.Object(
  {
    channel: NonEmptyString,
    accountId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ChannelsCatalogParamsSchema = Type.Object({}, { additionalProperties: false });

export const ChannelsCatalogEntrySchema = Type.Object(
  {
    id: NonEmptyString,
    label: NonEmptyString,
    detailLabel: Type.Optional(Type.String()),
    blurb: Type.Optional(Type.String()),
    systemImage: Type.Optional(Type.String()),
    installed: Type.Boolean(),
    configured: Type.Boolean(),
    enabled: Type.Boolean(),
    hasSchema: Type.Boolean(),
    pluginStatus: Type.Optional(
      Type.Union([Type.Literal("loaded"), Type.Literal("disabled"), Type.Literal("error")]),
    ),
    pluginError: Type.Optional(Type.String()),
    install: Type.Optional(
      Type.Object({
        npmSpec: Type.String(),
        localPath: Type.Optional(Type.String()),
      }),
    ),
  },
  { additionalProperties: false },
);

export const ChannelsCatalogResultSchema = Type.Object(
  {
    entries: Type.Array(ChannelsCatalogEntrySchema),
  },
  { additionalProperties: false },
);

export const ChannelsEnableParamsSchema = Type.Object(
  {
    channelId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const ChannelsEnableResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    channelId: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    restartRequired: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: true },
);

export const ChannelsInstallParamsSchema = Type.Object(
  {
    channelId: Type.Optional(NonEmptyString),
    npmSpec: Type.Optional(NonEmptyString),
    clientRunId: Type.Optional(NonEmptyString),
    mode: Type.Optional(Type.Union([Type.Literal("install"), Type.Literal("update")])),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const ChannelsInstallResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    pluginId: Type.Optional(Type.String()),
    version: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    restartRequired: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: true },
);

export const ChannelsRepairParamsSchema = Type.Object(
  {
    channelId: NonEmptyString,
    clientRunId: Type.Optional(NonEmptyString),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const ChannelsRepairResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    pluginId: Type.Optional(Type.String()),
    version: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    restartRequired: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: true },
);

export const WebLoginStartParamsSchema = Type.Object(
  {
    force: Type.Optional(Type.Boolean()),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
    verbose: Type.Optional(Type.Boolean()),
    accountId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const WebLoginWaitParamsSchema = Type.Object(
  {
    timeoutMs: Type.Optional(Type.Integer({ minimum: 0 })),
    accountId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
