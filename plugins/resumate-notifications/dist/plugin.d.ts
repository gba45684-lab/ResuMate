export interface ResuMateNotificationsPlugin {
  saveAndNotify(options: { filename: string; mimeType: string; dataBase64: string }): Promise<{ saved: boolean; filename: string; uri: string }>;
  requestNotificationPermission(): Promise<{ granted: boolean; requested?: boolean }>;
}
