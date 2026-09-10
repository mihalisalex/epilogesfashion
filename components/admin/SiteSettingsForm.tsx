"use client";

import { useState, useTransition } from "react";
import { Check, Plus, Radio, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { SiteSettings } from "@/types";

interface SiteSettingsFormProps {
  initialSettings: SiteSettings;
  onSave: (settings: SiteSettings) => Promise<void>;
}

export function SiteSettingsForm({ initialSettings, onSave }: SiteSettingsFormProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [saved, setSaved] = useState<"idle" | "saved" | "error">("idle");
  const [isPending, startTransition] = useTransition();

  const field = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved("idle");
  };

  const updateMessage = (index: number, value: string) => {
    const next = [...settings.announcementMessages];
    next[index] = value;
    field("announcementMessages", next);
  };

  const removeMessage = (index: number) => {
    field(
      "announcementMessages",
      settings.announcementMessages.filter((_, i) => i !== index)
    );
  };

  const addMessage = () => {
    field("announcementMessages", [...settings.announcementMessages, "New announcement"]);
  };

  const handleSave = () => {
    startTransition(async () => {
      try {
        await onSave(settings);
        setSaved("saved");
      } catch {
        setSaved("error");
      }
    });
  };

  return (
    <div className="max-w-2xl border border-border bg-luxe-white p-6">
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-luxe-gray-dark uppercase">Site Name</label>
            <input
              value={settings.siteName}
              onChange={(e) => field("siteName", e.target.value)}
              className="h-10 w-full border border-border px-3 text-sm outline-none focus:border-luxe-black"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-luxe-gray-dark uppercase">Currency</label>
            <input
              value={settings.currency}
              onChange={(e) => field("currency", e.target.value)}
              className="h-10 w-full border border-border px-3 text-sm outline-none focus:border-luxe-black"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-luxe-gray-dark uppercase">Tagline</label>
          <input
            value={settings.tagline}
            onChange={(e) => field("tagline", e.target.value)}
            className="h-10 w-full border border-border px-3 text-sm outline-none focus:border-luxe-black"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-luxe-gray-dark uppercase">Contact Email</label>
          <input
            value={settings.contactEmail}
            onChange={(e) => field("contactEmail", e.target.value)}
            className="h-10 w-full border border-border px-3 text-sm outline-none focus:border-luxe-black"
          />
        </div>

        <div>
          <label className="mb-2 block text-xs font-medium text-luxe-gray-dark uppercase">
            Announcement Bar Messages
          </label>
          <div className="space-y-2">
            {settings.announcementMessages.map((message, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={message}
                  onChange={(e) => updateMessage(index, e.target.value)}
                  className="h-10 w-full border border-border px-3 text-sm outline-none focus:border-luxe-black"
                />
                <button
                  type="button"
                  aria-label="Remove message"
                  onClick={() => removeMessage(index)}
                  className="flex size-10 shrink-0 items-center justify-center border border-border"
                >
                  <X className="size-4" strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addMessage}
            className="mt-2 flex items-center gap-1 text-xs font-medium tracking-[0.05em] uppercase text-luxe-gray-dark hover:text-luxe-black"
          >
            <Plus className="size-3.5" strokeWidth={1.5} />
            Add Message
          </button>
        </div>

        <div className="border border-border bg-luxe-gray-light p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-2.5">
              <Radio className="mt-0.5 size-4 shrink-0 text-luxe-purple" strokeWidth={1.5} />
              <div>
                <p className="text-sm font-medium text-luxe-black">&quot;We&apos;re Live on TikTok&quot; Popup</p>
                <p className="mt-0.5 max-w-md text-xs text-luxe-gray-dark">
                  While on, every storefront visitor gets a full-screen incoming-call-style popup
                  inviting them to join your TikTok live. Turn it on right before you go live, and
                  off again when the stream ends — the shop looks completely normal while it&apos;s off.
                </p>
              </div>
            </div>
            <Switch
              checked={settings.liveOnTikTok ?? false}
              onCheckedChange={(checked) => field("liveOnTikTok", checked)}
              className="mt-0.5 shrink-0"
            />
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-luxe-gray-dark uppercase">
              TikTok Live URL
            </label>
            <input
              value={settings.tiktokLiveUrl ?? ""}
              onChange={(e) => field("tiktokLiveUrl", e.target.value)}
              placeholder="https://www.tiktok.com/@yourhandle/live"
              className="h-10 w-full border border-border bg-luxe-white px-3 text-sm outline-none focus:border-luxe-black"
            />
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-4">
        {saved === "saved" ? (
          <span className="flex items-center gap-1 text-xs text-green-700">
            <Check className="size-3.5" strokeWidth={1.5} />
            Saved
          </span>
        ) : saved === "error" ? (
          <span className="text-xs text-destructive">Couldn&apos;t save. Try again.</span>
        ) : null}
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="h-9 bg-luxe-black px-5 text-xs font-medium tracking-[0.05em] text-luxe-white uppercase disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
