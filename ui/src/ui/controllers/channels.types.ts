import type { GatewayBrowserClient } from "../gateway.ts";
import type { ChannelsStatusSnapshot } from "../types.ts";

export type ChannelCatalogEntry = {
  id: string;
  label: string;
  detailLabel?: string;
  blurb?: string;
  systemImage?: string;
  installed: boolean;
  configured: boolean;
  enabled: boolean;
  hasSchema: boolean;
  pluginStatus?: "loaded" | "disabled" | "error";
  pluginError?: string;
  install?: { npmSpec: string; localPath?: string };
};

export type DoctorIssue = {
  code: string;
  level: "error" | "warn";
  message: string;
  source?: string;
  fixable: boolean;
  fixHint?: string;
};

export type DoctorPlanResult = {
  ok: boolean;
  issues: DoctorIssue[];
  fixAvailable: boolean;
};

export type DoctorFixResult = {
  ok: boolean;
  changed: boolean;
  fixed: DoctorIssue[];
  restartRequired?: boolean;
  backupDir?: string;
  error?: string;
};

export type ChannelsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  channelsLoading: boolean;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  channelsError: string | null;
  channelsLastSuccess: number | null;
  channelsCatalog: ChannelCatalogEntry[] | null;
  channelsCatalogLoading: boolean;
  channelsCatalogError: string | null;
  channelsSetupId?: string | null;
  channelInstallBusy: string | null;
  channelInstallError: string | null;
  channelInstallSuccess: string | null;
  channelInstallRunId: string | null;
  channelInstallLog: string;
  channelInstallLogTruncated: boolean;
  channelRestartBusy: boolean;
  channelRestartError: string | null;
  doctorPlanLoading: boolean;
  doctorPlanError: string | null;
  doctorPlan: DoctorPlanResult | null;
  doctorFixBusy: boolean;
  doctorFixError: string | null;
  whatsappLoginMessage: string | null;
  whatsappLoginQrDataUrl: string | null;
  whatsappLoginConnected: boolean | null;
  whatsappBusy: boolean;
};
