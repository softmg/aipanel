type CursorNotification = {
  id: string;
  createdAt: string;
};

export type NotificationCursor = {
  createdAtMs: number;
  id: string;
};

export const MAX_NOTIFICATION_CURSOR_ID = "￿";

export function parseRealtimeSinceParam(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric;
  }

  const parsed = new Date(value).valueOf();
  return Number.isNaN(parsed) ? null : parsed;
}

export function compareNotificationCursor(left: NotificationCursor, right: NotificationCursor): number {
  if (left.createdAtMs !== right.createdAtMs) {
    return left.createdAtMs - right.createdAtMs;
  }
  return left.id.localeCompare(right.id);
}

export function getNotificationCursor(notification: CursorNotification): NotificationCursor | null {
  const createdAtMs = new Date(notification.createdAt).valueOf();
  if (Number.isNaN(createdAtMs)) {
    return null;
  }

  return {
    createdAtMs,
    id: notification.id,
  };
}

export function isNotificationNewerThanCursor(
  notification: CursorNotification,
  cursor: NotificationCursor,
): boolean {
  const notificationCursor = getNotificationCursor(notification);
  return notificationCursor ? compareNotificationCursor(notificationCursor, cursor) > 0 : false;
}

export function advanceNotificationCursor<T extends CursorNotification>(
  cursor: NotificationCursor | null,
  notifications: T[],
): NotificationCursor | null {
  let nextCursor = cursor;

  for (const notification of notifications) {
    const notificationCursor = getNotificationCursor(notification);
    if (!notificationCursor) {
      continue;
    }

    if (!nextCursor || compareNotificationCursor(notificationCursor, nextCursor) > 0) {
      nextCursor = notificationCursor;
    }
  }

  return nextCursor;
}
