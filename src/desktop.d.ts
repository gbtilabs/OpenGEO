export {};
declare global {
  interface Window {
    opengeoDesktop?: {
      updates: (action?: 'status' | 'check' | 'download' | 'install' | 'preference' | 'cancel', value?: boolean) => Promise<DesktopUpdateState>;
      onUpdate: (callback: (state: DesktopUpdateState) => void) => () => void;
      setDraftProtectionPending: (value: boolean) => void;
      onQuitDeferred: (callback: () => void) => () => void;
    };
  }
  interface DesktopUpdateState {
    status: string;
    version: string;
    manualInstall: boolean;
    availableVersion: string | null;
    progress: number;
    autoDownload: boolean;
    message: string;
  }
}
