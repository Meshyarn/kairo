import type { ConfigurationEvent, ConfigurationManager } from "../../config/ConfigurationManager.js";

export type ConfigurationSubscription = {
  event: ConfigurationEvent;
  handler: (payload: any) => void;
};

export function registerConfigurationEvents(args: {
  configurationManager?: ConfigurationManager;
  configEventsRegistered: boolean;
  configurationSubscriptions: ConfigurationSubscription[];
  handleIgnoreChange: () => Promise<void>;
  handleModuleConfigChange: (filePath: string) => Promise<void>;
}): { registered: boolean; subscriptions: ConfigurationSubscription[] } {
  const {
    configurationManager,
    configEventsRegistered,
    configurationSubscriptions,
    handleIgnoreChange,
    handleModuleConfigChange
  } = args;

  if (!configurationManager || configEventsRegistered) {
    return { registered: configEventsRegistered, subscriptions: configurationSubscriptions };
  }

  const subscriptions = [...configurationSubscriptions];
  const ignoreHandler = () => void handleIgnoreChange();
  const tsconfigHandler = (payload: { filePath: string }) => void handleModuleConfigChange(payload.filePath);
  const packageHandler = (payload: { filePath: string }) => void handleModuleConfigChange(payload.filePath);

  configurationManager.on("ignoreChanged", ignoreHandler);
  subscriptions.push({ event: "ignoreChanged", handler: ignoreHandler });

  configurationManager.on("tsconfigChanged", tsconfigHandler);
  subscriptions.push({ event: "tsconfigChanged", handler: tsconfigHandler });

  configurationManager.on("jsconfigChanged", tsconfigHandler);
  subscriptions.push({ event: "jsconfigChanged", handler: tsconfigHandler });

  configurationManager.on("packageJsonChanged", packageHandler);
  subscriptions.push({ event: "packageJsonChanged", handler: packageHandler });

  return { registered: true, subscriptions };
}

export function unregisterConfigurationEvents(args: {
  configurationManager?: ConfigurationManager;
  configurationSubscriptions: ConfigurationSubscription[];
}): { registered: boolean; subscriptions: ConfigurationSubscription[] } {
  const { configurationManager, configurationSubscriptions } = args;
  if (!configurationManager) {
    return { registered: false, subscriptions: [] };
  }
  for (const subscription of configurationSubscriptions) {
    configurationManager.off(subscription.event as ConfigurationEvent, subscription.handler);
  }
  return { registered: false, subscriptions: [] };
}
