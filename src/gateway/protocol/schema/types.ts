import type { Static } from "@sinclair/typebox";
import type {
  AgentEventSchema,
  AgentIdentityParamsSchema,
  AgentIdentityResultSchema,
  AgentWaitParamsSchema,
  PollParamsSchema,
  WakeParamsSchema,
} from "./agent.js";
import type {
  AgentSummarySchema,
  AgentsFileEntrySchema,
  AgentsCreateParamsSchema,
  AgentsCreateResultSchema,
  AgentsDeleteParamsSchema,
  AgentsDeleteResultSchema,
  AgentsFilesGetParamsSchema,
  AgentsFilesGetResultSchema,
  AgentsFilesListParamsSchema,
  AgentsFilesListResultSchema,
  AgentsFilesSetParamsSchema,
  AgentsFilesSetResultSchema,
  AgentsListParamsSchema,
  AgentsListResultSchema,
  AgentsUpdateParamsSchema,
  AgentsUpdateResultSchema,
  ModelChoiceSchema,
  ModelsListParamsSchema,
  ModelsListResultSchema,
  SkillsBinsParamsSchema,
  SkillsBinsResultSchema,
  SkillsInstallParamsSchema,
  SkillsStatusParamsSchema,
  SkillsUpdateParamsSchema,
} from "./agents-models-skills.js";
import type {
  AuthFlowCancelCurrentParamsSchema,
  AuthFlowCancelCurrentResultSchema,
  AuthFlowCurrentParamsSchema,
  AuthFlowCurrentResultSchema,
  AuthFlowListParamsSchema,
  AuthFlowListResultSchema,
  AuthFlowNextParamsSchema,
  AuthFlowNextResultSchema,
  AuthFlowStartParamsSchema,
  AuthFlowStartResultSchema,
  AuthFlowStepSchema,
} from "./auth-flow.js";
import type {
  AuthProfilesDeleteParamsSchema,
  AuthProfilesGetParamsSchema,
  AuthProfilesGetResultSchema,
  AuthProfilesMutationResultSchema,
  AuthProfilesUpsertApiKeyParamsSchema,
} from "./auth-profiles.js";
import type {
  ChannelsCatalogParamsSchema,
  ChannelsCatalogResultSchema,
  ChannelsEnableParamsSchema,
  ChannelsEnableResultSchema,
  ChannelsInstallParamsSchema,
  ChannelsInstallResultSchema,
  ChannelsRepairParamsSchema,
  ChannelsRepairResultSchema,
  ChannelsLogoutParamsSchema,
  TalkConfigParamsSchema,
  TalkConfigResultSchema,
  ChannelsStatusParamsSchema,
  ChannelsStatusResultSchema,
  TalkModeParamsSchema,
  WebLoginStartParamsSchema,
  WebLoginWaitParamsSchema,
} from "./channels.js";
import type {
  ConfigApplyParamsSchema,
  ConfigGetParamsSchema,
  GatewayRestartParamsSchema,
  ConfigPatchParamsSchema,
  ConfigSchemaParamsSchema,
  ConfigSchemaResponseSchema,
  ConfigSetParamsSchema,
  UpdateRunParamsSchema,
} from "./config.js";
import type {
  CronAddParamsSchema,
  CronJobSchema,
  CronListParamsSchema,
  CronRemoveParamsSchema,
  CronRunLogEntrySchema,
  CronRunParamsSchema,
  CronRunsParamsSchema,
  CronStatusParamsSchema,
  CronUpdateParamsSchema,
} from "./cron.js";
import type {
  DataImportApplyParamsSchema,
  DataImportApplyResultSchema,
  DataImportCancelParamsSchema,
  DataImportCancelResultSchema,
} from "./data.js";
import type {
  DevicePairApproveParamsSchema,
  DevicePairListParamsSchema,
  DevicePairRejectParamsSchema,
  DeviceTokenRevokeParamsSchema,
  DeviceTokenRotateParamsSchema,
} from "./devices.js";
import type {
  DoctorFixParamsSchema,
  DoctorFixResultSchema,
  DoctorIssueSchema,
  DoctorPlanParamsSchema,
  DoctorPlanResultSchema,
} from "./doctor.js";
import type {
  ExecApprovalsGetParamsSchema,
  ExecApprovalsNodeGetParamsSchema,
  ExecApprovalsNodeSetParamsSchema,
  ExecApprovalsSetParamsSchema,
  ExecApprovalsSnapshotSchema,
  ExecApprovalRequestParamsSchema,
  ExecApprovalResolveParamsSchema,
} from "./exec-approvals.js";
import type {
  ConnectParamsSchema,
  ErrorShapeSchema,
  EventFrameSchema,
  GatewayFrameSchema,
  HelloOkSchema,
  RequestFrameSchema,
  ResponseFrameSchema,
  ShutdownEventSchema,
  TickEventSchema,
} from "./frames.js";
import type {
  ChatAbortParamsSchema,
  ChatEventSchema,
  ChatInjectParamsSchema,
  LogsTailParamsSchema,
  LogsTailResultSchema,
} from "./logs-chat.js";
import type {
  NodeDescribeParamsSchema,
  NodeEventParamsSchema,
  NodeInvokeParamsSchema,
  NodeInvokeResultParamsSchema,
  NodeListParamsSchema,
  NodePairApproveParamsSchema,
  NodePairListParamsSchema,
  NodePairRejectParamsSchema,
  NodePairRequestParamsSchema,
  NodePairVerifyParamsSchema,
  NodeRenameParamsSchema,
} from "./nodes.js";
import type {
  SessionsCompactParamsSchema,
  SessionsDeleteParamsSchema,
  SessionsListParamsSchema,
  SessionsPatchParamsSchema,
  SessionsPreviewParamsSchema,
  SessionsResetParamsSchema,
  SessionsResolveParamsSchema,
  SessionsUsageParamsSchema,
} from "./sessions.js";
import type { PresenceEntrySchema, SnapshotSchema, StateVersionSchema } from "./snapshot.js";
import type {
  WizardCancelParamsSchema,
  WizardCancelCurrentResultSchema,
  WizardCurrentParamsSchema,
  WizardCurrentResultSchema,
  WizardNextParamsSchema,
  WizardNextResultSchema,
  WizardStartParamsSchema,
  WizardStartResultSchema,
  WizardStatusParamsSchema,
  WizardStatusResultSchema,
  WizardStepSchema,
} from "./wizard.js";
import type {
  WorkflowApprovalRecordSchema,
  WorkflowApprovalCreateParamsSchema,
  WorkflowApprovalRequestParamsSchema,
  WorkflowApprovalRequestResultSchema,
  WorkflowApprovalResolveParamsSchema,
  WorkflowApprovalWaitParamsSchema,
  WorkflowApprovalsListParamsSchema,
  WorkflowApprovalsListResultSchema,
} from "./workflow-approvals.js";
import type {
  WorkspaceEntrySchema,
  WorkspaceListParamsSchema,
  WorkspaceListResultSchema,
  WorkspaceReadParamsSchema,
  WorkspaceReadResultSchema,
  WorkspaceWriteParamsSchema,
  WorkspaceWriteResultSchema,
  WorkspaceDeleteParamsSchema,
  WorkspaceDeleteResultSchema,
  WorkspaceUploadParamsSchema,
  WorkspaceUploadResultSchema,
} from "./workspace.js";

export type ConnectParams = Static<typeof ConnectParamsSchema>;
export type HelloOk = Static<typeof HelloOkSchema>;
export type RequestFrame = Static<typeof RequestFrameSchema>;
export type ResponseFrame = Static<typeof ResponseFrameSchema>;
export type EventFrame = Static<typeof EventFrameSchema>;
export type GatewayFrame = Static<typeof GatewayFrameSchema>;
export type Snapshot = Static<typeof SnapshotSchema>;
export type PresenceEntry = Static<typeof PresenceEntrySchema>;
export type ErrorShape = Static<typeof ErrorShapeSchema>;
export type StateVersion = Static<typeof StateVersionSchema>;
export type AgentEvent = Static<typeof AgentEventSchema>;
export type AuthProfilesGetParams = Static<typeof AuthProfilesGetParamsSchema>;
export type AuthProfilesGetResult = Static<typeof AuthProfilesGetResultSchema>;
export type AuthProfilesUpsertApiKeyParams = Static<typeof AuthProfilesUpsertApiKeyParamsSchema>;
export type AuthProfilesDeleteParams = Static<typeof AuthProfilesDeleteParamsSchema>;
export type AuthProfilesMutationResult = Static<typeof AuthProfilesMutationResultSchema>;
export type AuthFlowListParams = Static<typeof AuthFlowListParamsSchema>;
export type AuthFlowListResult = Static<typeof AuthFlowListResultSchema>;
export type AuthFlowStartParams = Static<typeof AuthFlowStartParamsSchema>;
export type AuthFlowStartResult = Static<typeof AuthFlowStartResultSchema>;
export type AuthFlowNextParams = Static<typeof AuthFlowNextParamsSchema>;
export type AuthFlowNextResult = Static<typeof AuthFlowNextResultSchema>;
export type AuthFlowCurrentParams = Static<typeof AuthFlowCurrentParamsSchema>;
export type AuthFlowCurrentResult = Static<typeof AuthFlowCurrentResultSchema>;
export type AuthFlowCancelCurrentParams = Static<typeof AuthFlowCancelCurrentParamsSchema>;
export type AuthFlowCancelCurrentResult = Static<typeof AuthFlowCancelCurrentResultSchema>;
export type AuthFlowStep = Static<typeof AuthFlowStepSchema>;
export type AgentIdentityParams = Static<typeof AgentIdentityParamsSchema>;
export type AgentIdentityResult = Static<typeof AgentIdentityResultSchema>;
export type PollParams = Static<typeof PollParamsSchema>;
export type AgentWaitParams = Static<typeof AgentWaitParamsSchema>;
export type WakeParams = Static<typeof WakeParamsSchema>;
export type NodePairRequestParams = Static<typeof NodePairRequestParamsSchema>;
export type NodePairListParams = Static<typeof NodePairListParamsSchema>;
export type NodePairApproveParams = Static<typeof NodePairApproveParamsSchema>;
export type NodePairRejectParams = Static<typeof NodePairRejectParamsSchema>;
export type NodePairVerifyParams = Static<typeof NodePairVerifyParamsSchema>;
export type NodeRenameParams = Static<typeof NodeRenameParamsSchema>;
export type NodeListParams = Static<typeof NodeListParamsSchema>;
export type NodeDescribeParams = Static<typeof NodeDescribeParamsSchema>;
export type NodeInvokeParams = Static<typeof NodeInvokeParamsSchema>;
export type NodeInvokeResultParams = Static<typeof NodeInvokeResultParamsSchema>;
export type NodeEventParams = Static<typeof NodeEventParamsSchema>;
export type SessionsListParams = Static<typeof SessionsListParamsSchema>;
export type SessionsPreviewParams = Static<typeof SessionsPreviewParamsSchema>;
export type SessionsResolveParams = Static<typeof SessionsResolveParamsSchema>;
export type SessionsPatchParams = Static<typeof SessionsPatchParamsSchema>;
export type SessionsResetParams = Static<typeof SessionsResetParamsSchema>;
export type SessionsDeleteParams = Static<typeof SessionsDeleteParamsSchema>;
export type SessionsCompactParams = Static<typeof SessionsCompactParamsSchema>;
export type SessionsUsageParams = Static<typeof SessionsUsageParamsSchema>;
export type ConfigGetParams = Static<typeof ConfigGetParamsSchema>;
export type ConfigSetParams = Static<typeof ConfigSetParamsSchema>;
export type ConfigApplyParams = Static<typeof ConfigApplyParamsSchema>;
export type ConfigPatchParams = Static<typeof ConfigPatchParamsSchema>;
export type GatewayRestartParams = Static<typeof GatewayRestartParamsSchema>;
export type ConfigSchemaParams = Static<typeof ConfigSchemaParamsSchema>;
export type ConfigSchemaResponse = Static<typeof ConfigSchemaResponseSchema>;
export type DoctorPlanParams = Static<typeof DoctorPlanParamsSchema>;
export type DoctorIssue = Static<typeof DoctorIssueSchema>;
export type DoctorPlanResult = Static<typeof DoctorPlanResultSchema>;
export type DoctorFixParams = Static<typeof DoctorFixParamsSchema>;
export type DoctorFixResult = Static<typeof DoctorFixResultSchema>;
export type DataImportApplyParams = Static<typeof DataImportApplyParamsSchema>;
export type DataImportApplyResult = Static<typeof DataImportApplyResultSchema>;
export type DataImportCancelParams = Static<typeof DataImportCancelParamsSchema>;
export type DataImportCancelResult = Static<typeof DataImportCancelResultSchema>;
export type WizardStartParams = Static<typeof WizardStartParamsSchema>;
export type WizardNextParams = Static<typeof WizardNextParamsSchema>;
export type WizardCancelParams = Static<typeof WizardCancelParamsSchema>;
export type WizardStatusParams = Static<typeof WizardStatusParamsSchema>;
export type WizardCurrentParams = Static<typeof WizardCurrentParamsSchema>;
export type WizardStep = Static<typeof WizardStepSchema>;
export type WizardNextResult = Static<typeof WizardNextResultSchema>;
export type WizardStartResult = Static<typeof WizardStartResultSchema>;
export type WizardStatusResult = Static<typeof WizardStatusResultSchema>;
export type WizardCurrentResult = Static<typeof WizardCurrentResultSchema>;
export type WizardCancelCurrentResult = Static<typeof WizardCancelCurrentResultSchema>;
export type TalkModeParams = Static<typeof TalkModeParamsSchema>;
export type TalkConfigParams = Static<typeof TalkConfigParamsSchema>;
export type TalkConfigResult = Static<typeof TalkConfigResultSchema>;
export type ChannelsStatusParams = Static<typeof ChannelsStatusParamsSchema>;
export type ChannelsStatusResult = Static<typeof ChannelsStatusResultSchema>;
export type ChannelsLogoutParams = Static<typeof ChannelsLogoutParamsSchema>;
export type ChannelsCatalogParams = Static<typeof ChannelsCatalogParamsSchema>;
export type ChannelsCatalogResult = Static<typeof ChannelsCatalogResultSchema>;
export type ChannelsEnableParams = Static<typeof ChannelsEnableParamsSchema>;
export type ChannelsEnableResult = Static<typeof ChannelsEnableResultSchema>;
export type ChannelsInstallParams = Static<typeof ChannelsInstallParamsSchema>;
export type ChannelsInstallResult = Static<typeof ChannelsInstallResultSchema>;
export type ChannelsRepairParams = Static<typeof ChannelsRepairParamsSchema>;
export type ChannelsRepairResult = Static<typeof ChannelsRepairResultSchema>;
export type WebLoginStartParams = Static<typeof WebLoginStartParamsSchema>;
export type WebLoginWaitParams = Static<typeof WebLoginWaitParamsSchema>;
export type AgentSummary = Static<typeof AgentSummarySchema>;
export type AgentsFileEntry = Static<typeof AgentsFileEntrySchema>;
export type AgentsCreateParams = Static<typeof AgentsCreateParamsSchema>;
export type AgentsCreateResult = Static<typeof AgentsCreateResultSchema>;
export type AgentsUpdateParams = Static<typeof AgentsUpdateParamsSchema>;
export type AgentsUpdateResult = Static<typeof AgentsUpdateResultSchema>;
export type AgentsDeleteParams = Static<typeof AgentsDeleteParamsSchema>;
export type AgentsDeleteResult = Static<typeof AgentsDeleteResultSchema>;
export type AgentsFilesListParams = Static<typeof AgentsFilesListParamsSchema>;
export type AgentsFilesListResult = Static<typeof AgentsFilesListResultSchema>;
export type AgentsFilesGetParams = Static<typeof AgentsFilesGetParamsSchema>;
export type AgentsFilesGetResult = Static<typeof AgentsFilesGetResultSchema>;
export type AgentsFilesSetParams = Static<typeof AgentsFilesSetParamsSchema>;
export type AgentsFilesSetResult = Static<typeof AgentsFilesSetResultSchema>;
export type AgentsListParams = Static<typeof AgentsListParamsSchema>;
export type AgentsListResult = Static<typeof AgentsListResultSchema>;
export type WorkspaceListParams = Static<typeof WorkspaceListParamsSchema>;
export type WorkspaceEntry = Static<typeof WorkspaceEntrySchema>;
export type WorkspaceListResult = Static<typeof WorkspaceListResultSchema>;
export type WorkspaceReadParams = Static<typeof WorkspaceReadParamsSchema>;
export type WorkspaceReadResult = Static<typeof WorkspaceReadResultSchema>;
export type WorkspaceWriteParams = Static<typeof WorkspaceWriteParamsSchema>;
export type WorkspaceWriteResult = Static<typeof WorkspaceWriteResultSchema>;
export type WorkspaceDeleteParams = Static<typeof WorkspaceDeleteParamsSchema>;
export type WorkspaceDeleteResult = Static<typeof WorkspaceDeleteResultSchema>;
export type WorkspaceUploadParams = Static<typeof WorkspaceUploadParamsSchema>;
export type WorkspaceUploadResult = Static<typeof WorkspaceUploadResultSchema>;
export type ModelChoice = Static<typeof ModelChoiceSchema>;
export type ModelsListParams = Static<typeof ModelsListParamsSchema>;
export type ModelsListResult = Static<typeof ModelsListResultSchema>;
export type SkillsStatusParams = Static<typeof SkillsStatusParamsSchema>;
export type SkillsBinsParams = Static<typeof SkillsBinsParamsSchema>;
export type SkillsBinsResult = Static<typeof SkillsBinsResultSchema>;
export type SkillsInstallParams = Static<typeof SkillsInstallParamsSchema>;
export type SkillsUpdateParams = Static<typeof SkillsUpdateParamsSchema>;
export type CronJob = Static<typeof CronJobSchema>;
export type CronListParams = Static<typeof CronListParamsSchema>;
export type CronStatusParams = Static<typeof CronStatusParamsSchema>;
export type CronAddParams = Static<typeof CronAddParamsSchema>;
export type CronUpdateParams = Static<typeof CronUpdateParamsSchema>;
export type CronRemoveParams = Static<typeof CronRemoveParamsSchema>;
export type CronRunParams = Static<typeof CronRunParamsSchema>;
export type CronRunsParams = Static<typeof CronRunsParamsSchema>;
export type CronRunLogEntry = Static<typeof CronRunLogEntrySchema>;
export type LogsTailParams = Static<typeof LogsTailParamsSchema>;
export type LogsTailResult = Static<typeof LogsTailResultSchema>;
export type ExecApprovalsGetParams = Static<typeof ExecApprovalsGetParamsSchema>;
export type ExecApprovalsSetParams = Static<typeof ExecApprovalsSetParamsSchema>;
export type ExecApprovalsNodeGetParams = Static<typeof ExecApprovalsNodeGetParamsSchema>;
export type ExecApprovalsNodeSetParams = Static<typeof ExecApprovalsNodeSetParamsSchema>;
export type ExecApprovalsSnapshot = Static<typeof ExecApprovalsSnapshotSchema>;
export type ExecApprovalRequestParams = Static<typeof ExecApprovalRequestParamsSchema>;
export type ExecApprovalResolveParams = Static<typeof ExecApprovalResolveParamsSchema>;
export type WorkflowApprovalRecord = Static<typeof WorkflowApprovalRecordSchema>;
export type WorkflowApprovalsListParams = Static<typeof WorkflowApprovalsListParamsSchema>;
export type WorkflowApprovalsListResult = Static<typeof WorkflowApprovalsListResultSchema>;
export type WorkflowApprovalCreateParams = Static<typeof WorkflowApprovalCreateParamsSchema>;
export type WorkflowApprovalRequestParams = Static<typeof WorkflowApprovalRequestParamsSchema>;
export type WorkflowApprovalRequestResult = Static<typeof WorkflowApprovalRequestResultSchema>;
export type WorkflowApprovalWaitParams = Static<typeof WorkflowApprovalWaitParamsSchema>;
export type WorkflowApprovalResolveParams = Static<typeof WorkflowApprovalResolveParamsSchema>;
export type DevicePairListParams = Static<typeof DevicePairListParamsSchema>;
export type DevicePairApproveParams = Static<typeof DevicePairApproveParamsSchema>;
export type DevicePairRejectParams = Static<typeof DevicePairRejectParamsSchema>;
export type DeviceTokenRotateParams = Static<typeof DeviceTokenRotateParamsSchema>;
export type DeviceTokenRevokeParams = Static<typeof DeviceTokenRevokeParamsSchema>;
export type ChatAbortParams = Static<typeof ChatAbortParamsSchema>;
export type ChatInjectParams = Static<typeof ChatInjectParamsSchema>;
export type ChatEvent = Static<typeof ChatEventSchema>;
export type UpdateRunParams = Static<typeof UpdateRunParamsSchema>;
export type TickEvent = Static<typeof TickEventSchema>;
export type ShutdownEvent = Static<typeof ShutdownEventSchema>;
