import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";

export type ClockLocale = "de-DE" | "en-US";
export type ClockDateStyle = "short" | "long" | "none";

export interface ClockConfig {
  locale?: ClockLocale;
  hour12?: boolean;
  showSeconds?: boolean;
  dateStyle?: ClockDateStyle;
  /** `system` means the browser's local timezone. */
  timeZone?: string;
}

export interface ClockSettings {
  locale: ClockLocale;
  hour12: boolean;
  showSeconds: boolean;
  dateStyle: ClockDateStyle;
  timeZone: string;
}

export interface ClockModel {
  now: Ref<Date>;
  formatted: ComputedRef<{ time: string; date: string | null }>;
}

const CURATED_TIMEZONES = [
  "system",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Paris",
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

const ALLOWED_TIMEZONES = new Set<string>(CURATED_TIMEZONES);

export const DEFAULT_CLOCK_SETTINGS: ClockSettings = {
  locale: "de-DE",
  hour12: false,
  showSeconds: true,
  dateStyle: "long",
  timeZone: "system",
};

/** Normalize both migrated storage and the readonly config handed to setup. */
export function normalizeClockConfig(raw: unknown): ClockSettings {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const locale: ClockLocale = value.locale === "en-US" ? "en-US" : "de-DE";
  const dateStyle: ClockDateStyle =
    value.dateStyle === "short" || value.dateStyle === "none" ? value.dateStyle : "long";
  const timeZone =
    typeof value.timeZone === "string" && ALLOWED_TIMEZONES.has(value.timeZone)
      ? value.timeZone
      : "system";
  return {
    locale,
    hour12: Boolean(value.hour12),
    showSeconds: value.showSeconds !== false,
    dateStyle,
    timeZone,
  };
}

export function formatClock(
  date: Date,
  settings: ClockSettings,
): { time: string; date: string | null } {
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: settings.hour12,
  };
  if (settings.showSeconds) timeOptions.second = "2-digit";
  if (settings.timeZone !== "system") timeOptions.timeZone = settings.timeZone;

  const time = new Intl.DateTimeFormat(settings.locale, timeOptions).format(date);
  if (settings.dateStyle === "none") return { time, date: null };

  const dateOptions: Intl.DateTimeFormatOptions =
    settings.dateStyle === "short"
      ? { day: "2-digit", month: "2-digit", year: "numeric" }
      : { weekday: "long", day: "2-digit", month: "long", year: "numeric" };
  if (settings.timeZone !== "system") dateOptions.timeZone = settings.timeZone;

  return {
    time,
    date: new Intl.DateTimeFormat(settings.locale, dateOptions).format(date),
  };
}

export const clockWidget = defineWidget<ClockConfig>({
  name: "clock",
  displayName: "Clock",
  description: "Local time with optional seconds and timezone.",
  defaultSize: { w: 2, h: 2 },
  minSize: { w: 1, h: 1 },
  mode: "both",
  configuration: {
    locale: {
      type: "select",
      label: "Language",
      default: "de-DE",
      options: [
        { value: "de-DE", label: "Deutsch" },
        { value: "en-US", label: "English" },
      ],
    },
    hour12: {
      type: "boolean",
      label: "12-hour clock",
      default: false,
    },
    showSeconds: {
      type: "boolean",
      label: "Show seconds",
      default: true,
    },
    dateStyle: {
      type: "select",
      label: "Date style",
      default: "long",
      options: [
        { value: "long", label: "Long" },
        { value: "short", label: "Short" },
        { value: "none", label: "No date" },
      ],
    },
    timeZone: {
      type: "select",
      label: "Timezone",
      default: "system",
      options: [
        { value: "system", label: "System" },
        { value: "Europe/Berlin", label: "Berlin" },
        { value: "Europe/London", label: "London" },
        { value: "Europe/Paris", label: "Paris" },
        { value: "UTC", label: "UTC" },
        { value: "America/New_York", label: "New York" },
        { value: "America/Chicago", label: "Chicago" },
        { value: "America/Denver", label: "Denver" },
        { value: "America/Los_Angeles", label: "Los Angeles" },
        { value: "America/Sao_Paulo", label: "São Paulo" },
        { value: "Asia/Tokyo", label: "Tokyo" },
        { value: "Asia/Shanghai", label: "Shanghai" },
        { value: "Asia/Kolkata", label: "Kolkata" },
        { value: "Australia/Sydney", label: "Sydney" },
        { value: "Pacific/Auckland", label: "Auckland" },
      ],
    },
  },
  component: {
    setup(ctx: WidgetContext<ClockConfig>): ClockModel {
      const settings = normalizeClockConfig(ctx.config);
      const now = ref(new Date());
      const timer = setInterval(() => {
        now.value = new Date();
      }, 1000);

      // The effect scope is the contract's complete widget lifecycle.
      onScopeDispose(() => clearInterval(timer));

      return {
        now,
        formatted: computed(() => formatClock(now.value, settings)),
      };
    },
  },
});

