import { Action, ActionPanel, Icon, List, open } from "@raycast/api";
import {
  AirBuddyNotInstalledError,
  AirBuddyNotRunningError,
  AutomationConsentError,
  ScriptingDisabledError,
} from "../airbuddy";

const AIRBUDDY_URL = "https://airbuddy.app";

export function ErrorView({ error, onRetry }: { error: Error; onRetry: () => void }) {
  if (error instanceof AirBuddyNotInstalledError) {
    return (
      <List.EmptyView
        icon={Icon.Download}
        title="AirBuddy Isn't Installed"
        description="This extension controls AirBuddy 3.0 or later."
        actions={
          <ActionPanel>
            <Action.OpenInBrowser title="Get Airbuddy" url={AIRBUDDY_URL} />
          </ActionPanel>
        }
      />
    );
  }

  if (error instanceof AirBuddyNotRunningError) {
    return (
      <List.EmptyView
        icon={Icon.Play}
        title="AirBuddy Isn't Running"
        description="Launch AirBuddy, then try again."
        actions={
          <ActionPanel>
            <Action title="Open Airbuddy" icon={Icon.Play} onAction={() => open("/Applications/AirBuddy.app")} />
            <Action title="Try Again" icon={Icon.Repeat} onAction={onRetry} />
          </ActionPanel>
        }
      />
    );
  }

  if (error instanceof ScriptingDisabledError || error instanceof AutomationConsentError) {
    return (
      <List.EmptyView
        icon={Icon.Lock}
        title="AirBuddy Needs Permission"
        description={
          "Two settings control this, and either one can block it:\n\n" +
          "1. AirBuddy → Settings → Advanced → Security → enable “Enable Apple Script for automation”.\n\n" +
          "2. System Settings → Privacy & Security → Automation → Raycast → enable AirBuddyHelper.\n\n" +
          "Turn both on, then try again."
        }
        actions={
          <ActionPanel>
            <Action
              title="Open Airbuddy Settings"
              icon={Icon.Gear}
              onAction={() => open("/Applications/AirBuddy.app")}
            />
            <Action
              title="Open Automation Settings"
              icon={Icon.Lock}
              onAction={() => open("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")}
            />
            <Action title="Try Again" icon={Icon.Repeat} onAction={onRetry} />
          </ActionPanel>
        }
      />
    );
  }

  return (
    <List.EmptyView
      icon={Icon.Warning}
      title="Something Went Wrong"
      description={error.message}
      actions={
        <ActionPanel>
          <Action.CopyToClipboard title="Copy Error" content={error.message} />
          <Action title="Try Again" icon={Icon.Repeat} onAction={onRetry} />
        </ActionPanel>
      }
    />
  );
}
