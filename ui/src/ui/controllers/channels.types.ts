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
  install?: { npmSpec: string; localPath?: string };
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
  whatsappLoginMessage: string | null;
  whatsappLoginQrDataUrl: string | null;
  whatsappLoginConnected: boolean | null;
  whatsappBusy: boolean;
};
